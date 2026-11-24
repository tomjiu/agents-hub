import type { DatabaseSync } from 'node:sqlite';
import { WorkspaceError } from './errors.js';
import type { MemoryNode, NodeKind } from './types.js';
export declare const LEDGER_SCHEMA_VERSION = 2;
/** 同坐标（host_instance+session_id+durable_event_seq）不同摘要 → 拒绝。 */
export declare class LedgerConflictError extends WorkspaceError {
    constructor(message: string);
}
/** 修订 CAS 失败：显式重读后重试，不自动 LWW。 */
export declare class RevisionConflictError extends WorkspaceError {
    constructor(message: string);
}
export type OperationKind = 'add' | 'link' | 'promote' | 'demote' | 'contradict' | 'progress' | 'status' | 'trail' | 'review' | 'gc' | 'redact' | 'import' | 'migration' | 'capture' | 'bind' | 'verify';
export interface OperationInput {
    actor: string;
    operation_kind: OperationKind;
    summary: string;
    session_id?: string | null;
    call_id?: string | null;
    root_call_id?: string | null;
    /** 持久事件序号：与 host_instance+session_id 构成重放坐标；NULL=本地身份。 */
    durable_event_seq?: number | null;
    host_instance?: string | null;
}
export interface OperationRecord extends Required<Omit<OperationInput, 'host_instance'>> {
    op_id: string;
    workspace_instance_id: string;
    seq: number;
    summary_digest: string;
    occurred_at: number;
    committed_at: number;
    capture_policy: string;
}
export interface RevisionSnapshot {
    node_id: string;
    kind: NodeKind;
    text: string;
    payload: Record<string, unknown>;
    based_on: string[];
    status: MemoryNode['status'];
    actor: string;
}
export interface RevisionRecord {
    revision_id: string;
    node_id: string;
    parent_revision_id: string | null;
    op_id: string;
    origin: 'live' | 'legacy_baseline' | 'import' | 'redaction';
    kind: NodeKind;
    text: string;
    payload: Record<string, unknown>;
    based_on: string[];
    status: MemoryNode['status'];
    actor: string;
    created_at: number;
}
export interface RevisionLinkRow {
    revision_id: string;
    referenced_node_id: string;
    referenced_revision_id: string;
    relation: 'supports' | 'derived_from' | 'supersedes';
}
/** 挂载/创建 sidecar 账本。dir 即 workspace 根；返回绑定到同一连接的 Ledger。 */
export declare function attachLedger(db: DatabaseSync, wsDir: string, opts?: {
    workspaceInstanceId?: string;
}): Ledger;
export declare class Ledger {
    private readonly db;
    readonly workspaceInstanceId: string;
    constructor(db: DatabaseSync, workspaceInstanceId: string);
    /** 重放检查（在业务写入前调用）：
     *  - new：无同坐标记录，可继续写入；
     *  - replay：同坐标同摘要 → 幂等重放，返回原 op 修订过的节点（不重复写入）；
     *  - 同坐标异摘要 → LedgerConflictError。
     *  仅当持久坐标三元组（host_instance+session_id+durable_event_seq）齐全时判定。 */
    checkOperation(input: OperationInput): {
        status: 'new';
    } | {
        status: 'replay';
        op_id: string;
        node_ids: string[];
    };
    /** 记录一条成功操作。必须在写事务内调用；失败/回滚由外层事务保证不发布。 */
    recordOperation(input: OperationInput): {
        op_id: string;
        replayed: boolean;
    };
    headRevision(nodeId: string): string | null;
    revision(revisionId: string): RevisionRecord | null;
    history(nodeId: string): RevisionRecord[];
    operationsFor(filter?: {
        kind?: OperationKind;
        session_id?: string;
        limit?: number;
    }): OperationRecord[];
    linksOf(revisionId: string): RevisionLinkRow[];
    /** 依赖此节点任一修订的修订 id（redaction 失效关联用）。 */
    dependentsOf(nodeId: string): Array<{
        revision_id: string;
        referenced_revision_id: string;
    }>;
    /**
     * 提交一个不可变修订并推进 head。
     * CAS：expectedRevision 与当前 head 不符 → RevisionConflictError（显式重读，不自动 LWW）。
     * based_on 依赖在此（写事务内）解析并精确固定为被引用节点的当前 head 修订；
     * pin=false（基线快照）不固定引用——首迁没有更早的可固定对象。
     */
    commitRevision(opId: string, snapshot: RevisionSnapshot, opts?: {
        expectedRevision?: string;
        origin?: RevisionRecord['origin'];
        pin?: boolean;
    }): {
        revision_id: string;
        references: Array<{
            node_id: string;
            revision_id: string;
        }>;
    };
    /** 确保节点存在基线修订：无 head 时以当前快照建 origin=legacy_baseline 首修订（不固定引用）。
     *  供依赖固定与显式迁移使用；不补造更早历史。 */
    ensureBaseline(opId: string, snapshot: RevisionSnapshot): string;
    /** redaction 后追加"依赖已失效"标记修订（不让依赖方静默保持有效）。 */
    markRedactedDependency(nodeId: string, opId: string, actor: string, removed: string[]): void;
    /** 敏感删除：物理移除目标修订及指向它的链接，并给依赖方标记 needs_review。
     *  "不可变"是追加纪律，不是拒绝用户删除的借口。必须在写事务内调用。 */
    redact(target: {
        node_id: string;
        revision_id?: string;
    }, opId: string, actor: string): {
        removed_revisions: string[];
        marked_dependents: string[];
    };
}
/** sidecar 全量导出（schema 2；M2 起有证据数据时导 schema 3 包）。 */
export interface LedgerPackage {
    schema_version: 2 | 3;
    workspace_instance_id: string;
    exported_at: number;
    operations: OperationRecord[];
    revisions: RevisionRecord[];
    heads: Array<{
        node_id: string;
        revision_id: string;
    }>;
    links: RevisionLinkRow[];
    /** M2 证据（仅 schema 3 包；v2 包无此字段）。 */
    evidence?: {
        code_states: import('./evidence.js').CodeStateRecord[];
        source_refs: import('./evidence.js').SourceRefExport[];
        validations: Array<Record<string, unknown>>;
    };
}
/** v2/v3 全量记忆包：v1 记忆包字段 + 完整账本；v3 = v2 + 证据绑定。 */
export interface FullMemoryPackage extends Omit<import('./types.js').MemoryPackage, 'schema_version'> {
    schema_version: 2 | 3;
    ledger: LedgerPackage;
}
export declare function exportLedger(db: DatabaseSync, workspaceInstanceId: string): LedgerPackage;
/**
 * 导入 schema2 账本行到目标 sidecar：先整体校验闭包（引用均可解析）再写入。
 * 不自管事务——调用方（store.importFullPkg）必须在同一写事务内同时导入
 * memory 部分，保证业务行与账本原子发布；目标已有账本内容则拒绝（不覆盖）。
 */
export declare function importLedgerRows(db: DatabaseSync, pkg: LedgerPackage): void;
/** 迁移前备份（memory.db + WAL/SHM 快照拷贝）；返回备份路径。 */
export declare function backupWorkspace(wsDir: string): string;
/** 原子发布：把 from rename 为 to（同目录），失败保留原文件。 */
export declare function atomicPublish(from: string, to: string): void;
/** 删除备份目录（测试清理用）。 */
export declare function removeBackup(path: string): void;
