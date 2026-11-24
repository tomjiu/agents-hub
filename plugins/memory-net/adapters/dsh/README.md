# dsh 适配包（真实 dsh 端到端验证通过）

把 memory-net（共享记忆网）接入 dsh（Cordis host）的适配插件。
已对 **真实 dsh 0.1.2-rc.1** 端到端验证（见文末冒烟）：插件加载 / 工具注册 / systemPrompt
区段注入 / 模型工具调用 / SQLite 落盘 / 宿主工具结果自动观测（auto-observe）全链路闭环。

## 候选提炼与宿主核验（依赖PR7，本分支未采用）

仅session模式提供memory_net_candidates和memory_net_propose：前者只列本范围候选摘要及来源事件ID，后者必须引用1..32个同范围active成功观测，生成pending推断。即使普通memory_net_write写inference也走同一提案路径，based_on必填。tip仍单独标为建议，不是核验事实；shared兼容模式旧inference写法不改变。

```js
const list = memory_net_candidates({query:"SQLite",limit:10});
memory_net_propose({text:"SQLite WAL方案候选",confidence:0.8,source_ids:["n1"]});
```

模型没有review工具。宿主用forAgent(exec.agent).reviewCandidate(id,{expected_fingerprint,decision:"accept"或"reject",reviewer,note,evidence})记录审核；evidence必须与原来源ID不同。提案时冻结来源摘要指纹，接受后才进入精选，并公开review_evidence和候选标签。上下文选择器依然拒绝；列表不代表准入。候选列表query按字面OR匹配，输出摘要截断且limit有界；内部仍扫描本范围节点，超大库性能尚未优化。

核验不自动执行外部指令，也不把工具成功当真相；宿主须实际判断证据是否支持候选，测试宿主只是合成fixture。没有自动模型总结器、人工核验UI或跨会话分享。库不迁移，旧用户数据/currentWeb不改，受损/过期回执退出精选，不自动改写原事实。

## 宿主上下文隔离（本分支候选，当前Web未采用）

默认context.mode=session。真实Agent必须与agents.get(session.id)相同；规范化当前目录和持久会话ID确定独立数据库。模型工具、提示和raw仅访问当前范围；workspace/run_id/task_id不再由模型选择，缺身份工具拒绝、提示为空、观测跳过，不回退共享库。

自动观测在tools/pre-execute按token捕获归属，结果仍写入原调用项目。host通过forAgent(exec.agent)获取能力；Agent替换、目录变化、插件关闭后旧能力拒绝。session ID用于run和session-context进度槽，不冒充业务任务。

```js
memory_net_write({kind:"tip",text:"当前项目决策"})
memory_net_recall({query:"决策"})
memory_net_recall({query:"read",view:"raw"})
```

旧共享模式需宿主明确context.mode=shared，保留workspace参数但无会话隔离。升级不自动读取或迁移旧main库；新库位于root/scoped-v1/p-项目哈希/s-会话哈希。切换cwd切换范围，路径别名realpath归一，同会话同目录恢复映射由契约测试覆盖，真实跨进程resume未验收。目录不是Git根，移动项目不自动继承。

适配边界不是OS沙箱：有任意文件/宿主工具仍能读取数据库。跨会话共享、业务任务绑定、候选提炼、版本绑定和脱敏后续实现。当前Web未采用本候选。

## 精选模式（shared兼容用法）

`recall.view`配置默认curated，作用于提示区段及memory_net_recall。工具传`view:"raw"`仅诊断本次调用，不改变后续注入；非法模式拒绝。核心host api.activate默认raw以兼容旧接口，显式传curated才精选。工具结果、失败证据仍自动落库；精选排除日志不是删除日志。

```js
memory_net_recall({query:"SQLite WAL",task_id:"task-A",view:"curated"})
memory_net_recall({query:"browser_open",view:"raw"})
```

没有task/run上下文时，其他任务进度不进入提示；需要该任务时显式recall。全局tip/已审阅推断仍按预算竞争，正文匹配不是语义正确性。输出含节点ID/based_on及精选排除统计，已审阅推断明确不是物理观测。旧自动观测、GC依据、workspace内容不被重写。宿主能力与真实模型上下文仍需独立验证，不能直接覆盖运行中包。

## 当前宿主验收

在agents-hub中新增 [跨平台真实宿主探针](../../../../asset-manager/DSH-HOST-ACCEPTANCE.md)，P0实装DSH 0.2.2-rc.1与隔离0.2.2-rc.5独立headless及新clone重复验证通过（旧rc.4记录为历史）：Memory-net工具与持久化、生成MCP bridge及部署Skill实际调用同时闭环。本地脚本化模拟模型、不动用户live profile、不下载或修改DSH。

ctx.effect可用时销毁自动关闭全部workspace；陈旧工具/事件不得重新打开。原0.1.2-rc.1记录是历史证据，不是全部新版本免验收保证。

## 设计红线与升级验收（接口变化必须重新验证）

1. **零 import dsh/cordis**：本包源码不 `import` 任何 dsh/cordis 模块——宿主以运行时形态传入
   `ctx`，本包只依赖 `src/contract.ts` 里**自己声明的最小结构契约**（structural typing）。
   这降低编译期耦合，但不保证运行契约兼容；服务、事件、工具输出接口变化必须重新跑真实宿主验证。
2. **严禁 fork / patch / 替换 dsh**：dsh 是 vendor、版本锁定、跟随官方上游更新。适配包只挂
   官方插件点（provide / tools.register / systemPrompt.section / 事件订阅 ctx.on）。升级前独立测试新版本，不能预设适配包零改动。防御式探测只能捕获已覆盖的缺失能力，签名和事件语义漂移仍需真实调用及落盘验证。
3. **写纪律由桥面强制**：模型（LLM）在本包内永远拿不到 observation 写路径——
   工具 `memory_net_write` 只暴露 inference/tip；`observe()` 只存在于 host 半区 API
   （`ctx.provide('memory-net')` 的 `observe`）与 auto-observe 桥（宿主事件监听，模型不可控）。
   本包维持写入白名单；仍需宿主隔离与真实验证，不能对任意新版DSH做安全保证。

## 与真实 dsh 契约的对齐点（2026-09-10 实勘 0.1.2-rc.1 定案）

| 接缝 | 真实契约（权威源） | 本包落点 |
|------|------------------|---------|
| 注入声明 | cordis 对 ctx 服务属性强制 `inject`，未声明访问即抛 `cannot get property "X" without inject` | 模块静态导出 `inject = ['systemPrompt', 'tools', 'agents', 'workingDirectory']` |
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

- **独立调用追加**：自动观测不设状态key；同工具读取不同文件或重复重验不会覆盖旧依据。工具名在payload.tool、调用标识在payload.call_id；不承诺跨重启事件去重。
- **显式状态观测**：宿主api.observe给出的subject key仍按核心规则覆盖；工具执行成功不等于事实变化或用户接受变更。追加会增加库大小与召回候选，预算与精选投影尚需后续改进；不默认清理或直接更新当前Web。
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
- E auto-observe：`mn_e2e_echo` 的执行结果被自动写为独立观测（key为空，payload.tool=`mn_e2e_echo`且含call_id）；`memory_net_*` 未被递归观测。文末2026-09历史验收使用旧tool-name key，不是当前行为证明。

2026-09-10 首验 PASS（dsh@0.1.2-rc.1，A/B1/B2/B3/C/D 全绿）；
2026-09-10 auto-observe 复验 PASS（A1/A2/B1/B2/B3/C/D/E1/E2 全绿）。
