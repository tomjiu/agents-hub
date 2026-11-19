/** memory-net 可读错误族：所有拒绝路径给可读信息，不裸栈。 */
export declare class MemoryError extends Error {
    name: string;
    constructor(msg: string);
}
/** 写纪律违规：角色越权（如 model 写 observation）。 */
export declare class WriteForbiddenError extends MemoryError {
    name: string;
    constructor(kind: string, role: string, allowed: readonly string[]);
}
/** promote 缺证据：无 evidence 且非宿主。 */
export declare class PromoteNeedsEvidenceError extends MemoryError {
    name: string;
    constructor(id: string);
}
/** 引用完整性：based_on / link 指向不存在的节点。 */
export declare class UnknownNodeError extends MemoryError {
    name: string;
    constructor(id: string);
}
/** workspace 未初始化 / 包损坏。 */
export declare class WorkspaceError extends MemoryError {
    name: string;
    constructor(msg: string);
}
