# Grok Build · 技能与工具市场

> **一句话**：xAI 的 Grok Build 直接抄了 Claude Code 的技能系统——代码里连 `${CLAUDE_PLUGIN_ROOT}` 这个变量名都没改——但市场是自建的 git 仓库，首次启动自动注册。

## 背景

xAI 官方终端 agent，开源（Rust，90+ crate）。这次是直接 clone 源码分析的。

## 技能系统

技能 = `SKILL.md`，放在 `.grok/skills/<名字>/`。继承痕迹非常明显：技能文件里还在用 `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}` 这两个 Claude Code 的变量名。

### 六层优先级（比 Claude 原版多一层）

```
项目本地 > 仓库根 > 用户全局 > 服务器同步 > 平台内置 > 插件自带
 (Local)   (Repo)   (User)     (Server)    (Bundled)   (Plugin)
```

含义：项目本地的技能永远覆盖用户全局的；官方服务器同步下来的比内置的优先；插件提供的最弱，不会无意覆盖用户配置。**这层设计保证"越贴近你的配置越说了算"，是无冲突的优先级方案。**

### frontmatter 字段（技能文件开头可写的配置）

比较有意思的几个：

- `when_to_use`：**触发短语**——描述什么情况下该用这个技能，模型靠它自己判断何时调用；
- `paths`：gitignore 风格的路径匹配——只有处理这些路径时技能才可见（比如"只在碰 Rust 文件时激活"）；
- `allowed_tools`：**工具白名单**——这个技能运行期间只许用哪些工具（安全边界）;
- `model` / `effort`：**每个技能可以指定自己的模型和思考力度**（重的技能用强模型）；
- `disable_model_invocation`：设了它，技能只能用户手动 `/技能名` 触发，模型不能自作主张调用。

### 三种触发通道

1. 提示词注入目录（名字+描述+when_to_use），模型自行决定；
2. `skill` 工具显式调用；
3. 用户斜杠命令 `/skill-name`（不经过模型）。

## 市场

- 官方市场就是一个 git 仓库：`github.com/xai-org/plugin-marketplace`；
- 首次运行自动注册这个仓库为市场源；
- 扫描/安装逻辑在 `xai-grok-plugin-marketplace` crate（10 个文件）。

比 Claude Code 的市场简陋——没有版本锁定缓存、没有企业黑名单那套安全工程，但"git 仓库即市场"的形态足够轻。

## 工具太多怎么办

代码里有一个 `ToolSearchIndex` 接口（"后端无关的搜索接口"，注释明说可以接 BM25 / OpenSearch / 内存搜索），说明他们打算做和 Codex 一样的"搜工具"机制——**但在这个仓库里找不到具体实现**。属于"接口先行、实现未落地"。

## 值得我们抄的清单

| 抄什么 | 为什么 |
|--------|--------|
| 六层 scope 优先级（多了 Server 层） | 支持官方服务器下发技能的同时不打架 |
| `when_to_use` + `paths` 双触发 | 时间维度（何时）和空间维度（何地）都能触发 |
| `allowed_tools` 技能级工具白名单 | 技能运行的安全边界，防止技能越权 |
| per-skill 模型/思考力度覆盖 | 重活用强模型，便宜活用快模型，颗粒度到技能级 |
| git 仓库即市场 + 首启自动注册 | 最轻的市场实现，我们的工具起步用这个就够 |

## 证据指路

- 原始报告：`reports/01-grok-build.md`（§3 技能仓库 / §4.5 ToolSearchIndex）
- 硬证据：`analysis/grok-build/source/crates/codegen/xai-grok-tools/src/implementations/skills/types.rs`（scope 枚举 :20-33、frontmatter 全字段 :40-123）、`crates/codegen/xai-grok-plugin-marketplace/`
