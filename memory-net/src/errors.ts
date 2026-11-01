/** memory-net 可读错误族：所有拒绝路径给可读信息，不裸栈。 */

export class MemoryError extends Error {
  override name = 'MemoryError'
  constructor(msg: string) {
    super(msg)
  }
}

/** 写纪律违规：角色越权（如 model 写 observation）。 */
export class WriteForbiddenError extends MemoryError {
  override name = 'WriteForbiddenError'
  constructor(kind: string, role: string, allowed: readonly string[]) {
    super(`写纪律拒绝：角色 ${role} 不得写入 ${kind}（允许：${allowed.join('/')}）——observation 仅工具桥或宿主，模型/自由文本只能 inference 或 tip`)
  }
}

/** promote 缺证据：无 evidence 且非宿主。 */
export class PromoteNeedsEvidenceError extends MemoryError {
  override name = 'PromoteNeedsEvidenceError'
  constructor(id: string) {
    super(`promote 拒绝：${id} 需要 evidence（观测 id 列表或文本引用）或由宿主（source=user）确认——禁止无依据自动升级`)
  }
}

/** 引用完整性：based_on / link 指向不存在的节点。 */
export class UnknownNodeError extends MemoryError {
  override name = 'UnknownNodeError'
  constructor(id: string) {
    super(`节点不存在: ${id}`)
  }
}

/** workspace 未初始化 / 包损坏。 */
export class WorkspaceError extends MemoryError {
  override name = 'WorkspaceError'
  constructor(msg: string) {
    super(msg)
  }
}
