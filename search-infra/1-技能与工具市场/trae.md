# Trae（Work / Code）· 技能与工具市场

> **一句话**：字节的 Trae 表面上兼容 Claude 的 SKILL.md，背地里自建了一条**技能 CDN 分发通道**——技能从字节的服务器按"场景"分包下载，还有一部分技能直接编译进了 275MB 的核心二进制里。

## 背景

Trae Work（TRAE SOLO）和 Trae Code 是同一套 Rust agent 引擎配两个不同的壳（证据：两家的 ai_agent.dll 逐字符串比对几乎一致）。本文件合并讲，引用证据同时覆盖两个产品。

## 技能的三个来源

### 1. 用户/项目技能（兼容 Claude 格式）

- `.trae/skills/<名字>/` 和 `.claude/skills/*/SKILL.md` 都认（工作区和用户主目录都扫）；
- 项目规则文件同样兼容：`AGENTS.md`、`CLAUDE.md`、`CLAUDE.local.md` 全都识别并监听变更；
- 用户斜杠命令放 `.trae/commands/`。

### 2. 内置技能：CDN 分发包（本产品独有的分发设计）

从解包产物里复原了完整的下载协议：

```
https://p11-market.byteimg.com/.../skills/1/trae_agent::<场景>::<构建号>::<技能名>/<版本>/package.zip
```

关键点：

- **按场景分包**：场景分 `default`（通用）和 `solo_work`（SOLO 办公）。default 场景有 TRAE-doctor（自诊断）、TRAE-product-knowledge（"你是谁"类问题会去查官方文档）、feedback 等；solo_work 场景有 docx/pdf/pptx/xlsx、html-deck、research-guide（研究指南）等。
- 下载器是一整套 crate（模块）：下载、更新、**原子替换**（换一半断电不会坏）、格式解析。技能包是带版本号的，可以独立于产品升级。
- 有一个专门的 MCP 插件叫 **skill-materializer（技能物化）**——把对话里产出的好做法固化成技能。

### 3. 编译进二进制的技能

大段技能/工作流直接编进了 ai_agent.dll（设计稿生成、页面 1:1 恢复、数字人等），而且**不只是说明书**——带校验脚本和"禁止读取清单"（forbiddenReads）。也就是说 Trae 的技能可以是"说明书 + 运行时契约"的包，格式比纯 markdown 重。

## 工具市场侧：内置 MCP 扩展

Trae 自带一组 MCP 插件（`byted-solo.builtin-mcp`）：

- **computer-use**：跨平台桌面控制（截图/鼠标键盘/窗口），macOS 上还带权限管理和"永远放行"应用名单；
- **connectors**：邮件/日历/通讯录/备忘录（Apple 系）；
- 深链导入：`trae-cn://trae.ai-ide/mcp-import?...`——点一个链接就能装 MCP 服务器，类似浏览器的协议处理。

工具太多的问题用**"分组延迟加载"标签**解决：每个工具可以标 `defer_loading_group_name`，非首屏工具不占提示词空间；每个 agent 还可以按配置裁剪掉某些 MCP 工具。

另外有个 `SkillRecommend` 工具——模型可以主动问"有没有推荐技能"，说明技能发现被做成了双向的（用户找技能 + 模型找技能）。

## 值得我们抄的清单

| 抄什么 | 为什么 |
|--------|--------|
| 技能按"场景"分包分发 | 不同产品形态只装自己需要的技能包，带宽和上下文双省 |
| 下载器的原子替换 | 技能热更新不断不坏，工程细节值得照抄 |
| 兼容 `.claude/skills` + AGENTS.md/CLAUDE.md | 零成本接入现成生态（他们都想明白了：别发明新格式） |
| `SkillRecommend` 双向技能发现 | 模型自己找技能，比只有用户手动装更智能 |

## 别学的坑

- 技能直接编译进 275MB 的单体二进制——更新粒度极差，拆包后全靠 strings 才挖出来。技能要保持"可独立更新的包"形态。

## 证据指路

- 原始报告：`reports/05-trae-work.md`（§3 技能仓库）、`reports/06-trae-code.md`（§3 表格）
- 硬证据：`analysis/trae-work-cn/extracted/.../modules/ai-agent/`（含 builtin-skills crate 痕迹）、`extensions/byted-solo.builtin-mcp/`、strings 里 CDN URL 与技能名清单
