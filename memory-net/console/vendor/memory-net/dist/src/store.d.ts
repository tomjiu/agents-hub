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
export interface OpenOpts {
    /** 绑定写入者身份（默认 'host'）。写入者不可在 add 时冒名。 */
    agentId?: string;
    /** 绑定角色（默认 'host'）：决定写纪律门控。 */
    role?: Role;
    /** 显式 workspace_id（默认目录名）。与库中不符时拒绝打开（防串读）。 */
    workspaceId?: string;
}
export declare class MemoryNet {
    private dbo;
    readonly agentId: string;
    readonly role: Role;
    readonly workspaceId: string;
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
    /** 跨进程写原子性：BEGIN IMMEDIATE 独占写锁（WAL 下写者互斥），函数式包裹自动回滚。 */
    private txn;
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
     * 基于这些旧观测的 active inference → contradicted（物理事实变了，推断自动失效）。
     */
    private supersedeSameKey;
    get(id: string): MemoryNode | null;
    /** 补 based_on 轻量边（from 依赖 to）。 */
    link(fromId: string, toId: string): void;
    /**
     * progress 按 task_id 单行共享：多 Agent 同 task 协作核心。
     * ctx.base_updated_at 提供乐观锁：与库中 updated_at 不符 = 并发写 →
     * 应用传入 patch（后写赢）但 conflict 置位并记录字段级双方值 —— 不静默双真相。
     */
    updateProgress(taskId: string, patch: ProgressPatch, ctx?: ProgressCtx): MemoryNode;
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
    }): MemoryNode;
    /** 显式降级（任意 kind）：不参与激活，不物理删除。
     *  角色门控：目标 kind 的写纪律矩阵同样适用于 lifecycle ——
     *  model 不得 demote constraint / observation（host-only），否则冻结集「永不裁光」可被旁路。 */
    demote(id: string, opts?: {
        reason?: string;
    }): MemoryNode;
    /** 显式 contradict：推翻一条 inference（evidence 引用观测或文本说明，至少其一——禁止无依据推翻）。 */
    contradict(id: string, opts?: {
        evidence?: string[];
        note?: string;
    }): MemoryNode;
    /**
     * gc：trail 压缩（per-run 超保留上限时中间段合并，保留首尾）+ 可选 TTL 降级
     * （仅 tip/inference；observation 默认绝不因 TTL 删）+ 可选 purge（物理清理，
     * 保护被 active inference 引用的行）。
     */
    gc(opts?: GcOpts): GcReport;
    /** 导出单 workspace 记忆包（JSON，含全部节点与 trail）。 */
    exportPkg(): MemoryPackage;
    /** 导入记忆包为新 workspace（id 冲突即拒绝，防止半写状态）。 */
    static importPkg(pkg: MemoryPackage, toDir: string, opts?: {
        agentId?: string;
        role?: Role;
    }): MemoryNet;
}
