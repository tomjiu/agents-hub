# Codex · 搜索专题

> **一句话**：Codex 的 web 搜索也是纯托管（OpenAI 服务器执行，本地只有 30 行格式化代码），但它贡献了一个别人都没有的设计：**搜索权限分三档**——连"只许看已索引的缓存页面"这种企业级精细控制都做了。

## 托管搜索的本地真相

`core/src/web_search.rs` 全文 30 行——本地唯一做的事是把服务端回传的动作（`Search{query}` / `OpenPage{url}` / `FindInPage{url, pattern}`）格式化成 UI 进度文案。

这暴露了服务端在跑一个 **search → open_page → find_in_page 的小 agent**：搜到结果、打开网页、页内查找，编排完全在 OpenAI 的 API 内。与 Grok Build 结论完全一致（第三家验证）：**头部产品的搜索 agent 都藏在 LLM 服务端**。

## 三档搜索权限（本产品的独有贡献）

同一个 hosted 工具，按配置给不同档位：

| 档位 | 允许什么 | 适用场景 |
|------|---------|---------|
| **Cached** | 只能访问已索引的缓存页面 | 企业内控：外网不让碰，内部知识库可以 |
| **Indexed** | 外网 + 已索引 | 中间档 |
| **Live** | 完全开放 | 个人全功能 |

配套可配 `filters`（域名白/黑名单）、`user_location`（地域影响结果）、`search_context_size`（返回多长）。

比"开/关"二元的权限设计细得多——我们做多租户时这套档位直接可抄。

## 本地没有的东西

- 无 Brave/Tavily/Exa/DDG/SearXNG 任何本地搜索引擎痕迹（全仓零命中）；
- 无 query 改写、无融合、无缓存——全在服务端；
- 唯一相关的本地设施是 network-proxy crate：对出网域名做审批拦截（安全层，不是搜索层）。

## 值得我们抄的清单

| 抄什么 | 为什么 |
|--------|--------|
| Cached/Indexed/Live 三档 + filters + location | 搜索权限的完整参数化设计 |
| 服务端动作集（Search/OpenPage/FindInPage） | 我们搜索 agent 的最小动作集参考——三动作就够 |
| 输出截断默认 10000 token、保头尾 | 数值和策略直接搬 |

## 别学的坑

- 离开 OpenAI 服务端，Codex 就没有 web 搜索——供应商锁定是托管路线的宿命，也是我们自持编排路线的存在理由。

## 证据指路

- 原始报告：`reports/09-codex.md`（§5 搜索实现）
- 硬证据：`analysis/codex/source/codex-rs/core/src/tools/hosted_spec.rs`（三档 spec :14-46）、`core/src/web_search.rs`（30 行）
