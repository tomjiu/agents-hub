# Asset Manager 基础执行引擎

入口：在仓库根运行 node asset-manager/cli.mjs help。固定依赖由根 package-lock.json 管理。

## 已实现

- catalog/assets 元数据读取、稳定 ID/类型/路径校验，四类独立保护策略。
- 来源查询：npm / GitHub；本地来源 MANUAL，厂商来源 RESTRICTED。
- 下载：只接收显式 HTTPS 同登记来源域地址与 SRI，DNS 公网检查并固定地址、无重定向、超时与体积限制；不执行或自动解包。
- 不可覆盖快照、SHA256 清单、基线/本地/新版本三方差异。
- 静态结构验证、需要审查的执行文件提示；并非完整安全扫描或许可证判定。
- 人工批准记录、完整性绑定、过期版本检查、原子启用指针、连续回滚；全局操作锁避免并发写状态。
- 独立客户端 Skill 视图、配置片段与完整 AGENTS 候选，不覆盖用户配置。profile-view <dsh|codex|opencode> 读取对应 Profile，展开 Expert 与显式 Skill/MCP/Plugin 列表，检查类型与存在性并持久化选择记录。
- probe-console-ui.mjs 使用已安装 Edge 或 HUB_BROWSER_EXECUTABLE，在隔离数据上真实点击认证、进度写入、轨迹、激活与统计，并刷新读回 SQLite；不是全 UI/全平台覆盖。

## 项目级部署

plan-deploy / deploy / inspect-deployment / uninstall 为显式批准的项目Skill安装与撤销。已有名称或本地修改不覆盖，卸载完整校验后移入保留区；本轮只处理Skill，MCP/插件选择拒绝部分安装。详见 [部署指南](DEPLOYMENT.md)。

## 持久化与恢复边界

catalog/locks 是导入基线；.asset-state/active.json 是实际选择真相源。export-locks 向全新目录导出选择。新版本的源目录及哈希记录必须一起备份，当前支持已有恢复包的校验恢复；尚未实现从任意远端来源自动恢复全部资产。

版本内容不会在正常更新操作中被覆写；文件系统仍可被外部修改，因此每次使用/启用都验证快照哈希。审批者名字是审计记录，不是密码认证或多用户权限系统。

中断时可能留下 operation.lock；先核对其 PID/时间和状态，再人工恢复，不自动删除可能属于活跃任务的锁。当前未实现自动恢复向导。

export-recovery <new-directory> 可打包启用快照；restore-recovery <bundle> 校验并恢复缺失内容，拒绝覆盖现有版本，不自动启用。已通过隔离恢复用例。

版本元数据状态与验证/批准报告分开保留；检查到更新、下载、静态验证和启用是独立步骤。activate 不重启服务或替换客户端配置。

## 未完成的验收

真实 Codex/OpenCode 加载、DSH live profile 安装、MCP 完整插件视图、市场发现与安装包提取、自动安全解包和语义规范冲突检测尚未完成。已有恢复包的隔离恢复通过；任意远端来源的自动恢复尚未完成。详见 catalog/audit/IMPLEMENTATION.md。

## 模块

core/files：路径边界、快照、哈希与差异。core/catalog：清单、保护策略与 Expert 解析。core/lifecycle：版本状态操作。core/views：部署副本与规则候选。providers/upstream：来源查询与校验下载。tests：隔离的失败、回滚和集成用例。

probe-dsh-skills.mjs 通过 HUB_DSH_SKILL_PROVIDER 指定已安装的 DSH 文件系统提供者，只使用隔离上下文验证当前 Profile 的发现与读取；不修改宿主。

migration.mjs 和 catalog-build.mjs 是本次迁移工具，不是日常更新命令；迁移记录已有时不会重新建立导入基线。
