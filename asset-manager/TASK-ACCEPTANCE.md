# 技能资源与离线任务验收

## 本轮范围

从“正文能加载”前进到显式资源与三个可安全离线执行的代表任务，不等于全仓所有技能实跑。未启用厂商或受限Office资产，未使用真实账户。

## 资源

运行 node asset-manager/cli.mjs audit-resources。123个canonical Skill检查Markdown链接与literal scripts/references等路径；归一化./，仓库内../可查，逃出仓库或链接拒绝。FOUND仅说明当前checkout存在；仓库外置文档不会随独立Skill部署自动带走。MISSING必须人工核对上下文，可能是生成输出/示例，不自动补文件。

确认修复：security-ownership-map旧skills/skills命令改为当前canonical路径；search-core旧mcp-exit链接不存在，改为当前DSH验收指南；security-and-hardening及performance-optimization补本地检查表，明确不是找回的上游正文。厂商21个未解析资源保留待审，不擅自改原件。

## 已验收的代表任务

1. skill-creator：CLI打包合成中文Skill，回读ZIP正文及脚本。修复直接运行导入失败、UTF-8读取、空metadata/重复键可通过，以及旧包覆盖、输出进入源、私密/许可/链接材料无保护。现在新路径独占发布，复制读取时核对hash，普通失败清理自有临时包。11项回归通过（包括验证后许可变化和非字符串YAML键）。
2. security-ownership-map：创建仅有两名虚构作者/两个提交的临时Git仓，运行builder和文档runner，核对CSV/JSON及auth查询，源码Git状态不变。修复既有分析输出被覆盖；任何已存在--out（含空目录）拒绝。4项回归通过（包括输出祖先目录链接拒绝）。

## 复跑

需要真实Python（测试3.13.7）及PyYAML6.0.3、networkx3.5。固定依赖由调用者预先安装到私有目录，探针不下载。Windows商店python占位入口本次不可用；显式HUB_PYTHON_EXECUTABLE，勿改运行中工具配置来让测试通过。

PowerShell示例（先替换为实际路径）：

~~~powershell
$env:HUB_PYTHON_EXECUTABLE = "<python executable>"
$env:HUB_PYTHON_DEPS = "<private dependency directory>"
$env:HUB_GIT_EXECUTABLE = "<git executable>"
node asset-manager/probe-python-tasks.mjs
node --test asset-manager/tests/resources.test.mjs
~~~

三个tests/fixtures脚本经探针运行，需HUB_PYTHON_DEPS/HUB_GIT_EXECUTABLE；嵌入式Python忽略PYTHONPATH时，探针会用显式sys.path插入私有依赖，不修改解释器配置。

## 实际资料研究任务

[Memory-net SQLite决策报告](../catalog/audit/research-memory-sqlite.md)由Lead实际使用索引选技能、调用公开Search-core MCP、独立阅读官方版本文档并形成建议。不是脚本化模拟模型预设研究结果。真实搜索返回5引用但降级；Search-core官方全文fetch被DNS保留地址守卫拒绝，全文通过单独Harness reader核验，所以不标“完整搜索/抓取链路通过”。

本次具体已知结论写入临时Memory-net，关闭后另一个Node进程召回，验证inference类型、based_on和持久化。probe-research-memory只重放报告里的固定已核验语句，不会重新证明外部文档真假或研究质量；读取官方引用不等于通过任何自动批准。

~~~sh
# 明确选择真实公网调用，不读取用户搜索配置或凭据：
node asset-manager/probe-research-network.mjs --live
# 指定已审阅的报告，只在临时库重放写入/召回：
node asset-manager/probe-research-memory.mjs catalog/audit/research-memory-sqlite.md
~~~

发现并修正文档问题：搜索Skill首次构建旧路径、Node22旗标笼统说明、记忆插件“上游升级零改动”保证；补source-driven-development索引别名。未修复领域路由覆盖engines或旧nightly优先，也未迁移DatabaseSync兼容别名。实际证据见 [研究任务记录](../catalog/audit/real-research-task.json)。

## 未保证

未遍历全部自然语言中的动态依赖；没有完整Markdown解析器。资源报告不证明可执行/合法。脚本关键词和许可短语拒绝不能代替秘密扫描/法务审查。打包不认证审查者身份、不获得分发权、不保证敌对进程修改路径时完全无竞态；强杀可能留下临时包。归属任务关闭了cochange/communities进行有限合成测试，不认证全部NetworkX输出。

with_server.py已完成17项真实本地服务生命周期回归：端口占用拒绝、2MB启动输出、HTTP正文、启动/命令失败、启动/命令超时、双服务、运行中服务死亡、shell子孙清理、SIGBREAK及Windows强杀父进程、无shell参数/cwd和无效输入。运行流程使用Windows kill-on-close Job Object，先挂载后执行，常规退出回收所有自建服务和命令进程树。

这是Windows/Python3.13.7实测，不认证POSIX强杀清理、脱离进程组/已有daemon、任意占端口竞争或全部浏览器UI。TCP可达仍不是应用正确，预检查到服务启动之间不能跨exec永久预留端口；必须在自动化检查预期页面/API身份与状态。继承输出要求调用方排空自己创建的PIPE；探针只使用临时服务，不启动替代DSH。详见 [服务器生命周期](WEB-SERVER-LIFECYCLE.md)。

真实专业任务效果、全量脚本/外部CLI和厂商移植继续逐项审核。
