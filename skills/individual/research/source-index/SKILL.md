---
name: source-index
description: 查找本仓 Skill、MCP、插件、专家配方与上游来源；提供 asset-management 的兼容索引入口，不假定本机外部镜像存在。
---

# 能力资产索引（兼容入口）

以 agents-hub 仓库根为锚点，不使用固定盘符。先读取 skills/asset-management/SKILL.md 的流程。

1. 先运行 node asset-manager/cli.mjs search-assets "关键词" --kind skills --limit 5，本地不足再list；skills-status检查登记、语法和客户端名称限制。需要检索操作说明读skill-search。
2. 读取 catalog/assets/<id>.toml 和 catalog/sources.toml。版本锁在 catalog/locks/，检查策略在 catalog/updates/；存在、启用、客户端加载不是同一状态。
3. 已登记的本地素材优先。外部旧镜像路径只保留在 catalog/audit/legacy/ 中，不作为新环境前置条件。
4. 专业组合读取 experts/<name>.toml；同名 Skill 的不同提供方要显式选择，不全部装入一个客户端视图。
5. 缺少能力时从已登记官方来源找候选，验证 URL、许可、版本及结构；未经审核只下载或暂存，不自动启用。

输出 1–3 个候选：稳定 ID、维护路径、来源、版本、适用理由、未验证事项。不臆造来源或声称已安装。
