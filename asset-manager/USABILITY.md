# 索引与真实使用审核

## 状态不是全通过

当前137项登记资产都可逐项检索，但不是可以全装到同一客户端的工具箱。默认DSH结构预检：48 CONTENT_READY、5 CONDITIONAL、84 BLOCKED。48项是技能正文可读；5项是Search-core、Memory-net及三组规范素材需要构建、明确加载或人工组合；84项包含71个厂商技能、4个许可限制技能和9个MCP配置/宿主障碍。数字随实际构建和许可状态变化，以audit-usability为准。

CONTENT_READY没有认证全部脚本、专业任务效果、外部依赖、网络和许可。BLOCKED仍可检索查阅，但不能默认启用。不能为覆盖率删除许可证或接管用户环境。

## 任务到资产

~~~sh
node asset-manager/cli.mjs search-assets "记忆插件" --kind plugins --limit 3
node asset-manager/cli.mjs search-assets "搜索插件" --kind mcp
node asset-manager/cli.mjs search-assets "查找技能" --kind skills
node asset-manager/cli.mjs preflight --expert research --client dsh
node asset-manager/cli.mjs preflight skill-search,source-index,mcp.search-core,memory-net --client dsh
node asset-manager/cli.mjs audit-usability --client dsh
~~~

索引按ID/name/description/path及清单discovery.aliases，精确ID优先、中文长词按二字片段匹配。只读本地，不调用模型或网络、不写索引缓存。结果含usability/blockers/requirements/next_step，Skill元数据以有效版本为准；一个坏Skill不会遮住其他结果。

preflight --installation <dsh-package-directory>额外核验安装包指纹。无安装参数不假装认证宿主。预检不读取密钥值，不启动服务，也不代替对消费项目现有配置的审阅。

## 已实现的冲突保护

- 同客户端Skill name的不同ID、重复选择和重复MCP runtime ID拒绝。
- 清单顶层requires/conflicts是已登记稳定ID数组，组合缺依赖、互斥或循环拒绝，不自动补装。
- Expert排斥在继承与Profile显式追加时保持有效，不被子配方绕过。
- view最终调用相同组合规则，不只是预览检查；原MCP配置合并/原件保护保留。
- 人工复核修正4份工程Skill：using-superpowers不再声称覆盖系统规则或全局强制加载，writing-plans/executing-plans/requesting-code-review在禁止派生时使用inline与self-review。原始导入基线仍保留。

自动预检不保证自然语言指令永远兼容；厂商隐含宿主工具、外部账号与未登记子技能仍需审核。48篇完整正文的一次性provider读取是通道测试，不是推荐所有任务同时加载48篇。

## 证据与边界

probe-usability逐项执行137个精确ID检索、4类中文任务检索和4个Expert预检。document-engineering因4项许可限制被阻止，不伪装成功。CLI子进程验证BLOCKED返回exit1、无自动启用。

HUB_DSH_ALL_USABLE_SKILLS=1配合实际DSH FileSystemSkillProvider运行probe-dsh-skills，验证全部48个内容结构合格技能的发现与读取，正文匹配、无重名和警告；75个厂商/限制Skill排除并说明原因。只验证加载通道，不证明每个专业任务正确。

组合规则及catalog变更纳入DSH指纹，rc.1/rc.5重新验收记忆、搜索、同批发现和Skill回流，不修改用户运行实例。

~~~sh
node asset-manager/probe-usability.mjs
node --test asset-manager/tests/usability.test.mjs asset-manager/tests/discovery.test.mjs
# 先设置HUB_DSH_SKILL_PROVIDER，全部通道测试再设置HUB_DSH_ALL_USABLE_SKILLS=1
node asset-manager/probe-dsh-skills.mjs
~~~

第二层显式资源/离线任务审核见 [任务验收](TASK-ACCEPTANCE.md)：不是只验证加载，还执行了合成Skill打包和合成Git安全归属报告。audit-resources列出真实链接与未解析项；剩余厂商路径必须人工分类，不能将示例当缺失脚本自动补造。

未完成：全部专业任务效果基准、全部脚本依赖执行、所有公网来源、厂商移植/许可授权、任意语义矛盾自动排除。本轮保证可检索和已声明/已检测冲突可拦截，不保证所有库存已运行通过。
