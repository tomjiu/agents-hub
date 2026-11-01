# WorkBuddy · 工作流与架构

> **一句话**：WorkBuddy 是三层套娃架构（桌面壳 → 守护进程 → agent 内核），提示词不是写死的而是**模板拼装**的，台前一个主 agent、幕后 9 个隐形小 agent——把"办公自动化"做成了流水线。

## 背景

腾讯 CodeBuddy 团队的 AI 工作端（Manus 式）。Electron 壳和 agent 内核（CodeBuddy CLI）版本独立，可以分开热更。这次拆了 772MB 的 asar，大部分 JS 是可读的。

## 三层架构

```
Electron 桌面（界面 + 预览器：PPT/PDF/表格都能内嵌显示）
   │ spawn（独立进程）
workbuddy-server 守护进程（会话管理、预热池、孤儿回收）
   │ ACP 协议（Agent Client Protocol，一种标准化的"客户端指挥 agent"协议）
CodeBuddy CLI agent 内核
   │ HTTPS + 一组自定义请求头
腾讯云端（大模型网关 + 搜索服务 + 记忆服务）
```

两个值得注意的工程点：

1. **桌面不信任内核**：通过一排环境变量接管内核的自主行为（禁用内核的定时任务、禁用自动记忆、接管技能目录……）。"壳管配置、内核只干活"，职责切干净。
2. **自定义请求头协议**：每次请求带 `X-Conversation-ID / X-Agent-Intent（当前是问还是干还是计划）/ X-Agent-Type / X-Trace-ID`——服务端靠这些头就知道"这是哪个会话、哪个 agent、什么模式在说话"。做多 agent 遥测时照抄这组头就够。

## 提示词是拼装出来的，不是写死的

提示词不是一大段硬编码，而是 **nunjucks 模板 + 片段库**：

- 三种"胶囊"（code/work/design）做根模板；
- 四种交互模式（ask 问答 / craft 干活 / plan 计划 / expert 专家）各有一组片段，按会话开关拼进去；
- plan 模式的 agent 循环明确 7 步：分析 → 思考 → 选工具 → 沙箱执行 → 收结果 → 迭代 → 交付（交付时必须把藏在折叠的工具调用里的结果带出来——防"结果丢失在中间步骤"）。

## 隐形小 agent（9 个）

工具枚举里混着一串不起眼的名字，它们是幕后小工：

```
compact（压缩）、contextSummary（上下文摘要）、contentAnalyzer（内容提炼）、
autoModeClassifier（自动审批分类）、terminalTitleGenerator（起标题）、
summaryGenerator、memorySelector（记忆挑选）、fork、general-purpose
```

分工逻辑：凡是"又高频又不需要大模型"的活（起标题、判断这段网页要不要细读、判断这次工具调用该不该放行），全部派给小 agent。主对话上下文里只出现它们的产出，不出现它们的过程。

## 记忆三层（防"记忆垃圾场"的设计）

| 层 | 位置 | 规则 |
|----|------|------|
| 云端画像 | 服务端生成，只读，会话开始注入 | 隐式记忆，用户碰不到 |
| 用户显式 | `~/.workbuddy/MEMORY.md` | 每会话 4k 字符上限 |
| 工作区日志 | `.workbuddy/memory/日期.md` | **只追加**；30 天以上的旧日志按主题蒸馏进 MEMORY.md 后删除 |

"定期蒸馏 + 删除"是关键——日志只追加会无限膨胀，蒸馏保证记忆永远是最新的浓缩版。

## 其他

- 权限：**auto 模式 = AI 审批**（两阶段分类器判定工具调用放行与否，连续拒绝次数有熔断）；
- 团队（Teams）：TeamCreate/SendMessage，最多 20 个会话互发消息，正式队员不受队长的"一键取消"误伤；
- 安全栈最重：Windows 沙箱 44MB、反作弊 SDK、设备指纹、威胁域名库（详见搜索专题）。

## 值得我们抄的清单

| 抄什么 | 为什么 |
|--------|--------|
| 请求头协议（X-Conversation-ID/X-Agent-Intent...） | 我们自己的编排层要遥测时直接照抄 |
| 隐形小 agent 分工表 | "哪些活派给小模型"的现成清单 |
| 记忆三层 + 30 天蒸馏删除 | 长期记忆不膨胀的可行方案 |
| plan 模式 7 步循环 + "交付必须带出中间结果" | 防结果丢失在折叠的工具调用里 |

## 证据指路

- 原始报告：`reports/07-workbuddy.md`（§1 架构 / §2 工作流 / §6 上下文）
- 硬证据：`analysis/workbuddy/code/resources/plugins/workbuddy-builtin/`（模板与片段）、`cli/dist/codebuddy.js`（ToolNames 枚举、autoModeClassifier）、`main/cli-prewarm-pool.js`（环境变量协议）
