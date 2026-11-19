/**
 * 激活排序与预算裁剪（纯函数，不触 db）。
 *
 * 权重（写死）：constraint > observation > progress > tip > inference > trail 摘要。
 * promoted inference 按 observation 级权重参与（显式人工升级的推断可信度等同观测）。
 * 预算：max_nodes + max_tokens（估算：utf8 字节数 / 3，中英混合粗估，v1 写死不做分词器）。
 * 冻结集：constraint 全部 + 当次上下文的 progress —— 永不裁光（可超预算，软上限）。
 */
import type { MemoryNode, RankedNode, Budgets } from './types.js';
export declare const KIND_WEIGHT: Record<string, number>;
/** promoted inference 升至 observation 级。 */
export declare const PROMOTED_WEIGHT = 5;
export declare const DEFAULT_BUDGETS: {
    max_nodes: number;
    max_tokens: number;
};
export declare const TRAIL_DIGEST_MAX_STEPS = 20;
export declare function estimateTokens(text: string): number;
export declare function resolveBudgets(b?: Budgets): {
    max_nodes: number;
    max_tokens: number;
};
export declare function tokenizeQuery(query: string): string[];
/** query 命中加分：每个命中词 +2（key 与 text 各查一次，同词不重复计）。 */
export declare function queryScore(n: MemoryNode, terms: string[]): number;
/** 新鲜度加分：24h 内 +1.5，7 天内 +0.75，更早 0。 */
export declare function freshnessBonus(updatedAt: number, now: number): number;
export declare function nodeWeight(n: MemoryNode): number;
/** 单节点综合分。 */
export declare function nodeScore(n: MemoryNode, terms: string[], now: number): number;
/** 粗略单节点 token 估算（正文 + key + 关键 payload 字段）。 */
export declare function nodeTokens(n: MemoryNode): number;
export interface ScoredCandidate {
    node: MemoryNode;
    weight: number;
    score: number;
    tokens: number;
}
/** 候选按分数降序（同分按 updated_at 新者在前）。 */
export declare function rankCandidates(cands: MemoryNode[], query: string, now: number): ScoredCandidate[];
/** 预算填充：frozen 先进（永不裁光），其余按序尝试双预算。返回入选 + 被丢弃数。 */
export declare function fillBudget(frozen: MemoryNode[], candidates: ScoredCandidate[], budgets: {
    max_nodes: number;
    max_tokens: number;
}, trailTokens: number, includeTrail: boolean): {
    picked: RankedNode[];
    trailIncluded: boolean;
    dropped: number;
    tokensUsed: number;
};
