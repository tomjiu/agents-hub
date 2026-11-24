/**
 * M4 跨会话授权 —— 显式 grant、默认拒绝（issue #2 M4）。
 *
 * 纪律：
 * - 业务任务身份（task_id）与 session ID 分离：grant 只认 task_id，
 *   session_id 仅存在于来源坐标（M2 provenance），绝不是授权键。
 * - 默认拒绝：无 grant 即拒绝读取其他工作区内容；grant 不会"自动"产生。
 * - 不自动读取/混合旧 shared 库：readGranted 是只读投影（脱敏 后的视图），
 *   绝不把对端节点写进本库（物理隔离不破）。
 * - 撤销/过期即时生效；host 专属操作（模型不可 grant/revoke）。
 * - 授权记录是普通 DB 行（含撤销位），不是 OS 机密隔离对象——
 *   工作区文件本身的访问控制由宿主文件权限负责，grant 只管语义边界。
 */
import type { DatabaseSync } from 'node:sqlite';
import type { MemoryNode, NodeKind } from './types.js';
import { type RedactionRules } from './privacy.js';
export interface Grant {
    grant_id: string;
    owner_agent: string;
    /** 被授权的业务任务身份（≠ session_id；session 永不做授权键）。 */
    grantee_task: string;
    /** 可选：限定使用该 grant 的 agent；null=任务内任意 agent。 */
    grantee_agent: string | null;
    /** scope：可读节点类型子集；'all'=全部类型。 */
    kinds: NodeKind[] | 'all';
    created_at: number;
    /** epoch ms；0=不过期。 */
    expires_at: number;
    revoked_at: number | null;
    note: string;
}
export interface GrantInput {
    grantee_task: string;
    grantee_agent?: string | null;
    kinds?: NodeKind[] | 'all';
    ttl_ms?: number;
    note?: string;
}
/** 纯函数：grant 是否对给定调用上下文有效（默认拒绝）。 */
export declare function grantAllows(grant: Grant, who: {
    task_id: string | null;
    agent_id: string;
}, kind: NodeKind, now: number): boolean;
/** 附着到工作区 DB 的 grant 注册表（写方=本工作区宿主）。 */
export declare class GrantRegistry {
    private readonly db;
    constructor(db: DatabaseSync);
    create(owner: string, input: GrantInput): Grant;
    revoke(grantId: string): Grant;
    get(grantId: string): Grant;
    list(): Grant[];
    /** 对给定上下文有效的 grants（默认拒绝的读面辅助）。 */
    effective(who: {
        task_id: string | null;
        agent_id: string;
    }, now: number): Grant[];
}
export interface GrantedReadResult {
    grant_id: string;
    workspace: string;
    nodes: MemoryNode[];
    redacted_fields: number;
    note: string;
}
/**
 * 受 grant 约束的对端工作区只读投影：
 * - 只读：绝不写本库/对端库（不混合 shared 库内容）。
 * - 范围：仅返回 grant.kinds 允许的节点。
 * - 隐私：敏感字段在边界处脱敏（副本），对端原件不可变（账本纪律）。
 * - 默认拒绝：无有效 grant 抛 WorkspaceError。
 */
export declare function readGranted(source: {
    listNodes: () => MemoryNode[];
    grants: GrantRegistry;
}, caller: {
    workspace: string;
    task_id: string | null;
    agent_id: string;
    role: string;
}, grantId: string, opts?: {
    rules?: RedactionRules;
    limit?: number;
}): GrantedReadResult;
