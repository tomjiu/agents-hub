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
import { appendFileSync } from 'node:fs'

const port = Number(process.argv[2] ?? 8401)
const diagPath = process.argv[3] ?? 'requests.jsonl'
const WRITE_TEXT = 'E2E 模型经 memory_net_write 写入的推断节点'
const ECHO_ARGS = JSON.stringify({ say: 'hello auto-observe' })
const TOOL_ARGS = JSON.stringify({ kind: 'inference', text: WRITE_TEXT, confidence: 0.7 })

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
    const afterTool = last.role === 'tool'
    const diag = {
      ts: Date.now(),
      round: afterTool ? 'after_tool' : 'first',
      stream: j.stream === true,
      tool_count: toolNames.length,
      has_memory_net_write: toolNames.includes('memory_net_write'),
      has_memory_net_recall: toolNames.includes('memory_net_recall'),
      has_mn_e2e_echo: toolNames.includes('mn_e2e_echo'),
      has_constraint_section: body.includes('force push'),
      has_progress_section: body.includes('登录页'),
      has_inference_section: body.includes(WRITE_TEXT),
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
        ] })
        finish({}, 'tool_calls')
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
          ],
        }
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
        choices: [{ index: 0, message, finish_reason: afterTool ? 'stop' : 'tool_calls' }],
      }))
    }
  })
})

server.listen(port, '127.0.0.1', () => console.error(`mock-model] listening on 127.0.0.1:${port}`))
