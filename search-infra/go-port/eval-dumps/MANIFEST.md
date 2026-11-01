# eval-dumps/ — 重排弧线证据归档（批 29–31 窗口）

收官批归档。`/tmp/eval-rerank` 为易失目录（会话重置即清空），本目录把支撑批 29–31
结论的原始证据固化入仓。背景与结论全文见 `scripts/RERANK-ARC-CLOSURE.md`（收官报告）、
`scripts/miss-structure-b30.txt`、`scripts/body-probe-b31.txt`、`EVAL-METHODOLOGY.md`
§13–15。校验和见 `SHA256SUMS.txt`（对本目录每个文件计算）。

## 窗口定义

| 窗口 | 开关 | 规模 | 说明 |
|---|---|---|---|
| b29 OFF 窗 | SC_RERANK 缺省关 | NQ 98 / TQA 100 | 批 29 修好口径后的基线窗，批 30 的 transition 对齐基准 |
| b30 ON 窗 | SC_RERANK=1 | NQ 98 / TQA 100 | 与 OFF 窗**同题集**确定性抽样（同题对齐的前提），dump topn=20 |
| rawrank 备份 | 同 ON 窗 | 同上 | 批 30 修 dump 口径 bug **之前**的原始现场（rank 字段=融合层旧值） |
| b33 ON 窗 | SC_RERANK=1 + b19IsBoilerplate | NQ 98 / TQA 100 | 批 33 样板句惩罚后的同题集活窗（对比基准=b30win，逐案归因见 window-attrib-b33.txt） |
| b34 ON 窗 | SC_RERANK=1 + b19RowCandidates | NQ 98 / TQA 100 | 批 34 表格感知行候选后的同题集活窗（对比基准=b33win，逐案归因见 window-attrib-b34.txt：32/32 上游换血、row 尾零触发零杀伤） |
| pool20 实验窗 | SC_RERANK=1 + SC_RERANK_POOL=20 | NQ 98 / TQA 100 | 批 35 池深量化实验窗（非 canonical，水位不可直接对拍；对比基准=b34win，逐案归因用 b35-pool-compare.mjs） |
| b37 ON 窗 | SC_RERANK=1 + b37KeyTermMerge(缺省 ON) | NQ 98 / TQA 100 | 批 37 snippet 合并判据后的同题集活窗（对比基准=b34win；本窗换血极重 DDG 腿双集消失，跨窗差值不可直接归因，逐案归因见 window-attrib-b37.txt + 单案配对反事实 b37-reg-probe.json） |

数据集：NQ-Open dev（3610 行）/ TriviaQA dev（200 行），快照在 /tmp 亦易失，
全量复采需先跑 `scripts/fetch-nq.mjs` / `scripts/fetch-triviaqa.mjs` 重建。

## 文件清单

| 本目录文件 | 来源（/tmp/eval-rerank） | 行数 | 说明 |
|---|---|---|---|
| nq-dump-b29win.jsonl.gz | nq-dump-b29win.jsonl | 98 | OFF 窗 NQ |
| triviaqa-dump-b29win.jsonl.gz | triviaqa-dump-b29win.jsonl | 100 | OFF 窗 TQA |
| nq-dump-b30win.jsonl.gz | nq-dump.jsonl | 98 | ON 窗 NQ（rank 字段已迁移=交付序） |
| triviaqa-dump-b30win.jsonl.gz | triviaqa-dump.jsonl | 100 | ON 窗 TQA（同上） |
| nq-dump-rawrank-b30.txt.gz | nq-dump-rawrank-b30.txt | 98 | 迁移前原始，rank 字段 bug 现场 |
| triviaqa-dump-rawrank-b30.txt.gz | triviaqa-dump-rawrank-b30.txt | 100 | 同上 |
| transition-nq-b30.txt | transition-nq.txt | — | transition 四象限明细（REG/FIX/JUNK1） |
| transition-tqa-b30.txt | transition-tqa.txt | — | 同上 |
| suppression-review-b30.txt | suppression-review.txt | — | 压顶/垃圾 gold 结构复核摘要 |
| drift-nq-b30.txt / drift-triviaqa-b30.txt | drift-{ds}.txt | — | 双窗漂移 diff 摘要 |
| journal-only-nq-b25.txt 等 3 件 | 同名 | — | anchor journal 锚窗入档件 |
| body-probe-nq-b31.json / -b31.txt | body-probe-nq.{json,txt} | — | 批 31 D 桶正文探针（断点续跑状态 + 逐案明细） |
| body-probe-triviaqa-b31.json / -b31.txt | body-probe-triviaqa.{json,txt} | — | 同上 |
| nq-dump-b33win.jsonl.gz / triviaqa-dump-b33win.jsonl.gz | {ds}-dump.jsonl | 98/100 | 批 33 窗（b19IsBoilerplate 上线后，SC_RERANK=1） |
| window-attrib-b33.txt | b33-window-attrib.txt | — | 批 33 窗口翻转逐案归因（本改动 vs 上游换血） |
| nq-dump-b34win.jsonl.gz / triviaqa-dump-b34win.jsonl.gz | {ds}-dump-b34win.jsonl | 98/100 | 批 34 窗（b19RowCandidates 上线后，SC_RERANK=1；row 形态注入尾 0/3643 refs） |
| window-attrib-b34.txt | b34-window-attrib.txt | — | 批 34 窗口翻转逐案归因（row-fix=0 / row-reg=0 / upstream=32） |
| drift-nq-b34.txt / drift-triviaqa-b34.txt | drift-{ds}.txt | — | 批 34 双窗漂移摘要（legs 波动：DDG 腿 TQA 0→72% 回归） |
| nq-dump-pool20.jsonl.gz / triviaqa-dump-pool20.jsonl.gz | {ds}-dump-pool20.jsonl | 98/100 | 批 35 pool=20 实验窗（SC_RERANK_POOL=20，非 canonical；池深量化见 scripts/pool20-b35.txt） |
| restage-b36.jsonl.gz | b36-restage.jsonl | 29 | 批 36 阶段①: b34win nogold@20 案集新窗复核（RESOLVED@1=5 / MOVED=3 / STILL-NOGOLD=21；scripts/b36-restage.mjs 重跑可得） |
| legprobe-b36.json.gz | scripts/b36-legprobe.json | 21 | 批 36 阶段②: 逐引擎全结算探针原始输出（SC_B36_PROBE=1 门禁；含 per-lane 健康面/原始证据/血脉五级追踪/StepCheck 自检） |
| legprobe-attrib-b36.txt | scripts/b36-legprobe.txt | — | 批 36 归因报告（ENGINE-MISS 15 / FUSION-LOSS 6：长 snippet 覆盖×5 + domainCap 误伤×1；收割复合 3 案） |
| nq-dump-b37win.jsonl.gz / triviaqa-dump-b37win.jsonl.gz | {ds}-dump-b37win.jsonl | 98/100 | 批 37 窗（snippet 合并判据上线后，SC_RERANK=1；判据报告见 scripts/merge-b37.txt） |
| window-attrib-b37.txt | b37-window-attrib.txt | — | 批 37 窗口翻转逐案归因（NQ：b37-fix 1+上游 14；TQA：上游 17+b37-reg 签名 1，该签名经单案配对反事实探针翻案为上游内容漂移） |
| drift-nq-b37.txt / drift-triviaqa-b37.txt | drift-{ds}.txt | — | 批 37 双窗漂移摘要（DDG 腿 NQ 82.7%→10.2% / TQA 72%→0 整腿消失） |
| b37-mergeprobe.json.gz | scripts/b37-mergeprobe.json | 21 | 批 37 同 lanes 新旧规则配对探针原始输出（RESCUED@1=1 / SAME@2=1 / NOEV=19 / LOST=0 / urldiff=0） |
| b38-queryvariant.json.gz | scripts/b38-queryvariant.json | 15 | 批 38 ENGINE-MISS 盲查询变体探针原始输出（SC_B38_PROBE=1 门禁；TALLY RESCUED=6/STILL-MISS=9，逐案裁决见 scripts/queryvariant-b38.txt：真救回 4+陈旧 1+假阳性 1；变体构造与判定分离=oracle 红线） |

## 复放指引

1) 解压恢复 /tmp 约定路径（分析器默认读这些路径）：

```bash
mkdir -p /tmp/eval-rerank
gzip -dc eval-dumps/nq-dump-b30win.jsonl.gz       > /tmp/eval-rerank/nq-dump.jsonl
gzip -dc eval-dumps/triviaqa-dump-b30win.jsonl.gz > /tmp/eval-rerank/triviaqa-dump.jsonl
gzip -dc eval-dumps/nq-dump-b29win.jsonl.gz       > /tmp/eval-rerank/nq-dump-b29win.jsonl
gzip -dc eval-dumps/triviaqa-dump-b29win.jsonl.gz > /tmp/eval-rerank/triviaqa-dump-b29win.jsonl
```

2) 重采 dump（需重排三件套与二进制）：

```bash
bash scripts/setup-rerank.sh   # libonnxruntime 1.29.0 + model_quantized.onnx + tokenizer.json
SC_RERANK=1 \
SC_RERANK_LIB=$HOME/.cache/searchcore-rerank/libonnxruntime.so \
SC_RERANK_MODEL=$HOME/.cache/searchcore-rerank/model_quantized.onnx \
SC_RERANK_VOCAB=$HOME/.cache/searchcore-rerank/tokenizer.json \
SC_NO_CACHE=1 node scripts/eval-external-dump.mjs --dataset nq --sample 100 --part 1..4
# OFF 窗：去掉 SC_RERANK* 三项；TQA 同理 --dataset triviaqa
```

3) 分析器（均在仓 scripts/，CLI 契约见各文件头注）：

```bash
node scripts/analyze-transition.mjs                    # 双窗 transition 四象限
node scripts/analyze-upstream-drift.mjs --dataset nq   # 双窗漂移（--old/--new 可显式传）
node scripts/analyze-suppression.mjs                   # 压顶 / 垃圾 gold / rank1 垃圾率
node scripts/body-probe.mjs --dataset nq               # D 桶正文探针（独立抓网）
```

4) 预期复算值（自检锚点）：
   - transition hit@1：NQ 38.8→53.1（修 16 退 2）/ TQA 57.0→77.0（修 22 退 2）
   - miss 结构：B 词面错位 39（51.3%）/ D 无 gold-池外 37（48.7%）/ A 压顶 0 / E 垃圾 gold 0（miss=76）
   - body-probe：可判 30 = D1 11 / D2 17 / ERR 9（裁决后真 D1 6–7）
   - 同窗 A/B（b27）：hit@1 49.5→66.2（+16.7pp）
   - b33win vs b30win：NQ 53.1→55.1（REG 5=4 上游+1 假阳性移除）/ TQA 77.0→72.0（REG 12 全上游，DDG 腿 87→0）
   - b36 探针：TALLY ENGINE-MISS=15 / FUSION-LOSS:dedup-text-superseded=3 / FUSION-LOSS:fuse-text-superseded=3，
     StepCheck 全 OK（活窗探针 TALLY 会随上游换血漂移，归档件为 2026-09-08 现场；复跑新 TALLY 属正常）

## 备注

- `journal-only-nq-b25.txt` 与 `journal-only-nq-b29-recheck.txt` sha256 逐字节一致
  （885931c0…）：同一锚窗重放输出零漂移的自证，正是 anchor journal 机制的设计目标。
- rawrank 备份保留 b27 潜伏口径 bug 的原始现场（rank 字段=融合层旧值 1,2,5,4,3,…），
  与 b30win（迁移后 rank=i+1）构成修复前后对照；迁移工具 `scripts/b30-rank-migrate.mjs`（幂等）。
- dump 的 refs 数组序=交付序（b30 起口径统一），rank 字段=i+1；@10/@20 集合量对序不敏感，
  任何按 rank 排序的下游消费须以本口径为准（详见 EVAL-METHODOLOGY §14）。
