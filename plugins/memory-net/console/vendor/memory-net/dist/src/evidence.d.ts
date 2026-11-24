import type { DatabaseSync } from 'node:sqlite';
/** 捕获策略版本（policy 版本化：策略变更时新版本号，旧记录按旧策略解释）。 */
export declare const CAPTURE_POLICY = "m2-capture-v1";
/** sidecar 特性版本（前向守卫：库内版本 > 本实现 → 拒绝打开）。 */
export declare const EVIDENCE_FEATURE_VERSION = "m2-v1";
export declare class EvidenceError extends Error {
}
/** 内容规范化：仅行尾 CRLF/CR → LF。空白/Unicode 改写都是内容变化，不归一。 */
export declare function normalizeContent(s: string): string;
/** 规范化摘要（sha256 hex）。 */
export declare function contentDigest(content: string): string;
export interface CodeStateGitInput {
    commit?: string | null;
    status?: 'clean' | 'dirty' | 'unknown';
    /** dirty 时宿主实际看到的改动文件（相对路径）；不可得省略。 */
    changedFiles?: string[];
    /** untracked 文件；完全可知才列全。 */
    untrackedFiles?: string[];
    /** untracked 列表不可得（必须显式声明，不得默认空）。 */
    untrackedUnknown?: boolean;
}
export interface CodeStateFileInput {
    path: string;
    /** 已有 sha256（规范化后）直接给；或给原文由本模块摘要。两者皆缺 = 该文件 unknown。 */
    digest?: string;
    content?: string;
}
export type CaptureSource = 'host_native' | 'git' | 'shell' | 'unknown';
/** 宿主声明式捕获：只记录实际观测到的，其余标 unknown。 */
export interface CodeStateInput {
    root: string;
    source: CaptureSource;
    git?: CodeStateGitInput;
    files?: CodeStateFileInput[];
    /** 宿主显式声明文件枚举覆盖全树（true 才可能 complete）。 */
    fullEnumeration?: boolean;
    notes?: string;
}
export interface CodeStateRecord {
    code_state_id: string;
    root: string;
    git_commit: string | null;
    git_status: 'clean' | 'dirty' | 'unknown';
    completeness: 'complete' | 'partial' | 'unknown';
    files: Record<string, string>;
    changed_files: string[];
    untracked_files: string[];
    untracked_unknown: boolean;
    capture_source: CaptureSource;
    capture_policy: string;
    captured_at: number;
    actor: string;
    notes: string | null;
}
export interface EvidenceFileInput {
    path: string;
    before_digest?: string | null;
    after_digest?: string | null;
}
export interface EvidenceBindingInput {
    code_state_id: string;
    session_id?: string | null;
    durable_event_seq?: number | null;
    call_id?: string | null;
    root_call_id?: string | null;
    files?: EvidenceFileInput[];
}
export type LinkStatus = 'captured' | 'event_linked' | 'persisted_unknown';
export interface SourceRefRecord {
    node_id: string;
    revision_id: string | null;
    code_state_id: string;
    session_id: string | null;
    durable_event_seq: number | null;
    call_id: string | null;
    root_call_id: string | null;
    files: EvidenceFileInput[];
    link_status: LinkStatus;
    bound_at: number;
    capture_policy: string;
    /** 绑定序号与当前位（导出/导入复原历史链用）。 */
    ref_seq?: number;
    is_current?: boolean;
}
export type EvidenceOutcome = 'valid' | 'needs_review' | 'unknown';
export interface VerificationResult {
    node_id: string;
    outcome: EvidenceOutcome;
    /** 证据文件中内容发生变化的（needs_review 依据）。 */
    changed: Array<{
        path: string;
        evidence_after: string | null;
        current: string | null;
    }>;
    /** 证据之外变化的文件（不影响判定，如实列出）。 */
    unrelated_changed: string[];
    validation_id: string;
    verified_at: number;
}
/**
 * 挂载 M2 证据表（幂等）＋特性版本前向守卫。
 * 必须在 attachLedger 之后、同一连接上调用。
 */
export declare function attachEvidence(db: DatabaseSync): EvidenceStore;
export declare class EvidenceStore {
    private readonly db;
    constructor(db: DatabaseSync);
    /** 捕获一个代码状态。规则见文件头纪律；返回记录（含推导的 completeness）。 */
    capture(input: CodeStateInput, actor: string): CodeStateRecord;
    getCodeState(id: string): CodeStateRecord | null;
    mustGetCodeState(id: string): CodeStateRecord;
    private nextRefSeq;
    /** 绑定节点 → 代码状态 + 事件坐标 + 文件摘要。追加式：旧绑定 current=0 保留可查。 */
    bind(nodeId: string, revisionId: string | null, input: EvidenceBindingInput, actor: string): SourceRefRecord;
    /** 当前生效绑定。 */
    currentRef(nodeId: string): SourceRefRecord | null;
    /** 全部绑定历史（原证据可定位）。 */
    refHistory(nodeId: string): SourceRefRecord[];
    /**
     * 核验：以当前 code_state 对照绑定证据。
     *  - 证据文件当前摘要可得且一致（含行尾归一）→ valid（同内容重验不证伪）
     *  - 证据文件变化 → needs_review（记录 validation，不删原绑定）
     *  - 证据文件当前摘要不可得 → unknown（不可访问源码不得伪装为已知版本）
     *  - 证据之外的文件变化 → 不影响判定，列入 unrelated_changed（无关变化不失效）
     */
    verify(nodeId: string, currentCodeStateId: string, actor: string): VerificationResult;
    exportEvidence(): {
        code_states: CodeStateRecord[];
        source_refs: SourceRefRecord[];
        validations: Array<Record<string, unknown>>;
    };
    hasEvidence(): boolean;
    /** 导入前闭包校验 + 写入（目标须为空证据表；调用方事务内）。 */
    importEvidence(pkg: {
        code_states: CodeStateRecord[];
        source_refs: SourceRefRecord[];
        validations: Array<Record<string, unknown>>;
    }): void;
}
/** 导出形状 = SourceRefRecord（ref_seq/is_current 由 refFromRow 填充；导入复原历史链用）。 */
export type SourceRefExport = SourceRefRecord;
