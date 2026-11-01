# Antigravity · 技能与工具市场

> **一句话**：Google 的 Antigravity 有 Skill 工具（Claude 派生），但技能和市场体系基本是空的——它的重点全在"把 agent 塞进 Go 二进制"这个架构上。作为对照组有价值：说明技能体系不是每家都做。

## 背景

Google 的 agentic IDE，内部代号 jetski。特别之处：Electron 只是壳，所有 agent 逻辑在 173MB 的 Go 语言二进制（language_server）里。这次分析以 strings 提取为主——Go 二进制 strip 过，能挖到的比 Electron 产品少很多。

## 找到了什么

- strings 里有 `Skill` 工具名（和 Qoder 共享同一份 Claude Code 派生工具列表：Agent/AskUserQuestion/Bash/Edit/Glob/Grep/ImageGen/ImageSearch/.../WebSearch/WebFetch/Write）；
- 用户技能入口推测为 `~/.antigravity/skills/`（Claude 同款），**未验证**；
- 市场机制：没找到。

## 为什么这页很短

不是没分析，而是**真的没有**——这正是它作为对照组的价值：

1. 技能体系是 Claude Code 带起来的生态玩法，Google 选择了只保留接口不做生态；
2. 它的工具面是 Claude 派生的 19 个左右，规模不大，暂时没有"工具太多要按需加载"的压力；
3. 产品重心在多 agent 协作和浏览器/电脑操作（见工作流文件夹），不是技能分发。

## 对我们的启示

- 技能体系不是必选项——但**凡是认真做了的（Claude/Grok/Trae/WorkBuddy/Codex），全都收敛到 SKILL.md**，这个判断反而被 Antigravity 的"缺席"反向确认：做了就抄标准，不做就别做半吊子。

## 证据指路

- 原始报告：`reports/03-antigravity.md`（§3 技能仓库）
- 硬证据：`analysis/antigravity/extracted/Antigravity-x64/resources/bin/language_server`（strings：Skill 工具名、finish 工具提示词）
