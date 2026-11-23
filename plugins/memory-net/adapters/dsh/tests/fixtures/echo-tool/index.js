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

export const inject = ['tools', 'memory-net']

export function apply(ctx, config = {}) {
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
  if (config.provenance_p0 !== true) return
  let seeded
  ctx.tools.register({
    name: 'mn_e2e_provenance',
    description: 'Isolated P0 fixture: seed a reviewed decision, then check repeated tool evidence and GC.',
    parameters: {type:'object',properties:{phase:{type:'string',enum:['seed','check']}},required:['phase'],additionalProperties:false},
    output: {
      schema: {type:'object',properties:{phase:{type:'string'},decision_id:{type:'string'},independent:{type:'boolean'},promoted:{type:'boolean'},evidence_preserved:{type:'boolean'}},required:['phase','decision_id'],additionalProperties:false},
      render: (_args, value) => [{type:'text',text:JSON.stringify(value)}],
    },
    execute: (args) => {
      const api = ctx['memory-net']
      const echoes = api.exportPkg().nodes.filter(n => n.kind === 'observation' && n.payload.tool === 'mn_e2e_echo')
      if (args.phase === 'seed') {
        if (seeded || echoes.length !== 1) throw new Error('P0 seed requires exactly one prior echo')
        const decision = api.addInference({text:'MN-P0-REVIEWED-DECISION',confidence:.8,based_on:[echoes[0].id]})
        api.promote(decision.id,{evidence:[echoes[0].id],note:'Synthetic fixture review with explicit evidence, not a real user approval'})
        seeded = {decision_id:decision.id,evidence_id:echoes[0].id}
        return {phase:'seed',decision_id:decision.id}
      }
      if (args.phase !== 'check' || !seeded) throw new Error('P0 check requires seed')
      if (echoes.length !== 3 || !echoes.every(n => n.key === null && n.status === 'active')) throw new Error('Echo invocations overwritten')
      const decision = api.exportPkg().nodes.find(n => n.id === seeded.decision_id)
      if (decision?.status !== 'promoted') throw new Error('Repeated echo invalidated reviewed decision')
      api.demote(seeded.evidence_id,{reason:'Synthetic GC dependency preservation fixture'})
      api.gc({purge:true})
      const preserved = api.exportPkg().nodes.find(n => n.id === seeded.evidence_id)
      if (!preserved || !api.activate('MN-P0-REVIEWED-DECISION').nodes.some(r => r.node.id === decision.id)) throw new Error('Promoted recall or GC evidence lost')
      return {phase:'check',decision_id:decision.id,independent:true,promoted:true,evidence_preserved:true}
    },
  })
}
