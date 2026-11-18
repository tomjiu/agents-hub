# MCP 配置候选、应用与回滚

## 命令与范围

在仓库根执行。目标是已存在的消费项目，不可为本仓及子目录。只有用户授权项目操作时才应用；批准参数只记录显式动作，不提供身份认证。

~~~sh
node asset-manager/cli.mjs plan-mcp opencode <project> --expert research
node asset-manager/cli.mjs inspect-mcp <change-id>
node asset-manager/cli.mjs apply-mcp <change-id> --approve
node asset-manager/cli.mjs rollback-mcp <change-id> --approve
~~~

省略 --expert 时从同名客户端 Profile 选择 MCP。默认 core Profile 未选服务时明确拒绝，不自动把全仓服务开启。插件安装独立处理；Skill安装仍用 [部署指南](DEPLOYMENT.md) 中的命令。

| 客户端 | 项目目标 | 生成/合并方式 |
|---|---|---|
| OpenCode | opencode.json | 保留无关JSON字段和原有MCP；新服务重名拒绝。已有opencode.jsonc拒绝自动合并，防止配置优先级冲突。格式会重新排版，原始字节另存。 |
| Codex | .codex/config.toml | 新服务以完整mcp_servers.<id>表追加，原TOML字节和注释保留；解析失败或语义变化拒绝。项目可信度/加载仍须实际客户端验证。 |
| DSH | .dsh/agents-hub-mcp.patch.yml | 生成一个服务一个Cordis insert实例，已有实例ID/serverName重名拒绝；保留既有操作及注释。不会改运行中cordis.yml。 |

DSH使用 @deepseek-ai/dsh-mcp-client，stdio或streamable-http配置已按实装0.2.2-rc.1 Config核验。创建patch不等于加载；只在独立宿主测试或用户明确授权的实例中传 --patch。不得将通用mcp.json当成DSH原生配置。

## 工作目录与环境变量

OpenCode配置没有本实现可确认的cwd字段，使用无shell的Node启动器与独立JSON描述符固定cwd，参数按数组传递，&等字面值不作为shell指令。描述符只存环境变量名称，绝不抓取本机凭据值；运行时筛掉凭据形状与DSH_*变量，只有显式登记名称可转发。该名称过滤不是完整凭据扫描。

Codex stdio声明env_vars名称；DSH自身会清理父环境，当前DSH凭据转发和远程MCP授权映射未验证时直接拒绝，不能生成一个貌似正确却没有鉴权的配置。需要这些映射的服务尚不能自动应用。

## 候选与完整性

- plan-mcp不写消费项目，只在忽略的.asset-state/mcp-config/<id>保存候选、原字节及记录。保留视图与OpenCode启动描述符是运行依赖，不应清理仍被应用配置引用的视图。
- 候选、原配置、视图、OpenCode启动器、源码树及绝对脚本入口哈希与审核绑定；应用前改变时拒绝。普通构建输出只绑定入口脚本，不是全依赖锁定或执行时安全监控。
- 现有配置可能含用户敏感字段，候选和原字节也可能含它们。必须把.asset-state视为私有数据；不要上传审阅候选到公开仓库。Unix新文件以0600、目录0700创建，Windows还依赖用户目录ACL，这不是额外ACL加固。
- 自动备份不等于云备份。保存恢复时要连同视图、描述符及对应资产内容，不只保存配置。

## 应用与回滚保护

应用使用本仓状态锁及消费项目共享锁，并再次核对旧配置哈希。写候选后保留原件，再以独占发布创建新目标；并发出现文件时不覆盖。原始备份留在目标旁，回执记录APPLYING/APPLIED；失败保存FAILED和相关恢复产物，不擅自清理。

回滚要求目标仍精确等于已应用候选，且原字节备份哈希通过。将新配置移到独立保留文件，再以独占创建恢复原字节；任意本地编辑阻止回滚，不做自动三方合并。首次新建配置回滚后不再保留发现目标，候选字节仍在保留文件。

APPLYING、ROLLING_BACK和FAILED状态意味着必须inspect-mcp并人工核查；没有自动崩溃恢复或强制覆盖入口。文件系统被外部恶意并发替换、依赖执行期变更、跨平台所有ACL与硬链接行为不在完整保证范围内。

## 已执行验证

[协议探针](probe-mcp-config.mjs)通过真实CLI计划/应用/回滚三个配置，用标准MCP SDK启动真实Search-core服务器：initialize、tools/list及不访问公网的tool_search调用通过。DSH额外验证实装Config。探针只用隔离项目与SC_DATA_DIR，结束回收自建项目、视图及状态。

**这不是实际Codex/OpenCode会话加载，也不是live DSH插件启动。** 配置入口和实际宿主完整调用是两个不同验收层级。
