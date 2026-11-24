/**
 * MemoryNet — 共享记忆网核心（v1）。
 *
 * 定位：同目标、多 Agent 分工，维护「一张共享记忆网」。
 * - 一个 workspace = 一个独立 memory.db（物理隔离，关闭不串读）
 * - progress 按 task_id 单行共享；trail 按 run 有序可回放
 * - 写纪律硬门控：model 只能写 inference/tip；observation 仅 tool 桥或宿主
 * - observation/inference 硬隔离：模型结论永远不能以观测身份进入记忆网
 * - activate 预算化：constraint + 当次 progress 永不裁光
 */
import type { AddInput, ActivateOpts, ActivationResult, GcOpts, GcReport, MemoryNode, MemoryPackage, NodeKind, ProgressCtx, ProgressPatch, Role, TrailEntry, TrailStepInput } from './types.js';
import { type CandidateInput, type CandidateReview } from './candidates.js';
import { type Ledger, type FullMemoryPackage } from './ledger.js';
import { GrantRegistry, type Grant, type GrantInput, type GrantedReadResult } from './grants.js';
import type { RedactionRules } from './privacy.js';
import { type EvidenceStore, type CodeStateInput, type CodeStateRecord, type EvidenceBindingInput, type SourceRefRecord, type VerificationResult } from './evidence.js';
export interface OpenOpts {
    /** 绑定写入者身份（默认 'host'）。写入者不可在 add 时冒名。 */
    agentId?: string;
    /** 绑定角色（默认 'host'）：决定写纪律门控。 */
    role?: Role;
    /** 显式 workspace_id（默认目录名）。与库中不符时拒绝打开（防串读）。 */
    workspaceId?: string;
    /** 挂载 schema2 溯源账本 sidecar（provenance.db，ATTACH 同连接同事务）。
     *  默认关闭：既有行为/指纹不变；开启后状态变更强制修订级 CAS。 */
    ledger?: boolean;
}
export declare class MemoryNet {
    private dbo;
    readonly agentId: string;
    readonly role: Role;
    readonly workspaceId: string;
    /** schema2 溯源账本（未挂载为 null）。 */
    readonly ledger: Ledger | null;
    /** M2 证据存储（账本挂载时同步挂载；未挂载为 null）。 */
    readonly evidence: EvidenceStore | null;
    private readonly wsDir;
    private grants_;
    private constructor();
    /** 打开（或创建）workspace。 */
    static open(wsDir: string, opts?: OpenOpts): MemoryNet;
    close(): void;
    private get db();
    /**
     * 原子取号：seq 计数存在 meta 表，RETURNING 原子递增 ——
     * 多实例（多 agent 并发共享同一 workspace）取号不撞 UNIQUE（v1 修：实例内存计数是并发缺陷）。
     */
    private nextId;
    private assertCanWrite;
    private rowById;
    private assertExists;
    /** 跨进程写原子性：BEGIN IMMEDIATE 独占写锁（WAL 下写者互斥），函数式包裹自动回滚。
     *  M1：账本挂载时同一事务覆盖 memory.db + provenance.db（ATTACH 同连接）；
     *  依赖校验一律在事务内进行（消除检查到使用竞态，含 GC 并发）。 */
    private txn;
    /** 账本修订快照（状态主体快照，不含 updated_at 墙钟）。 */
    private snapshotOf;
    /** 公开返回前盖当前 head 修订戳（账本未挂载时原样返回）。 */
    private withRevision;
    private opInput;
    /**
     * 写入节点。progress 不走此入口（用 update_progress）。
     * observation 带 key 时执行覆盖语义：旧同 key 观测 superseded，
     * 且基于旧观测（任一被覆盖版本）的 active inference 自动 contradicted。
     */
    add(kind: NodeKind, input: AddInput): MemoryNode;
    /** based_on 引用完整性：指向的节点必须存在。 */
    private validateBasedOn;
    /**
     * observation 覆盖联动：同 key 旧 active 观测 → superseded；
     * 基于这些旧观测的 active/promoted inference → contradicted（物理事实变了，推断自动失效）。
     */
    private supersedeSameKey;
    get(id: string): MemoryNode | null;
    /** 节点修订历史（账本未挂载时空数组）。 */
    historyOf(nodeId: string): import('./ledger.js').RevisionRecord[];
    /** M3 检索投影读面：全部节点轻量行（不含私有 db 泄漏）。 */
    nodesForProjection(): Array<Pick<MemoryNode, 'id' | 'kind' | 'text' | 'status' | 'run_id' | 'task_id' | 'payload' | 'based_on'>>;
    /** 全量节点列表（M4 grant 视图用：完整行, 脱敏在读取边界做副本）。 */
    listNodes(): MemoryNode[];
    /** 补 based_on 轻量边（from 依赖 to）。账本挂载时为修订变更：必需 expected_revision CAS。 */
    link(fromId: string, toId: string, opts?: {
        expected_revision?: string;
    }): MemoryNode;
    /** Propose an evidence-bound inference, never a physical observation or reviewed fact. */
    proposeCandidate(input: CandidateInput): MemoryNode;
    reviewCandidate(id: string, input: CandidateReview): MemoryNode;
    candidates(opts?: {
        run_id?: string;
        limit?: number;
        status?: 'pending' | 'accepted' | 'rejected';
    }): MemoryNode[];
    /**
     * progress 按 task_id 单行共享：多 Agent 同 task 协作核心。
     * ctx.base_updated_at 提供乐观锁：与库中 updated_at 不符 = 并发写 →
     * 应用传入 patch（后写赢）但 conflict 置位并记录字段级双方值 —— 不静默双真相。
     */
    /** 本工作区 grant 注册表（懒挂载；grants 表在首次访问时建）。 */
    grantRegistry(): GrantRegistry;
    /** 显式授权（host 专属；task 身份≠session；默认拒绝一切未授权跨会话读取）。 */
    grantAccess(input: GrantInput): Grant;
    revokeGrant(grantId: string): Grant;
    grants(): Grant[];
    /**
     * 经 grant 只读投影对端工作区内容（脱敏副本；不写任何库；默认拒绝）。
     * caller 显式给出业务任务身份（task_id ≠ session_id；实例不隐式携带任务上下文，
     * 防止把会话身份误当授权键）。
     */
    readGranted(source: MemoryNet, grantId: string, caller: {
        task_id: string;
    }, opts?: {
        agent_id?: string;
        rules?: RedactionRules;
        limit?: number;
    }): GrantedReadResult;
    updateProgress(taskId: string, patch: ProgressPatch, ctx?: ProgressCtx): MemoryNode;
    /** progress 合并语义保留（多 Agent 协作核心），但冲突判定优先修订级 CAS：
     *  账本挂载时 expected_revision 与写事务内 head 不符 → conflict 置位并记录双方值，
     *  同一毫秒墙钟不再漏判（M1 R3）。 */
    private updateProgressWithinTransaction;
    /** 追加 trail 步（per-run 有界递增序，可回放）。
     *  seq 由单语句子查询原子分配（与 nextId 同款并发纪律）：跨进程并发追加同一 run
     *  不再撞 PK(run_id,seq) 裸 SqliteError——写入锁内取 MAX+1，恒唯一。 */
    appendTrail(runId: string, step: TrailStepInput): TrailEntry;
    /** 按 seq 有序回放 run 的 trail（可复现/排障）。 */
    replayTrail(runId: string): TrailEntry[];
    /**
     * 预算化激活。冻结集（constraint 全部 + 当次 progress）永不裁光；
     * contradicted / demoted / superseded 不进入激活；promoted inference 按 observation 级权重。
     */
    activate(query: string, opts?: ActivateOpts): ActivationResult;
    /**
     * 显式 promote（仅 inference）。需 evidence（存在的节点 id 引用）或 by=user（宿主确认）。
     * 无自动 promote 路径：库内任何写操作都不会自动把 inference 升级。
     */
    promote(id: string, opts?: {
        evidence?: string[];
        by?: 'user' | 'agent';
        note?: string;
        expected_revision?: string;
    }): MemoryNode;
    /** 显式降级（任意 kind）：不参与激活，不物理删除。
     *  角色门控：目标 kind 的写纪律矩阵同样适用于 lifecycle ——
     *  model 不得 demote constraint / observation（host-only），否则冻结集「永不裁光」可被旁路。 */
    demote(id: string, opts?: {
        reason?: string;
        expected_revision?: string;
    }): MemoryNode;
    /** 显式 contradict：推翻一条 inference（evidence 引用观测或文本说明，至少其一——禁止无依据推翻）。 */
    contradict(id: string, opts?: {
        evidence?: string[];
        note?: string;
        expected_revision?: string;
    }): MemoryNode;
    /**
     * gc：trail 压缩（per-run 超保留上限时中间段合并，保留首尾）+ 可选 TTL 降级
     * （仅 tip/inference；observation 默认绝不因 TTL 删）+ 可选 purge（物理清理，
     * 保护存活节点的传递依据（含 promote_evidence））。
     */
    gc(opts?: GcOpts): GcReport;
    private gcWithinTransaction;
    /** 导出单 workspace 记忆包（JSON，含全部节点与 trail）。 */
    exportPkg(): MemoryPackage;
    /** 导入记忆包为新 workspace（id 冲突即拒绝，防止半写状态）。 */
    static importPkg(pkg: MemoryPackage, toDir: string, opts?: {
        agentId?: string;
        role?: Role;
    }): MemoryNet;
    /** schema2 全量导出：v1 记忆包 + 完整账本（操作/修订/head/引用链接）。
     *  仅账本挂载时可用；v1 exportPkg 保持原样，不伪装含历史。 */
    exportFullPkg(): FullMemoryPackage;
    /** schema2 全量导入：memory 部分 + 账本在同一事务内原子发布；目标非空拒绝。
     *  旧入口 importPkg（仅认 schema_version=1）遇到 v2 包会明确报错——降级打开被拒绝。 */
    static importFullPkg(pkg: FullMemoryPackage, toDir: string, opts?: {
        agentId?: string;
        role?: Role;
    }): MemoryNet;
    /** 捕获代码状态（host/tool；声明式：只记录实际观测，缺=unknown 不补造）。 */
    captureCodeState(input: CodeStateInput): CodeStateRecord;
    getCodeState(id: string): CodeStateRecord | null;
    /** 绑定节点 → 代码状态 + 事件坐标 + 文件摘要（host/tool；追加式，旧绑定可定位）。 */
    bindEvidence(nodeId: string, input: EvidenceBindingInput): SourceRefRecord;
    /** 当前生效证据绑定。 */
    evidenceOf(nodeId: string): SourceRefRecord | null;
    /** 全部绑定历史（原证据可定位）。 */
    evidenceHistory(nodeId: string): SourceRefRecord[];
    /** 核验证据（host/tool）：related change → needs_review（追加标记修订，原证据保留）；
     *  无关变化不失效；同内容（含行尾归一）不证伪；当前态不可得 → unknown。 */
    verifyEvidence(nodeId: string, currentCodeStateId: string): VerificationResult;
    private requireEvidence;
    private assertEvidenceRole;
    /** 显式迁移：把 schema1 当前态导入账本为 origin=legacy_baseline 首修订。
     *  迁移前整库备份（memory.db+WAL/SHM）；不补造过去历史；已有账本内容拒绝。
     *  sidecar 可整体删除回退 schema1 行为（账本是可选叠加，不是替代）。 */
    migrateLedgerBaseline(): {
        migrated: number;
        backup: string;
    };
    /** 敏感删除/脱敏：物理移除目标节点（或单修订）的账本历史及指向它的引用链接，
     *  并为每个依赖方追加 needs_review 标记修订——"不可变"是追加纪律，不是拒绝用户删除的借口。
     *  live 行的生命周期仍由 demote/gc 管理；本方法只处理账本历史的删除与关联失效。host-only。 */
    redact(target: {
        node_id: string;
        revision_id?: string;
    }, opts?: {
        note?: string;
        delete_live?: boolean;
    }): {
        removed_revisions: string[];
        marked_dependents: string[];
    };
}
