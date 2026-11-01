# RELEASE NOTES — searchcore go-port v0.9.0-go

发布基线 commit: `76e89de` (批 37) · 日期: 2026-09-08 · tag: `v0.9.0-go` (前序 `v0.8.1-go`)

一句话: 多引擎无 key 网页搜索 MCP 插件; 本版本主线 = cross-encoder 重排上线 (hit@1 +17.2pp)
+ 三项排序/抽取机制实弹 + 批 20-37 评测证据链全归档封存。

## 核心指标 (b28 全量定版, sample=200 n=390, SC_RERANK=1)

| 指标 | NQ-Open (n=198) | TriviaQA (n=200) | 合并 |
|------|-----------------|------------------|------|
| hit@1 | 51.1% | 70.0% | **60.8%** |
| hit@10 | 72.1% | 86.0% | 79.2% |
| hit@20 | 79.5% | 91.0% | 85.4% |

vs 重排 OFF 基线 hit@1 43.6% → **+17.2pp** (同窗 A/B +16.7pp 互证); hit@10 持平
(重排只改排序不改召回力学, 自洽)。

## 本版本已上线机制 (四件)

1. **SC_RERANK cross-encoder 重排** (b26 机制 → b27 集成 → b28 定版): fuseSemantic 后
   lin-λ 增量式 (score×10 + λ·cs, λ=4) 保融合分基底; 失败 stderr 必打 + 原序回退, 查询
   永不失败; ON +140ms/题 (batch CPU)。
2. **b19IsBoilerplate 样板句惩罚** (b33): 数字主导列表 + 分号链式列表两类判据, 坐标样板
   三案交叉验证; 载体句保护 (不砍奖励)。
3. **b19RowCandidates 表格行候选** (b34): 连续 cell-like 短行 run join, 行级准入两把尺
   (数字行锚 + 行级查询词); 触发面 0/3643 row 尾 = 休眠零杀伤。
4. **b37SnippetBetter 融合层 snippet 合并判据** (b37): 查询关键 token 命中数优先、次取
   长度; 打平回退旧行为逐字节; 修复"证据被同页/孪生页长样板覆盖"形态 (BLM 案全链路实证)。

## 部署

```bash
bash scripts/setup-rerank.sh   # 重排三件套一键部署 (libonnxruntime + model + tokenizer)
go build -o searchcore .
# MCP stdio 行分隔 JSON-RPC 2.0; 工具面: search / fetch / search_providers / research /
# x_search / search_cache / cache_stats
```

## 开关清单 (env, 全部缺省安全)

| 开关 | 缺省 | 说明 |
|------|------|------|
| `SC_RERANK` | 0 | 1=启用重排 (需三件套); 缺省关 = 零 onnx 依赖底盘不变 |
| `SC_RERANK_THREADS` | NumCPU | 重排 session intra-op 线程 |
| `SC_RERANK_POOL` | 10 | 重排池深 (10→20 实测 +1pp @10 级, 延迟翻倍, 不建议) |
| `SC_B37_MERGE` | 1 | 0=回退旧 snippet 合并规则 |
| `SC_EARLY_HARVEST_MS` | 1200 | 早收割阈值 (结算腿≥60% 且 refs≥15 才断慢腿) |
| `SC_SOFT_DEADLINE_MS` | =timeout | 软截止无条件上限 |
| `SC_UA` | search-core/0.5 | fetcher UA (自报家门是拒签最强特征, 见已知边界) |
| `SC_NO_CACHE` / `SC_ENABLE_SEARXNG` | - | 评测采集 / searxng 池回开 |

## 质量证据链 (封存档案)

- 评测基准: NQ-Open dev (3610) / TriviaQA dev (200), 同题集确定性抽样窗 (NQ 98 / TQA 100)
- 方法论 `scripts/EVAL-METHODOLOGY.md` §1-21 (交付序口径/双口径对拍/transition 归因/
  配对反事实裁决/设计探针先行/分步分解自检 等纪律)
- 实验锚窗 journal `scripts/upstream-anchor-journal.jsonl` 28 行 append-only (含 4 次
  correction 全链条: b24 大小写 / b29 口径 / b27 潜伏 rank 字段语义漂移)
- 原始证据 `scripts/eval-dumps/` gzip + SHA256SUMS + MANIFEST (窗口定义/复放指引/预期
  复算值锚点, 探针 TALLY 随换血漂移属正常已注记)
- 工作日志 `worklog.md` 89 任务 (b20-b37 全批次判定链 + RERANK-ARC-CLOSURE.md 收官报告)

## 已知边界 (诚实声明)

- miss 新平衡点: 词面错位 51.3% + 无gold/池外 48.7% (D 桶主体 = 真召回缺失 ~57%,
  排序层已到顶, 下一座矿在召回/查询词形层)
- 融合层修复空间上限 ≈8% miss@1 (b36 五级血脉追踪定界); anysearch 慢腿 (2.5-4s) 承载
  8/12 条证据但被 1200ms 早收割系统性丢弃
- CE query-mirroring 偏置: rank1 垃圾率 NQ 3.1→6.1% / TQA 0→4.0% (题库农场页亲和),
  池内垃圾降权列候选未立项
- 拒爬墙: 403 指纹级拒爬横跨多域名 (<150ms 即拒), 浏览器 UA 重试零解锁; UA 换装涉爬虫
  伦理/ToS 不擅自变更
- Wikipedia 站脚/TOC 样板 snippet 子类: snippet 源头就是页脚, 注入与重排都救不了

## 下一版本菜单 (v0.10+, 按用户定序)

1. **ENGINE-MISS 查询词形/召回层** (主体大矿, b36 案集 15/21 条; 召回层工程)
2. **anysearch 收割策略 + 请求级延迟档位** (新需求: AI 调用方可选 极速/标准/深度 三档,
   映射收割阈值与软截止; b36 慢腿证据数据为深度档收益依据)
3. domainCap 长尾子域误伤 (Gotham 案, 需产品决策)
4. b19 失败重试 (900s 窗, 低 ROI 挂账)

云 endpoint 对比: 按用户指示搁置。
