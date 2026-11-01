# 免 key 端点官方文档爬取报告（Task 10-a）

日期：2026-09-03 · 方法：官方文档/政策页 + curl 实测（样例均截断）· 仓库版本：main@2334759

---

## 30 秒结论

1. **Wikimedia 403 之谜破案：是 UA 问题，不是 HTTP/1.1 协议问题。** Task 8 的"拒 HTTP/1.1"结论**错了**。带"带联系方式"的规范 UA 后，**h1.1 和 h2 全部 200**（en/zh、rest.php、api.php、api.wikimedia.org 全通）。真正凶手是 `core/src/config.ts:62` 的 `DEFAULT_UA`——一个伪装 Chrome 的假 UA（"Mozilla/5.0 … Chrome/126.0 … search-core/0.1"），Wikimedia 明令封杀浏览器伪装 UA（T11 实测纯 Chrome UA 也 403）。**改一行 UA（或设 `SC_UA` 环境变量），wikipedia 立即可以进池。**
2. **Marginalia 出了新 API（2025-12-08）**：`api2.marginalia-search.com`，header 带 `API-Key`（公开体验 key 就是 `public`）。旧端点 `api.marginalia.nu` 时通时断（本次实测 1 超时 1 成功）。现有 provider 该迁移了。
3. **Mwmbl 活着但参数变了**：正确用法 `https://mwmbl.org/api/v1/search?s=关键词`（参数是 `s` 不是 `q`，用 `q` 得 422），可当 Marginalia 备胎。
4. **Openverse 匿名限流实测拿到硬数字：20 次/分钟 + 200 次/天**（响应头直接给），`page_size` 匿名上限 20；注册流程摸清（POST `/v1/auth_tokens/register/`）。
5. **HN Algolia 零 key 零文档限流**，`hitsPerPage` 服务端硬截 1000；arXiv 限速 1 次/3 秒 + `max_results`≤2000（本次实测还撞上了 429 "Rate exceeded."）；Crossref `rows`≤1000（400 报错原文实锤）。
6. **mcp.exa.ai 匿名 MCP 还活着**（initialize 握手 200，exa-search-server v3.2.1）；alexandria.org DNS 已死；stract.com 无公开 API；duck.ai 的 x-vqd-4 通道仍在。Google News RSS 的 `when:1d`、`site:` 运算符实测有效（100 条封顶）。

---

## 1. Wikimedia（最高优先级：403 之谜）

**一句话结论：纯属 UA 问题。规范 UA 下 HTTP/1.1 与 HTTP/2 全通，wikipedia 应立刻进池。**

### 判决性实验矩阵（2026-09-03 实测）

| # | 端点 | 协议 | User-Agent | 结果 |
|---|------|------|-----------|------|
| T1 | en.wikipedia.org/w/rest.php/v1/search/page | **HTTP/1.1** | `search-core/0.3 (https://github.com/mmqz/search-tool-rnd)` | **200** ✅ |
| T2 | 同上 | HTTP/2 | 同上 | **200** ✅ |
| T3 | 同上 | HTTP/1.1 | curl 默认（空缺省 UA） | 403 ❌ |
| T4 | zh.wikipedia.org/w/rest.php/v1/search/page | HTTP/1.1 | 规范 UA | **200** ✅（中文结果正常） |
| T5/T6 | api.wikimedia.org/core/v1/wikipedia/en/search/page | h1.1 / h2 | 规范 UA | **200** ✅✅ |
| T7 | en.wikipedia.org/w/rest.php/... | HTTP/1.1 | `search-core/0.3`（裸 UA，无联系方式） | 403 ❌ |
| T8 | 同上 | HTTP/1.1 | 空 UA（`-H 'User-Agent;'`） | 403 ❌ |
| T9 | en.wikipedia.org/w/api.php（Action API，provider 现用 URL） | HTTP/1.1 | 规范 UA | **200** ✅ |
| T10 | 同 T1 | HTTP/1.1 | **现网 DEFAULT_UA**（假 Chrome + search-core/0.1） | 403 ❌ |
| T11 | 同 T1 | HTTP/1.1 | 纯 Chrome UA（无 search-core 后缀） | 403 ❌ |

### 实测可用 curl 原文

```bash
# REST v1（推荐，响应带缩略图和描述）
curl -sS -m 15 -H 'User-Agent: search-core/0.3 (https://github.com/mmqz/search-tool-rnd)' \
  'https://en.wikipedia.org/w/rest.php/v1/search/page?q=earth&limit=5'
# 返回样例（截断）：
# {"pages":[{"id":9228,"key":"Earth","title":"Earth",
#   "excerpt":"<span class=\"searchmatch\">Earth</span> is the third planet from the Sun ...",
#   "description":"Third planet from the Sun",
#   "thumbnail":{"mimetype":"image/jpeg","width":60,"height":60,"url":"//upload.wikimedia.org/...60px-...jpg"}}]}

# 中文维基
curl -sS -m 15 -H 'User-Agent: search-core/0.3 (https://github.com/mmqz/search-tool-rnd)' \
  'https://zh.wikipedia.org/w/rest.php/v1/search/page?q=%E5%9C%B0%E7%90%83&limit=3'
```

### 官方政策依据

- `foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy`（2026-03 版）原话：**"if you don't supply a User-Agent header, or you supply an empty or generic one, your request will fail with an HTTP 403"**；UA 须能识别客户端并带联系方式（项目 URL 或邮箱）。
- Phabricator **T400119**（2025-08）：Wikimedia 开始封杀"不遵守 UA 政策"的流量，浏览器伪装 UA 是重点打击对象——这解释了 T11 为什么纯 Chrome UA 也 403。

### 参数与字段（REST v1 search/page）

| 参数 | 说明 |
|------|------|
| `q` | 查询词（URL 编码） |
| `limit` | 每页条数（实测 5/3 均可） |

| 响应字段（`pages[]`） | 说明 |
|------|------|
| `id` / `key` / `title` | 页面 ID / URL slug / 标题 |
| `excerpt` | 命中片段，**含 `<span class="searchmatch">` HTML**，需 strip |
| `description` | 一句话描述（比 excerpt 干净，适合做 snippet） |
| `thumbnail.url` | 60px 缩略图（协议相对 `//upload...`，要补 https:） |
| `matched_title` | 重定向命中时的备选标题 |

### 对 provider 的直接建议（改 3 处）

1. `core/src/config.ts:62`：`DEFAULT_UA` 从假 Chrome 改成 `"search-core/0.3 (+https://github.com/mmqz/search-tool-rnd)"` 之类带联系方式的 UA（或文档写明部署时必须设 `SC_UA`）。**一处改动惠及所有 provider**。
2. `keyless-apis.ts:149-152` 的注释"Wikimedia 拒 HTTP/1.1 / 待 h2 传输层"是**误诊，删掉**；wikipedia 改回默认池。
3. provider 现用 Action API（`/w/api.php?action=query&list=search`，T9 已验证通）；可顺手换 REST v1（多 description/thumbnail，snippet 更干净），不强求。

---

## 2. Openverse（图片垂直，已在池）

**一句话结论：匿名 20 次/分 + 200 次/天（响应头硬数字），`page_size` 匿名上限 20，过滤参数全套实测通过，provider 现状健康。**

### 实测可用 curl 原文

```bash
curl -sS -m 15 'https://api.openverse.org/v1/images/?q=cat&page_size=5'
# 返回样例（截断）：
# {"result_count":240,"page_count":48,"page_size":5,"page":1,"results":[
#   {"id":"1c5442f6-...","title":"Cat Fish 2","foreign_landing_url":"https://www.flickr.com/photos/.../3481540500",
#    "url":"https://live.staticflickr.com/.../3481540500_c846c62863_b.jpg","license":"by","license_version":"2.0",
#    "license_url":"https://creativecommons.org/licenses/by/2.0/","provider":"flickr","creator":"admiller",
#    "width":716,"height":1024,"thumbnail":"https://api.openverse.org/v1/images/<id>/thumb/",...}]}
```

限流响应头（本次实测原文）：

```
x-ratelimit-limit-anon_burst: 20/min
x-ratelimit-limit-anon_sustained: 200/day
```

### 过滤参数（组合实测 200 通过）

| 参数 | 取值 | 实测 |
|------|------|------|
| `license` | `by` / `by-nc` / `cc0` / `pdm` 等（逗号分隔多值） | ✅ |
| `size` | `small` / `medium` / `large` | ✅ |
| `aspect_ratio` | `tall` / `wide` / `square` | ✅ |
| `category` | `photograph` / `illustration` / `digitized_artwork` | ✅ |
| `extension` | `jpg` / `png` / `gif` / `svg` | ✅ |
| `page_size` | 1–20（匿名硬上限 20；2022-06 起 v2.5.5 强制） | ✅ |
| `q` / `page` | 查询词 / 页码 | ✅ |

### 注册 token 怎么拿（探针实证）

1. `POST https://api.openverse.org/v1/auth_tokens/register/`，JSON `{"name","description","email"}`（探针空 body 返回 400，三个必填字段名即此）→ 得 `client_id`/`client_secret`；
2. `POST /v1/auth_tokens/token/`（`grant_type=client_credentials`）→ `access_token`，之后带 `Authorization: Bearer`；
3. `GET /v1/rate_limit/` 可查自己档位（匿名实测返回 `{"rate_limit_model":"standard","verified":false}`）。注册档官方口径"略高"（未公布精确表格）；`page_size` 注册后可到 500。

### 响应字段表（`results[]`，实测提取）

`id, title, indexed_on, foreign_landing_url(落地页), url(图片直链), creator, creator_url, license, license_version, license_url, provider, source, category, filesize, filetype, tags[{name,accuracy}], attribution(现成署名串), fields_matched, mature, width, height, thumbnail, detail_url, related_url, unstable__sensitivity`

### 坑与建议

- 200/天对我们够用但要进 governor 限速（约 1 req/4s 匀速可撑满全天不撞 burst）。
- 现有 provider 只传 `q/page_size`；建议加可选 `license` 透传（opts.filter）。
- `url` 偶发 http:// 直链（flickr live.staticflickr 也有 http），入库时归一 https。

---

## 3. HN Algolia（已在池）

**一句话结论：零 key、无官方限流数字（社区公认宽松），`hitsPerPage` 服务端硬截 1000，search/search_by_date 双通道实测通过。**

### 实测可用 curl 原文

```bash
# 相关度排序（默认，热门权重高）
curl -sS -m 15 'https://hn.algolia.com/api/v1/search?query=webgpu&tags=story&hitsPerPage=3'
# 按时间 + 分数过滤（注意 > 要编码成 %3E）
curl -sS -m 15 'https://hn.algolia.com/api/v1/search_by_date?query=webgpu&tags=story&numericFilters=points%3E100&hitsPerPage=3'
# 返回样例（截断）：
# {"hits":[{"objectID":"35465729","title":"Chrome ships WebGPU","url":"https://developer.chrome.com/blog/webgpu-release/",
#   "author":"itsuka","points":...,"num_comments":...,"created_at":"...","_tags":["story","author_itsuka",...]}],"nbHits":...}
```

### 要点表

| 项 | 结论 | 证据 |
|----|------|------|
| `search` vs `search_by_date` | 前者=相关度（热度加权），后者=严格时间倒序 | 两请求返回首条不同（Chrome 官博 vs 当天 Show HN） |
| `tags=story` | 只搜主帖；也可 `story_数字ID`、`author_xxx`、`show_hn` | 实测 `_tags` 回显 |
| `numericFilters` | `points>100`、`created_at_i>...` 等，符号 URL 编码 | ✅ 200 |
| `hitsPerPage` 上限 | **1000**（传 2000 被服务端改写为 1000，响应 `hitsPerPage:1000, hits:1000`） | 实测 |
| 限流 | 官方文档无数字；无 key 无配额页 | — |

### 建议

- 现有 provider 用 `search` + `tags=story`，正确。可加可选 `numericFilters` 透传（研究类查询过滤灌水贴很有用：`points>50`）。
- 热点/新闻型查询可切 `search_by_date` 拿最新讨论——router 层按 query 意图选端点，低优先级。

---

## 4. arXiv（论文垂直，建议进池）

**一句话结论：免 key Atom XML，限速 1 次/3 秒（实测撞 429 "Rate exceeded."），`max_results`≤2000/次、总量 30000，字段齐。**

### 实测可用 curl 原文

```bash
# ⚠ 裸 UA 首连实测被限："Rate exceeded." HTTP 429；等 4 秒重试同样 429（出口 IP 热）；
# 显式带 UA + 间隔后 200：
curl -sS -m 20 -A 'search-core/0.3 (https://github.com/mmqz/search-tool-rnd)' \
  'https://export.arxiv.org/api/query?search_query=all:electron&max_results=1'
# 返回样例（截断）：
# <?xml version='1.0'?><feed xmlns="http://www.w3.org/2005/Atom" ...>
#   <opensearch:totalResults>185684</opensearch:totalResults><opensearch:itemsPerPage>1</opensearch:itemsPerPage>
#   <entry><id>http://arxiv.org/abs/cond-mat/0011267v1</id><title>The electronic structure of cuprates...</title>
#     <summary>...</summary><link href="https://arxiv.org/abs/..." type="text/html"/>
#     <link href="https://arxiv.org/pdf/..." rel="related" type="application/pdf" title="pdf"/></entry>
```

### 要点表

| 项 | 结论 |
|----|------|
| endpoint | `https://export.arxiv.org/api/query`（GET，返回 Atom XML） |
| `search_query` 语法 | `all:` / `ti:` / `au:` / `abs:` / `co:` / `cat:` 前缀，`AND/OR/ANDNOT` 组合；`id_list=2401.00001` 直取 |
| `sortBy` | `relevance`（默认）/ `lastUpdatedDate` / `submittedDate`；`sortOrder=ascending/descending` |
| `max_results` 上限 | **2000/请求**（官方手册：总量 30000，用 `start` 翻页） |
| 限速 | 官方礼貌条款 **1 请求/3 秒**；本次实测同一出口 IP 已被限（连吃 429）——共享 IP 环境要按 429 退避 |
| 字段 | `entry{id(含版本号), title, summary, published, updated, author{name}, link[abs/pdf], arxiv:primary_category, category}`；`opensearch:totalResults` 给总数 |

### 建议

- 新增 `arxiv` provider：XML 用 cheerio xmlMode 解析（仓库已有此依赖，bingrss 同款路线）。
- governor 给 arxiv 单独 3s 间隔；遇到 429 指数退避（共享出口 IP 场景很可能撞）。
- snippet 用 `summary` 截断，url 用 `link[type=text/html]`，published 用 `published`。

---

## 5. Crossref（学术引用垂直，建议进池）

**一句话结论：免 key，`mailto=` 进 polite pool；`rows`≤1000（400 报错实锤）、深翻页用 `cursor`；按被引数排序实测通过。**

### 实测可用 curl 原文

```bash
curl -sS -m 15 'https://api.crossref.org/works?query=attention+transformer&rows=2&mailto=research%40example.org&select=DOI,title,is-referenced-by-count,URL,author,issued&sort=is-referenced-by-count&order=desc'
# 返回样例（截断）：
# {"status":"ok","message-type":"work-list","message":{"total-results":316596,"items":[
#   {"DOI":"10.1109/iccv48922.2021.00986","title":["Swin Transformer: ..."],
#    "is-referenced-by-count":30104,"URL":"https://doi.org/10.1109/...",
#    "author":[{"given":"Ze","family":"Liu","affiliation":[{"name":"Microsoft Research Asia"}]},...]}]}}
```

### 要点表

| 项 | 结论 | 证据 |
|----|------|------|
| polite pool | URL 加 `mailto=`（或注册 UA）即进优待池，更快更稳 | 官方文档 + 实测 |
| `rows` 上限 | **1000**；传 1001 → `HTTP 400 {"type":"integer-not-valid","message":"...must be a positive integer less than or equal to 1..."}` | 实测原文 |
| `offset` 深翻页 | 大 offset 被限（>10000 报错），官方推荐 `cursor=*` 深翻 | 文档 |
| `select` | 逗号分隔字段白名单，减小响应体 | 实测（只回 select 的字段） |
| `sort` | `is-referenced-by-count`（被引数）、`score`、`published` 等 + `order=desc` | 实测（首条 30104 次被引） |
| 字段 | `DOI,title(数组),URL,author[{given,family,affiliation}],issued(日期数组),container-title,type,publisher,is-referenced-by-count` | 实测 |

### 建议

- 新增 `crossref` provider（`kind:"paper"`），snippet 拼 `author · 期刊 · 被引 N`，对 agent 判断权威性极有用。
- `mailto` 从 config 读（可复用 UA 里的联系方式）；`select` 固定传一份白名单省流量。

---

## 6. Marginalia + 备胎 Mwmbl

**一句话结论：Marginalia 2025-12-08 起新 API 上线（api2.marginalia-search.com + API-Key header，公开 key=public）；旧 api.marginalia.nu 时通时断；Mwmbl 参数是 `s` 不是 `q`，活着，可当备胎。**

### 新 API（官方文档 about.marginalia-search.com/article/api，2025-12-08 更新）

```bash
curl -H 'API-Key: public' 'https://api2.marginalia-search.com/search?query=json+api&count=5'
# 本次实测：HTTP 429 "QPM Limit Exceeded" —— 官方文档原话"often hits a rate limit"，公开 key 就是挤着用
```

| 参数 | 取值 | 说明 |
|------|------|------|
| `query` | 必填 | 查询词 |
| `count` | 1–100 | 结果条数 |
| `timeout` | 50–250 | 查询执行超时（ms） |
| `dc` | 1–100 | 每域名结果上限（去重利器） |
| `page` | int | 页码（1 起） |
| `nsfw` | 0/1 | 1=实验性减弱极端内容 |
| header `API-Key` | `public` 或邮件申请 | 免费 key：发信 contact@marginalia-search.com（防滥用必须走邮件） |

- 响应格式与旧版同形：`{query, license:"CC-BY-NC-SA 4.0", results[{url,title,description}]}`。
- 授权：免费非商业 key（邮件申请）→ CC-BY-NC-SA 4.0（需署名、禁商用）；商业 key 走 polar.sh 订阅。
- 自定义 filter（XML 域名黑白名单/加权）只有正式 key 能用。

### 旧端点现状（我们 provider 正在用的）

```bash
curl -H 'Accept: application/json' 'https://api.marginalia.nu/public/search/test'
# 本次两次调用：第一次 15s 超时，第二次 200：
# {"license":"CC-BY-NC-SA 4.0","page":1,"pages":11,"query":"test","results":[{"url":"https://dev.w3.org/...","title":"Test Suite: IBM","description":"..."}]}
```

### Mwmbl 备胎（实测通）

```bash
curl 'https://mwmbl.org/api/v1/search?s=test'     # ✅ 200，参数是 s！
curl 'https://mwmbl.org/api/search?q=test'        # ❌ 404（旧路径已下线）
# 返回样例（截断）：
# [{"url":"https://en.wikipedia.org/wiki/Test",
#   "title":[{"value":"Test","is_bold":true}],
#   "extract":[{"value":"Look up ","is_bold":false},{"value":"test","is_bold":true},...],
#   "source":"wi..."}]
```

### 建议

1. marginalia provider 迁到 `api2.marginalia-search.com/search?query=...`，header `API-Key: ${SC_MARGINALIA_KEY ?? "public"}`；governor 给它 1 次/分钟的保守配额（public key QPM 很紧）；域名级去重可用 `dc=2`。
2. 老 `api.marginalia.nu/public/search/{q}` 保留为 fallback（同形 JSON，解析代码不用改）。
3. Mwmbl 做 `mwmbl` provider（Marginalia 健康熔断后的替补）：`s` 传词，title/extract 是 `[{value,is_bold}]` 数组要 join 扁平化；结果偏少（维基词典类居多），定位=查漏。

---

## 7. 新闻 RSS 双通道

### Google News RSS

**一句话结论：免 key、参数齐、`when:`/`site:` 运算符实测有效，100 条封顶；版权条款限"个人 feed 阅读器渲染"，与 Bing RSS 同属机会主义通道。**

```bash
curl -sS -m 15 'https://news.google.com/rss/search?q=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD&hl=zh-CN&gl=CN&ceid=CN:zh-Hans'
# 200，<title>"人工智能" - Google 新闻</title>，含版权声明："solely for the purpose of rendering Google News
# results within a personal feed reader for personal, non-commercial use"

curl -sS '.../rss/search?q=人工智能+when:1d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans'   # ✅ 87 条，pubDate 均为近 24h
curl -sS '.../rss/search?q=AI+site:reuters.com&hl=en-US&gl=US&ceid=US:en'    # ✅ 100 条，source 全 Reuters
```

| 项 | 结论 |
|----|------|
| 参数 | `q`（查询词+运算符）、`hl`(界面语言)、`gl`(地区)、`ceid`(如 `CN:zh-Hans`/`US:en`) |
| `when:` 运算符 | `when:1d`/`when:1h`/`when:7d`，直接拼在 q 里 | 
| `site:` | 支持（q 里拼 `site:reuters.com`，实测 100 条全站内来源） |
| 条数上限 | **100** |
| 字段 | `title`（自带 " - 媒体名" 后缀）、`link`（news.google 跳转链，非原文直链）、`pubDate`、`source`(媒体名)、`description`(HTML) |

### Bing News RSS

```bash
curl -sS -A 'Mozilla/5.0 (X11; Linux x86_64) search-core/0.3' 'https://www.bing.com/news/search?q=test&format=rss'
# 200，仅 4 条 item；title "test - Bing新聞"（语言跟着出口 IP 走）
```

- 可用但**每查询只回 ~4-10 条**，聊胜于无；字段 `title/link/description/pubDate`。
- 注意与现有 `bingrss`（网页搜索 RSS `bing.com/search?format=rss`）是两个端点：一个搜新闻一个搜网页。

### 建议

- 新增 `googlenews` provider（`kind:"news"`，`hl/gl/ceid` 跟 `opts.lang` 路由）；片段含 when:/site: 透传。
- 两个 RSS 都在 snippet 标注版权口径（个人/非商业渲染），别做主搜索引擎，做新闻时效垂直。

---

## 8. 快速扫尾（1-2 发/项）

| 目标 | 实测 | 结论 |
|------|------|------|
| duck.ai 逆向现状 | `curl 'https://duckduckgo.com/duckchat/v1/status' -H 'x-vqd-accept: 1' -H UA` → **200 `{"status":"0","secondaryStatus":"0","statusV2":0}`** | x-vqd-4 握手通道仍活着；只记录不实现（chat 型，与我们通用搜索定位不合） |
| mcp.exa.ai 匿名 MCP | `POST /mcp` initialize → **200**，`serverInfo:{"name":"exa-search-server","version":"3.2.1"}`，capabilities tools/prompts/resources | **匿名 MCP 仍可用**（配额未公布）；可作为有 key exa 之外的白嫖通道，流式 SSE 响应 |
| alexandria.org | curl **DNS 解析失败**（Could not resolve host） | 已死，排除 |
| stract.com | `/search?q=` → 404 | 无公开免 key JSON API，排除 |
| presearch | 未测（无已知公开免 key API，需账号/钱包体系） | 排除 |

---

## 进池优先级排序

| 端点 | 判定 | 理由 |
|------|------|------|
| **wikipedia**（REST v1 或 Action API） | **必进（默认池）** | 403 之谜=UA 问题，改 DEFAULT_UA 即通；h1.1/h2 全通；知识类查询刚需 |
| **arxiv** | **必进（垂直）** | 免 key、字段全、论文检索刚需；只需 governor 3s 间隔 + 429 退避 |
| **crossref** | **必进（垂直）** | 免 key、被引数排序是权威性硬信号；snippet 带 author/期刊 |
| **marginalia(api2)** | **必进（迁移）** | 现 provider 用的旧端点在慢性死亡；api2 + `API-Key: public` 已实测（429 是配额问题不是封禁） |
| **googlenews** | 可进（新闻垂直，默认关） | 免 key 参数全、when:/site: 实测有效；版权条款限个人非商业渲染，默认不开，显式引擎时用 |
| **mwmbl** | 可进（备胎） | 活着但结果偏少偏词典向，做 marginalia 熔断替补 |
| **openverse 增强**（license 透传） | 可进（增强，已在池） | 端点健康，20/min+200/day 配额需 governor 接管 |
| hn / bingrss（现有） | 保持 | 无新问题 |
| duck.ai / mcp.exa.ai 匿名 | 不进（记录） | duck.ai 是 chat 通道；exa 匿名 MCP 可作旁路情报留档，协议是 MCP 非 JSON，暂不合 provider 模型 |
| alexandria / stract / presearch | 不进 | 已死/无公开 API |
| bing news rss | 不进（暂缓） | 每查询仅 ~4 条，信息量太低；googlenews 覆盖同样需求 |

### 立即可做的三个代码动作（给 main agent）

1. `core/src/config.ts:62` 改 `DEFAULT_UA`（假 Chrome → 带项目 URL 的规范 UA），同步更新 `keyless-apis.ts:149-152` 误诊注释，wikipedia 恢复默认池。
2. marginalia provider 迁 `api2.marginalia-search.com`（header `API-Key`，默认 `public`，支持 env 覆盖），旧端点降级 fallback。
3. 新增 arxiv / crossref / googlenews（可选 mwmbl）provider —— 全部是纯 HTTP + 结构化解析，照现有 keyless-apis 模板即可。
