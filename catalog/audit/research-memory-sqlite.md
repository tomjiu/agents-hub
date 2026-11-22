# 实际研究任务：Memory-net 的 Node SQLite 适用性

## 结论

**建议保留 SQLite 作为有界、同机的任务记忆存储；不把它宣称成语义 RAG 或无限并发数据库。** 当前 Node v26.13.1 能运行既有 DatabaseSync 用法，但官方同版本文档已将其标为 Database 的弃用兼容别名。应做独立兼容迁移，不在本次研究中直接替换宿主依赖。

这份报告由当前 Lead 实际检索、阅读和判断，不是脚本化模型预设答案，也不是独立审稿。检索、全文抓取、推断与运行实测分别记录。

## 任务与能力选择

任务：判断本仓共享任务记忆的存储和检索限制，给接手代理可执行的使用建议。

1. 用search-assets“官方文档”获得19个候选，前3项有2项厂商障碍，不是高质量推荐保证；最终据精确ID读取source-driven-development、search-core、source-index和skill-search。
2. preflight选择上述4技能、mcp.search-core、memory-net，没有重名/许可阻止，但运行能力状态为CONDITIONAL。测试使用已构建源码、隔离SC_DATA_DIR/HOME和临时memory.db，不接管DSH用户profile。
3. 真实MCP请求搜索Node SQLite，未使用收费key、本地搜索fixture或模拟模型。
4. 检索结果不是充分证据：阅读版本固定的官方全文，并检查本地store/db/activate实现，最后实际写入和关闭后跨进程召回。

## 真实搜索与失败

首次搜索耗时约8.1秒，返回5条引用、degraded=true，多个来源超时或限流。首位结果是旧v26 nightly文档，不可据此判断当前v26.13.1 API。

传入engines=[duckduckgo,bingrss,yahoo]，实际meta.engines_used含github、mdn、keenable、bingrss；编程专线路由会改写执行引擎。**显式选源不等于严格只请求这些来源**，这是本次实际体验发现的限制，尚未修复。不要把它用作隐私、来源预算或允许列表控制。

Search-core fetch官方Node/SQLite页面因DNS返回198.18.x保留地址被SSRF守卫拒绝。没有关闭守卫、没有宣称抓取成功。随后由Harness web_fetch独立读取官方页面，作为明确标注的替代阅读工具，而非Search-core完整链路通过。

## 官方来源与本地对应

### 1. Node版本与同步调用

官方[Node v26.13.1 SQLite文档](https://nodejs.org/docs/v26.13.1/api/sqlite.html)给出：

> Node 26.13.1: DatabaseSync is a deprecated alias for Database; both APIs are synchronous.

官方原文分别为“DatabaseSync is a deprecated alias for Database”以及“All APIs exposed by this class execute synchronously”。文档标Stability 1.2 Release candidate，不是Stable 2。当前运行时实测Database和DatabaseSync均为function、两者同一对象，SQLite版本为3.54.1。这证明当前别名可运行，不证明未来删除后仍兼容，也不证明高负载下延迟。

[Node v22.13.0 SQLite文档](https://nodejs.org/docs/v22.13.0/api/sqlite.html)仍使用DatabaseSync且为active development；v26文档历史写明v23.4.0/v22.13.0开始无需--experimental-sqlite。本仓README写“22.x需旗标”过宽，应区分22.5–22.12与22.13+。本次只有26.13.1运行实测，22系结论来自版本文档，未安装重跑22系。

v26网页返回被读取工具截断；上述相关段落位于返回内容内已核对，未声称审阅完整API全文。

### 2. WAL并发与存储位置

官方[SQLite WAL文档](https://www.sqlite.org/wal.html)明确：

> SQLite WAL allows only one writer at a time and requires the same host; it does not work over a network filesystem.

原文“there can only be one writer at a time”及“WAL does not work over a network filesystem”。读写可并行不等于多个写者同时执行；checkpoint与SQLITE_BUSY仍需考虑。

本地[db.ts](../../plugins/memory-net/src/db.ts)设置WAL与busy_timeout=5000；[store.ts](../../plugins/memory-net/src/store.ts)使用BEGIN IMMEDIATE保护共享写操作。建议保持本机独立workspace、短事务、显式关闭和失败回退，**不将活跃memory.db放到网络盘并让多机器共享写入**。若需要跨机器，用已有export/import或另建受审查同步方案。

### 3. 召回不是语义搜索

本地[activate.ts](../../plugins/memory-net/src/activate.ts)按空白/标点分词，使用字符串包含加分，再按节点类型、新鲜度、置信度和预算筛选。activate不会保证只返回与query相关的节点；小库可能在无匹配时也返回高权重节点。

建议：结论采用简短、有明确关键词的文本，使用task_id/run_id与based_on记录上下文；调用方核对节点内容和来源，不把“返回节点”当语义相关证明。当前测试仅验证特定已知结论可跨进程读回，不测长文本语义召回率或多任务隔离效果。

## 可执行决策

- 保留本机SQLite与已有schema，不因弃用别名立即换数据库。
- 新代理回忆前明确workspace/task/query，写结论用inference和confidence，不写伪造observation；保留based_on。
- 记录运行Node版本，不把旧nightly搜索结果当当前API说明。
- 后续单独迁移DatabaseSync：优先检测Database可用再回落旧别名，配套Node22/24/26与DSH宿主回归。本次不实施迁移。
- 负载出现阻塞时先测p95/p99及写锁等待，再考虑worker隔离；目前无吞吐/延迟证据，不用“SQLite很快”代替测量。
- 搜索严格选源需求先修复专线路由语义；官方全文被守卫拒绝时明确失败，可用用户允许的独立读取工具，不关闭SSRF。

## 记忆验收与边界

probe-research-memory以本报告为输入；核对报告中引用及结论，再将两条已阅读官方证据写入tool角色observation，推断写入model角色inference，关闭连接后在另一Node进程activate召回，检查类型、status、based_on和正文。SQLite临时库结束即清理，公开证据只留摘要。

这不是新DSH会话中真实付费LLM自主完成所有步骤，也不是无技能对照实验。真实Lead完成研究，Search-core提供部分检索，全文阅读另用Harness，Memory-net核心完成持久化与召回；宿主插件链路此前另有隔离验收。不能将一次决策报告推广成全部技能效果基准。
