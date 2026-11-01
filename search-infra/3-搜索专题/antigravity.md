# Antigravity · 搜索专题

> **一句话**：Antigravity 基本没有 web 搜索——只有内部代码搜索（SearchCode）。它在本项目里是"对照组"：**Google 选择把一切搜索能力都锁在 Gemini 服务端和自家生态里，客户端连引擎痕迹都不留。**

## 找到了什么

- **内部代码搜索确认**：strings 里挖到 `language_server_go_proto.SearchCodeResult`——有代码搜索，protobuf 定义在 Go 服务里，内部代号 jetski（`google3/third_party/jetski/` 路径泄露）；
- **web 搜索**：strings 里没有任何 Tavily/Brave/SearXNG/serpapi 痕迹。两种可能：完全依赖 Gemini 服务端搜索（Grok 同款），或逻辑藏在 strip 掉的部分。工具列表里有 WebSearch/WebFetch 工具名（Claude 派生），但客户端实现零痕迹。

## 一个意外的发现：隐私数据治理框架

strings 里发现 Google 的 `dga-search-custom-extension` 模块（Data Governance Accelerator），管理用户数据的分类：查询/点击/曝光/联系人/兴趣/**AI 模型提示词**/生成内容等类别。

意义：Google 对"搜索行为产生的数据属于哪一类、怎么用"有精细的内部治理——这层在别家产品里完全没看到。做面向企业的搜索工具时，数据分类治理是个真实需求（虽然我们暂时用不上这个量级）。

## 对照组的价值

| 问题 | Antigravity 的答案 | 对我们 |
|------|-------------------|--------|
| 搜索必须自建吗？ | 不——Google 直接全托管 | 客户端自持编排是我们（无托管能力方）的唯一选择 |
| 客户端要留什么？ | 什么都不留 | 留痕迹是可观测性的前提，我们反而要全程留日志 |

## 证据指路

- 原始报告：`reports/03-antigravity.md`（§5 搜索实现）
- 硬证据：`analysis/antigravity/extracted/Antigravity-x64/resources/bin/language_server`（strings：SearchCodeResult、dga-search 模块）
