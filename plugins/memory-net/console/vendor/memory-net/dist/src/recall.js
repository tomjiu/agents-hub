import { candidateMeta, candidateReason } from './candidates.js';
import { estimateTokensOf } from './distill.js';
/** 查询词法项：CJK 二字片段 + ASCII 词（与 search-assets 同款策略，可解释）。 */
export function queryTerms(query) {
    const terms = new Set();
    const ascii = query.match(/[A-Za-z0-9_.-]{2,}/g) ?? [];
    for (const w of ascii)
        terms.add(w.toLowerCase());
    const cjk = query.match(/[\u4e00-\u9fff]/g) ?? [];
    for (let i = 0; i + 1 < cjk.length; i++)
        terms.add(cjk[i] + cjk[i + 1]);
    if (cjk.length === 1)
        terms.add(cjk[0]);
    return [...terms];
}
function relevance(text, terms) {
    if (terms.length === 0)
        return 0;
    const lower = text.toLowerCase();
    let hits = 0;
    for (const t of terms)
        if (lower.includes(t))
            hits++;
    return hits / terms.length;
}
function validityOf(n, get) {
    if (n.status === 'contradicted' || n.status === 'superseded' || n.status === 'demoted')
        return 'stale';
    if (n.payload && typeof n.payload.needs_review === 'object' && n.payload.needs_review !== null)
        return 'needs_review';
    if (n.payload && typeof n.payload.memory_candidate === 'object' && n.payload.memory_candidate !== null) {
        return candidateReason(n, get) === null ? 'current' : 'unknown';
    }
    return 'current';
}
/**
 * 任务驱动精选：角色分层 + 词法相关性 + 预算 + 逐节点解释。
 * 与 activate 的关系：activate 是注入预算引擎（唯一预算语义来源）；本函数是
 * 可解释检索投影（Console/宿主用），不复用其裁剪实现而共享排序纪律。
 */
export function recallForTask(net, query, opts) {
    const terms = queryTerms(query);
    const maxNodes = Math.max(2, opts?.budgets?.max_nodes ?? 24);
    const maxTokens = Math.max(256, opts?.budgets?.max_tokens ?? 8000);
    const includeLogs = opts?.includeLogs === true;
    const rows = net.nodesForProjection();
    const explanations = [];
    const scored = [];
    let order = 0;
    const fakeGet = (id) => {
        const r = rows.find(x => x.id === id);
        if (!r)
            return null;
        return { id: r.id, kind: r.kind, text: r.text, status: r.status, payload: r.payload, based_on: r.based_on ?? [], run_id: r.run_id, task_id: r.task_id };
    };
    for (const r of rows) {
        const payload = r.payload;
        const node = {
            id: r.id, kind: r.kind, text: r.text, status: r.status,
            payload, based_on: r.based_on ?? [], run_id: r.run_id, task_id: r.task_id,
        };
        const validity = validityOf(node, fakeGet);
        const rel = relevance(r.text, terms);
        let role;
        let include = false;
        let reason;
        if (r.kind === 'constraint') {
            role = 'constraint';
            if (validity === 'stale') {
                include = false;
                reason = '约束已失效（stale）';
            }
            else {
                include = true;
                reason = '约束置顶冻结（与查询无关也入选）';
            }
        }
        else if (r.kind === 'progress') {
            role = 'progress';
            if (opts?.task_id != null && r.task_id === opts.task_id) {
                include = true;
                reason = '当次任务进度（冻结保护）';
            }
            else {
                include = false;
                reason = opts?.task_id != null ? '其他任务进度（不跨任务注入）' : '未指定 task_id，进度不入选';
            }
        }
        else if (r.kind === 'inference') {
            const c = payload.memory_candidate;
            const isCandidate = candidateMeta(node) !== null || (c !== undefined && c !== null);
            if (isCandidate) {
                role = 'candidate';
                const meta = candidateMeta(node);
                if (meta === null) {
                    include = false;
                    reason = '候选元数据无效（invalid_candidate）';
                }
                else if (meta.state === 'pending') {
                    include = false;
                    reason = '未审阅候选默认排除（pending，不进入精选）';
                }
                else if (meta.state === 'rejected') {
                    include = false;
                    reason = '已拒绝候选排除';
                }
                else { // accepted
                    if (validity === 'stale') {
                        include = false;
                        reason = '已接受候选证据失效（stale_candidate_evidence）';
                    }
                    else if (rel < 0.15) {
                        include = false;
                        reason = '已审阅候选与查询不相关（词法相关性不足）';
                    }
                    else {
                        include = true;
                        reason = '已接受候选（人工核验推断）';
                        role = 'reviewed_inference';
                    }
                }
            }
            else {
                role = 'reviewed_inference';
                if (r.status === 'promoted') {
                    if (validity === 'stale') {
                        include = false;
                        reason = '推断已被推翻/覆盖（stale）';
                    }
                    else if (rel < 0.15) {
                        include = false;
                        reason = '已审阅推断与查询不相关（词法相关性不足）';
                    }
                    else {
                        include = true;
                        reason = validity === 'needs_review' ? '已审阅推断需复核（证据变化）' : '已审阅推断（promoted）';
                    }
                }
                else {
                    include = false;
                    reason = r.status === 'contradicted' ? '推断已被物理观测推翻'
                        : r.status === 'superseded' ? '推断已被覆盖'
                            : r.status === 'demoted' ? '推断已降级'
                                : '未审阅推断不进入任务精选（inference 需 promote/候选 accept）';
                }
            }
        }
        else if (r.kind === 'tip') {
            role = 'tip';
            if (validity === 'stale') {
                include = false;
                reason = '建议已降级（stale）';
            }
            else if (rel < 0.15) {
                include = false;
                reason = '建议与查询不相关（词法相关性不足）';
            }
            else {
                include = true;
                reason = '查询相关建议（tip）';
            }
        }
        else {
            role = 'observation';
            if (validity === 'stale') {
                include = false;
                reason = '观测已被覆盖/推翻（stale）';
            }
            else if (!includeLogs) {
                include = false;
                reason = '工具日志默认排除（不用最新日志填满预算；显式 includeLogs 可入）';
            }
            else if (rel < 0.15) {
                include = false;
                reason = '日志与查询不相关（log noise）';
            }
            else {
                include = true;
                reason = '显式 includeLogs 且词法相关';
            }
        }
        const entry = { node_id: r.id, role, included: include, validity, reason };
        if (include) {
            entry.score = rel;
            const priority = role === 'constraint' ? 0 : role === 'progress' ? 1 : role === 'reviewed_inference' ? 2 : role === 'tip' ? 3 : 4;
            scored.push({ node, role, score: rel, order: order++ });
            scored[scored.length - 1].priority = priority;
        }
        explanations.push(entry);
    }
    // 分层排序：约束 → 进度 → 已审阅推断 → 建议 → 日志；层内按词法相关性降序。
    scored.sort((a, b) => {
        const pa = a.priority;
        const pb = b.priority;
        if (pa !== pb)
            return pa - pb;
        if (b.score !== a.score)
            return b.score - a.score;
        return a.order - b.order;
    });
    // 预算裁剪：约束与当次进度保护不裁光。
    const kept = [];
    let tokens = 0;
    let protectedCount = 0;
    for (const s of scored) {
        const t = estimateTokensOf(s.node.text);
        const isProtected = s.role === 'constraint' || s.role === 'progress';
        if (kept.length >= maxNodes || tokens + t > maxTokens) {
            if (isProtected && protectedCount < 2) {
                // 冻结保护：至少保留 2 个保护节点（约束 + 进度），即使超预算。
                kept.push(s);
                tokens += t;
                protectedCount++;
                continue;
            }
            const e = explanations.find(x => x.node_id === s.node.id);
            if (e) {
                e.included = false;
                e.reason = `预算裁剪（budget：max_nodes=${maxNodes}/max_tokens=${maxTokens}）`;
            }
            continue;
        }
        if (isProtected)
            protectedCount++;
        kept.push(s);
        tokens += t;
    }
    return {
        nodes: kept.map(s => s.node),
        explanations,
        tokens_used: tokens,
        budget: { max_nodes: maxNodes, max_tokens: maxTokens },
    };
}
