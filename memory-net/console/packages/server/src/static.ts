/**
 * 静态托管：单域部署（CONSOLE_STATIC 指向前端构建产物 dist）。
 *
 * 防护与 companion gateway 同款：URL 解码 → normalize → inside 双层防穿越
 * （含 %2e%2e 编码穿越）→ 非资源路径 SPA fallback → 安全响应头。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { ServerResponse } from 'node:http'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
}

// CSP：vite 产物全部外链 css/js（无内联），SSE 为同源 connect-src（P3-12）
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ')

export function createStaticHandler(staticRoot: string): (pathname: string, res: ServerResponse) => void {
  const root = resolve(staticRoot)
  return function serveStatic(pathname: string, res: ServerResponse): void {
    let rel: string
    try {
      rel = decodeURIComponent(pathname)
    } catch {
      // 畸形百分号编码（如 /%zz）是客户端错误：400，而非 URIError → 500（未认证可零成本触发）
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'malformed percent-encoding' } }))
      return
    }
    if (rel.includes('\0')) {
      // 空字节会让 statSync/join 抛 ERR_INVALID_ARG_VALUE：同样按 400 拒绝
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'malformed path' } }))
      return
    }
    if (rel === '/') rel = '/index.html'
    const target = normalize(join(root, rel))
    const rootWithSep = root.endsWith(sep) ? root : root + sep
    const inside = target === root || target.startsWith(rootWithSep)
    if (!inside) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'forbidden' } }))
      return
    }
    let filePath = target
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      // SPA fallback：非资源路径回退 index.html（深链接直达前端路由）
      filePath = join(root, 'index.html')
      if (!existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'not found' } }))
        return
      }
    }
    const type = CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    const body = readFileSync(filePath)
    // 缓存策略：vite 产物带内容哈希（/assets/*）→ 一年 immutable；
    // 入口/SPA 回退 → no-store（发布即生效）。Tunnel 流量不再每刷全量（P3-14 报告随记）。
    const immutable = rel.startsWith('/assets/')
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': CSP,
    })
    res.end(body)
  }
}
