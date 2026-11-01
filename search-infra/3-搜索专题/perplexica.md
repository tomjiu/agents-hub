# Perplexica · 搜索专题

> **一句话**：做"免费可自部署的搜索产品"的最佳参考：SearXNG 一个参数搞定多引擎、一次 classify 调用完成路由+改写、embedding 双阈值替代昂贵的 rerank 模型、引用三段式零解析器——但它也从反面证明了"没有缓存的搜索产品"有多伤。

## SearXNG 的标准用法（67 行客户端）

SearXNG 是一个自托管的"元搜索引擎"（帮你并发调 Google/Bing/DDG 然后聚合）。Perplexica 的接入就是一次 HTTP GET：

```
GET {searxng}/search?format=json
    &q={query}
    &engines=arxiv,google scholar,pubmed    ← 引擎选择就是一个参数！
    &language=&pageno=
超时 10 秒（AbortController）
```

**多引擎 = 一个 `engines=` CSV 参数，不同场景只换参数不换代码。** 学术搜索换学术引擎、讨论区搜索换 reddit、图片搜索换 bing images——全部是参数差异。

两个配套细节：SearXNG 配置必须开 `formats: [html, json]`；仓库自带 docker-compose + settings.yml，部署零配置。

## 一次 classify（路由+改写一石三鸟）

旧版要 2-3 次 LLM 调用（判断意图 + 改写 query）；新版一次 `generateObject` 同时输出：

1. 路由布尔组（要不要搜/是不是学术/要不要天气股价计算组件）；
2. **standalone 重写**：把对话指代消解掉（聊车时问"它们怎么工作" → "How do cars work?"）；
3. 组件触发。

重写结果不替换原 query 而是**拼接**：`原问句 (Standalone question: 重写后)`——原句保留语气，重写消解指代，两个都给模型。首 token 前只有 1 次调用，延迟省一半。

## embedding 双阈值（免 rerank 模型的相关性方案）

没有 cross-encoder rerank（贵、要专门模型），用两个余弦相似度阈值解决排序和去重：

```
> 0.5  保留（查询-结果片段的相关性过滤）
> 0.75 视为重复（结果之间的去重）
```

embedding 模型用用户选的那个（可以是 transformers.js 本地小模型——零 API key）。**实现 22 行（手写点积/范数）**，换来排序+去重+上传文档检索三个能力。

诚实成本：每条结果一次 embedding 推理（20 条 = 21 次），本地小模型够用，接大模型 provider 会很贵。

## 引用三段式（零解析器）

```
第 1 段：检索结果包成 <result index=N>（索引编进上下文）
第 2 段：prompt 要求回答里用 [n] 引用
第 3 段：前端一个正则 \[([^\]]+)\] 把 [n] 替换成 <citation href> 链接
```

没有 JSON 校验、没有流式解析，匹配不到就不替换（天然兜底）。还支持 `[1,2]` 多引用。**比结构化引用方案便宜且流式友好。**

## Playwright 惰性单例（无头浏览器标准管理）

30 秒空闲自动关浏览器 + mutex 保证并发请求不会启动多个 Chromium + userCount 归零才允许杀。三个时间参数（20s 导航 / 5s load / 500ms 沉降）都是经验值。抓取只取 textContent 不转 markdown——**对 LLM 消费，纯文本比 markdown 更省 token**。

## 反面教材（集中在它身上的三宗罪）

1. **`searchAsync` 无 try/catch**：SearXNG 10 秒超时 → unhandled rejection → SSE 流静默挂死。主链路必须每个 stage 都有 error 事件 + 降级路径。
2. **全程无缓存**：搜索结果、抓取、embedding 全不缓存。
3. **quality 模式无预算**：25 轮迭代结果全量堆进 writer，作者自己被爆过（commit 信息为证）。

## 值得我们抄的清单

| 抄什么 | 为什么 |
|--------|--------|
| SearXNG 标准姿势（engines 参数化 + settings.yml 随包） | 免费多引擎底座的最轻接入 |
| classify 单调用（路由+重写拼接） | 延迟减半 |
| embedding 双阈值（0.5/0.75） | 零 GPU 零 API 的过滤+去重 |
| 引用三段式（index → [n] → 正则） | 零解析器，流式友好 |
| 惰性单例 + 空闲自毁 | 浏览器池标准解 |
| "重写拼接不替换" | 消指代不丢原意 |

## 证据指路

- 原始报告：`reports/12-perplexica.md`（§5 搜索实现）
- 硬证据：`analysis/perplexica/source/src/lib/searxng.ts`（67 行全文）、`agents/search/researcher/actions/baseSearch.ts`（双阈值 :51-72、:134-158）、`classifier.ts`、`hooks/useChat.tsx`（引用正则 :335-380）
