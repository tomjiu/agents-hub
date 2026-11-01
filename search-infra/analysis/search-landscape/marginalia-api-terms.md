# Marginalia API 口径 + 本地降级路线（phase X, 2026-09-03）

> 用户的三个问题：有限额吗？付费吗？有没有本地降级的？
> 本文全部结论来自官方文档实抄（about.marginalia-search.com/article/api，2025-12-08 更新版）
> + 当日真网络探针（curl 实测），无猜测成分。探针原始输出不入仓。

## 一句话结论

Marginalia 是**免 key 可用的独立索引搜索引擎**，公开体验键 `public` 全网共享限额（打满返 503），
免费正式键靠邮件申请（非商用 CC-BY-NC-SA），付费键**永远可选项**（跳队/商用）；
开源可自托管（重），官方还发爬取数据集——本地降级我们做四层，真到"API 全灭"也有兜底。
我们引擎里它是**冷门/独立站面的第一腿**（phase W 已入池），本批补了第二腿 wiby。

## API 两代端点（官方口径）

| | 新 API（推荐） | 旧 API（deprecated） |
|---|---|---|
| 基址 | `api2.marginalia-search.com/search?query=...` | `api.marginalia.nu/{key}/search/{query}` |
| 鉴权 | `API-Key` 请求头，每次都要 | key 在 URL 路径里 |
| 状态 | 现役，收新功能 | 官方原话"项目活多久它活多久"，但不再加功能 |
| 体验键 | `public`（不能建自定义过滤器，"often hits a rate limit"） | `public`（所有消费者**共享**限额，打满 HTTP 503） |

2026-09-03 探针：两代端点均实测 200 OK。`plan9 os` 这类冷门题返回的全是
unix stackexchange / suckless 邮件列表 / 个人博客——商业引擎不排面的冷门独立站，
坐实我们"补商业引擎缺口"的定位。

## 限额（诚实口径：只有共享键有公开数字线索）

- `public` 键：**全网所有消费者共享一个限额**，打满返 503（官方文档实抄）。
  具体每分钟几次官方不公布；创始人 Viktor Lofgren 2023-05 在 HN 提过"我记不清了(IIRC)大约 15 queries/minute，
  因为它只是个演示键"（新闻源：news.ycombinator.com/item?id=35871186，**非官方文档，量级仅供参考**）。
- 免费正式键（邮件申请）：独立限额（数额官方未公布），申请走邮件是为了防批量注册滥用。
- 付费键：独立限额，商业版按量计费。
- 我们的做法：默认 `public` + `SC_MARGINALIA_KEY` 槽位覆盖（keyless-apis.ts 已实现）；
  503 按可重试失败分类交熔断 2.0，冷却后自动回来；同池还有 10 条腿兜底。

## 付费吗？（三档，官方原文归纳）

| 档位 | 价格 | 条款 |
|---|---|---|
| **免费非商用** | 0（邮件申请） | CC-BY-NC-SA 4.0：**非商用**+署名+相同方式共享 |
| **付费非商用** | 一次性买断（跳过排队） | 同 CC-BY-NC-SA 4.0；官方明说"可选，且永远保持可选" |
| **商用** | 按量计费订阅（polar.sh/marginalia-search 管理面板） | 无商用限制、无署名要求；其他条款可邮件谈 |

⚠ **License 红线要记**：免key 路线返回的数据带 `license: "CC-BY-NC-SA 4.0"` 字段（响应里实测可见）。
我们的插件是研究/个人工具定位 = 非商用，OK；一旦要商用化，Marginalia 腿要么换商用键要么摘除。

## 有没有本地降级？（四层，前三层已在仓里）

1. **Provider 内降级**（已实现）：api2 主路 → 旧端点 fallback（同形 JSON，双挂才抛错，单测在案）。
2. **池层降级**（已实现）：mwmbl 做 Marginalia 熔断备胎（独立小索引，同样是冷门面）；熔断 2.0
   按失败分类差异化冷却，Marginalia 全灭时其余默认池 10 腿照常出结果。
3. **缓存层**（已实现）：FTS5 本地缓存，重复查询 0 网络往返（probe-mcp-real 实测冷 6.0s / 热 2ms）。
4. **终极兜底**（可选，未做也不建议现在做）：Marginalia 本身开源
   （github.com/MarginaliaSearch/MarginaliaSearch，Java 栈），官方 downloads.marginalia.nu 提供：
   - **Data Exports**：搜索引擎数据库导出（exports/ 目录）
   - **爬取样本四档**：1000 域/1.3GB、2000 域/2.6GB、5000 域/7.1GB、50000 域/81GB
   - **语言模型**：ngrams.bin 129MB / tfreq 411MB / fasttext lid 920KB
   自托管 = 完整爬虫+索引栈，官方自己说大样本要跑几小时——作为"本地降级"的**存在性证据**记档，
   真要做等有独立部署需求再立项（对桌面插件场景性价比低，诚实说不划算）。

## 我们的接入现状（keyless-apis.ts）

- provider `marginalia`：api2 主路（API-Key 头，`public` 默认 / `SC_MARGINALIA_KEY` 覆盖）
  → 旧端点 fallback → 双挂抛错交熔断；默认池 11 引擎之一。
- `dc=3`（本批新增）：官方参数"每域最多几条结果"，与 fuseSemantic 的 domainCap=3 对齐——
  源头多样，融合才有多样可保。
- 备胎 `mwmbl`、第二腿 `wiby`（本批新增，wiby.me JSON，Description 优先 Snippet 兜底+实体解码）。
- 限额口径详见 analysis/search-landscape/marginalia-api-terms.md（即本文）。

## 冷门面盘点（回答"自研引擎补了商业引擎哪些缺口"）

商业引擎（Google/Bing/DDG 通用结果）不排面的面，我们的牌：

| 冷门面 | 我们的腿 | 免 key 状态 |
|---|---|---|
| 独立索引/非商业网页 | marginalia（第一腿）+ mwmbl（备胎）+ wiby（第二腿，古典老网） | 全免 key |
| 技术论坛问答 | stackexchange（config.engines 可指名 170+ 子站） | 免 key 300/天，key 10000/天 |
| 技术社区讨论 | hn（Algolia API） | 免 key |
| 学术 | arxiv/crossref/openalex/dblp + authority 提权 16 域 | 全免 key |
| 包管理器 | crates/npm/packagist/rubygems（语言腿裁剪） | 全免 key |
| 开发资产 | dockerhub/huggingface | 全免 key |
| 实体/结构化知识 | wikipedia/wikidata | 全免 key |
| 图片(CC) | openverse | 免 key（20 次/分+200 次/天实测） |
| 时间机器 | wayback/wikirev | 免 key |
| 新闻时效 | googlenews（默认不进池，版权条款） | 免 key |

诚实边界：lobste.rs 沙箱 ETIMEDOUT（watchlist，未接）；reddit .json 403 反爬墙（诚实不接）；
中文冷门面仍是短板（智谱 key 候选在 f-keyed-apis-scan.md 挂账）。
