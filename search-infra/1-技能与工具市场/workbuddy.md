# WorkBuddy · 技能与工具市场

> **一句话**：腾讯的 WorkBuddy 把"技能"从静态说明书往前推了一步——**AI 干完活能自己把经验写成新技能存起来**，还配了一个"专家"市场（100+ 个预置人设包）。

## 背景

腾讯 CodeBuddy 团队的 AI 工作端（Manus 式办公 agent）。Electron 壳 + 独立的 agent 内核（CodeBuddy CLI，Claude Code 血统）。这次拆的是 772MB 的 asar 源码，大部分 JS 未混淆，证据非常扎实。

## 技能的三个来源

| 来源 | 位置 | 例子 |
|------|------|------|
| 内置技能（19 个） | 安装包内 `plugins/workbuddy-builtin/skills/` | skill-creator（教 AI 写技能）、marketplace-skill-installer（装市场的技能）、expert-manager（管专家）、ardot-* 设计族 6 个、sites（建站）、wb-finance-skill（财务） |
| 内置插件（5 个） | `builtin-plugins/` | tencent-docx（大型文档 agent，自带自己的 agents/experts/hooks/skills）、sheetagent、tencent-pptx |
| 用户/项目 | `~/.workbuddy/skills/`、`<项目>/.workbuddy/skills/` | 运行时可写 |

兼容性上与 Claude Code 全套对齐：SKILL.md 格式、`CODEBUDDY.md`（= CLAUDE.md）、hook 名字都一样。

## 三个独有机制

### 1. "先搜技能，再说不会"

系统提示词里有硬规则：**模型说"我做不到"之前，必须先调 find-skills 搜一遍有没有相关技能**。把"能力缺口先查库存"做成了 prompt 层的强制动作，这是把技能利用率拉满的聪明做法。

### 2. 技能自积累（SkillManage）

模型完成任务后（8+ 次工具调用的任务），可以把过程固化成一个新技能落盘；用过的技能必须反思修正。有两条约束防止失控：只能修改 `agent_created: true` 的技能（不碰人写的），安装前有 P0/P1/P2 三级安全审计。**"经验固化"不再是用户手动操作，而是 AI 的日常动作。**

### 3. 专家市场（Experts）

100+ 个"领域专家"（`curated-experts.json` 做场景匹配）：每个专家 = 预置人设 + 工作流包。配合 expert-manager 技能 + expert 模式。本质是技能的"人设化包装"——比裸技能多了一层角色代入，适合办公场景。

## 加载预算

- 模型调用 Skill 工具加载技能全文时，有 **30000 字符预算**（桌面端用环境变量下发）；
- 技能描述本身有长度上限（控制目录开销）；
- 和工具系统咬合很深：技能文档里直接教模型"先用 ToolSearch 搜工具，再用 DeferExecuteTool 换票执行"。

## 值得我们抄的清单

| 抄什么 | 为什么 |
|--------|--------|
| "说不会之前先搜技能"的硬规则 | 一行 prompt 规则，技能利用率完全不同 |
| 技能自积累 + agent_created 隔离 + 安装前审计 | 让工具越用越聪明的可行路径，约束设计也齐 |
| 技能 30000 字符预算 | 上下文保护的明确数字，可直接搬 |
| 专家=人设+工作流包 | 技能产品的另一种包装形态，适合面向消费者 |

## 证据指路

- 原始报告：`reports/07-workbuddy.md`（§3 技能仓库）
- 硬证据：`analysis/workbuddy/code/resources/plugins/workbuddy-builtin/skills/`（19 个技能原文件）、`builtin-expert-recommendations/curated-experts.json`、`cli/dist/codebuddy.js`（SkillManage、find-skills 规则）
