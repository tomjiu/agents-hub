/**
 * M4 隐私 —— 捕获白名单与敏感字段脱敏（issue #2 M4）。
 *
 * 纪律：
 * - 脱敏发生在**读取边界**（跨工作区 grant 视图 / 导出投影），
 *   原件永不被改写（修订账本的不可变纪律；敏感删除走 ledger.redact 显式操作）。
 * - 规则可配置：字段名黑名单（payload 键）+ 文本模式（密钥形态）。
 * - 默认规则保守：常见凭据字段与密钥形态一律掩码。
 */
import type { MemoryNode } from './types.js'

export interface RedactionRules {
  /** payload 中命中的字段整值掩码（大小写不敏感子串匹配字段名）。 */
  fields: string[]
  /** 文本/字段值中命中的正则替换（密钥形态）。 */
  patterns: Array<{ re: RegExp; replacement: string }>
}

export const DEFAULT_REDACTION_RULES: RedactionRules = {
  fields: [
    'password', 'passwd', 'secret', 'token', 'api_key', 'apikey', 'api-key',
    'authorization', 'auth', 'credential', 'private_key', 'client_secret',
    'access_key', 'session_token', 'cookie',
  ],
  patterns: [
    // AWS Access Key 形态
    { re: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[REDACTED:aws-key]' },
    // AWS Secret / base64 密钥长串 (40+)
    { re: /\b[A-Za-z0-9/+=]{40,}\b/g, replacement: '[REDACTED:long-secret]' },
    // Bearer token
    { re: /\bBearer\s+[A-Za-z0-9._-]{16,}/gi, replacement: 'Bearer [REDACTED]' },
    // 常见 sk- 前缀 API key
    { re: /\bsk-[A-Za-z0-9]{16,}\b/g, replacement: '[REDACTED:sk-key]' },
    // ghp_/gho_ GitHub token
    { re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replacement: '[REDACTED:gh-token]' },
  ],
}

export interface RedactionResult {
  node: MemoryNode
  masked: number
}

function fieldMatches(name: string, fields: string[]): boolean {
  const lower = name.toLowerCase()
  return fields.some((f) => lower.includes(f))
}

function redactText(text: string, patterns: RedactionRules['patterns']): { text: string; masked: number } {
  let out = text
  let masked = 0
  for (const { re, replacement } of patterns) {
    const before = out
    out = out.replace(re, replacement)
    if (before !== out) masked++
  }
  return { text: out, masked }
}

/** 单节点脱敏副本（不改原件）。返回掩码命中数（字段级 + 文本级）。 */
export function redactNode(n: MemoryNode, rules: RedactionRules = DEFAULT_REDACTION_RULES): RedactionResult {
  const maskedFields: string[] = []
  const payload: Record<string, unknown> = { ...n.payload }
  for (const key of Object.keys(payload)) {
    if (!fieldMatches(key, rules.fields)) continue
    const v = payload[key]
    if (typeof v === 'string') {
      const { text, masked } = redactText(v, rules.patterns)
      payload[key] = masked > 0 ? text : '[REDACTED]'
    } else {
      payload[key] = '[REDACTED]'
    }
    maskedFields.push(key)
  }
  const { text, masked } = redactText(n.text, rules.patterns)
  const node: MemoryNode = maskedFields.length > 0 || masked > 0
    ? { ...n, payload, text }
    : n
  return { node, masked: maskedFields.length + masked }
}
