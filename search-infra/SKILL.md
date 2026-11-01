---
name: search-core
description: 免 key 多引擎搜索工具——注册 36 个搜索源（通用引擎池+wiby/keenable 独立索引+MDN 文档面+GitHub/StackOverflow/包管理器/学术/模型/镜像/实体垂直 API）+可选外部 MCP 搜索连接器，域名路由自动走专线，三层权威域名体系（全局学术 16 域兜底+7 主题分档表 S/A/B+10 类意图表：新闻/安全/法律/金融/医疗/数据库/设计/词典/教育/数据+geo 地理主题，中文站 zh 守卫，只提权不屏蔽）+垃圾站置信度筛选（csdn/百家号/搜狐/文库爬虫站等硬屏 12 域剔除计数，ehow 等 SEO 农场降权标注）+页面级相关性守卫（域名对≠页面对时权威提权清零，防 s 档抬错页），支持深度研究循环（三档预算预设）、网页正文抓取、图片/新闻/学术垂直搜索。零浏览器依赖、零账号零 key。适用于：需要实时网络信息的任何任务（查资料/查文档/查新闻/查论文/查图片）、agent 的搜索后端（MCP/CLI/REST 三出口）、本地优先不想交 key 的场景。
---

# search-core 技能

本地搜索编排器：47 个注册搜索源（+Nominatim 地理编码：在哪/坐标/地址类查询走 OSM 官方；+pypi 包元数据直取/license 透传；+HF Papers AI 论文面；+nvd/osv/ghsa CVE 编号直取官方元数据：查询含 CVE-\d{4}-\d{4,7} 编号才发请求，无编号合法空；+bingnews 新闻 RSS：apiclick 内嵌真实出版方链接可解码；+wiktionary 词典 en+zh 双语词义/词源（CJK 查询走 zh.wiktionary，零命中合法空）；+europepmc 生物医学文献聚合（PMID/PMC/DOI 直链）；+clinicaltrials NLM 试验注册库（NCT 直链）；+worldbank 宏观数据指标直取（指标码×国家码小映射，未知指标合法空零请求））（通用池 DDG/Mojeek/Yahoo/SearXNG(多实例回退链)/Marginalia/HN/Wikipedia/Bing RSS/arXiv/Crossref/Wiby/Keenable/AnySearch + 垂直 API GitHub/StackExchange/npm/crates/packagist/rubygems/HuggingFace/DockerHub/OpenAlex/dblp/PubMed/Wikidata/Nominatim 地理/MDN 文档/V2EX 中文社区；显式点名可加 Openverse 图片/Googlenews 新闻/Wayback 快照/WikiRev 修订历史），域名路由表自动把包/镜像/学术/实体/安全(CVE)/新闻/词典/医学研究(临床试验/荟萃分析等研究意图锚，药名/副作用题不进线)/数据(world bank/开放数据/统计)意图转专用 API 专线，融合去重后返回统一引用格式。三层权威提权：全局学术 16 域兜底（0.4/0.75）+ 主题分档表（官方文档 S=1.2/社区 A=0.75/中文优质站 B=0.4，zh 条目仅中文题生效）+ 意图表（新闻/安全/法律/金融/医疗/数据库/设计等 10 类按查询意图提权，不改召回面）；讨论意图（怎么看/讨论/体验）时社区源升档反超官方文档；命中条带 authority 标注+页面级相关性守卫（域名命中但页面不含查询关键 token → 提权清零防抬错页，authorityGuarded 透明标注）+来源类型 kind 全域可分类（ref.sourceKind：official/community/media/expert/reference，纯元数据）。额度可见：providers() 透出受控引擎 used/remaining/exhausted/resetsAt。可选配 Tavily/Brave/Exa key 自动并联，月度额度用完自动回落免 key 池（providers() 可见余量）。抓取层落地页改写：crates.io 裸页走官方 API、doi 403/SPA 空壳自动换 OA 直链（OpenAlex→Unpaywall）。专线腿治理：programming/images/security/news/dictionary/medical/data 专线自动并联聚合兜底腿（searxng+tavily keyless，窄腿不塌方；security 三腿=CVE 官方元数据每腿 1 ref 太薄必须兜底），MDN 文档腿按查询 web 亲和出腿（非 web 编程题零请求）；arXiv/Crossref 学术源只走学术专线不坐通用池（防非学术题乱入）。零结果抢救腿：全腿空手（熔断冷却/全失败）时自动用健康聚合器再试一轮（meta.rescued 诚实标注，尊重用户 engines 排除配置）。类目正主前排：查询命中意图类目时该类目表 s 档提权 1.2→2.0（只动命中类目，守卫+domainCap 照常）；意图检测最长关键词胜出消歧+无歧义锚召回补齐（"open data">"gdp"，10/11 类目题命中）；页面守卫多证据放行：长锚缺席但命中 ≥2 个其他查询 token 不清零（rapid7 官方分析页不再被 "mitigation" 长锚误伤）。三层权威表+垃圾源表外置 JSON（core/data/authority/ 四文件单一真源，政策注释在 _meta，改表跑 npm test 守门）；SC_AUTHORITY_JSON 外挂覆盖仍是最外层（本地改表不改代码）。早收割：到 earlyHarvestMs(默认 1.2s)后若 60% 引擎已返回且引用≥15 条立即交付，不等满 6s 软截止（实测延迟均值 -66%，vs-zai 对比首次反超；证据不足时保守等待）。

## 何时用

- 需要搜索网络但手头没有搜索工具，或现有工具要交 key/要跑浏览器
- 需要垂直搜索：图片（openverse）、新闻（google news）、学术论文（arXiv/Crossref）、技术社区（HN）、百科（Wikipedia）
- 需要多角度深度研究并产出带引用编号的报告
- 抓网页正文且只要命中段（focus 抓取，省 90% token）

## 三种用法

### 1. CLI（最快上手）

```bash
node <repo>/core/dist/cli.js search "sqlite vector search"        # 多引擎并行搜索
node <repo>/core/dist/cli.js search "cats" --kind image           # 图片搜索
node <repo>/core/dist/cli.js fetch <url> --focus "installation"   # 只抓命中段
node <repo>/core/dist/cli.js research "topic" --loops 3           # 深度研究循环
```

首次使用先构建：`cd <repo>/core && npm install && npm run build`

### 2. MCP server（推荐给 agent）

```json
{ "mcpServers": { "search-core": { "command": "node", "args": ["<repo>/core/dist/mcp.js"] } } }
```

接入 Claude Code / Cursor / Claude Code on Bedrock（WebSearch 不可用场景的官方补法）详见 **[docs/mcp-exit.md](docs/mcp-exit.md)**（含真网络 stdio 实测证据与诚实边界）。

工具（渐进披露，Direct 3 个按需激活 Deferred 5 个）：

| 工具 | 类型 | 干什么 |
|---|---|---|
| `search` | Direct | 多引擎并行搜索，`kind`: web/image/news/x/archive，`engines` 可点名引擎 |
| `fetch` | Direct | 抓网页正文，`focus` 参数只回命中段+邻接段 |
| `tool_search` | Direct | 按关键词找上面这些工具（渐进披露入口） |
| `research` | Deferred | 深度研究循环（角度池 8 选 5+6 问反思+双预算池），`preset`: summary(1 轮/4 抓)/report(默认)/deep(5 轮/24 抓)，SSE 事件可订阅 |
| `x_search` | Deferred | X/Twitter 搜索（官方 API∥Guest GraphQL∥site: 免 key 三层降级） |
| `search_providers` | Deferred | 查看各引擎健康度/熔断状态/额度余量 |
| `search_cache` | Deferred | v0.5 离线全文搜已抓页面（FTS5，毫秒级；全网引擎全灭时的兜底面） |
| `cache_stats` | Deferred | 缓存命中统计 |
| `mcp:<name>` | 可选 | v0.8 外部 MCP 搜索连接器（`SC_MCP_CONNECTORS` JSON 配置才注册）：把 Tavily/Exa/博查等现成 MCP server 当引擎并联，keySlot 语义同 Tavily |

### 3. REST + SSE 网关

```bash
node <repo>/core/dist/cli.js serve-http        # 默认 SC_HTTP_PORT 8629
curl -X POST localhost:8629/research -d '{"query":"..."}'   # SSE 事件流
```

## 响应契约（agent 对接必读）

```jsonc
{
  "refs": [{
    "refId": 1,               // 引用编号，报告里的 [n] 与此对应
    "title": "...", "url": "...", "snippet": "...",
    "engines": ["duckduckgo","mojeek"],  // 哪些引擎命中了它（多引擎佐证=更可信）
    "published": "2026-08-30", "kind": "web"
  }],
  "meta": {
    "engines_used": ["wikipedia","arxiv"],
    "engines_failed": [
      { "name": "ddg", "status": "rate_limited", "retryable": true,  "error": "http 202 (soft-block)" },
      { "name": "tavily", "status": "quota", "retryable": false, "error": "http 432 (plan quota exceeded)" }
    ],
    "engines_skipped": [ { "name": "marginalia", "status": "circuit_open" } ],
    "degraded": false,        // true=出勤引擎不到一半，结果可信度降级，建议换词重搜或降低信任
    "elapsed_ms": 1432, "from_cache": false
  }
}
```

失败标注六类：`rate_limited`（晚点再试）/ `blocked`（别硬碰）/ `quota`（额度尽）/ `auth`（修 key）/ `timeout` / `error`。`retryable=false` 的失败重试没有意义，直接换引擎或换词。

## 引用规范

写报告时用 `[refId]` 标注来源，如 "SQLite-vec 支持 int8 量化 [3]"。strict 模式下未注册的引用编号会抛错（幻觉引用零容忍）。

## 配置（环境变量优先于 ~/.search-core/config.json）

| 变量 | 说明 |
|---|---|
| `SC_ENGINES` | 引擎清单（默认 10 个免 key）；`openverse,mwmbl,googlenews,wayback,wikirev` 需显式点名（wayback query=URL/域名，wikirev query=词条名） |
| `SC_SOFT_DEADLINE_MS` | 软截止，默认 6000（到点先返回快腿结果，慢腿标记 timeout） |
| `TAVILY_API_KEY` 等 | 可选 key 插槽，自动并联，月度额度（`SC_TAVILY_MONTHLY_QUOTA`，默认 1000）用完自动回落免 key 池 |
| `SC_SEARXNG_BASE_URL` | 自托管 SearXNG 实例（公共实例不可依赖） |
| `SC_TIMEOUT_MS` / `SC_UA` / `SC_HTTP_PORT` | 单引擎超时 12s / 规范 UA 勿改 / 网关端口 |

## 已知边界（诚实声明）

- Google/Bing 主站永不进池：裸 HTTP 抓到的是 JS 空壳假货（HTTP 200 最阴险），不装浏览器的前提下无解；新闻面走 Google News RSS。
- 本工具不内置代理/TLS 指纹伪装：被封靠熔断+换引擎存活，不硬碰反爬。
- DDG 有 3 秒限速门（agent 高频场景的生存项）；Marginalia 1 次/分；Openverse 20 次/分+200 次/天。
- googlenews 结果版权限个人非商业渲染，所以默认不进池。
