# Perplexica · 工作流与架构

> **一句话**：最完整的开源 Perplexity 克隆，一个 Next.js 服务搞定。v1.x 从"固定流水线"重构成了真 agent——对我们要做的东西来说，它是"最贴近的起点形态"，它的每个坑都是我们的前车之鉴。

## 背景

开源（MIT），SearXNG 做检索底座。单进程 Next.js（前端+后端一体），外挂 SearXNG 容器和一个按需启动的 Chromium。分析的是 v1.12.2（上游已改名 Vane）。

## 工作流三段式

```
1. classify（分类，一次 LLM 调用）
   同时判断：要不要搜索（闲聊/个人问题不用搜）+ 学术吗 + 需要什么小组件
   （天气/股价/计算）+ 顺带把对话里的指代消解掉（"它们怎么工作" → "XX 怎么工作"）
   不确定时默认"要搜"——安全默认值
2. researcher（研究 agent，ReAct 循环）
   持有 6 个工具：web_search / academic_search / social_search /
   scrape_url / uploads_search / done
   三档预算：speed 最多 2 轮 / balanced 6 轮 / quality 25 轮
   每轮系统提示词重新生成，注入"当前第 i/max 轮"和日期
3. writer（写作）
   把检索结果包成 XML（<search_results><result index=N>...），
   小组件结果单独标注"不许当引用来源"
```

## 两个取巧的设计

1. **`__reasoning_preamble` 伪工具**：给不支持"可见思考"的模型准备——一个伪装成工具的"计划陈述"，输出直接显示在 UI 的研究过程时间线里。非 reasoning 模型也能有"可见的思考"。
2. **结构化 Block 流 + JSON Patch**：SSE 不是逐 token 文本，而是"块"（text/source/widget/research 四种），每次变更发 JSON Patch 只传差异。研究过程时间线（搜索中 → 读网页 → 出结果）就是靠 research block 的 subSteps 更新实现的。**做搜索 UI 想展示过程，这个协议可以直接抄。**

## 模型路由（反面样本：完全没有）

整个应用只用用户选的一个 chat 模型 + 一个 embedding 模型：分类、研究、挑选、提炼、写作全走同一个模型。对比 Grok/Antigravity 的分任务路由，Perplexica 选择了"零路由逻辑"——自部署产品让用户自己权衡。对我们来说这是反面教材：**小模型干脏活的路由收益是实打实的**。

## 反面教材清单（每一条都是我们要避免的）

1. **主链路裸奔**：`searchAsync` 整个函数没有 try/catch——SearXNG 超时的错误会变成未处理异常，SSE 流静默挂死，连 error 事件都不发。（讽刺的是另一个较老的入口反而有 catch——重构时把健壮性弄丢了。）
2. **没有任何缓存**：搜索结果、页面抓取、embedding 全不缓存。SearXNG 的浏览器单例是唯一的"缓存"（省的是启动开销）。
3. **quality 模式上下文无预算**：25 轮 × 每轮 3 个查询的结果全部堆进写作模型，作者自己被爆过窗口（commit 信息写着 prevent context overflow），但补丁只覆盖了一个工具。
4. **snippet-only 判断会被 SEO 垃圾页骗**：speed 模式只用摘要判断相关性，没有内容级验证。

## 值得我们抄的清单

| 抄什么 | 为什么 |
|--------|--------|
| classify 一次调用（路由+重写+小组件判断） | 首 token 前只有 1 次 LLM 调用，延迟省一半 |
| Block + JSON Patch 的 SSE 协议 | 研究过程可视化不用自研协议 |
| `<result index=N>` → prompt 要求 `[n]` → 前端正则替换 | 引用三段式，零解析器（详见搜索专题） |
| Playwright 惰性单例（30s 空闲自毁 + mutex 防并发启动） | 无头浏览器的标准管理姿势 |
| "不确定时默认要搜" | 安全默认值 |

## 证据指路

- 原始报告：`reports/12-perplexica.md`（§2 工作流 / §5 搜索 / §8 Findings）
- 硬证据：`analysis/perplexica/source/src/lib/agents/search/researcher/index.ts`（主循环 :14-183）、`session.ts`（Block 流）、`scraper.ts`（Playwright 管理）
