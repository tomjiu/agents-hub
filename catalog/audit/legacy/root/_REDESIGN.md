# agents-hub 二次升级方案（草案）

> 待你确认后执行。

## 一、现状诊断

| 顶层目录 | 真实身份 | 大小 | 问题 |
|---|---|---|---|
| `selected/` | 49 个技能 | 4.59 MB | 命名不表意，且与 skills 概念混淆 |
| `mcp/` | enabled.yaml + **222 MB 源码镜像** | 223 MB | 配置与源码混放 |
| `cloud-vendors/` | **71 个大厂技能包**（trae 23 + workbuddy 48） | 21.15 MB | 被当作"杂物"埋没 |
| `search-infra/` | 既是技能（SKILL.md）又是 Go MCP server | 49.27 MB | 双重身份，无处安放 |
| `memory-net/` | npm 包 + CLI（bin: mn） | 0.56 MB | 不是技能，是插件 |
| `research/` | AGENTS.md 审计研究 | 0.20 MB | 有价值但没固化成工具 |
| `catalog/` | 索引/策略/审计 | 0.03 MB | 正常 |
| `dsh-plugins/` | 空壳（只有 README） | 0 | 预留但未用 |

## 二、目标结构

```
agents-hub/
├── AGENTS.md              根级总纲
├── README.md
├── skills/                49 个通用技能（唯一真相源）
├── skill-packs/           大厂技能包（分来源，不默认加载）
│   ├── trae/
│   ├── workbuddy/
│   └── registry.toml
├── experts/               ★ 专家团（TOML 加载配方）
│   ├── core.toml
│   ├── reverse-engineering.toml
│   └── ...
├── mcp/
│   ├── registry.toml
│   └── servers/search-core/
├── plugins/
│   ├── memory-net/
│   └── search-core/
├── agents-md/             ★ AGENTS.md 治理
│   ├── TEMPLATE.md
│   ├── fragments/
│   └── audit/
└── catalog/
```

## 三、待确认决策

### 决策 1：mcp/local 的 222 MB 源码怎么处理
- A) 移出仓库，只在 registry.toml 里记 URL（推荐）
- B) 保留在仓库
- C) 移到 sources/ 并 gitignore

### 决策 2：search-infra 双重身份怎么拆
- A) Go 实现放 mcp/servers/search-core/，SKILL.md 放 skills/search-core/（推荐）
- B) 整体当插件放 plugins/
- C) 保持不动，只在 catalog 登记

### 决策 3：大厂技能包是否默认加载
- A) 不默认加载，靠 experts 显式引用（推荐，避免和自有技能冲突）
- B) 全部并入 skills/
- C) 单独一个 expert 包如 experts/vendor-pack.toml

### 决策 4：AGENTS.md 治理做到什么程度
- A) 只做模板 + 片段库（推荐，轻量）
- B) 模板 + 片段 + 生成脚本 + 一致性检查
- C) 先只整理现有两份，不动结构
