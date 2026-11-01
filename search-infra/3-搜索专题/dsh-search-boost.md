# dsh-search-boost · 搜索专题（我们自己的进化版）

> **一句话**：pi 版的 DeepSeek Harness 移植重构版（5531 行 JS、零依赖）。四个质变：免费层从一条腿变成四路并行、给宿主内置搜索"换心脏"而不是加平行工具、补上了 pi 版缺失的 SSRF 守卫、X 降级链加上了自愈。**它定义了"无 key 也能完整工作"的第一验收标准。**

## 和 pi 版的四个关键差异

### 1. 免费层四路并行（最大的实用提升）

```
pi 版免费层：  exa-free 一条腿
dsh 版免费层： Bing + DDG + Yahoo + Exa-MCP 四路并行
```

全部免 key：Bing/DDG/Yahoo 走 HTML 解析（正则提取 + 重定向参数解码），Exa 走手写的 MCP 客户端。实测 5 条结果 1.3-3.0 秒。作者还实测淘汰了 brave-html/mojeek/searx（0% 成功率——429/封锁）。

**"无 key 也能完整工作"应该成为我们 v0 的第一验收标准**——这正是本项目要解决的核心痛点。

### 2. Provider seam 劫持（"换心脏"模式）

pi 版是加平行工具（`fused_search` 和宿主的 `web_search` 并存）；dsh 版用 11 行 patch 把 DSH 内置 `web_search`/`web_fetch` 的后端**替换**成本插件的引擎链——引用卡片 UI 还是宿主原生的。**升级内核、不换外壳**。给别的工具做搜索插件时，这个接入方式体验好得多。

### 3. SSRF 守卫 182 行（pi 版完全裸奔）

拦回环/内网/链路本地/云 metadata 地址；手动逐跳跟随重定向、**每一跳重新校验**（防 DNS rebinding）；500KB 字节上限。最妙的是 **Clash/mihomo TUN fake-ip 豁免**：TUN 代理会把所有域名解析成假 IP（198.18.x.x），一刀切拦截会弄死真实页面——守卫识别"全部答案都是 fake-ip"判定为走了 TUN 放行。这是从真实代理环境里长出来的细节，Grok Build 的 416 行 SSRF 模块都没有这个。

### 4. X 降级链 + 自愈

无凭证时：多引擎 `site:x.com` → 对 top 结果 oEmbed 拿全文 → 用户查询走 Guest GraphQL（匿名 token 缓存 2h）。三个自愈机制：GraphQL 的 queryId 从 X 的 JS bundle 里重新提取（X 改版轮换后自愈）、guest token 401/403 自动重铸、HTML 实体全量解码。

凭证安全也反转了：pi 版**自动**复用 grok 凭证（有争议）；dsh 版必须 `/x-login` 显式导入——opt-in 才是对的。

## 两个开倒车的地方（作者自评）

1. **删掉了 pi 版的自适应剪枝**：所有变体×引擎一次性全并发。结果是 api 层 complex 档每个额外变体都无条件烧 Tavily credit。替代物是"慢腿竞速"（Antigravity CLI 这条腿限 12 秒，防止 27s 的慢查询拖死整批）——**正确做法是两者都要：剪枝 + 慢腿预算**。
2. **缓存从磁盘降级为内存 LRU**（200 条上限）：重启即冷、多会话不共享。换发布友好，但工程上是退步——要回磁盘（或 SQLite）。

## 一个有争议的玩法：把别家 IDE 当引擎

complex 档会调用 **Antigravity IDE 的 CLI（agy）当搜索引擎**（92% 成功率、27 秒延迟）。用 JSON schema 强约束输出。当作锦上添花可以，但依赖本机登录态、模型名硬编码、随时会被上游破坏——**不要把别家的客户端当稳定引擎腿**。

## 融合打分的改进

引入了 xAI 开源的 x-algorithm 的两个软衰减因子：同域第 2 条结果 ×0.7（替代 pi 的硬截断）、单引擎命中 ×0.9（跨引擎一致才满分）。比 pi 的加权求和多了可解释性，但仍不是 RRF——RRF 还是目标，这两个因子可以叠加保留。

## 值得保留进 search-core 的清单

| 保留 | 原因 |
|------|------|
| 免费层四路并行 | 零配置默认的第一验收标准 |
| SSRF 守卫整模块（含 TUN 豁免、逐跳校验、字节上限） | pi 版裸奔不可接受 |
| 缓存存原文 + focus 读时过滤 | 一页服务多角度，缓存命中率倍增 |
| x-algorithm 软衰减 | 比硬截断优雅 |
| provider seam 劫持思想 | 插件形态的最佳接入方式 |
| 政策 section + 动态 status section | 模型每轮都知道自己处于什么搜索配置 |

## 证据指路

- 原始报告：`reports/10-dsh-search-boost.md`（全文，与 02 配对阅读）
- 源码：`analysis/dsh-search-boost/source/`（lib/ssrf.js 182 行、lib/fusion.js 软衰减 :356-375、docs/AUDIT.md 作者自审）
