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
~~~

view 输出一个独立目录，含 Skill 部署副本、来源哈希及配置片段。换成 dsh、codex 或 opencode 可生成对应视图；不会覆盖用户配置，也不会启动远端服务或自动加载插件。

**当前是 v2 基础重构，不是全部客户端一键启用已经验收。** 全量迁移和已完成验证见 [实施状态](catalog/audit/IMPLEMENTATION.md)。

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
