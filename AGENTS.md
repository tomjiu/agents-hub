# agents-hub — 新代理入口与开发规范

本仓是**Agent能力资产管理与DSH集成中心**，不是已全部加载的工具箱。运行时目标只要求DSH；Codex/OpenCode适配保留但不承诺兼容。**不要创建子代理**，除非用户之后明确改变偏好。先确定cwd、分支和已有改动，再读 [README](README.md) 与 [实施状态](catalog/audit/IMPLEMENTATION.md)。历史验收不是当前版本自动可用的保证。

## 1. 先用这四类能力

| 需要 | 登记ID／入口 | 怎么用 |
|---|---|---|
| 搜索资料、官方文档、最新信息 | mcp.search-core；[搜索Skill](skills/individual/research/search-core/SKILL.md) | DSH加载后工具为mcp__search-core__search、mcp__search-core__fetch、mcp__search-core__tool_search；query一句话，结果空/降级如实报告。发现后用research做复杂研究。当前适配static预注册防止并发发现掉工具，不用旧动态配置。 |
| 记住进度、决策、已验证结论 | memory-net；[DSH记忆适配](plugins/memory-net/adapters/dsh/README.md) | 宿主已加载时先memory_net_recall({query:当前任务})；完成可复用小阶段后memory_net_write({kind:"inference",text:结论,confidence:0.8})或kind:"tip"。不向记忆写密钥、未验证结果；observation只由宿主写。没有工具就报告未加载，不假装有记忆。 |
| 找仓库内容和上游索引 | source-index；[索引Skill](skills/individual/research/source-index/SKILL.md) | 查看catalog/assets与catalog/sources；先查本地登记ID、路径和版本，再查外部来源。旧E盘镜像不作前置。 |
| 搜索/选择合适技能 | skill-search；[技能搜索Skill](skills/individual/research/skill-search/SKILL.md) | search-assets只读检索，下文命令；取1–3候选、inspect后读对应SKILL.md，不能把搜索结果当启用。 |

按需再读 [资产管理](skills/asset-management/SKILL.md)、[来源审核](skills/individual/research/repository-skills/SKILL.md)、systematic-debugging与verification-before-completion。core Expert预选上述索引/搜索技能及工程纪律；research在core之上加搜索Skill与MCP。记忆插件仅在dsh-bundle --memory时显式加入，**不默认读用户现有库**。

## 2. 新代理怎样发现并使用登记

以下命令在仓库根执行（Node/npm；若依赖未装按README先npm ci --ignore-scripts）：

~~~sh
node asset-manager/cli.mjs search-assets "索引" --kind skills --limit 5
node asset-manager/cli.mjs search-assets "search-core" --kind mcp
node asset-manager/cli.mjs search-assets "memory-net" --kind plugins
node asset-manager/cli.mjs inspect source-index
node asset-manager/cli.mjs expert research
node asset-manager/cli.mjs skills-status
node asset-manager/cli.mjs preflight --expert research --client dsh
node asset-manager/cli.mjs audit-usability --client dsh
node asset-manager/cli.mjs audit-resources
~~~

search-assets搜索本地ID/name/description/path与登记discovery.aliases，中文长词按二字片段匹配、精确ID优先。支持skills、mcp、plugins、agents-md；结果含当前usability/blockers/requirements/next_step，不是语义搜索或远端安装。skills-status列出canonical文件、登记缺漏、坏frontmatter、同名提供方。一个name可有多个ID，例如docx与trae.docx，不一起混装。看到源码不能声称宿主已加载。preflight检查组合重名/依赖/声明冲突/MCP运行ID及许可、宿主障碍，BLOCKED返回非零、不写视图。audit-usability检查全部登记。CONTENT_READY只指内容可读，CONDITIONAL有额外步骤，BLOCKED有障碍；不是法务批准或任意指令无语义冲突保证。详见 [使用审核](asset-manager/USABILITY.md)。

- 真相源：[catalog/assets](catalog/README.md)稳定ID → canonical path；[experts](experts/README.md)只引用ID；[MCP注册表](mcp/registry.toml)定义运行命令；版本选择在私有.asset-state/active.json。
- [skills目录](skills/README.md)：individual按工程/文档/安全/研究分组；collections/vendors保留厂商内部结构；asset-management是通用管理入口。运行副本不能变成第二维护源。
- source.kind=local的URL通常是维护位置，不证明第三方真实来源；import.baseline_commit不是上游提交。[许可与来源](catalog/PROVENANCE.md)中未知项必须保留未知。

## 3. DSH加载、构建和升级

已经有工具时优先使用；没有时不要只复制Skill就宣称插件安装完毕。根npm ci不安装子包依赖，按README固定安装三个子包后npm run build:dsh。

~~~sh
node asset-manager/cli.mjs check-dsh <installed-dsh-package-directory>
node asset-manager/cli.mjs dsh-bundle <installed-dsh-package-directory> --memory --expert research
node asset-manager/cli.mjs inspect-dsh-bundle <generated-bundle-directory>
~~~

check-dsh对**安装包目录**和当前记忆/搜索源码/编译指纹核对；VERIFIED不是升级授权。运行包有明确launch参数，用户审查后才明确启动独立profile；当前GUI/profile不修改、不重启。私有state默认包内memory-net/search-core，不接管真实记忆、搜索或模型凭据。

DSH发布可能改变tools/register/output、systemPrompt/section、tools/result、effect和MCP桥语义。新版本先check-dsh-upstream，再独立固定版本安装及 [真实宿主测试](asset-manager/DSH-HOST-ACCEPTANCE.md)，不能用编译通过代替实际工具、结果回流和SQLite。宿主探针默认同批发现/搜索；串行诊断不能批准兼容。具体支持版本与证据以 [兼容登记](catalog/runtime/dsh-compatibility.json)为准，不信硬编码“永远兼容”。

## 4. 新资产登记与更新

1. 先search-assets确认没有同一来源重复登记，读repository-skills工作流。可添加discovery.description/aliases；确认的依赖/互斥写顶层requires/conflicts稳定ID数组，预检不自动安装，不能用声明替代正文审核。
2. 登记catalog/assets/<id>.toml：id/kind/path、source身份与许可、上游版本（未知就未知）、version内容哈希；新增provenance/<id>.json记录首次文件基线。不重写旧基线隐藏本地修改。
3. 四类 [updates/locks](catalog/README.md)相互独立；日常不运行catalog-build或migration重建整个登记。前者是首次导入器，不是新增按钮。
4. 新版本独立stage → validate-version →实际许可/依赖/运行审查→approve→activate。approve记录人工决定，不认证审核者身份。activate仅指针；客户端需新运行包才能采用，MCP/记忆新快照须有独立编译验收。
5. export-recovery保存历史完整快照，restore-recovery只恢复内容，restore-selection只在明确批准及无active.json的新环境恢复选择，不启动服务。见 [恢复指南](asset-manager/RECOVERY.md)。

厂商71项需许可/宿主复核；DOCX/PDF/PPTX/XLSX本地许可有限制，不能通过reviewed-vendor绕过。静态扫描不是安全/法务批准；当前仓库保留证据不等于获得分发权。未知外部内容不自动执行。WorkBuddy原生插件不是DSH插件。

## 5. 开发、验证、提交

- 保留用户改动；不建立根agents/、skill-packs/或通用projects/；不覆盖项目定制或运行态。
- 每个可验证小阶段及时提交代码＋文档；先看git status和diff，固定分支/远端/授权，不上传凭据、恢复包、日志、node_modules或.asset-state。
- 根npm test与npm run validate；改搜索再跑TS原测试，改记忆再跑核心/adapter测试。测试夹具不等于真实账户，SKIP不算PASS。
- UI变更实际点击 →请求→状态落盘→响应→刷新回读；不要用服务单测替代。两版宿主/新版本用独立HOME/DSH_HOME、本地模拟模型、关闭遥测，清理自己进程和测试数据。
- 生命周期改变验证取消、失败、旧文件不变、哈希/审批一致、连续回滚、恢复、并发锁；public网络拒绝不要通过绕过DNS守卫“修复”。
- 规范通过agents-md compose产生完整新候选，原项目AGENTS.md不被共用模板覆盖；语义冲突需人工审查。
- GitHub复用已有PR，按有效批次推送；合并前核对PR头SHA、本地检查、必需CI，不频繁重复触发。没有CI检查不能宣称CI已通过。
- 运行中DSH不在本仓修改范围。资源回收先核对归属，用户数据/记忆库不能因目录像缓存被清理；通用方法归Skill，版本/事故证据归项目文档。
