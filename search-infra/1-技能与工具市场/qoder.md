# Qoder · 技能与工具市场

> **一句话**：阿里的 Qoder 是 Claude Code 架构的忠实 fork（连 hook 名字都一样），技能和插件系统做了"简化版"——没有完整市场，但用环境变量控制工具开关的设计很干净。

## 背景

阿里通义旗下 AI Coding IDE（CN 版）。分析靠的是包内一个未删干净的 npm SDK（`@qoder-ai/qoder-cn-agent-sdk`），虽然 minify 但所有内部细节（工具列表、hook 类型、权限模式）都是明文。

## 技能系统

- 工具列表里有 `Skill` 工具，技能系统确认存在且照搬 Claude Code；
- 启动参数支持 `--disable-builtin-skills`：**只关内置技能、保留用户自己的**——说明内置技能和用户技能是分开管理的；
- 用户技能入口推测为 `.qoder-cn/skills/<名字>/SKILL.md`（Claude 同款结构）。

## 插件系统（简化版市场）

```ts
validatePlugin(plugin)      // 加载前校验，坏了不让进
--plugin-dir <path>         // 从本地目录装插件
```

对比 Grok Build 的 git 市场：没有远程源，就是**本地目录 + 加载前校验**。`validatePlugin` 这一步值得注意——很多产品的插件是"装了就生效"，坏了直接把 agent 带崩；Qoder 在门口先验一遍。

## 工具清单与开关

完整还原出 19 个工具：Agent / AskUserQuestion / Bash / Edit / Glob / Grep / **ImageGen** / **ImageSearch** / NotebookEdit / Read / Skill / **TaskCreate/Get/Update/List** / **UpdateGoal** / WebFetch / WebSearch / Write。

（加粗的是 Qoder 独有：图像生成/搜索、把 Claude 的 TodoWrite 拆成了 4 个任务工具 + 目标更新。）

最有意思的设计——**一个环境变量切换两代工具集**：

```
QODER_FEATURE_TASKS=1  → 19 个工具（Qoder 增强版）
QODER_FEATURE_TASKS=0  → Task* 换回 TodoWrite（Claude Code 兼容版）
```

同一个二进制，按环境变量退化成 Claude Code 兼容形态。做实验性功能时，这是比"发两个版本"轻得多的方案。

## MCP 管理

- 命名约定 `mcp__服务器名__工具名`（行业通用）；
- 每个工具三态权限：**always_allow（永远放行）/ always_ask（每次问）/ always_deny（永远拒绝）**；
- 保留名 `mcp_list / mcp_get / mcp_call` 用于动态管理。

## 值得我们抄的清单

| 抄什么 | 为什么 |
|--------|--------|
| 环境变量整组开关工具集 | 实验功能灰度、兼容模式切换的最轻方案 |
| `validatePlugin` 加载前校验 | 插件坏 ≠ agent 崩 |
| MCP 三态权限 | 管理第三方工具权限的最简表达 |
| `--disable-builtin-skills` | 内置技能和用户技能分离开关 |

## 别学的坑

- worker runtime 运行时才从 CDN 下载（`packaged: false`）——首次启动慢，CDN 挂了整个产品瘫痪。核心能力要随包分发。

## 证据指路

- 原始报告：`reports/04-qoder.md`（§3 技能仓库 / §4 工具系统）
- 硬证据：`analysis/qoder/extracted/opt/Qoder CN/resources/app-asar-extracted/node_modules/@qoder-ai/qoder-cn-agent-sdk/dist/index.js`（工具数组 $n、FEATURE_TASKS 逻辑、MCP 三态）
