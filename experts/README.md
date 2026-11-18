# Experts 能力组合

配方仅引用资产 ID，不直接执行任务。支持 extends（检测环）、skills/mcp/plugins 与 optional_*。解析时检查所有引用类型与存在性；optional_* 只表示候选，不默认加入。

core 为最小工程纪律；document-engineering 使用独立文档技能，Trae 候选需显式选择和审查；reverse-engineering 为授权研究工作流；research 引用 search-core TS 默认实现，需先构建。

同名客户端 Skill 不混装。未实现“专家自动成为可执行 Agent”；agents/ 不建立。WorkBuddy 的 curated-experts 只是原始候选证据，没有提升为已审核配方。
