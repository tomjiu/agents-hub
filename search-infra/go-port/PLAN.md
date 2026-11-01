# go-port 分期重构计划（TS → Go，质量守恒为第一约束）

**决策**: Go（裁决依据见 PROGRESS Phase AP 与 worklog Task 46）。Rust POC 分支保留为极限下限证据（<32MB 嵌入式场景再启用）。
**第一约束**: **正确性守恒** —— 292 项测试 + 18 轮采样沉淀的实战行为（DDG 202 软封三件套/实例垃圾轮换兜底/gzip 流不规范/UA 政策/合法空判别）必须逐条在 Go 侧复现并由测试锁住。**广度红线**: 任何一期不得削减车道出勤/权威域覆盖/题集广度。
**验收尺**: 每期与 TS v0.8.1 同机同 query 头对头：① 9 题 quality bench L1 9/9（涉及面到位后）② 广度四指标（uniqDom/独占源/kind 多样性/Jaccard）持平 ③ VmHWM 峰值 < 40MB ④ 冷启动 < 50ms ⑤ 单静态二进制。

## Phase P1 — 地基（本次会话目标）

- [x] Go module `go-port/`（stdlib 优先，零第三方依赖起步）——完成 2026-09-04
- [x] 类型层: Reference/Provider/SearchCtx 与 TS 对齐（JSON 输出形状兼容）
- [x] HTTP 层: 统一 UA/gzip/每腿超时(6s)/allSettled 语义(goroutine+channel)/失败隔离报账
- [x] 首批 4 车道全保真移植: keenable(X-Keenable-Title 头)/bingrss(根标记漂移守卫)/searxng(实例链+反爬页伪 200=实例失败纪律)/wikipedia(官方 API+description 优先)
- [x] fusion-lite+: RRF×10 + lex×1.5 + titleBonus + consensus 0.35×min(n-1,2)（词法分与 TS lexicalScore 逐字对齐）
- [x] 单测(10 项: 融合计分/tokenize zh/urlNorm/RSS 守卫/四车道 parse) + 头对头实测——15.0MB vs TS 107.5MB, 出勤 4/4 持平

## Phase P2 — 默认池免 key 车道补全

- [ ] DDG HTML(三件套: 限速门+202 软封检测+空结果退避重试) + x/net/html+cascadia 引入
- [ ] marginalia(api2+legacy 双端点)/wiby(实体解码)/mdn/github/registries lanes
- [ ] 中文题 zh 腿路由(planner 检测zh→zh 源腿) 对齐
- [ ] 验收: 头对头车道出勤矩阵 = TS 逐项对齐

## Phase P3 — 质量层全量

- [ ] 三层权威体系移植(authority 数据是 JSON, 语言无关直接复用; scoring 逻辑重写)
- [ ] domainCap 广度保护(packages/devops cap=0/混源 cap=3/社区意图翻转)
- [ ] planner-lite(意图/复杂度/freshness)+ FTS5 缓存(modernc.org/sqlite 纯 Go, cache-as-search-corpus)
- [ ] 语义去重(fallback embedder 哈希版移植)
- [ ] 验收: **9 题 bench L1 9/9 + 广度四指标持平**（本计划的关键里程碑）

## Phase P4 — 外围出口（完成 2026-09-04）

- [x] governor.go: Budget(run 级字符预算) + SSRF 守卫(协议/端口白名单 80/443/8080/8443 + DNS 全查私网拦截 + fake-ip 豁免) + 域名治理(global/allow/block) + classifyFailure 6 类失败分类器 — 逐字对齐 TS governor.ts/base.ts
- [x] focus.go: extractHtml(goquery 剪枝+article/main 优先+块级换行, 对齐 cheerio 行为) + splitSegments(~300 chars 句子感知打包, TS lookbehind 手写等价) + extractFocus(命中段+邻接段+idf-lite 词权重+预算裁剪)
- [x] fetcher.go: fetchSafe(manual 逐跳 5 跳重定向全过 SSRF) + 反爬墙判别(captcha/denied 短页) + crates API 改写(SPA 修复) + DOI→OpenAlex/Unpaywall OA 回退链 + focus 全流程 — transport 注入对齐 TS fetchImpl mock 测试策略
- [x] health.go: 熔断 2.0 全语义(rate_limited 4次/2min, blocked 2/15min, quota 1/30min, auth 1/1h, timeout 6/5min, error 6/10min + 同类连败 + 半开探针失败冷却翻倍上限 1h + 滚动窗口 50 衰减) — 诚实差异: TS 持久化在 SQLite kv, Go 用 JSON 文件落盘, 介质不同语义一致
- [x] journal.go: jsonl 运行日志(run_start/planner/engine_result/engine_error/fusion/fetch*/run_end) + 保留 50 run 滚动 GC
- [x] serve-http: REST 网关(/health /providers /stats /search /fetch) + Bearer 鉴权(SC_HTTP_TOKEN) + CORS — P5 后补 /research SSE
- [x] MCP stdio: 行分隔 JSON-RPC 2.0(initialize/tools/list/tools/call), 注册 search/fetch/search_providers/cache_stats 四工具 — 诚实边界: research/x_search/search_cache 属 P5/持久化缓存范围, 实现前不注册; TS 渐进披露目录搜索工具依赖完整工具面, 暂以标准全量列表对齐
- [x] main.go 重构: searchFlow 抽出(search/fetch/providers/stats/serve/serve-http 六子命令), journal+health 接线进引擎流(熔断冷却期引擎跳过=circuit_open 语义)
- [x] 实弹: focus fetch 维基页 23156→1815 chars 省 92%(dsh 口径 ~90% 对齐), 74571→2646 省 96%, 332-586ms; VmHWM ≈ 1.8-2MB(TS 同路径 80MB+, ~40×); serve-http /health /providers /fetch 冒烟通过; MCP stdio initialize/tools/list/tools/call 冒烟通过
- [ ] P4.5(诚实遗留): 持久化页面/结果缓存(TS SQLite FTS5 → modernc.org/sqlite), search_cache 工具与 /search_cache 端点依赖此项

## Phase P5 — research 循环 + 收尾

- [x] citations.go: 引用出口校验(audit strict 抛错/strip 剔除标注/尾注渲染) — 验收口径 [n] 100% 可回溯
- [x] research.go: 状态机全量移植(STORM-lite 角度池 8 模板 selectAngles + 角度并行搜索单角度失败只降级 + fetchSlots 覆盖率感知公平轮转 + 6 问量化反思 Q1-Q6 + strict/relaxed 双决策 + 双预算池 + MAX_LOOPS_DEGRADED 降级不阻塞 + 连续 2 轮全灭才停 + journal replay 断点恢复 + 大纲骨架) — 无 LLM 合成(结构化 markdown, TS 同款)
- [x] xchain.go: X 降级链 4 层(官方 API bearer ∥ Guest GraphQL 匿名+queryId bundle 轮换自愈+token 401/403 重铸 ∥ keyless site:x.com 引擎 ∥ oEmbed 全文增强 top2) + 层独立熔断(x-guest 接 health) + allSettled 合并去重
- [x] 三出口接线: CLI research/x 子命令 + serve-http /research /research/resume(SSE 事件流+15s 心跳) /x_search + MCP tools 注册 research/x_search(渐进披露依赖完整工具面, 以标准全量列表对齐)
- [x] 回归门禁: 9 题 L1 9/9 ALL HIT(P4 重构引入 web 分支 legSets 丢失回归, bench 复检抓获修复 — 教训: 重构必须重跑 bench 门禁); 87 单测全绿
- [x] 实弹: research summary 档 60 refs 入池/2 facts/13.2s; search 峰值 VmHWM 2-15MB vs TS 107.5MB
- [x] P5-c: 24 题全量对照(vs-zai-cases-full20 题集逐题拷贝) — **L1 24/24 ALL HIT(追平 TS r18 24/24)**; 广度 uniqDom 均值 7.4 vs TS r18 历史 7.7(基本持平, 诚实差 -0.3); 引擎出勤均值 14.9; 原始 JSON 落 /tmp 不入仓
- [x] 早收割移植(TS AG-2 逐条对齐): 到 earlyHarvestMs(1200, SC_EARLY_HARVEST_MS)后若(结算腿 ≥ ceil(60%) 且 refs≥15)立即断慢腿交付, 软截止兜底不变; 被断慢腿以 timeout 身份进 failed+journal soft_deadline 事件 — 延迟均值 3302→1219ms(-63%)
- [x] P4.5: cache.go(modernc.org/sqlite 纯 Go 零 CGO) — pages/search_cache/kv 表 + FTS5 trigram 全文索引(中英文验证)+ LIKE 兜底; searchFlow 接搜索结果缓存(key=sha24 queries+route+opts, TS JSON.stringify 逐字段对齐含 undefined 键省略); fetcher 页面缓存跨进程持久化; search_cache 全文搜接三出口(CLI cache 子命令/MCP 工具/serve-http 端点) — 实测: fetch 二次 0ms 跨进程命中, search 二次 1ms 秒回, FTS5 语料命中 crates 页
- [x] 终测: 24 题 L1 24/24 ALL HIT 保持, 延迟均值 1279ms(缓存热), uniqDom 7.3-7.5(TS 7.7, 诚实差 -0.2~-0.4); 体积 11.5MB stripped 单静态二进制(+sqlite, vs TS 36MB+Node)
- [x] 收尾: go-port 合并 main 的决策评审 — 用户放行(「继续」), 合并后门禁: 87 单测绿 + 24 题 bench 复跑 + L1 门禁保持

## 诚实边界

- 每期完成才记完成，头对头数据入 worklog；对不齐的项诚实留档不掩盖
- TS 主链(main)持续可用，go-port 在验收达标前不进交付链
- 触发放弃条件: 若 P3 里程碑（L1 9/9+广度持平）两轮冲刺后仍无法达成，诚实关账回到 TS 主链

## 合并前收尾 (2026-09-05, E2E 验收暴露的接线缺口)

- [x] cache_stats 三出口接真实 Cache.Stats()(MCP cache_stats / REST /stats / CLI stats 原挂 "pending P4.5" 占位已过时) — cacheStatsSnapshot() 共享快照, OpenCache 失败降级 error 字段不阻塞健康面
- [x] 页面缓存持久化接线缺口修复: MCP fetch/research 与 serve-http /fetch /research 的 fetcher 传 nil pageStore(仅进程内, E2E 实测 fromCache:false 287ms 证据) — newPersistentFetcher() 共享工厂统一挂 SQLite pageStore, 修复后 MCP fetch 跨出口命中 CLI 入库页 fromCache:true 4ms
- [x] 验证: 87 单测绿 + gofmt/vet 干净 + MCP E2E PASS(cache_stats 实报 {pages:1,pageChars:60209,dbBytes:364544})

## Phase AL: 增量扩源探针第 5 批 (2026-09-05, Go 侧首发 12 候选)

> 证据链脚本: scripts/probe-al-sources.mjs + probe-al-recheck.mjs (原始输出落 /tmp/probe-al/)
> 纪律: 每候选先探针后定案; 2 发复验; PASS 源 3 连发强度复验; TS 已关账案不重复探

| 候选 | 探针结果 | 判定 |
|---|---|---|
| Zenodo | 200 三连发 446-804ms, hits.hits[] 形状, id 是 number(实弹抓获) | ✅ 接入(academic 腿, 研究数据集/软件/报告 DOI 存档, openalex 不收的面) |
| DOAJ | 200 三连发 2317-3558ms(慢但软截止内), results[].bibjson | ✅ 接入(academic 腿, 开放期刊全文; title 带 <bold> 高亮+数字实体, 实弹抓获已修) |
| MetaCPAN | 200 三连发 281-373ms(最快), ES _source 形状 | ✅ 接入(packages 腿 + perl/cpan 语言信号裁腿行) |
| Repology | 200 三连发 1328-1541ms, 跨 repo 版本聚合 | ✅ 接入(packages 腿, 名直取+版本意图守卫, repo 去重防刷屏) |
| Flathub | 200 812ms, body 键是 query 非 search(422 已踩) | ✅ 接入(devops 腿, Meilisearch hits 形状, hitsPerPage=8) |
| AUR RPC | search-core UA→Anubis 挑战页; 浏览器 UA+curl→200; **浏览器 UA+Go client→仍挑战页** | ❌ 关账(TLS 指纹级识别, qwant/gitlab 同案; laneAur 实现保留挂账) |
| data.gov CKAN | 404 两连(端点失效/迁移) | ❌ 关账 |
| Homebrew | 官方无搜索 API(404) | ❌ 关账 |
| IETF datatracker | 403 Cloudflare 挑战页 | ❌ 关账 |
| CTAN | JSON API 路径不存在(404) | ❌ 关账 |
| pkg.go.dev | 15s 超时+复验 4.4s HTML 抓取 | ❌ 关账(延迟超半径+HTML 脆弱) |
| Lobsters | fetch failed ×2(DC 不可达) | ❌ 关账 |

**落地**: 注册 44→49(zenodo/doaj/metacpan/repology/flathub); DOMAIN_TABLE 表只扩不缩(packages 5→7 腿+metacpan/repology, devops+flathub+flatpak 关键词, academic 7→9 腿+zenodo/doaj); packageLangSignals +perl 行; stripHtmlSnip 共享剥离(named+数字实体双解码)。
**实弹抓获 3 bug**: zenodo id number/string 类型、doaj <bold> 高亮+&#x2013; 数字实体残留、AUR Go client TLS 指纹挑战(关账依据)。
**测试**: 87→97(黄金样本×7+守卫×2+接线锁×1+doaj 无 fulltext 兜底×1), 全绿; MCP E2E PASS(lanes=49)。
**bench 回归**: L1 24/24 保持, **uniqDom 7.33→7.54(+0.21 广度增量实证)**, 引擎出勤 13.9→15.9(+2.0), 延迟 977ms。

## Phase B12: 增量扩源探针第 12 批 (2026-09-05, Go 侧 12 候选 + wikidata 清账)

> 证据链脚本: scripts/probe-b12-sources.mjs + probe-b12-recheck.mjs + probe-b12-final.mjs (原始输出落 /tmp/probe-b12/, 黄金样本 shapes/)
> 三轮实弹: 轮 1 全景探测 → 轮 2 幸存者深挖+红灯修正+curl 交叉归因+wikidata 清账取证 → 轮 3 定案+黄金样本落盘

| 候选 | 探针结果 | 判定 |
|---|---|---|
| openreview | 200 756-1071ms; notes 异构双形态(评审笔记 content.summary/rating + DBLP 记录 title/abstract/authors); **中文"强化学习"直中综述论文** | ✅ 接入(academic 加强; **同 forum 多评审车道内去重**防融合层 URL 去重错位; authors 数组宽容解包防整条反序列化炸) |
| inaturalist | 200 160-803ms; **中英词面双通**(隼→Falconiformes, gyrfalcon→Falco rusticolus); preferred_common_name/observations_count/extinct | ✅ 接入(species 加强; 学名兜底无俗名高阶元; is_active=false 跳过) |
| pubdev | 200 216-311ms; search 名单+detail 双腿; **dart/flutter 语言空白补齐** | ✅ 接入(packages 加强 + packageLangSignals dart/flutter 裁腿行; 详情 top3; asciiFace 替代原词主查) |
| openfoodfacts | cgi/search.pl 200 866ms **count=1031 真过滤**(Nutella 三连直中); api/v2 search **search_terms 参数被忽略**(count=472万全库固定列表, "牛奶"与 nutella 同返回) | ✅ 接入(food 加强, 幸存形态=传统 cgi 端点; v2 弃用 remotive 陷阱; 官方站 503 瞬时抖动按腿失败报账) |
| coinpaprika | 轮 1 200 后**全 402 payment_required**(soft_limit 名存实亡) | ❌ 关账(免费档不可承诺, coingecko 独守 crypto) |
| restcountries | v3.1 全线 **deprecated**(success:false); 新 host api.restcountries.com **401 authKeyMissing** | ❌ 关账(鉴权墙, wikidata 已覆盖首都/人口意图) |
| semanticscholar | **首发 429+退避重试仍 429**(无 key 共享池饱和) | ❌ 关账(academic 已有 openalex/crossref/arxiv 覆盖) |
| searchcode | codesearch_I/J 均 **404 page not found** | ❌ 关账(公共代码搜索 API 已死) |
| nixos | 前端 **SPA HTML 壳 1.7KB** 无服务端结果 + backend **bonsai.io 401** | ❌ 关账(双证死, rfc-editor 同案) |
| deezer | **403 Access Denied**(Akamai 边缘, Node+curl 双证) | ❌ 关账(IP 级, scryfall 同案) |
| lobsters | fetch failed + **curl 10s 超时 0 字节** | ❌ 关账(传输层本机不可达, gdelt 同案) |
| gitlab | 去 order_by 后 200(2s 慢)但**轮 3 复测 403 Blocked** 反爬页 | ❌ 关账(不稳定不可承诺) |

**实弹抓获 3 缺口当场修**: ①inaturalist 意图词混入 taxa 索引("falcon taxonomy"→0, "隼 物种"→Life/Animalia 根元垃圾)→b12StripTaxonIntent 先剥离再查(中文俗名保留); ②pubdev CJK 混合词原词命中率差→asciiFace 替代原词主查+纯 CJK 合法空零请求(实弹归因: q=flutter 返回 pub.dev 真实热度榜, 正当排序非固定列表陷阱); ③wikidata 全短语失败(批 11 挂账)→见下。
**清账(批 11 挂账)**: wikidata 全短语失败根因=wbsearchentities 只匹配 label/alias, 整句自然语言全灭(实弹取证: "who is linus torvalds"→search:[] 而 "linus torvalds"→Q34253 直中)→b12StripEntityIntent 意图词剥离重查+asciiFace 降级+词面性空结果合法归零防熔断(rubygems 惯例, 原 error 上抛致熔断误开); **修复后 CLI 实弹 "who is linus torvalds"→Linus Torvalds (Q34253) 直中**。
**落地**: 注册 86→90(+4); DOMAIN_TABLE 36 域不变(academic/species/packages/food 四域各 +1 腿; food 词面 +营养成分/配料表); packageLangSignals +dart/flutter 行。
**测试**: 164→175 全绿(黄金样本×5+authors 数组宽容锁×1+实体/物种意图剥离×2+路由锁×1+注册锁×1+拒连回归×1, 计数锁 86→90 滚动同步 ×6 文件+packages/academic 腿锁 ×4); MCP E2E PASS(lanes=90, circuit_open=0)。
**bench 回归(3 轮)**: L1 24/24 ×3; uniqDom 6.92/6.79/6.83; 出勤 32.9-33.2; 缓存热 204ms。
**A/B 归因(worktree 基线 ff5b7b8 同日)**: 基线 uniqDom 6.88/6.88/6.83, 出勤 32.5-32.6 → **批 12 净效应: 广度 0 回退(6.85 vs 6.86, 噪声内) + 出勤 +0.55** — 连续六批 A/B 正增量(+0.7/+1.1/+2.0/+1.3/+1.05/+0.55); 批 11 报告值 7.21→今日双侧 6.85 为外部世界漂移(b6/b7 方法论先例)。

## Phase B11: 增量扩源探针第 11 批 (2026-09-05, Go 侧 12 候选)

> 证据链脚本: scripts/probe-b11-sources.mjs + probe-b11-recheck.mjs + probe-b11-final.mjs (原始输出落 /tmp/probe-b11/, 黄金样本 shapes/)
> 三轮实弹: 轮 1 全景探测 → 轮 2 幸存者深挖+红灯复验 → 轮 3 curl 交叉归因+黄金样本落盘

| 候选 | 探针结果 | 判定 |
|---|---|---|
| mangadex | 200 150-330ms; **中文"葬送的芙莉莲"直中**; altTitles/多语 desc/tags 丰富 | ✅ 接入(**新 manga 域**; contentRating[]=safe; 标题择优 title.en→altTitles.en) |
| lrclib | 200 250-320ms; **"晴天 周杰伦"直中**; limit 参数无效(107-270KB) | ✅ 接入(**新 lyrics 域**, music 域 歌词/lyrics 词面移交; 曲+歌手去重; 意图词剥离重查) |
| pubchem | autocomplete 200; PUG REST 精确名 200(glucose→C6H12O6); **中文"葡萄糖"404** | ✅ 接入(**新 chemistry 域**; ASCII 化学锚; 404 归零防熔断) |
| usgs-quakes | 200 0.5-1.0s GeoJSON; **无关键词参数**(时间/震级过滤) | ✅ 接入(**新 quakes 窄意图域**; minmagnitude=6 orderby=time; 独占腿防 nominatim 污染) |
| endoflife | 200; all.json 6KB 产品表 + /{slug}.json 双腿可行 | ✅ 接入(devops 加强; slug 词面匹配+别名表; **单 ref 聚合防同 URL 错位合并**) |
| frankfurter | 200 43-512ms; currencies 701B + latest; bad base 404 | ✅ 接入(finance 加强; 币码提取(ASCII+中文别名) → latest; 规范页 301 终点验证) |
| imdbot | **HTTP 500 error_code=103**(Node+curl 双证, 双 UA 同) | ❌ 关账(服务端死) |
| scryfall | **403 rule=restricted** 官方区块页 | ❌ 关账(IP 级限制) |
| dictionaryapi | Node 12s 超时 ×2 + **curl -m 15 同死** | ❌ 关账(传输层本机不可达, 批 8 方法学) |
| nagerdate | 200 但**仅按国家/年份列举, 无关键词搜索** | ❌ 关账(biorxiv 日期列举同款模板失配) |
| mankier | 200 但 explain 单 ref 纯文本 | ❌ 关账(检索价值弱) |
| rfc-editor | 200 但 Nuxt SPA 客户端渲染**无服务端结果行** | ❌ 关账(无可 parse 结构) |

**实弹抓获 3 缺口当场修**: ①lrclib "晴天 歌词"全灭(意图词混入曲名索引)→意图词剥离重查; ②endoflife 各 cycle 共享规范页 URL, 融合层"URL 去重+长 snippet 胜出"跨条目错位→产品页单 ref 聚合; ③"最近地震"并入 geo 被 nominatim 地理编码污染→独立 quakes 窄意图域。
**落地**: 注册 80→86(+6); DOMAIN_TABLE **新 manga/lyrics/chemistry/quakes 四域** + devops/finance 加强(32→36); music 域 歌词/lyrics 词面移交 lyrics(b7 路由锁改判)。
**测试**: 148→164 全绿(黄金样本×6+提取器×4+路由锁×2+注册锁×1+拒连回归×1+意图剥离×1; 计数锁 80→86 滚动 ×5 文件+devops 腿锁 ×2); MCP E2E PASS(lanes=86)。
**bench 回归(3 轮)**: L1 24/24 ×3; uniqDom 7.21/7.21/7.13; 出勤 31.8-32.0; 缓存热 204-205ms。
**A/B 归因(worktree 基线 d8a2a6a 同日)**: 基线 uniqDom 7.17-7.21, 出勤 30.8-30.9 → **批 11 净效应: 广度 0 回退(噪声内) + 出勤 +1.05** — 连续五批 A/B 正增量。
**挂账**: wikidata 全短语("who is X") no results parsed — stash 对比基线同败, 非本批回归, 待清账。

## Phase B10: 增量扩源探针第 10 批 (2026-09-05, Go 侧 12 候选)

> 证据链脚本: scripts/probe-b10-sources.mjs + probe-b10-recheck.mjs + probe-b10-final.mjs (原始输出落 /tmp/probe-b10/, 黄金样本 shapes/)
> 遗留清账: rubygems 熔断查因(批 9 挂账 ok=0/fail=7) — 根因=含中文词面全灭, 词面性空结果归零防熔断 + 双级降级

| 候选 | 探针结果 | 判定 |
|---|---|---|
| thecocktaildb | 200 412-650ms, drinks[]; 空词 `{"drinks":null}`; 含 ZH-HANS 做法字段 | ✅ 接入(**新 drinks 域**; themealdb 姊妹站; asciiFace 降级) |
| wikivoyage | 200 323-832ms; **繁体"東京"45 hits 中文可用**; snippet 带 searchmatch 高亮 | ✅ 接入(**新 travel 域**; siteTargets wikivoyage.org 承接 zh 查询) |
| uniprot | 200; **617KB→fields 瘦身 4.2KB**; insulin/gfp 全命中; **gzip 体未透明解压** | ✅ 接入(species 域加强 + 蛋白质/protein/酶 词面; Accept-Encoding: identity 修复) |
| openvsx | 200 219-250ms, extensions[]; 响应 url=API 链→规范页 /extension/{ns}/{name} 200 | ✅ 接入(**新 ide-ext 域**; deprecated=true 跳过) |
| jetbrains-plugins | 200 253-344ms, plugins[]; ct=graphql+json 但 body 纯 JSON; preview=描述 | ✅ 接入(ide-ext 双源之二) |
| wp-plugins | 200 579-1255ms; 95-134KB 固定字段; author 带 HTML | ✅ 接入(**新 wordpress 域**; ★rating/active_installs 紧凑计数) |
| snapcraft | v2 404→**v1 search 200**(需 Snap-Device-Series:16); 点名 snap 无规范页 | ✅ 接入(devops 加强 + snap 包词面; URL 优先 links.website[0] 防死链) |
| boardgamegeek | **401 应用层鉴权**(浏览器 UA 同样 401) | ❌ 关账(keyless 纪律) |
| reliefweb | v1 410 已停; **v2 匿名 403 appname 需人工申请** | ❌ 关账(keyless 纪律) |
| gdelt | node 10s 连接超时 + **curl 12s 0 字节** | ❌ 关账(传输层归因=本机网络不可达, 批 8 方法学) |
| softwareheritage | 200 但 Anubis 挑战页("Oh noes!") | ❌ 关账(AUR 同族指纹级挑战) |
| homebrew (复核) | formulae.brew.sh/api/search.json **404** | ❌ 关账(批 5 "无 API" 维持, 复核 1 请求成本) |

**意外抓获: security 域 "rce" 裸子串潜伏 bug**(woocomme-rce 误入安全域, b10 路由锁暴露) → " rce " 空格锚定。
**落地**: 注册 73→80(+7); DOMAIN_TABLE **新 drinks/travel/ide-ext/wordpress 四域** + species/devops 加强(28→32)。
**测试**: 137→148(黄金样本×7+路由锁×2+注册锁×2+拒连回归×1+rubygems 清账锁×1; 计数锁 73→80 滚动同步 ×4 文件), 全绿; MCP E2E PASS(lanes=80, circuit_open=0)。
**bench 回归(3 轮)**: L1 24/24 ×3; uniqDom 7.50×3; 出勤 29.0-29.1; 缓存热 203-204ms。
**A/B 归因(worktree 基线 c45d8c1 同日)**: 基线 uniqDom 7.50, 出勤 27.8 → **批 10 净效应: 广度 0 回退(持平) + 出勤 +1.3** — 连续四批 A/B 正增量(+0.7/+1.1/+2.0/+1.3)。

## Phase B9: 增量扩源探针第 9 批 (2026-09-05, Go 侧 12 候选)

> 证据链脚本: scripts/probe-b9-sources.mjs + probe-b9-recheck.mjs + probe-b9-final.mjs + probe-b9-shapes.mjs (原始输出落 /tmp/probe-b9/, 黄金样本 shapes/)
> bench 门禁脚本首度入仓: scripts/bench-gate.mjs(24 题题库对齐 b8 批, L1/uniqDom/出勤/延迟四指标)

| 候选 | 探针结果 | 判定 |
|---|---|---|
| coingecko | 200 287-801ms; **连打 5 次第 5 次即 429**; bitcoin/blockchain/nft 全命中 | ✅ 接入(**新 finance 域** crypto 窄词面守卫; btc/eth 三字母会误伤 method 不收) |
| themealdb | 200 423-462ms, meals[] 25 条; 中文 null(纯英文语料) | ✅ 接入(**新 food 域**; "做法"太泛不收; asciiFace 降级) |
| kitsu | 200 2.3-4.8s 稳定; JSON:API {data[].attributes} | ✅ 接入(**新 anime 域**; Jikan/MAL 关账替代; 慢源腿超时内) |
| thesportsdb | 200 263-581ms; test key "3" 30 req/min; **「查询词必须为队名子串」语义** | ✅ 接入(**新 sport 域**; 二级降级 longestASCIIToken; idTeam "0" 无效形态) |
| standardebooks | 200 690-830ms; li[typeof=schema:Book] about 路径 + p0 书名 p1 作者 | ✅ 接入(**新 books 域**, gbooks/openlibrary/gutendex 全关账后 books 词面重启) |
| oeis (复验) | 403 CF 维持 | ❌ 关账(维持) |
| gbooks (复验) | 429 维持 | ❌ 关账(维持) |
| openlibrary (复验) | UND_ERR_CONNECT_TIMEOUT 维持 | ❌ 关账(维持) |
| jikan (复验) | ETIMEDOUT 维持 | ❌ 关账(上游 MAL 拒连, Kitsu 替代) |
| relevantxkcd | API 端点 404 | ❌ 关账(已死) |
| remotive | 200 极快但 **search 参数无效**(golang/kubernetes 返回相同 18 条固定列表) | ❌ 关账(不可用作搜索) |
| poetrydb | /title/Love/ 通配 404; 精确匹配语义弱; 2.8s 慢 | ❌ 关账(价值低) |

**落地**: 注册 68→73(+5); DOMAIN_TABLE **新 finance/food/anime/sport/books 五域**(表序末位, 23→28)。
**实弹抓获 2 缺口当场修**: ①coingecko 混合词 "bitcoin 价格" 空结果(CLI 端到端暴露, providers 3/0 证服务正常=词面问题) → asciiFace 降级补齐; ②thesportsdb "NBA Lakers 球队资料" 全词面 0(curl 实证 "NBA Lakers"→null, "Lakers"→1 命中) → 二级降级 longestASCIIToken。
**测试**: 129→137(黄金样本×5+路由锁×2+注册锁×2+拒连回归×1; 计数锁 68→73 滚动同步 ×3 文件), 全绿; MCP E2E PASS(lanes=73, circuit_open=0)。
**bench 回归(3 轮)**: L1 24/24 ×3; uniqDom 7.08-7.17; 出勤 25.4-25.5; 缓存热 203-204ms。
**A/B 归因(worktree 干净基线法)**: 批 8 基线同日 L1 24/24, uniqDom 7.13, 出勤 23.5 → **批 9 净效应: 广度 0 回退(持平) + 出勤 +2.0** — 连续三批 A/B 正增量(+0.7/+1.1/+2.0)。

## Phase B7: 增量扩源探针第 7 批 (2026-09-05, Go 侧 12 候选+biorxiv 快验)

> 证据链脚本: scripts/probe-b7-sources.mjs + probe-b7-recheck.mjs (原始输出落 /tmp/probe-b7/, 黄金样本 shapes/)
> 纪律同批 5/6: 先探后定案 + 幸存者轮 2 复验 + PASS 源单车道直调实弹

| 候选 | 探针结果 | 判定 |
|---|---|---|
| artifacthub | 200 4/4, 620-690ms, packages[] 形状; **响应无 kind 字段** | ✅ 接入(devops 腿 + helm/helm chart/opa policy 关键词; kind=0 过滤 → /packages/helm/{org}/{name} URL 200 实弹闭环) |
| nasaimages | 200 4/4, 735-950ms, collection.items GeoJSON-ish | ✅ 接入(images 腿 + nasa/太空照片关键词, Kind image, 详情页 images.nasa.gov/details/{nasa_id}) |
| musicbrainz | 200 4/4, 303-1863ms, recordings[]; 中文 query 有效 | ✅ 接入(**新 music 域**; TOS 1 req/s 腿内单请求合规; artist-credit/disambiguation/时长) |
| mozaddons | 200 3/3, 401-718ms; **实弹纠正 limit 无效→page_size** | ✅ 接入(**新 browser-ext 域**, 只收 firefox 词面; name/summary 本地化对象 default_locale 择优) |
| thespacedevs | 200 2/2, 737-1120ms; 匿名限流 15 req/h | ✅ 接入(**新 space 域**窄词面=守卫防烧配额; 网页 404 → API 条目页为规范 URL; 429 显式报错) |
| openlibrary | 超时 5/5(8-9s+, 瘦身参数亦然) | ❌ 关账(6s 软截止下结构性不可能; 恢复稳后可复探) |
| archive.org advancedsearch | 超时 3/3 | ❌ 关账(排队严重, 同 openlibrary 案) |
| zbmath | 200 1/2, 998ms vs 9s | ❌ 关账(50% 超时方差, 比 maven 40% 更差) |
| pubchem | name lookup 200(非 relevance 搜索); autocomplete 400 | ❌ 关账(query 语义不适配: 精确名 lookup, 非搜索) |
| usgs FDSN | 200 但无文本 query 语义; geoserve 404 | ❌ 关账(事件类结构化查询, 无法适配关键词搜索) |
| oeis | 403 CF "Just a moment" | ❌ 关账(AUR/gutendex 同案: Go client 骗不过 TLS 指纹) |
| fatcat (scholar.archive.org) | 超时 ×2 | ❌ 关账(项目归档疑案) |
| biorxiv (快验) | 200 但 interval=日期区间, 无关键词参数 | ❌ 关账(API 设计不支持关键词搜索) |

**落地**: 注册 56→61(+5); DOMAIN_TABLE devops 3→4(+artifacthub), images 2→3(+nasaimages), **新 music/space/browser-ext 三域**(表序末位, 14→17)。
**实弹纠正 1 参数 bug**: AMO v5 search 的 limit 参数无效(返回 25 条全字段 595KB), 正确参数 page_size。
**测试**: 111→119(黄金样本×5+路由锁×2+拒连回归×1), 全绿; MCP E2E PASS(cache_stats lanes=61)。
**bench 回归(4 轮)**: L1 24/24 ×4; 引擎出勤 19.9-20.0; uniqDom 6.8-6.9。
**A/B 归因(批 6 方法论复用)**: stash → 批 6 代码同日重跑 uniqDom 亦 6.9(出勤 19.3) → 7.25→6.9 缺口=外部漂移; **批 7 净效应: 广度 0 回退 + 出勤 +0.7**。

## Phase B6: 增量扩源探针第 6 批 (2026-09-05, Go 侧 12 候选)

> 证据链脚本: scripts/probe-b6-sources.mjs + probe-b6-recheck.mjs + probe-b6-shapes.mjs (原始输出落 /tmp/probe-b6/)
> 纪律同批 5: 先探后定案 + 存疑案轮 3 定案 + PASS 源单车道直调实弹

| 候选 | 探针结果 | 判定 |
|---|---|---|
| NuGet (azuresearch) | 200 4/4, 206-876ms, data[] 形状, verified/totalDownloads | ✅ 接入(packages 腿 + dotnet/.net/c#/csharp 信号裁腿行) |
| hex.pm | 200 4/4, 268-363ms, JSON 数组, meta.licenses | ✅ 接入(packages 腿 + elixir/mix.exs/hex.pm 信号行) |
| Arch Linux packages | 200 4/4, 442ms-2.9s, v2 JSON(limit=250) | ✅ 接入(devops 腿 + arch linux/archlinux/pacman/arch 包关键词) |
| INSPIRE-HEP | 200 4/4, 239-828ms; fields 参数瘦身 2MB→20KB(实弹) | ✅ 接入(academic 腿 + 物理意图守卫, 链接优先级 arXiv>DOI>INSPIRE) |
| OpenAIRE | 200 4/4, 586ms-1.1s, OAF 嵌套 JSON($ 文本三态) | ✅ 接入(academic 腿 + OA 意图守卫; refs 全 doi.org 与 crossref 同域, 差异化定位仅在 open access/开放获取意图出勤) |
| Wikimedia Commons | 200 4/4, 648-835ms, generator=search File 命名空间 | ✅ 接入(images 腿, index 排序+File: 前缀/扩展名剥离, Kind image) |
| Open-Meteo | geocode+forecast 双腿 6/6; **geocoding 中文索引只认繁体**("东京"仅命中村庄) | ✅ 接入(新 weather 域双腿车道: Nominatim 定位[简体直中]+forecast 实况, WMO 释义; open-meteo geocoding 关账) |
| Maven Central (solrsearch) | 200 3/5, 246-605ms; **2/5 8-10s 超时方差** | ❌ 关账(结构性不稳, 6s 软截止下腿失败率过高; solrsearch 恢复稳后可复探) |
| Anaconda (conda) | 200 1/2, 3.2s-10s+ | ❌ 关账(慢, pkg.go.dev 同案) |
| Debian sources | API 404 ×4(bookworm/sid/trixie 三套件均 404) | ❌ 关账(文档 API 已死) |
| Gutendex | 403 Cloudflare "Just a moment" ×4 | ❌ 关账(CISA/AUR 同案) |
| Reddit public JSON | 403 挑战页 ×4 | ❌ 关账 |

**落地**: 注册 49→56(+7); DOMAIN_TABLE packages 7→9, devops 2→3(+arch), academic 9→11(+openaire/inspirehep), images 1→2(+commonswiki), **新 weather 域**(表序末位, 13→14); packageLangSignals +dotnet/elixir 两行。
**实弹抓获 2 bug(当场修)**: openaire 无描述条目孤日期"· 2025-05-01"(publisher 兜底)、open-meteo geocoding 简体"东京"命中江苏东京镇(根因=中文索引只认繁体, 腿1 换 Nominatim 简体直中, population 择优方案作废)。
**测试**: 97→111(黄金样本×9+守卫×3+接线锁×2+placeLabel), 全绿; MCP E2E PASS(lanes=56, circuit_open=0)。
**bench 回归(5 轮)**: L1 24/24 ×5 保持; 引擎出勤 18.4-18.5(批5 15.9); **uniqDom 7.25-7.33 三轮均值 7.29**。
**A/B 归因(同日同环境, 方法论新增)**: 批 5 代码当天重跑 uniqDom 亦 7.25/7.29(昨日 7.54 为外部世界快照) — **批 6 净效应: 广度 0 回退 + 引擎出勤 +1.0**; 7.54→7.29 缺口归因外部漂移(web 腿结果的世界状态变化), 与批 6 代码无关。广度硬约束达标。
