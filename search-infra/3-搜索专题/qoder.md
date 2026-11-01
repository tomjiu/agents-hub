# Qoder · 搜索专题

> **一句话**：Qoder 的 web 搜索委托给云端（和 Grok/Codex 同路数），它独有的价值是两个边角：**图片搜索作为一等工具**，以及**本地会话内容搜索**（搜自己的历史对话）。

## Web 搜索：委托云端

- 工具列表里有 `WebSearch`/`WebFetch`，但实现在 worker runtime 里（未解出），SDK 层看不到实现；
- 从架构推断走 Qoder Cloud API（SDK 支持 VPC endpoint 配置，说明是企业内网部署的形态）；
- 无本地引擎痕迹、无降级路径——与 Grok Build / Codex 同判。

## ImageSearch（独有工具）

Qoder 工具列表里比 Claude Code 基线多了 `ImageGen`（生图）和 `ImageSearch`（搜图）。推测调阿里自家能力（通义万相）。**在所有 12 个分析对象里，只有 Qoder 把"搜图"做成了和文本搜索平级的一等工具。** 对需要前端/设计场景的 agent，这是个值得记下的工具面缺口。

## 会话内容搜索（IDE 特性，但思路可借鉴）

`chatSessionSearch`：用 SQLite 存所有历史会话，做全文检索（还有专门的 worker 线程处理）。让用户能搜"上周那次讨论 XX 的对话"。

对搜索工具的启示：**检索不只搜公网，还要能搜用户自己的历史**。WorkBuddy 的 conversation_search（云端记忆检索）是同一需求的云版。

## 值得我们抄的清单

| 抄什么 | 为什么 |
|--------|--------|
| 图片搜索作为一等工具 | 多模态搜索的工具面参考 |
| 会话级检索（本地 SQLite 全文） | "历史即资产"，我们的工具也可以留一层本地记忆检索 |

## 证据指路

- 原始报告：`reports/04-qoder.md`（§5 搜索实现）
- 硬证据：`analysis/qoder/extracted/.../@qoder-ai/qoder-cn-agent-sdk/dist/index.js`（工具数组含 ImageSearch/ImageGen）、`out/main/chunks/chatSessionSearch*.js`
