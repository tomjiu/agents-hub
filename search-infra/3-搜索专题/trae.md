# Trae · 搜索专题

> **一句话**：Trae 的 web 搜索是"云端两步走"——第一步云端 API 只返回引用卡片（标题+链接+摘要），第二步客户端批量抓全文。**搜索的"智能"全在字节云端，但客户端这一半的纪律（黑名单、限额、小模型清洗、统一引用体系）全都可以抄。**

## 云端两步走（完整还原的流水线）

```
第 1 步：请求云端搜索 API（api/ide/v1/web_search）
         → 返回结构化引用（WebSearchReference：favicon/摘要/链接卡片）
         → 云端有 query_rewrite（查问句改写）和 context_select
           （"这次该带哪些结果"）两个小服务做预决策
第 2 步：客户端选出待抓取的 URL，批量抓全文（request_batch_fetch_content）
         → 走域名黑名单过滤（web_fetch_blocked_domains）
         → 抓取有策略路由（web_fetch_strategy，默认 Auto）
         → 抓到的小模型做正文抽取/清洗（失败才回退用搜索摘要）
第 3 步：结果以 <web_search_result no=N> 模板渲染进上下文（带序号方便引用）
```

**抓全文失败会降级用搜索摘要**——这是两步走设计的天然好处：搜索结果元数据和全文抓取解耦，后者挂了前者还有用。

## 内嵌的引擎清单（黑盒里的白盒线索）

DLL 里存着引擎枚举：`You / Toutiao / Volcengine / Doubao / Brave`——字节自家搜索栈（头条/火山/豆包）+ You.com + Brave。**引擎选择、融合、重排全在服务端黑盒里**，客户端连引擎名都只是枚举痕迹。strings 里完全没有 tavily/serpapi/searxng 等第三方服务的痕迹。

## 最有参考价值的理念：搜索结果 = 统一引用体系的一等公民

Trae 的上下文协议里，`web_search / web_page` 和 `file / symbol / folder / feishu_doc / figma / lint_error` 是**并列的引用类型**，走同一条 mention/attachment 渲染管线。

意义：搜索结果不是特殊东西，不需要单独的处理协议——引用编号、展示、跳转全部复用现有体系。**我们做 search-core 时，统一 Reference 结构（ref_id）的设计依据就在这里。**

## 本地代码搜索（顺带的高价值发现）

Trae 的代码搜索是"五级阶梯"，全部本地：

| 工具 | 后端 |
|------|------|
| 关键词搜索 / 正则搜索 | ripgrep |
| 查定义 / 查引用 | CKG 知识图谱（图查询） |
| 语义搜索（search_codebase） | CKG 向量（bge_m3 本地嵌入 + sqlite-vec 向量库 + 重排） |

技术配置实测可行：**bge_m3 本地嵌入 + sqlite-vec + 单核限制**就够 IDE 场景——这是闭源产品验证过的"零外部依赖本地语义搜索"完整蓝本。CKG 还兼作文档 RAG（内置 nuxt/shadcn/tailwind 等文档语料，甚至吃自家的 llms.txt）。

## 值得我们抄的清单

| 抄什么 | 为什么 |
|--------|--------|
| 两步走（引用先行、抓取后置、抓取失败降级摘要） | 双预算池的雏形；抓取失败不白搜 |
| query_rewrite + context_select 小模型预决策 | "查什么/带什么"先让便宜模型过一遍（我们用规则+小模型混合实现） |
| 域名黑名单 + 抓取输出限额 | 直接可抄的抓取纪律 |
| 统一引用体系（ref_id） | 搜索结果挂进统一管线，引用三段式的基础 |
| sqlite-vec 本地向量配置 | 免 API 的语义搜索蓝本 |

## 别学的坑

- 搜索全押云端、无本地降级——云端挂了 web 搜索全灭。我们必须自持引擎。

## 证据指路

- 原始报告：`reports/05-trae-work.md`（§5.1 web 搜索 / §5.2 代码搜索）、`reports/06-trae-code.md`（§5 搜索实现：引擎枚举、WebFetch 小模型过滤）
- 硬证据：`analysis/trae-work-cn/notes/ai_agent.strings.txt`（SearchService 日志串、引擎枚举 "YouToutiaoVolcengineDoubaoBrave"）
