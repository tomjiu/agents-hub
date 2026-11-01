# agents-hub

> **聚合仓**：AGENTS.md 规范 + Skills + MCP 注册表 + 记忆网 + 搜索基础设施 + dsh 插件。
> **跟 dsh 版本线走，与 kokoa 产品仓解耦。**

---

## 仓库定位

```
tomjiu/kokoa        产品仓（桌面端 Rust/Slint + 手机端 companion）
      ↕ 通过 dsh / MCP 协议消费
tomjiu/agents-hub   ★ 本仓：agent 能力层
```

## 顶层结构

```
agents-hub/
├── selected/         启用的 skills（324 文件）
├── mcp/              启用的 MCP 注册表（173 文件）
├── catalog/          URL 索引/镜像列表/draft 配置（7 文件）
├── cloud-vendors/    云厂商接入调研与实现（1228 文件）
├── search-infra/     ★ 搜索基础设施（476 文件，原 tomjiu/search-tool-rnd）
├── memory-net/       ★ 共享记忆网（44 文件，原 tomjiu/memory-net）
│   └── console/          云端控制台（43 文件，原 tomjiu/memory-net-console）
├── research/
│   └── agents-md-audit/  AGENTS.md 逆向审计（23 文件，原 mmqz/agents-md-audit）
└── dsh-plugins/      ★ dsh 插件（预留，跟 dsh 版本线走）
```

## ★ 为什么插件放这里而不是 kokoa

```
· 插件的宿主是 dsh，不是 kokoa；
· dsh 升级会改变插件 API ⇒ 插件必须跟 dsh 版本线走；
· kokoa 只负责【加载】插件，不负责【维护】插件。
```

## 新增内容放置约定

| 内容 | 放到 |
|---|---|
| 新 skill | `catalog/` + `selected/` |
| 新 MCP server | `mcp/` |
| 新云厂商接入 | `cloud-vendors/` |
| 新 dsh 插件 | `dsh-plugins/<name>/` |
| 新研究/调研 | `research/<topic>/` |
| 可运行工具/库 | `search-infra/` 或独立顶层目录 |

## 子目录来源登记（2026-11-01 聚合）

| 目录 | 原仓库 |
|---|---|
| `selected/` `mcp/` `catalog/` `cloud-vendors/` | 本仓原生（原名 `agent-skills-mcp`，11-01 改名） |
| `search-infra/` | `tomjiu/search-tool-rnd`（49.3 MB） |
| `memory-net/` | `tomjiu/memory-net` |
| `memory-net/console/` | `tomjiu/memory-net-console` |
| `research/agents-md-audit/` | `mmqz/agents-md-audit` |

---

# 以下为原 agent-skills-mcp 的 README（保留）
# Shared AI Skills + MCP

```text
E:\Code\skills\
  selected\     # ENABLED skills only (Agent discovers these)
  mcp\          # ENABLED MCP registry (enabled.yaml + local MCP repos)
  catalog\      # Indexes, policies, MCP drafts (not auto-loaded into context)
  sources\      # Pre-cloned packs & mirrors (on-demand, not default-enabled)
  archive\      # Backups / disabled / old junk
  README.md
```

| Path | Role |
|------|------|
| **`selected/`** | **只放启用的 skills**（每个子目录一个 skill） |
| **`mcp/`** | **只放启用的 MCP**：`mcp/servers/<name>/` 一目了然；`local/` 放本机源码 |
| **`catalog/`** | URL 索引、镜像列表、draft 配置、审计 |
| **`sources/`** | 预制下载（skills 大包、MCP 源码镜像、awesome）— **不默认启用** |
| **`archive/`** | 冷备份 |

## Client wiring

| Tool | Skills | MCP runtime |
|------|--------|-------------|
| **OpenCode** | `skills.paths` → `selected/` | `~/.config/opencode/opencode.json` — keep in sync with `mcp/enabled.yaml` |
| **Codex** | copy into `~/.codex/skills` | `~/.codex/config.toml` `[mcp_servers]` — keep in sync with `mcp/enabled.yaml` |
| **Hermes** | own tree | own `config.yaml` |

## Enable / disable

| Want | Skills | MCP |
|------|--------|-----|
| Enable | put under `selected/` (+ copy to Codex) | add to `mcp/enabled.yaml` **and** client config |
| Prefetch only | clone under `sources/` | clone under `sources/mcp-ecosystem/` + draft in `catalog/mcp.draft.toml` |
| Disable | move to `archive/` | remove from client config + mark in `enabled.yaml` |

## Key docs

- Enabled MCP list: **`mcp/enabled.yaml`**
- Enabled skills folder: **`selected/README.md`**
- URL catalog: `catalog/sources.yaml`
- Local clones: `catalog/LOCAL_MIRRORS.md`
- MCP not enabled yet: `catalog/mcp.draft.toml`

## Search (enabled)

- Keenable MCP · Tavily Hikari MCP · Exa (`EXA_API_KEY`)
- Skills: `web-search-hikari`, `keenable-cli`, `exa-search`, …

## Index skills

- `source-index` — local map
- `repository-skills` — remote search → download → **review** → promote to `selected/`