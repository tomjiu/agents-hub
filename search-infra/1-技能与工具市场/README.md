# 文件夹一：技能与工具市场

> 这个文件夹回答一个问题：**各家 AI 编程工具是怎么管理"技能"和"工具"的，有没有市场（marketplace），怎么分发安装。**
> 每个产品一个文件，全部用大白话写。硬核证据（反编译产物、行号、strings）在 `reports/` 和 `analysis/`，每个文件末尾都标了指路。

## 先搞懂四个名词（30 秒版）

| 名词 | 大白话解释 |
|------|-----------|
| **技能（Skill）** | 一个装在文件夹里的说明书（`SKILL.md`），教 AI "遇到某类任务该怎么做"。比如"写周报的技能"、"做 PPT 的技能"。AI 平时只看目录（名字+一句话简介），干活时才把全文读进脑子 |
| **工具（Tool）** | AI 能直接调用的"手"。比如 Bash（敲命令）、WebSearch（搜网页）。技能是知识，工具是动作 |
| **MCP** | 一个通用的"插座标准"。任何工具只要做成 MCP 插头，就能插进任何支持 MCP 的 AI 工具里，不用每家单独适配 |
| **市场（Marketplace）** | 技能/插件的"应用商店"。用户从里面一键安装别人写好的技能包。有的市场是 git 仓库，有的是自家 CDN |

## 全景对比（谁有什么）

| 产品 | 技能格式 | 有没有市场 | 市场形态 | 工具太多怎么办 |
|------|---------|-----------|---------|---------------|
| [Claude Code](claude-code.md) | SKILL.md（发明者） | **有，最完整** | git 仓库 / URL，带签名校验、企业黑名单 | 超过阈值自动"藏起来"，模型用 ToolSearch 按需找 |
| [Grok Build](grok-build.md) | SKILL.md（抄 Claude，连变量名都没改） | **有** | git 仓库 `xai-org/plugin-marketplace`，首次启动自动注册 | 留了个工具搜索的接口，但没有实现 |
| [Codex](codex.md) | SKILL.md 四层目录 | 有（官方源） | 官方 marketplace + 插件包 | 工具分四档（明牌/暗牌/代码模式/隐藏）+ BM25 搜工具 |
| [WorkBuddy](workbuddy.md) | SKILL.md（兼容 Claude） | **有，还有"专家"市场** | 内置 19 个技能 + 100+ 专家人设包 | 暗牌工具进 MiniSearch 索引，搜到才换票执行 |
| [Trae Work/Code](trae.md) | SKILL.md（兼容）+ 字节自建包 | **有** | 字节自家 CDN 下载 zip 分包（按场景分包） | 工具打"分组延迟加载"标签 |
| [Qoder](qoder.md) | SKILL.md（Claude 派生） | 简化版 | 本地目录插件 + 加载前校验 | 用环境变量整组开关工具 |
| [Antigravity](antigravity.md) | 有 Skill 工具（Claude 派生） | 未见 | — | — |
| [Kimi 桌面版](kimi.md) | SKILL.md（Claude 派生，加载规则更狠） | **有，双市场** | 内置托管 + 收编 OpenClaw 的 ClawHub；UI 里"从对话/文档一键造技能" | 提示词明文写死：必须用 Skill 工具加载、最多挑一个 |
| [ZCode](zcode.md) | SKILL.md（Claude 完整平移，.zcode-plugin 清单） | **有，在线可拉** | 官方 CDN 市场清单（16 插件，含 8 个金融整包）+ 官方云端 MCP；CLAUDE_* 兼容层白嫖存量插件 | 与 Claude Code 同款 + 本地 grep 三件套 |

*pi-search-boost / dsh-search-boost 是插件本身，不是平台，没有技能市场；Open Deep Research / Perplexica 是开源研究项目，没有技能体系。*

## 读完全部 9 个文件后的三个结论

1. **SKILL.md 已经一统天下。** Claude Code 发明了它，Grok、Trae、WorkBuddy、Qoder 全都直接兼容，连闭源竞品都不愿意发明新格式。我们要做工具，直接用 SKILL.md，不要自己发明。
2. **"先给目录、按需加载"是通用解法。** 技能和工具一多，全塞进提示词会把上下文（AI 的脑容量）挤爆。四家的解法殊途同归：平时只给"名字+一句话"，要用时再加载全文。区别只在检索方式：Claude 手写打分、Codex 用 BM25、WorkBuddy 用 MiniSearch。
3. **市场不只是"能下载"，还有安全工程。** Claude Code 的市场有版本锁定、防路径穿越、企业黑名单（下载前拦截）、SSH 指纹突变检测（防中间人攻击）。做公开市场时这些都是必修课，不是选修。
