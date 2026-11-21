# DSH 升级与自研资产兼容性

## 验收目标

根据用户最新要求，运行时仅要求DSH可用。Codex/OpenCode配置适配保留，不再列为本次发布的完成门槛。不创建子代理；不更新或重启正在使用的DSH。

## 已核对版本

npm公开查询（2026-11-18，Asia/Shanghai）：latest为0.2.2-rc.1，next为0.2.2-rc.4。当前运行安装包为0.2.2-rc.1。rc.4另以固定版本装在忽略的.asset-state/compat下，npm安装禁用scripts，不替换系统包。

本次两版均在Windows、Node 26.13.1验证。DSH候选0.2.2-rc.4声明Node ≥24.9.0；仓库CLI的Node ≥22.13不能替代宿主要求。

两版独立headless真实测试通过：

- Memory-net记忆插件：真实插件挂载、模型发起写入、提示重组装、SQLite落盘、宿主自动观测和自身过滤。
- Search-core：它是自研MCP服务器，由DSH官方dsh-mcp-client桥加载，不是直接import进DSH的搜索插件。本轮验证生成patch、真实服务启动、工具注册、本地search查询refs与缓存结果回到模型；不证明公网搜索来源、账户余额或所有外部网站当前可用。
- Skill部署与完整正文加载通过。不是仅仅模拟ctx或校验schema。

## 兼容检查命令

~~~sh
node asset-manager/cli.mjs check-dsh <installed-dsh-package-directory>
node asset-manager/cli.mjs check-dsh-upstream
~~~

check-dsh通过返回VERIFIED与exit 0；无匹配证据返回NEEDS_ACCEPTANCE与非零退出。检查对象必须是DSH安装包目录，不是用户profile。

check-dsh-upstream查询公开latest/next，有尚未记录验收的版本则提示ACCEPTANCE_REQUIRED；不下载、安装或启用。现有公网DNS安全规则拒绝时会失败，不能因为npm命令曾成功就绕过DNS固定地址保护。可用人工npm view核对作为补充，不能作为自动审批。

## 为什么版本号不够

[兼容记录](../catalog/runtime/dsh-compatibility.json)按实际验收固定指纹：DSH包和CLI、核心工具/系统提示/技能/MCP/LLM/headless服务lib、base/headless/bundle patch；记忆/搜索源码、完整构建树、相关package-lock、MCP注册配置与视图适配实现，以及Node版本。

DSH同版本文件修改、记忆/搜索代码或编译产物变更都会令旧记录失效。该指纹不是整个node_modules依赖树的安全签名；peer依赖、OS/ACL、公网服务和真实用户配置仍可能不同。不能把一次通过声明成任意新DSH版本可用。

## 升级流程

1. 先查询channels，不动运行版；明确选择固定候选版本，保留运行版及用户配置备份。
2. 在全新隔离目录安装候选DSH，禁止默认覆盖和安装hooks。不把真实凭据复制到测试目录。
3. 按 [真实宿主指南](DSH-HOST-ACCEPTANCE.md) 设置HUB_DSH_INSTALLATION并跑probe-dsh-host.mjs。它构建当前记忆适配包并验证整个Skill/MCP/记忆闭环，不自动更新源码或用户配置。
4. 成功报告写到.asset-state/evidence/dsh-compatibility/<version>-<host-hash>-<asset-hash>-selection.json，失败不生成成功记录。首次测试的记录不会自动成为正式兼容声明。
5. 人工复核测试范围，把经过审阅且无私密数据的报告纳入兼容记录，再跑check-dsh确认。发布记录的改动必须走Git审阅。
6. 只有用户另外明确要求部署升级时，才设计具体运行实例切换及回滚。本次不修改用户live profile。

## 重点接口

记忆插件直接依赖tools.register/output/execute、systemPrompt.section、tools/result事件与effect销毁，这些都可能随DSH变化；结构类型不会发现事件形状或执行语义变更。搜索服务器依赖标准MCP，风险更多集中在DSH bridge、stdio进程和构建/环境约定。两者必须测试结果回流，不只看“启动没有报错”。兼容门槛还要求实际search查询、refs与缓存命中，以及同批发现/查询通过；还必须有explicit_selection_verified：显式provider名单与结果回到模型。旧tool_search-only、串行或未核验选源证据不能批准当前版本。

有新版本或新资产指纹时，门槛只报告未验证，不自动禁用或干扰用户当前运行会话。旧导入provenance不会为消除警告而重写。
