/**
 * M3 可控候选提炼 —— 事件→候选语义提炼（有界、可取消、默认离线）。
 *
 * 纪律（issue #2 M3）：
 * - 默认不调用任何付费模型：默认提取器是离线确定性 fixture 规则；
 *   非离线路径只有宿主显式注入的 custom 提取器（类型面就不存在网络调用）。
 * - 有界：队列上限（满则丢弃并计数）、频率冷却、每 run 提炼上限、token 预算。
 * - 可取消：AbortSignal 贯穿 drain。
 * - 失败不阻断：offer 永不抛给调用方语义错误之外的异常路径；提取器异常计数不上抛。
 * - 自动产物只能 pending：走 proposeCandidate（候选元数据保留来源、指纹去重），
 *   绝不自动 accept；重复相同事件聚合为一条主张（独立事件 ID ≠ 独立实验）。
 */
import type { MemoryNet } from './store.js';
export interface DistillConfig {
    enabled: boolean;
    /** fixture=默认离线规则；custom=宿主显式注入提取器（唯一非离线路径）。 */
    mode: 'fixture' | 'custom';
    /** 待处理事件队列上限（满则丢弃计数）。 */
    maxQueue: number;
    /** 每 run 提炼候选上限。 */
    maxPerRun: number;
    /** 两次 drain 的最小间隔（频率限制）。 */
    minIntervalMs: number;
    /** 累计提炼 token 预算（估算）。 */
    tokenBudget: number;
    /** 每条主张文本上限。 */
    maxTextChars: number;
}
export interface DistillEvent {
    node_id: string;
    run_id: string;
    task_id: string | null;
    kind: string;
    text: string;
    payload: Record<string, unknown>;
}
export interface DistilledClaim {
    text: string;
    confidence: number;
    source_ids: string[];
    run_id: string;
    task_id: string | null;
}
export type DistillExtractor = (events: DistillEvent[], ctx: {
    maxTextChars: number;
    signal?: AbortSignal;
}) => DistilledClaim[] | Promise<DistilledClaim[]>;
export interface DistillStats {
    offered: number;
    queued: number;
    proposed: number;
    dropped_disabled: number;
    dropped_queue_full: number;
    dropped_rate_limited: number;
    dropped_budget: number;
    dropped_cancelled: number;
    dropped_extract_error: number;
    dropped_per_run_cap: number;
    tokens_used: number;
}
/** 词 token 估算（CJK 按字符，ASCII 按词）——粗估即可，宁可高估不越预算。 */
export declare function estimateTokensOf(text: string): number;
/**
 * 默认离线提取器（确定性 fixture 规则，无任何网络/模型调用）：
 * 把「同工具、同结果形态」的重复成功观测聚合为一条保守主张——
 * 重复事件是同一实验的重复观测，不产生多条独立主张。
 */
export declare function defaultExtractor(events: DistillEvent[], ctx: {
    maxTextChars: number;
}): DistilledClaim[];
/** 有界提炼器。非线程安全队列（单进程事件循环内使用）。 */
export declare class Distiller {
    private readonly net;
    private readonly config;
    private readonly extractor;
    private readonly queue;
    private readonly perRunCount;
    private lastDrainAt;
    private tokensUsed;
    private readonly stats_;
    constructor(net: Pick<MemoryNet, 'proposeCandidate' | 'candidates'> & {
        agentId: string;
        role: string;
    }, config: DistillConfig, extractor?: DistillExtractor);
    /** 事件入队（有界）：返回是否入队；永不因提炼侧问题抛错阻断调用方。 */
    offer(event: DistillEvent): boolean;
    /** 处理队列（频率冷却 + 预算 + 每 run 上限 + 取消）。同步可等待，绝不抛提取器异常。 */
    drain(signal?: AbortSignal): Promise<void>;
    stats(): Readonly<DistillStats>;
}
