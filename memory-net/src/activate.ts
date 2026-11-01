/**
 * 激活排序与预算裁剪（纯函数，不触 db）。
 *
 * 权重（写死）：constraint > observation > progress > tip > inference > trail 摘要。
 * promoted inference 按 observation 级权重参与（显式人工升级的推断可信度等同观测）。
 * 预算：max_nodes + max_tokens（估算：utf8 字节数 / 3，中英混合粗估，v1 写死不做分词器）。
 * 冻结集：constraint 全部 + 当次上下文的 progress —— 永不裁光（可超预算，软上限）。
 */
import type { MemoryNode, RankedNode, Budgets } from './types.js'

export const KIND_WEIGHT: Record<string, number> = {
  constraint: 6,
  observation: 5,
  progress: 4,
  tip: 3,
  inference: 2,
  trail: 1,
}

/** promoted inference 升至 observation 级。 */
export const PROMOTED_WEIGHT = 5

export const DEFAULT_BUDGETS = { max_nodes: 24, max_tokens: 2048 }

export const TRAIL_DIGEST_MAX_STEPS = 20

export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 3)
}

export function resolveBudgets(b?: Budgets): { max_nodes: number; max_tokens: number } {
  return {
    max_nodes: b?.max_nodes && b.max_nodes > 0 ? b.max_nodes : DEFAULT_BUDGETS.max_nodes,
    max_tokens: b?.max_tokens && b.max_tokens > 0 ? b.max_tokens : DEFAULT_BUDGETS.max_tokens,
  }
}

export function tokenizeQuery(query: string): string[] {
  return String(query || '')
    .split(/[\s,，、;；]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0)
}

/** query 命中加分：每个命中词 +2（key 与 text 各查一次，同词不重复计）。 */
export function queryScore(n: MemoryNode, terms: string[]): number {
  if (terms.length === 0) return 0
  const hay = `${(n.key ?? '').toLowerCase()} ${n.text.toLowerCase()}`
  let hits = 0
  for (const t of terms) {
    if (hay.includes(t)) hits++
  }
  return hits * 2
}

/** 新鲜度加分：24h 内 +1.5，7 天内 +0.75，更早 0。 */
export function freshnessBonus(updatedAt: number, now: number): number {
  const age = now - updatedAt
  if (age <= 24 * 3600e3) return 1.5
  if (age <= 7 * 24 * 3600e3) return 0.75
  return 0
}

export function nodeWeight(n: MemoryNode): number {
  if (n.kind === 'inference' && n.status === 'promoted') return PROMOTED_WEIGHT
  return KIND_WEIGHT[n.kind] ?? 0
}

/** 单节点综合分。 */
export function nodeScore(n: MemoryNode, terms: string[], now: number): number {
  let s = nodeWeight(n) + queryScore(n, terms) + freshnessBonus(n.updated_at, now)
  if (n.kind === 'inference' && typeof n.confidence === 'number') s += n.confidence
  return s
}

/** 粗略单节点 token 估算（正文 + key + 关键 payload 字段）。 */
export function nodeTokens(n: MemoryNode): number {
  const extra = [
    typeof n.payload.status === 'string' ? n.payload.status : '',
    typeof n.payload.summary === 'string' ? n.payload.summary : '',
    typeof n.payload.mode === 'string' ? n.payload.mode : '',
    typeof n.payload.strategy === 'string' ? n.payload.strategy : '',
    typeof n.payload.recovery === 'string' ? n.payload.recovery : '',
  ].join(' ')
  return estimateTokens(`${n.kind} ${n.key ?? ''} ${n.text} ${extra}`)
}

export interface ScoredCandidate {
  node: MemoryNode
  weight: number
  score: number
  tokens: number
}

/** 候选按分数降序（同分按 updated_at 新者在前）。 */
export function rankCandidates(cands: MemoryNode[], query: string, now: number): ScoredCandidate[] {
  const terms = tokenizeQuery(query)
  return cands
    .map((n) => ({
      node: n,
      weight: nodeWeight(n),
      score: nodeScore(n, terms, now),
      tokens: nodeTokens(n),
    }))
    .sort((a, b) => (b.score - a.score) || (b.node.updated_at - a.node.updated_at))
}

/** 预算填充：frozen 先进（永不裁光），其余按序尝试双预算。返回入选 + 被丢弃数。 */
export function fillBudget(
  frozen: MemoryNode[],
  candidates: ScoredCandidate[],
  budgets: { max_nodes: number; max_tokens: number },
  trailTokens: number,
  includeTrail: boolean,
): { picked: RankedNode[]; trailIncluded: boolean; dropped: number; tokensUsed: number } {
  let used = 0
  let usedNodes = 0
  const picked: RankedNode[] = []
  for (const n of frozen) {
    const t = nodeTokens(n)
    picked.push({ node: n, weight: nodeWeight(n), score: Number.POSITIVE_INFINITY, tokens: t, frozen: true })
    used += t
    usedNodes++
  }
  let remainingTokens = budgets.max_tokens - used
  let remainingNodes = budgets.max_nodes - usedNodes
  let trailIncluded = false
  let dropped = 0
  for (const c of candidates) {
    if (remainingNodes <= 0 || remainingTokens <= 0) {
      dropped++
      continue
    }
    if (c.tokens > remainingTokens) {
      dropped++
      continue
    }
    remainingTokens -= c.tokens
    remainingNodes--
    used += c.tokens
    picked.push({ node: c.node, weight: c.weight, score: c.score, tokens: c.tokens, frozen: false })
  }
  // trail 摘要权重最低：候选填满后再尝试 —— 预算紧时最先被丢（与文档语义一致）。
  //（旧实现 trail 先占预算，weight-1 的 trail 能挤掉 weight-5 的 observation，倒挂已修）
  if (includeTrail && trailTokens <= remainingTokens && remainingNodes > 0) {
    remainingTokens -= trailTokens
    remainingNodes--
    used += trailTokens
    trailIncluded = true
  }
  return { picked, trailIncluded, dropped, tokensUsed: used }
}
