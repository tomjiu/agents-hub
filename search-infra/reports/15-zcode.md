# 15 · ZCode 3.10.2 逆向报告

> 分析对象：`ZCode-3.10.2-linux-x64.deb`（146MB，Z.ai 官方桌面端）
> 分析日期：2026-09-02 · 工具链：dpkg-deb -x → Python asar 提取器 → grep
> 最大的发现：**ZCode 是 Claude Code 的深度 fork**——代码里留着 "Claude Code-compatible" 字样和 CLAUDE_* 环境变量兼容层，且官方插件市场直接挂在网上可拉。

## 0. 一句话总结

ZCode = **Claude Code 底座（fork 改名）+ Z.ai 自研的 workflow/phase 编排层 + 多供应商模型目录（10 家）+ 官方插件市场**。Z.ai 把 Claude Code 的插件/技能体系几乎原样平移，再把文档技能、电脑操作、浏览器自动化打包成官方插件，最后把自己的 GLM 和 9 家中国模型供应商接进来。

## 1. 安装包结构

```
ZCode-3.10.2-linux-x64.deb (146MB)
└─ /opt/ZCode/ (Electron)
   ├─ resources/
   │  ├─ app.asar (307MB)          ← 桌面 UI（out/main/host/scheduler/renderer）
   │  ├─ app-update.yml            ← 更新源 http://localhost:8081（内网/测试特征）
   │  ├─ glm/
   │  │  ├─ zcode.cjs (12.5MB)     ← CLI agent 核心（混淆 esbuild bundle）
   │  │  │                           来自 apps/zcode-cli/packages/cli/dist/zcode.cjs
   │  │  └─ packages/              ← 8 个内置官方插件
   │  ├─ model-providers/
   │  │  └─ models_catalog_china_llm_zcode_2026-06-03.json (137KB)
   │  └─ tools/ (bfs / ripgrep / ugrep)  ← 搜索二进制三件套
   └─ zcode (主二进制)
```

app.asar 里 out/host（3MB）/out/scheduler（1.3MB）是桌面端专属的宿主与调度层。

## 2. Claude Code fork 的证据链（五条实锤）

| # | 证据 | 原文 |
|---|------|------|
| 1 | 提示词残留 | "You are selecting memories that will be useful to **Claude Code** as it processes a user" |
| 2 | 代码注释 | "**Claude Code-compatible alias** for the Agent tool. Use this when plugin i..." / "Claude Code-compatible alias for launching a ZCode subagent" |
| 3 | 环境变量双轨 | CLAUDE_PLUGIN_ROOT / CLAUDE_SESSION_ID / CLAUDE_PROJECT_DIR / CLAUDE_SKILL_DIR 与 ZCODE_* 成对出现（各 7-8 处）——兼容层，让面向 Claude Code 写的插件直接工作 |
| 4 | 工具集完全同款 | toolName: Agent / Bash / Edit / Glob / Grep / Read / Skill / TodoRead / TodoWrite / Write（连 TodoRead/TodoWrite、Skill 工具名都一样） |
| 5 | 生态引用 | claude-plugins-official、.claude-plugin 目录名、claude-opus/sonnet/haiku 模型名映射表（350+ 处 claude-*） |

连 WebFetch 的错误分类都同款：webfetch_unsafe_redirect / too_many_redirects / response_too_large / invalid_url。

结论：**ZCode ≈ Claude Code 的中国本地化完整移植 + 二次开发**，Claude Code 插件生态的兼容是明确设计目标。

## 3. Z.ai 自研的部分：workflow/phase 编排层

zcode.cjs 里的系统提示词片段（这是 fork 之上新加的东西）：

```
"You are running the ZCode workflow phase..."
"You are running a ZCode workflow node inside phase..."
"You are running a ZCode workflow exploration planner for phase..."
```

即：ZCode 在 Claude Code 单循环之上加了一层**显式 phase 工作流**（探索规划器 + 分 phase 执行节点），是"LLM 自主循环"和"显式状态机"的混合体（对应报告 13 里的第三流派）。另有 ReadSessionContext（会话上下文提取小模型）和 memory 选择模型（从 Claude Code 的 memory 机制继承改造）。

## 4. 插件体系（完整平移 Claude Code 并本土化）

- 清单文件：`.zcode-plugin/plugin.json`（Claude Code 是 `.claude-plugin/plugin.json`）
- 插件内容面：`skills/`（SKILL.md）+ `agents/`（子代理）+ `hooks/hooks.json` + `.mcp.json`
- **官方市场在线可拉**：`https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json`（本次实拉成功）

marketplace.json 结构：`{name, description, description_i18n, owner, plugins[16]}`，带中英双语描述（i18n 是对 Claude Code 格式的扩展）。

16 个官方插件：example-plugin（模板）、cloudbase-skills（腾讯云开发）、mimosa（写前安全钩子）、github、video-agent-kit（视频剪辑/转写/TTS 全流程）、video2code（浏览器录屏→代码）、**8 个金融研究技能包**（accounting-and-reporting / assess-credit / find-clients / model-deals / pick-funds / read-macro / run-fpa / vet-companies / watch-positions —— 面向投行/ FP&A 场景的垂直技能，是行业里最重的垂直技能集）。

## 5. 内置 8 个官方插件（glm/packages/）

| 插件 | 内容 | 对本课题的价值 |
|------|------|----------------|
| **document-skills** | docx/pdf/pptx/xlsx 四个 SKILL.md，v1.1，作者 Z.AI，"7 cover recipes R1-R7" + design-system.md + common-rules.md 结构 | **与本项目运行环境（GLM）的技能体系同源**——同一套文档技能同时服务对话端和编程端 |
| **browser-use** v0.4.1 | "Built-in browser automation runtime... Desktop IAB and CLI-managed headless CDP: open, navigate, inspect, click, type, screenshot, record workspace WebM videos" | ZCode 的网页交互 = Desktop 内置浏览器(IAB) + CLI 无头 CDP 双模式 |
| **zcode-cua** | computer-use 技能（电脑操作 agent），带 ZCODE_CUA_PLUGIN_AUTHORITY 权限控制 | Claude Code 没有的能力面 |
| **skill-creator** | 帮用户写新技能的元技能 | 同 Claude Code 的 skill-creator |
| **zcode-guide** | diagnosing-skills/plugins/mcp/hooks/commands 五个诊断技能 | 自我诊断工具集 |
| ios-simulator / android-emulator | 移动端模拟器控制 | 移动开发场景 |
| restore-legacy-sessions | 会话迁移 | 数据兼容 |

document-skills 的 plugin.json 还示范了**插件挂官方云端 MCP** 的写法：

```json
"mcpServers": {
  "image_search": {
    "type": "http",
    "url": "${ZCODE_BASE_URL}/api/v1/mcp/server/image_search",
    "auth": { "type": "zcode_official", "provider": "jwt_token" }
  }
}
```

即插件可以声明依赖 Z.ai 官方托管的 MCP 服务（图片搜索），用官方 JWT 鉴权——**官方云端 MCP 分发**是 Claude Code 没有的模式。

## 6. 搜索实现：双轨制

**客户端工具轨**（跟 Claude Code 同款）：
- WebFetch / WebSearch 工具（49/41 处引用），带完整错误分类
- browser-use 插件：CDP 无头浏览器 + 录屏
- 本地搜索二进制：ripgrep + ugrep + bfs（bfs 是 breadth-first 搜索的文件查找器，比 find 快）

**服务端工具轨**（模型 API 的 server-side tools，ZCode 做协议桥）：
- OpenAI Responses API 系：`openai.web_search` / `openai.web_search_preview` / `openai.apply_patch` / `openai.shell` / `openai.code_interpreter` / `openai.file_search` / `openai.image_generation` / `openai.mcp`
- Anthropic 系：`web_search_tool_result` + tool_use_id（server_tool_use 缓存类型也支持）
- Z.ai 官方云端 MCP：`${ZCODE_BASE_URL}/api/v1/mcp/server/image_search`（推测还有同名 web_search 端点族）

**没有自建爬虫/融合层**：搜索质量完全押在（a）模型 API 的服务端搜索工具、（b）本地 WebFetch 抓取、（c）官方 MCP 端点上。对比 Claude Code（hosted WebSearch + Chrome 扩展）和 Kimi（服务端搜索 + 用户浏览器控制），ZCode 选择了最省事也最绑供应商的路线。

## 7. 模型中立：10 个 provider 目录

models_catalog（2026-06-03 版）里 10 个 provider：

| provider | 模型示例 |
|----------|----------|
| moonshot-kimi | **kimi-k3**、k3-256k、kimi-k2.6、kimi-k2.5、moonshot-v1-* |
| minimax | MiniMax-M3 / M2.7 / M2.5（含 highspeed 变体） |
| deepseek | deepseek-v4-flash / v4-pro |
| qwen（阿里国内/国际双端） | qwen3.5-plus / qwen3.5-flash / qwen3-max |
| xiaomi-mimo | mimo-v2.5-pro 等 5 个 |
| zai / bigmodel（直连+订阅） | **glm-5.3 / glm-5.1 / glm-5-turbo / glm-4.7** 等 23 个 |
| zai-coding-plan / bigmodel-coding-plan | 同上（订阅通道） |

值得注意：**ZCode 目录里有 kimi-k3**，而 Kimi Code 目录里有 claude 模型映射——两家互相接入对方模型，中国编程 agent 市场"底座中立、体验竞争"的格局已经形成。

zcode.cjs 里还发现第三方推理 API 引用：api.fireworks.ai、api.minimax.io、api.vultrinference.com（BYOK 多路由）。

## 8. 值得我们抄的清单

1. **官方云端 MCP 分发**：插件声明 `${ZCODE_BASE_URL}/api/v1/mcp/server/*` + 官方 JWT——搜索/图片等重资源能力放云端托管，客户端零维护。
2. **市场清单 i18n**：marketplace.json 直接带 description_i18n，中国市场必要的细节。
3. **插件兼容层**：CLAUDE_* 环境变量成对注入，白嫖 Claude Code 生态的存量插件——fork 者的标准打法，值得写进 search-core 的兼容设计。
4. **workflow/phase 显式编排**：在自主循环上加 phase 节点和探索规划器，长任务可控性提升——v0.3 research loop 可参考。
5. **多 provider catalog 独立 JSON**：模型目录按日期出快照文件（models_catalog_..._2026-06-03.json），升级/审计/回滚都方便。
6. **grep 三件套**：ripgrep（代码搜）+ ugrep（交互式）+ bfs（文件查找），工具齐但都是现成开源件。
7. **垂直技能整包发布**：8 个金融技能打包进官方市场，技能市场要冷启动就得有这种"整行业"的深度包。

## 9. 证据指路

- 安装包：`raw-downloads/ZCode-3.10.2-linux-x64.deb` → 解包于 `raw-downloads/zcode-extract/`
- asar 提取：`raw-downloads/zcode-asar/`（4114 文件）；CLI 核心 `raw-downloads/zcode-extract/opt/ZCode/resources/glm/zcode.cjs`
- 官方市场快照：`raw-downloads/zcode-marketplace.json`（16 插件）
- 模型目录：`raw-downloads/zcode-extract/opt/ZCode/resources/model-providers/models_catalog_china_llm_zcode_2026-06-03.json`
- 混淆注意：zcode.cjs 是混淆 bundle（提示词片段可 grep），桌面 UI 层明文。
