# 全领域评测报告（36 域 × 77 题）— 扩源批 13 前置裁决

- 日期: 2026-09-05 · 基线: acbee81 (批 12) · 二进制: search-core-go (go1.25.0)
- 题库: `scripts/eval-domain-cases.mjs` 每域 2-3 题, 36 域 77 题, 中英双语, 对齐 planner.go domainTable 触发词并规避表序截胡
- 执行: `scripts/eval-domain.mjs` 干净 SC_DATA_DIR 冷跑(防缓存污染), --topn 10 --timeout 20000, 题间 1.2s 护限流车道
- 产物: /tmp/eval-domain/results.jsonl (原始) + analysis.txt (汇总), 分析脚本 `/home/z/my-project/scripts/analyze_domain.py`
- 口径: 命中=标题+摘要低配关键词命中(同 bench-gate); refs[].engines=真实贡献源; enginesUsed=跑过的腿(含 fallback 扩腿, 不代表贡献)

## 1. 总指标

| 指标 | 值 | 说明 |
|---|---|---|
| 字面命中 | **43/77 (55.8%)** | bench L1 是 24 题手工调优题, 不可比 |
| 复核修正后 | **45/77 (58.4%)** | quakes 2 题为 expect 口径误判(见 §4), 实为完美命中 |
| 全题均值 | refs 5.4 / uniqDom 3.1 / wall 2.9s | 冷跑含软超时, travel 双题 20s 拉高均值 |
| 域分层 | **健康 10 / 偏薄 13 / 真空洞 8 + 半空洞 1** | 分层标准见 §2 |

核心反差: bench L1 100% vs 全领域 58.4% —— 差距不在头部域, 全在批 7-12 新增的窄域专源车道。

## 2. 域分层

**健康 10 域** (hit 100% 且 avgRefs≥8): packages, devops, programming, images, news, data, academic, security, dictionary, medical
- 全是批 6 之前的老域 + 通用引擎承重充分的域。academic 虽 3/3 hit 但 core 学术腿(arxiv/dblp/pubmed/openalex/doaj)当天集体软超时, 靠 crossref+wikipedia+keenable+fallback 扩腿(单题最高 64 lanes)兜住, 属"险胜"。

**偏薄 13 域** (hit≥50% 但 avgRefs<4 或词面偏科): wordpress(3.0), podcast(3.0), weather(1.0), ide-ext(5.0), lyrics(2.0), species(2/3), chemistry(1/2), music(1/2), browser-ext(1/2), legal(1/2), finance(1/2), food(1/2), travel(1/2 且 API 腿 20s 超时)
- 薄因三类: ①专源天然返回少(weather/lyrics/podcast) ②中文词面偏科(music 中文命中翻唱版/browser-ext 中文返回通用扩展/species 中文返回分类根元垃圾) ③API 腿超时(travel wikivoyage 双题 20s 软超时, 仅 DDG site 腿 3 refs 承重)。

**真空洞 8 域** (双语双题全 0 refs): tv(tvmaze), games(steam), manga(mangadex), sport(thesportsdb), drinks(thecocktaildb), space(thespacedevs), books(standardebooks), geo(nominatim)
- **上游存活抽查全部存活且数据正常**(curl 实证: tvmaze 找到 Breaking Bad / cocktaildb 找到 Mojito / mangadex 找到 Frieren / steam 找到 Portal 2 / standardebooks 55 hits / nominatim 找到西湖)。根因不是上游死, 是**车道对自然语言多词查询缺意图词剥离**: "breaking bad tv series seasons how many" 整串发给 singlesearch 语义 API → 0 命中, asciiFace/longestASCIIToken 降级链未 rescue。这正是 b11(lrclib 歌词意图词)/b12(inaturalist 物种意图词+pubdev asciiFace)已修过的同款病, 未推广到这 8 条车道。
- mangadex 特别注意: 批 11 关账时"葬送的芙莉莲"裸题直中, 本测"葬送的芙莉莲 漫画 连载"0 命中 —— 车道只能吃裸标题, 吃不了自然语言查询。

**半空洞 1 域**: entities — wikidata 都命中的正确实体(Huawei Q160120 / Australia Q408), 但 wbsearchentities 的 description 不含答案字段(任正非/Canberra), 用户可见结果"对而不答"。需要取 claims(P569/P112 等)而非 description。

## 3. 车道贡献矩阵 (77 题聚合)

- **承重 top**: keenable(6 题/37 refs)·dockerhub(3/22)·searxng(通用引擎, 65 refs 全场第一)·inaturalist(3/7)·openvsx(3/7)·musicbrainz(3/7, 含翻唱噪声)·wikidata(3/7)
- **ZERO 36 条** 分两亚类:
  - 失败型(网络/限流/软超时, 冷跑会话噪声为主): stackexchange, hn, arxiv, dblp, pubmed, openalex, doaj, huggingface, openverse, packagist, crates 等 —— 同日 bench 热缓存全绿, 冷跑 20s 软截止杀慢腿(zenodo/hfpapers 实测 11-20s)。属基础设施带宽问题, 非车道逻辑问题。
  - **静默零输出型(ran OK 但 0 贡献, 全程无报错)**: tvmaze, steam, mangadex, thesportsdb, thecocktaildb, thespacedevs, standardebooks, nominatim, github, mdn, arch, snapcraft, endoflife, gbif, coingecko, themealdb, pypi, repology, nuget, openaire, inspirehep, ghsa, googlenews, bingnews —— 前 8 条即 8 真空洞域元凶; 其余多为"跑赢的兄弟腿"挤掉(arch 被 dockerhub 挤, pypi 被 npm 挤), 属正常冗余。
- **通用引擎承重**: searxng 65 · bing-news 11 · sov2ex 9 · yahoo 9 · bing-rss 8。news 域 refs 全部来自通用 bing-news 腿, API 版 googlenews/bingnews 零贡献。

## 4. expect 口径误判复核 (MISS 但实际命中)

- quakes 双题: USGS 返回 "M 6.3 - 84 km SSW of Nikolski, Alaska" 等, 标题格式天然不含 "earthquake" 字样 → 完美命中, 判罚有误。expect 设计对 USGS 标题格式不友好。
- entities/music zh/browser-ext zh/species zh/drug en/anime en: 属"返回了但答非所问/质量差"(翻唱版冒充原唱、SILICEA 冒充 ibuprofen、蕨类根元冒充大熊猫), 计 MISS 合理, 单列质量缺口。

## 5. 批 13 裁决

**不开扩源批。开"车道修复批"**(repair batch):

1. P0 — 静默零输出 8 车道接意图词剥离/降级(b12 模式推广): tv, games, manga, sport, drinks, space, books, geo(nominatim 查 UA/参数)。修好后按本测题库复测, 目标 8 域 0/16 → ≥10/16。
2. P1 — entities 摘要升级: 从 wbsearchentities description 换/补 claims 直取(P112 创始人/P36 首都/P1080 等), "对而不答"→"对且答"。
3. P1 — 中文词面偏科 3 处: music(原唱优先, 翻唱降权)、browser-ext(AMO 搜索 asciiFace 化意图词)、species(inaturalist 中文俗名直查, 分类根元过滤)。
4. P2 — 慢腿带宽: zenodo/hfpapers/zenodo 类 11-20s 慢腿单独短截止(8s)或降权, 防 fallback 扩腿 60+ 烧资源。
5. P2 — openfda/anime(drug/kitsu)多词查询 asciiFace 化。
6. 不扩新源的依据: 本测证明有 8 个已接域用户可见 0 输出, 每修一条的边际收益(0→可用)远高于新增一条车道(锦上添花); 且 A/B 出勤增量已六连衰(+0.7→+0.55)。
7. 遗留观察: stackexchange/hn 冷跑全败需下次会话复验(疑似限流噪声); travel wikivoyage API 腿 20s 超时单独查。

## 6. 复现

```
node scripts/eval-domain.mjs --part 1..4   # 断点续跑, 结果 /tmp/eval-domain/results.jsonl
python3 /home/z/my-project/scripts/analyze_domain.py
```
