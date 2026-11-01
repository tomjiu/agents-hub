# Kimi 桌面版 · 搜索

> **一句话**：Kimi 的搜索是**服务端黑盒 + 客户端浏览器**的组合：web_search/image_search/fetch_urls 的实现全在 Kimi 云端（本地代码里找不到一行实现），但把"控制用户日常浏览器"做成了 9 个 browser_* 工具 + Chrome 扩展——**带用户登录态的网页操作**是闭源产品里独一档的。

## 搜索工具清单（从语言包全集提取）

| 工具 | 干什么 | 实现在哪 |
|------|--------|---------|
| web_search | 网页搜索 | **服务端**（Kimi API 云端执行） |
| image_search | 图片搜索 | 服务端 |
| search_image_by_text / image | 以文搜图 / 以图搜图 | 服务端 |
| fetch_urls | 抓取网页 | 服务端 |
| browser_visit / click / input / find / scroll_up / scroll_down / state / screenshot | 操作真实浏览器 | **客户端**（WebBridge Chrome 扩展 + kimi-webbridge.exe 本地服务） |
| screenshot_web_full_page | 整页截图 | 客户端 |

判断依据：web_search / fetch_urls 在开源 kimi-code 仓库和 daimon 可读代码里**零实现**（只有 Anthropic provider 的服务端 web_search_tool_result 类型引用）；而 browser_* 工具有完整的客户端载体（扩展 + 本地进程 + 原生模块）。服务端搜索的进度（"Searching web pages..."）通过 UI 文案回传。

## WebBridge：控制用户日常浏览器（不是起 headless）

Chrome 扩展 manifest v3，权限清单很能说明问题：

```
permissions: [tabs, activeTab, debugger, storage, alarms, tabGroups, windows]
host_permissions: [<all_urls>]
```

关键在 **debugger 权限**——这是 Chrome DevTools 协议的完整控制权（能注入 JS、拦截网络、模拟输入），比普通扩展的 content script 强一个量级。配套 kimi-webbridge.exe 本地进程负责与 daimon 的通信。

**与别家的差异**：

| 产品 | 浏览器控制方式 | 拿到登录态？ |
|------|----------------|-------------|
| Kimi WebBridge | 控制用户**日常浏览器**（用户正开着的 Chrome） | **是**（带 cookie） |
| ZCode browser-use | Desktop 内置浏览器 + CLI headless CDP | 部分（内置浏览器有） |
| Claude Code | Chrome 扩展（Claude in Chrome） | 是（同类思路） |
| 传统 headless 方案 | 自起无头浏览器 | 否（每次都是新会话） |

**对我们 search-core 的启发**：fetch 类工具拿不到登录态页面是老痛点（微博/知乎/公众号），"借用户的浏览器"是客户端产品独有的合法解法——pi 插件生态里可以做一个"browser bridge"类工具（用户装个扩展，agent 走 CDP 拿带登录态的页面），比破解反爬体面得多。

## 搜索与金融数据的优先级（提示词明文）

Kimi 的 plugins.md 里写着：

> 金融问题"always prefer them over internal knowledge or general web search"（优先用专业数据插件，别信通用搜索）。

还有证据门控规则："价格、比分、天气这类会变的信息，**必须当轮用工具验证**，验证不了就明说"。这是把"搜索什么时候该用、用完怎么算数"写进了行为准则——比大多数产品只在工具描述里写一句"search the web"认真得多。

## 对我们 search-core 的对照

| Kimi 的做法 | search-core 现状 | 可借鉴 |
|------------|------------------|--------|
| web_search 服务端执行 | 客户端 8 引擎并行 | 场景不同（我们免 key 是卖点），但"搜索进度事件流"值得对齐它的 UI 文案三态 |
| fetch_urls 服务端抓取 | Focus Fetch + 缓存 | 它的 fetch 走云端（快、稳、带渲染），我们走本地（可编排）——混合方案：大站走云端 fetch、长尾走本地 |
| browser_* 带登录态 | 无 | **browser-bridge 工具**可以作为 v0.3 之后的增量方向 |
| 证据门控提示词 | 引用出口校验（代码层） | 我们是代码强制，它是提示词软约束——可两者都上 |

## 证据指路

见 `reports/14-kimi-desktop.md`（第 4、6 节）。WebBridge 扩展解包在 `raw-downloads/webbridge-ext/`，工具文案证据在 `raw-downloads/kimi-app/resources/kimi-asar/out/renderer/assets/initial-locale-*.js`。
