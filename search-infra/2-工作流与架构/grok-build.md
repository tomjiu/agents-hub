# Grok Build · 工作流与架构

> **一句话**：Grok Build 的 agent 结构是全场最简单的：单进程、单 agent、没有编排器——但它的"Agent 不可变设计"和"子 agent 四层模型继承"是两个很干净的工程样本。

## 背景

xAI 官方终端 agent，开源 Rust，90+ crate。单进程 + tokio 并发，没有独立子进程（workspace daemon 除外）。

## 主循环

没有显式状态机。循环是：

```
拼上下文（历史 + 技能 + AGENTS.md）→ 请求模型 → 有工具调用？
  ├─ 有 → 执行工具 → 结果写回 → （token 超阈值就压缩）→ 继续
  └─ 没有 → 输出回答，结束
```

"调工具还是回话"完全由模型自己决定，客户端没有任何规则路由——这是"模型自治"流派的典型。

## 两个干净的设计

### 1. Agent 不可变 + ToolBridge 可变

源码注释原话："The Agent is effectively immutable after construction"（Agent 构建后不可变）。

- Agent（角色定义/提示词/工具集）建好了就不许改；
- 所有会变的状态（MCP 注册、重试配置）放到一个叫 ToolBridge 的东西里，通过内部锁管理；
- 好处：中途切换 agent 模式时，不用重建 Agent，只需用新定义重新渲染提示词、复用同一个 ToolBridge。

**"定义不可变、状态可变"分离，让模式切换变成轻操作**——我们做多 profile 搜索策略时可以套用。

### 2. 子 agent 的四层模型继承

子 agent 用什么模型，按优先级四层决定：

```
显式指定（派活时传参） > 角色（role 定义） > 人格（persona 定义） > 继承父 agent
```

每一层都可以不写，层层兜底。子 agent 还有独立的工具桥、隔离级别、人格系统——"独立"体现在结构上而不是口头上。

## 没有的东西（同样是信息）

- 没有 Planner-Executor 拆分（没有"先规划再执行"的角色分离）；
- 没有多 agent 编排器——子 agent 只是主 agent 运行时的一个分支；
- 搜索相关编排为零（见搜索专题）。

## 值得我们抄的清单

| 抄什么 | 为什么 |
|--------|--------|
| Agent 不可变 + 状态进 ToolBridge | 配置切换/热更新时状态不丢 |
| 子 agent 四层模型继承链 | 派活时可以精细控模型，默认又能无痛继承 |
| schema from types（Rust 类型自动生成工具 JSON Schema） | 工具定义和类型定义只维护一份 |

## 证据指路

- 原始报告：`reports/01-grok-build.md`（§2 Agent 工作流）
- 硬证据：`analysis/grok-build/source/crates/codegen/xai-grok-agent/src/agent.rs`（结构体与注释 :18-43）、`crates/codegen/xai-grok-subagent-resolution/src/lib.rs`（四层继承 :8-13）
