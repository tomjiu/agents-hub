---
name: skill-search
description: 按关键词搜索本仓登记的技能与能力资产，输出稳定ID、维护路径和审核状态；新代理找工具、查索引、选择技能时先查本地，不下载或启用未知资产。
---

# 本地技能搜索

以agents-hub仓库根为工作目录，先运行只读检索：

~~~sh
node asset-manager/cli.mjs search-assets "索引" --kind skills --limit 5
node asset-manager/cli.mjs search-assets "memory-net" --kind plugins
node asset-manager/cli.mjs search-assets "search-core" --kind mcp
node asset-manager/cli.mjs skills-status
~~~

search-assets搜索已登记ID、name、description和维护路径，不做语义保证。输出total_matches和前N个候选，不把截断当无结果。选择1–3个候选后执行inspect <id>，阅读catalog/assets/<id>.toml及对应SKILL.md；插件不是Skill，MCP也不是宿主已加载工具。

优先入口：source-index查全仓来源，repository-skills审核缺失能力，asset-management处理版本及部署。web搜索走mcp.search-core，记忆是memory-net插件，不能把它们都当技能文件复制。

禁止仅凭名字判断已安装。declared_restriction表示不可部署；厂商runtime_review_required需审核，不用--reviewed-vendor当法务授权。相同name可能对应不同提供方ID，明确选一个，不混装。

skills-status检查全部canonical SKILL.md的登记、frontmatter、丢失文件和重名；未登记或语法坏的文件先修复，不让它们隐藏在库存中。缺少本地能力时转repository-skills，先提供候选来源及许可/运行时审查，绝不盲目下载执行。
