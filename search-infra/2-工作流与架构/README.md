# 文件夹二：工作流与架构

> 这个文件夹回答一个问题：**每家产品的 agent 是怎么组织起来的——单干还是带团队、什么时候停、上下文（AI 的脑容量）怎么省着用、整体架构长什么样。**
> 每个产品一个文件，大白话。硬证据指路在文末。

## 三种流派（先看这张表）

| 流派 | 谁在用 | 一句话解释 | 优劣 |
|------|--------|-----------|------|
| **模型自治** | Claude Code、Codex、Grok Build | 没有流程图，模型每一步自己决定"调工具还是回话" | 灵活、能处理意外；但行为不可预测 |
| **固定流程** | Open Deep Research、Trae 的 deep-research 工作流 | 先画好流程图（状态机），每一步固定 | 可控、可恢复、可算预算；不够灵活 |
| **混合** | Trae SOLO、WorkBuddy、ZCode | 模型自治，但外面套了硬护栏（或像 ZCode 叠一层显式 phase 流水线）（最多几轮、超了强制降级） | 平衡；实现最复杂 |
| **常驻服务** | Kimi 桌面版（Kimi Work） | agent 不是一次性会话，而是开机自启的守护进程：带定时任务、记忆库、看板、崩溃自愈 | 能"持续为你干活"；工程量最大 |
## 多 agent 拓扑（谁带谁干活）

| 产品 | 组织方式 | 人话版 |
|------|---------|--------|
| Claude Code | 主管 + 工人（Coordinator/workers） | 主管被没收了文件工具，只会分活和汇总；干危险活的工人每次新开一个，防止"被污染的工人碰危险操作" |
| Codex | 单干 + Stop hook | 一个 agent 干到底；想收工时被钩子拽住问"真干完了？没干完继续" |
| Trae SOLO | 父子树 + 每项验收 | 主 agent 按需拉子 agent；每个计划项有独立的审查员签字 |
| WorkBuddy | 子代理 + 一堆隐形小工 | 台前一个主 agent，幕后 9 个小 agent 干脏活（压缩、起标题、判断内容相关性） |
| Open Deep Research | 主管 + 研究员们 | 主管派 5 个研究员并行调研，各写各的报告，互不串门 |
| Perplexica | 单干 | 一个 agent 持有 6 个工具自己循环 |
| Kimi Work | 单干 + 定时任务（默认禁子代理） | 提示词明文：除非用户要求，禁止用子代理——省 token、用户全程看得见；长任务靠 cron 不靠分身 |
| ZCode | fork 底座 + 自研 phase 流水线 | 日常问答走自主循环，重活先过"探索规划器"再按 phase 逐段推进 |

## 四条共识（在 4 家以上独立出现，可以直接当成定律）

1. **子代理 = 上下文防火墙**。搜到的网页、读的文件这些又臭又长的中间结果，绝不让主 agent 亲眼看——派个小 agent 去看，小 agent 只交回一段总结。Claude、WorkBuddy、Codex、Trae 四家独立得出同一答案。
2. **停止条件要三重保险**。光靠模型自觉"我说完了"不够：要有显式的"完成"信号（一个专门的工具调用）+ 隐式兜底（模型不再调工具就算完）+ 硬上限（轮数/token 封顶）。Open Deep Research 的实现是标准模板。
3. **上下文管理是四大件，不是一招**。Trae 拆得最清楚：**预算**（压缩省空间）、**保真**（checkpoint.sh 防关键文档被压缩弄丢）、**权限**（按任务规定能读什么）、**记忆**（分层持久化）。四件事各自独立开关。
4. **小模型干脏活**。起标题、判断"这段网页跟问题相关吗"、压缩摘要——全用便宜模型。大模型只管决策。

## 阅读顺序建议

想理解"别人怎么管 agent"，按这个顺序读收益最大：

1. [claude-code.md](claude-code.md) — 多 agent 编排的天花板（主管/工人模式）
2. [open-deep-research.md](open-deep-research.md) — 固定流程派的教科书（而且代码只有 4 个文件）
3. [codex.md](codex.md) — 单 agent 怎么做到极致（代码模式 + 中途压缩）
4. [trae-work.md](trae-work.md) + [trae-code.md](trae-code-deep-research.md) — 最重工程化的路线（Rust 引擎 + 可编程工作流）
5. [workbuddy.md](workbuddy.md) — 办公场景的多 agent + 记忆分层
6. [perplexica.md](perplexica.md) — 最简单的可用版
7. [kimi.md](kimi.md) — agent 常驻化的完整参考（守护进程/定时任务/看板，且核心开源可直读）
8. [zcode.md](zcode.md) — fork + 自研叠加层的工程纪律
9. [grok-build.md](grok-build.md) / [qoder.md](qoder.md) / [antigravity.md](antigravity.md) — 架构参考
