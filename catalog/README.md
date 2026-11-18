# Catalog

- assets/<id>.toml：稳定 ID、类型、维护路径、来源、许可及基线信息。
- sources.toml：从旧索引迁移的来源 URL；不暗示已克隆或已审核。
- updates/{skills,mcp,plugins,agents-md}.toml：四类独立策略。默认检查/下载允许，自动应用禁止；不得覆盖或自动合并。
- locks/*.lock.toml：初始版本和哈希。运行时启用指针单独保存，export-locks 导出新的选择记录。
- provenance/<id>.json：本次导入时逐文件基线，用于本地修改三方比较。不可随本地改动更新以掩盖差异。
- profiles/*.toml：客户端选择意图；enabled=false 表示不自动安装。profile-view <client> 展开 Profile 的 Expert 与显式资产引用，生成独立视图和选择记录；不覆盖用户配置。deploy <client> <project> --approve 支持显式项目Skill部署，保持Profile默认不自动安装；plan-mcp和apply-mcp支持保留原件的显式项目配置，插件安装及真实Codex/OpenCode加载仍待验证。
- audit：迁移映射、上游差异和实施验证记录。
- audit/legacy：不参与自动加载的历史说明、注册表和路径，不作为当前执行指令。

ID：独立 Skill 保留原名字；集合 Skill 使用 trae.<name> 或 workbuddy.<内部层级>；MCP 使用 mcp.<server>，避免与 Skill 重名；插件为 memory-net；模板为 agents-md.*。

来源身份、导入基线和上游提交必须分开，详见 [来源治理说明](PROVENANCE.md)。audit-provenance只读核对当前元数据；原始locks/provenance不重写以掩盖差异。

许可按已有声明登记，不通过猜测补齐。review-required 表示仍需核实；vendor-restricted 默认不部署。不得据这些字段断言再分发获得法律许可。
