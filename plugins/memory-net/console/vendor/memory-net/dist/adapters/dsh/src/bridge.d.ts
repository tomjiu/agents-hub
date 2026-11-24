/**
 * 角色桥：dsh 半区 ↔ memory-net。
 *
 * - host 半区（provide('memory-net') 的 api）：宿主/工具桥持有，全写权限（observation 仅此入口）
 * - model 半区（memory_net_write 工具）：受限句柄，只能 inference/tip——observation
 *   写路径在类型与运行时两个层面都不可达（WriteForbiddenError 双保险）
 *
 * 生命周期：每个 workspace 一个实例，apply 时按需打开，close() 全量清理。
 */
import { MemoryNet } from '../../../src/store.js';
import type { ActivationResult } from '../../../src/types.js';
import type { AdapterConfig } from './config.js';
import type { ToolResultExec, ToolResultPayloadFace } from './contract.js';
/** host 半区 API（ctx.provide('memory-net') 的服务面）。 */
export interface HostApi {
    /** workspace 目录（= 物理隔离载体）。 */
    workspaceDir: string;
    forAgent?: (agent: unknown) => HostApi;
    /** 物理观测写入（仅宿主/工具桥调用；模型工具不可达此方法）。 */
    observe(input: {
        key: string;
        text: string;
        source?: 'tool' | 'user' | 'config' | 'system';
        run_id?: string | null;
        task_id?: string | null;
        payload?: Record<string, unknown>;
    }): ReturnType<MemoryNet['add']>;
    addInference(input: {
        text: string;
        confidence: number;
        based_on?: string[];
        run_id?: string | null;
        task_id?: string | null;
    }): ReturnType<MemoryNet['add']>;
    addTip(input: {
        text: string;
        strategy?: string;
        recovery?: string;
        run_id?: string | null;
    }): ReturnType<MemoryNet['add']>;
    addConstraint(input: {
        key: string;
        text: string;
        mode: 'forbid' | 'require';
    }): ReturnType<MemoryNet['add']>;
    updateProgress: MemoryNet['updateProgress'];
    appendTrail: MemoryNet['appendTrail'];
    replayTrail: MemoryNet['replayTrail'];
    activate: MemoryNet['activate'];
    promote: MemoryNet['promote'];
    demote: MemoryNet['demote'];
    contradict: MemoryNet['contradict'];
    gc: MemoryNet['gc'];
    exportPkg: MemoryNet['exportPkg'];
    proposeCandidate: MemoryNet['proposeCandidate'];
    reviewCandidate: MemoryNet['reviewCandidate'];
    candidates: MemoryNet['candidates'];
    /** 全量关闭（apply 内打开的所有 workspace 实例）。 */
    close: () => void;
}
/** 打开（或复用）一个 workspace 的 host 实例并返回 host API。
 *  closeAll：全量关闭回调（apply 内打开的所有 workspace 实例）——
 *  多 workspace 场景（模型工具传 workspace 参数）下 nets Map 会常开多实例，
 *  close 只关默认实例会泄漏 WAL 句柄（会话 12 P2-4 修复）。 */
export declare function openHostApi(cfg: AdapterConfig, netOf: (dir: string) => MemoryNet, workspaceName?: string, closeAll?: () => void): HostApi;
/** 渲染 ActivationResult 为注入文本（冻结集在前：约束 + 当次进度；trail 摘要收尾）。 */
export declare function renderActivation(r: ActivationResult, diagnostics?: boolean): string;
/** 工具默认预算（config.budgets 展开为 activate opts）。 */
export declare function activateOpts(cfg: AdapterConfig, runId?: string | null, taskId?: string | null, view?: unknown): {
    view: "raw" | "curated";
    run_id: string | null;
    task_id: string | null;
    agent_id: string;
    budgets: {
        max_nodes: number;
        max_tokens: number;
    };
};
/** buildObservation 的产出：可直接投递给 MemoryNet.add('observation') 的内容。 */
export interface AutoObservation {
    key?: string;
    text: string;
    payload: Record<string, unknown>;
    /** M2：原生 read/edit/write 事件的文件摘要证据（digest only，绝不含原文）。 */
    evidence?: {
        files: Array<{
            path: string;
            before_digest: string | null;
            after_digest: string | null;
        }>;
    };
}
/**
 * 'tools/result' 事件 → 观测内容（纯函数无 IO——易测、行为可锁）。
 * 返回 null = 该事件不产生观测：
 *   - 自身记忆工具（memory_net_*）不递归入网（防自指噪声）
 *   - include_error=false 时的失败结果
 *   - include_nested=false 时的嵌套 dispatch（exec.parent 存在；字段缺失 fail-open 视为根调用）
 *
 * 独立调用观测不设状态 key：同工具读取不同主体或重复重验不会覆盖旧依据。
 * 宿主显式 observe 的 subject key 仍用于状态覆盖；工具名/调用 ID 不等于事实主体。
 * 本桥不承诺跨重启去重，也不把执行成功当作用户接受变更。
 */
export declare function buildObservation(ao: AdapterConfig['auto_observe'], exec: ToolResultExec, result: ToolResultPayloadFace): AutoObservation | null;
/**
 * 安装 auto-observe：订阅 dsh-tools 'tools/result' emit 事件，把宿主工具的终态结果
 * 作为 observation 写入默认 workspace（写纪律：observation 仅宿主路径——模型工具不可达）。
 *
 * 三重防线保证宿主工具执行永不受影响：
 *   1) dsh 侧 containment：notifyResult 对 listener try/catch + Promise 兜底（dsh-tools 实勘）
 *   2) 本 listener 全体 try/catch + warn 计数（自我隔离双保险，前 3 次可见）
 *   3) buildObservation 纯函数无 IO，投递前已过滤全部不产生观测的事件形态
 */
export declare function installAutoObserve(ctx: {
    on: (event: string, listener: (...args: unknown[]) => void) => void;
}, cfg: AdapterConfig, netOf: (dir: string) => MemoryNet, opts: {
    warn: (msg: string) => void;
    binding?: (exec: ToolResultExec) => {
        dir: string;
        sessionId: string;
        scopeId: string;
        project: string;
        durableEventSeq?: number | null;
        root?: string;
    };
}): void;
