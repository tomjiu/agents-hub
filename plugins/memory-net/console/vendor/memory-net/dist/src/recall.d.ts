/**
 * M3 任务驱动精选/证据检索 —— 可解释的召回投影（词法可解释打分，非向量强制前置）。
 *
 * 纪律（issue #2 M3）：
 * - 不用最新日志填满预算：observation（工具日志）默认排除，除非显式 includeLogs
 *   且与查询词法相关。
 * - 区分角色：约束（置顶冻结）→ 当次任务进度 → 已审阅推断（promoted/accepted 候选）
 *   → 建议（tip）→ 相关日志（显式）。
 * - 区分有效性：current / needs_review（M2 标记）/ stale（contradicted|superseded|demoted）
 *   / unknown。
 * - 每个入选/排除节点都有解释（含预算裁剪原因）。
 */
import type { MemoryNet } from './store.js';
import type { MemoryNode } from './types.js';
export type RecallRole = 'constraint' | 'progress' | 'reviewed_inference' | 'tip' | 'observation' | 'candidate';
export type RecallValidity = 'current' | 'needs_review' | 'stale' | 'unknown';
export interface RecallExplanation {
    node_id: string;
    role: RecallRole;
    included: boolean;
    validity: RecallValidity;
    reason: string;
    score?: number;
}
export interface TaskRecallResult {
    nodes: MemoryNode[];
    explanations: RecallExplanation[];
    tokens_used: number;
    budget: {
        max_nodes: number;
        max_tokens: number;
    };
}
/** 查询词法项：CJK 二字片段 + ASCII 词（与 search-assets 同款策略，可解释）。 */
export declare function queryTerms(query: string): string[];
/**
 * 任务驱动精选：角色分层 + 词法相关性 + 预算 + 逐节点解释。
 * 与 activate 的关系：activate 是注入预算引擎（唯一预算语义来源）；本函数是
 * 可解释检索投影（Console/宿主用），不复用其裁剪实现而共享排序纪律。
 */
export declare function recallForTask(net: Pick<MemoryNet, 'get' | 'nodesForProjection'>, query: string, opts?: {
    task_id?: string | null;
    run_id?: string | null;
    includeLogs?: boolean;
    budgets?: {
        max_nodes?: number;
        max_tokens?: number;
    };
}): TaskRecallResult;
