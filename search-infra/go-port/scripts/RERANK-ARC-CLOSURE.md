# 重排评测弧线收官报告（批 20–31）

日期：2026-09-06 · 仓库：search-tool-rnd/go-port · 收官 tag：`rerank-arc-closure`

弧线起点是用户最初之问「要不要上重排模型」。批 20 以成本预估过高挂账，批 22 以触发线
口径挂账，批 26 离线重放实质击发，批 27 产品上线，批 28 定版水位，批 29–31 完成口径
卫生、机制闭环与剩余空间定界。本报告把整条弧线的判定链、终态数字、机制证据、已修债
务与交接清单固化为一页入口；原始证据在 `eval-dumps/`（见 MANIFEST.md），分批细节在各
批报告 `scripts/*-b*.txt`，方法论沉淀在 `EVAL-METHODOLOGY.md` §12–15。

## 一、判定链（每批一句话）

| 批 | 问题 | 判定 | 产出 |
|---|---|---|---|
| b20 | 神经重排值不值得上 | 预估成本 100MB–1GB 过高 → 挂账（后被 b26 实测推翻：22MB quantized + 140ms/查询） | 挂账决策三段式方法论 |
| b22 | 语义压顶有多严重 | 窄口径（不同实体压顶）8.0% < 15% 触发线 → 不立项，监控挂账 | 压顶口径与触发线 |
| b24 | 基线为什么低 | analyze-upstream-drift goldAt 漏 hay 侧小写 → 专名答案全漏判，hit@1 低估 ~2.7× | 修正后基线 NQ 38.8% + 金样本自检 |
| b26 | 重放能不能证实 | ms-marco MiniLM quantized 离线重放 hit@1 47.5→64.6（cross +17.1pp）；广义压顶 61.8% 击发触发线 → 挂账实质击发 | ce-rerank-replay.py + 报告 |
| b27 | 怎么集成上线 | SC_RERANK 开关（fuseSemantic 后/b19 前，lin-λ=4 增量式，缺省关，失败回退）；同窗 A/B 49.5→66.2（+16.7pp）→ 上线 | rerank.go + tokenizer golden 对拍 |
| b28 | 上线后水位多少 | 全量 n=390：合并 hit@1 60.8%（NQ 51.1 / TQA 70.0）；ON +140ms/查询 | 定版水位 + setup-rerank.sh |
| b29 | 口径卫生 | junk-gold 分类器工程化；严格压顶 3.8%（4/104）；发现 Wikipedia 站脚/TOC 样板 snippet 子类 | suppression v2 + 锚窗 journal |
| b30 | 重排后 miss 长什么样 | A 桶归零；B 51.3% / D 48.7% 新平衡；修复机制闭环（36/38=位次提升）；**第二主线：抓获并修复 b27 潜伏 dump 口径 bug** | miss-structure-b30.txt + §14 |
| b31 | D 桶（48.7% 最大桶）还剩多少可救 | 可判 30 条：D2 真召回缺失 17（57%）主体；真 D1 6–7（20–23%）= b19 残余漏抓；ERR 9（25%）= 403 指纹级拒爬墙 | body-probe.mjs + §15 |

## 二、终态水位（SC_RERANK=1 已上线为缺省关的可选增强）

| 口径 | NQ hit@1/@10/@20 | TQA hit@1/@10/@20 | 说明 |
|---|---|---|---|
| b28 定版全量 ON（n=390） | 51.1 / 72.1 / 79.5 | 70.0 / 86.0 / 91.0 | 合并 60.8 / 79.2 / 85.4；vs b25 OFF 跨窗 +17.2pp |
| b30 同题窗 ON（98+100） | 53.1 / 74.5 / 77.6 | 77.0 / 89.0 / 93.0 | 与 b29 OFF 窗同题集 |
| b29 同题窗 OFF | 38.8 / 77.6 / 82.7 | 57.0 / 91.0 / 94.0 | 基线 |
| 同题 Δhit@1 | **+14.3pp** | **+20.0pp** | 双集同向，与 b27/b26 数字互相印证 |

注：同题窗 hit@10 OFF 略高 ON（NQ 77.6 vs 74.5）为上游池换血噪声——重排不改召回，
7 条回退已逐条裁决全部为上游池/snippet 换血，零条重排挤出（pool=10 池内重排不出池，
机制自洽）。干净 flip 税量度只能靠同池重放（b32 候选②的前置）。

## 三、机制证据（五条，全部实弹）

1. **修复机制闭环**：38 条 hit@1 修复中 36 条 = gold 本在 top-10 内被重排提前——b26
   位次保持池设计在产品链路实弹验证。
2. **压顶治愈**：窄口径 8.0%（b22）→ 3.8%（b29）→ 0（b30）；广义口径 61.8% 是 b26
   击发依据，SC_RERANK 上线后同机制覆盖。压顶监控降级为抽检。
3. **CE 亲和偏置（副作用首次定量）**：cross-encoder 对逐字复述查询的题库农场页有亲和
   偏置，rank1 垃圾率 NQ 3.1→6.1% / TQA 0→4.0%；junkHit1 7 条裁决（5 条重排新顶，
   1 存量，1 条 "8%"⊂"6.8%" 子串假阳性）。修复方向 = CE 池内垃圾降权，不动匹配器。
4. **拒爬墙（系统级背景变量）**：探针 ERR 25% 全部 403，浏览器 UA 重试零解锁 → IP/TLS
   指纹级；fetcher 缺省 UA `search-core/0.5` 自报家门是拒签最强特征（SC_UA env 已可
   运维覆盖）；换装浏览器 UA 涉爬虫伦理/ToS，交产品决策。该墙同时解释题库农场页
   snippet 长期贫瘠，且 ERR 页 b19 同样无正文可注入。
5. **双口径对拍机制两次立功**：b24（goldAt 大小写）与 b27（dump rank 字段语义漂移）
   均由「数组序 vs rank 字段序对拍 + @10/@20 集合量交叉验证」抓获。

## 四、miss 结构终态（下一座矿在哪）

- b30 新平衡点（miss=76）：**B 词面错位 39（51.3%）+ D 无 gold/池外 37（48.7%）+
  A 压顶 0 + E 垃圾 gold 0**。排序层的治理红利已经吃完，miss 近半在召回/语料侧。
- b31 对 D 桶定界：**D2 真召回缺失 ~57%（主体，排序/注入都救不了）**；真 D1 20–23%
  （页面已在头部、正文有答案、注入层没递到 = b19 残余漏抓，TQA 侧更肥：deep 子类
  3/4 真）；ERR 25% 不可核验（D1 是下限估计）。
- deep 子类（严格 gold 在 11–20）8 条中 4 条真 D1 且 gold 页带证据 snippet 在深池：
  **pool 扩容与 b19 抽取增强是两个修复面，收益不可加总**（分别对应 ~5.6% / ~3.5%
  miss@1 空间，小样本）。
- matcher 数字变体假阴性定量（b31 搭车）：miss=76 中 rank1 可翻转仅 2（2.6%），真翻
  转仅 Michelle Smith 1 条（4→four years）；Europe 翻转实为单数字 token 子串假阳性反
  向实锤。**eval 口径红线维持，不构成修改理由**。

## 五、已修债务档案（两起口径 bug 的完整链条）

- **b24 goldAt 大小写 bug**：漏 hay 侧 toLowerCase，专名型答案全漏判，journal 首 4 行
  hit* 低估 ~2.7×（NQ 13.3% 实为 38.8% 量级）。修法：goldAt 补小写 + 常驻金样本自检
  （专名/tokenAND/数字/rank 乱序，FAIL 拒绝出数）+ journal correction（append-only）。
- **b27 dump rank 字段语义漂移**：重排后 refs 数组序=交付序，但 rank 字段残留融合层旧
  值（实测 1,2,5,4,3,…），dump 信任 r.rank → goldAt 按 rank 排序把重排撤销，gold@1
  假性回落 53.1→36.7 / 77.0→53.0；@10/@20 集合量对序不敏感恰好无恙（b26–28 结论不受
  影响）。修法三件套：dump `rank=i+1`（交付序语义统一）+ 已采 dump 迁移重编号（1603
  ref，原始备份 rawrank）+ journal correction 2 行。修后双口径对拍零分歧。
- **教训**：金样本自检管得住匹配器等价性，管不住字段语义漂移；口径类 bug 的通用解 =
  双口径对拍 + 集合量交叉验证（「只有 @1 错、@10 对」即字段序病征）。

## 六、运维档案

- **开关组**：`SC_RERANK=1` + `SC_RERANK_LIB/MODEL/VOCAB`（三件套）；缺省关 = 零依赖
  零开销底盘不变；失败 stderr 必打 + 原序回退，查询永不失败；`SC_RERANK_THREADS` 可调；
  采集口径 `SC_NO_CACHE=1`。
- **性能**：22MB quantized MiniLM，pool=10 batch CPU，ON 约 +140ms/查询（2 核实测
  threads 收益 +10%）；挂账：session 池 / 与 b19 并行化。
- **部署**：`bash scripts/setup-rerank.sh` 一键三件套（pip wheel 抽 libonnxruntime
  1.29.0 + hf-mirror 下 model/vocab）。
- **环境重置 playbook**：用户态 Go（/home/z/.local/go，mirrors.aliyun tarball）+
  `GOPROXY=https://goproxy.cn,direct go mod download` + CGO 重编 + e2e 对拍
  GO_CS=[11.0,5.5] PASS + 冒烟确认 journal rerank 事件。
- **正确性锚**：tokenizer golden 对拍 12/12 + 推理逐位一致 MAX_DIFF=0.00e+00 +
  rerank_e2e_test.go 条件对拍。
- **证据索引**：`eval-dumps/`（本次收官归档 + MANIFEST）、`scripts/{ce-rerank-report-
  b26, rerank-integration-report-b27, drift-bug-b29, miss-structure-b30, body-probe-b31}.txt`、
  `EVAL-METHODOLOGY.md` §12–15、`scripts/upstream-anchor-journal.jsonl`（16 行 append-only）。

## 七、b32+ 交接（按价值排序）

1. **b19 漏抓归因**：D1（20–23%）逐条看抽取为何没命中句——注入层增强的直接输入。
2. **SC_RERANK_POOL=20 同池重放**：先量 flip 税再立项；deep 子类 4/8 真 D1 佐证空间。
3. **拒爬对策决策件**：UA 策略含合规/ToS 权衡，**需用户拍板，不擅自立项**（SC_UA env
   已可运维覆盖）。
4. **CE 池内垃圾降权评估**：junk-gold 信号 × CE score 轻惩罚，先量化交付面影响。
5. **样板 snippet 溯源**：Wikipedia 站脚/TOC/quizlet "[FREE]" 样板如何进 snippet
   （b29 观察项 + b30 域名清单缺口）。
6. **单数字 token 精度**（评估侧观察项）：8⊂6.8 类子串假阳性的精度记录。

搁置项：云向量 endpoint 对比（用户明确「再说」，等 endpoint）；压顶监控已降级抽检；
产品 fetcher UA 换装（同 3，等产品决策）。
