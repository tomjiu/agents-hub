# dsh 适配包（真实 dsh 端到端验证通过）

把 memory-net（共享记忆网）接入 dsh（Cordis host）的适配插件。
已对 **真实 dsh 0.1.2-rc.1** 端到端验证（见文末冒烟）：插件加载 / 工具注册 / systemPrompt
区段注入 / 模型工具调用 / SQLite 落盘 / 宿主工具结果自动观测（auto-observe）全链路闭环。

## 设计红线（为什么 dsh 上游更新不用改这里）

1. **零 import dsh/cordis**：本包源码不 `import` 任何 dsh/cordis 模块——宿主以运行时形态传入
   `ctx`，本包只依赖 `src/contract.ts` 里**自己声明的最小结构契约**（structural typing）。
   dsh 内部重构（改文件布局/内部类型）不影响本包编译与运行。
2. **严禁 fork / patch / 替换 dsh**：dsh 是 vendor、版本锁定、跟随官方上游更新。适配包只挂
   官方插件点（provide / tools.register / systemPrompt.section / 事件订阅 ctx.on），升级 dsh =
   换 vendor 版本，适配包零改动（若官方插件点契约变化，本包在 `apply` 时**防御式探测并降级明示**，不崩宿主）。
3. **写纪律由桥面强制**：模型（LLM）在本包内永远拿不到 observation 写路径——
   工具 `memory_net_write` 只暴露 inference/tip；`observe()` 只存在于 host 半区 API
   （`ctx.provide('memory-net')` 的 `observe`）与 auto-observe 桥（宿主事件监听，模型不可控）。
   dsh 升级无论怎么改，这条硬边界都由本包代码保证，不依赖 dsh 行为。

## 与真实 dsh 契约的对齐点（2026-09-10 实勘 0.1.2-rc.1 定案）

| 接缝 | 真实契约（权威源） | 本包落点 |
|------|------------------|---------|
| 注入声明 | cordis 对 ctx 服务属性强制 `inject`，未声明访问即抛 `cannot get property "X" without inject` | 模块静态导出 `inject = ['systemPrompt', 'tools']` |
| 区段 | `PromptSection = { name, order, text }`（dsh-system-prompt；name 唯一，text 为 string 或 `(context)=>string`） | `ctx.systemPrompt.section({ name: 'memory-net', order, text })` |
| 工具 | `ToolDefinition = ToolSchema + output（必填 ToolOutputDefinition{schema,render}）+ execute(args,exec)→canonical JSON`（dsh-tools） | 两工具均带 `output`；execute 返回满足 schema 的 canonical 值，拒绝路径抛 Error |
| 包入口 | cordis 经 profile node_modules 按 bare name `import(包名)` | `package.json` 声明 `main: dist/adapters/dsh/src/index.js` |
| 事件订阅 | `ctx.on(name, listener)`（cordis 事件总线方法，混合在 ctx 上，非服务属性——无需 inject 声明）；dsh-tools 对每次工具 dispatch 终态 emit `tools/result`（exec, result），listener 失败被宿主 containment（notifyResult try/catch + Promise 兜底） | auto-observe 桥：`ctx.on('tools/result', ...)` 被动观测，写入前全 try/catch 自我隔离（双保险） |

工具 canonical 值：`memory_net_recall → { text }`（text=激活渲染文本）；
`memory_net_write → { saved: true, id, kind, workspace }`（render 输出 `memory saved: …` 摘要行）。

## 角色映射

| memory-net 角色 | 谁持有 | 写权限 |
|------|--------|--------|
| `host` | 宿主代码（`provide('memory-net')` 返回的 api） | 全部（含 constraint/observation） |
| `tool` | 工具桥 = auto-observe（宿主事件监听自动写；也可宿主代码手动 `api.observe()`） | observation/progress/trail |
| `model` | 模型工具（`memory_net_write` / `memory_net_recall`） | 仅 inference/tip + 按预算 activate |

## auto-observe：宿主工具结果自动入网（默认开）

接缝 = dsh-tools 注册表的 `tools/result` emit 事件：每次工具 dispatch 终态（成功/失败、
冻结无损 JSON）都会通知 listener，失败被宿主 containment（不改变工具结果、不外溢）。
本包订阅后把**非记忆类宿主工具**的执行结果自动写为 observation——模型无需、也不可
伪造观测（写纪律不变：observation 只由宿主路径写入）。

- **key 语义 = 状态观测**（`tool:<名>`）：同工具最新结果覆盖旧观测，并自动 contradict
  基于旧观测的 active 推断（memory-net 核心 store 的既有覆盖语义）——工具结果变化即现实变化
- **文本形态**：`工具 <名> 成功·args(<参数摘要>)→ <结果摘要>`；失败为 `…失败·…`
- **自指过滤**：`memory_net_*` 自身的结果不入网（防自指噪声）
- **嵌套过滤**：`exec.parent` 存在（嵌套 dispatch，如 code-mode 子调用）默认不观察；
  字段缺失 fail-open（视为根调用照常观察）——形态漂移时宁多勿漏
- **三重防线**：dsh 侧 containment（实勘 notifyResult）→ 本包 listener 全 try/catch +
  warn 计数（前 3 次可见）→ buildObservation 纯函数无 IO 先过滤全部不产生观测的形态

配置（cordis.patch.yml 行 config，全部有默认）：

```yaml
auto_observe:
  enabled: true          # false = 不订阅事件（其余接缝不受影响）
  max_chars: 2000        # 结果摘要截断（字符）
  args_chars: 200        # 参数摘要截断（字符）
  include_error: true    # 失败结果也入网（失败是同样有价值的协作事实）
  include_nested: false  # 嵌套 dispatch 也入网
```

防御式降级：`ctx.on` 缺失（事件总线不可达）时自动观测软降级关闭并明示 warn——其余接缝照常挂载。

## 安装（dsh profile cordis.patch.yml 形态）

1) 适配包进入 profile 解析锚点（out-of-tree 包经 node_modules symlink）：

```bash
mkdir -p "$DSH_HOME/profiles/<profile>/node_modules"
ln -sfn /path/to/memory-net/adapters/dsh \
  "$DSH_HOME/profiles/<profile>/node_modules/memory-net-dsh-adapter"
```

2) patch 层注册（`--patch <文件>` 或 profile cordis.patch.yml）：

```yaml
- insert:
    - id: kokoa-memory-net
      name: memory-net-dsh-adapter
      config:
        enabled: true
        workspaces_root: "${KOKOA_STATE_DIR}/memory-net"  # 运行时展开（函数形态 replacer）
        default_workspace: kokoa-main
        agent_id: dsh-main
        budgets: { max_nodes: 24, max_tokens: 2048 }
        inject: { section_order: 90 }
        tools: { recall: true, write: true, max_obs_chars: 4000 }
        auto_observe: { enabled: true, max_chars: 2000, args_chars: 200 }
```

构建前置：根包与适配包各需一次 `npm run build`（适配包 tsconfig 把根 `src/` 一并编译进
自身 dist——引用非复制，dsh 核心零接触）；Node ≥ 22.5（node:sqlite）。

## 测试

```bash
npm test                          # mock ctx 契约测试 17 项——不依赖真实 dsh；dsh 升级后重跑即知兼容性
bash scripts/smoke-dsh-e2e.sh     # 真实 dsh headless 端到端冒烟（依赖 npx 拉取钉扎版 dsh，不进 CI）
```

mock ctx 契约测试即兼容性锁：它锁的是「本包对 ctx 契约面的全部假设」（含 inject 导出、
output 必填、name/text 区段形态）——dsh 升级后若官方契约破坏了这些假设，重跑测试会红灯，
且失败点就是接缝处。

### 真实 dsh 冒烟（smoke-dsh-e2e.sh）

mock OpenAI 兼容模型（脚本化两轮：第一轮并行发起 `mn_e2e_echo`（宿主真实工具，E2E 专用
最小插件）+ `memory_net_write` 工具调用，第二轮把工具结果回显进最终回复）+ 钉扎
`dsh --profile headless`。断言五件事：

- A 工具注册：`memory_net_*` 与 `mn_e2e_echo` 出现在模型请求 `tools` 列表（插件真实加载）
- B 区段注入：宿主预置约束/进度进 system prompt；工具写入的推断进工具后重组装
- C 调用闭环：模型 → 工具 → canonical 结果 → 最终回复
- D 持久化：模型写入的 inference 落 workspace `memory.db`（node:sqlite 只读核验）
- E auto-observe：`mn_e2e_echo` 的执行结果被自动写为观测（key=`tool:mn_e2e_echo`，
  payload 含 call_id）；且 `memory_net_*` 未被递归观测（自指过滤真实生效）

2026-09-10 首验 PASS（dsh@0.1.2-rc.1，A/B1/B2/B3/C/D 全绿）；
2026-09-10 auto-observe 复验 PASS（A1/A2/B1/B2/B3/C/D/E1/E2 全绿）。
