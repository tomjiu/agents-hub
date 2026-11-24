# G2 引擎原生协议适配 — 协议笔记与核验状态 (issue #3 评论)

日期: 2026-11-24 (UTC) · 环境: 本任务容器 (Linux x86_64, 2 CPU) · 记录者: sandbox-agent

## 1. 范围与纪律

- 本文档记录 Go 版 `mcp/servers/search-core/go` 直连引擎 (DDG / Mojeek / Yahoo) 的**协议形状**、
  会话/分页状态与失败语义, 以及 Google 通用网页搜索的评估结论。
- SearXNG 仅作为**协议参考** (请求参数/分页/语言/时效、响应结构、cookie 会话、限流语义),
  参考上游 commit `a7163d091037cae586c444b05f22ecca162bb492`。
- **许可边界**: SearXNG 相关源文件为 AGPL-3.0-or-later。本仓 (MIT) 未复制、未翻译其任何代码;
  本文档只记录公开协议事实 (参数名/语义), 不构成衍生作品。若未来需复用代码, 须先完整许可审核并
  保留版权/许可义务 — 未进行前一律禁止。
- 不自动解验证码、不自动点同意、不绕过来源限制; 被阻断如实返回 blocked/consent 分类。

## 2. 本沙箱公网可达性实测 (2026-11-24)

| 引擎 | 探测 | 结果 | 结论 |
|---|---|---|---|
| DDG html | `GET https://html.duckduckgo.com/html/?q=test` | **HTTP 202** (软封签名) | 出口 IP 被限速; 不冒充可用 |
| Mojeek | `GET https://www.mojeek.com/search?q=test` | **连接失败** (000/ERR) | 网络出站受阻, 记 BLOCKED |
| Yahoo | `GET https://search.yahoo.com/search?p=test` | **连接失败** (000/ERR) | 网络出站受阻, 记 BLOCKED |

诚实声明: 本环境无法做**真实公网协议漂移验证**。协议契约由离线 fixture 锁定
(`lanes_g2_test.go`: 请求表单形状 / 分页会话回传 / consent 墙分类 / 失败分类矩阵);
真实引擎 markup 是否漂移需在可达环境跑 live probe (挂账, 见 §6)。

## 3. DuckDuckGo (html 端点) — 已实现

**请求形状** (POST `https://html.duckduckgo.com/html/`, x-www-form-urlencoded):
- 首页: `q`, `b=""`, `kl=<lang>`, `df=<freshness>` (`buildDdgForm`, fixture 锁定)
- 后续页: 回传上一页响应中分页表单的会话字段 (`s` 偏移, `dc` 计数, `o/api/v` 等),
  查询/语言/时效替换为当前值 — `ddgPageState` 显式状态, `parseDdgNextPage` 解析。

**失败语义**:
- `202` = 软封签名 (202+空页伪装"无结果") → 退避单次重试 → 熔断; 绝不当真结果返回。
- `429` → rate_limited (有界退避); `403/captcha/challenge` → blocked (不可重试)。
- 无下一页表单 = 合法尾页 (nil state), **不误判为"无结果"**。

**分页预算**: `SC_DDG_MAX_PAGES` (默认 2, 上限 5) — 有界翻页, 防翻页风暴。

**会话令牌边界**: 状态仅存活于单次 lane 调用 (页间回传), 不跨查询/不落盘;
  缺失/过期 → 停止翻页并如实报告, 不伪造尾页。

## 4. Mojeek — 已实现 (未改动协议)

GET `/search?q=<query>&lang=<lang>`; 解析 `ul.results-standard li` /
`li.result` + `a.title, h2 a` + `p.s, p.sc`。空解析 = markup drift 报错交熔断。
本环境不可达, 漂移状态 UNKNOWN。

## 5. Yahoo — 已实现 + G2 补强: consent 墙显式分类

GET `/search?p=<query>&n=<n>`; 解析 `div#web ol li div.compTitle` +
`r.search.yahoo.com` RU= 重定向解码。

**G2 新增**: 欧盟 consent 墙检测 (`isYahooConsentPage`):
- 重定向至 `consent.*` 域、body 含 `consent.yahoo.com`、或 GDPR 双标记 (`gppd`+`consent`)
  → 显式错误 `yahoo consent page (EU consent wall)` → `classifyFailure` = **blocked (不可重试)**。
- 不自动点同意/种 cookie (扩大采集权限需用户明确授权)。
- 关键: consent 墙**不再被误判为"无结果"** (原实现空解析即报 markup drift)。

## 6. Google 通用网页搜索 — 评估结论: BLOCKED (未实现, 如实记录)

- 现有 `googlenews` 车道仅覆盖 Google News, **不冒充通用 Google** (issue 明令)。
- 通用网页搜索路径评估:
  1. `html.google.com/search` 抓取: Google ToS 明确禁止自动化访问; 且本沙箱出站受阻 — 双重 BLOCKED。
  2. Custom Search JSON API: 需 API key + 每日配额, 未获用户密钥授权 — 未配置, 不伪造。
  3. 公共 SearXNG 实例代理: b14 已实测 SEO 污染 (77 题 732 refs 仅 4 条全垃圾), 默认摘出全池。
- 结论: **BLOCKED-pending-authorization**。解除条件: 用户提供 CSE key 或明确授权抓取并
  在可达环境验证。不通过改名/转写/关 TLS 绕过。

## 7. 变更清单 (本阶段)

- `lanes_html.go`: DDG 分页会话状态 (`ddgPageState`/`parseDdgNextPage`/`buildDdgForm`/
  有界翻页循环)、Yahoo consent 检测。
- `governor.go`: `blockRe` 增加 `consent (wall|page)` 分类。
- `lanes_g2_test.go`: 协议形状/分页状态/consent/失败分类 fixture 测试 (13 用例)。
- 挂账: 可达环境 live 漂移 probe; DDG 会话字段在真实响应中的字段集合核对 (fixture 基于公开协议)。
