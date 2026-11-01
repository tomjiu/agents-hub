/**
 * 认证件：Bearer token，sha256 对齐后 timingSafeEqual（对齐 kokoa gateway 安全件）。
 *
 * 红线：绝不内置默认令牌；CONSOLE_TOKEN 缺省时由入口随机生成并打印一次。
 */
import { createHash, timingSafeEqual } from 'node:crypto'

function sha256(input: string): Buffer {
  return createHash('sha256').update(input, 'utf8').digest()
}

/** 常量时间比较（先哈希对齐长度，避免 timingSafeEqual 的长度前置泄漏）。 */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b))
}

export function extractBearer(header: string | undefined): string | null {
  if (!header) return null
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  return m && m[1] ? m[1].trim() : null
}

export function checkToken(expected: string, header: string | undefined): boolean {
  const got = extractBearer(header)
  if (!got) return false
  return safeEqual(expected, got)
}
