# 深度解剖: ddgs + MetaSearchMCP (Task 8-b)

> 两个 P0 必读目标的源码级精读, 接续 Task 7 扫库结论 (docs/targets-search.md)。
> 版本: ddgs @ 70a5635 (v9.16.0, 2026-08-27) / MetaSearchMCP @ 078f9cf (2026-09-02)。
> 方法: git clone --depth 50 到 /tmp/, 所有引用标注 `路径:行号`, 片段为研究用途引用。
> 自家对照物: `core/src/fusion.ts` (RRF) / `core/src/engine.ts` (8 引擎) / `core/src/mcp.ts`。

---

# 第一节 ddgs (deedy5/ddgs, 2.9k★, MIT, Python)

## 一句话总结

ddgs 9.x 已经从"DDG 单引擎爬虫"进化成 **10 后端元搜索编排器**——它的核心资产不是某个引擎的选择器, 而是"**每次请求随机浏览器指纹 + 按 provider 去重并发 + 词频聚合 + 分桶重排**"这套免 key 活下来的打法; TS 侧抄不了 primp 这个库, 但每一层都有现成替代。

## 机制拆解

### 1. TLS 指纹伪装: 一行配置, 全靠 primp (http_client.py 全文只有 79 行)

整个 HTTP 层薄到离谱——`ddgs/http_client.py:53-60`:

```python
# 研究用途引用: ddgs/http_client.py:53-60
self.client = primp.Client(
    proxy=proxy,
    timeout=timeout,
    impersonate="random",      # ← 核心: 随机浏览器 TLS/JA3/HTTP2 指纹
    impersonate_os="random",   # ← 随机操作系统 (UA 与 Sec-CH-UA 一致)
    verify=verify if isinstance(verify, bool) else True,
    ca_cert_file=verify if isinstance(verify, str) else None,
)
```

关键认知:

- **primp 是 Rust 写的浏览器伪装客户端** (reqwest 系), `impersonate` 参数让它把 Chrome/Safari/Edge/Firefox 的完整 TLS ClientHello (JA3/JA4)、HTTP/2 帧指纹、请求头顺序一次性模仿到位。`"random"` = 每个实例随机挑一个浏览器 profile。**没有自定义指纹列表, 没有轮换调度, 就是掷骰子**。
- **指纹粒度 = 引擎实例**: `base.py:35-37` 里每个引擎类 `__init__` 都 `HttpClient(...)` 自建 client, 所以同一次搜索里 DDG 用 Chrome 指纹、Mojeek 用 Firefox 指纹——粒度天然分散, 不需要额外轮换器。
- **对 202 空页/403 的处理 = 没有**。Task 7 扫库实锤过 "DDG 按 JA3 指纹封客户端返回 202 空页", 但 9.16.0 里 grep 不到任何 202/403 检测或重试代码 (全库只命中 3 处 `impersonate` 见 grep 证据)。它的策略是**纯前置防御**: `base.py:65-70` 状态码非 200 直接返回 `None`:

```python
# 研究用途引用: ddgs/base.py:65-70
def request(self, *args, **kwargs) -> Any:
    resp = self.http_client.request(*args, **kwargs)
    if resp.status_code == 200:
        return resp.text
    return None
```

  失败后**不做单引擎重试**, 而是靠编排层兜底: 多引擎并发 + provider 去重 (见下节), 一个引擎被封其它引擎照常出结果; 全灭时才抛 `DDGSException` (`ddgs.py:221-223`)。唯一"重试"是外层 `wait(futures, timeout=self._timeout, return_when="FIRST_EXCEPTION")` 的批量收割——慢引擎自然被下一轮收割逻辑捡走。

### 2. 10 后端与 backend=auto 切换

**后端名单** (engines/__init__.py 自动发现 + `ddgs.py:88-98`): text 类 10 个 = `bing`(默认禁用) / `brave` / `duckduckgo` / `google` / `grokipedia` / `mojeek` / `startpage` / `yandex`(默认禁用) / `yahoo` / `wikipedia`。registry 是**包扫描自动注册** (`engines/__init__.py:68-91`: 扫子模块 → 找 BaseSearchEngine 子类 → `disabled=True` 剔除), 加新引擎=加一个文件, 零注册代码——这个插件模式直接可抄。

**auto 的选择与降级** (`ddgs.py:88-133`) 三步走:

1. **洗牌 + 置顶权威源**: `shuffle(engine_keys)` 后把 wikipedia/grokipedia 排最前 (`ddgs.py:92-96`), 然后 `instances.sort(key=lambda e: (e.priority, random), reverse=True)`——wikipedia priority=2, grokipedia=1.9, 其余全 1, 所以随机顺序里权威源永远最先发车。
2. **provider 去重**: 每个引擎声明 `provider` 字段 (ddg/bing/yahoo 都=`"bing"`, startpage=`"google"`, `engines/*.py` 各文件头部)。`ddgs.py:173-184` 的线程池按 `len({engine.provider})` 定并发数, 提交前查 `seen_providers`, 已有同 provider 成功就跳过后续同源引擎——**auto 实际语义是"每家上游只打一个口子, 打哪个随机"**。这也是它过 DDG 封锁的实际手段之一: DDG 被封了 Yahoo/Bing 出来的还是同源结果。
3. **早停**: `ddgs.py:210-211` `if max_results and len(results_aggregator) >= max_results: break`, 凑够就不再给后面的引擎发车。

**每后端打哪个端点** (全部纯 HTTP, 无 JS 渲染):

| 后端 | 端点/方法 | 形态 | 备注 (行号) |
|---|---|---|---|
| duckduckgo | `html.duckduckgo.com/html/` POST | HTML | 结果过滤 `y.js?` 广告跳转 (`duckduckgo.py:17,42`) |
| bing | `bing.com/search` GET | HTML | **`disabled=True`** (`bing.py:34`), base64 解 `ck/a` 跳转链 (`bing.py:13-28`) |
| yahoo | `search.yahoo.com/search;_ylt=<随机token>;_ylu=<随机token>` GET | HTML | URL 里塞随机 token 当"会话" (`yahoo.py:45-47`), `/RU=` 解跳转 (`yahoo.py:12-15`) |
| google | `google.com/wml/search` GET | WML(旧移动版) | **Nokia N72 老式 UA 随机化** (`google.py:13-20`) + `CONSENT=YES+` cookie (`google.py:51`) + `pre_process_html` 截断 `?>` 前 WML 头 (`google.py:68-70`) |
| brave | `search.brave.com/search` GET | HTML | region 走 cookie, `tf=pd/pw/pm/py` 时间过滤 (`brave.py:39-44`) |
| mojeek | `mojeek.com/search` GET | HTML | region 走 `arc/lb` cookie (`mojeek.py:38-42`) |
| startpage | `startpage.com/sp/search` POST | HTML | **两段式**: 先 GET 首页抓表单 `sc` 字段再 POST (`startpage.py:31-37`) |
| wikipedia | `{lang}.wikipedia.org/w/api.php` GET | JSON API | opensearch 出标题 + 二次请求拿正文 extract, "may refer to:" 消歧页丢弃 (`wikipedia.py:56-64`) |
| grokipedia | `grokipedia.com/api/typeahead` GET | JSON API | typeahead 端点当搜索用, priority 1.9 次席 (`grokipedia.py:21,19`) |
| yandex | `yandex.com/search/site/` GET | HTML | **`disabled=True`** (`yandex.py:16`) |

**图片/视频走 vqd token**: `duckduckgo_images.py:42-45` 先 GET 首页从 `vqd="..."` 正则抠 token (`utils.py:15-28` 三种引号形态兜底), 再拿 vqd 打 `/i.js` JSON——免费引擎的"隐形 API"通用套路。

### 3. 排序 = 词频共识 + SimpleFilterRanker 分桶 (两段式)

**第一段: ResultsAggregator 按出现频率排序** (`results.py:102-148`)。多引擎结果按 URL 去重 (image/url/href 字段), 同 URL 计数器 +1, `extract_dicts()` 按 **Counter 频次降序** 返回——"多个引擎都返回它"就是权威度信号, 和 MetaSearchMCP 的 consensus 本质同源, 但实现只有 40 行。同 URL 冲突时**保留 body 更长的那个** (`results.py:135-137`)。

**第二段: SimpleFilterRanker** (`similarity.py`, 全文 72 行) — wikipedia 置顶 + 词命中分桶:

```python
# 研究用途引用: ddgs/similarity.py:33-72 (节选)
def rank(self, docs, query):
    tokens = self._extract_tokens(query)   # \W+ 切词, 长度>=3
    wiki_hits, both, title_only, body_only, neither = [], [], [], [], []
    for doc in docs:
        href, title = doc.get("href",""), doc.get("title","")
        body = doc.get("body", doc.get("description",""))
        if all(x in title for x in ["Category:", "Wikimedia"]):  # 权威源里的垃圾页
            continue
        if "wikipedia.org" in href:          # ① wikipedia 硬置顶
            wiki_hits.append(doc); continue
        hit_title = self._has_any_token(title, tokens)  # 子串匹配即可
        hit_body  = self._has_any_token(body, tokens)
        # ② 四桶: title+body > title-only > body-only > neither
        (both if hit_title and hit_body else title_only if hit_title
         else body_only if hit_body else neither).append(doc)
    return wiki_hits + both + title_only + body_only + neither
```

注意它和 MetaSearchMCP 的三处风格差异: ddgs 用**子串包含** (`tok in lower_text`, `similarity.py:28-31`) 不做词边界; 分桶是**序数桶**不是加权分; 桶内不排序 (保留词频序)。这招针对的是免 key 引擎的通病——snippet 里塞广告词/关键词堆砌, title 有命中比 body 有命中可信度高。

### 4. 四形态分发: 一份核心, 四张皮

同一 `DDGS` 类被四种入口包着, 代码组织一目了然:

| 形态 | 文件 | 依赖 | 关键设计 |
|---|---|---|---|
| Python lib | `ddgs/ddgs.py` (272 行) | primp+lxml | 核心, 其余全是壳 |
| CLI | `ddgs/cli.py` (700 行) | click | TTY 自适应: 非 TTY 去色/去交互停顿 (`cli.py:74-98`), **专为 agent 子进程调用设计**; 支持 `-o out.json/csv`、图片批量下载、`ddgs api -d/-s` 守护进程管理 (`~/.cache/ddgs/api.pid`, `cli.py:21`) |
| API server | `ddgs/api_server/api.py` (455 行) | fastapi+pydantic | 请求模型 pydantic 化; **DDGS_PROXY 环境变量统一代理配置** (`api.py:38-40`) |
| MCP server | `ddgs/api_server/mcp.py` (246 行) | mcp | 6 个工具 = 5 类搜索 + extract_content, 同步库用 `asyncio.to_thread` 包成异步工具 (`mcp.py:44-54`) |
| (第五形态) | `skills/ddgs/SKILL.md` | 无 | **作者自己写 SKILL.md 给 agent 用**, 参数速查表 + 调用范式 (SKILL.md:111-140) |

pyproject.toml 里四形态靠 extras 拆依赖: `[project.scripts] ddgs = "ddgs.cli:safe_entry_point"`, `mcp = ["mcp>=2.0"]`, `api = ["fastapi..."]`——核心零重依赖, 外壳按需装。**这正是 search-core 的分发路线** (我们已有 CLI/MCP/REST, 差 SKILL.md 出口)。

### 5. 每后端解析选择器 + 健康处理速查

统一解析框架在 `base.py:77-97`: `items_xpath` 定位结果块 → `elements_xpath` 抠 title/href/body → `post_extract_results` 清广告/解跳转。各家选择器:

- **DDG html**: 块=`//div[contains(@class,'body')]`, title=`.//h2//text()`, 过滤 `y.js` 广告 (`duckduckgo.py:20-21,40-42`)
- **Google WML**: 块=`//div[./div[1]/a and ./div[2][table]]`, 解 `/url?q=` 跳转 (`google.py:34-39,76-77`)
- **Bing**: 块=`//li[contains(@class,'b_algo')]`, `u/a2` 前缀 base64 解链, `aclick` 广告剔除 (`bing.py:43-48,80-84`)
- **Yahoo**: 块=`//div[contains(@class,'relsrch')]`, `/RU=../RK=` unquote 解链 (`yahoo.py:28-33,55-63`)
- **Brave**: 块=`//div[@data-type='web']` (brave.py:20-25)
- **Mojeek**: 块=`//ul[contains(@class,'results')]/li`, body=`p[@class='s']` (mojeek.py:20-25)
- **Startpage**: 块=`//div[contains(@class,'result')][./a]` + Referer 头 (startpage.py:22-29)

健康处理全景: 非 200 → None → 引擎静默退出 (base.py:68-70); 单引擎异常 → `logger.info` 吞掉继续 (`ddgs.py:205-207`); 全灭 → 最后一个异常转 TimeoutException/DDGSException (`ddgs.py:221-223`); 无效 backend 名 → warning + 可用列表提示 (`ddgs.py:108-113`)。**没有熔断器、没有健康统计、没有重试**——它把容错完全外包给"多引擎冗余"。

## 「可直接抄清单」(ddgs → search-core)

1. **引擎实例级随机指纹**: 每引擎实例随机选一个浏览器 profile (TS 侧见下节落地方案), 而不是进程级固定 UA。
2. **provider 去重 + 随机洗牌发车**: 同源引擎 (如 DDG/Yahoo/Bing 都吃 Bing 索引) 一次搜索只打一个, 随机决定打哪个——降封禁面, 降延迟。
3. **自动注册引擎 registry**: 目录扫描/文件约定式注册, 新引擎零侵入; 我们 engine.ts 现在是手工表, 可改成 `engines/*.ts` 自发现。
4. **词频共识排序**: `Counter.most_common()` 式的"出现次数降序"作为融合前置序, 40 行实现, 比纯 RRF 多一个"跨引擎佐证"信号。
5. **同 URL 冲突保留 body 更长者**: 融合去重时的字段级择优 (fusion.ts 已做 snippet 择优, 补 title/date 同规则)。
6. **SimpleFilterRanker 四桶**: title+body 命中 > title 命中 > body 命中 > 全不命中, 作为 RRF 之后的稳定器 (比加权打分更抗 snippet 噪音)。
7. **wikipedia/grokipedia 硬置顶 + 权威源 priority 字段**: `priority=2` 直接决定发车顺序, 不参与打分。
8. **权威源垃圾页黑名单**: `"Category:" && "Wikimedia" in title` 直接丢——我们接 wikipedia API 时同样会遇到。
9. **免费引擎"隐形 API"两段式**: 先拿页面/表单 token (vqd/sc) 再打 JSON 端点; Yahoo URL 里塞随机 token 伪装会话 (`yahoo.py:45-47`) 值得照抄。
10. **CLI 的 agent 适配**: 非 TTY 自动去交互/去色; `ddgs api -d/-s` + pid 文件的守护进程模式; **仓库自带 SKILL.md**——我们 P2 计划的 SKILL.md 出口照这个格式写。
11. **结果分类分端点**: text/images/news/videos/books 各一个方法 + 各自引擎集 (auto 只在同类内选)。
12. **异常分层**: TimeoutException 独立类型, 全灭才报错, 单引擎失败静默降级。

## 「TS 侧落地方案」(primp 思路怎么搬)

primp 的能力拆开是三件事: TLS ClientHello 指纹、HTTP/2 帧指纹、浏览器头序。TS 生态对应物按"保真度/维护成本"排:

| 方案 | 对应能力 | 代价 | 建议 |
|---|---|---|---|
| **undici + 头池轮换** (现状) | 只有头, TLS 指纹是 Node 的 | 零依赖 | 保底; 对 Mojeek/Wikipedia/Openverse 这类不做 TLS 指纹检测的源够用 |
| **got-scraping** (Apify) | 头生成器 (browser-generator) + TLS 指纹定制的 headerGenerator + HTTP/2 | 1 依赖, 活跃 | **首选**: `headerGeneratorOptions` 随机浏览器+OS, 与 primp `impersonate=random` 语义最接近 |
| **curl-impersonate 子进程** | 完整 Chrome/Safari TLS+HTTP2 指纹 | 需自带二进制, spawn 开销 | 打 DDG html / Google / Brave 这类强指纹封锁源时用; 封装成 `TlsTransport` 单点替换 |
| **cycletls / tls-client (bogdanfinn) Node 绑定** | 同上, 进程内 | 原生/WASM 依赖, 维护风险 | 备选, 免 key 库慎用原生依赖 |

落地三步 (对应 v0-spec Provider 层):
1. `http.ts` 抽 `Transport` 接口, 默认 undici; 引擎元数据加 `tlsSensitivity: "low"|"high"`, high 的走 got-scraping/curl-impersonate。
2. 每引擎实例创建时 `pickFingerprint()` 随机 (浏览器×OS), UA/Sec-CH-UA/Accept-Language 三者联动 (照抄 primp `impersonate_os=random` 的一致性思路)。
3. **不做被动 202 探测** (ddgs 也没有): 非 200 直接熔断该引擎本次搜索, 靠 provider 去重+多引擎冗余兜底; 只在 engine health 统计里记 `blockedRate` 供路由降权 (我们 router.ts 已有熔断, 补 blocked 信号即可)。

---

# 第二节 MetaSearchMCP (gefsikatsinelou/MetaSearchMCP, 54★/371c, MIT, Python)

## 一句话总结

一个"MCP 优先"的 80+ provider 元搜索后端——**引擎扩展性是假象, 真正值钱的是它的排序启发式 (consensus×2.0 + 词命中×1.0)、URL 归一化清单、Google 直抓手法、以及"tag 分域 MCP 工具 + 元工具自省"这套面向 agent 的接口设计**。

## 机制拆解

### 1. ranking.py 全文解剖 (148 行, opt-in)

架构位置: `orchestrator.py:176-187` 并发收齐所有 provider 结果后, 若 `RANK_RESULTS=true` 走 `rank_and_dedup_results`, 否则走普通去重 (`collapse_duplicate_hits`)。**默认关闭** (`config.py:71`), 为的是默认保持 provider 优先级顺序。

**URL 归一化清单** (`merge.py:12-65`) — 去重键的构造:

```python
# 研究用途引用: merge.py:12-25, 55-63 (节选)
_TRACKING_QUERY_KEYS = {
    "dclid","fbclid","gclid","gclsrc","igshid","mc_cid","mc_eid",
    "mkt_tok","msclkid","ref_src","twclid","yclid",   # 注释逐个标了来源
}
def canonicalize_url(url):
    parsed = urlparse(url.strip().lower())          # 整体小写
    netloc = _drop_default_port(...)                # 去 :80/:443
    path = parsed.path.rstrip("/") or "/"           # 去尾斜杠
    query = _normalize_query(parsed.query)          # 去 utm_*/追踪参数 + 键小写 + 键值对排序
    return urlunparse(("", netloc, path, parsed.params, query, ""))  # 去 fragment
```

**打分公式** (`ranking.py:41-44, 68-78`):

```python
# 研究用途引用: ranking.py:36-44, 68-78
_WORD_BOUNDARY_RE = re.compile(r"[^\w-]+")     # 词边界切分 (保留连字符词)
_CONSENSUS_WEIGHT = 2.0                        # 每个 provider 佐证 +2.0
_TERM_WEIGHT = 1.0                             # 每个查询词在 title/url 全词命中 +1.0

def _hit_score(hit, consensus, query_terms) -> float:
    score = float(consensus) * _CONSENSUS_WEIGHT
    text = f"{hit.title}\n{hit.url}"           # 只看 title 和 URL, 不看 snippet!
    tokens = _tokenize(text)
    score += len(tokens & query_terms) * _TERM_WEIGHT
    return score
```

三个精确语义 (写报告前逐行核实过):

- **consensus = 原始 hit 计数**: `count_consensus` 对归一化 URL 做 Counter, 同一 provider 返回两次同 URL 也计 2 (docstring 明说"intentional", 实践中 provider 每个 URL 只返回一次, `ranking.py:52-65`)。consensus 无封顶, 2 个 provider 命中就是 +4, 直接压过 4 个词命中。
- **词命中是全词匹配**: `[^\w-]+` 切词后做集合交集, 查 "react" 不会命中 "reactive" (`ranking.py:34-35` 注释)。**命中面 = title + URL 文本, 不含 snippet**——snippet 是各引擎截断产物, 噪音大, 这是和 ddgs (title+body) 的关键取舍差。
- **tie-break = 输入顺序** (`ranking.py:108-115`): sort key 是 `(-score, 原始索引)`, 稳定排序保证"provider 优先级顺序"永远兜底——高分打不上去的时候, 排第一的 provider 的结果永不沉底。

对比小结表 (供 fusion 对比节用):

| | MetaSearchMCP | 我们 fusion.ts | ddgs |
|---|---|---|---|
| 分数 | `consensus×2.0 + termHits×1.0` | `rrf×10 + lex×1.5 + 多引擎bonus 0.02×(n-1)` | 频次排序 + 四桶 |
| 词匹配 | 全词, title+URL, CJK 不友好 (`\w` 不覆盖汉字) | 分词含 CJK, title 2 倍权, 命中**比例**归一 | 子串, title/body 分桶 |
| 共识 | 绝对计数, 权重 2.0 | RRF 隐含 + 显式 bonus 0.02 | 词频主序 |
| tie-break | 原始顺序 (provider 优先级) | score 相等按插入序 (Map 迭代序) | 桶内保序 |
| 归一化 | 小写+去端口+去 utm_*+12 个追踪参数+**query 排序**+去尾斜杠 | 去 utm_*/ref_*/fbclid/gclid/igshid/mc_*+hash+尾斜杠, **不排序 query 参数** | 仅 unquote+空格替换 |
| 其他信号 | 无 (零网络零 embedding) | embedding 双阈值 (0.75/0.5) | body 长度择优 |

**我们比它强的**: RRF 有"排名质量"概念 (第 1 名 > 第 5 名, MetaSearchMCP 完全不知道排名), 词命中归一化成比例 (0~1) 不会因长查询爆炸, embedding 去重是它没有的维度。**它比我们强的**: query 参数排序归一 (跨引擎更易合并)、词匹配全词化 (少误伤)、tie-break 显式保 provider 优先级。

### 2. 80+ provider 目录: 数据结构 = "类即条目"

113 个 provider 文件, 每个是一个 ~60-280 行的类, **没有集中式目录表/JSON 配置**。条目元数据 = 类属性 (`providers/base.py:24-52` + 各 provider):

```python
# 研究用途引用: providers/base.py:27-30 + google.py:43-49
class BaseProvider(ABC):
    name: str = ""                       # 唯一键: "google"
    description: str = ""                # 一句话
    tags: ClassVar[list[str]] = []       # ["google","web"] ← 分域路由的载体

class GoogleProvider(BaseProvider):
    name = "google"; tags = ["google", "web"]
    def is_available(self):              # 健康闸门: 缺 key / 不稳定开关
        return get_settings().allow_unstable_providers
```

注册表 `_ALL_PROVIDER_CLASSES` 是**有序数组** (`registry.py:136-270`), 顺序即优先级——"注释分组 + 排前面优先" (`registry.py:134-135`: earlier providers take priority in dedup)。构建时过两道闸: `is_available()` False 剔除 + `ENABLED_PROVIDERS` 白名单过滤 (`registry.py:273-292`)。

README 里那张 80+ 行的表 (README.md:48-223) 才是**人类可读目录**, 每条目: `Provider | Name | Method`(HTML scraping/Official API/RSS/Public JSON API) + 不稳定标记 ("best effort") + key 列 (README.md:213-223 Finance 表直接三列: key/free tier)。`list_providers` MCP 工具回的 name/description/tags 就是类属性的运行时投影 (`broker.py:494-514`)。

**接法分类** (从 README 表归纳, 建我们 engines.md 直接用): `官方API(需key)` / `官方API(免key)` / `公开JSON API` / `HTML抓取(浏览器头)` / `RSS` / `隐形API(内部XHR)` 六类; 封锁风险 = `allow_unstable_providers` 开关兜底 (Google/Yahoo/SEC EDGAR 都挂 unstable)。

### 3. Google 直抓手法 (providers/google.py, 226 行)

五件套, 每件都有行号可查:

1. **consent cookie**: `cookies = {"CONSENT": "YES+"}` 绕欧盟同意墙 (`google.py:85`)。
2. **locale 参数全量**: `hl`(界面语言) + `lr`(结果语言) + `gl`(国家) + `ie/oe=utf8` + `filter=0` 去.omitted, 分页用 `start` (`google.py:74-84`)。
3. **locale 感知的确定性伪随机 UA**: 不用真随机, 用 locale 字符串的字符和 mod 17 生成 Chrome 补丁号——同 locale 恒定同 UA, 多次搜索看起来是同一台设备 (`google.py:57-68`):

```python
# 研究用途引用: google.py:60-68
chrome_patch = _UA_CHROME_PATCH_BASE + (
    (sum(ord(char) for char in locale_suffix) % _UA_CHROME_PATCH_MOD) + 1
)
return ("Mozilla/5.0 (Linux; Android 5.0; SM-G900P Build/LRX21T) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        f"Chrome/39.0.2374.{chrome_patch} Mobile Safari/537.36 "
        f"NSTNWV {locale_suffix}")
```

4. **封锁探测**: URL 落到 `/sorry/` 或正文含 "unusual traffic" 即抛 "rejected as automated traffic" (`google.py:104-109`)——纯响应面检测, 没有重试, 直接降级到 serpbase/serper 链 (`broker.py:421-449` search_google 的 pick_first_provider 顺序: google → google_serpbase → google_serper)。
5. **多套备用选择器**: 容器 `div.g, div.Gx5Zad, div.MjjYud` 三连; snippet 五连 (`VwiC3b/yXK7lf/s3v9rd/aCOpRe/data-sncf`); 答案盒四连 (`google.py:18-30,118`)。还带 related_searches 和 answer_box 抽取 (`google.py:192-221`)。

配套单引擎手法: **Yahoo 走 `sB` cookie 携带 safe-search+语言** (`yahoo.py:124-137` 构造 `v=1&vm=i&fl=1&vl=lang_zh&pn=10...` 串) + 按国家换子域 + `/RU=` 解链; **Bing 不抓 HTML, 直接打 `search?q=..&format=rss`** (`bing.py:1-47`)——RSS 天然无封锁, 这条对我们 8 引擎池是零成本加强。

### 4. 14 个 MCP 工具的领域拆分 + 元工具设计

工具清单 (`broker.py:49-62`): `search_web / search_google / search_academic / search_github / compare_engines / search_finance / search_code / search_news / search_social / search_images / search_videos / search_bio / list_providers / provider_health`。

拆分逻辑值得注意——**不是按引擎分, 而是按"agent 任务领域"分**:

- 12 个搜索工具里 10 个是 `_run_tagged_search(query, options, tag, error_msg)` 的**同一泛型壳** (`broker.py:369-379`): tag=`academic/finance/code/news/social/image/video/bio`, 从 catalog 按 tag 过滤 → 跑 `run_search_plan`。**领域工具=tag 过滤的语法糖**, 零额外代码。
- 两个特例: `search_google` 带 provider 级 fallback 链 (direct→serpbase→serper, `broker.py:421-449`); `compare_engines` 对每个 provider **单独各跑一次**再按引擎分组返回 (`broker.py:452-491`), 给 agent 做"哪家结果好"的对照实验。
- **两个元工具是设计亮点**:
  - `list_providers(tag?)` (`broker.py:494-514`): 回 name/description/tags + count。agent 拿到工具列表后先调它自省, 再决定 search_web 的 `providers`/`tags` 参数——相当于把 prompt 里的引擎说明书变成运行时查询。
  - `provider_health(tag?)` (`broker.py:517-543`): 回 available/status/description, available 即 `is_available()` (缺 key=false)。**把"哪些引擎此刻能用"做成工具而不是文档**, 这是 MCP 侧的关键工程化。
- 共享 schema 片段复用: `_RESULT_COUNT_PROPERTIES`/`_SAFE_SEARCH_PROPERTY` 常量注入所有工具的 inputSchema (`broker.py:64-87`); 工具名常量 + dispatch 表单一事实源防名字漂移 (`broker.py:47-62, 546-566`)。
- 错误语义: 工具内部异常不抛 MCP error, 而是 JSON `{"error": ..., "tool": ...}` 文本返回 (`broker.py:345-366`)——agent 能读错误并自适应。
- provider 执行元数据随结果回传: `ProviderReport {name, success, result_count, latency_ms, error}` + 顶层 `errors[]` (contracts.py:47-54, 132-143)——部分失败可观测, agent 知道哪路引擎空手而归。

### 5. 其它工程细节 (可对照我们的实现)

- 超时双层: per-provider `default_timeout=10` + 全局 `aggregator_timeout=15`, `asyncio.wait_for` 包裹 + 可选指数退避重试 (`orchestrator.py:26-62`, `config.py:62-63`)。
- 请求级 TTL 缓存: cache key = `query\x1fproviders\x1foptions` (provider **顺序敏感**, 因为去重优先级依赖顺序, `orchestrator.py:77-98`), TTL 300s, `/cache/stats` 暴露命中率。
- answer_box 只取第一个成功 provider 的 (orchestrator.py:165-166)——先到先得, 不冲突。
- snippet 统一截断 400 字符 (base.py:21), source 域名自动从 URL 派生 (contracts.py:30-35)。

## 「可直接抄清单」(MetaSearchMCP → search-core)

1. **URL 归一化补全**: query 参数**键值对排序** + 12 个具名追踪参数清单 (dclid/gclsrc/mkt_tok/msclkid/twclid/yclid/ref_src 是我们没有的) + 去默认端口——fusion.ts normalizeUrl 三行改动。
2. **共识 bonus 显式化**: 多引擎佐证给独立加分项 (我们已有 0.02 bonus, 它给了 2.0 量级的权重, 见 fusion 对比节的混合公式)。
3. **词命中全词化 + 不看 snippet**: 查询词对 title+URL 做**全词**命中计数, snippet 只做兜底——比我们的子串式更抗误伤 (保留 CJK 分词则两全)。
4. **tie-break 显式化**: 同分保 provider 优先级序 (排序 key 里放原始索引), 排序结果确定可复现。
5. **领域工具=tag 语法糖**: 12 个领域 MCP 工具共用一个 `_run_tagged_search` 壳——我们 mcp.ts 的 6 工具可以低成本扩成 search_code/search_academic 等, 参数表共享常量。
6. **list_providers / provider_health 元工具**: 把引擎目录和可用性做成运行时工具 (我们已有 providers 工具雏形, 补 is_available 健康态 + count/available_count 汇总)。
7. **compare_engines 对照工具**: 每 provider 单独一跑, 按引擎分组返回——调参/评测利器, 也给 agent "择优引擎"信号。
8. **Bing RSS 通道**: `bing.com/search?format=rss` 零封锁零解析成本, 直接进我们引擎池当 bing 的降级形态。
9. **Google 直抓五件套**: CONSENT cookie + hl/lr/gl 参数 + locale 确定性伪随机 UA + `/sorry/` 探测 + 多套备用 CSS 选择器 (google.py 五段代码全可搬)。
10. **Yahoo sB cookie 流**: safe-search/语言塞 cookie 而非参数 + 国家子域映射 (`yahoo.py:90-137`)。
11. **per-provider 执行元数据回传**: result_count/latency_ms/error 每路必报, agent 端可自解释部分失败。
12. **provider 条目统一接口**: name/description/tags/is_available 四件套 + 有序注册表=优先级——engines.md 的数据模型 + 我们 router 的排序依据。

## 「TS 侧落地方案」

1. **engines.md**: 照 README 表格式建 `docs/engines.md`, 列: name / 接法(六分类) / 是否 key / 免费额度 / 封锁风险(TLS 敏感度) / tags / 状态。数据模型对齐 provider 四件套, 让 engines.md 与 engine.ts 元数据同源生成 (脚本从 TS 导出)。
2. **mcp.ts v0.3**: 工具拆成 `search_<domain>` 系列 (tags 语法糖) + `compare_engines`; `providers` 工具升级成 list_providers+provider_health 双语义 (含 available 字段)。工具名进 name-boost 渐进披露 (沿用 [07] 结论)。
3. **新增 google 直抓引擎** (unstable 开关兜底, 默认关): 照抄 google.py 参数/cookie/UA 方案, 选择器用 cheerio 版三连容器+五连 snippet; 封锁探测挂 `blockedRate` 进 router 熔断。Bing RSS 一起上, 成本≈0。
4. **http.ts**: API 类源用 `User-Agent: search-core/x.y (+repo)` 风格 (MetaSearchMCP 的 API_USER_AGENT 惯例, base.py:16-18), 抓取类源用浏览器头池——双 UA 策略显式化。

---

# 第三节 Fusion 对比结论 (MetaSearchMCP 启发式 vs 我们 RRF)

## 逐项对照

| 维度 | MetaSearchMCP (`ranking.py`) | 我们 (`fusion.ts`) | 判定 |
|---|---|---|---|
| 排名位置信号 | ❌ 无 (不读 provider 内部 rank) | ✅ RRF `Σ1/(60+rank)` | **我们赢**——位置是最强相关性先验, 丢弃可惜 |
| 跨引擎共识 | ✅ `consensus×2.0` 绝对计数, 一个共识值 2.0 约等于 1 个词命中 | ⚠️ RRF 天然含共识 + 显式 bonus 仅 `0.02×(n-1)`, 几乎可忽略 | **它赢**——0.02 太抠, 8 引擎全中 +0.14 vs RRF 单命中 0.016, 量级倒是够, 但设计上没把"独立佐证"当一等公民 |
| 词命中 | ✅ 全词匹配 title+URL, 不看 snippet | ⚠️ 子串级, title 2x+snippet, 按比例归一 (0-1) | 各有胜负: 它抗误伤我们抗长度爆炸; snippet 是噪音源 (ddgs 同款认知), 但也是语义兜底 |
| 确定性 | ✅ 同分按输入序, 绝对稳定 | ⚠️ score 相等靠 Map 迭代序, 隐式 | 它赢 |
| 归一化 | ✅ query 参数排序 + 12 具名追踪参数 + 去端口 | ⚠️ 少参数排序/端口/部分参数 | 它赢 (改动成本 10 行) |
| 语义维度 | ❌ 无 | ✅ embedding 双阈值 (0.75 去重/0.5 过滤) | 我们赢 |
| 长尾引擎 | 频次低的永远垫底 (纯加法分) | RRF 保底分给每个单命中引擎 | 我们赢——新接引擎冷启动友好 |

## 建议: 保留 RRF 主体, 借 2 处混合 (不动 v0.2 契约)

**不要替换**——纯 consensus 加法分 (它的方案) 没有 rank 质量概念, 8 引擎池下会严重偏袒"被垃圾引擎也返回的页面"; 我们已有 embedding 层, 它没有。**混合公式** (在 `fusion.ts:95-100` 现有式子上改两个系数 + 一个排序键):

```
score = rrf×10                      // 主信号: 位置质量 (不动)
      + lex×1.5                     // 词法: 比例化 (不动)
      + consensusBonus              // 改: 0.02×(n-1) → 0.35×(n-1), 上限 3 路
                                    //   理由: 3 家独立引擎佐证应压过 1 家引擎的第 1 名
                                    //   (1/(60+1)×10≈0.164), 0.35×2=0.7 恰好做到; 不取 2.0
                                    //   是因为我们的 lex 已是 0-1 比例, 不像它 termHits 无上限
      + exactTitleBonus 0.25        // 新 (MetaSearchMCP 启发): 查询词全词命中 title 加一次
                                    //   独立小分, 全词匹配防 "react"→"reactive" 误伤
sort key: [-score, minEngineRank]    // 新: tie-break 显式化——同分时保首个命中引擎
                                    //   的原始排名序, 复现它 "provider 优先级永不沉底" 的稳定性
normalizeUrl: + query 参数键值对排序  // 新 (直接搬 merge.py:36-52): 12 个具名追踪参数补全
```

验收口径: `core/test` 加 3 个用例——同 URL 3 引擎命中应排到单引擎第 1 名之前; 全词命中 "react" 不得匹配 "reactive"; `?b=2&a=1` 与 `?a=1&b=2` 必须合并。

## 一句话版

> **不换**: MetaSearchMCP 的共识×2.0 是"无 rank 信号"的退而求其次, 我们的 RRF 已经覆盖它; 要抄的是它把共识当一等公民的权重意识 (0.02→0.35×(n-1) 上限 3)、全词命中 + 同分保引擎序的确定性, 以及 URL 归一化的参数排序补全——三处小改, RRF 主体不动。

---

## 附: 证据文件索引

| 主题 | 文件:行 |
|---|---|
| TLS 指纹 | ddgs/ddgs/http_client.py:53-60; cli.py:116 |
| auto 切换/provider 去重/早停 | ddgs/ddgs/ddgs.py:88-133, 173-223 |
| 词频聚合 | ddgs/ddgs/results.py:102-148 |
| SimpleFilterRanker | ddgs/ddgs/similarity.py:33-72 |
| 各引擎选择器 | ddgs/ddgs/engines/{duckduckgo,bing,yahoo,google,brave,mojeek,startpage,wikipedia,grokipedia,yandex}.py |
| 四形态 | ddgs/ddgs/{cli.py, api_server/api.py, api_server/mcp.py}; skills/ddgs/SKILL.md; pyproject.toml |
| ranking 全文 | MetaSearchMCP/metasearchmcp/ranking.py:1-148 |
| URL 归一化 | MetaSearchMCP/metasearchmcp/merge.py:12-65 |
| provider 目录/注册表 | MetaSearchMCP/metasearchmcp/providers/{base.py:24-52, registry.py:136-292}; README.md:48-223 |
| Google 直抓 | MetaSearchMCP/metasearchmcp/providers/google.py:16-226 |
| Bing RSS / Yahoo cookie | MetaSearchMCP/metasearchmcp/providers/{bing.py:1-47, yahoo.py:80-198} |
| 14 工具/元工具 | MetaSearchMCP/metasearchmcp/broker.py:44-87, 369-543, 546-566 |
| 编排/缓存/契约 | MetaSearchMCP/metasearchmcp/{orchestrator.py:26-205, config.py:37-116, contracts.py:18-153} |
| 自家对照 | core/src/fusion.ts:15-31, 65-107; core/src/engine.ts; core/src/mcp.ts |
