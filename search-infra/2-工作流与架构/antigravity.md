# Antigravity · 工作流与架构

> **一句话**：Google 的答案是"瘦壳 + 粗腰"——Electron 只管界面，173MB 的 Go 二进制管一切，两者之间只留了两个 RPC 接口。这是全场安全设计最偏执的架构。

## 背景

Google agentic IDE，内部代号 jetski（strings 里能看到 `google3/third_party/jetski/` 内部路径）。和其他 Electron AI IDE 把 agent 塞进 asar 完全不同，Antigravity 把 agent 运行时做成了独立的原生二进制。

## 架构：agent 藏在 Go 二进制里

```
Electron（界面/托盘/IDE 安装/更新，main.js 只有 405 行）
   │ spawn + 监控
language_server（173MB Go ELF，strip 过）
   │ 127.0.0.1 回环 HTTP + Connect-RPC（protobuf）
HostBridge（Electron 侧）——总共只有 2 个接口
```

**HostBridge 只有 2 个 RPC：`getUpdateStatus`（有更新吗）和 `applyUpdate`（装更新）。**

这意味着什么：agent 即使被网页里的恶意指令劫持，它能对桌面做的事也只有"问更新状态"和"装更新"——**不是把接口做安全，而是根本不提供危险接口**。这比任何防注入提示词都可靠。

## 通信安全的四个细节（从 hostBridgeServer.js 直接读到）

1. **只听 127.0.0.1**——外部机器连不上；
2. **Host 头必须匹配**——防 DNS rebinding 攻击（恶意网页把域名解析到 127.0.0.1 来冒充本地服务）;
3. **Bearer token 用 `crypto.randomBytes(32)` 生成 + 恒定时间比较**——防时序攻击猜 token;
4. **错误信息脱敏**——失败一律返回 `{error: "forbidden"}`，不泄露是哪一步拒绝的。

## Agent 内部（能推断的部分）

- **显式 finish 工具**：strings 里挖到提示词原话——"Call the finish tool **only if** you have verified that your changes pass all targeted tests"（只有验证过测试通过才能调 finish）。结束不是模型"觉得完了"，而是必须显式调用一个工具并附上工作总结。比"模型自判停止"可控。
- **多 agent 是默认行为**：原话"By default, all subagents have read tools to research the codebase, and tools to communicate with other agents"——子代理默认只读 + 互相通信，权限最小化。
- 主模型 Gemini Pro，锁定 Google 生态。

## 为什么选 Go 不选 JS（推测 + 有依据）

- Go 的 goroutine 天然适合长时间运行的 agent 循环（JS 单线程要靠 async 绷紧了写）；
- Go 二进制反编译难度远高于 asar 解包（这次分析 Deep 挖不动就是证明）；
- LS 可以独立于 Electron 升级。

## 值得我们抄的清单

| 抄什么 | 为什么 |
|--------|--------|
| "接口极简"思路（只有 2 个 RPC） | 本地服务暴露面最小化，攻击面跟着最小化 |
| 回环 + Host 头校验 + 恒定时间比较 + 错误脱敏 | 我们做本地 MCP/HTTP 服务时的安全清单，全套可抄 |
| 显式 finish 工具 + "验证过才能调" | stop condition 的又一实现，比自判可靠 |

## 别学的坑

- 380MB 的分发体积（173MB LS + 206MB Electron），国内带宽不友好；
- 完全锁定单一模型供应商，失去灵活性。

## 证据指路

- 原始报告：`reports/03-antigravity.md`（§1 架构 / §2 工作流 / §4 工具系统）
- 硬证据：`analysis/antigravity/extracted/.../app-asar-extracted/dist/hostBridgeServer.js`（token/校验逻辑原文）、`dist/main.js`（405 行引导）、`resources/bin/language_server`（strings：finish 提示词、subagent 描述）
