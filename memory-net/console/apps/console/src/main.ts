/**
 * memory-net 控制台前端主逻辑（vanilla TS，零运行时依赖）。
 *
 * 布局：侧栏 workspace 列表 + 内容区四页签（节点 / 激活 / 轨迹 / 统计）+ 写面板。
 * 移动端：侧栏折叠为顶部横向选择器；远程（Tunnel 单域）与本地同一份代码。
 */
import { api, ApiError, getToken, setToken, openEvents, type MemoryNode, type WorkspaceSummary, type ActivationResult, type TrailEntry, type RunSummary, type WsStats } from './api.ts'
import './styles.css'

type Tab = 'nodes' | 'activate' | 'trail' | 'stats'

const KIND_LABEL: Record<string, string> = {
  constraint: '约束',
  observation: '观测',
  inference: '推断',
  progress: '进度',
  tip: '提示',
}

const STATUS_LABEL: Record<string, string> = {
  active: '有效',
  contradicted: '已推翻',
  superseded: '已覆盖',
  promoted: '已升级',
  demoted: '已降级',
}

function h(tag: string, cls?: string, text?: string): HTMLElement {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (text !== undefined) el.textContent = text
  return el
}

function fmtTime(ts: number | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function relTime(ts: number | null | undefined): string {
  if (!ts) return '—'
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

// ---- 应用状态 ----

let workspaces: WorkspaceSummary[] = []
let currentWs: string | null = null
let currentTab: Tab = 'nodes'
let nodeFilter = { kind: '', status: '', q: '' }
let statsCache: WsStats | null = null
// 节点分页（P3-13）：>50 节点的工作区后半部分可浏览；换工作区/改过滤时归零
const NODE_PAGE_SIZE = 50
let nodeOffset = 0

// ---- 根渲染 ----

const app = document.getElementById('app') as HTMLElement

function renderShell(): void {
  app.innerHTML = ''
  app.append(
    h('aside', 'sidebar'),
    h('main', 'content'),
  )
  const aside = app.querySelector('.sidebar') as HTMLElement
  aside.id = 'sidebar'
  aside.append(
    Object.assign(h('div', 'brand'), {
      innerHTML: '<span class="brand-mark">◆</span><span class="brand-name">memory-net <b>控制台</b></span>',
    }),
    h('div', 'ws-list', '加载中…'),
    h('button', 'btn-record', '+ 记录'),
  )
  const content = app.querySelector('.content') as HTMLElement
  content.append(
    renderHeader(),
    h('div', 'tabs'),
    h('div', 'page'),
  )
  renderTabs()
  ;(aside.querySelector('.btn-record') as HTMLButtonElement).addEventListener('click', openRecordModal)
}

function renderHeader(): HTMLElement {
  const bar = h('header', 'topbar')
  const status = h('div', 'conn-status', '未连接')
  status.id = 'conn-status'
  const btn = h('button', 'btn-token', 'Token')
  btn.addEventListener('click', openTokenModal)
  bar.append(h('div', 'ws-title', currentWs ?? '选择工作区'), status, btn)
  bar.id = 'topbar'
  return bar
}

function renderTabs(): void {
  const tabs = app.querySelector('.tabs') as HTMLElement
  tabs.innerHTML = ''
  const items: Array<{ id: Tab; label: string }> = [
    { id: 'nodes', label: '节点' },
    { id: 'activate', label: '激活' },
    { id: 'trail', label: '轨迹' },
    { id: 'stats', label: '统计' },
  ]
  for (const t of items) {
    const b = h('button', 'tab' + (currentTab === t.id ? ' tab-active' : ''), t.label)
    b.addEventListener('click', () => {
      currentTab = t.id
      renderTabs()
      void renderPage()
    })
    tabs.append(b)
  }
}

// ---- token 模态 ----

function openTokenModal(): void {
  closeModal()
  const m = h('div', 'modal-mask')
  const box = h('div', 'modal')
  box.append(h('h3', '', '访问令牌'))
  box.append(
    Object.assign(h('p', 'modal-hint'), {
      textContent: '家中服务器启动时输出（CONSOLE_TOKEN）。经 Tunnel 访问时与本地相同：填一次即可。',
    }),
  )
  const input = h('input', 'input') as HTMLInputElement
  input.type = 'password'
  input.placeholder = '粘贴 token…'
  input.value = getToken()
  const row = h('div', 'modal-row')
  const ok = h('button', 'btn primary', '保存并连接')
  const clear = h('button', 'btn', '清除')
  ok.addEventListener('click', () => {
    setToken(input.value.trim())
    closeModal()
    void boot()
  })
  clear.addEventListener('click', () => {
    setToken('')
    input.value = ''
  })
  row.append(ok, clear)
  box.append(input, row)
  m.append(box)
  m.addEventListener('click', (e) => {
    if (e.target === m) closeModal()
  })
  document.body.append(m)
  input.focus()
}

function closeModal(): void {
  document.querySelectorAll('.modal-mask').forEach((m) => m.remove())
}

// ---- 侧栏 workspace 列表 ----

async function renderSidebar(): Promise<void> {
  const list = app.querySelector('.ws-list') as HTMLElement
  try {
    const res = await api.workspaces()
    workspaces = res.workspaces
    list.innerHTML = ''
    if (workspaces.length === 0) {
      list.append(h('div', 'ws-empty', '未发现 workspace。CONSOLE_HOME 根目录下需有含 memory.db 的子目录。'))
      return
    }
    if (!currentWs || !workspaces.some((w) => w.id === currentWs)) {
      currentWs = workspaces[0]?.id ?? null
    }
    for (const w of workspaces) {
      const item = h('button', 'ws-item' + (w.id === currentWs ? ' ws-active' : ''))
      const name = h('div', 'ws-name', w.id)
      const meta = h('div', 'ws-meta', `${w.nodes_total} 节点 · ${w.trail_steps} 步 · ${relTime(w.last_activity)}`)
      item.append(name, meta)
      if (w.unreadable) {
        item.append(h('div', 'ws-unreadable', '⚠ 库不可读（损坏/非库文件）'))
      }
      item.addEventListener('click', () => {
        if (currentWs === w.id) return
        currentWs = w.id
        statsCache = null
        nodeOffset = 0
        updateTitle()
        void renderSidebar()
        void renderPage()
      })
      list.append(item)
    }
    updateConn('ok')
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      updateConn('unauth')
    } else {
      updateConn('down')
      list.innerHTML = ''
      list.append(h('div', 'ws-empty', '无法连接服务：' + (e as Error).message))
    }
  }
}

function updateConn(state: 'ok' | 'unauth' | 'down'): void {
  const el = document.getElementById('conn-status')
  if (!el) return
  el.className = 'conn-status conn-' + state
  el.textContent = state === 'ok' ? '已连接' : state === 'unauth' ? '需要 Token' : '连接失败'
}

function updateTitle(): void {
  const bar = document.getElementById('topbar')
  if (!bar) return
  const t = bar.querySelector('.ws-title')
  if (t) t.textContent = currentWs ?? '选择工作区'
}

// ---- 页面渲染 ----

async function renderPage(): Promise<void> {
  const page = app.querySelector('.page') as HTMLElement
  page.innerHTML = ''
  if (!currentWs) {
    page.append(h('div', 'empty-hint', '← 选择一个工作区'))
    return
  }
  if (currentTab === 'nodes') await renderNodes(page)
  else if (currentTab === 'activate') renderActivateForm(page)
  else if (currentTab === 'trail') await renderTrail(page)
  else await renderStats(page)
}

function kindBadge(kind: string): HTMLElement {
  const b = h('span', 'badge kind-' + kind, KIND_LABEL[kind] ?? kind)
  return b
}

function statusTag(status: string): HTMLElement {
  const s = h('span', 'tag status-' + status, STATUS_LABEL[status] ?? status)
  return s
}

function nodeCard(n: MemoryNode): HTMLElement {
  const card = h('div', 'node-card status-line-' + n.status)
  const head = h('div', 'node-head')
  head.append(kindBadge(n.kind), statusTag(n.status))
  if (n.conflict) head.append(h('span', 'tag status-contradicted', '冲突'))
  head.append(h('span', 'node-agent', '@' + n.agent_id))
  if (n.task_id) head.append(h('span', 'node-task', '#' + n.task_id))
  if (n.key) head.append(h('span', 'node-key', n.key))
  card.append(head)
  if (n.kind === 'progress' && typeof n.payload.summary === 'string') {
    card.append(h('div', 'node-text', String(n.payload.summary)))
    const extra = Object.entries(n.payload)
      .filter((pair) => pair[0] !== 'summary' && typeof pair[1] !== 'object')
      .map((pair) => `${pair[0]}=${String(pair[1])}`)
      .join(' · ')
    if (extra) card.append(h('div', 'node-payload', extra))
  } else {
    card.append(h('div', 'node-text', n.text))
    const keys = Object.keys(n.payload)
    if (keys.length > 0) {
      card.append(h('div', 'node-payload', JSON.stringify(n.payload)))
    }
  }
  if (n.confidence !== null) card.append(h('div', 'node-sub', `置信度 ${n.confidence}`))
  if (n.based_on.length > 0) card.append(h('div', 'node-sub', `based_on: ${n.based_on.join(', ')}`))
  card.append(h('div', 'node-time', fmtTime(n.updated_at)))
  return card
}

async function renderNodes(page: HTMLElement): Promise<void> {
  // 重渲染前清空容器：防抖后的重入若不清空，会叠加多套过滤条与陈旧节点列表。
  // 同时保留搜索框焦点与光标位置，避免清空后输入中断（移动端体验）。
  const refocus = document.activeElement instanceof HTMLInputElement
    && (document.activeElement as HTMLInputElement).classList.contains('filter-q')
  const sel = refocus ? (document.activeElement as HTMLInputElement).selectionStart : null
  page.innerHTML = ''
  // 过滤条
  const bar = h('div', 'filter-bar')
  const qInput = h('input', 'input filter-q') as HTMLInputElement
  qInput.placeholder = '搜索 text / key / agent / task…'
  qInput.value = nodeFilter.q
  const kindSel = h('select', 'select') as HTMLSelectElement
  for (const pair of Object.entries({ '': '全部类型', ...KIND_LABEL })) {
    const opt = h('option', '', pair[1]) as HTMLOptionElement
    opt.value = pair[0]
    kindSel.append(opt)
  }
  kindSel.value = nodeFilter.kind
  const statusSel = h('select', 'select') as HTMLSelectElement
  for (const pair of Object.entries({ '': '全部状态', ...STATUS_LABEL })) {
    const opt = h('option', '', pair[1]) as HTMLOptionElement
    opt.value = pair[0]
    statusSel.append(opt)
  }
  statusSel.value = nodeFilter.status
  let debounce: ReturnType<typeof setTimeout> | undefined
  const reload = () => {
    nodeFilter = { kind: kindSel.value, status: statusSel.value, q: qInput.value.trim() }
    nodeOffset = 0
    clearTimeout(debounce)
    debounce = setTimeout(() => void renderNodes(page), 250)
  }
  qInput.addEventListener('input', reload)
  kindSel.addEventListener('change', reload)
  statusSel.addEventListener('change', reload)
  bar.append(qInput, kindSel, statusSel)
  page.append(bar)
  if (refocus) {
    qInput.focus()
    if (sel !== null) qInput.setSelectionRange(sel, sel)
  }

  const listWrap = h('div', 'node-list', '加载中…')
  page.append(listWrap)
  try {
    const res = await api.nodes(currentWs as string, {
      kind: nodeFilter.kind || undefined,
      status: nodeFilter.status || undefined,
      q: nodeFilter.q || undefined,
      limit: NODE_PAGE_SIZE,
      offset: nodeOffset,
    })
    listWrap.innerHTML = ''
    const from = res.total === 0 ? 0 : res.offset + 1
    const to = res.offset + res.nodes.length
    const count = h('div', 'list-count', `${from}–${to} / 共 ${res.total} 个节点`)
    listWrap.append(count)
    if (res.nodes.length === 0) {
      listWrap.append(h('div', 'empty-hint', '没有匹配的节点'))
      return
    }
    for (const n of res.nodes) listWrap.append(nodeCard(n))
    // 分页控件（P3-13）：offset 已由服务端支持，UI 补齐翻页
    if (res.total > res.nodes.length || nodeOffset > 0) {
      const pager = h('div', 'pager')
      const prev = h('button', 'btn', '← 上一页') as HTMLButtonElement
      prev.disabled = nodeOffset <= 0
      prev.addEventListener('click', () => {
        nodeOffset = Math.max(0, nodeOffset - NODE_PAGE_SIZE)
        void renderNodes(page)
      })
      const next = h('button', 'btn', '下一页 →') as HTMLButtonElement
      next.disabled = res.offset + res.nodes.length >= res.total
      next.addEventListener('click', () => {
        nodeOffset = nodeOffset + NODE_PAGE_SIZE
        void renderNodes(page)
      })
      const pageIdx = Math.floor(nodeOffset / NODE_PAGE_SIZE) + 1
      const totalPages = Math.max(1, Math.ceil(res.total / NODE_PAGE_SIZE))
      pager.append(prev, h('span', 'pager-info', `第 ${pageIdx} / ${totalPages} 页`), next)
      listWrap.append(pager)
    }
  } catch (e) {
    listWrap.innerHTML = ''
    listWrap.append(h('div', 'empty-hint', '加载失败: ' + (e as Error).message))
  }
}

function renderActivateForm(page: HTMLElement): void {
  const wrap = h('div', 'activate-wrap')
  wrap.append(h('p', 'page-hint', '预算化激活演示：权重序 constraint 6 > observation 5 > progress 4 > tip 3 > inference 2；constraint 与当次 progress 永不裁光（frozen）。'))

  const form = h('div', 'activate-form')
  const qInput = h('input', 'input') as HTMLInputElement
  qInput.placeholder = '激活查询词（如：登录 OAuth 进度）'
  const mn = h('input', 'input input-num') as HTMLInputElement
  mn.type = 'number'
  mn.value = '24'
  mn.min = '1'
  mn.title = 'max_nodes'
  const mt = h('input', 'input input-num') as HTMLInputElement
  mt.type = 'number'
  mt.value = '2048'
  mt.min = '1'
  mt.title = 'max_tokens'
  const go = h('button', 'btn primary', '激活')
  const row = h('div', 'activate-row')
  row.append(qInput, h('label', 'num-label', '节点上限'), mn, h('label', 'num-label', 'token 上限'), mt, go)
  form.append(row)
  wrap.append(form)

  const result = h('div', 'activate-result')
  wrap.append(result)
  go.addEventListener('click', () => {
    const query = qInput.value.trim()
    if (!query || !currentWs) return
    result.textContent = '激活中…'
    api
      .activate(currentWs, {
        query,
        budgets: { max_nodes: Number(mn.value) || 24, max_tokens: Number(mt.value) || 2048 },
      })
      .then((r: ActivationResult) => renderActivateResult(result, r))
      .catch((e: Error) => (result.textContent = '激活失败: ' + e.message))
  })
  qInput.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') go.click()
  })
  page.append(wrap)
}

function renderActivateResult(box: HTMLElement, r: ActivationResult): void {
  box.innerHTML = ''
  const head = h('div', 'act-head')
  head.append(
    h('span', 'act-stat', `预算 ${r.budgets.max_nodes} 节点 / ${r.budgets.max_tokens} tokens`),
    h('span', 'act-stat', `使用 ${r.nodes.length} 节点 / ${r.tokens_used} tokens`),
    h('span', 'act-stat' + (r.nodes_dropped > 0 ? ' act-dropped' : ''), `裁掉 ${r.nodes_dropped}`),
  )
  box.append(head)
  for (const rn of r.nodes) {
    const row = h('div', 'act-row' + (rn.frozen ? ' act-frozen' : ''))
    const meta = h('div', 'act-meta')
    meta.append(
      h('span', 'act-weight', `w${rn.weight}`),
      kindBadge(rn.node.kind),
      statusTag(rn.node.status),
    )
    if (rn.frozen) meta.append(h('span', 'tag frozen-tag', '冻结'))
    if (rn.score !== null) meta.append(h('span', 'act-score', `score ${rn.score}`))
    meta.append(h('span', 'act-tokens', `${rn.tokens} tok`))
    row.append(meta, h('div', 'act-text', rn.node.text))
    box.append(row)
  }
  if (r.trail) {
    const t = h('div', 'act-trail', `轨迹摘要（run ${r.trail.run_id}，${r.trail.steps} 步，${r.trail.tokens} tok）：${r.trail.text}`)
    box.append(t)
  }
}

async function renderTrail(page: HTMLElement): Promise<void> {
  const wrap = h('div', 'trail-wrap')
  wrap.append(h('p', 'page-hint', '共享执行轨迹：按 run 有序，可回放/排障/复现。控制台可远程追加（宿主身份）。'))
  const runsBox = h('div', 'run-list', '加载中…')
  const entriesBox = h('div', 'trail-entries')
  wrap.append(h('div', 'trail-sub', 'Run 列表'), runsBox, h('div', 'trail-sub', '步骤'), entriesBox)
  page.append(wrap)
  try {
    const res = await api.runs(currentWs as string)
    runsBox.innerHTML = ''
    if (res.runs.length === 0) {
      runsBox.append(h('div', 'empty-hint', '暂无 run'))
    }
    for (const r of res.runs as RunSummary[]) {
      const row = h('button', 'run-item')
      row.append(
        h('span', 'run-id', r.run_id),
        h('span', 'run-meta', `${r.steps} 步 · ${r.agents.map((a) => '@' + a).join(' ')}`),
        h('span', 'run-time', fmtTime(r.last_ts)),
      )
      row.addEventListener('click', () => {
        document.querySelectorAll('.run-item.run-active').forEach((x) => x.classList.remove('run-active'))
        row.classList.add('run-active')
        void loadTrail(entriesBox, r.run_id)
      })
      runsBox.append(row)
    }
    await loadTrail(entriesBox, undefined)
  } catch (e) {
    runsBox.textContent = '加载失败: ' + (e as Error).message
  }
}

async function loadTrail(box: HTMLElement, runId?: string): Promise<void> {
  box.textContent = '加载中…'
  try {
    const res = await api.trail(currentWs as string, runId)
    box.innerHTML = ''
    if (res.entries.length === 0) {
      box.append(h('div', 'empty-hint', '暂无步骤'))
      return
    }
    for (const t of res.entries as TrailEntry[]) {
      const row = h('div', 'trail-row')
      row.append(
        h('span', 'trail-seq', `#${t.seq}`),
        h('span', 'trail-agent', '@' + t.agent_id),
        h('span', 'trail-action', t.action + (t.compressed ? '（已压缩）' : '')),
        h('span', 'trail-time', fmtTime(t.ts)),
      )
      box.append(row)
    }
  } catch (e) {
    box.textContent = '加载失败: ' + (e as Error).message
  }
}

async function renderStats(page: HTMLElement): Promise<void> {
  const wrap = h('div', 'stats-wrap')
  wrap.append(h('p', 'page-hint', '工作区画像：节点构成、状态分布、agent 参与度——auto-observe 观测质量的直观窗口。'))
  const body = h('div', 'stats-body', '加载中…')
  wrap.append(body)
  page.append(wrap)
  try {
    const s = await api.stats(currentWs as string)
    statsCache = s
    body.innerHTML = ''
    const cards = h('div', 'stat-cards')
    cards.append(statCard('节点总数', String(s.nodes_total)))
    cards.append(statCard('轨迹步数', String(s.trail_steps)))
    cards.append(statCard('Run 数', String(s.trail_runs)))
    cards.append(statCard('最近活动', relTime(s.last_activity)))
    body.append(cards)
    body.append(bars('按类型', s.by_kind, 'kind'))
    body.append(bars('按状态', s.by_status, 'status'))
    body.append(bars('按 agent', s.by_agent, 'agent'))
  } catch (e) {
    body.textContent = '加载失败: ' + (e as Error).message
  }
}

function statCard(label: string, value: string): HTMLElement {
  const c = h('div', 'stat-card')
  c.append(h('div', 'stat-value', value), h('div', 'stat-label', label))
  return c
}

function bars(title: string, data: Record<string, number>, flavor: string): HTMLElement {
  const wrap = h('div', 'bars')
  wrap.append(h('div', 'bars-title', title))
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1])
  const max = Math.max(1, ...entries.map((x) => x[1]))
  if (entries.length === 0) {
    wrap.append(h('div', 'empty-hint', '（空）'))
    return wrap
  }
  for (const pair of entries) {
    const row = h('div', 'bar-row')
    const label = KIND_LABEL[pair[0]] ?? STATUS_LABEL[pair[0]] ?? pair[0]
    row.append(h('span', 'bar-label', label))
    const track = h('div', 'bar-track')
    const fill = h('div', `bar-fill bar-${flavor}`)
    fill.style.width = `${Math.round((pair[1] / max) * 100)}%`
    track.append(fill)
    row.append(track)
    row.append(h('span', 'bar-n', String(pair[1])))
    wrap.append(row)
  }
  return wrap
}

// ---- 记录模态（受控写面）----

function openRecordModal(): void {
  if (!currentWs) {
    alert('先选择一个工作区')
    return
  }
  closeModal()
  const m = h('div', 'modal-mask')
  const box = h('div', 'modal')
  box.append(h('h3', '', `记录到 ${currentWs}`))
  box.append(
    Object.assign(h('p', 'modal-hint'), {
      textContent: '以宿主（console）身份写入：家中 agent 下一次 activate 即可见。写纪律不涉 UI——观测层仍仅宿主/工具桥可达。',
    }),
  )

  const secP = h('div', 'record-sec')
  secP.append(h('div', 'record-title', '进度（同 task 单行共享，多人协作核心）'))
  const taskInput = h('input', 'input') as HTMLInputElement
  taskInput.placeholder = 'task_id（如 build-login）'
  const sumInput = h('input', 'input') as HTMLInputElement
  sumInput.placeholder = '摘要（如：回调修复 80%，待联调）'
  const stSel = h('select', 'select') as HTMLSelectElement
  for (const st of ['doing', 'done', 'blocked', 'todo']) {
    const opt = h('option', '', '状态: ' + st) as HTMLOptionElement
    opt.value = st
    stSel.append(opt)
  }
  const btnP = h('button', 'btn primary', '写入进度')
  secP.append(taskInput, stSel, sumInput, btnP)

  const secT = h('div', 'record-sec')
  secT.append(h('div', 'record-title', '轨迹（run 内有序步骤）'))
  const runInput = h('input', 'input') as HTMLInputElement
  runInput.placeholder = 'run_id（如 r1）'
  const actInput = h('input', 'input') as HTMLInputElement
  actInput.placeholder = '做了什么（如：远程复核日志，确认无异常）'
  const btnT = h('button', 'btn primary', '追加轨迹')
  secT.append(runInput, actInput, btnT)

  btnP.addEventListener('click', () => {
    const taskId = taskInput.value.trim()
    const summary = sumInput.value.trim()
    if (!taskId || !summary) {
      alert('task_id 与摘要必填')
      return
    }
    api
      .writeProgress(currentWs as string, { task_id: taskId, patch: { status: stSel.value, summary } })
      .then(() => {
        closeModal()
        statsCache = null
        void renderSidebar()
        if (currentTab === 'nodes' || currentTab === 'stats') void renderPage()
      })
      .catch((e: Error) => alert('写入失败: ' + e.message))
  })
  btnT.addEventListener('click', () => {
    const runId = runInput.value.trim()
    const action = actInput.value.trim()
    if (!runId || !action) {
      alert('run_id 与动作必填')
      return
    }
    api
      .writeTrail(currentWs as string, { run_id: runId, action })
      .then(() => {
        closeModal()
        void renderSidebar()
        if (currentTab === 'trail') void renderPage()
      })
      .catch((e: Error) => alert('写入失败: ' + e.message))
  })

  box.append(secP, secT)
  m.append(box)
  m.addEventListener('click', (e) => {
    if (e.target === m) closeModal()
  })
  document.body.append(m)
  taskInput.focus()
}

// ---- 启动 ----

async function boot(): Promise<void> {
  renderShell()
  await renderSidebar()
  await renderPage()
  // v1.1 实时刷新：家中 agent 直写记忆网（外部写入）或本机写入时自动重渲染。
  // 合并突发事件（250ms 去抖）；activate 表单页有输入态，不自动重渲染以免丢输入。
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  openEvents({
    onUpdate: (wsId) => {
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        void renderSidebar()
        if (wsId === currentWs && currentTab !== 'activate') void renderPage()
      }, 250)
    },
    onState: (state) => {
      const el = document.getElementById('conn-status')
      if (!el) return
      if (state === 'live') {
        el.className = 'conn-status conn-live'
        el.textContent = '实时同步中'
      } else if (el.textContent === '实时同步中') {
        el.className = 'conn-status conn-ok'
        el.textContent = '已连接'
      }
    },
  })
}

void boot()
