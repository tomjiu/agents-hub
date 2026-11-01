# 质量抽检报告（批 15）— 77 题 top-1 人工可读性复核

- 日期: 2026-09-05 · 基线: b62fbc3 (批 14 收尾后) · 口径: 命中率 77/77=100% 之上做"命中≠真解决"抽检
- 方法: 逐题导出 top-2 (title+url), 从严三档判定 — A 真·直中(top-1 即用户所需权威答案) / B 相关但非最优(意图在后位) / C 词面垃圾(top1-2 答非所问)

## 1. 判定总览

| 档 | 数量 | 占比 | 说明 |
|---|---|---|---|
| A 真·直中 | 53 | 69% | arxiv 原论文/npm 官方包/NVD 条目/wikidata claims 直答/USGS 等 |
| B 相关在后 | 19 | 25% | top1 相关但意图位在后(书词条 vs 全文/词条 vs 集数/翻版 vs 本尊) |
| C 词面垃圾 | 5 | 6.5% | 见 §2, 全部修复翻中 |

## 2. C 类五题与病灶根因

| 题 | 病灶 | 根因 | 修法 |
|---|---|---|---|
| 高血压 荟萃分析 | metacpan Tiezi-Robot 压顶(0.758), 真荟萃分析垫底(0.164) | ①metacpan ES 对纯 CJK 单字 OR 匹配返回无关 Perl 包 ②tokenize 无 CJK 分词, 连续中文整句成单 token, **中文题 lex 恒 0**, 排序退化纯 rrf | metacpan 纯 CJK skip + tokenize CJK bigram |
| 富士山 stock photo | keenable SEO 首页 0.90 > pixabay 真图库 0.54 | 同上(bigram 缺失) + images 表 a 档 | bigram 后 pixabay 词中匹配+authority 叠加翻顶 |
| ubiquitous etymology | wiktionary 返回 dopeness/félkövér 随机词条 | 整串 srsearch("原词有结果但答非所问"病灶) | b13DictionaryIntentRe 先剥后查+原词兜底 |
| python http 客户端 | rubygems xhttp@0.1.0 垃圾霸榜 | packageLangSignals 无 python→pypi 条目, 中文空查全源乱跑 | 补 python/pip/pypi→pypi 语言路由 |
| diffusion survey | wikipedia "Large language model" 词条压顶 | topics.json 只有 7 topic, academic 表虽在但词条的 rrf+lex 压过 | topics.json 补表(arxiv/springer 等已有, bigram 后 springer survey 顶起) |

## 3. 修复内容 (b15)

1. **tokenize CJK bigram** (fusion.go, 第一性修复): 连续 CJK 段(>2 rune)切二元语法, 词中可匹配("荟萃分析"∩"最新**系统综述**和"✓); 英文/数字 token 不变。中文题从"lex 恒 0"恢复为有词法信号, **全部中文题排序受益**, 不止 C 类五题。
2. **metacpan 纯 CJK skip** (lanes_registries.go): 无 ASCII 词面查询直接跳过(b12 pubdev asciiFace 先例), Perl 生态语料 ASCII-only。
3. **packageLangSignals 补 python→pypi** (planner.go): python/pip/pypi 信号词路由。
4. **laneWiktionary 先剥后查+原词兜底** (lanes_special.go): b13DictionaryIntentRe(meaning/etymology/什么意思/释义/词源/含义/出处)。
5. **topics.json 补 28 个窄域权威表** (data/authority/topics.json): medical/chemistry/dictionary/travel/sport/finance/drug/food/species/tv/games/manga/anime/books/drinks/space/geo/quakes/weather/lyrics/music/legal/data/security/wordpress/ide-ext/browser-ext/podcast — topic authority 对批 7-14 窄域从空转生效。

## 4. 修复后验证

- C 类五题复测: ubiquitous→wiktionary 词条直中 / python→GitHub best-python-http-clients 精选 / 高血压→"抗阻训练对高血压…随机对照试验的系统综述与荟萃分析"(1.914 碾压) / diffusion→springer "Lightweight diffusion models: a survey" / 富士山→pixabay 图库(top1)
- 全量 77 题回归: **77/77=100% 保持**(零回退; 1 题瞬时噪声为 keenable 限流窗口+SC_DATA_DIR 缓存固化假阴性, 清缓存复跑 HIT, 与 b12"缓存干扰"教训同源)
- 全门禁: 测试全绿(tokenize 单测断言更新为 bigram 语义) / E2E PASS lanes=90 / bench L1 24/24 uniqDom 7.42 出勤 30.8

## 5. 遗留与后续

- B 类 19 题为排序微调空间(词条 vs 全文/本尊 vs 翻版), 边际收益低, 不立项
- keenable 承重 75.7% 单点观察项不变; 评测脚本建议永久带 SC_NO_CACHE=1(防缓存固化假阴性)
- 中文明星题(晴天歌词/大熊猫/西湖/玛格丽特)bigram 后可再抽检一轮观察 top1 漂移
