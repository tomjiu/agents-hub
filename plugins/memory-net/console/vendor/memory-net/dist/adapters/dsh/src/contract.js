/**
 * dsh ctx 最小结构契约（本包自声明，零 import dsh/cordis）。
 *
 * 只描述本适配包实际用到的表面——dsh 内部任何重构都不影响本包；
 * dsh 升级若改了这些接缝，防御式探测（能力缺失 → 降级明示）兜底。
 *
 * 2026-09-10 对齐真实 dsh 0.1.2-rc.1（实勘 @deepseek-ai/dsh-system-prompt /
 * @deepseek-ai/dsh-tools / @deepseek-ai/cordis 类型与源码）：
 *  - PromptSection = { name, order, text }（name 唯一，重复注册宿主抛错；
 *    text 为 string 或 (context) => string——旧骨架的 id/render 均不存在）
 *  - ToolDefinition = ToolSchema(name/description/parameters) + output（必填！
 *    ToolOutputDefinition = { schema, render }）+ execute(args, exec) → canonical JSON
 *  - cordis 对 ctx 上的服务属性强制 inject 声明：未声明即访问抛
 *    `cannot get property "X" without inject`——插件模块必须静态导出
 *    inject = ['systemPrompt', 'tools', 'agents', 'workingDirectory']（上下文策略增加真实服务）。
 */
/** 运行时能力探测：ctx 上缺能力 → 返回人类可读原因（非 null = 降级）。 */
export function probeCtx(ctx) {
    if (ctx == null || typeof ctx !== 'object')
        return 'ctx 非对象（dsh 未按插件形态注入）';
    const c = ctx;
    if (typeof c.provide !== 'function')
        return 'ctx.provide 缺失（无法注册 memory-net 服务）';
    if (!c.tools || typeof c.tools.register !== 'function')
        return 'ctx.tools.register 缺失（无法注册记忆工具）';
    if (!c.systemPrompt || typeof c.systemPrompt.section !== 'function') {
        return 'ctx.systemPrompt.section 缺失（无法注入记忆区段）';
    }
    return null;
}
