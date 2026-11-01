# Qoder · 工作流与架构

> **一句话**：Qoder 把 agent 主程序从安装包里拆了出去——运行时才从 CDN 下载 worker，桌面和 agent 之间用一行一行的 JSON 流对话。这个架构牺牲了首启动速度，换来了 agent 内核可独立升级。

## 背景

阿里通义旗下 AI Coding IDE（CN 版）。Electron 主程序 6722 行混淆 JS，但 agent 的真正逻辑在 `qodercli worker runtime` 里（v1.1.35），通过一个暴露过度的 npm SDK 能看到全貌。

## 架构：agent 不在桌面里

```
Electron 桌面
   │ spawn / worker_threads
qodercli worker runtime（从 CDN 下载的 tgz，独立版本号）
   │ JSONL 流协议（一行一个 JSON 对象，双向）
阿里云端 API
```

关键事实（从 `runtime-manifest.json` 直接读到）：

- `packaged: false`——worker **不打包**在安装包里，运行时从 `static.qoder.com.cn` 下载；
- worker 版本（1.1.35）和 SDK 版本（1.0.30）独立演进；
- 流协议：`--input-format stream-json --output-format stream-json`，单帧上限 16MB（超了抛 `FrameTooLargeError`）。

## 权限系统（6 种模式 + 兜底）

```
default / accept_edits（自动接受编辑）/ plan（只读规划）/
dont_ask / auto / bypass_permissions（别名 "yolo"）
```

粒度递减：全局模式 → `--allowed-tools` 工具级 → MCP 工具三态 → `canUseTool` 回调（代码级判断）→ `--permission-prompt-tool`（把审批转给外部程序）。从粗到细五层，每一层都能单独收紧。

## 会话系统（resume 玩法最全）

- 存储用 SQLite（node:sqlite 同步接口）；
- `--resume <id>` / `--continue`（接着最近的）/ **`--resume-session-at`（恢复到某一轮）** / `--resume-drops-turn`（恢复时丢掉某些轮）；
- `--fork-session`（复制一份会话分叉跑）。

"恢复到第 N 轮 + 丢弃某几轮"这个粒度，别的产品都没做——调试 agent 行为时极其有用（比如"从模型犯错的前一轮重来"）。

## 其他

- 内置了**会话内容搜索**（chatSessionSearch）：对历史会话做全文检索——这是 IDE 特性，不是 agent 特性，但说明"历史会话是资产"的意识；
- `QODER_FEATURE_TASKS` 环境变量切换工具集（详见技能与市场文件夹）；
- hook 系统 18 种（PreToolUse/PostToolUse/PreCompact...），与 Claude Code 同名兼容。

## 值得我们抄的清单

| 抄什么 | 为什么 |
|--------|--------|
| `--resume-session-at` + `--resume-drops-turn` | 会话恢复的粒度天花板，调试 agent 必备 |
| worker 内核独立版本 + JSONL 流协议 | 内核可热更；流协议简单可靠 |
| 16MB 单帧上限 | 防单条消息撑爆管道，数字可直接搬 |
| 权限五层递减 | 兜底链完整，"收紧"永远有下一层 |

## 别学的坑

- `packaged: false` 运行时下载核心——CDN 挂了产品瘫痪（首启动也慢）。核心能力必须随包。

## 证据指路

- 原始报告：`reports/04-qoder.md`（§1 架构 / §2 工作流 / §6 会话）
- 硬证据：`analysis/qoder/extracted/.../@qoder-ai/qoder-cn-agent-sdk/dist/`（index.js、runtime-manifest.json）
