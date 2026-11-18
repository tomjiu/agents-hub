# agents-hub

Agent 能力资产管理与运行时集成中心。Skills 与项目规范可独立使用；MCP 按标准协议接入；DSH 插件保留完整实现但不假定其他客户端能加载。

## 新环境开始

前置：Node.js ≥22.13 与 npm。先安装根 CLI 的固定依赖，不执行第三方安装钩子：

以下命令在仓库根执行：

~~~sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run validate
node asset-manager/cli.mjs list
node asset-manager/cli.mjs expert core
node asset-manager/cli.mjs view generic core
# 或按仓库客户端 Profile 展开专家和资产选择：
node asset-manager/cli.mjs profile-view dsh
# 对安装包与当前记忆/搜索资产做指纹兼容检查：
node asset-manager/cli.mjs check-dsh <installed-dsh-package-directory>
~~~

view 输出一个独立目录，含 Skill 部署副本、来源哈希及配置片段。换成 dsh、codex 或 opencode 可生成对应视图；不会覆盖用户配置，也不会启动远端服务或自动加载插件。

**本次运行时验收只要求DSH可用，不要求Codex/OpenCode全部跑通；后两者适配保留但不算已验收。** 记忆插件和搜索MCP已在DSH 0.2.2-rc.1与next 0.2.2-rc.4独立宿主验证；升级或资产变更必须重新验收，见 [DSH升级指南](asset-manager/DSH-UPGRADE.md)。 全量迁移和已完成验证见 [实施状态](catalog/audit/IMPLEMENTATION.md)。

## 目录职责

| 目录 | 作用 |
|---|---|
| [skills](skills/README.md) | individual 独立技能、collections 厂商集合及 asset-management 工作流，唯一维护源 |
| [experts](experts/README.md) | 组合配方，引用稳定 ID，不复制 Skill 内容 |
| [asset-manager](asset-manager/README.md) | 来源检查、校验下载、三方差异、独立暂存、审核记录、显式启用、回滚和部署视图 |
| [mcp 注册表](mcp/registry.toml) | 服务唯一运行配置；源码在 servers 中，保留 Search-core TS/Go 与 Zai-bridge |
| [Memory-net](plugins/memory-net/README.md) | 完整 CLI、DSH Adapter、Console 与固定 vendor 产物 |
| [agents-md](agents-md/README.md) | 共用规范、项目模板、可选片段、来源研究与候选拼接 |
| [research/search-core](research/search-core/README.md) | Search-core 原有研究证据与工作记录；不是自动加载内容 |
| [catalog](catalog/README.md) | 稳定资产 ID、来源、独立更新策略、版本锁、客户端 Profile 和迁移审计 |

不建立 agents/、skill-packs/ 或通用 projects/。WorkBuddy 内部插件属于原始厂商集合，不自动认定为 DSH 插件；专家候选仍未审核。

## 显式项目 Skill 部署

在仓库根执行，目标必须是已存在的消费项目；本轮只安装 Skill，不自动安装 MCP 或插件，也不修改已有项目规范/配置。

~~~sh
node asset-manager/cli.mjs plan-deploy dsh <existing-project>
node asset-manager/cli.mjs deploy dsh <existing-project> --approve
node asset-manager/cli.mjs inspect-deployment <existing-project> <deployment-id>
node asset-manager/cli.mjs uninstall <existing-project> <deployment-id> --approve
~~~

plan-deploy 只预览；deploy 必须显式批准并指定项目。按 Profile 展开的 Skill 安装到 DSH 的 .dsh/skills、Codex 的 .agents/skills 或 OpenCode 的 .opencode/skills。**实际默认目录发现已在 DSH 安装包中验证；Codex/OpenCode 目前只验证目录部署，尚未进行实际客户端验收。**

已有同名 Skill 则停止，不覆盖或采用其所有权。部署回执在项目 .agents-hub/deployments；卸载先校验全部内容，任意用户修改、新增目录/文件、链接都会阻止整组回收。通过后移入 .agents-hub/quarantine 保留字节，不永久删除。中断/未确认的部署留待人工恢复，不自动清理。

目标 Profile 含 MCP 或插件时，当前安装器拒绝部分安装；请先生成并审查 Profile 视图，待对应客户端适配完成后再启用。详细约束见 [部署指南](asset-manager/DEPLOYMENT.md)。

## 显式 MCP 配置接入

~~~sh
node asset-manager/cli.mjs plan-mcp opencode <project> --expert research
node asset-manager/cli.mjs inspect-mcp <change-id>
node asset-manager/cli.mjs apply-mcp <change-id> --approve
node asset-manager/cli.mjs rollback-mcp <change-id> --approve
~~~

先生成独立候选，保留原配置和已有服务；重名、本地修改或审核内容变化就拒绝应用/回滚。DSH输出Cordis patch，不改运行中实例；OpenCode用无shell启动器固定cwd；Codex追加TOML。详情和限制见 [MCP配置指南](asset-manager/MCP-CONFIG.md)。原配置及候选可能含用户密钥，必须留在私有运行状态，不公开上传。

## 更新与回滚

~~~sh
node asset-manager/cli.mjs inspect <asset-id>
node asset-manager/cli.mjs check <asset-id>
node asset-manager/cli.mjs stage <asset-id> <independent-incoming-directory>
node asset-manager/cli.mjs validate-version <asset-id> <version>
# 必须先完成实际的许可、安全、依赖和运行时审核，再记录人工决定：
node asset-manager/cli.mjs approve <asset-id> <version> --reviewer <name> --note <evidence>
node asset-manager/cli.mjs activate <asset-id> <version>
node asset-manager/cli.mjs rollback <asset-id>
~~~

暂存与版本快照放在 .asset-state，不覆盖源码；activate 只切换指针，不修改客户端配置。生成新视图并明确部署后客户端才可能采用该版本。静态验证不代替人工审批，不提供审批者身份认证。

存在本地修改时需人工处理三方差异；--resolve-local-changes 只记录已完成的人工决定，不自动合并或丢弃原件。目录链接、未审查重名 Skill 和不完整命令会拒绝部署。

来源支持与边界：GitHub commit / npm 版本查询已实现；固定 HTTPS 地址可按 SRI 校验下载原始产物。CDN 市场发现、WorkBuddy 安装包提取标为受限，尚不提供自动解包与执行。

## AGENTS.md 拼接

~~~sh
node asset-manager/cli.mjs compose <filled-project.md> <new-AGENTS-candidate.md> --fragments ui-acceptance
~~~

生成完整候选正文及 sources.json，拒绝覆盖已有输出和未填模板。人工检查语义冲突与项目定制后才能替换项目正式规范，不假装工具能自动判断所有矛盾。

## 安全与来源

- 原有文件按 SHA256 清单迁移，研究证据和许可证不因整理被删除；原始路径映射见 [迁移记录](catalog/audit/migration-2026-11.json)。Git 历史保留重命名来源。
- 厂商集合默认不启用；存在于公开仓库不代表许可允许任意再分发或能跨宿主运行。
- catalog/audit/legacy 是历史记录，不是运行配置；其中旧机器路径和旧安装流程不可作为当前指令执行。
- .asset-state、真实账户、密钥、用户配置和 node_modules 不入库。Console 固定 vendor dist 是已有运行依赖，明确保留。
- 基线锁记录导入版本，实际启用选择位于运行时 active.json；export-locks 生成新的锁文件。备份新启用版本时还必须保存快照，不能只备份锁文件。
