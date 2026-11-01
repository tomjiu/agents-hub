# wigolo 深度解剖报告（Task 8-a）

> 仓库：https://github.com/KnockOutEZ/wigolo（clone 到 /tmp/wigolo，depth 50）
> 版本：v0.2.1，AGPL-3.0，TS。src 约 78.6k 行 TS + tests 约 126.6k 行（测试比源码还多 60%）。
> 方法：README/docs/tools.md/tool-schemas.ts + fetch/search/cache/research 各核心文件精读，行号均来自 HEAD（c6ad447）。
> 本报告所有源码引用均为**研究用途引用**（AGPL 边界见文末）。

---

## 一句话总结

**wigolo 就是 search-core 的"满血版未来"**：同一个定位（local-first、免 key、MCP 出口、多引擎融合），但它把每个环节都做穿了——10 工具全生命周期、18 引擎适配器 + 熔断器/软截止并行池、五层抓取阶梯（HTTP→UA轮换→TLS 伪装→无头→解题梯）、挑战页永不当内容返回的诚实契约、SQLite(FTS5+sqlite-vec) 把缓存变成第二搜索面、可解释 evidence_score。它 78k 行源码我们 3.5k 行——**它有我们没有的至少 15 件，但它的体量也告诉我们：该抄的是"契约和判定信号"，不是代码行数**。

---

## 仓库速览

| 项 | 数字/事实 |
|---|---|
| MCP 工具 | 10 个：search / fetch / crawl / cache / extract / find_similar / research / agent / diff / watch（`src/server/tool-schemas.ts:578-589`） |
| 搜索引擎适配器 | 18 个文件（bing/bing-news/brave/brave-image/ddg-image/duckduckgo/github-code/hn-algolia/lobsters/marginalia/mdn/mojeek/semantic-scholar/stackoverflow/wikipedia/arxiv/crates-io/devdocs）+ RSS 引擎 + SearXNG legacy provider + 可插拔 plugin（`tests/fixtures/plugins/valid-search-engine/`） |
| 垂直路由 | 6 个 vertical：general/news/code/docs/papers/images（`src/search/core/verticals/`），每个 vertical 一份引擎花名册 |
| 出口形态 | MCP(stdio/HTTP) + REST(openapi+firecrawl 兼容) + daemon + CLI + TS/PY SDK + LangChain/CrewAI/LlamaIndex/Vercel AI SDK 包 + SKILL.md + 9 个 agent 一键安装器（`src/cli/agents/`） |
| 本地栈 | better-sqlite3 + sqlite-vec(vec0,384维) + FTS5 + fastembed(fastembed-rs napi) + Playwright 1.60 + wreq-js(TLS 伪装,napi,可选依赖) |
| 近期迭代主题（git log 近 50 条） | antibot-mode、clearance 复用、fetch 阶梯修复、失败元数据契约转发、缓存代理凭据脱敏——**全部在打磨"抓取可靠性+诚实输出"** |

---

## 架构图（文字版）

```
                          ┌────────────── 10 个 MCP 工具（统一 4 个全局旋钮）──────────────┐
                          │  search  fetch  crawl  cache  extract  find_similar          │
                          │  research  agent  diff  watch                                │
                          └──────┬───────────────────────────────────────────────────────┘
                                 │  全部走同一个 handle 调 core；同一契约也暴露成 REST/SDK
   ┌─────────────────────────────┼──────────────────────────────────────┐
   │ search 管线                                                                  │
   │  query(可传数组=多变体并行) → query-understanding(意图/实体/改写/品牌碰撞)      │
   │   → vertical 路由(6 种) → 各 vertical 花名册                                  │
   │   → runEnginesParallel(软截止+慢引擎专项预算)                                 │
   │        每个引擎 = adapter × wrapWithRetryAndBreaker(重试+熔断+节流)            │
   │   → scoreOutcomes: 加权 RRF(k=60) → authority/品牌碰撞修正 → 证据分分解         │
   │   → 三种救援波: 域名回灌 / 降级恢复波 / 饥饿补发(general 池)                    │
   │   → foldRerankIntoOrdering(本地 cross-encoder, tier 编码)                     │
   │   → evidence[]+citations[](source_span 可逐字引用) + token 预算裁剪            │
   ├──────────────────────────────────────────────────────────────────────────────┤
   │ fetch 管线（SmartRouter 阶梯）                                                │
   │  cache 先查(带 stale 标注) → mode 分派(cache/default/stealth)                 │
   │  default 阶梯: HTTP ─(裸403)→ UA轮换重试1次 ─(反爬信号/2xx挑战壳)→ TLS伪装层    │
   │     ─(仍挡/SPA壳/薄内容)→ Playwright 池(可 stealth 加固) ─(挑战)→ solve-ladder │
   │  终端守卫 guardChallengeShell: 挑战壳永远不作为内容返回 → blocked_by_challenge │
   │  每一层信号都写回 domain_routing(自学习): prefer_tls/prefer_playwright/backoff │
   ├──────────────────────────────────────────────────────────────────────────────┤
   │ 本地知识层                                                                    │
   │  SQLite: url_cache(原文+markdown) + url_cache_fts(BM25) + vec_documents(384d) │
   │          + search_cache + domain_routing(自学习/清除凭据/backoff) + etag      │
   │  fetch/crawl/search 落库 → cache 工具(fts/hybrid) 与 find_similar(三路RRF)    │
   │  都把这层当"免费第二搜索面"; 后台队列补 embedding, 变更检测+LCS diff 驱动 watch │
   └──────────────────────────────────────────────────────────────────────────────┘
```

---

## 精读点 1：10 个 MCP 工具的响应契约

**位置**：`docs/tools.md`（全文 225 行就是契约书）+ `src/server/tool-schemas.ts`（589 行 schema）+ `src/types.ts`（输出类型）。

关键设计：

1. **一套工具四种出口**：MCP(stdio/HTTP)、REST、SDK、CLI 用**同一套参数名**（docs/tools.md:3），不存在"REST 版参数和 MCP 版对不上"的漂移。REST 还有 openapi.ts 和 firecrawl 兼容层（`src/daemon/rest/firecrawl-compat.ts`）。
2. **四个全局旋钮所有工具共享**（docs/tools.md:7）：`max_tokens_out`（cl100k 计数的总输出预算）、`include_full_markdown`（默认只回 evidence 摘录）、`citation_format`（numbered/json/anthropic_tags 三态）、`force_refresh`。
3. **search 输出的"诚实元数据"字段是标配**（docs/tools.md:39-41）：
   - `engines_used` / `engine_telemetry[]`（name、latency_ms、result_count、outcome、dedup_kept）
   - `engine_warnings[]`（引擎挂了，代码稳定可 match：`http_401`/`needs_key`/`timeout`/`dns`/`error`）
   - `engine_pool`（健康池状态：`{healthy,total,degraded,reasons[]}`）
   - `query_understanding`（intent/entities/date_hint/language/rewrites）
   - 四段时间：`total_time_ms / response_time_ms / search_time_ms / fetch_time_ms`
4. **search 参数面**：`query` 可以传**数组**（多变体并行+融合去重）、`search_depth` 四档、`mode` 三态、`agent_context`（{text, recent_urls, intent}——把"agent 已经看过的 URL"传进来做去重和排序偏置，tool-schemas.ts:218-228）。这个 `agent_context.recent_urls` 是很聪明的一招：会话级去重不用服务端记状态。
5. **fetch 的错误是结构化 StageError**：`{ok:false, error, error_reason, stage, hint, http_status, challenge_class, solve_method}`（`src/tools/fetch.ts:273-287`）。`cache_miss` 都带 hint 告诉调用方下一步干嘛（fetch.ts:244-252）。
6. **crawl 四策略**：bfs/dfs/sitemap/map（map=只发现 URL 不抓内容），默认尊重 robots.txt + 每域限速 + ETag 增量。
7. **cache 工具** = 本地知识库查询面：`mode: fts|hybrid`、`check_changes`（重抓匹配 URL 报告变了没+diff 摘要）、`stats`、`clear`（强制至少一个过滤条件防误删）。
8. **watch 是"惰性执行"**：没有后台 daemon，job 过期了在下一次任何工具调用时顺带检查（tool-schemas.ts:539-540 注释明说）。诚实——不假装有常驻调度。
9. **agent 工具**带 `steps[]`（完整 plan/execute/synthesize 日志）和显式 `warning`（schema 没满足/抓取失败都标注，docs/tools.md:182）。

**和我们的差距**：我们的 search/fetch 返回 `{refs, meta:{engines_used, engines_failed, elapsed_ms}}`，meta 只有引擎名字数组，没有 per-engine telemetry/warning code/pool 状态；没有全局 token 预算；没有 citation 三态。

---

## 精读点 2：18 引擎适配器的抽象

**位置**：`src/search/core/engine-base.ts`（584 行，抽象核心）+ `src/search/engines/*.ts`（每个 68-141 行）+ `src/search/core/verticals/*.ts`（花名册）。

### 契约极简

```ts
// src/types.ts:981
export interface SearchEngine {
  name: string;
  search(query: string, options?: SearchEngineOptions): Promise<RawSearchResult[]>;
}
```

**新增一个引擎 = 一个 ~80 行的类文件 + 花名册里一行注册**。DDG 适配器全文 83 行（`src/search/engines/duckduckgo.ts`）：lite.duckduckgo.com 直抓 + linkedom 解析 + 从 snippet 前缀猜发布日期。

### 注册表才是精华：EngineEntry 带行为元数据

```ts
// src/search/core/engine-base.ts:31-60（研究用途引用，节选）
export interface EngineEntry {
  engine: SearchEngine;
  weight?: number;              // RRF 权重
  supportsDateFilter?: boolean; // 是否吃 from/to 日期过滤
  secondary?: boolean;          // 次要信号: 仅它命中且词法对齐差时降权 0.3
  quality?: EngineQualityTier;  // 'high'|'medium'|'low' — 结构化 API=high, 抓 HTML=medium, 元数据表=low
  disabled?: boolean;           // 软禁用: 上游死了但文件留着不删
  probeOnly?: boolean;          // 不进主波,只在"降级恢复波"里救场
}
```

每个引擎被 `wrapWithRetryAndBreaker()` 包一层（engine-base.ts:401-498），得到：重试(默认1次，指数退避100/300/900ms)、熔断(3 败跳闸)、**失败分类冷却**（429=瞬态 5s 且不计入慢性计数；403=持久冷却+指数退避封顶 3 分钟，engine-base.ts:145-177）、半开探针（冷却到期只放一个探测请求进）、卡死探针回收、per-engine 最小间隔节流（Marginalia 2 秒，engine-base.ts:183；调用太密直接抛 ThrottledError 跳过而不是排队）。还有 `onRetry()` 钩子：DDG 被封时重试前轮换 UA（duckduckgo.ts:23-25）。

### 并行池带"软截止"（engine-base.ts:504-584）

`runEnginesParallel` 不等最慢引擎：全局 `softDeadlineMs` 一到，未返回的引擎标记 `timedOut:true` 放弃等待（底层请求继续跑，晚到的结果还能进缓存）；**慢性病引擎**（sessionTrips≥3）只给更紧的 `chronicSoftDeadlineMs` 预算。全部数据驱动，不特判引擎名。

### 垂直花名册示范（general.ts:27-59）

general = Bing(1.0) + DDG(1.0) + Wikipedia(0.6, quality:high) + Mojeek(0.8, secondary, quality:low, **probeOnly 默认开**——"它对多数调用方 403，主波里就是每次调用的延迟税") + Marginalia(0.6, secondary, min-interval 2s)，配了 Brave key 才追加 Brave(1.1)。注释直说设计哲学："**池的多样性比权重精确更重要**——每个独立词法信号都在稀释单引擎的品牌歧义"。

**和我们的差距**：我们 4 个 provider，Provider 接口只有 `name/needsKey/isConfigured/search`；HealthTracker 是"6 连败熔断 10 分钟+滚动衰减"一把梭（providers/base.ts:32-33），不分 429/403、没有半开探针、没有软截止（Promise.allSettled 等最慢）、没有质量分层、没有 probeOnly。**这正是 targets-search.md 要扩池到 10+ provider 前必须补的地基**。

---

## 精读点 3：分层抓取路由（阶梯有几档、升级信号是什么）

**位置**：`src/fetch/router.ts`（1694 行 SmartRouter）+ `tls-tier.ts`（743 行）+ `playwright-tier.ts` + `solve-ladder.ts` + `browser-pool.ts`。

### 阶梯全貌（default mode，router.ts:945-1445）

```
第0档 cache 模式: 纯 HTTP + 紧超时, 永不升级; 探测 jsRequired 但只标注不升级 (L1058-1079)
第1档 纯 HTTP (undici fetch)
第1.5档 裸403 → 用轮换的桌面 UA 原地重试恰好一次 (L1218-1235)
第2档 TLS 指纹伪装层 (wreq-js, 浏览器级 JA3, 可选 napi 依赖) (L1189-1196, L1311-1315)
第3档 Playwright 无头 (浏览器池, 可按需 stealth 加固)
第4档 solve-ladder 解题梯: interactive→auto-pass(可信手势) / image→ai-vision(LLM看图) / 兜底 human (solve-ladder.ts:89-132)
逃生舱: Reddit OAuth API 直连(reddit 被IP信誉墙挡时的"走正门"方案, L955-970)
```

### 升级判定信号（这是最值钱的部分）

| 信号 | 实现 | 触发升级到 |
|---|---|---|
| 反爬状态码 403/429/503 | `isAntiBotStatus`（tls-tier.ts:410） | TLS→浏览器 |
| Cloudflare 挑战头 `cf-mitigated: challenge` | `hasChallengeHeader`（tls-tier.ts:427，零误报——正常页面不会发） | 直接判挑战 |
| 挑战体标记（cf-browser-verification / "Just a moment" / DataDome sensor） | `hasChallengeBody` | TLS→浏览器 |
| **2xx 挑战壳**（DataDome 在 200 上发挑战） | `isChallengeShell`（tls-tier.ts:706-720）：2xx + 挑战标记 + 挑战页骨架，两个条件都要，防误伤引用了"Just a moment"的正常文章 | TLS→浏览器 |
| 反爬状态 + 大体积全脚手架低文本密度 | `isLowContentDensity`（厂商无关的通用墙规则，"每来一个新厂商不用加字符串"） | 判挑战壳 |
| 429 无挑战体 | `isRateLimit`（tls-tier.ts:681）——**这是限速不是墙，升级浏览器没用**：记 Retry-After 回退窗（clamp 防恶意大值），直接透传 429 | 不升级，进回退窗 |
| SPA 空壳 | `contentAppearsEmpty`（仅 2xx 才判，4xx/5xx 是错误页不是水合壳，L1364-1383） | 浏览器 |
| "enable javascript" 字样 / 正文<500 字符 | `shouldEscalate`（playwright-tier.ts:25-30） | 浏览器 |
| 连接超时（墙在返回状态码前就掐线） | `isConnectionTimeout` → 补一发 TLS 层（L1420-1427）；StackOverflow 全网络预置在 `ANTI_BOT_TLS_DOMAINS` 直连 TLS 档（L84-91） | TLS |
| 域名自学习 | 挑战/SPA/失败阈值都置 `stats.preferPlaywright=true` 粘住；反之已知 SPA 域名 plain HTTP 就能出正文则**降级**回 HTTP（L1393-1396）；TLS 层连续成功后持久层把域翻成 `prefer_tls_impersonation=1` | 双向学习 |
| 每域 429 回退窗 | `backoffWindowResult`（L1507-1524）：窗口内**合成一个 429 返回，根本不碰源站** | — |

**误报防线**也做得细：裸 403（管理员页面的正常 403 HTML）不升级直通；挑战标记必须配骨架/状态码才算数；PDF/二进制走字节层永不进浏览器（浏览器把下载当硬错误）。

### 终端守卫：挑战壳永不漏网

```ts
// src/fetch/router.ts:880-901（研究用途引用，节选）
private guardChallengeShell(raw: RawFetchResult): RawFetchResult | StageError {
  if (isChallengeResponse(raw.statusCode, raw.html, raw.headers)) {
    const err = new ChallengeBlockedError(raw.url);
    return {
      error: err.code,            // blocked_by_challenge
      error_reason: err.message,
      stage: 'fetch',
      hint: err.hint,
      ...(isAntiBotStatus(raw.statusCode) ? { http_status: raw.statusCode } : {}),
      ...(challengeClass !== undefined ? { challenge_class: challengeClass } : {}),
      solve_method: null,         // 没有梯子档解开它 — 诚实标注
    };
  }
  return raw;
}
```

每个可能出口到调用方的返回点（http-only 模式、TLS 终点、升级耗尽、stealth 降级）都包了这层守卫——**结构性保证验证码页永远不会被当成页面内容**。

**和我们的差距**：我们 fetcher 是单层 fetch + 手动逐跳 SSRF + 用 `captcha/unusual traffic/access denied` 三个关键词检测（fetcher.ts:14,111-114），命中就 throw 一个普通 Error——没有结构化标注、没有升级链、没有学习。我们的 Tier 1 应该抄：**①挑战检测信号集（cf-mitigated 头 + 挑战体标记 + 低密度规则）、②blocked_by_challenge 结构化错误、③裸403换UA重试一次**。TLS 伪装层和 Playwright 做成可选插件（参考他们把 wreq-js 做成 lazy 可选依赖、探测到未装就 `tls_tier_unavailable` 干净降级的做法）。

**一个要泼的冷水**：wigolo 的 **SERP 引擎适配器本身没有 TLS 伪装**——DDG 适配器就是裸 fetch+UA 轮换打 lite.duckduckgo.com。TLS 伪装层装在 fetch 链路上（StackOverflow 等内容站），不是 SERP 链路。所以我们对抗"DDG JA3 指纹封 202 空页"还得靠 ddgs 的 primp 思路（targets-search.md P2 已列），别指望抄 wigolo 这段就够。

---

## 精读点 4：失败标注（degraded / blocked_by_challenge）怎么打进响应、调用方怎么消费

三层标注体系，全部默认输出（不藏在 debug 开关后面）：

**① 引擎级**：`engine_telemetry[]` 每引擎一行（outcome: ok/error/skipped/timed_out，latency，result_count，dedup_kept）。`src/search/core/engine-warnings.ts` 把 error 遥测升格成 `engine_warnings[]`——注释里写明了动机（engine-warnings.ts:4-10）："lobsters 400 和 github-code 401 之前对普通调用方完全不可见，响应看起来成功但一个引擎已经全挂——把错误提升为默认输出的顶层字段，恢复用户信任"。错误码从错误文本里稳定提取（`http_<code>`/`needs_key`/`timeout`/`dns`），needs_key（适配器拒绝无 key 派发）和 401（key 被拒）是**两个不同的码**，401/403 还会附上 env var 修复提示（如 `WIGOLO_GITHUB_TOKEN`）。

**② 池级**：`EnginePoolHealth {healthy, total, degraded, reasons[]}`，reasons 是可 match 的枚举：`degraded_recovery`（主波健康数过半不达标→强制补一发 probeOnly 引擎+被熔断引擎的恢复波，orchestrator.ts:610-667）、`starvation_redispatch`（垂直池结果<3 → 拉 general 池回灌，orchestrator.ts:669-722）、`pool_collapsed`（真正的坍缩信号，是下游"零词法垃圾闸门"的唯一开关，orchestrator.ts:734-743）。

**③ fetch 级**：上面讲的 StageError（`blocked_by_challenge` + `challenge_class`（interactive/image/behavioral/none）+ `solve_method`（auto-pass/ai-vision/human/null））。消费方示例：crawl 的限速器读 `http_status` 自适应降速（fetch.ts:267-269 注释）；solve-ladder 的诚实姿态写在注释里（solve-ladder.ts:8-11）："behavioral/none 类挑战一个 rung 都不跑——没有图可读没有钮可点，烧 LLM 或手势是不诚实的工作，返回 `{solved:false, solveMethod:null}`"。

**缓存侧也有诚实标注**：stale 命中打 `stale:true`；缓存里存的是"壳"（上次抓了个水合空壳）→ 自动重抓一次但只一次（防循环，fetch.ts:228-240）；模式 cache 下 miss 返回结构化 `cache_miss` + hint。

**和我们的差距**：我们 `engines_failed` 只是名字数组，调用方（agent）无法区分"429 限速过会儿再试"和"403 被墙别试了"；没有 pool 级 degraded 信号；没有 challenge 分类。**这是本次对比里我认为最值得原样学走契约形状的一条**（形状可学，字段名我们自己起，见 AGPL 边界）。

---

## 精读点 5：cache 即搜索面 + find_similar

**位置**：`src/cache/db.ts` + `sqlite-vec-store.ts` + `src/search/find-similar.ts`（838 行）+ `src/embedding/`。

### 存储层

- 一个 SQLite 文件（`~/.wigolo/wigolo.db`，**0600 权限**——里面存着 cf_clearance 反爬通行 cookie，db.ts:74 注释明说）：`url_cache`（原文+markdown+状态码+completeness）+ `url_cache_fts`（FTS5 全文索引）+ `vec_documents`(vec0 虚表, float[384]) + `vec_id_map` + `vec_metadata` + `search_cache` + `domain_routing`（TLS/Playwright 自学习+backoff）+ `crawl_etags` + `watch_jobs`，迁移用带编号的 SQL 文件（`migrations/001-010`）。
- 每次 fetch/crawl/search 抓到的页面**先落库再后台补 embedding**（background-queue + backfill-embeddings 迁移工具兜底）。
- 向量检索：sqlite-vec KNN，L2 距离转相似度 `1/(1+distance)`（sqlite-vec-store.ts:201）；带过滤时 over-fetch 5 倍再后过滤（vec0 的 MATCH 没法和 JOIN 谓词同 WHERE，L130-133——这是个值得记住的实现坑）。

### find_similar 的三路 RRF

```
输入: url 或 concept
信号准备: 种子页从缓存/现抓 → extractKeyTerms(关键词) + queryText(全文喂 embedding)
Phase 1 (并行, 全本地): FTS5 BM25 (≤20 候选) + embedding 向量检索 (≤20 候选)
Phase 2: 本地命中 < max_results 才用 key terms 发 web search 补; 补完顺手把新页 embed 完再查一遍向量
Phase 3: 三路 rank map → reciprocalRankFusion 三路 RRF
输出: results[] + method(用了哪几路) + cache_hits/search_hits + cold_start 提示(本地信号太弱时告诉你先 crawl 什么)
     + threshold(对原始 fused_score 硬过滤, 空结果是正确答案不是 bug)
     + include_ranking_debug → 每条带 {fts5_rank, embedding_rank, web_rank, rrf_score} 审计三路分歧
四种模式: auto / cache / web-expansion / crawl-rank(从种子 1 跳爬一圈→逐页 embed→cosine 排序)
```

**embedding 供应商是可插拔的**（`src/providers/embed-provider.ts` 工厂），默认 fastembed（本地 ONNX，384 维，零 key）；reranker 同理（`transformers-rerank-provider`）。**没有任何一步要求 key**。

### cache 工具 = 同一个库的第二张脸

`mode:fts|hybrid`（hybrid=BM25+向量再用 RRF 融合）、`check_changes`（重抓+变更检测，diff-engine 是自写 LCS，`src/cache/lcs.ts`）、`clear` 强制带过滤条件。

**和我们的差距**：我们 cache 只有 `pages` 表 + TTL 查询 + `search_cache` 结果缓存，**没有 FTS5、没有向量索引**——被缓存的正文是"死数据"。targets-search.md P2 第 3 条"本地缓存索引（cache 即搜索面）"在 wigolo 里有完整蓝图。我们用 node:sqlite，FTS5 一条 `CREATE VIRTUAL TABLE` 就能起步（零依赖），sqlite-vec 后续再说。

---

## 精读点 6：evidence_score 分解（final 怎么算出来的）

**位置**：`src/search/core/orchestrator.ts:439-561`（scoreOutcomes）+ `src/search/core/rerank-fold.ts` + `src/types.ts:908-942`（EvidenceScore 类型）。

### 第一阶段：scoreOutcomes 的乘法公式

```ts
// src/search/core/orchestrator.ts:470,517-528（研究用途引用，节选）
const base = weight / (RRF_K + rank);                    // 加权 RRF, RRF_K=60
const recMul = wantsRecency ? recencyMultiplier(r.published_date) : 1.0;
fused.set(key, (fused.get(key) ?? 0) + base * recMul);   // 跨引擎累加
// ...每条结果:
const final = base * dq * (0.5 + 0.5 * la) * secondaryPenalty * rtf * undatedMul;
//   dq=domain_quality 域名质量; la=lexical_alignment 词法对齐(0-1);
//   secondaryPenalty=仅次要引擎命中且 la<0.5 → 0.3; rtf=rare-term 因子;
//   undatedMul=时间敏感查询下无日期降权
```

同时把每个成分写进 `evidence_score.components`：`base_rrf / context_cosine / domain_quality / lexical_alignment / recency_boost / engine_consensus(=几引擎给过这条 URL,primary+secondary 分开计数) / rare_terms`，外加一行人话 `explanation`（`explainEvidence()` 拼的）。`relevance_score === evidence_score.final`，两个字段并存——一个用来排序一个用来解释。

### 第二阶段：rerank-fold 覆盖 final（本地 cross-encoder）

```ts
// src/search/core/rerank-fold.ts:188-202（研究用途引用，节选）
const tier = rareMiss || lexicalMiss ? 0 : logitTier;    // 两道垃圾闸门
const blend = 0.5 * normComposite(relevance_score) + 0.5 * nr;
const finalScore = s.tier === 1 ? 0.5 + 0.5 * s.blend : 0.5 * s.blend; // tier 编码进分数
```

- 窗口 20 条（deep=全量），重排输入 = title+snippet+**host**（host 让模型知道这是 docs 站还是词典站，rerank-fold.ts:30-45）。
- **垃圾闸门 a（词法）**：零词法重叠 + 仅单引擎命中 → 强制 tier-0。"降级池的独苗返回一个不沾边的页面"就是它防的事故。
- **垃圾闸门 b（稀有复合词）**：query 里的连字/下划线/数字后缀复合词一条都没命中 → 不允许单靠 cross-encoder 分数进 tier-1（重排 logit 按查询 miscalibrated，短垃圾 snippet 能骗高分）。
- **全垃圾批校准**：整批最高 logit < 0 → 归一化直接塌成 0.5，不给"最不烂的垃圾"发满分。
- tier 编码进 final（tier-1∈[0.5,1]，tier-0∈[0,0.5]）：调用方按分数重排也翻不了序。

**和我们的差距**：我们 fusion 的 score = `rrf*10 + lex*1.5 + multiEngineBoost*0.02×n`（fusion.ts:99），加法混合、成分不外露、没有域名质量、没有解释。**改造方案很直接**：把我们的三个成分（rrf/lexical/consensus）照他们的形态暴露成 `score_breakdown`，公式不用换——可解释性是契约问题不是算法问题。

---

## 精读点 7：rank fusion 与 RRF 的异同

**位置**：`src/search/rrf.ts`（58 行）+ `orchestrator.ts`。

**相同**：教科书 RRF，k=60，`Σ 1/(k+rank)`，URL 归一化（canonical-url.ts 去追踪参数）后跨引擎合并，同分稳定排序。find_similar 的三路融合、cache hybrid 模式的 BM25×向量融合**复用同一个 `reciprocalRankFusion()`**——一处实现三处用。

**不同（wigolo 在 RRF 外加的四层，值得逐条对照）**：
1. **每引擎 weight 乘子**：`weight/(k+rank)` 而不是裸 `1/(k+rank)`——weight 又是 quality tier 推出来的（high=1.2/medium=1.0/low=0.8 一类的解析规则，`resolveEngineWeight`）。
2. **recency 乘子在累加前**：日期近的结果 RRF 贡献直接放大，时间敏感查询生效。
3. **共识不直接加分而是做闸门**：我们的 multiEngineBoost 是共识×0.02 加分；他们的 engine_consensus 主要用于①secondary 降权判定 ②重排的 lexical gate（单引擎+零词法→压 tier-0）③解释字段。共识是"信任度"不是"分"。
4. **乘法修正链**：RRF 粗排后 domain_quality × 词法对齐 × rare_terms × undated 一路乘下去，再被 cross-encoder tier 编码覆盖 final。

**结论（印证 Task 7 b 报告的判断）**：融合骨架大家都还是 RRF；wigolo 的优势全在 RRF **外**的信号工程（质量权重/共识闸门/领域质量/重排）和**可解释性**。我们 fusion.ts 的骨架不用动，要动的是外圈的信号。

---

## 精读点 8：其他值得记的设计（速记）

- **search_depth 四档**（tool-schemas.ts:213-217）：`ultra-fast`=纯缓存≤300ms（miss 时 notice+空结果）、`fast`=只引擎≤1s 不抓正文不重排、`balanced`=全管线、`deep`=满血富化。**这个和我们的 Governor 预算池是天然一对**——四档本质就是预算档位。
- **hybrid 后端 fallback_signal**（`src/search/hybrid/`）：core 引擎结果 + 信号评估（品牌碰撞：query 是常见名词、top-1 主机名= query 词、标题重叠<0.3，signals.ts:41-63；include_domains 过滤过度；空结果）→ 触发就融合 SearXNG sidecar 二次结果，并在响应里带 `fallback_signal` 说明为什么回退。**回退本身也要可解释**。
- **query_understanding**：意图/实体/日期提示/语言/品牌碰撞倾向/候选改写，第一类结果给 `brand_collision_warning` + 改写建议（orchestrator + brand-collision.ts）。
- **研究/agent 输出结构**：research brief 带 `key_findings[]` + 逐条 `key_finding_sources`（每个论断的出处）+ `overview.cross_references`（多源互证）+ `gaps`（源没覆盖什么——"读 gaps 再决定信不信完整性"，docs/tools.md:163）。agent 带 `steps[]` 全日志。
- **token 预算工程**：max_tokens_out 是**聚合预算**（evidence/citations/markdown 总量），先算骨架 JSON 的 token 数再分剩余（evidence.ts:219-232）；智能截断在段落/标题边界切并打 `[... content truncated]` 标记。
- **citation_id 稳定性**：`sha1(url#span_start) 前 12 位`（evidence.ts:170-172）——同一来源同一位置跨调用拿到同一个 id，agent 的引用可对账；`source_span` 给出原文精确字符区间，可逐字引用。
- **watch/diff**：惰性调度 + SSRF 守卫的 webhook + 0600 权限库；diff 是自写 LCS（line/word/section 三粒度）。
- **测试基准文化**：`benchmarks/search/`（relevance fixtures + 指标 + pre-v1 基线文本）、`tests/fixtures/search-parity-snapshot.json`（搜索行为快照回归）、golden files（repl 输出金样）。**每次改排序/改抓取都对着基线跑**——这是他们 2005 commits 不腐化的原因。

---

## 「它有我们没有」对照表

> 我们 = search-core v0.2（core/src，3.5k 行）。判定：**抄**=照形状实现（自己的代码）；**改造**=按我们体量裁剪后再上；**避免**=不要学/暂缓。

| # | 它有 | 我们现状 | 判定 |
|---|---|---|---|
| 1 | 失败三契约：per-engine `engine_telemetry`+`engine_warnings`（http_401/needs_key/timeout/dns 可 match 码+修复 hint）、池级 `engine_pool{degraded,reasons[]}`、fetch 级 StageError{challenge_class,solve_method,http_status} | `engines_failed` 只有名字数组，fetch 抛裸 Error | **抄（第 1 优先）** |
| 2 | 终端守卫：挑战壳（cf-mitigated 头/挑战体标记/2xx+骨架/低密度规则）永不作为内容返回，统一映射 `blocked_by_challenge` | 3 个关键词检测后 throw，无结构化标注 | **抄** |
| 3 | 熔断器精细化：429=瞬态短冷却不计慢性 / 403=指数退避封顶 3min / 半开探针只放一个 / 卡死探针回收 / per-engine 最小间隔节流 | HealthTracker 6 连败→10 分钟，一律同罚 | **抄** |
| 4 | 并行池软截止：`softDeadlineMs`+慢性引擎专项预算+`timedOut` 标注（晚到结果进缓存不阻塞响应） | `Promise.allSettled` 等最慢引擎 | **抄** |
| 5 | EngineEntry 注册表元数据：weight/quality(high·medium·low)/secondary/probeOnly/disabled 软禁用 | Provider 只有 name/needsKey/isConfigured | **抄**（扩池到 10+ 前的地基） |
| 6 | 垂直花名册：6 verticals×按需引擎组合+权威源权重高+次要引擎降权 | planner 只有 route(github/x) 硬编码 | **改造**（按我们 6 大块蓝图切 vertical） |
| 7 | fetch 阶梯：裸403→换UA重试1次→TLS伪装(wreq-js 可选依赖)→Playwright→solve-ladder（auto-pass/ai-vision/human 三档解题） | 单层 fetch，无升级链 | **改造**（先抄 UA 重试+信号集；TLS/Playwright 做可选插件，探到未装干净降级） |
| 8 | 域名自学习路由：prefer_tls/prefer_playwright 粘性标记+已知 SPA 域降级回 HTTP+429 回退窗（窗口内合成 429 不碰源站，Retry-After clamp） | 无 | **抄**（至少先抄 429 backoff window，一张表的事） |
| 9 | score 可解释：evidence_score{final,components,explanation}，relevance_score=final 双字段并存 | score 加法混合无分解 | **抄**（把 rrf/lex/consensus 三个成分暴露出来，公式不用换） |
| 10 | search_depth 四档（ultra-fast 纯缓存/fast 只引擎/balanced/deep）+ mode 三态 + agent_context.recent_urls 会话去重 | 无深度档 | **抄**（四档直接映射 Governor 预算档） |
| 11 | cache 即搜索面：FTS5+sqlite-vec 混合检索、find_similar 三路 RRF、cold_start 提示、ranking_debug 审计、check_changes 变更检测 | cache 只做 TTL 查询，正文是死数据 | **改造**（先上 FTS5 一条 DDL；向量+find_similar 排 v0.3） |
| 12 | 聚合 token 预算 max_tokens_out（骨架先行计费）+ 段落边界智能截断 | per-fetch maxChars 硬切 | **改造**（fetch 先加段落边界截断） |
| 13 | 引用工程：citation_id=sha1(url#span) 稳定可对账 + source_span 逐字引用 + citation_format 三态 | citations.ts 有编号引用但无稳定 id/span | **改造**（span+稳定 id 收益高） |
| 14 | 研究输出 gaps/cross_references（源没覆盖什么+多源互证）；agent 带 steps 日志 | research loop 有反思但无 gaps 结构 | **改造** |
| 15 | 出口全家桶：REST(openapi+firecrawl 兼容)+SDK×4+9 agent 安装器+mcpb+SKILL.md | MCP+CLI+REST+SSE | **改造**（SKILL.md 一份先做，安装器抄思路——`src/cli/agents/claude-code.ts` 每家就几十行） |
| 16 | 本地 cross-encoder 重排（fastembed/transformers）+ 两道垃圾闸门 + 全垃圾批校准 | 无 | **避免**（短期太重；垃圾闸门思路并入 fusion 词法层即可） |
| 17 | hybrid 双后端 fallback_signal（core+SearXNG sidecar） | 无 | **避免**（我们没有 sidecar 架构需求；信号判定的思路可并入 planner） |
| 18 | watch/diff/crawl（robots+ETag 增量+LCS diff）、extract 七模式（schema 防幻觉：LLM 字段对不上源返回 null） | 无 | **避免/暂缓**（用户蓝图里的爬虫块到 v0.3 再参考它：sitemap-first+ETag 增量+每域限速三件套值得回头看） |

**它也有短板**（防止我们神化它）：①SERP 适配器本身无 TLS 伪装，DDG 还是裸 fetch+UA 轮换打 lite 端点——我们防"202 空页"仍需 ddgs 的 impersonate 方案；②重装包重（Playwright+fastembed+wreq-js，README 自认 1.5GB 磁盘）；③AGPL 传染（见下）；④78k 行 src 的维护面是我们 20 倍，我们不该追体量。

---

## AGPL 边界说明（只学思路不抄码）

wigolo 是 **AGPL-3.0**（LICENSE 首行 + README badge），我们 search-core 是 **MIT**。规则要点：

1. **AGPL 是强传染+网络条款**：分发或通过网络提供服务，只要"衍生作品"就必须整体以 AGPL 开源。我们把它的代码（哪怕一个函数、一段翻译过的逻辑）混进 MIT 的 search-core，search-core 就得变 AGPL——这直接违背 search-core 作为可嵌入 core 的定位。**结论：一行都不搬，包括测试 fixtures、README 文案、tool description 措辞。**
2. **可以合法拿走的**：思路、架构、契约形状、算法步骤、常量数值（k=60、阈值 0.3/0.75、冷却 5s/3min 这些数字本身不是版权对象）。我们的实现要：字段/函数/类全部自己命名，结构自己组织，注释自己写。对照表里标"抄"的全部按此执行——抄的是**行为规格**（"挑战页必须映射成带 challenge_class 的结构化错误"），不是**表达**（他们的具体代码）。
3. **灰区自查清单**：看过的逻辑写实现时，关掉他们的代码窗口、只对本报告的"行为规格"段落写——本报告用自己的话复述，可以当干净的设计输入。报告内少量短代码片段仅为研究留证，不回填进 core/src。
4. **依赖不受协议约束的方式**：把可选能力（TLS 伪装、无头渲染、embedding）做成**独立进程/子进程或 optional peerDependency**，主仓 MIT 不含 AGPL 代码。若未来真要复用其代码，唯一正路是把那部分隔离成独立 AGPL 仓库走进程间调用（wreq-js 本身就是这么处理 GPL 家族依赖的先例：做成独立 napi 包）。
5. **自研对标的文档/错误码语义**（http_401/needs_key 这类**码值**）：错误码字符串是函数式接口约定，创意成分极低，可自定义等价码（如我们用 `engine_http_401`/`engine_needs_key`），既得到互操作好处又零风险。

---

## 最值得立刻抄的 3 件事

1. **失败标注契约（对照表 #1+#2+#3 一起做，一个 PR 的事）**：`engines_failed: string[]` 升级成 `engine_telemetry[]`（outcome/latency/count/error_code）+ `engine_warnings[]`（可 match 的码）+ 池级 `degraded/reasons`；fetch 的挑战检测换成 wigolo 的信号集（cf-mitigated 头 + 挑战体标记 + 2xx 壳 + 低密度），输出统一 StageError（error/error_reason/stage/hint/http_status），把 `blocked_by_challenge` 这个命名精神抄过来。**这是 agent 调用方的信任地基，也是我们四引擎扩池到 10+ 前的必需品。**
2. **熔断器 2.0 + 并行池软截止（对照表 #3+#4）**：429 和 403 分开罚（429 短冷却不记慢性）、半开探针、软截止放弃慢引擎但让晚到结果进缓存。改动集中在 providers/base.ts + router.ts 两处，~200 行，直接吃掉"一个引擎拖死整次搜索"和"突发限速把引擎拉黑 10 分钟"两类我们早晚遇到的事故。
3. **cache 即搜索面第一档：FTS5（对照表 #11 的最小闭环）**：node:sqlite 原生支持 FTS5，给 pages 表加一个 fts 虚表+触发器同步，fetch/search 的 `search_cache` 查询前先查本地全文，命中标注 `from_cache`。零新依赖、半天工作量，直接兑现 targets-search.md P2-3 的"重复查询秒回"，为 v0.3 的向量索引+find_similar 铺路。
