# 面向任务的能力目录与显式路由

## 用户入口

~~~sh
node asset-manager/cli.mjs capabilities
node asset-manager/cli.mjs capabilities --group office --client dsh
node asset-manager/cli.mjs find-capability "需求分析与规划" --limit 3
node asset-manager/cli.mjs find-capability "UI设计和自动化测试"
~~~

[用户目录](<../catalog/CAPABILITIES.md>)是[任务元数据](<../catalog/capabilities.json>)的生成视图。分组office/design/engineering/research/security只是浏览视角，domains与stages表达多维能力；Skill目录仍是原维护位置。首版14条任务路线映射15个不同Skill；122个登记资产尚未进入精选目录（含非Skill），不等于全部都不可用。

## 选择流程

1. 阅读路线coverage/limitations及每个provider的fit/reason/limitations。primary、supporting、alternative是角色，不是合并安装名单。
2. 看mapping_status及usability/blockers/requirements/warnings。source保留来源、许可声明和来源未知状态；CURRENT不等于来源认证。
3. 对选定稳定ID inspect并读实际正文，使用preflight检查组合/宿主；真正部署仍走既有显式批准与完整性流程。任务查找绝不激活、执行、修改profile或写索引缓存。

返回TASK_CANDIDATES表示有文字标签匹配；路线CANDIDATES表示在限定范围内有结构性候选，PARTIAL_CANDIDATE表示只有部分覆盖，UNAVAILABLE表示没有正文映射有效且非BLOCKED的提供方。selectable_candidate也是结构性字段，不是已安装能力、可执行确认、法务批准或任务效果保证。Business排期无专用候选；Word/PPT/Excel/PDF声明许可限制，不能借任务目录绕过。

## 词法范围与限制

find-capability只匹配NFKC规范化、忽略大小写/重复空格后的完整别名或精确路线ID；ASCII两端检查词边界，中文不拆二字片段。多个意图均可保留，limit只截断展示，total_matches不截断。它不是语义模型：否定句、引述、行业上下文、未知任务和缩写不能保证理解，“不要UI设计”仍可能匹配UI设计标签，必须人工检查真实意图，不可据命中自动执行。

无匹配NO_MATCH明确返回空，可显式另查search-assets库存，但不自动用低相关碎片凑候选。通用“自动化测试”当前指向Web应用测试且范围明示，不声称覆盖所有工程测试。下一轮优先扩展已确认的任务别名/范围和真正缺失的工作流，不能只新增名字。

## 映射审查与数据维护

每个提供方reviewed_skill_sha256固定当前实际SKILL.md字节。正文或active有效版本变化导致REVIEW_NEEDED并BLOCKED；需要重新读正文、审查范围/别名/限制，再更新映射，不盲目重算哈希。参考文件/脚本变化未纳入此单文件映射哈希，仍需原资产完整性/许可和部署审查。两次读取间外部文件变动不提供原子快照保证，结果仅为检查当时的候选。

新增路线手动编辑任务元数据，不改catalog/assets或原provenance/locks，不按路径自动分类。JSON严格校验已知字段、引用类型/身份、列表和哈希；未知/重复/不完整CLI选项拒绝。validate仅在任务登记不存在时兼容旧仓库；登记已存在后的加载/校验失败不能被忽略。

生成目录用已有renderCapabilityDirectory(root)纯函数，写出的全文由测试与登记比对。本函数不写文件，正常CLI也无生成写命令。测试开发时使用write工具将函数产出保存到用户目录。详见[实现](<core/capabilities.mjs>)、[专项测试](<tests/capabilities.test.mjs>)和[实施计划](<TASK-CAPABILITY-PLAN.md>)。

## 交付边界

只改本地CLI与目录文档。没有新Skill、移动文件夹、修改运行MCP/插件/Expert/版本锁、合并Memory-net PR4、更新当前Web或认证实际专业产物。自然任务查找回归与执行效果必须分别验收。
