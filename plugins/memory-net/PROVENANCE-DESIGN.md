# Memory-net 操作历史与上下文版本绑定设计

状态：**研究与提议，不是已实现功能**。基线为766dff2；复现记录见[临时库证据](../../catalog/audit/memory-provenance-baseline.json)。本轮仅新增文档和基线探针，当前DSH、SQLite用户库、运行产物与原分析仓均不修改。

## 1. 复用哪些Delta结论

资料入口：[Delta分析索引](<E:/Code/ai/md/audit/_archive/typora-re-analysis/projects/delta/README.md#L7-L25>)、[D1操作/DAG](<E:/Code/ai/md/audit/_archive/typora-re-analysis/projects/delta/deep_dive/D1_history_ops_dag.md#L357-L368>)、[D2写事务路径](<E:/Code/ai/md/audit/_archive/typora-re-analysis/projects/delta/deep_dive/D2_replica_concurrency.md#L183-L206>)、[D4上下文绑定](<E:/Code/ai/md/audit/_archive/typora-re-analysis/projects/delta/deep_dive/D4_thread_worktree_binding.md#L352-L365>)。分析来自Delta0.18.2发布二进制符号/字符串、DDL提取和有限运行探针；64表提取、2表重构不能说成66表均由运行库直读。静态调用图的星级是原报告证据强度，非本轮重跑验证。没有公开DeltaDB核心源码许可，不复制DDL、符号清单或内部序列化协议。

可借鉴：操作拥有稳定身份；对话与工作状态的绑定应持久化；写事务提交与后续副作用区分；物化视图和历史分开。**不借鉴完整CRDT、双父DAG、Lamport副本协议、字符级Anchor、云复制outbox或自研B+树**。我们单机SQLite即可，时间戳仅显示/排序，不能判定事实真伪。原[收口决定](<E:/Code/ai/md/audit/_archive/typora-re-analysis/projects/delta/CLOSURE.md#L48-L62>)属于文档项目，不是禁止Memory-net继续独立设计。

## 2. 8项基线差距

探针运行成功代表下面的缺陷被复现，**不代表缺陷已修复**。

| 问题 | 当前机制 | 影响 |
|---|---|---|
| 无关同工具调用推翻结论 | 自动观测key为tool:read/tool:run_code | 读取B并非A的事实变化，却使基于A的推断contradicted |
| 完全相同结果也推翻 | 同key每次写新观测并覆盖 | 重验没有改变事实仍破坏有效结论 |
| progress引用会漂移 | 同task原地更新节点 | based_on仍指同ID，但原来的before已变成after，导出不能复原 |
| promoted结论漏召回 | SQL只选择active；排序虽定义promoted权重 | 审核过反而不进入候选 |
| promoted依赖可被GC删除 | purge仅保护active inference的based_on | promoted留在库，旧证据消失 |
| trail引用不稳定 | GC删除再重新编号 | 原step8变step4，不能作永久操作锚点 |
| 无匹配日志也占预算 | query只加分，不过滤候选 | observation高权重挤掉精选决策 |
| 工具来源身份丢失 | bridge仅保存call_id和工具名等 | 不保存session/root_call及可识别代码状态 |

代码依据：[覆盖联动](src/store.ts#L196-L294)、[进度](src/store.ts#L310-L374)、[召回](src/store.ts#L411-L446)、[GC](src/store.ts#L549-L617)、[桥接](adapters/dsh/src/bridge.ts#L149-L214)。已存在的observation新节点保留旧正文并非毫无历史；缺的是全种类修订链、稳定来源及可解释的失效关系。trail是路径摘要，不等于完整事件历史。

## 3. 三层模型

### 操作账本：发生过什么

追加 operation：op_id UUID、workspace_instance_id UUID、本库递增seq、actor、operation_kind、session_id/call_id/root_call_id、durable_event_seq（可空）、摘要、发生/提交时间、捕获策略版本。seq用于本库排序，UUID用于导出后定位；workspace名称和n1不足以跨库定位。不要序列化DSH parent/token Symbol，也不要假装可由它恢复持久来源。

首先记录 memory.add/link/progress/status 的成功事务，而非记录全部聊天。工具记录是invocation事件，**工具名不是状态主体**；每个调用记录不同操作，即使内容相同。已提交的源事件重放以(host_instance,session_id,event_seq)去重；同ID不同摘要拒绝并诊断。不具备持久来源坐标时只分配本地操作UUID，不声称重启后去重。

### 记忆修订：我们在当时记住了什么

node_id仍是逻辑记忆，revision_id是不可变快照，parent_revision_id形成单条修订链。首版保存有界完整快照，包含text/payload/based_on/status/actor/provenance，不实现二进制delta压缩。每次成功修改：新operation、新revision、更新current pointer在同一BEGIN IMMEDIATE事务内完成；失败/过期expected_revision不发布成功操作。不用updated_at毫秒作CAS，不靠墙钟判先后。一个事件改变多个节点时用同op_id关联多个revision（覆盖与依赖失效也是原子变更）。

依赖改为精确(referenced_node_id, referenced_revision_id)，另分 relation=supports/derived_from/supersedes。历史引用永不随current指针漂移。查询“依赖当前版本吗”是另一个显式语义，不混到历史supports边。迁移v1依据只能绑定导入时可见快照，标origin=legacy_baseline，缺失过去版本不能补造。迁移操作时间不是原始事件时间。

### 精选投影：下一步该拿什么

默认提示注入精选决策/tip、当前作用域进度、约束。自动工具操作不默认高权重挤入正文；通过指定op/revision或显式evidence查询按预算读取。非空查询无匹配可返回空候选，不用最新日志凑数；约束仍置顶，任务进度需明确task/session，task标识不能作安全权限。

输出附“记忆修订ID、来源定位、有效性状态”，候选不等于已验证事实。检索算法改进晚于引用正确性，首阶段没有向量服务或外部LLM抽取。模型写推断/tip，不能伪造工具观测、宿主版本或审核身份。

## 4. 会话与代码状态绑定

目前DSH rc.1公开类型提供：ToolExecution.callId/rootCallId/agent；Agent.id为SessionId。tools/result是冻结的执行终态，成功value仅存在执行期，持久tool/result事件刻意不含它。session/event是post-commit feed，但它发出不等于磁盘flush；来源可由事件上下文中的session.id与事件seq/type及tool/result的turn/step组合定位，事件本体不假定另含session_id字段。现有适配契约未消费这些字段。**不能把本地operation seq等同DSH日志seq，不能扫描私有会话存储来补缺失身份。**

桥接步骤：先从实际exec.agent.id取session身份（可空且不由模型传参填充）；先记execution-local observation，只有匹配到对应持久session事件后才记录精确durable来源链接，追踪state=captured/event-linked/flushed-or-unknown。父run_code成功与内层调用成功分开：执行成功不是用户接受变更，也不是整个程序成功；父失败不抹掉已产生的文件效果。根/内层关联需求另做有界收集器测试，首版仍保持include_nested默认false，不擅自开启。

只记录已有可验证元数据。文件事件若canonical value中有path/before/after：这是工具返回的文本basis，不保证是原始文件字节；明确normalization。自动抓取whole repo/Git diff不可默认开启，可能泄漏秘密且费用高。选定的绑定代码状态首版为 repo_instance_id + 相对路径 + digest_algorithm/normalization + before/after摘要 + captured_at；Git commit/tree可选，只覆盖tracked版本，**不能代表dirty/untracked工作树**。无before则unknown，不凭当前读取猜写前值。拷贝仓库/分支复用也不能仅靠路径判同一身份。

首次只覆盖宿主原生read/edit/write明确事件；shell/node/第三方工具的文件副作用标unknown。URL字符串、call_id、hash均不认证事实或许可；proof层需权限和来源验证。原始正文继续由DSH/文件源持有，记忆账本保存少量摘要及指针，不另拷贝全聊天。

## 5. 当前有效性与事实状态分离

不可变revision.status保存当时的评价。适用性另为projection：unverified / consistent_with_capture / needs_review / source_unavailable；不是把所有差异都设contradicted。

- B文件变化不影响仅绑定A的决策。
- A同内容重验：operation仍新，结论有效性不因重验失效。
- A的相关摘要变化：绑定仍可回溯旧A，当前使用标needs_review，不自动证伪。
- 无当前摘要/证据被清理/分支不明：source_unavailable或unverified，不能假装“fresh”。
- 只有明确反例或宿主/用户审查才能新建contradicted修订。promoted不是observation，不自动推广模型输出。
- 文件恢复相同摘要，只能说consistent_with_capture，不能恢复人为证伪或覆盖新修订；hash一致也不证明外部行为/运行环境相同。

## 6. 存储与恢复（第二阶段目标）

独立schema2库，新表operations、node_revisions、node_heads、revision_links、source_refs、code_states，FOREIGN KEY开启。单父链足以提供历史解释；并发更新CAS失败后显式重读，不自动LWW。依赖存在性验证也必须在同一写事务内进行，避免GC在校验后、引用插入前删除依据；事务内按状态转换规则重新验证，不只检查读时快照。SQLite事务保证本地history+current一致，不保证与DSH日志跨库原子性；连接补齐失败标unknown并可重放修复。

先做新库sidecar/显式v1导出导入，绝不让旧二进制打开schema2后把schema_version重新写回1。恢复与切换需停用对应实例、备份审核、独立新包与两版DSH验收。schema1导出不偷偷伪装包含完整历史；schema2导出包含表版本/库实例/操作顺序/修订/引用，导入先校验再原子发布新库。首次迁移没有前史。

GC先只降级投影，不删除账本。保留被active/promoted/current或明确pin修订的传递证据闭包；同一调用的多条证据可共享主体，不改身份。后续归档需tombstone清楚标source unavailable及归档边界，备份不是checkpoint剪枝。用户明确删除敏感记录可硬删/脱敏并失效引用；“不可变”是应用追加纪律，不抵抗本机管理员，也不是保留秘密的借口。

日志采集先白名单字段、去敏、有界摘要后才持久化；hash也可能暴露低熵秘密，不对密码/API key做hash存档。导出禁止默认含完整会话/参数/raw源码/恢复备份；隐私和用户授权优先于追溯完整性。

## 7. 范围与次序

1. **P0正确性补丁**：自动工具观测不再tool名覆盖；active/promoted召回与GC证据保护；不新增schema，不默认无限历史注入。详见[可执行P0计划](../../docs/superpowers/plans/2026-11-23-memory-provenance-p0.md)。
2. **P1独立原型**：新库operations+revision/head/CAS+精确边，纯合成fixture测重放、崩溃与导入。不直接启用当前Web。
3. **P2宿主绑定**：实际会话事件坐标、原生文件版本/摘要、根调用关联及捕获策略，测试未知值不补造、监听失败不阻塞原工具。独立rc.1/rc.5宿主。
4. **P3精选召回**：curated/evidence检索面、语义scope区分、needs_review解释；在真实同类任务比较重复排查次数/有效证据/预算占用。

成功场景：关于Web重复tool-skill的决策绑定原会话与A配置修订；读取B不推翻它，改A提示复核，历史引用仍显示原A；GC后仍可定位支持证据。分别测bad-key误失效、同内容重验、progress前后、CAS冲突、promoted入选、证据闭包、外部未知编辑、导出缺引用拒绝、会话绑定缺失标unknown、1000条工具噪音下精选预算。追溯身份与检索效果分开验收。

本轮确认8项基线问题，P0计划5项示例在原实现均失败、在临时修补副本均通过并完成类型检查（[计划验证](../../catalog/audit/memory-provenance-plan-validation.json)）。**没有将P0修复加入正式源码，也没有实现P1/P2/P3或迁移**，没有运行Delta二进制或新增网络账号。仅研究材料本地读取与隔离原Memory-net复现，不代表新系统质量验收。
