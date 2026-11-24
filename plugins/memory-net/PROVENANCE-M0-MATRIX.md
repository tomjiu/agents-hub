# Memory-net 溯源体系 M0 覆盖矩阵

状态：**M0 现状确认（2026-11-24）**，基于 memory-cache-safe-context 268a6e9（PR7→PR8→PR9 依赖链顶端）。**M1 已于同分支落地（操作账本/不可变修订/精确引用/CAS/重放/导出导入/脱敏，R1-R5 全部转绿，核心 69/69）**，见 [M1 计划](../../docs/superpowers/plans/2026-11-24-memory-provenance-m1.md)与[验收记录](../../catalog/audit/memory-provenance-m1.json)；§5 红灯场景已移入常规套件（14 号转绿 + 15 号 legacy 边界锁定）。本矩阵服务于 [issue #2](https://git.mingjiu.store/sandbox/agents-hub/issues/2) 的 M1-M4 分阶段实施；只依据当前源码与可复现证据，不把历史文档计数当现状。设计依据 [PROVENANCE-DESIGN](PROVENANCE-DESIGN.md)；实施计划见 [M1 计划](../../docs/superpowers/plans/2026-11-24-memory-provenance-m1.md)。

## 1. 已实现（复用基线，不重复实现）

| 能力 | 现状 | 证据 |
|---|---|---|
| 物理隔离 | workspace=独立 SQLite（schema1）；session-v1 按 Agent/项目/会话哈希分库，模型不可指定越界 scope | `db.ts`、`adapters/dsh/src/context.ts`；session-host-0.2.2-rc.5.json |
| 写纪律 | model 仅 inference/tip；observation 仅 tool/host；候选元数据保留字段 | `store.ts` KIND_ALLOWED_ROLES；44 核心测试 |
| 自动观测追加 | P0 后按调用追加（call_id 载荷），不再按 tool 名覆盖；同 key 显式观测仍保留保守覆盖/推翻语义 | `bridge.ts`、11-provenance-p0.test.ts |
| promoted 召回与 GC 闭包 | promoted 进候选；GC 保护 active/promoted 传递依据（含 promote_evidence） | 11/12 号测试、memory-provenance-p0.json |
| 候选生命周期 | 模型 propose→pending 排除精选；host-only 核验（CAS 指纹+reviewer+note+独立证据）→accept 才入精选 | `candidates.ts`、13-candidates.test.ts、review-v1 验收 |
| 缓存安全注入 | 固定 system/工具 schema；literal 尾部快照去重/追加/撤回；诊断计数不注入 | tail-v1 六项检查；memory-cache-real-provider.json（gpt-6.1-sol 6 请求暖缓存加权 99.17%，宿主 rc.1） |
| 精选召回 | curated 视图排除未审阅候选/自动日志；raw 仅显式诊断 | 12-curated-recall.test.ts、curated 验收 |
| 并发取号/写锁 | seq 原子取号；keyed 观测覆盖联动在 BEGIN IMMEDIATE 内；busy_timeout 5s | store.ts nextId/txn |
| 导出/导入（schema1） | 全量当前节点+trail 原子导入；非空目标拒绝 | exportPkg/importPkg |

## 2. 真正缺失（M1-M4 目标；红灯证据见 §5）

| 缺口 | M 阶段 | 说明 |
|---|---|---|
| 操作账本 | M1 | 无 operations 表：成功事务无稳定 op_id/host_instance/seq/durable_event_seq 身份；同持久事件重放不去重（R1） |
| 不可变修订链 | M1 | 节点原地 UPDATE；无 node_revisions/node_heads/revision_links；无 revision 级 CAS（R3/R5） |
| 引用精确到修订 | M1 | based_on 只存节点 id；progress 原地更新导致引用漂移、导出不能复原旧快照（R2） |
| 校验后写入竞态 | M1 | 非 key 观测 add/link/promote/demote/contradict 的引用校验不在写事务内；P0 计划已承认与 GC 并发存在检查到使用窗口 |
| trail 稳定锚点 | M1 | GC 压缩删除重编号，原 step 坐标失效（R4） |
| 崩溃部分发布 | M1 | 多步变更（覆盖+推翻联动、候选核验+状态变更）大多已入事务，但账本缺失使"同事务提交"不可审计 |
| 导出含历史/敏感删除 | M1 | schema1 导出仅当前态；无 sidecar 迁移/备份回滚/降级拒绝；无脱敏失效关联（purge 保护闭包会阻止删除被引用的敏感观测，"不可变"挡住用户删除） |
| ~~宿主会话/代码版本绑定~~ | M2 ✅ | 已落地（evidence.ts + bridge + 21 测试）：code_states/source_refs/evidence_validations 增量表；captured/event_linked/persisted_unknown 三态；digest-only 桥接脱敏；verifyEvidence 无关不失效/同内容不证伪/相关 needs_review 原证据可定位；见 M2 计划与 memory-provenance-m2.json |
| 候选自动提炼 | M3 ✅ | 已落地（distill.ts）：有界/可取消/默认离线 fixture 提取器、队列/每 run/token 预算、失败不阻断原工具；Console 审核面真实点击闭环（probe-console-ui.mjs）；自动产物仅 pending |
| 任务驱动精选 | M3 ✅ | 已落地（recall.ts）：角色分层+词法可解释打分+逐节点入选/排除/预算裁剪理由；100k 增长基准下 Map 索引修复 p95 7.3s→0.56s；多任务 A/B 定量优于最新优先原始臂 |
| 跨会话授权 | M4 ✅ | 已落地（grants.ts）：task_id≠session 显式 grant 注册表、scope/TTL/撤销、readGranted 脱敏只读投影，默认拒绝；见 memory-provenance-m2.json M3+M4 段 |
| 隐私治理 | M4 ✅ | 已落地（privacy.ts）：读取边界脱敏（字段黑名单+密钥形态正则）、副本脱敏不改原件、GC 证据闭包验证；见 memory-provenance-m2.json M3+M4 段 |
| 运行包/跨进程验收 | 终验 ✅ | 已验收（memory-final-acceptance.json）：rc.1/rc.5 × adapter 直连/生成 session 默认运行包四场景，同 session 跨进程恢复、首查含先前 tip、raw 含先前自动观测、单一 scope 目录、归属稳定；100k 增长基准红灯→绿灯（recall p95 7.3s→0.56s）；固定题集多任务 A/B 精选臂全指标优于最新优先原始臂 |

## 3. 迁移风险

1. **schema2 sidecar 与 schema1 共存**：绝不让旧二进制打开 schema2 后把 schema_version 写回 1（`db.ts` 每次打开都 metaSet schema_version——sidecar 必须独立文件、独立版本键，不改 memory.db 的既有语义）。
2. **不重写导入基线**：catalog provenance/locks 与既有 memory.db 不因迁移重写；v1 导出不伪装含历史。
3. **首迁无前史**：迁移只绑定导入时可见快照，origin=legacy_baseline，不补造历史；迁移操作时间≠原始事件时间。
4. **回滚**：sidecar 迁移前整库备份（.bak），恢复=停用实例+备份回放；旧格式拒绝降级打开（明确报错而非静默）。
5. **适配层不动写纪律**：revision/CAS 只在 host 面，模型工具面 schema 稳定，避免破坏 tail-v1 缓存指纹（缓存修复不得回退）。
6. **运行包**：bundle 包内 state 独立；升级指纹重验，不继承失效接受记录（本轮 Linux rc.5 已示范：node_runtime 变化即新指纹）。

## 4. 预算与隐私边界

- **注入预算**：activate 现有 max_nodes/max_tokens 预算与冻结集保留；账本/修订查询走显式接口，不自动注入前缀；无关日志不得产生诊断计数抖动（tail-v1 已锁）。
- **提炼预算**（M3）：频率/token/队列上限、可取消、默认离线 fixture；失败不阻断原工具；不默认调用付费模型。
- **采集边界**（M2/M4）：只记录已有可验证元数据；无 before 标 unknown 不猜测；shell 副作用不伪装已知版本；白名单字段+有界摘要后才持久化；hash 不用于低熵秘密存档。
- **导出边界**：默认不含完整会话/raw 参数/源码/备份；敏感删除/脱敏必须失效关联（M1 末项），不以"不可变"拒绝用户删除。
- **授权边界**（M4）：任务身份≠session ID；跨会话默认拒绝；授权字符串不当 OS 机密。

## 5. 可复现缺陷（红灯证据）

红灯测试：`plugins/memory-net/tests/m1-red/m1-red.test.ts`（隔离临时库；默认套件不含，显式运行）：

~~~sh
npm --prefix plugins/memory-net run build
node --test plugins/memory-net/dist/tests/m1-red/*.test.js
~~~

2026-11-24 运行结果：**5 项全部失败（红灯成立）**，逐项对应：

| ID | 缺陷 | M1 任务 |
|---|---|---|
| R1 | exportPkg 无 operations 账本 | 任务 1 操作身份 |
| R2 | progress 原地更新后导出丢失 before 快照（引用漂移） | 任务 2 精确修订引用 |
| R3 | 冻结墙钟同一毫秒并发写不判冲突（毫秒 CAS 失效） | 任务 1 修订级 CAS |
| R4 | GC 压缩后 trail step 8 重编号为 4（锚点不稳） | 任务 1 稳定操作锚点 |
| R5 | 过期视图 demote 静默覆盖 promote（LWW） | 任务 1 CAS+显式重读 |

无 API 面可测的缺口（无法写编译安全红灯，列为矩阵项）：重放去重坐标（host_instance,session_id,event_seq）、同坐标异摘要拒绝、schema2 导出/导入/降级拒绝、敏感删除失效关联、宿主事件 seq 绑定——均无现存入口，M1/M2 落地时以先红后绿补齐。

## 6. 阶段 schema/兼容/恢复方案（摘要）

| 阶段 | schema | 兼容 | 恢复 |
|---|---|---|---|
| M1 | sidecar `provenance.db`（schema_version=2）：operations、node_revisions、node_heads、revision_links；FK 开启 | memory.db 不动；schema1 导入照旧；sidecar 缺失=无账本（明确 unknown），不阻塞打开 | 迁移前 .bak；sidecar 可整体删除回退 schema1 行为；v2 导出含全部表，导入先校验再原子发布 |
| M2 | source_refs、code_states 表 + 捕获策略版本 | 桥接只增字段；缺元数据=unknown 不补造 | 无 |
| M3 | 候选提炼队列表（有界） | 候选工具 schema 不变 | 队列满/失败不阻断原工具 |
| M4 | grants、retention 策略表 | 默认拒绝跨 scope | 撤销=失效投影非删账本 |

各阶段独立分支→独立 PR→两版固定 DSH（含最新 rc.5 Linux 与 Windows）独立 HOME 验收；指纹变化重新验收。
