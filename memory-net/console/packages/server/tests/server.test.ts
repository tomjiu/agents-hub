/**
 * 契约测试：Catalog 探查层 + HTTP 服务面。
 *
 * fixture：临时 CONSOLE_HOME，经核心库（vendor memory-net）灌两个 workspace，
 * 覆盖：发现/统计/搜索/分页/activate 语义/受控写面/认证/错误面/路径注入防御。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryNet } from 'memory-net/dist/src/store.js'
import { Catalog } from '../src/catalog.js'
import { createConsoleServer } from '../src/server.js'
import { checkToken, safeEqual, extractBearer } from '../src/auth.js'

function makeHome(): string {
  const root = mkdtempSync(join(tmpdir(), 'mnc-test-'))
  const alpha = join(root, 'ws-alpha')
  const beta = join(root, 'ws-beta')
  mkdirSync(alpha, { recursive: true })
  mkdirSync(beta, { recursive: true })

  const a = MemoryNet.open(alpha, { agentId: 'alice', role: 'host', workspaceId: 'ws-alpha' })
  a.add('constraint', { key: '安全红线', text: '禁止删除用户数据', payload: { mode: 'forbid' } })
  a.add('observation', {
    key: 'tool:npm_test',
    text: 'npm test 全绿（42 用例）',
    source: 'tool',
    payload: { path: 'packages/core' },
  })
  a.updateProgress('build-login', { status: 'doing', summary: '登录页完成 60%，卡在 OAuth 回调' })
  a.appendTrail('r1', { action: '跑通冒烟' })
  a.close()

  const b = MemoryNet.open(beta, { agentId: 'bob', role: 'model', workspaceId: 'ws-beta' })
  b.add('inference', { text: '回调疑似重定向 URI 配置错误', confidence: 0.6 })
  b.close()

  return root
}

interface Harness {
  root: string
  port: number
  token: string
  close: () => void
  call: (method: string, path: string, body?: unknown, withToken?: boolean) => Promise<{
    status: number
    json: any
    headers: Record<string, string>
  }>
}

async function startServer(opts: { ssePollMs?: number } = {}): Promise<Harness> {
  const root = makeHome()
  const port = 18790 + Math.floor(Math.random() * 200)
  const token = 'test-token-' + Math.random().toString(36).slice(2)
  const { createConsoleServer } = await import('../src/server.js')
  const handle = createConsoleServer({
    host: '127.0.0.1',
    port,
    token,
    catalog: new Catalog(root),
    ssePollMs: opts.ssePollMs,
  })
  await new Promise<void>((resolve) => handle.server.listen(port, '127.0.0.1', resolve))
  return {
    root,
    port,
    token,
    close: () => {
      handle.close()
      rmSync(root, { recursive: true, force: true })
    },
    call: async (method, path, body, withToken = true) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (withToken) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const resHeaders: Record<string, string> = {}
      res.headers.forEach((v, k) => (resHeaders[k] = v))
      const text = await res.text()
      let json: any = null
      try {
        json = JSON.parse(text)
      } catch {
        json = { raw: text }
      }
      return { status: res.status, json, headers: resHeaders }
    },
  }
}

test('auth: safeEqual 常量时间比较与 Bearer 提取', () => {
  assert.equal(safeEqual('abc', 'abc'), true)
  assert.equal(safeEqual('abc', 'abd'), false)
  assert.equal(safeEqual('', ''), true)
  assert.equal(extractBearer('Bearer tok1'), 'tok1')
  assert.equal(extractBearer('bearer tok1'), 'tok1')
  assert.equal(extractBearer('Basic xyz'), null)
  assert.equal(extractBearer(undefined), null)
  assert.equal(checkToken('t', 'Bearer t'), true)
  assert.equal(checkToken('t', 'Bearer wrong'), false)
  assert.equal(checkToken('t', undefined), false)
})

test('catalog: workspace 发现与统计', async () => {
  const root = makeHome()
  try {
    const cat = new Catalog(root)
    const list = cat.list()
    assert.equal(list.length, 2)
    const alpha = list.find((w) => w.id === 'ws-alpha')
    assert.ok(alpha)
    assert.equal(alpha.nodes_total, 3)
    assert.equal(alpha.trail_steps, 1)
    assert.equal(alpha.by_kind['constraint'], 1)
    assert.equal(alpha.by_kind['observation'], 1)
    assert.equal(alpha.by_kind['progress'], 1)
    assert.ok((alpha.last_activity ?? 0) > 0)

    const stats = cat.stats('ws-alpha')
    assert.equal(stats.by_agent['alice'], 3)
    assert.equal(stats.by_status['active'], 3)

    // 白名单映射：路径注入 id 一律不可解析
    assert.equal(cat.resolveDir('../escape'), null)
    assert.equal(cat.resolveDir('ws/../ws-alpha'), null)
    assert.ok(cat.resolveDir('ws-alpha') !== null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('catalog: 只读纪律 —— 连接上写语句被拒绝', async () => {
  const root = makeHome()
  try {
    const cat = new Catalog(root)
    // 内部 withDb 用 query_only/readOnly 连接，直接验证只读连接拒绝写
    const DatabaseSync = (await import('node:sqlite')).DatabaseSync
    const db = new DatabaseSync(join(root, 'ws-alpha', 'memory.db'))
    db.exec('PRAGMA query_only = ON;')
    assert.throws(() => db.prepare("INSERT INTO meta (k, v) VALUES ('x', 'y')").run())
    db.close()
    // catalog 正常工作不受影响
    assert.equal(cat.list().length, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('catalog: 节点搜索/过滤/分页', async () => {
  const root = makeHome()
  try {
    const cat = new Catalog(root)
    const page = cat.nodes('ws-alpha', { q: 'OAuth', limit: 10, offset: 0 })
    assert.equal(page.total, 1)
    assert.equal(page.nodes[0]?.kind, 'progress')
    const byKind = cat.nodes('ws-alpha', { kind: 'observation', limit: 10, offset: 0 })
    assert.equal(byKind.total, 1)
    assert.equal(byKind.nodes[0]?.key, 'tool:npm_test')
    const empty = cat.nodes('ws-alpha', { kind: 'tip', limit: 10, offset: 0 })
    assert.equal(empty.total, 0)
    const node = cat.node('ws-alpha', page.nodes[0]?.id ?? '')
    assert.ok(node)
    assert.equal(cat.node('ws-alpha', 'n999'), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('catalog: trail 与 run 摘要', async () => {
  const root = makeHome()
  try {
    const cat = new Catalog(root)
    const entries = cat.trail('ws-alpha', 'r1')
    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.action, '跑通冒烟')
    assert.equal(entries[0]?.agent_id, 'alice')
    const runs = cat.trailRuns('ws-alpha')
    assert.equal(runs.length, 1)
    assert.equal(runs[0]?.steps, 1)
    assert.deepEqual(runs[0]?.agents, ['alice'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('server: health 免认证 + 全站 401', async () => {
  const h = await startServer()
  try {
    const health = await h.call('GET', '/v1/health', undefined, false)
    assert.equal(health.status, 200)
    assert.equal(health.json.ok, true)
    assert.equal(health.json.service, 'memory-net-console')
    assert.equal(health.json.workspace_count, 2)

    const noAuth = await h.call('GET', '/v1/workspaces', undefined, false)
    assert.equal(noAuth.status, 401)
    assert.equal(noAuth.headers['www-authenticate'], 'Bearer realm="memory-net-console"')
    const badAuth = await fetch(`http://127.0.0.1:${h.port}/v1/workspaces`, {
      headers: { Authorization: 'Bearer wrong-token-xxx' },
    })
    assert.equal(badAuth.status, 401)
    await badAuth.body?.cancel()
  } finally {
    h.close()
  }
})

test('server: workspaces / stats / nodes 面契约', async () => {
  const h = await startServer()
  try {
    const ws = await h.call('GET', '/v1/workspaces')
    assert.equal(ws.status, 200)
    assert.equal(ws.json.count, 2)
    assert.ok(ws.json.workspaces.some((w: any) => w.id === 'ws-alpha'))

    const stats = await h.call('GET', '/v1/ws/ws-alpha/stats')
    assert.equal(stats.status, 200)
    assert.equal(stats.json.nodes_total, 3)
    assert.equal(stats.json.by_agent['alice'], 3)

    const nodes = await h.call('GET', '/v1/ws/ws-alpha/nodes?kind=constraint&limit=50')
    assert.equal(nodes.status, 200)
    assert.equal(nodes.json.total, 1)
    assert.equal(nodes.json.nodes[0].text, '禁止删除用户数据')

    const search = await h.call('GET', '/v1/ws/ws-alpha/nodes?q=' + encodeURIComponent('OAuth'))
    assert.equal(search.status, 200)
    assert.equal(search.json.total, 1)

    const one = await h.call('GET', '/v1/ws/ws-alpha/nodes/n1')
    assert.equal(one.status, 200)
    assert.equal(one.json.node.key, '安全红线')

    const missing = await h.call('GET', '/v1/ws/ws-alpha/nodes/n999')
    assert.equal(missing.status, 404)

    const badKind = await h.call('GET', '/v1/ws/ws-alpha/nodes?kind=nope')
    assert.equal(badKind.status, 400)

    const unknownWs = await h.call('GET', '/v1/ws/no-such/stats')
    assert.equal(unknownWs.status, 404)
  } finally {
    h.close()
  }
})

test('server: activate 预算语义（constraint 冻结置顶）', async () => {
  const h = await startServer()
  try {
    const res = await h.call('POST', '/v1/ws/ws-alpha/activate', {
      query: '登录进度',
      budgets: { max_nodes: 2, max_tokens: 2048 },
    })
    assert.equal(res.status, 200)
    assert.equal(res.json.nodes.length, 2)
    assert.equal(res.json.nodes[0].node.kind, 'constraint')
    assert.equal(res.json.nodes[0].frozen, true)
    assert.equal(res.json.nodes[0].weight, 6)
    assert.ok(res.json.budgets.max_nodes === 2)

    const emptyQuery = await h.call('POST', '/v1/ws/ws-alpha/activate', { query: '  ' })
    assert.equal(emptyQuery.status, 400)
  } finally {
    h.close()
  }
})

test('server: 受控写面 —— progress/trail 以 console 身份落库', async () => {
  const h = await startServer()
  try {
    const p = await h.call('POST', '/v1/ws/ws-alpha/progress', {
      task_id: 'build-login',
      patch: { status: 'doing', summary: '远程记录：回调修复 80%' },
    })
    assert.equal(p.status, 200)
    assert.equal(p.json.node.agent_id, 'console')
    assert.equal(p.json.node.task_id, 'build-login')

    const t = await h.call('POST', '/v1/ws/ws-alpha/trail', {
      run_id: 'r1',
      action: '控制台远程记录',
    })
    assert.equal(t.status, 200)
    assert.equal(t.json.entry.agent_id, 'console')
    assert.equal(t.json.entry.seq, 2)

    const runs = await h.call('GET', '/v1/ws/ws-alpha/runs')
    assert.equal(runs.json.runs[0].steps, 2)
    assert.ok(runs.json.runs[0].agents.includes('console'))

    const badPatch = await h.call('POST', '/v1/ws/ws-alpha/progress', { task_id: 't' })
    assert.equal(badPatch.status, 400)
    const noTask = await h.call('POST', '/v1/ws/ws-alpha/progress', { patch: { status: 'doing' } })
    assert.equal(noTask.status, 400)
  } finally {
    h.close()
  }
})

test('server: export 记忆包下载', async () => {
  const h = await startServer()
  try {
    const res = await fetch(`http://127.0.0.1:${h.port}/v1/ws/ws-alpha/export`, {
      headers: { Authorization: `Bearer ${h.token}` },
    })
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-disposition') ?? '', /attachment/)
    const pkg = (await res.json()) as { schema_version: number; workspace_id: string; nodes: unknown[] }
    assert.equal(pkg.schema_version, 1)
    assert.equal(pkg.workspace_id, 'ws-alpha')
    assert.equal(pkg.nodes.length, 3)
  } finally {
    h.close()
  }
})

test('server: 静态托管（SPA fallback + 防穿越）', async () => {
  const h = await startServer()
  const root = mkdtempSync(join(tmpdir(), 'mnc-static-'))
  const secretDir = mkdtempSync(join(tmpdir(), 'mnc-secret-'))
  try {
    writeFileSync(join(root, 'index.html'), '<html>console-entry</html>')
    mkdirSync(join(root, 'assets'))
    writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)')
    const { createConsoleServer: ccs } = await import('../src/server.js')
    const port = h.port + 500
    const handle = ccs({
      host: '127.0.0.1',
      port,
      token: h.token,
      catalog: new Catalog(h.root),
      staticDir: root,
    })
    await new Promise<void>((resolve) => handle.server.listen(port, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${port}`

    const entry = await fetch(`${base}/`)
    assert.equal(entry.status, 200)
    assert.match(await entry.text(), /console-entry/)

    const asset = await fetch(`${base}/assets/app.js`)
    assert.equal(asset.status, 200)
    assert.match(asset.headers.get('content-type') ?? '', /javascript/)

    // SPA 深链接回退
    const deep = await fetch(`${base}/ws/ws-alpha/nodes`)
    assert.equal(deep.status, 200)
    assert.match(await deep.text(), /console-entry/)

    // API 优先于静态：同前缀不冲突
    const api = await fetch(`${base}/v1/health`)
    assert.equal(api.status, 200)

    // 编码穿越：客户端 URL 会规范化 %2e%2e，用 node:http 原始路径实测服务端防御。
    // 断言「无泄露」：无论 403/404/SPA 回退，响应体绝不包含目标敏感文件内容。
    writeFileSync(join(secretDir, 'secret.txt'), 'TOPSECRET')
    const secretRel = encodeURIComponent(secretDir.split('/').pop() ?? '') + '/secret.txt'
    const { request: httpRequest } = await import('node:http')
    const rawGet = (path: string): Promise<{ status: number; body: string }> =>
      new Promise((resolve, reject) => {
        const r = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (resp) => {
          let body = ''
          resp.on('data', (c: Buffer) => (body += c.toString('utf8')))
          resp.on('end', () => resolve({ status: resp.statusCode ?? 0, body }))
        })
        r.on('error', reject)
        r.end()
      })
    const escape = await rawGet('/%2e%2e/' + secretRel)
    assert.ok([403, 404].includes(escape.status) || escape.body.includes('console-entry'))
    assert.ok(!escape.body.includes('TOPSECRET'))
    const escape2 = await rawGet('/..%2f..%2f' + secretRel)
    assert.ok(!escape2.body.includes('TOPSECRET'))
    const escape3 = await rawGet('/%252e%252e/' + secretRel)
    assert.ok(!escape3.body.includes('TOPSECRET'))

    handle.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(secretDir, { recursive: true, force: true })
    h.close()
  }
})

// ---- 会话 12：413 可达 / vendor 错误映射 / 静态畸形编码 / SSE 实时面 ----
test('session12: 413 可达客户端（先冲刷后断开，不再是连接重置）', async () => {
  const h = await startServer()
  try {
    const big = 'x'.repeat(1024 * 1024 + 64)
    const res = await fetch(`http://127.0.0.1:${h.port}/v1/ws/ws-alpha/progress`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${h.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: 't', patch: { summary: big } }),
    })
    assert.equal(res.status, 413, '超限请求必须收到 413（而非 UND_ERR_SOCKET）')
    const json = await res.json() as any
    assert.equal(json.error.code, 'PAYLOAD_TOO_LARGE')
  } finally {
    h.close()
  }
})

test('session12: vendor 错误映射——trail refs 未知节点 404（不再 500 泛滥）', async () => {
  const h = await startServer()
  try {
    const r = await h.call('POST', '/v1/ws/ws-alpha/trail', { run_id: 'rx', action: 'step', refs: ['n-nope'] })
    assert.equal(r.status, 404)
    assert.equal(r.json.error.code, 'NOT_FOUND')
  } finally {
    h.close()
  }
})

test('session12: 静态托管畸形编码/空字节返回 400（不再 URIError 500）', async () => {
  const h = await startServer()
  try {
    const root = mkdtempSync(join(tmpdir(), 'mnc-static-'))
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>c</title>')
    const { createConsoleServer } = await import('../src/server.js')
    const port = 28790 + Math.floor(Math.random() * 200)
    const handle = createConsoleServer({
      host: '127.0.0.1', port, token: h.token,
      catalog: new Catalog(h.root), staticDir: root,
    })
    await new Promise<void>((resolve) => handle.server.listen(port, '127.0.0.1', resolve))
    try {
      const raw = await fetch(`http://127.0.0.1:${port}/%zz`)
      assert.equal(raw.status, 400)
      const nul = await fetch(`http://127.0.0.1:${port}/%00`)
      assert.equal(nul.status, 400)
    } finally {
      handle.close()
      rmSync(root, { recursive: true, force: true })
    }
  } finally {
    h.close()
  }
})

test('session12: SSE 实时面——hello 即达；本机写入即时广播；外部写入经签名检测推送', async () => {
  const h = await startServer({ ssePollMs: 60 })
  try {
    const res = await fetch(`http://127.0.0.1:${h.port}/v1/events?token=${encodeURIComponent(h.token)}`, {
      headers: { Accept: 'text/event-stream' },
    })
    assert.equal(res.status, 200)
    assert.ok(String(res.headers.get('content-type')).includes('text/event-stream'))
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    // 带超时竞速的读：无数据到达时也能按截止时间退出（否则 await read 永挂）
    const readWithTimeout = (ms: number) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      return Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('read-stall')), ms)
        }),
      ]).finally(() => clearTimeout(timer))
    }
    const waitFor = async (event: string, timeoutMs = 5000): Promise<string> => {
      const t0 = Date.now()
      for (;;) {
        const idx = buf.indexOf(`event: ${event}\n`)
        if (idx >= 0) {
          const end = buf.indexOf('\n\n', idx)
          const block = buf.slice(idx, end >= 0 ? end + 2 : undefined)
          buf = buf.slice((end >= 0 ? end + 2 : buf.length))
          return block
        }
        if (Date.now() - t0 > timeoutMs) throw new Error(`等待事件 ${event} 超时；已收：${buf.slice(0, 200)}`)
        const { value, done } = await readWithTimeout(Math.max(200, timeoutMs - (Date.now() - t0)))
        if (done) throw new Error('SSE 提前关闭')
        buf += decoder.decode(value, { stream: true })
      }
    }
    // hello
    const hello = await waitFor('hello')
    assert.ok(hello.includes('"ok":true'))
    // 基线打底（≥2 个扫描周期）：签名检测的基线必须先于写入建立，
    // 否则写入会被吸收进首轮基线、永不触发事件（会话 15 实勘：旧实现靠
    // 每轮开库扰动 -shm 制造虚假发布风暴，恰好掩盖了这个时序假设）
    await new Promise((r) => setTimeout(r, 200))
    // 本机写入 → 即时广播
    await h.call('POST', '/v1/ws/ws-alpha/progress', { task_id: 'sse-t', patch: { status: 'doing', summary: '写面广播' } })
    const upd1 = await waitFor('workspace.updated')
    assert.ok(upd1.includes('ws-alpha'))
    // 排干本机写入的扫描回声（同一变更经即时广播 + 签名检测各发一次，前端去抖吞并）；
    // 静默期后清 buf，后续事件只可能来自外部直写检测
    await new Promise((r) => setTimeout(r, 250))
    buf = ''
    // 外部写入（直开 db 改文件）→ mtime/size 签名检测推送
    const alpha = join(h.root, 'ws-alpha')
    const ext = MemoryNet.open(alpha, { agentId: 'external', role: 'host', workspaceId: 'ws-alpha' })
    ext.add('observation', { key: 'tool:ext', text: '外部直写观测', source: 'tool' })
    ext.close()
    const upd2 = await waitFor('workspace.updated', 6000)
    assert.ok(upd2.includes('ws-alpha'))
    assert.ok(upd2.includes('"reason":"external"'), `外部直写事件应为 external（实际 ${upd2}）`)
    // 未认证 SSE 拒绝
    const noAuth = await fetch(`http://127.0.0.1:${h.port}/v1/events`)
    assert.equal(noAuth.status, 401)
    await noAuth.body?.cancel()
    reader.cancel().catch(() => {})
  } finally {
    h.close()
  }
})

// ---- 会话 15：P3 余量（405 语义 / 重复 id / 损坏库一致面 / 逗号 agent / CSP）----
test('session15: 动作已知方法不对 → 405 + Allow；HEAD /v1/health → 200 无响应体', async () => {
  const h = await startServer()
  try {
    const post = await h.call('POST', '/v1/ws/ws-alpha/stats', {})
    assert.equal(post.status, 405, `POST stats 应 405（实际 ${post.status}）`)
    assert.equal(post.json.error.code, 'METHOD_NOT_ALLOWED')
    assert.match(post.headers['allow'] ?? '', /GET/)

    const del = await h.call('DELETE', '/v1/ws/ws-alpha/nodes')
    assert.equal(del.status, 405)

    // HEAD health：探活免认证 + 无响应体
    const head = await fetch(`http://127.0.0.1:${h.port}/v1/health`, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')
  } finally {
    h.close()
  }
})

test('session15: 重复 workspace_id 以目录名强制区分（不再静默串统计）', async () => {
  const h = await startServer()
  try {
    // 两个目录 meta 同 workspace_id（复制库场景）
    for (const name of ['dup-first', 'dup-second']) {
      const d = join(h.root, name)
      mkdirSync(d, { recursive: true })
      const mn = MemoryNet.open(d, { agentId: 'x', role: 'host', workspaceId: 'ws-dup' })
      mn.add('tip', { text: `${name} 的独有内容` })
      mn.close()
    }
    const { Catalog: Cat } = await import('../src/catalog.js')
    const cat = new Cat(h.root)
    const summaries = cat.list()
    const dup = summaries.filter((w) => w.dir_name.startsWith('dup-'))
    assert.equal(dup.length, 2)
    // 首个占规范 id，其后以目录名寻址：两目录可分别到达，统计不串
    const ids = new Set(dup.map((w) => w.id))
    assert.ok(ids.has('ws-dup'), '首个目录保留规范 id')
    assert.ok(ids.has('dup-second'), '重复条目以目录名寻址')
    const first = cat.resolveEntry('ws-dup')
    assert.ok(first?.dir.endsWith('dup-first'))
    const second = cat.resolveEntry('dup-second')
    assert.ok(second?.dir.endsWith('dup-second'))
    // 语义面（activate）经目录名 id 亦可安全打开（规范 id 解析正确）
    const act = await h.call('POST', '/v1/ws/dup-second/activate', { query: '独有内容' })
    assert.equal(act.status, 200)
    assert.ok(act.json.nodes.some((n: any) => n.node.text.includes('dup-second')))
  } finally {
    h.close()
  }
})

test('session15: 损坏库一致面——list 标 unreadable，stats/nodes 503（不再静默计零 vs 500 混搭）', async () => {
  const h = await startServer()
  try {
    const corrupt = join(h.root, 'ws-corrupt')
    mkdirSync(corrupt, { recursive: true })
    writeFileSync(join(corrupt, 'memory.db'), '这不是一个 SQLite 文件……')

    const { Catalog: Cat } = await import('../src/catalog.js')
    const cat = new Cat(h.root)
    const entry = cat.list().find((w) => w.dir_name === 'ws-corrupt')
    assert.ok(entry, '损坏库仍在 list 中可见')
    assert.equal(entry?.unreadable, true, 'list 应显式标记 unreadable')
    assert.equal(entry?.nodes_total, 0)

    const stats = await h.call('GET', '/v1/ws/ws-corrupt/stats')
    assert.equal(stats.status, 503, `stats 应 503（实际 ${stats.status}）`)
    assert.equal(stats.json.error.code, 'WORKSPACE_UNREADABLE')
    const nodes = await h.call('GET', '/v1/ws/ws-corrupt/nodes')
    assert.equal(nodes.status, 503, 'nodes 与 stats 同语义（一致面）')
  } finally {
    h.close()
  }
})

test('session15: run 摘要 agent_id 含逗号不再解析错（JS 聚合替代 GROUP_CONCAT）', async () => {
  const h = await startServer()
  try {
    const d = join(h.root, 'ws-comma')
    mkdirSync(d, { recursive: true })
    const mn = MemoryNet.open(d, { agentId: 'agent,x', role: 'host', workspaceId: 'ws-comma' })
    mn.appendTrail('r-comma', { action: '步骤一' })
    mn.close()
    const { Catalog: Cat } = await import('../src/catalog.js')
    const cat = new Cat(h.root)
    const runs = cat.trailRuns('ws-comma')
    assert.equal(runs.length, 1)
    assert.deepEqual(runs[0]?.agents, ['agent,x'], '含逗号的 agent_id 必须保持完整')
  } finally {
    h.close()
  }
})

test('session15: 静态响应带 CSP + 入口 no-store / assets immutable', async () => {
  const h = await startServer()
  const root = mkdtempSync(join(tmpdir(), 'mnc-static15-'))
  try {
    writeFileSync(join(root, 'index.html'), '<html>entry15</html>')
    mkdirSync(join(root, 'assets'))
    writeFileSync(join(root, 'assets', 'app-abc123.js'), 'console.log(15)')
    const { createConsoleServer: ccs } = await import('../src/server.js')
    const port = 38790 + Math.floor(Math.random() * 200)
    const handle = ccs({ host: '127.0.0.1', port, token: h.token, catalog: new Catalog(h.root), staticDir: root })
    await new Promise<void>((resolve) => handle.server.listen(port, '127.0.0.1', resolve))
    try {
      const entry = await fetch(`${base15(port)}/`)
      assert.equal(entry.headers.get('content-security-policy'), "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
      assert.equal(entry.headers.get('cache-control'), 'no-store')
      await entry.text()
      const asset = await fetch(`${base15(port)}/assets/app-abc123.js`)
      assert.match(asset.headers.get('cache-control') ?? '', /immutable/)
      await asset.text()
    } finally {
      handle.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
    h.close()
  }
})

function base15(port: number): string {
  return `http://127.0.0.1:${port}`
}

test('session12: 语义面规范 id——别名 id（目录名 ≠ meta workspace_id）不再 500', async () => {
  const h = await startServer()
  try {
    // 目录改名场景：目录 dir-alias 内 meta workspace_id=ws-alias
    // 读面按目录名可达；语义面（activate）必须以规范 id 打开核心库
    const aliasDir = join(h.root, 'dir-alias')
    mkdirSync(aliasDir, { recursive: true })
    const alias = MemoryNet.open(aliasDir, { agentId: 'alias', role: 'host', workspaceId: 'ws-alias' })
    alias.updateProgress('alias-t1', { status: 'doing', summary: '别名工作区' })
    alias.close()

    // 修复前：withWorkspace 传 URL id（dir-alias）→ vendor WorkspaceError → 500
    const byDirName = await h.call('POST', '/v1/ws/dir-alias/activate', { query: '别名' })
    assert.equal(byDirName.status, 200, `别名 id 语义面应经规范 id 放行（实际 ${byDirName.status}）`)
    const byCanonical = await h.call('POST', '/v1/ws/ws-alias/activate', { query: '别名' })
    assert.equal(byCanonical.status, 200, '规范 id 语义面照常可用')
    // 未知名仍 404
    const nf = await h.call('POST', '/v1/ws/no-such-dir/activate', { query: 'x' })
    assert.equal(nf.status, 404)
  } finally {
    h.close()
  }
})
