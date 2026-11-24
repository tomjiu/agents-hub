#!/usr/bin/env node
// memory-net dsh 适配包 E2E 用 mock OpenAI 兼容模型（脚本化两轮，带请求诊断）。
//
// 第 1 轮（末条消息非 tool）：检查 tools 列表并并行发起两个工具调用——
//   mn_e2e_echo（宿主真实工具，触发 auto-observe 的 tools/result 事件）
//   memory_net_write（记忆工具，模型写路径闭环）
// 第 2 轮（末条消息 role=tool）：把工具结果回显进最终回复（dsh stdout 可断言）
//
// 每个请求向诊断文件追加一行 JSON：
//   tool_count / has_memory_net_write / has_memory_net_recall / has_mn_e2e_echo —— 工具注册面
//   has_constraint_section / has_progress_section / has_inference_section —— 区段注入面
//   stream / round
// 用法：node mock-model.mjs <port> <diagnostics.jsonl>
import { createServer } from 'node:http'
import { appendFileSync, readFileSync } from 'node:fs'

const port = Number(process.argv[2] ?? 8401)
const diagPath = process.argv[3] ?? 'requests.jsonl'
const WRITE_TEXT = 'E2E 模型经 memory_net_write 写入的推断节点'
const ECHO_ARGS = JSON.stringify({ say: 'hello auto-observe' })
const TOOL_ARGS = JSON.stringify({ kind: 'inference', text: WRITE_TEXT, confidence: 0.7 })
// Optional actual-MCP host check; the original two-tool fixture remains the default.
const MCP_NAME = process.env.MN_E2E_MCP_TOOL
const SKILL_NAME = process.env.MN_E2E_SKILL
const SEARCH_NAME = process.env.MN_E2E_SEARCH_TOOL
const FETCH_NAME = process.env.MN_E2E_FETCH_TOOL
const MEMORY_P0 = process.env.MN_E2E_MEMORY_P0 === '1'
const CURATED = process.env.MN_E2E_CURATED === '1'
const TUN_FETCH = process.env.MN_E2E_TUN_FETCH === "1"
const PARALLEL_DISCOVERY = process.env.MN_E2E_PARALLEL_DISCOVERY === '1'
const SEARCH_ARGS = JSON.stringify({ query: process.env.MN_E2E_SEARCH_QUERY || 'aurora glacier', engines: ['searxng'], top_n: 3 })
const searchCall = { id: 'call_search_1', type: 'function', function: { name: SEARCH_NAME, arguments: SEARCH_ARGS } }
const SKILL_BODY = process.env.MN_E2E_SKILL_FILE ? readFileSync(process.env.MN_E2E_SKILL_FILE, 'utf8').split('---').slice(2).join('---').trim() : null
function strings(value) {
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); if (parsed && typeof parsed === 'object') return [value, ...strings(parsed)] } catch {}
    return [value]
  }
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings)
  return []
}
const extraCalls = [
  ...(MCP_NAME && (!SEARCH_NAME || PARALLEL_DISCOVERY) ? [{ id: 'call_mcp_1', type: 'function', function: { name: MCP_NAME, arguments: JSON.stringify({ query: 'engine health', limit: 1 }) } }] : []),
  ...(SEARCH_NAME ? [searchCall,{id:'call_search_quality_empty',type:'function',function:{name:SEARCH_NAME,arguments:JSON.stringify({query:'pasta carbonara',engines:['searxng'],no_cache:true})}}] : []),
  ...(FETCH_NAME ? [{id:"call_fetch_blocked",type:"function",function:{name:FETCH_NAME,arguments:JSON.stringify({url:"https://198.18.0.5/private"})}},...(TUN_FETCH?[{id:"call_fetch_tun",type:"function",function:{name:FETCH_NAME,arguments:JSON.stringify({url:"https://nodejs.org/docs/v26.13.1/api/sqlite.html",focus:"DatabaseSync deprecated alias",max_chars:16000})}}]:[])] : []),
  ...(SKILL_NAME ? [{ id: 'call_skill_1', type: 'function', function: { name: 'skill', arguments: JSON.stringify({ name: SKILL_NAME }) } }] : []),
]

const server = createServer((req, res) => {
  if (req.method !== 'POST' || !(req.url ?? '').includes('/chat/completions')) {
    res.writeHead(404).end()
    return
  }
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    let j = {}
    try { j = JSON.parse(body) } catch {}
    const messages = Array.isArray(j.messages) ? j.messages : []
    const toolNames = (j.tools ?? []).map((t) => t?.function?.name ?? t?.name).filter(Boolean)
    const last = messages[messages.length - 1] ?? {}
    const afterTool = SKILL_NAME ? messages.some((m) => m.role === 'tool') : last.role === 'tool'
    const messageStrings = strings(messages)
    const hasSearchResult = messageStrings.some((text) => text.includes('DSH-SEARCH-FIXTURE'))
    const hasSearchCache = messageStrings.some((text) => text.includes('DSH-SEARCH-FIXTURE') && /"from_cache"[ ]*:[ ]*true/.test(text))
    const repeatSearch = !!SEARCH_NAME && afterTool && hasSearchResult && !hasSearchCache
    const hasCall = id => messages.some(m => m.role === 'tool' && m.tool_call_id === id)
    const call = (id, name, args) => ({id,type:'function',function:{name,arguments:JSON.stringify(args)}})
    let p0Calls = []
    if (MEMORY_P0 && afterTool && !repeatSearch) {
      if (!hasCall('call_p0_seed')) p0Calls = [call('call_p0_seed','mn_e2e_provenance',{phase:'seed'})]
      else if (!hasCall('call_echo_3')) p0Calls = [call('call_echo_2','mn_e2e_echo',{say:'unrelated B'}),call('call_echo_3','mn_e2e_echo',{say:'hello auto-observe'})]
      else if (!hasCall('call_p0_check')) p0Calls = [call('call_p0_check','mn_e2e_provenance',{phase:'check'})]
      else if (!hasCall('call_p0_recall')) p0Calls = [call('call_p0_recall','memory_net_recall',{query:'MN-P0-REVIEWED-DECISION'})]
      else if (CURATED && !hasCall('call_curated')) p0Calls = [call('call_curated','memory_net_recall',{query:'hello auto-observe'})]
      else if (CURATED && !hasCall('call_raw')) p0Calls = [call('call_raw','memory_net_recall',{query:'hello auto-observe',view:'raw'})]
    }
    const memoryContext = messages.filter(m=>m.role==='user'&&strings(m.content).some(s=>s.includes('Current memory snapshot'))).at(-1)
    const prompt = strings(memoryContext?.content??[]).join('\n')
    const diag = {
      has_curated_prompt:CURATED&&prompt.includes('MN-CURATED-DURABLE-TIP')&&!prompt.includes('工具 mn_e2e_echo 成功')&&!prompt.includes(WRITE_TEXT)&&!prompt.includes('登录页'),
      has_curated_recall:messages.some(m=>m.role==='tool'&&m.tool_call_id==='call_curated'&&strings(m.content).some(s=>s.includes('[精选]')&&!s.includes('工具 mn_e2e_echo 成功'))),
      has_raw_recall:messages.some(m=>m.role==='tool'&&m.tool_call_id==='call_raw'&&strings(m.content).some(s=>s.includes('工具 mn_e2e_echo 成功'))),
      ts: Date.now(),
      round: afterTool ? 'after_tool' : 'first',
      stream: j.stream === true,
      tool_count: toolNames.length,
      has_memory_net_write: toolNames.includes('memory_net_write'),
      has_memory_net_recall: toolNames.includes('memory_net_recall'),
      has_mn_e2e_echo: toolNames.includes('mn_e2e_echo'),
      has_mcp_tool: MCP_NAME ? toolNames.includes(MCP_NAME) : false,
      has_search_tool: SEARCH_NAME ? toolNames.includes(SEARCH_NAME) : false,
      has_search_result: hasSearchResult,
      has_search_cache: hasSearchCache,
      has_fetch_blocked: messages.some(m=>m.role==='tool'&&m.tool_call_id==='call_fetch_blocked'&&/IP literal target forbidden|private address blocked/.test(JSON.stringify(m.content))),
      has_tun_fetch: messageStrings.some(text=>{try{const r=JSON.parse(text);return r?.transport?.mode==='trusted-tun'&&r.transport.remoteIpVerified===false&&/DatabaseSync/.test(JSON.stringify(r.segments??r.text))&&/deprecated/.test(JSON.stringify(r.segments??r.text));}catch{return false;}}),
      has_quality_candidate: messageStrings.some(text=>{try{const r=JSON.parse(text);return r?.meta?.quality?.policy==='lexical-evidence-v1'&&r.meta.quality.status==='candidate_results'&&r.refs.length>0;}catch{return false;}}),
      has_quality_empty: messageStrings.some(text=>{try{const r=JSON.parse(text);return r?.meta?.quality?.status==='no_relevant_results'&&r.refs.length===0&&r.meta.quality.rejected>0&&r.meta.degraded===true;}catch{return false;}}),
      has_explicit_selection: messageStrings.some(text => {try {const result=JSON.parse(text),selection=result?.meta?.engine_selection;return selection?.mode==='explicit'&&JSON.stringify(selection.requested)==='["searxng"]'&&result.meta.engines_used.every(name=>name==='searxng')&&result.meta.engines_failed.every(f=>f.name==='searxng')&&result.refs.every(ref=>ref.engines.every(name=>name==='searxng'));} catch{return false;}}),
      has_static_discovery: messageStrings.some((text) => /"disclosure"[ ]*:[ ]*"static"/.test(text)),
      search_result_diagnostics: SEARCH_NAME ? messages.filter((m) => m.role === 'tool' && (m.tool_call_id === 'call_search_1' || m.tool_call_id === 'call_search_cached')).map((m) => m.content) : undefined,
      has_skill_tool: SKILL_NAME ? toolNames.includes('skill') : false,
      has_loaded_skill: SKILL_BODY ? strings(messages).some((text) => text.replaceAll(String.fromCharCode(13), '').includes(SKILL_BODY.replaceAll(String.fromCharCode(13), ''))) : false,
      has_mcp_result: messages.some((m) => m.role === 'tool' && JSON.stringify(m.content).includes('newly_activated')),
      has_constraint_section: body.includes('force push'),
      has_progress_section: body.includes('登录页'),
      has_inference_section: body.includes(WRITE_TEXT),
      has_p0_checked: messages.filter(m => m.role === 'tool' && m.tool_call_id === 'call_p0_check').some(m => strings(m.content).some(text => {try{const v=JSON.parse(text);return v.phase==='check'&&v.independent===true&&v.promoted===true&&v.evidence_preserved===true}catch{return false}})),
      has_p0_recall: messages.some(m => m.role === 'tool' && m.tool_call_id === 'call_p0_recall' && strings(m.content).some(text => text.includes('MN-P0-REVIEWED-DECISION'))),
    }
    try { appendFileSync(diagPath, JSON.stringify(diag) + '\n') } catch {}
    console.error(`mock-model] ${JSON.stringify(diag)}`)

    const finish = (delta, reason) => {
      res.write(`data: ${JSON.stringify({
        id: 'chatcmpl-mn-e2e',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'mock-flash',
        choices: [{ index: 0, delta, finish_reason: reason ?? null }],
      })}\n\n`)
    }
    if (j.stream === true) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      if (!afterTool) {
        finish({ role: 'assistant', content: '' })
        finish({ tool_calls: [
          { index: 0, id: 'call_echo_1', type: 'function', function: { name: 'mn_e2e_echo', arguments: ECHO_ARGS } },
          { index: 1, id: 'call_mn_1', type: 'function', function: { name: 'memory_net_write', arguments: TOOL_ARGS } },
          ...extraCalls.map((call, i) => ({ index: i + 2, ...call })),
        ] })
        finish({}, 'tool_calls')
      } else if (repeatSearch) {
        finish({ role: 'assistant', content: '' })
        finish({ tool_calls: [{ index: 0, ...searchCall, id: 'call_search_cached' }] })
        finish({}, 'tool_calls')
      } else if (p0Calls.length) {
        finish({role:'assistant',content:''})
        finish({tool_calls:p0Calls.map((call,index)=>({index,...call}))})
        finish({},'tool_calls')
      } else {
        const toolResult = typeof last.content === 'string' ? last.content : JSON.stringify(last.content ?? '')
        finish({ role: 'assistant', content: '' })
        finish({ content: `MN-E2E-OK 工具结果回显: ${String(toolResult).slice(0, 300)}` })
        finish({}, 'stop')
      }
      res.write('data: [DONE]\n\n')
      res.end()
    } else {
      // 非 stream 形态（dsh 若以 stream:false 请求）
      let message
      if (!afterTool) {
        message = {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_echo_1', type: 'function', function: { name: 'mn_e2e_echo', arguments: ECHO_ARGS } },
            { id: 'call_mn_1', type: 'function', function: { name: 'memory_net_write', arguments: TOOL_ARGS } },
            ...extraCalls,
          ],
        }
      } else if (repeatSearch) {
        message = { role: 'assistant', content: null, tool_calls: [{ ...searchCall, id: 'call_search_cached' }] }
      } else if (p0Calls.length) {
        message = {role:'assistant',content:null,tool_calls:p0Calls}
      } else {
        const toolResult = typeof last.content === 'string' ? last.content : JSON.stringify(last.content ?? '')
        message = { role: 'assistant', content: `MN-E2E-OK 工具结果回显: ${String(toolResult).slice(0, 300)}` }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        id: 'chatcmpl-mn-e2e',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'mock-flash',
        choices: [{ index: 0, message, finish_reason: afterTool && !repeatSearch && !p0Calls.length ? 'stop' : 'tool_calls' }],
      }))
    }
  })
})

server.listen(port, '127.0.0.1', () => console.error(`mock-model] listening on 127.0.0.1:${port}`))
