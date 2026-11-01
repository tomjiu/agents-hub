# ZCode · 技能与工具市场

> **一句话**：ZCode 是 Claude Code 技能/插件体系的**完整平移 + 本土化**：清单文件改成 `.zcode-plugin/plugin.json`，环境变量 CLAUDE_* 和 ZCODE_* 成对注入让存量插件直接跑，官方市场挂自家 CDN（16 个插件，拉取成功），还把文档技能、电脑操作、浏览器自动化做成了官方插件。

## 先看证据：它确实是 Claude Code 那套

| 证据 | 原话 |
|------|------|
| 代码注释 | "Claude **Code-compatible** alias for the Agent tool" |
| 环境变量 | CLAUDE_PLUGIN_ROOT / CLAUDE_SKILL_DIR 与 ZCODE_* **成对出现** |
| 工具名 | Agent / Bash / Edit / Glob / Grep / Read / Skill / TodoRead / TodoWrite / Write，一模一样 |
| 清单结构 | skills/ + agents/ + hooks/hooks.json + .mcp.json 全套平移 |

对 fork 者这是最聪明的打法：**发明新格式的成本 = 放弃整个 Claude 生态的存量插件**。ZCode 选择 100% 兼容再加分项。

## 官方市场（在线可拉，16 个插件）

市场清单是活的：`https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json`。两个本土化细节：

- 清单自带 `description_i18n`（中英双语）——Claude Code 格式没有的字段。
- 插件深度罕见地"整行业"：**8 个金融研究技能包**（会计结算、信用评估、获客筛选、并购建模、基金筛选、宏观阅读、FP&A、尽调）一次上架，面向投行/财务人群。加上视频剪辑全家桶（video-agent-kit）、录屏转代码（video2code）、腾讯云开发、GitHub 工作流、写前安全钩子（mimosa）。

## 内置 8 个官方插件（不用装就有）

| 插件 | 干什么 | 值得注意 |
|------|--------|---------|
| **document-skills** | docx/pdf/pptx/xlsx 四技能 | Z.ai 自家文档技能官方打包（连"7 个封面配方 R1-R7"都在），**与 GLM 对话端技能同源**——一套技能同时服务聊天和编程两端 |
| **browser-use** | 浏览器自动化 | Desktop 内置浏览器 + CLI 无头 CDP 双模式，还能录 WebM 视频 |
| **zcode-cua** | 电脑操作（computer use） | 带 ZCODE_CUA_PLUGIN_AUTHORITY 权限开关——危险能力单独授权 |
| skill-creator | 帮你写新技能 | 元技能 |
| zcode-guide | 5 个诊断技能 | 教 AI 检查自己的 skills/plugins/mcp/hooks 配置哪里坏了 |
| ios-simulator / android-emulator | 移动端模拟器 | 移动开发场景 |
| restore-legacy-sessions | 旧会话迁移 | 数据兼容 |

## 官方云端 MCP：插件可以"外挂"Z.ai 的服务器

document-skills 的 plugin.json 里有一段关键配置：

```json
"mcpServers": {
  "image_search": {
    "type": "http",
    "url": "${ZCODE_BASE_URL}/api/v1/mcp/server/image_search",
    "auth": { "type": "zcode_official", "provider": "jwt_token" }
  }
}
```

**插件可以声明依赖官方托管的 MCP 服务**（这里是图片搜索），用官方 JWT 鉴权。重资源能力（爬虫、图片检索）放云端，客户端零维护——这是 Claude Code 没有的分发模式。

## 工具披露与本地搜索件

- 工具集与 Claude Code 同款，本地搜索三件套：**ripgrep**（代码搜索）+ **ugrep**（交互式）+ **bfs**（广度优先的文件查找，比 find 快）。
- WebFetch 错误分类都和 Claude Code 一致（unsafe_redirect / response_too_large 等）。

## 值得抄的清单

1. **fork 必留兼容层**：CLAUDE_* 环境变量成对注入，白嫖存量生态。
2. **官方云端 MCP 分发**：插件声明 + JWT 就能挂官方托管服务。
3. **市场清单 i18n**。
4. **垂直技能整包**：8 个金融技能一次上架，冷启动就得这么干。
5. **同一套技能服务多端**：文档技能既是 GLM 对话技能又是 ZCode 插件技能，一处维护两头用。

## 证据指路

硬核细节见 `reports/15-zcode.md`（第 2、4、5 节）。市场快照在 `raw-downloads/zcode-marketplace.json`，内置插件在 `raw-downloads/zcode-extract/opt/ZCode/resources/glm/packages/`。
