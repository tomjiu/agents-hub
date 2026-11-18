# 项目级 Skill 部署与撤销

## 已实现的范围

命令读取 catalog/profiles/<client>.toml，展开 Expert 和明确列出的 Skill；选择仍受稳定 ID、名称、来源与类型校验约束。部署是经批准的用户环境动作，不是更新上游内容，也不是自动启用每项仓库资产。

| 客户端 | 项目目录 | 验证层次 |
|---|---|---|
| DSH | .dsh/skills/<name> | 实装0.2.2-rc.1默认项目发现与全文读取通过（隔离ctx） |
| Codex | .agents/skills/<name> | 隔离部署文件验证通过；真实客户端发现待验 |
| OpenCode | .opencode/skills/<name> | 隔离部署文件验证通过；真实客户端发现待验 |

上述路径选择不证明客户端版本通用兼容。不同规则层级或全局同名 Skill 的优先级仍须按实际客户端核验。

## 命令

~~~sh
node asset-manager/cli.mjs plan-deploy dsh <existing-project>
node asset-manager/cli.mjs deploy dsh <existing-project> --approve
node asset-manager/cli.mjs inspect-deployment <existing-project> <deployment-id>
node asset-manager/cli.mjs uninstall <existing-project> <deployment-id> --approve
~~~

项目必须存在，不能是本仓或其子目录。命令不创建或更换Git仓库、不改项目 AGENTS.md、不动全局DSH/其他客户端配置，不启动服务。执行部署的前提是用户已授权该项目操作；--approve记录显式动作，不认证人的身份。

## 所有权与失败保护

- plan-deploy不写消费项目，只生成临时视图供核对，之后回收。
- 目标出现已有同名Skill，一律报冲突，不覆盖、不自动认领。多Skill中有一个冲突就不开始安装其余项。
- 每个项目有独占operation.lock；发现旧锁先人工核查归属，不擅自删除。
- 首次副作用前保存PREPARED回执；每项成功后记录安装结果，结束标INSTALLED。运行失败标FAILED，已完成文件保留；不把已安装但尚未确认的内容直接删除。
- 回执只允许客户端固定目录下的具体Skill，不接受任意路径。暂不提供“自动接管同字节用户文件”或覆盖部署更新。
- inspect-deployment比较完整部署内容，包含新点文件、空目录、node_modules和dist等；不能用源码快照的缓存排除规则掩盖消费项目修改。
- uninstall先检查整组内容；发现任何修改、意外文件、链接或未确认安装即停止，不部分删除其他Skill。
- 通过检查后将各目录移入本项目独立quarantine。原字节与回执保留，REMOVED表示不再位于发现目录，不代表永久销毁。
- 回收中失败尽量移回原位置；若原路径被其他写入占用则保留quarantine并记REMOVING，禁止自动续删，需要人工检查。

## 未实现范围

MCP配置另有 [候选合并与显式应用](MCP-CONFIG.md)，并不安装依赖或保证实际宿主加载。DSH插件自动安装、覆盖更新已有Skill、多用户签名审批、进程崩溃后的自动恢复向导，以及quarantine的自动清理/一键重新安装，均未实现。本轮宁可拒绝，不输出假“安装成功”。

## 可复跑的验证

~~~sh
npm test
# 提供已安装DSH文件系统提供者入口，不修改宿主包：
HUB_DSH_SKILL_PROVIDER=<path-to-dsh-skill-filesystem/lib/index.js> node asset-manager/probe-dsh-deployment.mjs
~~~

Windows可用PowerShell设置同名环境变量。探针创建隔离项目，实际部署、默认发现、全文读取、本地修改阻止卸载、quarantine回收和发现面变空均有断言；最终清理自建浏览器之外的测试文件/目录，不接触用户项目。
