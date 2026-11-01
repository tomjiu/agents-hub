# go-port — TS → Go 分期重构（P1 已完成）

决策与分期计划见 [PLAN.md](PLAN.md)。语言裁决: Go（保真度/迭代速度优先，Rust POC 分支留作极限下限证据）。

## P1 实测（2026-09-04, 同机同网络, query "docker compose restart policy", 同 4 车道 keenable+bingrss+searxng+wikipedia）

| 指标 | TS v0.8.1 | Go P1 | 差距 |
|---|---|---|---|
| 内存峰值(VmHWM) | 107.5MB(首跑)/81.5MB(缓存跑) | **15.0-15.1MB** | 5-7× |
| 墙钟(首跑) | 3.57s | **1.32s** | 2.7× |
| 墙钟(缓存跑) | 0.20s(FTS5 缓存命中) | 0.64s(无缓存层, P3 补) | 如实标注 |
| 车道出勤 | 4/4 | 4/4 | 持平 |
| 冷启动 | 0.21s | **<8ms**(采样下限) | ≥25× |
| 交付物 | 36MB+Node≥22.5 | **6.2MB 单静态文件** | ~6× |

诚实边界: P1 只有 4/29 车道 + fusion-lite+（无权威提权/domainCap/语义去重/planner/缓存/focus/research/MCP）；top3 排序面与 TS 不同（无权威提权属预期）；TS 缓存跑 0.20s 快于 Go 属预期（Go 缓存层在 P3）。

## 已移植并锁测试的行为（P1）

- 车道契约逐字对齐: keenable（POST 公共路+X-Keenable-Title+400/401/429 语义）/ bingrss（format=rss+根标记漂移守卫+零 item 抛错）/ searxng（实例链回退+反爬页伪 200=实例失败纪律）/ wikipedia（REST v1+主语言码路由+description 优先于 excerpt）
- 融合公式逐字对齐: tokenize（Unicode+STOP 表）/ lexicalScore（title 计两次）/ titleAllTermsBonus / urlNorm（tracker 丢参+参数排序+尾斜杠仅末尾触发）/ RRF×10+lex×1.5+consensus+titleBonus×0.25 / tie-break 同分保最佳排名
- allSettled 语义: goroutine 并行+腿失败报账不阻塞+每腿软截止
- CLI 解析: flag 可后置（对齐 TS parseFlags, stdlib flag 的位置参数终止行为已绕开——**单测+头对头抓出并修复**）

## 构建/运行

```bash
cd go-port
go build -ldflags="-s -w" -o search-core-go .   # 6.2MB 单文件
go test ./...                                    # 10 单测
./search-core-go search "docker compose restart policy" --engines keenable,bingrss,searxng,wikipedia
# 头对头复测: node scripts/h2h-ts-go.mjs（/proc VmHWM 口径）
```

## P4 外围出口 (2026-09-04)

**新增子命令**: `fetch URL [--focus t] [--max-chars N]` / `providers` / `stats` / `serve`(MCP stdio) / `serve-http [--port P]`

**交付面**:
- **governor**: run 级字符预算 + SSRF 全守卫(协议/端口白名单/DNS 私网拦截/逐跳重定向复检/fake-ip 豁免) + 域名治理(SC_BLOCKED_DOMAINS)
- **focus fetch**: goquery 正文提取(article/main 优先+导航剪枝) → ~300 chars 段落 → 命中段+邻接段提取, 实测省 92-96% token(dsh ~90% 口径)
- **fetcher 安全链**: 反爬墙判别 + crates SPA→API 改写 + DOI 403→OpenAlex→Unpaywall OA 回退(含自环守卫)
- **熔断 2.0**: 分类阈值(rate_limited 4/2min, blocked 2/15min, quota 1/30min, auth 1/1h, timeout 6/5min, error 6/10min) + 半开探针失败冷却翻倍(cap 1h) + 滚动窗口 50 衰减; 冷却期引擎自动跳过(circuit_open)
- **journal**: jsonl 运行日志(~/.search-core/journal/, 50 run 滚动 GC, SC_JOURNAL=0 关闭)
- **REST 网关**: /health /providers /stats /search /fetch + Bearer 鉴权(SC_HTTP_TOKEN)
- **MCP stdio**: JSON-RPC 2.0 行分隔, 工具面 search/fetch/search_providers/cache_stats

**配置环境变量**: SC_UA / SC_CONTACT_EMAIL / SC_BLOCKED_DOMAINS / SC_FAKE_IP_CIDRS / SC_MAX_PAGE_BYTES(2MB) / SC_BUDGET_CHARS(60000) / SC_SSRF(strict|allowPrivate|off) / SC_HTTP_TOKEN / SC_DATA_DIR(~/.search-core)

**诚实差异 vs TS**: ①页面缓存为进程内 TTL(900s)非持久化 — CLI 单发形态每次冷, 持久化缓存列 P4.5; ②health 状态 JSON 文件落盘(TS 为 SQLite kv), 语义一致介质不同; ③MCP 未注册 research/x_search/search_cache(P5 未实现不做假实现), 渐进披露目录搜索以标准全量列表替代

## P5 research + xchain (2026-09-04)

**新增子命令**: `research "query" [--loops N] [--strict] [--preset summary|report|deep] [--resume runId] [--json]` / `x "query" [--json]`

**research 状态机**(无 LLM 合成, TS 同款):
- STORM-lite 角度池 8 模板按查询信号选 5(强制"定义与概念"), 角度并行搜索单角度失败只降级
- fetchSlots 覆盖率感知公平轮转(slotScore = 词法相关×2 + 多引擎佐证 + 头部排名) 抢双预算池
- 6 问量化反思(事实数/维度覆盖/权威源/时效/多源/可用性) + strict(全过)/relaxed(Q1+Q2) 双决策
- 停止三保险: 显式收敛/预算尽/硬上限(降级出报告不阻塞) + 连续 2 轮全灭才停
- 断点恢复: journal 事件流即状态, `--resume runId` replay 续跑(预算可扩大)
- 引用出口校验: [n] 100% 可回溯(strict 抛错 → strip 剔除+标注, 幻觉引用零容忍)

**xchain 4 层降级链**: 官方 API(X_BEARER_TOKEN) ∥ Guest GraphQL(匿名 bearer + guest token 2h 缓存 + queryId 从 x.com JS bundle 轮换自愈 24h) ∥ keyless site:x.com 引擎 ∥ oEmbed 全文增强 top2; 层独立熔断, allSettled 合并去重

**SSE**: `POST /research` 与 `/research/resume` 返回事件流(start/loop_start/angle_done/fetch_done/reflect/decide/stop/result) + 15s 心跳

**回归门禁**: 9 题 L1 9/9 ALL HIT(P4 重构曾引入 web 分支腿集丢失回归, bench 复检抓获 — 重构必须重跑 bench 已成纪律)

## P4.5 持久化缓存 + 早收割 (2026-09-04)

**cache.go**: modernc.org/sqlite(纯 Go 零 CGO, 单静态二进制保持 11.5MB stripped) — pages/search_cache/kv + FTS5 trigram 全文索引(中文 ≥3 字子串命中, 短 query LIKE 兜底)
- **搜索结果缓存**: key = sha24(queries+route+opts), 二次同题 1ms 秒回(900s TTL, SC_NO_CACHE=1 关)
- **页面缓存跨进程**: fetch 二次同页 0ms, 入库即进 FTS 语料
- **缓存即搜索面**: `cache "query"` 子命令 / MCP search_cache 工具 / POST /search_cache — 全文搜已抓页面, 离线秒回

**早收割**(TS AG-2 对齐): 到 1200ms 后若(60% 腿结算且 refs≥15)立即断慢腿交付; 被断腿以 timeout 进 failed; SC_EARLY_HARVEST_MS=0 关 — 24 题延迟均值 3302→1279ms

**门禁**: 24 题 L1 24/24 ALL HIT(缓存改动后复测保持); 87 单测全绿

## MCP stdio E2E 客户端验收 (2026-09-05)

以真实 MCP host 身份(行分隔 JSON-RPC 2.0 完整握手)对 `serve` 子命令做端到端验收:

```bash
go build -ldflags="-s -w" -o search-core-go .
node scripts/mcp-client-e2e.mjs ./search-core-go
```

**流程**: initialize(协议 2025-06-18 回显) → notifications/initialized → tools/list(7 工具全量) → tools/call ×4

**实测记录**:
- `fetch`(工具#2): wikipedia 60209 字符 → focus 命中段 2817 字符, **省 95.3% token**, 287ms(冷)/4ms(持久缓存热, fromCache:true)
- `search_providers`(工具#3): 44 车道健康普查实时返回, circuit_open=0
- `search`(旗舰): 全链路 plan→扇出→融合 8 refs; 二次同题 **2ms**(持久缓存跨进程命中的直接证据)
- `cache_stats`: `{lanes:68, cache:{pages,pageChars,searches,dbBytes}}` 真实语料统计(接线修复后)
- 同日 HTTP 出口冒烟: GET /health /providers + POST /search(searxng 腿活, 权威层 sqlite.org 排首)全通

**验收口径**: 客户端严格校验 content[] 形状与 isError, 任一工具失败退出码非零 — 可作 CI 集成门禁复用

**E2E 暴露并修复的接线缺口** (2026-09-05): ①MCP/serve-http 的 fetcher 传 nil pageStore = 页面缓存仅进程内(E2E fromCache:false 287ms 实证) → `newPersistentFetcher()` 共享工厂统一挂 SQLite pageStore, 修复后跨出口命中 4ms; ②cache_stats 三出口原挂 "pending P4.5" 过时占位 → 接真实 `Cache.Stats()`(pages/pageChars/searches/dbBytes)

## 增量扩源探针第 12 批: 车道 86→90, 四域加强 + wikidata 清账 (2026-09-05)

> 探针证据链: scripts/probe-b12-sources.mjs(12 候选轮 1) + probe-b12-recheck.mjs(幸存者深挖+红灯修正+curl 交叉归因+wikidata 清账取证) + probe-b12-final.mjs(定案+黄金样本)
> 全流程同批 8/9/10/11: 探针定案 → 车道实现 → 黄金样本单测 → CLI 端到端实弹 → 全门禁 → A/B 归因

**接入 4 车道**(四域加强, 无新域; 4 接 8 关):

| 车道 | 域接线 | 亮点 |
|---|---|---|
| openreview | academic 加强(+1 腿) | **notes 异构双形态**: 评审笔记(content.summary/rating, 无 title→意见摘要头部作标题) + DBLP 论文记录(content.title/abstract/authors); **实弹中文"强化学习"直中综述论文**; **同 forum 多评审车道内去重**(endoflife 教训: 融合层 URL 去重跨条目错位盲区的车道内防线); authors 数组宽容解包(b12OVValue 自定义 UnmarshalJSON, 防整条 notes 反序列化炸) |
| inaturalist | species 加强(+1 腿) | **中英词面双通**(实弹: 隼→Falconiformes, gyrfalcon→Falco rusticolus); preferred_common_name 俗名+学名兜底; observations_count/灭绝标记; **实弹抓获: 意图词混入 taxa 索引("falcon taxonomy"→0, "隼 物种"→Life/Animalia 根元垃圾)→b12StripTaxonIntent 先剥离再查**(lrclib 歌词意图词同款, 中文俗名保留) |
| pubdev | packages 加强(+1 腿, **dart/flutter 语言空白补齐**) | 双腿: /api/search 名单 → /api/packages/{name} 详情 top3(thesportsdb 腿内多请求先例); packageLangSignals +dart/flutter 裁腿行(flutter 题只打 pubdev 不空跑 npm); **实弹: CJK 混合词原词命中率差→asciiFace 替代原词主查+纯 CJK 合法空零请求**(归因: q=flutter 返回 pub.dev 真实热度榜, 正当排序非固定列表陷阱) |
| openfoodfacts | food 加强(+1 腿; 词面 +营养成分/配料表) | **v2 search search_terms 参数被忽略弃用**(count=472 万全库固定列表, "牛奶"与 nutella 同返回=remotive 陷阱); 幸存形态=传统 cgi/search.pl(count=1031 真过滤, Nutella 三连直中); 与 themealdb(纯食谱)互补成"食谱+食品商品"双层; 官方站 503 瞬时抖动按腿失败报账交熔断 |

**优先清账(批 11 挂账): wikidata 全短语失败** — 根因=wbsearchentities 只匹配 label/alias, 整句自然语言全灭(实弹取证: "who is linus torvalds"→search:[] 而 "linus torvalds"→Q34253 直中)→b12StripEntityIntent 意图词剥离重查(b11StripLyricIntent 同款)+asciiFace 降级+**词面性空结果合法归零防熔断污染**(rubygems 惯例, 原 error 上抛致熔断误开); 修复后 CLI 实弹 "who is linus torvalds"→**Linus Torvalds (Q34253) 直中**。

**关账 8 案**: coinpaprika(轮 1 200 后全 402 payment_required, 免费档 soft_limit 名存实亡)、restcountries(v3.1 全线 deprecated+新 host api.restcountries.com 401 authKeyMissing 鉴权墙, wikidata 已覆盖首都/人口意图)、semanticscholar(首发+退避重试均 429, 无 key 共享池饱和, academic 已有 openalex/crossref/arxiv)、searchcode(codesearch_I/J 404, 公共代码搜索 API 已死)、nixos(前端 SPA 壳 1.7KB+backend bonsai.io 401 双证死, rfc-editor 同案)、deezer(403 Akamai 边缘 IP 级, Node+curl 双证, scryfall 同案)、lobsters(curl 10s 超时 0 字节, 传输层本机不可达, gdelt 同案)、gitlab(轮 2 去 order_by 侥幸 200, 轮 3 复测 403 Blocked 反爬页, 不稳定不可承诺)。

**门禁**: 175 单测全绿(164→175, 黄金样本×5+authors 数组宽容锁×1+实体/物种意图剥离×2+路由锁×1+注册锁×1+拒连回归×1, 计数锁 86→90 滚动同步 ×6 文件+packages/academic 腿锁 ×4); gofmt/vet 干净; L1 24/24 ×3 轮 uniqDom 6.92/6.79/6.83, 出勤 32.9-33.2, 缓存热 204ms; MCP E2E PASS(lanes=90, circuit_open=0)。

**A/B 归因(worktree 干净基线法复用)**: 批 11 基线(ff5b7b8)同日重跑 L1 24/24 ×3, uniqDom 6.88/6.88/6.83, 出勤 32.5-32.6 → **批 12 净效应: 广度 0 回退(6.85 vs 6.86, 噪声内) + 引擎出勤 +0.55(32.53→33.07)** — 连续六批 A/B 口径正增量(+0.7/+1.1/+2.0/+1.3/+1.05/+0.55); 批 11 报告值 7.21→今日双侧 6.85 为外部世界漂移(b6/b7 方法论先例)。

## 增量扩源探针第 11 批: 车道 80→86, 域 32→36 (2026-09-05)

> 探针证据链: scripts/probe-b11-sources.mjs(12 候选轮 1) + probe-b11-recheck.mjs(幸存者深挖+红灯复验) + probe-b11-final.mjs(curl 交叉归因+黄金样本)
> 全流程同批 8/9/10: 探针定案 → 车道实现 → 黄金样本单测 → 车道直调实弹(验完删) → 全门禁 → A/B 归因

**接入 6 车道**(三新域 + 窄意图域 + 双域加强):

| 车道 | 域接线 | 亮点 |
|---|---|---|
| mangadex | **新 manga 域**(漫画/连载/manga/manhwa 词面) | JSON:API 形状; **title 匹配含各语 altTitles, 实弹中文"葬送的芙莉莲"直中**; contentRating[]=safe 收敛家庭友好; 标题择优 title.en→altTitles.en→首值(实弹 ja-ro 开场形态); asciiFace 降级 |
| lrclib | **新 lyrics 域**(歌词/lyrics 词面, 从 music 域接管) | **实弹"晴天 周杰伦"直中中文曲库**; 无 limit 参数单响应 107-270KB(<1MB cap, parse 只取前 max); 同曲 plain/synced 多版本按曲+歌手去重; 纯音乐 instrumental 形态; **实弹抓获: "晴天 歌词"全灭(意图词混入曲名索引)→意图词剥离重查(gbif 疑问后缀剥离同款)** |
| pubchem | **新 chemistry 域**(分子式/化学式/分子量/摩尔质量 词面) | PUG REST 精确名直查(glucose→C6H12O6/MW 180.16/IUPAC); **实弹: 中文"葡萄糖"404 → 仅 ASCII 化学锚**(b11ChemAnchor 排除意图词取最长 ASCII token, 纯中文合法空零请求); 404 归零防熔断污染(openfda 惯例) |
| usgsquakes | **新 quakes 窄意图域**(最近地震/最新地震/recent earthquake 词面) | 意图解析型(openmeteo 先例): FDSN API 无关键词参数, 窄词面守卫+忽略 q 拉 minmagnitude=6 orderby=time; **实弹抓获: 若并 geo 域, "最近地震"被 nominatim 把查询当地点名返回街道 → 独立 quakes 域行独占 usgsquakes 腿**; tsunami/alert/日期人类可读化 |
| endoflife | devops 加强(+版本 EOL/生命周期/停止支持 词面, " eol "/" lts " 空格锚定防裸子串误伤 results/salt) | 意图解析型双腿: /api/all.json(6KB)产品 slug 词面匹配(含 golang→go 别名表) → /api/{slug}.json; **实弹抓获: 各 cycle 共享同一规范页 URL, 多 ref 被融合层"按 URL 去重+长 snippet 胜出"跨条目错位(title 3.14 配 3.13 数据)→产品页单 ref 聚合前 3 cycle 紧凑串联** |
| frankfurter | finance 加强(+汇率/兑换/exchange rate 词面) | ECB 法币参考汇率; 双腿: /v1/currencies 币码提取(ASCII 3 字母 token+中文币名别名表, 澳大利亚元长别名胜出防"澳元"截胡) → /v1/latest?base=&symbols=; 币对<2 合法空; 规范页 frankfurter.dev/{date}/{base}/{sym}(实弹 301 终点) |

**关账 6 案**: imdbot(workers 代理服务端 500 error_code=103, Node+curl 双证死)、scryfall(403 rule=restricted IP 级限制, 官方 FAQ 区块页)、dictionaryapi(Node undici 12s 超时+curl -m 15 同死, 传输层本机不可达, 批 8 方法学)、nagerdate(v3 仅按国家/年份列举节假日无关键词搜索, biorxiv 日期列举同款模板失配)、mankier(explain 端点单 ref 纯文本, 检索价值弱)、rfc-editor(搜索页 Nuxt SPA 客户端渲染, 无服务端结果行可 parse)。

**新收获**: ①"同规范页多实体"是融合层 URL 去重的结构性盲区(endoflife 案, lane 侧单 ref 聚合是正解); ②窄意图域行(quakes)是"意图解析型车道与泛域腿互斥"的正解——比域内守卫更干净(防 nominatim 污染); ③music 域 歌词/lyrics 词面移交 lyrics 专源(b7 路由锁同步改判 lrclib, 专源优于录音库)。

**既有行为观察(挂账)**: wikidata "who is linus torvalds" 全短语查询 no results parsed(基线 d8a2a6a stash 对比同败, 非批 11 回归; 疑全短语进实体搜索词面, 待未来批次按 rubygems 清账法查因)。

**门禁**: 164 单测全绿(148→164, 黄金样本×6+锚/码/守卫提取×4+路由锁×2+注册锁×1+拒连回归×1+意图词剥离×1, 计数锁 80→86 滚动同步 ×5 文件+devops 腿锁 ×2); gofmt/vet 干净; L1 24/24 ×3 轮 uniqDom 7.21/7.21/7.13, 出勤 31.8-32.0, 缓存热 204-205ms; MCP E2E PASS(lanes=86)。

**A/B 归因(worktree 干净基线法复用)**: 批 10 基线(d8a2a6a)同日重跑 L1 24/24 ×3, uniqDom 7.17-7.21, 出勤 30.8-30.9 → **批 11 净效应: 广度 0 回退(7.18 vs 7.20, 噪声内) + 引擎出勤 +1.05(30.85→31.9)** — 连续五批 A/B 口径正增量(+0.7/+1.1/+2.0/+1.3/+1.05)。

## 增量扩源探针第 10 批: 车道 73→80, 域 28→32 (2026-09-05)

> 探针证据链: scripts/probe-b10-sources.mjs(12 候选轮 1) + probe-b10-recheck.mjs(幸存者强度复验+红灯修正) + probe-b10-final.mjs(定案+黄金样本)
> 全流程同批 9: 探针定案 → 车道实现 → 黄金样本单测 → 车道直调实弹(验完删) → 全门禁 → A/B 归因

**接入 7 车道**(四新域 + 双域加强):

| 车道 | 域接线 | 亮点 |
|---|---|---|
| thecocktaildb | **新 drinks 域**(鸡尾酒/调酒/cocktail 词面) | themealdb 姊妹站 test key "1"; 实弹 `drinks:null`=正常空(themealdb 同款); 含 strInstructionsZH-HANS 中文做法字段; 详情页 /drink/{id}-{slug} 三形态全 200 验证 |
| wikivoyage | **新 travel 域**(旅行攻略/travel guide 词面) | MediaWiki action API; **实弹繁体"東京"45 hits 中文可用**; snippet 带 searchmatch 高亮→stripHtmlSnip; **实弹暴露: 简体全 CJK 查询 API 0 命中且域路由吞通用腿 → travel 行加 siteTargets ["wikivoyage.org"] 由 DDG site: 腿承接 zh**("东京旅行攻略"→zh.wikivoyage 东京指南首位) |
| uniprot | species 域加强(+蛋白质/protein/酶 词面) | **实弹 617KB→fields 瘦身 4.2KB**(fields=accession,id,protein_name,organism_name,length); reviewed:true 收敛 Swiss-Prot 精选; **实弹抓获: 响应 gzip 体未被 transport 透明解压(bad json \x1f 魔数) → Accept-Encoding: identity 显式修复**; "蛋白"裸词不收(蛋白粉/烹饪误引) |
| openvsx | **新 ide-ext 域**(vscode 扩展/jetbrains 插件 词面) | VS Code 开放市场; 响应 url 是 API 链接→规范页 extension/{ns}/{name} 实弹 200; deprecated=true 跳过 |
| jetbrains | ide-ext 双源之二 | ct=application/graphql+json 但 body 是纯 JSON(不挑); preview=描述+downloads+vendor; link 前缀 /plugin/ 校验防注入 |
| wpplugins | **新 wordpress 域**(wordpress 插件/woocommerce 词面) | 官方 1.2 API 固定字段无瘦身参数(单响应 95-134KB <1MB cap 接受); author 字段带 HTML 不收; ★rating%+active_installs 紧凑计数 |
| snapcraft | devops 加强(+snap 包 词面) | **v1 search 端点**(v2/snaps/info 404), 必需 Snap-Device-Series:16 头; **实弹: 点名 snap(firefox.mozilla) 无 snapcraft.io 规范页(404) → 优先 links.website[0] 可达页, 纯名回退 /{name}, 两者皆无跳过防死链** |

**遗留清账: rubygems 熔断查因(批 9 挂账 ok=0/fail=7 no results parsed)**: 实弹归因 — API 形状未变且存活(curl 200 形状与 parse 结构体完全匹配), 根因=**含中文词面全灭**("ruby 哪个 http 客户端包好"→[], "best ruby http client library"→命中, "http"→30 条); 空数组是词面性零结果而非故障, parse 不再报错(归零防熔断污染, openfda 惯例) + lane 内 asciiFace→longestASCIIToken 双级降级(批 8/9 模式合用); 修复后全链路 CLI 验证 "ruby gem 推荐"→packages 域→rubygems 8/8 refs 全中。

**意外抓获: security 域 "rce" 裸子串潜伏 bug** — "woocomme**rce**" 命中 security 词面, 任何含 source/force/merce 词的查询误入安全域(b10 路由锁测试暴露, TS DOMAIN_TABLE 同款潜伏); 修复= "rce"→" rce " 双侧空格锚定。

**关账 5 案**: boardgamegeek(XML API2 401 应用层鉴权, 浏览器 UA 同样 401, keyless 纪律)、reliefweb(v2 匿名 403 "not using an approved appname", appname 需人工申请)、**gdelt(curl 12s 超时 0 字节, 传输层归因=本机网络不可达, 批 8 "先归因再定生死"方法学应用)**、homebrew(formulae.brew.sh/api/search.json 404, 批 5 "无 API" 关账维持, 复核成本 1 请求)、softwareheritage(200 但返回 Anubis 挑战页 "Oh noes!", AUR 同族指纹级挑战)。

**门禁**: 148 单测全绿(137→148, 黄金样本×7+路由锁×2+注册锁×2+拒连回归×1+rubygems 清账锁×1, 计数锁 73→80 滚动同步 ×4 文件); gofmt/vet 干净; L1 24/24 ×3 轮 uniqDom 7.50×3; MCP E2E PASS(lanes=80, circuit_open=0)。

**A/B 归因(worktree 干净基线法复用)**: 批 9 基线(c45d8c1)同日重跑 L1 24/24, uniqDom 7.50, 出勤 27.8 → **批 10 净效应: 广度 0 回退(7.50 vs 7.50 同日持平) + 引擎出勤 +1.3(27.8→29.1)** — 连续四批 A/B 口径正增量(+0.7/+1.1/+2.0/+1.3)。

## 增量扩源探针第 9 批: 车道 68→73, 域 23→28 (2026-09-05)

> 探针证据链: scripts/probe-b9-sources.mjs(12 候选轮 1) + probe-b9-recheck.mjs(幸存者复验: 参数/方差/限频/词面) + probe-b9-final.mjs(定案轮) + probe-b9-shapes.mjs(黄金样本) + bench-gate.mjs(bench 门禁脚本首度入仓)
> 全流程同批 8: 探针定案 → 车道实现 → 黄金样本单测 → 车道直调实弹(验完删) → 全门禁 → A/B 归因

**接入 5 车道**(消费内容四新域 + books 词面重启):

| 车道 | 域接线 | 亮点 |
|---|---|---|
| coingecko | **新 finance 域**(加密货币/比特币/blockchain/nft 词面) | 免费档限频极严(**实测连打 5 次第 5 次即 429**)→ crypto 窄词面守卫天然限流 + 腿内降级仅一次机会; 三字母 btc/eth 会误伤 method 等词不收; **实弹抓获: "bitcoin 价格"混合词空结果 → asciiFace 降级补齐** |
| themealdb | **新 food 域**(食谱/菜谱/recipe 词面) | 免费测试档; "做法"太泛不收; 实弹确认仅英文词面(中文 null=正常降级); strInstructions 1371b 需截断 |
| kitsu | **新 anime 域**(动漫/番剧/anime/manga 词面) | **Jikan/MAL 关账后的 anime 替代源**; JSON:API 形态; 2.3-4.8s 慢源腿超时内; "动画"会误伤 css 动画但表序 programming 在前截胡 |
| thesportsdb | **新 sport 域**(球队/篮球队/nba team 词面) | 免费档 test key "3" 30 req/min → sport 窄词面守卫; **实弹抓获: API 是「查询词必须为队名子串」语义, 混合词全词面仍 0("NBA Lakers"≠"Los Angeles Lakers"子串) → 二级降级 longestASCIIToken("NBA Lakers"→"Lakers"✓), 腿内最多 3 请求**; idTeam "0"=无效条目形态(gbif key=0 同模式) |
| standardebooks | **新 books 域**(公版书/名著/电子书 词面, gbooks/openlibrary/gutendex 全关账后 books 词面重启) | 精工 HTML 车道: li[typeof=schema:Book] about=规范路径, p0=书名 p1=作者; 公版书覆盖窄但结构稳定 |

**二级降级模式(批 9 新增)**: thesportsdb 的「整体子串」匹配语义与 tvmaze「AND 分词」不同 — asciiFace 全词面重查后仍 0 时, 再用最长 ASCII token(≥3 字母)重查一次; 球队短别名("Lakers/Warriors/United")高频出现是结构性场景, 免费档配额可承受。

**关账 7 案**: oeis(CF 403 复验维持)、gbooks(429 配额池复验维持)、openlibrary(连接超时复验维持)、jikan(上游 MAL 拒连复验维持, Kitsu 作替代)、relevantxkcd(API 端点 404 已死)、**remotive(search 参数无效——golang/kubernetes 两查询返回相同 18 条固定列表, 不可用作搜索)**、poetrydb(通配语法 404, 精确匹配语义弱 + 2.8s 慢, 价值低)。

**门禁**: 137 单测全绿(129→137, 黄金样本×5+路由锁×2+注册锁×2+拒连回归×1, 计数锁 68→73 滚动同步 ×3 文件); gofmt/vet 干净; L1 24/24 ×3 轮 uniqDom 7.08-7.17; MCP E2E PASS(lanes=73, circuit_open=0)。

**A/B 归因(worktree 干净基线法复用)**: 批 8 基线同日重跑 L1 24/24, uniqDom 7.13, 出勤 23.5 → **批 9 净效应: 广度 0 回退(7.13 vs 7.08-7.17 同日持平, 噪声内) + 引擎出勤 +2.0(23.5→25.4, 批 8 为 +1.1, 5 新车道真实贡献)** — 连续三批 A/B 口径正增量(+0.7/+1.1/+2.0), 广度持续不回退。

## 增量扩源探针第 8 批: 车道 61→68, 域 17→23 (2026-09-05)

> 探针证据链: scripts/probe-b8-sources.mjs(12 候选两轮) + probe-b8-recheck.mjs(修正复验) + probe-b8-round2.mjs(7 幸存者强度复验) + probe-b8-final.mjs(定案轮) + probe-b8-shapes.mjs(黄金样本)
> 全流程同批 7: 探针定案 → 车道实现 → 黄金样本单测 → 车道直调实弹 → 全门禁 → A/B 归因

**接入 7 车道**(消费内容四域 + 生命科学两域 + 法律双源):

| 车道 | 域接线 | 亮点 |
|---|---|---|
| tvmaze | **新 tv 域**(电视剧/第几季/tv show 词面) | 官方无认证; summary 带富文本 → stripHtmlSnip; 多语言别名库(纯中文「黑镜」命中 Black Mirror); **实弹抓获: AND 语义中文修饰词全灭("breaking bad 第几季"→[]) → asciiFace 降级重查** |
| itunes | **新 podcast 域**(播客/podcast 词面) | Apple 官方 ~20 req/min 腿内单请求合规; content-type text/javascript 但体为 JSON(Go 侧不看 CT); trackCount 拼「N 集」 |
| steam | **新 games 域**(steam 游戏/pc game 词面) | 实弹确认仅英文词面, 中文词 0 结果=正常降级; 折扣价对 initial→final; URL /app/{id}/ 构造闭环 |
| gbif | **新 species 域**(学名/拉丁名/taxonomy 词面) | nubKey 规范页 URL; **实弹抓获: backbone 多记录同 nubKey(同物种×5 全同 URL) → seen map 去重**; **实弹抓获: 中文疑问修饰词拉长查询把 Ginkgo 挤出 top3 → 疑问后缀剥离**("银杏的学名是什么"→"银杏") |
| openfda | **新 drug 域**(药品说明书/适应症/medication 词面) | 字段全为 []string 取首元素; 响应肥(199-464KB)<1MB cap; 无详情页 → DailyMed(NIH) 搜索页闭环; **实弹抓获: 中文词面报 400(非 404) → 400 归零结果防熔断污染 + asciiFace 重查** |
| federalregister | **新 legal 域**(联邦法规/美国法规 词面, 双腿之一) | fields 裁剪生效(5-8KB); type+agencies+abstract 三拼 snippet; **实弹抓获: 中文混词 count=0 → asciiFace 重查** |
| courtlistener | legal 双腿之二(判例/case law 词面) | v4 匿名可用(35-54KB fields 参数被忽略); absolute_url 相对路径补前缀; 429 显式报错供熔断器累积; 长尾 1.3-3.9s 在 6s 腿内 |

**asciiFace 共享降级**(批 8 新模式): 中文修饰词在纯英文语料库(tvmaze/openfda/federalregister/courtlistener)全灭是结构性行为 → 全词空结果且存在 ASCII 词面时重查一次(腿内最多 2 请求, 6s 内合规); gbif 另配中文疑问后缀剥离。

**关账 5 案**: gbooks(Google Books 匿名 429×2, 共享配额池耗尽不可控)、jikan(504×2 上游 MAL 拒连 Jikan 服务本身)、openfoodfacts(fields 参数即 503, 无参数 548KB 肥响应, 工程面不划算)、lobsters(fetch failed×3 连接层拒)、devto(q 参数无效=默认流, forem 内部 search 端点 0 条)。

**探针方法学新收获**: tvmaze 探针间歇失败按"查询词绑定"假象复现 → 深挖实为 Node undici 无 happy-eyeballs 且本机 IPv4 路径劣化(连接池污染全挂); curl IPv4 直连正常证服务端无恙; **Go net.Dialer 原生 RFC 8305 双栈回退免疫此坑** — 探针失败先做传输层归因再定源生死。

**门禁**: 129 单测全绿(119→129, 黄金样本×7+路由锁×2+注册锁×2+拒连回归×1); gofmt/vet 干净; L1 24/24 ×3 轮 uniqDom 6.13-6.17; MCP E2E PASS(lanes=68); 二进制 12.2MB。

**A/B 归因(批 6/7 方法论复用)**: worktree 干净构建批 7 基线同日重跑 uniqDom 6.21(其自身历史 6.9) → 6.13 vs 6.21 净差 -0.08=噪声级, 逐题 22 平/2 题↓1/0 题↑; **批 8 净效应: 广度 0 回退(噪声内) + 引擎出勤 +1.1(21.7→22.8)**。基线自身 6.9→6.21 缺口=外部漂移持续。

## 增量扩源探针第 7 批: 车道 56→61 (2026-09-05)

> 探针证据链: scripts/probe-b7-sources.mjs(12 候选+biorxiv 快验) + probe-b7-recheck.mjs(幸存者复验+形态修正)
> 全流程同批 6: 探针定案 → 车道实现 → 黄金样本单测 → 单车道直调实弹(验完删) → 全门禁 → A/B 归因

**接入 5 车道**(helm chart 聚合 + NASA 图像 + 音乐录音 + 浏览器扩展 + 航天发射):

| 车道 | 域接线 | 亮点 |
|---|---|---|
| artifacthub | devops + helm/helm chart/opa policy 关键词 | kind=0 过滤(响应无 kind 字段, 过滤后 URL 构造才闭环, 页面 200 实弹验证); stars/license/official 透传 |
| nasaimages | images + nasa/太空照片 关键词 | images.nasa.gov/details/{nasa_id} 规范详情页; date_created 截日期 |
| musicbrainz | **新 music 域**(歌曲/歌词/这首歌/什么歌 词面) | TOS 1 req/s — 腿语义单请求天然合规; artist-credit 拼接 + disambiguation + 时长格式化 |
| mozaddons | **新 browser-ext 域**(只收 firefox 词面, 泛词会错引 chrome 需求) | name/summary 本地化对象 default_locale>en-US>zh-CN>首值 择优; **实弹纠正: limit 参数无效, 正确参数 page_size** |
| thespacedevs | **新 space 域**(火箭/发射窗口/spacex/starship 词面=守卫, 防烧匿名 15 req/h 配额) | 网页 URL 实弹 404 → 规范可达页=响应自带 API 条目页; 429 显式报错供熔断器累积 |

**关账 8 案**: openlibrary(5/5 持续 >9s 超时, 6s 腿内不可能完成)、archive.org advancedsearch(持续超时)、zbmath(1/2 超时方差, 比 maven 40% 更差)、pubchem(name lookup 非 relevance 搜索+autocomplete 400)、usgs FDSN(无文本 query 语义)、oeis(CF 挑战, 同 AUR/gutendex 案)、fatcat/scholar.archive.org(超时, 归档疑案)、biorxiv(API 只支持日期区间浏览无关键词搜索)。

**门禁**: 119 单测全绿(111→119, 黄金样本×5+路由锁×2+拒连回归×1); L1 24/24 ×4 轮; MCP E2E PASS(cache_stats lanes=61); 引擎出勤 20.0(批 6 同日 A/B 19.3); 缓存热 178-206ms。

**A/B 归因(批 6 方法论复用)**: stash 批 7 改动 → 批 6 代码同日重跑 uniqDom 亦 6.9 → 7.25→6.9 缺口=外部漂移(web 腿世界状态), **批 7 净效应: 广度 0 回退 + 引擎出勤 +0.7**。广度硬约束达标方式: A/B 同日同环境归因替代历史单点对照。

## 增量扩源探针第 6 批: 车道 49→56 (2026-09-05)

> 探针证据链: scripts/probe-b6-sources.mjs(12 候选两轮) + probe-b6-recheck.mjs(存疑定案) + probe-b6-shapes.mjs(黄金样本)
> 全流程: 探针定案 → 车道实现 → 黄金样本单测 → 单车道直调实弹(临时 test 验完删) → 全门禁 → A/B 归因

**接入 7 车道**(包生态缺口 + 发行版 + 物理/欧盟学术 + 自由媒体 + 天气):

| 车道 | 域接线 | 亮点 |
|---|---|---|
| nuget | packages + dotnet/.net/c# 信号裁腿 | verified 徽标+下载量; .NET 生态补位 |
| hex | packages + elixir/mix.exs 信号 | licenses 透传; Elixir 生态补位 |
| arch | devops + arch linux/pacman 关键词 | 上游 URL 优先, 官方包页兜底 |
| inspirehep | academic + **物理意图守卫**(零请求) | fields 参数瘦身 2MB→20KB; 链接优先级 arXiv>DOI>INSPIRE |
| openaire | academic + **OA 意图守卫** | refs 全 doi.org 与 crossref 同域 → 仅 open access/开放获取意图出勤(差异化定位) |
| commonswiki | images | File 命名空间全文搜, index 排序, Kind image |
| openmeteo | **新 weather 域**(双腿: Nominatim 定位→forecast 实况) | WMO code 释义; open-meteo 自家 geocoding 中文索引只认繁体(简体"东京"仅命中江苏东京镇)→腿1 换 Nominatim 关账自家 geocoding |

**关账 5 案**: maven(246-605ms 快但 40% 8-10s 超时方差, solrsearch 结构性不稳)、conda(3-10s 慢)、debian sources(API 404 已死)、gutendex(CF 挑战)、reddit(403 挑战页)。

**门禁**: 111 单测全绿(黄金样本×9+守卫×3+接线锁×2); L1 24/24 ×5 轮; MCP E2E lanes=56 circuit_open=0; 引擎出勤 18.5(批 5 为 15.9); 缓存热 198-204ms。

**A/B 归因法(方法论新增)**: 批 5 代码同日重跑 uniqDom 亦 7.25/7.29(昨日记录 7.54=外部世界快照), 批 6 同日 7.25-7.33 → **代码净效应: 广度 0 回退 + 出勤 +1.0**; 外部漂移(web 腿世界状态)与代码效应解耦, 广度回归不再单靠历史单点对照。
