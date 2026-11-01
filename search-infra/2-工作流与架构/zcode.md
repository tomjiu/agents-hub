# ZCode · 工作流与架构

> **一句话**：ZCode 的架构 = **Claude Code 底座（fork）+ Z.ai 自研的 workflow/phase 显式编排层 + 模型中立层（10 家供应商任选）**。它是 14 个样本里唯一一个"fork 起家再叠自研编排"的样本，也代表了中国市场的务实路线：底座不重复造轮子，创新花在编排、生态和模型面上。

## 架构分层

```
┌────────────────────────────────────────────┐
│ Electron 桌面壳（out/main + host + scheduler）│ ← 会话调度、宿主管理
├────────────────────────────────────────────┤
│ zcode.cjs（12.5MB 混淆 bundle，CLI 核心）      │ ← Claude Code fork + 自研层
│  · 工具系统（10 个，与 Claude Code 同名同款）  │
│  · workflow/phase 显式编排（自研，见下）       │
│  · memory / ReadSessionContext（继承+改造）   │
├────────────────────────────────────────────┤
│ kosong 式 provider 层 → 10 家模型供应商       │ ← 模型中立（多 provider catalog）
├────────────────────────────────────────────┤
│ 插件层：.zcode-plugin（skills/agents/hooks/  │
│ .mcp.json）+ 官方云端 MCP（JWT 鉴权）          │
└────────────────────────────────────────────┘
```

## Z.ai 自研的 workflow/phase 编排层（fork 之上的真创新）

zcode.cjs 里的系统提示词残留：

```
"You are running the ZCode workflow phase..."
"You are running a ZCode workflow node inside phase..."
"You are running a ZCode workflow exploration planner for phase..."
```

解读：在 Claude Code 的"模型每步自主决定"之上，ZCode 加了一层**显式的 phase（阶段）结构**——长任务先过"探索规划器"（exploration planner），再按 phase 逐个推进，每个 phase 有独立的执行节点。这对应报告 13 里的**混合流派**：日常问答走自主循环，重活走 phase 流水线。

跟我们 Trae 报告里的结论对上了：**SOLO 型产品（长任务、多阶段）最终都会长出显式编排**，纯自治循环撑不住 30 分钟以上的任务。

## 模型中立层：10 家供应商 + 订阅/直连双通道

模型目录（models_catalog_..._2026-06-03.json）一次看清中国编程 agent 的供给面：

| provider | 模型 |
|----------|------|
| moonshot-kimi | kimi-k3、kimi-k2.6、moonshot-v1-* |
| minimax | MiniMax-M3 / M2.7 / M2.5 |
| deepseek | deepseek-v4-flash / v4-pro |
| qwen ×2（国内/国际） | qwen3.5-plus / qwen3-max |
| xiaomi-mimo | mimo-v2.5-pro |
| zai / bigmodel | glm-5.3 / glm-5.1 / glm-5-turbo 等 23 个 |

注意三个细节：

1. **zai 和 bigmodel 是同列表双通道**（zai-coding-plan / bigmodel-coding-plan 是订阅通道）——同一模型，计费路径不同。
2. **ZCode 目录里有 kimi-k3**，Kimi 目录里有 claude 映射——头部玩家互相接入对方模型，**底座中立、体验竞争**。
3. 目录是**按日期的快照文件**（..._2026-06-03.json），升级审计可回滚。

另有 BYOK 引用：api.fireworks.ai / api.minimax.io / api.vultrinference.com（自带 key 接第三方推理）。

## fork 的工程纪律（值得 fork 者抄）

ZCode 对 Claude Code 底座的改造相当克制：

- **环境变量双轨**：CLAUDE_* 和 ZCODE_* 成对注入（CLAUDE_PLUGIN_ROOT / CLAUDE_SKILL_DIR ...），存量 Claude 插件不改一行就能跑。
- **工具名不改**：TodoRead/TodoWrite/Skill 全保留，改的只是上层命名。
- **兼容性写进代码注释**："Claude Code-compatible alias for the Agent tool"——兼容是显式设计目标，不是巧合。
- 自研部分（phase 编排、多 provider、云端 MCP）全部以**叠加层**形式存在，不破坏底座约定。

## 会话与记忆

- 继承 Claude Code 的 memory 机制，提示词里有 "selecting memories that will be useful to **Claude Code**..."（改名漏网）。
- ReadSessionContext 工具：用小模型提取会话上下文（脏活给小模型的又一例）。
- restore-legacy-sessions 插件：旧版会话迁移——桌面版历史包袱管理。

## 证据指路

硬核细节见 `reports/15-zcode.md`（第 2、3、7 节）。provider 目录在 `raw-downloads/zcode-extract/opt/ZCode/resources/model-providers/`，提示词片段可 grep `raw-downloads/zcode-extract/opt/ZCode/resources/glm/zcode.cjs`。
