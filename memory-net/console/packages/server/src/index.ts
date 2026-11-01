/**
 * memory-net-console 入口。
 *
 * 环境变量：
 *   CONSOLE_HOST（默认 127.0.0.1，红线：绝不 0.0.0.0；远程访问经 Cloudflare Tunnel/cloudflared 本机转发）
 *   CONSOLE_PORT（默认 8790）
 *   CONSOLE_TOKEN（缺省随机生成并打印一次；固定令牌用于手机/Tunnel 场景）
 *   CONSOLE_HOME（workspace 根目录，默认 ~/.memory-net-console；即各 memory.db 的父目录）
 *   CONSOLE_STATIC（可选：静态托管 apps/console 构建产物，单域部署）
 *   CONSOLE_LOG=1 访问日志
 */
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Catalog } from './catalog.js'
import { createConsoleServer } from './server.js'

const HOST = process.env.CONSOLE_HOST ?? '127.0.0.1'
const RAW_PORT = process.env.CONSOLE_PORT ?? '8790'
const PORT = Number(RAW_PORT)
if (!Number.isInteger(PORT) || PORT <= 0 || PORT >= 65536) {
  console.error(`[console] CONSOLE_PORT 无效: "${RAW_PORT}"（需 1..65535 整数）`)
  process.exit(1)
}
function isLoopbackHost(h: string): boolean {
  return h === 'localhost' || h === '::1' || h.startsWith('127.')
}
const HOST_IS_LOOPBACK = isLoopbackHost(HOST)
const HOME = process.env.CONSOLE_HOME || join(homedir(), '.memory-net-console')
const STATIC_DIR = process.env.CONSOLE_STATIC || undefined
const LOG = process.env.CONSOLE_LOG === '1'

let token = process.env.CONSOLE_TOKEN ?? ''
const tokenFromEnv = token.length > 0
if (!tokenFromEnv) {
  // 安全默认：绝不内置默认令牌
  token = randomBytes(32).toString('hex')
}

const catalog = new Catalog(HOME)
const handle = createConsoleServer({
  host: HOST,
  port: PORT,
  token,
  catalog,
  staticDir: STATIC_DIR,
  log: LOG,
})

handle.server.listen(PORT, HOST, () => {
  console.log(`[console] listening on http://${HOST}:${PORT}${HOST_IS_LOOPBACK ? '（仅本地回环，远程经 Tunnel 转发）' : '（非回环地址：token 成为唯一防线，请优先使用 Cloudflare Tunnel）'}`)
  console.log(`[console] workspace 根: ${HOME}（当前发现 ${catalog.list().length} 个）`)
  if (tokenFromEnv) {
    // P3-10：短令牌打前 4 字符等于全量暴露——<8 字符一律全隐藏并给建议
    const masked = token.length >= 8 ? `${token.slice(0, 4)}…（来自 CONSOLE_TOKEN，已隐藏）` : '***（令牌过短已全隐藏，建议 ≥16 字符）'
    console.log(`[console] token: ${masked}`)
  } else {
    console.log(`[console] token: ${token}`)
    console.log(`[console] ↑ 本次启动随机生成；固定令牌请用 CONSOLE_TOKEN=<hex> 再启动`)
  }
  if (STATIC_DIR) console.log(`[console] 静态托管 UI: ${STATIC_DIR}（单域部署）`)
})

function shutdown(): void {
  handle.close()
  setTimeout(() => process.exit(0), 500).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
