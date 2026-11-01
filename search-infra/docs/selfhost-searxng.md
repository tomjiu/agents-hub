# 自建 SearXNG 速查（search-core 的通用底座引擎）

> 为什么自建：公共实例对数据中心 IP 三层门全锁（429/JS 挑战/IP 黑名单，19 实例 0 个给 JSON，2026-09-03 复核连 config 里开着的 google 都摸不到——见 `analysis/search-landscape/e-ai-invocable-domain-routing.md` §2）。
> **SearXNG 只值得自托管**：自己机器上 JSON 随便开，没有 IP 封禁问题，`format=json` 就是 search-core 的 `searxng` provider 的输入。

## 1. 五分钟起一个实例（Docker）

```bash
mkdir -p searxng && cd searxng

# 官方镜像 + 本地 8080
docker run -d --name searxng -p 8080:8080 \
  -v "$PWD/settings.yml:/etc/searxng/settings.yml:ro" \
  searxng/searxng:latest
```

`settings.yml` 最小可用配置（关键三处：**开 json 格式 / 关 limiter / 随便填个 secret**）：

```yaml
use_default_settings: true
server:
  secret_key: "换成任意随机串"   # 必填，否则起不来
  limiter: false                # 自家机器不用防自己；开 reverse proxy 对公网才需要 true
search:
  formats:
    - html
    - json                      # ⚠ 默认只有 html，不开 json 则 /search?format=json 返回 403
```

验证：

```bash
curl 'http://localhost:8080/search?q=test&format=json' | head -c 300
# 看到 {"query": "test", "results": [...]} 即成功
```

## 2. 接进 search-core

```bash
SC_SEARXNG_BASE_URL=http://localhost:8080   # provider 自动用 /search?format=json
# 可选: 限定引擎子集（逗号分隔，对应 SearXNG 的 engine 名）
SC_SEARXNG_ENGINES=google,bing,duckduckgo,wikipedia
```

searxng provider 在默认池里排第一位——**自托管实例 = 你自己的 IP 池 + 70+ 引擎聚合**，这是免 key 路线里"通用搜索"唯一可持续的形态。

## 3. 现实预期（别踩 e 报告确认过的坑）

- **家用宽带/干净住宅 IP**：google/bing 引擎大概率能用，但 Google 迟早识别你（SearXNG 调度器会自动把验证码类引擎挂起 1 小时～15 天，这是上游内建行为，不是故障）。
- **数据中心 IP**：google 引擎基本没戏（官方 issue #2750 同款死法），靠 bing/brave/ddg/mojeek/marginalia 等引擎 + search-core 的免 key 池互补。
- 公共实例列表不要硬编码进任何依赖——只配当"试运行探针"（本仓库 19 实例实测三重死法为证）。
- 官方文档：https://docs.searxng.org/ （admin 部分有 limiter/防滥用/验证码解锁说明）。

## 4. 架构定位

按用户预期架构（2026-09-03）：

```
AI agent（pi-search-boost 等）
   └─ search-core（planner/域名路由 → 免 key 池 + key 插槽 → fusion → 出口）
        ├─ Tier1 免 key API 直连：stackexchange/npm/hn/wikipedia/arxiv/...（37ms-1s，永不封）
        ├─ 自建 SearXNG：通用搜索底座（本文档，JSON 一开就是 70+ 引擎）
        ├─ Tier2 site: 前缀：无 API 权威域 → DDG/BingRSS
        └─ key 插槽：Tavily/Brave/Exa（额度用完自动回落免 key 池）
```

## Phase AB 附注：公共实例兜底链（内置）

用户实测 searx.space 80 个开 HTTPS 实例：55 个 429、11 个伪 200 反爬挑战页、6 个 403、4 个 418，**仅 2 个真 JSON**（search.mectov.my.id 333ms / sx.xo.st 3.9s）——公共实例刻意关 JSON+反爬是行业现状，**只配当兜底**。

searxng provider 自 phase AB 起内置多实例回退链：自建（SC_SEARXNG_BASE_URL）永远链首 → 内置兜底实例 → 可用 SC_SEARXNG_INSTANCES 覆盖兜底名单。判定标准是"能 JSON.parse 且有 results 数组"（防伪 200 挑战页）；单实例空结果自动换下一家，全灭才抛错交熔断。**自建仍是最稳路径**——兜底链只是让"没自建的用户"也有一个能出活的 searxng 腿。
