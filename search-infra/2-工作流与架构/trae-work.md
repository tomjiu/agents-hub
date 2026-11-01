# Trae Work (SOLO) · 工作流与架构

> **一句话**：字节的 SOLO 把 agent 从 JavaScript 搬进了 Rust 原生二进制，然后用一个 305 字节的 shell 脚本解决了所有产品都头疼的问题——**长任务干着干着，AI 把最重要的原始需求文档"忘"了怎么办**。

## 背景

Trae Work（产品名 TRAE SOLO）是字节跳动 SOLO 模式的 AI 工作端。Electron 只负责界面，真正的 agent 是 275MB 的 Rust 二进制（ai_agent.dll），通过本地 socket 40005 端口挂进来。这次靠 strings 提取 + 包内明文文件复原了大部分机制。

## 三个招牌机制

### 1. checkpoint.sh（上下文保真，305 字节的巧思）

安装包里有个 305 字节的脚本，全文就一句话：

> "自问自答：当前我的上下文里还有没有 RFC 全文（完整原版，而不是压缩摘要、截断等）？如果没有，请重新阅读原 RFC。并且下次调用任意工具之前，都需要重新执行这个脚本 ./checkpoint.sh。"

妙在哪：**它不是代码，是给模型看的协议**。SOLO 模式的任务动辄几十轮，中途压缩难免把原始需求（RFC）挤成摘要；摘要一旦有偏差，后面全歪。这个脚本让模型在每次调工具前都被迫重新自检一遍"原始文档还在不在我的脑子里"。用"可执行的提醒"替代了 prompt 里一句"不要忘记"——后者模型看一次就忘了，前者每次调工具都会重新注入一次。

### 2. Ralph Loop（循环到做完为止）

SOLO 的工作结构是三层：**规格文档（RFC）→ Ralph 循环轮次 → 每个计划项验收**。

- 模型自主循环干活，但每次想停，一个叫 RalphLoopStopHook 的钩子会判断"真做完了吗"——没做完就强制下一轮（和 Codex 的 Stop hook 同一思路）；
- 每个 plan_item（计划条目）执行完有独立的 reviewer（审查员）签字，审查决策有专门的日志；
- 计划状态做了内存快照，中断/恢复后可以完整重建。

### 3. 多 agent 父子树

不是固定分工的多角色编排，而是**主 agent 按需拉子 agent**：`run_agent` 工具派生子公司，父子关系（root/parent/child/hand_over）全程记录，事件流有 AgentIdle/AgentWakeup/AgentResume/SubAgentFinish——像一套轻量的"人员调度系统"。

## 上下文工程四分法（Trae 拆得最清楚的一套）

| 四大件 | Trae 的实现 | 人话 |
|--------|------------|------|
| 预算 | Compact 是个**工具**（模型自主发起），配合压缩服务 | 省空间 |
| 保真 | checkpoint.sh + 快照三段落盘 | 关键文档不许失真 |
| 权限 | `contextReadScope: "restore_1to1_minimal"`——恢复任务只许读最小证据集 + forbiddenReads 禁读清单 | 按任务类型规定"能读什么" |
| 记忆 | 三层：核心记忆（manage_core_memory 工具）/ 浅记事本（condense_shallow_memento）/ 摘要压缩 | 分层存放，各管一段 |

"读域权限"这个概念是全场独一份：上下文管理从"省钱"进化到了"按任务定义允许读什么"。

## 其他值得注意的工程事实

- 工具清单**三套并存**（内部 snake_case → 模型面向 PascalCase → V3 后缀变体），工具层至少重构过两次，兼容债留在明面上；
- 30+ 浏览器工具（browser_navigate/click/fill_form/录制回放……），SOLO"接管电脑"的底气在这；
- 会话可"复活"：换机重开，连 MCP 配置一起还原；最坏情况整个 agent 状态（含数据库）可一键重置。

## 值得我们抄的清单

| 抄什么 | 为什么 |
|--------|--------|
| checkpoint 思想：关键源文档 + 抓取时间戳落盘，每轮自检"全文还在吗" | 搜索 agent 的长任务同样会失真，直接搬 |
| 上下文四分法（预算/保真/权限/记忆各自独立） | 直接搬进我们工具的设计文档当框架 |
| 计划项级 reviewer 验收 | 搜索结果的 self-verify 可以套这个轻量模式 |
| Compact/记忆做成模型可调用的工具 | 压缩不应该是黑盒阈值触发，模型自己知道什么时候该整理 |

## 别学的坑

- 275MB 单体 DLL：domain 服务、技能、脚本全编一起，更新粒度极差，逆向者一拉 strings 全泄；
- 工具名三套并存——表面协议要一次定稿并冻结。

## 证据指路

- 原始报告：`reports/05-trae-work.md`（§2 工作流 / §6 上下文管理）
- 硬证据：`analysis/trae-work-cn/extracted/.../modules/ai-agent/checkpoint.sh`（305 字节原文）、`analysis/trae-work-cn/notes/ai_agent.strings.txt`（工具枚举 blob、Ralph Loop 日志串）
