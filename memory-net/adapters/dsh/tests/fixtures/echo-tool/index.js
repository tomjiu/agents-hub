/**
 * E2E 专用最小 dsh 工具插件（smoke-dsh-e2e.sh 的 auto-observe 断言依赖它）。
 *
 * 注册一个 mn_e2e_echo 工具：模型传 say → canonical 回 { echoed: say }。
 * 用途：产生一次「非 memory_net_* 的真实宿主工具执行」，让 memory-net 适配包的
 * auto-observe 桥（ctx.on 'tools/result'）在真实 dsh 里收到 emit 并写入观测——
 * 由此证明：cordis ctx.on 可达 + 事件分发可达插件 listener + 观测真实落 SQLite。
 *
 * 形态对齐真实 dsh 0.1.2-rc.1 契约（与 memory-net-dsh-adapter 同规约）：
 *   - 静态导出 inject（cordis 服务访问守卫）
 *   - 工具 def 必填 output（schema + render）
 *   - execute 返回 canonical JSON 值
 */
export const name = 'mn-e2e-echo-tool'

export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register({
    name: 'mn_e2e_echo',
    description: 'E2E 冒烟工具：原样返回 say 参数（用于验证宿主工具结果自动观测入网）。',
    parameters: {
      type: 'object',
      properties: {
        say: { type: 'string', description: '要回显的文本' },
      },
      required: ['say'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { echoed: { type: 'string' } },
        required: ['echoed'],
      },
      render: (_args, value) => [{ type: 'text', text: `echo: ${String((value ?? {}).echoed ?? '')}` }],
    },
    execute: (args) => ({ echoed: String((args ?? {}).say ?? '') }),
  })
}
