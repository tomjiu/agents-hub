---
name: asset-management
description: 管理 Agent 能力资产的发现、登记、来源检查、完整性下载、三方比较、独立暂存、验证、人工批准、启用、部署视图与回滚；适用于 Skills、MCP、Plugins 和 AGENTS.md 模板。
---

# 资产管理工作流

以 agents-hub 仓库根为工作目录。工具命令详见 node asset-manager/cli.mjs help，Node ≥22.13，依赖由根 package-lock.json 固定。

## 红线

- 存在不等于启用，启用不等于客户端已加载。
- 更新永远进入新目录，不覆盖当前版本、本地修改或项目定制，不自动合并。
- 静态检查不代替安全、许可、依赖和运行时审核；审批者与理由必须明确。批准命令是人工决定的记录，不是身份认证系统。
- 下载仅验证原始字节，不自动执行、安装或解包。来源受限时明确记录，不猜测市场接口。

## 顺序

1. list / inspect / expert：找到资产及维护源，核对 ID、类型、策略、基线和当前状态。
2. check <id>：检查已实现的来源；受限或本地来源分别返回 RESTRICTED / MANUAL。失败不自动重试刷接口。
3. download <id> <pinned-url> --integrity <SRI>：地址必须匹配登记来源域，返回独立原始产物。不执行产物；必要的解包与许可审查另行完成。
4. stage <id> <incoming-directory>：复制为不可覆盖版本快照，记录上游版本、SHA256 和基线/本地/新版本差异；不改仓库原件。
5. validate-version <id> <version>：结构与完整性检查。另行完成必要的安全、许可、依赖和真实客户端验证，记录审核证据。
6. approve <id> <version> --reviewer <name> --note <evidence>：仅在人工已同意时执行。有本地改动还需明确审核 --resolve-local-changes，不意味着自动合并。
7. activate <id> <version>：切换版本指针；不改用户配置，不修改原件。需要客户端实际采用时生成新 view，审查后部署。
8. rollback <id>：恢复上一启用版本或回到仓库基线。export-locks <new-directory> 导出实际版本选择用于备份，不能只靠基线锁恢复新启用内容。

## 专家与客户端

view <codex|opencode|dsh|generic> <expert> 生成独立技能视图与配置片段；不覆盖用户已有配置。厂商包默认需人工许可/运行时审核，重名技能拒绝混装。宿主插件没有适配时返回未支持说明，不伪装成已加载。

AGENTS.md：compose <project.md> <new-output> [--fragments ui-acceptance] 生成完整候选和来源哈希；有占位项或已有输出就拒绝。语义冲突仍需人工审核，不声称自动检测全部矛盾。

## 显式项目 Skill 部署

plan-deploy <client> <existing-project> 预览 Profile 选择及同名冲突，不写消费项目。只有用户授权指定项目时，执行 deploy <client> <existing-project> --approve。当前仅处理 Skill；包含 MCP/插件的 Profile 不允许部分安装。

部署内容是客户端副本而非新的维护源；现有 Skill 或配置不覆盖。部署回执记录完整摘要，inspect-deployment <project> <id> 核对结果；uninstall <project> <id> --approve 在整组摘要一致后移到 quarantine，保留原字节。任意本地修改、新文件、空目录、链接或未确认的失败安装都阻止回收，不自动清垃圾。

**经验**：项目副本的回收检查必须覆盖缓存名、点文件和空目录，不能复用源码快照的过滤规则；否则 node_modules/dist 等用户新增内容可能被误回收。并发与中断状态需要独占锁及回执，不能“哈希相同就认领所有权”。DSH 默认项目根已通过隔离实际加载器验证；Codex/OpenCode 的真实加载仍需各自验证。

## MCP配置保护

plan-mcp <client> <project> [--expert NAME] 生成私有候选与原配置备份；用户授权后 apply-mcp <id> --approve。inspect-mcp核对状态，rollback-mcp只有当前配置字节未改时恢复原件。配置/视图/启动器/源码变化、重名服务、JSONC冲突必须拒绝，不自动合并本地修改。

**经验**：通用MCP JSON不等于宿主原生配置；DSH使用逐服务Cordis实例，OpenCode工作目录可用无shell启动器固定。环境变量只存名字，不拷贝值；宿主清理父环境导致的鉴权缺口未经实测就明确拒绝。候选可能继承原配置中的用户秘密，运行态不可公开；协议握手不等于完整宿主加载。

## 真实宿主验证经验

生成配置、解析schema和SDK握手都不能替代宿主加载。先用独立HOME/DSH_HOME、无真实凭据及关闭遥测的headless实例，复用脚本化模拟模型让宿主实际调用Skill/MCP/插件，再验证结果回流与持久化。Skill加载要比对正文，不只检查摘要；适配包生命周期应使用宿主effect关闭数据库，避免陈旧工具或事件重新打开已卸载状态。

## 交付记录

报告资产 ID、上游来源/版本、当前哈希、差异和本地修改、验证范围、审批证据、启用版本、实际加载状态与回滚入口。外部素材、许可证和研究证据不得因整理目录而丢弃。
