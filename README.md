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
node asset-manager/cli.mjs search-assets "索引" --kind skills --limit 5
node asset-manager/cli.mjs skills-status
node asset-manager/cli.mjs expert core
node asset-manager/cli.mjs view generic core
# 或按仓库客户端 Profile 展开专家和资产选择：
node asset-manager/cli.mjs profile-view dsh
# 对安装包与当前记忆/搜索资产做指纹兼容检查：
node asset-manager/cli.mjs check-dsh <installed-dsh-package-directory>
~~~

view 输出一个独立目录，含 Skill 部署副本、来源哈希及配置片段。换成 dsh、codex 或 opencode 可生成对应视图；不会覆盖用户配置，也不会启动远端服务或自动加载插件。

**当前DSH-focused重构已交付，验收只要求DSH可用；Codex/OpenCode适配保留但不算已验收。** 记忆插件和搜索MCP已在DSH latest 0.2.2-rc.1、历史next rc.4和当前next rc.5独立宿主验证；升级或资产变更必须重新验收，见 [DSH升级指南](asset-manager/DSH-UPGRADE.md)。 交付边界及新clone复验见 [交付矩阵](catalog/audit/DELIVERY.md) 与 [干净副本证据](catalog/audit/fresh-checkout-verification.json)；阶段历史见 [实施状态](catalog/audit/IMPLEMENTATION.md)。

## 当前合并与运行状态

PR #3已审阅并合入main（合并提交6a2ba83），包含资产可用性/组合、脚本生命周期、搜索选源/偏题和显式可信TUN抓取修复。独立DSH运行包已验证；其后用户授权当前Web实验并自行重启，搜索/可信TUN抓取、9个仓库技能及独立记忆工具路径已实测。首次重复tool-skill导致空目录已最小修复，见[实际Web实验](catalog/audit/web-live-experiment.json)。合并时的历史状态见 [合并交付记录](catalog/audit/pr3-merge-delivery.json)。此次实验沿用原模型鉴权，profile已由用户重启采用；其他profile/新宿主采用及真实记忆迁移仍须独立确认，不自动替换。

## 按任务找能力

先看[用户能力目录](<catalog/CAPABILITIES.md>)，不必理解维护源目录或厂商内部命名。首版是14条精选路线，按办公、设计、工程、研究、安全展示，提供多领域/阶段标签；不是所有123个Skill的自动分类，也不是新建三个同名工作流Skill。

~~~sh
node asset-manager/cli.mjs find-capability "需求分析与规划"
node asset-manager/cli.mjs find-capability "办公质量验收"
node asset-manager/cli.mjs find-capability "UI设计"
node asset-manager/cli.mjs find-capability "自动化测试"
node asset-manager/cli.mjs capabilities --group office
~~~

任务入口使用完整字面别名，不沿用库存检索的中文二字片段。规划、执行、验收明确标partial；业务排期/资源预算无专用能力；受限Office和厂商候选仍显示UNAVAILABLE/BLOCKED及来源。CURRENT只表示已审阅正文哈希一致，不是已启用、许可批准或专业任务验收。无匹配返回NO_MATCH，可另用search-assets查库存，不隐式降级为安装。详见[路由说明](<asset-manager/TASK-CAPABILITIES.md>)。维护目录、ID、原件和DSH配置不改。

## 真实可用性与组合预检

~~~sh
node asset-manager/cli.mjs search-assets "记忆插件" --kind plugins
node asset-manager/cli.mjs preflight --expert research --client dsh
node asset-manager/cli.mjs preflight skill-search,source-index,mcp.search-core,memory-net --client dsh
node asset-manager/cli.mjs audit-usability --client dsh
~~~

索引返回障碍与下一步。preflight只读检查重名、声明依赖/冲突、宿主/配置/许可；BLOCKED非零、不自动启用。137项库存不能全部同时安装，CONTENT_READY只指内容可读。详见 [使用审核](asset-manager/USABILITY.md)。

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

## DSH构建前置

初次clone需安装三个子包的固定构建依赖，根npm ci不替代它们：

~~~sh
npm ci --ignore-scripts --no-audit --no-fund --prefix plugins/memory-net
npm ci --ignore-scripts --no-audit --no-fund --prefix plugins/memory-net/adapters/dsh
npm ci --ignore-scripts --no-audit --no-fund --prefix mcp/servers/search-core/typescript
npm run build:dsh
~~~

build:dsh只构建，不下载依赖、升级DSH或启用资产。构建产物变化后，按 [宿主验收指南](asset-manager/DSH-HOST-ACCEPTANCE.md) 复验，不能沿用失效的指纹记录。

### Console可选验证

Console有独立workspace锁；需要使用或复跑其UI探针时，先在仓库根执行：

~~~sh
npm ci --ignore-scripts --no-audit --no-fund --prefix plugins/memory-net/console
node asset-manager/probe-console-ui.mjs
~~~

探针默认使用已安装Edge，可通过HUB_BROWSER_EXECUTABLE指定本机Chromium浏览器；不开用户浏览器上下文，不读真实记忆库。干净clone中的固定Console app/server/vendor产物已实测可运行；浏览器未安装时不要把UI验证记为通过。

## DSH记忆与搜索运行包

~~~sh
node asset-manager/cli.mjs dsh-bundle <installed-dsh-directory> --memory
node asset-manager/cli.mjs inspect-dsh-bundle <generated-bundle-directory>
~~~

生成新的独立包，含Skill副本、搜索MCP原生patch和记忆插件运行副本；必须先通过版本指纹验收。当前DSH搜索配置使用static预注册，已修复自有Search-core同批发现/查询导致unknown tool的竞态；旧包需重新生成、明确采用，运行中实例不会自动更新。不会改DSH profile或复制真实记忆库，用户审查后才明确启动。记忆数据默认落包内私有state，不能自动清理。详见 [运行包指南](asset-manager/DSH-BUNDLE.md)。

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

## 历史完整恢复

~~~sh
node asset-manager/cli.mjs export-recovery <new-backup-directory>
# 在目标新checkout中的CLI执行：
node asset-manager/cli.mjs inspect-recovery <backup-directory>
node asset-manager/cli.mjs restore-recovery <backup-directory>
node asset-manager/cli.mjs restore-selection <backup-directory> --approve --reviewer <name> --note <evidence>
~~~

新版恢复包保存当前和全部历史引用版本，内容恢复不启用；最后一步仅在用户批准且目标active.json不存在时发布选择及回滚历史。已有选择、修改或审核/许可不符拒绝；不启动服务。schema1保留内容恢复兼容但不能恢复完整选择。详见 [恢复指南](asset-manager/RECOVERY.md)。记忆库、DSH安装与客户端配置需要另行备份。

## AGENTS.md 拼接

~~~sh
node asset-manager/cli.mjs compose <filled-project.md> <new-AGENTS-candidate.md> --fragments ui-acceptance
~~~

生成完整候选正文及 sources.json，拒绝覆盖已有输出和未填模板。人工检查语义冲突与项目定制后才能替换项目正式规范，不假装工具能自动判断所有矛盾。

## 安全与来源

原本的61项commit误标已区分为本仓导入基线和上游提交；60项上游身份仍未核实，不虚构版本。DOCX/PDF/PPTX/XLSX原LICENSE.txt声明限制，当前默认阻止部署和激活，保留原件用于审核；已有仓库存留的授权问题仍需用户另行核查。详见 [来源治理说明](catalog/PROVENANCE.md)。

- 原有文件按 SHA256 清单迁移，研究证据和许可证不因整理被删除；原始路径映射见 [迁移记录](catalog/audit/migration-2026-11.json)。Git 历史保留重命名来源。
- 厂商集合默认不启用；存在于公开仓库不代表许可允许任意再分发或能跨宿主运行。
- catalog/audit/legacy 是历史记录，不是运行配置；其中旧机器路径和旧安装流程不可作为当前指令执行。
- .asset-state、真实账户、密钥、用户配置和 node_modules 不入库。Console 固定 vendor dist 是已有运行依赖，明确保留。
- 基线锁记录导入版本，实际启用选择位于运行时 active.json；export-locks 生成新的锁文件。备份新启用版本时还必须保存快照，不能只备份锁文件。
