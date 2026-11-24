/**
 * M4 隐私 —— 捕获白名单与敏感字段脱敏（issue #2 M4）。
 *
 * 纪律：
 * - 脱敏发生在**读取边界**（跨工作区 grant 视图 / 导出投影），
 *   原件永不被改写（修订账本的不可变纪律；敏感删除走 ledger.redact 显式操作）。
 * - 规则可配置：字段名黑名单（payload 键）+ 文本模式（密钥形态）。
 * - 默认规则保守：常见凭据字段与密钥形态一律掩码。
 */
import type { MemoryNode } from './types.js';
export interface RedactionRules {
    /** payload 中命中的字段整值掩码（大小写不敏感子串匹配字段名）。 */
    fields: string[];
    /** 文本/字段值中命中的正则替换（密钥形态）。 */
    patterns: Array<{
        re: RegExp;
        replacement: string;
    }>;
}
export declare const DEFAULT_REDACTION_RULES: RedactionRules;
export interface RedactionResult {
    node: MemoryNode;
    masked: number;
}
/** 单节点脱敏副本（不改原件）。返回掩码命中数（字段级 + 文本级）。 */
export declare function redactNode(n: MemoryNode, rules?: RedactionRules): RedactionResult;
