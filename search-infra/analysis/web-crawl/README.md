# Web 爬取专题（GitHub 之外的世界）

> Task 10-a/b/c · 2026-09-03 · 三个 agent 并行：官方 API 文档 + key API 定价核实 + 反爬博客圈/HN/论文。
> 定位：GitHub 扫库（search-landscape/）看的是"别人做了什么"；本目录看的是"官方文档和实战博客怎么说"——参数、限额、反爬行为、存活状态。

## 30 秒结论（合并三轮）

1. **Wikimedia 403 破案：是 UA 问题，不是 HTTP/1.1 协议问题**（10-a 11 项矩阵实测）。带规范 UA（含项目 URL）后 h1.1/h2 全通；真凶是 DEFAULT_UA 伪装 Chrome——Wikimedia 2025-08 起（Phab T400119）重点封杀浏览器伪装 UA。**改一行 UA，wikipedia 进默认池**，Task 8"待 h2"结论作废。
2. **Marginalia 迁移令**：2025-12-08 新 API `api2.marginalia-search.com`（header `API-Key: public`），旧 `api.marginalia.nu` 时通时断。Mwmbl 备胎活着但参数是 `s` 不是 `q`。
3. **Google CSE 关停官方实锤**（10-b 原文引用）：API 已对新客户关闭，存量客户 2027-01-01 全部退役（免费层和付费一起死）。**CSE 计划从 backlog 划掉**；Google 免 key 通道只剩 News RSS（直抓路线 2026 年共识已死：裸 HTTP=60-91KB JS 空壳，TLS 伪装也救不了）。
4. **key 插槽回落顺序定案**：Tavily（1000 credit/月免卡，429/432/433 三档超限码）→ Brave（月送 $5≈1000 次，50QPS，旧"免费 2000/月"已死）→ Exa（月送 $10≈1400 次，`type:neural/keyword` 已废弃换 auto/fast/deep 系列）。Serper 2500 次确认仍有效但属一次性炮灰。
5. **TLS 指纹进入 JA4 时代**（10-c）：握手层指纹先于 HTTP 头被读取，UA 伪装无用；Node 生态唯一活跃轻量方案 = `impers`（curl-impersonate 绑定，2026-09-01 仍发版，单依赖 koffi）。**路线：v0.3 用"绕"（只打不查指纹的端点），v0.4 impers 做 feature-flag 备胎，永不上浏览器**。
6. **DDG 202 空页=软封会自愈**，触发=突发高频+脏 IP（挂便宜代理反而更糟）；html/lite 端点免 vqd 单请求直出；绕法=限速门+指数退避+把空结果当限速信号。DDG 流量 2026-05 暴涨 30%，礼貌限速从优化项变生存项。
7. **独立搜索引擎死亡率实锤**：alexandria.org DNS 已死、stract.com 域名易主——熔断+健康探测是保命符；RRF 论文对照结论：现有融合配方哲学正确（奖励共识），v0.4 可开加权变体 Σ1/(k+bestRank) 实验分支。

## 文件导航

| 文件 | 内容 | 三句话摘要 |
|---|---|---|
| [e-keyless-endpoint-docs.md](e-keyless-endpoint-docs.md) | 12+ 免 key 端点官方文档精读+curl 实测 | Wikimedia 之谜=UA；每个端点的参数表/响应字段/限额/坑；进池优先级排序表 |
| [f-key-api-docs.md](f-key-api-docs.md) | key API 官方文档+定价核实（2026-09 实况） | CSE 关停原文；Tavily/Brave/Exa/Serper/You.com 现状；插槽接入顺序 Tavily→Brave→Exa |
| [g-antibot-blogs.md](g-antibot-blogs.md) | 反爬实战知识（博客/HN/论文/独立引擎圈） | JA4 时代+impers 唯一活路；DDG 202 档案；RRF 论文对照；Kagi 可抄三招；v0.3 反爬路线一段话 |

## 与其他文档的关系

- 进池决策落地 → `core/src/providers/keyless-apis.ts`（代码）+ `core/README.md`（映射表）
- 目标清单更新 → `docs/targets-search.md`（CSE 划掉、impers 进 P2、插槽顺序进 P1）
- GitHub 侧情报（仓库活跃度/竞品） → `analysis/search-landscape/`（Task 7/9）
- 深挖三大仓库源码 → `analysis/deep-wigolo.md`、`analysis/deep-ddgs-metasearchmcp.md`（Task 8）

## 方法论备注

- 官方文档 ≠ 真相：本次多处"文档没写/写了过期"（Brave 套餐改 credit 制、Exa 参数废弃、Mojeek 免费层官网查无）。**凡是接入前必须重爬官方文档**，文档漂移速度 ≈ 半年一大变。
- 实测优先：本目录所有"可用 curl 原文"均为 2026-09-03 真实跑通/跑挂的记录，跑挂的也是情报（429/403/422 都是行为档案）。
- 信源立场：代理/ SERP 厂商博客（apiserpent/brightdata/webclaw 等）技术细节可信、结论倾向推销，已只取行为事实。
