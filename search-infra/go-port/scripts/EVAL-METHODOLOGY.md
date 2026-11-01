# 评测方法论 (b16-b18 沉淀) — 修法判据 · 题库四轨定位 · 外部锚点口径

- 目的: 防后续批次滑回"对题库刷分", 固化批 16-18 三批实弹验证过的评测与修复纪律。
- 2026-09-06 · 适用: search-core-go 全部后续质量批次。

## 1. 题库四轨定位 (各轨分工, 缺一不可)

| 轨 | 题量 | 性质 | 回答的问题 | 脚本 |
|---|---|---|---|---|
| bench L1 门禁 | 24 | 题库内 | 改动是否毁坏基线 | bench-gate.mjs |
| 全领域回归 | 77 | 题库内 | 域覆盖真实性回归 | eval-domain.mjs |
| 泛化探针 | 72 (36域×2) | 题库外手写 | 换实体/换措辞的泛化 | eval-probe16.mjs |
| 外部锚点 | NQ 190 + TriviaQA 200 | 现成数据集抽样 | 真实分布水位 (防自嗨) | eval-external.mjs |

- 第一性教训 (b17): "题库内 77+探针 72 双百"仍藏着外部基准首轮就抓出的缺陷 —
  自建题的出题视角会无意识对齐实现; 外部集是唯一无偏视角。
- "命中≠穷举": 题库验证规则, 规则服务长尾。不追求题库覆盖所有用户问法。

## 2. 修法判据 (防过度调整)

- **修产品**: ≥2 题同根因, 或车道级通用规则 (b18 例: 意图词剥离虚词 → 所有
  "who is the X of Y" 句式受益; 疑问骨架词假亲和 → 所有自然语言问句受益)。
- **修题库**: 单题差异 (expect 词面错 / 出题踩表序截胡 / expect 对齐流行误传而非权威源)。
- **不立项**: 边际收益低且风险不对称的微调 (B 类 19 题排序微调, 连续三批裁决不立项)。
- 两个外部集同模式 (hit@1 与 hit@10 差 41-43pp) 才立项排序头部优化 — 单集证据不立项。

## 3. 外部锚点口径 (NQ-open / TriviaQA)

- 数据: NQ-open dev 3610 题等距抽 190; TriviaQA rc.nocontext validation 抽 200
  (fetch-triviaqa.mjs, HF datasets-server API 轻量分页)。
- 匹配: verbatim + tokenAND 双档 (评测器 STOP 表 + 数字 token 防虚中)。
  匹配器与产品排序的 stopWords 同思想 — 口径对齐, 但**互不联动改动**。
- 已知口径偏差 (记录在案, 不改匹配器迁就):
  - NQ gold 人名全名 ("Mark Richard Shuttleworth") vs 产品直答常用名 (wikidata P112
    label) — tokenAND 缺中间名 token 判 miss, 产品行为正确。
  - NQ gold 是 2018 年标注: 时效漂移题 (CSM 换人/大桥完工/赛季对阵) 测的是
    "历史事实召回"; 产品答"现在正确的人"与旧标注不符属数据集固有属性。
  - TriviaQA 标注来自老 trivia 书籍: "俄亥俄最大城市"标注 Cleveland (1950s 事实),
    产品答 Columbus 是现代正确答案 — 知识老化题, 同上。
- 波动纪律: live web 搜索单轮水位有 ±4pp 波动 (上游限流/结果漂移); 趋势判断看
  同日前后对照与双集同向, 不看单点绝对值。评测永久 SC_NO_CACHE=1 (b12/b15 教训)。

## 4. b19 定版水位 (n=390)

| 集 | hit@1 | hit@3 | hit@10 | 备注 |
|---|---|---|---|---|
| NQ-open (190) | 32.6% | 55.8% | 77.9% | 真实 Google 查询, 含时效/解释/列表型 |
| TriviaQA (200) | 50.0% | 73.0% | 88.0% | trivia 事实型, 产品甜区 |

- b18 修复贡献: TriviaQA hit@1 +3.5pp (45.0→48.5), NQ 中性 (±1.5pp 波动带内)。
- b19 答案抽取层贡献: 双集同向 — NQ hit@3/hit@10 +4.7pp (73.2→77.9), TQA hit@1
  破 50% / hit@3 +3.0pp / hit@10 +2.0pp。"证据在正文不在摘要"存量被搬进摘要。
- miss 结构 (NQ 49 题归因): 时效漂移 ~25% / 影视冷知识长尾 ~37% / 解释型句子
  gold ~18% / 证据在正文不在摘要 ~12% / 其他零星 — 前三类是数据集特性与
  通用 web 腿上限, 非排序缺陷, 立项需新架构层 (答案抽取/知识库), 超出微调范畴。
- **b23 注入空间修复** (answer_extract.go): b19 拼接后整体钳 400ch, 长基底
  (恰 400ch, 占 SURFACE 案例 4/5) 把注入句整体挤到不可见。v1 修法(截基底
  预留空间)评测实锤翻车: NQ 23.7% (-8.9pp) 且 ON==OFF 逐位相同 — 截掉的
  基底尾部本来携带证据 token, 注入价值被归零, **非破坏式才对**。v2 定版:
  基底完整保留 + 上限 400→560 只截 s 尾部; 同窗 A/B 实证 +4.2pp hit@1
  (ON 27.1% vs OFF 22.9%, NQ parts1-2)。
- **b23 方法论沉淀: 注入类修改的验收必须同窗 A/B** (同二进制 SC_ANSWER_PASS
  0/1 对拍) — 本轮上游漂移 -7pp (b21 窗口 30.2% → b23 窗口 22.9%, PASS=0
  同测实锤与代码无关), 绝对值跨窗对比会同时冤枉好修复、放过坏修复。b23
  窗口绝对水位 (漂移压低, 记录在案): NQ 25.8/52.1/74.2, TQA 52.5/71.5/88.0。

## 5. 车道级修法沉淀 (b18 两项)

1. **意图剥离补虚词** (lanes_b12.go b12IntentStopwordRe): "who is the founder of
   the ubuntu project" 剥意图词后残留 "the of the ubuntu project" 虚词噪声 →
   wbsearchentities 0 结果 → 纯路零输出。虚词剥除后 "ubuntu project" → Q381 →
   P112 直答 "创始人 Mark Shuttleworth" 闭环 (NQ 零输出 1→0)。
2. **疑问骨架假亲和压制** (fusion.go stopWords 补 where/whom/whose/do/does/come):
   "In baseball, where do the Orioles come from?" 的骨架词面被论文标题高频模式
   ("Where do X come from?") 完整命中, 无关论文压顶真词条 rank3。骨架词出 lex
   信号后 Orioles 词条升 top1。保守不加: did (DID 主题冲突) / will (人名) /
   情态动词族 / have 族 — 观察项, 单集证据不改表。

## 6. 重排路线裁决 (b20: 零模型 embedding 增量实验)

- 问题: "embedding 重排是否要上重排模型?" — 先用零成本实验量化 TF-hash
  (semantic.go 现款, 512 桶 FNV, 只用于去重) 作为排序增量信号能吃掉多少头部缺口。
- 实验: eval-external-dump.mjs 全量 refs 落盘 (NQ 98 + TQA 100, topn=20,
  SC_NO_CACHE=1, score-rank 单调性 197/197 验证) + analyze-rerank-replay.mjs
  离线重放变体: 融合分+λ·cosine / +短语奖励 / 纯 cosine / mix。
- 结果: 增量项 cosλ 在 NQ +1pp / TQA +0pp hit@1 (噪声带内, base hit@1 全保
  40/40 与 56/56 零损伤); 纯 cosine 单信号双集不同向 (NQ -1pp / TQA +6pp,
  9 题 gold 从#1 降到 2-3) — 按判据 (双集同向才立项) 均不立项。
- 归因: 融合分的 lex 项 (token 覆盖) 已覆盖 TF-hash cosine 的大部分信息量,
  两者高度相关 — 零模型 embedding 增量≈0 是结构性的, 不是调参问题。
- 成本对照: TF-hash 全量重排 top-20 实测 0.31ms (semantic_bench_test.go,
  延迟免费); 神经 cross-encoder 重排 (bge-reranker 级) top-10 CPU 推理
  100-300ms + 模型文件 100MB-1GB + runtime 依赖, API 重排 +200-500ms 网络往返。
- 池深度: gold 落 11-20 仅 3-4% (NQ 4/98, TQA 3/100) — 深池重排空间小,
  主战场在 top-10 内排序, 而这正需 cross-encoder 级语义区分度。
- **裁决: 现在不上重排模型**。三重理由: ① 零模型路线实测吃不动 (本实验);
  ② miss 结构大半非排序问题 (第 4 节归因); ③ 神经重排成本结构与当前
  产品形态不匹配。
- **挂账触发条件** (满足其一再立项): ① miss 归因中"gold 在 top-10 内但被
  语义无关页压顶"占比 >15% (需新增归因口径); ② 产品形态转向 top-1 直答
  (语音/简答场景) 使 hit@1 成为唯一 KPI。若届时立项: cross-encoder 打分可
  与 b19 答案抽取抓正文窗口并行重叠, 净延迟可压到 ~0-100ms。
- **b22 触发条件①首次实测: 未击发** (analyze-suppression.mjs, NQ 97+TQA 100
  dump 重放 + A/C 档 17 条全量人工裁决):
  - 口径精确化: 语义压顶 = miss@1 且 gold 证据在 rank2-10 且 rank1 页与
    查询**不同实体/主题或纯垃圾匹配**(同实体但 snippet 缺答案 token 算词面
    错位, 重排救不了)。
  - 结果: 确认压顶 9/113 miss@1 = **8.0%** (NQ 2/63=3.2%: 啤酒拉环题被
    啤酒罐 RCT 论文压顶/lullaby 翻译专辑压 songwriter 页; TQA 7/50=14.0%:
    罗马帝国压 United Artists/物理试卷压在屏电影/Joaquin 压 River Phoenix/
    LIGO 论文压 La Mancha/Milestone 压 Stagecoach/Vilyuysk 压蹦极/2022 影讯
    压 Wonder Girl — 全是词面假亲和的经典形态, cross-encoder 的靶子)。
  - 绝对上限(A+C 全算)=17/113=15.0% 恰在线上未越线; 人工裁决实锤 C 灰区
    8 条中 6 条是同实体词面错位, 非压顶。
  - 裁决: 维持挂账, 8.0% 为监控基线(下次重测对比)。
- **b22 副产品新观察项**: "rank1 正确但 snippet 缺答案 token"子类约 5pp
  miss@1 (Micky Dolenz 页缺 Monkees/Richard Marx wiki 缺歌手名/Michelle
  Smith 页缺禁赛年数/Osbert 缺 cartoonist 等) — 理论上 b19 答案抽取应吃掉
  (正文必有), 实际没吃到 → 怀疑句子评分选错句或抓取失败, 值得诊断批(b23
  候选), 比神经重排便宜两个数量级。

## 7. 挂账与观察项

- 答案抽取层 b19 已转正落地 (answer_extract.go): 问句/意图查询对 top-3 并行
  抓正文(extractHtml+双层页缓存), 句子评分=内容词覆盖+专名/数字奖励(数字 1.0
  最强 gold 载体), CJK 句长阈值 15 rune 自适应; 注入 Snippet 尾部。SC_ANSWER_PASS=0
  可关; bench 延迟 +142ms(1348ms 均值, 关键词题不触发)。
- claims 空手后救援腿 (b17/b18): 意图词纯路 + wikidata 无对应 claim 时,
  目前零输出; b18 虚词剥离已救活其中实体定位失败子类, 残留真无 claim 子类
  (ubuntu 挂 P112 后已清, 样本暂 0) — 挂账。
- 实体关系直答 (Della Street → Perry Mason 类, 差 0.002 胶着): 需关系型 claim
  (employer 等) 扩展 b13IntentProps, 观察项。
- keenable 单点限流风险 (承重 75.7%); B 类 19 题排序微调仍不立项。

## 8. 上游漂移与锚窗监控 (b24)

- **问题**: b23 同窗 A/B 实锤上游漂移 -7pp hit@1 (b21 窗 30.2% → b23 窗 22.9%,
  PASS=0 同二进制对拍), 且靠人肉对拍才发现 — 跨窗对比水位前必须先验"窗口可比性"。
- **锚窗机制 (b24 定版)**: 同题集 dump 快照即"锚窗" — 检索排序代码不变时, 双窗差异=纯上游。
  `eval-external-dump.mjs` 采集 (NQ --sample 100 / TQA --sample 100, 分段前台, SC_NO_CACHE=1) +
  `analyze-upstream-drift.mjs` 双窗 diff (按 q 全对齐, snippet 层口径与 eval 逐字一致), 自动落档
  `upstream-anchor-journal.jsonl` (append-only, 窗标识=文件名+mtime+ds, 幂等去重)。以后每次
  外部评测批前后跑一次锚窗 diff 即自动入档, /tmp 易失不再丢历史。
- **b24 首组实测** (旧窗=b22 批 08:17Z vs 新窗=b24 批 ~10:05Z, 隔 ~1.5-2h, NQ 98 对 + TQA 100 对全对齐):
  - 检索层头部零漂移: gold@1 NQ 13.3%→13.3% (Δ0.0) / TQA 14.0%→15.0% (Δ+1.0), 噪声带内;
  - 但引擎腿结构小时级剧变: marginalia 33%/12%→0 与 yahoo 17%/15%→0 (双集掉光),
    duckduckgo 0%→58%/60% (新腿大规模补位), crossref -14/-20 题; 腿数均值 7.24→6.99 / 7.57→7.11;
  - 深池比头部敏感: TQA gold@20 Δ-4.0pp (gold@10 仅 -2.0) — DDG 换掉 marginalia/yahoo 深部页,
    头部被融合稳住, 11-20 的 gold 存量换血;
  - rank1 换页率 33.7%/30.0%: 上游结果整体换血是常态, 单题级对比必须容忍。
- **结论**: ①融合层 (RRF+词面覆盖+共识+权威分) 对腿级可用性波动有结构性韧性 — 多条腿掉光
  +新腿补位的换血下头部零漂移, 是多腿架构抗单点的直接实证; ②b23 的 -7pp eval 漂移不能归因到
  本窗检索层 (本窗零漂移), 更可能在正文抽取层转化率或 b21→b22win 之间窗口 (不可考, 锚窗从此有档);
  ③评审规则: 跨窗绝对值对比前先查 journal 锚窗差, gold@1 Δ 超 ±4pp 波动带即标注"窗口漂移",
  修法结论只认同窗 A/B。
- **证据留档**: scripts/drift-report-b24.txt (双集全量 diff + regress/improve 逐题明细)。
- **keenable 观察**: 双窗题级出现率 96.9→100% (NQ) / 99→99% (TQA), 本时段无限流迹象, 继续监控。

## 8a. b24 gold 层结论修正 (b29 复审)

- **b24 的 goldAt 有大小写 bug** (scripts/drift-bug-b29.txt 全案): matchEvidence 的 hay 侧
  小写是调用方契约, b24 版漏了 → 专名型答案(China/Debra Winger/New Zealand…)全漏判,
  journal 首 4 行 hit* 低估 ~2.7 倍 (NQ gold@1 13.3% 实为 38.8% 量级)。修法见 §13。
- **影响面**: b24 的 "头部零漂移 (gold@1 Δ0.0/+1.0)" 与 "深池比头部敏感 (gold@20 Δ-4.0)"
  两条 gold 层观察降级为**不可复核** (旧窗文件已失); "融合层对腿换血免疫"命题回到待验证,
  不得再引用 b24 作为实证。rank1 换页率/腿出现率/腿数 (URL/engines 口径, 不过匹配器) 与
  腿结构小时级剧变的定性结论不受影响; "b23 -7pp 归因"案件回到不可考 (锚窗从此有档)。
- **与批 26-28 的关系**: b26 广义压顶击发 / b27 SC_RERANK 上线 / b28 定版的结论不受此 bug
  影响 (其同窗 A/B 与重放走 eval 口径, hay 均先小写), 本修正仅收回 b24 的错误实证。
- **journal 政策**: 历史行不改写, 追加 kind=correction 行声明失效字段 (原窗文件已失不可重算);
  b29 起新窗以修好口径入档 (NQ 38.8/77.6/82.7, TQA 57.0/91.0/94.0)。

## 9. miss 结构同题对齐归因 (b25)

- **方法 (结构归因的定版姿势)**: 同一题集 (sample=100 步长) 跑两层 — dump 层 (topn=20 引擎
  refs, 注入前) 与完整链路 eval (注入后最终 snippet), 按 q 对齐出交叉表。**两层各自独立跑会
  混入窗口漂移 (rank1 换页率 30-34%), 裁决以结构性大类为准、个例为辅**; 涉产品 bug 判定
  (如注入层无损性) 只认大类零异常 (dump@1→eval miss = 0/94), 个例降位须逐条核是否上游换页。
- **b25 窗结构 (eval miss@1 = 102/198)**: 位次保持 (gold 稳定在 2-10 位, 注入不改排序) 61.8%
  > 纯检索缺口 (双层无证据) 24.5% > 池深 (gold@11-20) 5.9% > 窗口换页降位 4.9% > 真残留 2.0%;
  注入层真降级 0 — b19/b21/b23 注入链路无 bug 实锤。
- **位次保持的两个子型**: A 型 (rank1 相关但无直接答案, gold Q&A/新闻页直接含答案句, ~6-7 成,
  cross-encoder 目标池) vs B 型 (rank1 正文有答案但注入选句没抓到, ~2-3 成, 修注入比重排便宜
  两个数量级)。C 型歧义 (考题时代语境) 少量双方都难救。
- **"重排可救性"口径修订**: 词面覆盖度不是重排可救性的可靠代理 (b22 保守推论基于词面直觉)。
  语义压顶严格口径 (rank1 语义无关) 未过 15% 线维持挂账; 但广义压顶 (gold@2-10 被相关页挤占)
  = 61.8% of miss@1, 其中 A 型占比需 cross-encoder 离线重放实测 — 见 b26。
- **证据**: scripts/miss-structure-report-b25.txt; 工具 analyze-miss-structure.mjs +
  analyze-align.mjs; eval-external.mjs --out 参数 (对齐实验独立产物防 done set 互串)。

## 10. 神经重排挂账最终裁决 (b26: cross-encoder 离线重放)

- **实验**: b25 位次保持池 (gold@2-10, n=71) + 全量 198 题, 用真实 cross-encoder
  (ms-marco-MiniLM-L-6-v2 quantized ONNX, 22MB, 无 PyTorch) 对 dump refs 离线重放打分,
  变体 base/cross/rrf/lin-λ。
- **结果**: hit@1 47.5%→64.6% (cross p10, +17.1pp) / 65.7% (lin-4 p20, +18.2pp); 双集同向
  (NQ +19.4 / TQA +15.0); 位次保持池救回 43/71=60.6% 掉出 0; flip 9/94 全部跌位 2-4 无消失,
  真损伤约 3-4 题 (其余为语义合理但词面不匹配 matcher 的口径税); 延迟 139-153ms/题 (batch CPU)。
- **裁决**: 触发条件实质击发 — b20 "不上重排"三理由中 ②③ 被新数据推翻 (位次保持就是排序问题;
  22MB quantized ONNX + 140ms 可并行重写了成本结构), ①的外推错误修正 (TF-hash 词面模型无效
  ≠ 语义模型无效)。**首选变体 lin-4 增量式 (score*10 + 4·cs)** — 保住融合分基底, b20 增量式
  方法论复用。批 27 立项产品集成 (SC_RERANK 开关 + 同窗 A/B)。
- **方法论**: 挂账决策三段式 = dump 落盘 (零上游成本) → 结构归因定位目标池 (b25) → 模型重放
  实测可救率 (b26); flip 必须逐条定性分"评测口径税"与"真损伤"; Python 渲染脚本防 for 变量
  泄漏 (判定与渲染分开验证)。
- **证据**: scripts/ce-rerank-report-b26.txt + scripts/ce-rerank-replay.py。

## 11. cross-encoder 重排产品集成 (b27: SC_RERANK 增强模式定版)

- **架构**: fuseSemantic 后 / b19AnswerPass 前, rerankRefs 一行接线; lin-λ 增量式
  (score*10 + λ·cs, λ 缺省 4) 保融合分基底; SC_RERANK=1 显式启用, 缺省关 = 零依赖
  底盘不变; 失败 stderr 必打 + 原序回退, 查询永不失败。
- **组件**: 纯 Go BERT tokenizer (vocab 自 tokenizer.json) + onnxruntime_go v1.36.0
  (cgo) + 22MB quantized ONNX; tokenizer golden 对拍 (Python tokenizers 生成 12 组
  逐 id 对拍) + 推理逐位一致 (MAX_DIFF=0.00e+00) 双重正确性锚。
- **同窗 A/B 验收** (n=198, 同二进制切 SC_RERANK 0/1): hit@1 49.5%→66.2% (+16.7pp;
  NQ +12.3 / TQA +20.0 双集同向), 与 b26 重放预测 (+17.1pp) 吻合; NQ hit@10 -1 题
  为 flip 税尾部 (hit@1 大幅换 hit@10 微损, 可接受)。
- **排坑沉淀**: ①'^' 等 Sk 类符号需显式补入 is_punct (Go IsPunct 只认 P 类);
  ②strip_accents = NFD 后删 Mn (x/text); ③HF CJK 加空格是逐 char 独立加, normalize
  不合并多空格; ④yalue v1.36 绑定 ↔ C API 1.29.0 ↔ pip wheel 里的 .so 三者对齐,
  GitHub release 1.18/1.20/1.21 全不匹配 ("Error setting ORT API base: 2");
  ⑤静默回退会让"回退"伪装成"生效", 失败必打 stderr + journal 事件核验。
- **证据**: scripts/rerank-integration-report-b27.txt; rerank.go / rerank_test.go /
  rerank_e2e_test.go / testdata/tokenizer-golden.json。

## 12. 重排 ON 定版水位 (b28)

- **全量定版 (sample=200, n=390, SC_RERANK=1, 本窗)**: NQ 97/137/151 = 51.1/72.1/79.5,
  TQA 140/172/182 = 70.0/86.0/91.0, 合并 **60.8/79.2/85.4**。vs b25 OFF 窗 43.6% hit@1
  跨窗 +17.2pp (含窗口成分, 干净口径=同窗 A/B +16.7pp, 互相印证); hit@10 持平
  (85.4=85.4, 重排只改排序不改召回, 力学自洽)。
- **部署件**: scripts/setup-rerank.sh 一键三件套 (pip wheel 抽 libonnxruntime.so.1.29.0
  + hf-mirror 下 model_quantized.onnx/tokenizer.json, ~51MB); SC_RERANK_THREADS 缺省
  NumCPU (2 核实测 threads=2 比 1 快 ~10%, 小模型小 batch 并行收益有限)。
- **证据**: /tmp/eval-external/{nq,tqa}-final-on.jsonl (易失, 本节数字为存档)。

## 13. 匹配器对等性与垃圾 gold 口径 (b29)

- **hay 小写契约**: matchEvidence (答案侧内部小写) 的所有调用方必须先 `hay.toLowerCase()`;
  drift 工具内置常驻金样本自检 (专名大小写/tokenAND 数字/rank 乱序三样本), FAIL 即拒绝出数
  — "跨工具拷贝看着一样"必须升级为"金样本锁着一样" (b29 对拍实锤: 同一 dump 两套口径差
  2.7 倍才暴露)。
- **单窗入档**: `analyze-upstream-drift.mjs --journal-only` 支持只对当前窗快照入档
  (旧窗文件丢失时锚窗链条不断); 修正行 kind=correction 永远允许追加 (幂等键放行)。
- **垃圾 gold 口径**: miss 归因的 gold 侧剔除垃圾页 (社媒 reel/题库农场, 信号=域名+标题样板,
  scripts/junk-gold.mjs 全信号可审计), 唯一证据在垃圾页的题入 E 桶。**eval hit@N 口径不动**
  (跨窗可比性红线; 垃圾页含答案时"答案文本确实带到了用户面前"仍成立, 但"更好的页被压下去"
  的归因不成立)。drift 双窗 diff 也不用此口径 (必须与 eval 逐字等价)。
- **b29 首测** (suppression-review-b29.txt): 确认压顶 (严格口径) 4/104=3.8% (全 TQA;
  b22 基线 8.0%, 小样本两点均值 ~5.9% 作参考带); E 桶自动 0; rank1 垃圾率 NQ 3.1% (全
  brainly 题库农场)/TQA 0%, hit@1 靠垃圾页撑 1 题 — 产品侧压制批次证据不足不立项。
  与批 26 口径互补: 本"严格压顶"=不同实体压顶 (cross-encoder 目标池的子集归因), b26 的
  "广义压顶"=gold@2-10 被相关页挤占 — b26 重放实锤 cross-encoder 连同实体词面错位也能救
  (b22 "重排救不了词面错位"推论修正), 两口径合流。
- **新观察项**: Wikipedia 站脚/TOC 样板混入 snippet 子类 (catch-22/Bobby Vinton/Osbert 三例,
  rank1 实体正确但 snippet 字段源头就是页脚样板) — b30 溯源候选; 与 b23 修过的"注入不可见"
  不同源, 注入层救不了 (b27 SC_RERANK 对样板基底同样无能为力, 语义模型读不到正文)。

## 14. 交付序口径与 transition 四象限 (b30)

- **rank 字段=交付序 (b30 起)**: 重排上线后二进制输出的 refs 数组序=重排交付序, rank 字段残留
  融合层旧值。dump 脚本自 b30 起按数组序重编号 (`rank=i+1`); 一切离线分析遍历 refs 数组序,
  不信任原始 rank 字段。b26-28 重放/定版结论不受影响 (重放走同池数组序, 定版走在线 hitRank)。
- **双口径对拍抓字段语义漂移**: 字段序 vs 数组序在 OFF 窗恰好相等 (数组序==rank 序), b27 埋雷
  b30 才炸 (gold@1 假性回落 NQ 53.1→36.7)。b29 金样本自检断言的是匹配器等价性, 管不住字段
  语义漂移 — 口径类 bug 的通用解法是双口径对拍 + @10/@20 集合量交叉验证 (集合量对序不敏感,
  恰好暴露"只有 @1 错"的模式)。
- **transition 四象限**: 双窗同题按 q 对齐, 分 保持命中/修复/回退/保持miss 四象限, 回退逐条
  归因「重排挤出 vs 上游池换血」。教训: hit@10 跨窗对比天然混入上游漂移 (池换血), 重排的
  flip 税只有同池重放能干净量度; 跨窗 transition 的回退条数不能直接记在重排头上。
- **结构画像平衡点**: SC_RERANK=1 后 miss@1(严格) 构成 = 词面错位 51.3% + 无gold/池外 48.7%
  + 压顶 0。排序可救的部分已被重排吃掉, 剩余 miss 近半是召回/语料问题 — 后续 hit@1 增益
  要从 D 桶正文层 (snippet 有无答案→body 有无答案) 找, 不再从排序层找。
- **CE query-mirroring 偏置**: cross-encoder 对逐字复述查询的页面 (题库农场) 有亲和偏置,
  rank1 垃圾率 OFF→ON 翻倍级抬升 (NQ 3.1→6.1%, TQA 0→4.0%)。eval hit@N 口径不动 (红线),
  垃圾计量单独进行; 修复方向是 CE 池内垃圾降权, 不是改匹配器。

## 15. D 桶正文层探针 (b31)

- **定界方法**: 对 miss@1 且 top-20 无严格 gold 的 D 桶, 独立抓取 rank1-3 正文, 用 eval 匹配器
  逐字判定。D1=正文有答案 (注入/摘要层残余漏抓) / D2=正文无答案 (真召回缺失) / ERR=抓取失败
  (单列不进分母)。与 analyze-suppression 分桶逐字对齐, nogold/deep 子类分开计。
- **必须带上的解读前提**: dump 采集时 b19 已在线跑过 (SC_ANSWER_TOPN=5) — D1 是 b19 残余
  漏抓的量化, 不是"注入层未覆盖"的抽象空间; ERR 的 403 页 b19 同样无正文, D1 是下限估计。
- **b31 首测**: D 桶 37 条 → 可判 30: 真召回缺失 ~57% (主体), 真 D1 ~20-23%, ERR 25%
  (403 指纹级拒爬墙, 浏览器 UA 重试零解锁)。裁决教训: 自动 D1 假阳性四类 — 子串陷阱
  ("Persia"⊂"Persian rug")、机构/单位词面巧合、时间语境错位 (往届年份/已过时任命)、
  数据集 staleness (页面比数据集新)。CTX 上下文人工裁决不可省。
- **deep 子类单独看**: 严格 gold 在 11-20 的案例与 D1 部分并存 (头部正文也有答案) —
  pool 扩容 (SC_RERANK_POOL) 与 b19 抽取增强是两个不同修复面, 收益不可加总。
- **拒爬墙是系统级变量**: 探针与产品 fetcher 面对同一堵墙; 评估侧结论 (ERR 率) 可直接
  推广到产品 b19 的正文可得性。403 率应作为正文层工程的常设背景指标记录。

## 16. b19 漏抓归因 — 产品链路重放 (b32)

**问题**: b31 D1 (探针正文有答案、产品 snippet 无答案, 11 条) 的漏抓原因在抽取层哪一道闸门?
dump 里只有结果 snippet, 猪耳朵 Offline 对拍无法区分"抓取失败"与"抽取闸门拒" — 需要重放产品同一条链路。

**方法 (test-gated harness)**:
- 产品精确路径重放: `loadFetchConfig()` (缺省 UA=search-core/0.5) + `Fetcher.Run(MaxChars=12000,
  TTLSeconds=900, policyFor(nil,nil))` + `extractHtml` + `b19BestSentence` — 与 b19AnswerPass
  逐参一致, 直接调包内函数 (go test 文件, `SC_B19_REPLAY=1` 才发请求, 常规 test 零外呼)。
- 判定语义与 eval `matchEvidence` 逐字一致 (verbatim len>1 / tokenAND 停用词表)。
- 过闸条件必须镜像产品: **score = 查询词覆盖 + 专名 0.25/数字 1.0 (计入后再过 minCover≥2)** —
  用纯 cover≥2 判闸会高估 B2b 低估 B1 (tibbs/spartacus 答案句纯 cover<2 但 score 4-6.25 过闸)。
- 全文重放 (MaxChars=1e6) 定位 12k 窗口问题; browser-UA 复抓量化解锁墙。

**归因桶** (healthy serving, 11 条 D1):
- B1 选句竞争 3: 答案句过闸但败选 — 败选对手两例是样板形态 (Jet 引文日期行纯数字 10.0 分;
  Lloyd George 专名行)。专名/数字奖励救载体句的同时同等赋能样板句。
- B2a 句长门槛 3: 表格单元行 8 rune < 40 (allmusic discography) / 长段 767 rune > 300
  (Grokipedia, score 14.5 明显最相关) / 304>300 (Persia 子串陷阱被侥幸拒掉)。
- B2b 覆盖门槛 2: 答案句查询词零重叠 (同义改写 — "invited Campbell-Bannerman to form a
  government" 不含 "Prime Minister"), 词面框架内无解, 语义层候选。
- B2 token 散布 2: 窗口内答案可判 (tokenAND) 但无单句承载; 其中 48hrs 的 best 句**就是答案句**
  ("the answer is 48 Hrs.") — gold "48 Hours" 认证不了 "48 Hrs.", matcher 变体缺口的产品侧镜像。
- X 重放会命中 1: 注入句是机构词面巧合, eval 会假命中 (与 b31 裁决互证)。
- **零 C1 稳定墙 / 零 B4 (12k 窗口, ansOffset 最大 5095) / 零 B3 clamp 直接截断**。

**三条横切结论**:
1. b19 漏抓无单点故障 — 真 D1 6-7 条分散在四类闸门; 修复要按桶分别对症, 无一招通吃。
2. **base≥560 注入 no-op**: b23 v2 "基底完整保留+clamp 560" 在上游基底 ≥560ch 时注入结构性无效
   (clamp 保前 560 rune = 基底原样)。与 b23 v1 "截基底伤基底"构成张力, 任何改动需同池重放定量。
3. **服务波动性是背景变量**: 同 URL 分钟级 200↔404↔软200 垃圾文本 (textLen 131/47) 实弹三连;
   b31 探针的大量 403 是 eval-UA/首试视角, 产品 UA 健康轮全过。b19 失败静默设计使阵发失败=当次
   机会损失 (页缓存 900s 内无重试)。单轮归因结论必须带跨轮稳定性注记。

## 17. b19 样板句惩罚与窗口翻转逐案归因 (b33)

**改动**: `b19BestSentence` 选句前跳过 `b19IsBoilerplate` 命中句。判据两类(与评分同切分
splitRe, 全可审计): ①数字主导列表(纯数字 token≥3 且多于含字母内容词 rune≥3 — 纯日期串/
文献卷期/Wikipedia 坐标尾); ②分号链式列表(分号≥2, 含全角 — Awards/Sources/credits 块)。
机制依据 b32: 数字/专名奖励无上限, 引文类列表句 cover=0 也能压过含答案句(tibbs 案 10.0 vs 6.25)。

**方法要点**:
- 实弹迭代: 第一判据上线后重放, tibbs 页胜选句换形为 Awards 行(prose 夹年份, 数字主导
  抓不到)→ 补第二判据。样板形态多样, 单判据必然漏 — 两判据实弹各抓一形, 坐标样板三案
  独立交叉验证(aurora/pisa/tibbs)。
- 载体句保护: 48hrs 案(1982/48 两数字)证明奖励机制本身必须保留; 判据以"列表形态"为靶,
  不动奖励权重 — 砍奖励或按 cover 封顶会把 cover=0 的真答案句一起杀掉(tibbs 答案句自身
  cover=0), 造成"不注入"比"注入样板"更差。
- 窗口归因方法(活窗对比的纪律): 同题集确定性抽样 + transition 四象限之外, 翻转题逐案
  切注入尾(" · " 最后段)跑 b19IsBoilerplate JS 镜像 + gold 归属(base/尾)。归因判定:
  gold 在样板尾且尾被跳过 → 本改动回退; gold 在 base/页面出池/降位 → 上游。b33 窗
  TQA REG 12 嫌疑 0(DDG 整腿消失+10 页出池), NQ REG 5 中 1 条实为单数字 gold 子串
  假阳性证据的移除(生产性回退), FIX ≥1 条直接归因改动(pisa 坐标样板→答案句)。
- "生产性回退"记法: eval 口径的 REG 不等于产品回退 — 若被移除的证据本身是子串假阳性
  (b31 裁决类别), hit 丢失是口径收益。逐案裁决前不得把窗口 REG 记在改动头上。

**水位(b33win vs b30win 锚)**: NQ 55.1/75.5/79.6(+2.0/+1.0/+2.0pp); TQA 72.0/85.0/89.0
(−5.0/−4.0/−4.0pp, 逐案归因全上游换血)。结构画像同带: A 1.3%/E 0, B/D 主导不变。

## 18. 设计探针先行与行候选准入 (b34)

**机制**: b19 表格感知行候选(b19RowCandidates) — 连续 cell-like 短行 run(≥2, <40r 且无句末
标点)join " · " 成行候选, 与普通句同闸竞争(lenOk/样板/score≥minCover)。行级准入两把尺:
①数据表锚(run 含 ≥1 纯数字行 — 年表/统计表年份列形态); ②行含 ≥1 查询词(cover=0 的
引用/坐标/TOC 行不入场, b33 反刷分血统)。超长 run 按 300r chunk。

**设计探针先行(新纪律)**: 候选机制在动产品代码前, 先用门禁探针(SC_B34_PROBE=1)在产品函数
域内模拟(b34SimResplit/b34SimRowJoin + b32SentenceScore 评分镜像 = 零镜像偏差), 抓真实
页面全文对目标案逐段判定。探针否决了 b32 交接的"长句二次切分"半边: ①libretexts 答案段
score 1.0 过不了 cover 闸 — 而 b31 已裁决该案是"Persia⊂Persian rug"假 D1, 不翻=正确保护;
②grokipedia 答案段 7.50 入池但被榜单散文 12.75(cover 仅 1)压死 — B2a 长端实为 B1 竞争层
残余(bonus 富集散文 vs 答案散文), 且重切会向所有长句页注入 bonus swarm 挤掉现任健康 best。
探针同样否决了朴素行候选(grokipedia TOC run score 5.25 会垃圾上头)→ 收窄出两把准入尺。
探针产物(test 文件 + b34-design-probe.json)入仓防再诉讼。

**"候选被否决 ≠ 候选丢失"记法**: 设计探针的负结果与正结果同等入档。b34 批产出 = 机制 B
上线 + 机制 A 否决证据 + B2a 桶重新定性(短端=表格页稀缺种群问题, 长端=B1 家族奖励结构
问题, 门槛层修复空间收敛为零)。

**窗口归因扩展**: b33 的注入尾归因之外新增两个维度 — ①"同 URL 存活 + 同 URL 仍有 gold"
字段把 REG 细分为出池/内容漂移/位次波动三类(b34win NQ 9 REG 中 6 条=位次波动); ②机制
触发面扫描: 全 refs 注入尾按机制形态分类计数(b34win row 形态尾 0/3643 = 机制休眠),
与翻转归因互证"零杀伤"。legs 波动记录进 journal 锚行(DDG 腿跨窗 0↔87% 摆动=churn 主因)。

**水位(b34win vs b33win 锚)**: NQ 51.0/77.6/82.7(@1 −4.1pp, 逐案 32/32 上游); TQA 74.0/
86.0/88.0(@1 +2.0pp, 同)。机制零记功零杀伤(Phil Collins 案翻正=上游新页 title 自带答案)。

## 19. 评分层奖励结构探针否决 — 双杀证据 (b35)

**背景**: b34 把 grokipedia 重新定性为 B1 竞争层残余(bonus 富集散文压答案散文), spartacus
同族(专名行竞争)。b35 候选① = 评分层奖励结构改造: ①bonus 计分封顶(数字 M/专名 K, cover
不动) ②超长句逃生舱(>300r 句 clause 重切取内部最佳 seg, b34 机制A 洪泛风险的收敛版)
③对照 cover 权重×2。

**探针矩阵**: SC_B35_PROBE=1 门禁, b32 canonical 全 11 案 × 19 变体, baseline 变体与产品
b19BestSentence 逐字节等价自检(10 成功案零漂移)。裁决 = **双重否决**:

- **零增益**: 两个目标案全 19 变体零翻转。grokipedia 封顶后 bio intro(8.0→5.75)仍是最高分,
  答案段 seg 重切后也够不着; spartacus 封顶 K 只是把 Lloyd George 行换成 "Other posts..."
  行 — 换汤不换药。**bonus 富集散文的分数优势来源(标题词复现+专名密度)与答案散文重叠,
  单调压 bonus 不能把胜者换成答案句。**
- **负回归(双杀证据)**: tibbs 答案句本身是 born/died 日期句(cover≈1, 6.25 分大头=数字+
  专名 bonus), 全部数字封顶与 cover 加权变体(15/19)把它拉下马 — b33"载体句保护: 不砍奖励"
  预判实锤。唯一保 tibbs 的 capPropK4 对目标案零增益 → **评分层无安全切口**。
- **可分性结论**: 答案句常为日期句/专名密集句, bonus 刷分句与 bonus 载体答案句在词面特征上
  不可分。B1 竞争层"奖励结构"子方向正式关闭; spartacus/grokipedia 维持语义层挂账(B2b 同族,
  CE/改写词面无解)。逃生舱机制本身零杀伤(可复用), 但零增益不单独 ship。

## 20. D 桶召回层上游腿探针 — 五级血脉追踪 (b36)

**背景**: b31 定界 D 桶(真召回缺失 ~57% 可判)+b35 pool20 定案(D 桶主体不受池深影响)后,
挂账主矿收敛到"召回/正文层"。b36 对 nogold@20 案集(b34win 29 条, 占 miss@1 39%)回答
一个问题: gold 证据页在上游链路的哪一层丢失。

**两级活窗设计**: 阶段①二进制复核(b36-restage.mjs, 与窗口采集同参冷目录)先把 churn 翻案
分流(29→21, RESOLVED@1=5/MOVED=3); 阶段②SC_B36_PROBE=1 门禁探针(answer_extract_b36_test.go)
逐引擎独立 runLanes **全结算不等早收割**(理想召回上限), 生产同参镜像(plan 路由分支/domainCap/
client 三层超时/MaxResults=10), 判定=eval matchEvidence 逐字镜像(b32AnsIn)。

**分步分解自检(新纪律)**: 探针把 fuseSemantic 内部链(fuseV3 宽池100→spam 双档→TF 去重→
domainCap→topN)逐步重放并追踪每条证据的血脉载体, 分解终态必须与单体 fuseSemantic 输出
**逐位一致**(StepCheck, 21/21 OK)+META 计数一致 — 镜像纪律从"判定语义"延伸到"链路结构"。

**五级丢失点分类学**: fuse-text-superseded(URL 合并长 snippet 覆盖) / spam-block(硬屏蔽) /
dedup-text-superseded(TF 去重长 snippet 覆盖) / domain-cap(单域上限) / topN-truncation(宽池
排名 21+)。**实弹 TALLY: ENGINE-MISS 15 / FUSION-LOSS 6(dedup 覆盖 3+URL 合并覆盖 2+cap 1),
零 spam/零截断/零不变量违例。**

**机制发现(三条, 全部产品侧可修)**:
1. **"更长 snippet 胜出"合并规则双处覆盖证据文本**(fuseV3 URL 合并 semantic.go:242 + TF 去重
   semantic.go:412): 证据 snippet(短句直答)被同页/孪生页长样板 snippet 顶掉 → 交付零证据,
   且 lex 排序输入同被污染。快腿证据坐实 2 案(BLM/You Sexy Thing, keenable 证据与收割无关)。
   修复候选: 合并时查询词命中优先(keyTermPresent 同款), 次取长度。
2. **domainCap 反霸屏误伤**(Gotham 案): 唯一快腿证据 dc.fandom@8 被 fandom.com 3 条上限挤出,
   答案在长尾子域而同域头部页占坑时的结构性误伤面, 记观察。
3. **anysearch 慢腿×证据富集矛盾**: 15/15 案全慢腿(2.5-4s>1200ms 收割阈值)且为头号证据载体
   (8/12 条) — 生产早收割对该腿有系统性丢弃风险, 3 案属"收割复合"型。收割策略质量盲区,
   与融合层修复正交。

**口径边界**: 探针全结算=理想召回上限, 收割条件未逐案模拟(慢腿证据以 [slow-leg] 注记, 复合型
为风险定性非确定性归因); 引擎深度上限(~10 条/腿)决定视野, ENGINE-MISS=深度内零 snippet 证据,
body 层 D1 不在本批口径; 融合层修复空间上限=6/74 ≈ 8% miss@1(b34win), ENGINE-MISS 15 条
仍是 D 桶主体 — 召回/查询词形层缺口比融合层丢失大一个量级, 单靠融合修复不翻 D 桶大局。

## 21. 融合层 snippet 合并判据 — 配对反事实裁决 (b37)

**机制**: fuseV3 URL 合并与 TF 去重的"更长 snippet 胜出"改为"查询关键 token 命中数优先,
次取长度"(`b37SnippetBetter`/`b37TermHits`, 词表纪律与 keyTermPresent 同源: tokenize 停用词
过滤 + ASCII printable 池, CJK 回退全词表)。打平(含双 0)回退长度规则 = 与旧行为逐字节一致,
健康案零漂移, 只有"证据被长样板覆盖"形态改判。生产缺省 ON, `SC_B37_MERGE=0` 回退;
fusion journal 记 `b37merge` 状态(防静默回退伪装生效, b27 教训)。

**配对探针纪律(本批新升级)**: 同一次活窗采集的 lanes 喂 fuseSemantic 新旧规则各一遍 —
上游 churn 在配对内抵消, 直接量度规则本身的效应面(RESCUED/LOST/urldiff/rank1Flip)。
b36 探针是"追血脉"(丢失点在哪), b37 探针是"称改动"(改动救了什么伤了什么), 同一骨架
两种用法。**窗口归因签名(同 URL snippet 变)只是筛查启发式(必要非充分)**: 引擎侧内容
漂移(同段文本在窗口间换页挂载)会产生相同签名 — 改动涉入判定必须以单案配对反事实
探针确认(同 lanes 双规则重跑该案), 本批 TQA 唯一 b37-reg 签名即由此翻案为上游。

**测试设计教训**: TF 去重在 fuseSemantic 层不在 fuseV3; 保留行由融合分决定, lex 高的
证据行常自成为保留方 — b36 真实丢失形态有两个方向(高分行持长样板覆盖证据/证据行被
吸收后文本覆盖), fixture 必须按方向摆位才能同时验证旧规则丢失形态复现与新规则救援。

**裁决结构**: 机制面(配对 RESCUED@1 实证 + 零排序扰动 0/21 + LOST=0 + 健康案零漂移)
与水位面(跨窗 @1 净差全被 60%+ 换血主导, 改动确认涉入仅 +1)分开陈述 — 有界修复
(上限 ~8% miss@1)的单窗水位无统计力, 机制证据才是 ship 依据。判据已知边界: 查询词
命中数不感知答案 token, gold 恰在命中数较少候选文本时理论可覆盖(22 案配对零实证, 记档)。

## 22. 盲查询变体探针 — 词形/召回层上限定界 (b38)

**方法**: ENGINE-MISS 案集(b36 冻结 15 条) × 盲变体 × plan(variant) 全池逐腿 runLanes
(生产同参) × b36Evidence 判定。变体五类: orig 基线 / kw 关键词化(去疑问词/虚词/前导
数字伪影) / quoted 最长连续内容 run 加引号 / trim 仅去前导伪影 / entfirst 专名提前。

**oracle 红线(本批核心纪律)**: 变体构造只允许使用 query 文本本身, gold 答案/URL 信息
零进入变体侧 — gold 只出现在判定侧(与 b32/b36 同源)。否则"变体能救回"的上限会被
oracle 泄漏虚高成无界(拿答案词去搜当然搜得到), 探针就失去定界意义。变体生成函数与
判定函数物理分离在不同代码路径, 报告里逐案贴变体字符串供审计。

**裁决教训(两类 matcher 假阳性再立档)**: ①tokenAND 跨上下文伪命中 — "48 Hours" 案
kw 变体证据 tokenAND(48+time) 实为 "of all time"×"48" 拼接("time" 来自无关短语);
②decade/年份型答案在错误实体页词面巧合 — Anne Bancroft 案 tokenAND(1930) 命中
Joanne Woodward/Anne Francis 页(同为 1930 年生人)。探针 TALLY(RESCUED=6) 逐案人工
裁决后缩水为真救回 4 + 陈旧数据集 1(sebi, b31 已立档) + 假阳性 1 — **探针计数是
筛查, 裁决才是结论**(与 b33 "生产性回退"、b37 "签名必要非充分"同族纪律)。

**定界结论**: ENGINE-MISS 15 案在词形维度再切分 = 盲词形可救 4/15(27%) + 陈旧 1 +
真语料/索引缺口 10/15(67%)。fan-out 产品化上限 ≈5-7% miss@1(kw+trim 两变体已覆盖
全部真救回), 但救回证据在腿内 rank 1-10 散布(尾位需池深/重排配合), 成本 ×2-3 引擎
调用/题 — 单独 ship 不成立, 挂账为延迟档位(候选 #1)深度档的可选增强: 深度档预算
吸收 fan-out 成本, 两候选是组合关系不是并列关系。

**副产物**: 引擎健康面波动实证 — firecrawl 在 b36 窗 15/15 全错、本批 3 次携证;
任何按静态健康表裁腿的设计都不可靠, fan-out/收割策略必须按题动态。
