# ZCode · 搜索

> **一句话**：ZCode 的搜索是**双轨制**：客户端留了 WebFetch/WebSearch 工具 + 无头浏览器（browser-use 插件），同时把搜索押在**模型 API 的服务端搜索工具**上（OpenAI Responses 协议的 web_search_preview 和 Anthropic 的 web_search_tool_result 都支持）——搜索质量随模型供应商走，客户端不做自建融合。

## 双轨全景

```
用户问题
  │
  ├─【客户端轨】                        ├─【服务端轨】
  │  WebSearch（搜索）                  │  openai.web_search / web_search_preview
  │  WebFetch（抓取，错误分类 7 种）      │  （OpenAI Responses API 服务端工具）
  │  browser-use 插件（CDP 无头浏览器）   │  web_search_tool_result
  │  ripgrep / ugrep / bfs（本地代码/文件）│  （Anthropic 服务端工具）
  │                                    │  官方云端 MCP：
  │                                    │  /api/v1/mcp/server/image_search（JWT）
```

两种轨的选择逻辑推测：接 GLM/智谱订阅时走服务端工具（体验最好、零维护）；接其他 9 家供应商（kimi-k3、deepseek、qwen…）时，谁家没有服务端搜索就回落到客户端 WebFetch/browser-use。

## 服务端工具协议桥（工程上最值得看的部分）

zcode.cjs 里有一段协议映射（OpenAI Responses 事件 ↔ 内部工具流）：

```
"openai.shell":"shell", "openai.web_search":"web_search",
"openai.web_search_preview":"web_search_preview", "openai.mcp":"mcp",
"openai.apply_patch":"apply_patch" ...
```

支持的 server-side 工具类型：shell / web_search / web_search_preview / apply_patch / code_interpreter / file_search / image_generation / mcp。也就是说 **ZCode 把"服务端搜索"当一类可插拔的工具协议处理**，不同供应商的 server-tool 事件统一翻译成内部格式再喂给 agent 循环。

**对 search-core 的直接启发**：我们的 MCP 渐进披露是"自己当 MCP server"，而 ZCode 这层是"**消费别人的 server-tool**"。未来 search-core 若要接 GLM/Perplexity 式的服务端搜索 API，可以照这个模式做协议适配层：`provider.server_tool → 内部引用格式（统一 Reference）`。

## 客户端轨细节

- **WebFetch 错误分类与 Claude Code 完全同款**（unsafe_redirect / too_many_redirects / response_too_large / invalid_url / processing_failed...）——fork 的痕迹延伸到了抓取层，说明这套错误处理经过实战检验，值得直接抄进我们的 fetcher。
- **browser-use 插件**：Desktop 内置浏览器（IAB）+ CLI 无头 CDP 双模式，能录 WebM 视频（用于 video2code 插件的工作流）。
- **本地三件套**：ripgrep（代码搜索）+ ugrep（交互式）+ bfs（广度优先文件查找）——bfs 是个不常见的选择，对大仓库的 find 场景更快。

## 官方云端 MCP（图片搜索）

document-skills 插件注册了 `${ZCODE_BASE_URL}/api/v1/mcp/server/image_search`（HTTP MCP，官方 JWT 鉴权）。这确认了 Z.ai 在云端托管搜索类 MCP 端点族，客户端插件声明即可用。对"图片搜索"单独建云端服务，说明**图搜在 agent 工作流里的使用频率被官方认可**（对比 Kimi 的 search_image_by_text/image 也是独立工具）。

## 对照表：与同类的搜索路线

| 产品 | 搜索智能位置 | 登录态网页 | 自建融合层 |
|------|-------------|-----------|-----------|
| **ZCode** | 模型供应商服务端 + 客户端兜底 | 内置浏览器（部分） | **无** |
| Kimi | Kimi 云端 | 用户日常浏览器（WebBridge） | 无（云端黑盒） |
| Claude Code | Anthropic 服务端 | Chrome 扩展 | 无 |
| WorkBuddy | WorkBuddy 云端 agentic_search | 无 | 有（服务端编排） |
| 我们 search-core | **客户端** | 无 | 有（RRF 融合/去重/预算） |

ZCode 的启示：**不自建融合层的前提是"你信得过的服务端搜索"**。我们的处境（免 key、多引擎、可编排）正好是它的反面——继续做深客户端融合是差异化正确的方向；但它的"server-tool 协议适配层"值得作为 v0.3 可选项：当用户配置了带服务端搜索的 API key 时，search-core 可以把该能力作为一个"虚拟引擎"并入融合池。

## 证据指路

见 `reports/15-zcode.md`（第 6 节）。协议映射可 grep `raw-downloads/zcode-extract/opt/ZCode/resources/glm/zcode.cjs`（搜 openai.web_search），插件 MCP 配置在 `glm/packages/document-skills-plugin/.zcode-plugin/plugin.json`。
