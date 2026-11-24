import { WorkspaceError } from './errors.js';
import { redactNode, DEFAULT_REDACTION_RULES } from './privacy.js';
const GRANT_SCHEMA = `
CREATE TABLE IF NOT EXISTS m4_grants (
  grant_id     TEXT PRIMARY KEY,
  owner_agent  TEXT NOT NULL,
  grantee_task TEXT NOT NULL,
  grantee_agent TEXT,
  kinds_json   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL DEFAULT 0,
  revoked_at   INTEGER,
  note         TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_m4_grants_task ON m4_grants(grantee_task);
`;
function rowToGrant(r) {
    const kinds = JSON.parse(r.kinds_json);
    return {
        grant_id: r.grant_id, owner_agent: r.owner_agent, grantee_task: r.grantee_task,
        grantee_agent: r.grantee_agent, kinds, created_at: r.created_at,
        expires_at: r.expires_at, revoked_at: r.revoked_at, note: r.note,
    };
}
/** 纯函数：grant 是否对给定调用上下文有效（默认拒绝）。 */
export function grantAllows(grant, who, kind, now) {
    if (grant.revoked_at !== null)
        return false;
    if (grant.expires_at > 0 && now >= grant.expires_at)
        return false;
    if (who.task_id === null || who.task_id !== grant.grantee_task)
        return false;
    if (grant.grantee_agent !== null && grant.grantee_agent !== who.agent_id)
        return false;
    if (grant.kinds !== 'all' && !grant.kinds.includes(kind))
        return false;
    return true;
}
/** 附着到工作区 DB 的 grant 注册表（写方=本工作区宿主）。 */
export class GrantRegistry {
    db;
    constructor(db) {
        this.db = db;
        this.db.exec(GRANT_SCHEMA);
    }
    create(owner, input) {
        const task = input.grantee_task?.trim();
        if (!task || task.length > 256)
            throw new WorkspaceError('Invalid grantee task identity');
        if (input.grantee_agent !== undefined && input.grantee_agent !== null && input.grantee_agent.length > 256) {
            throw new WorkspaceError('Invalid grantee agent');
        }
        const kinds = input.kinds ?? 'all';
        if (kinds !== 'all' && (!Array.isArray(kinds) || kinds.length === 0 || kinds.some((k) => typeof k !== 'string'))) {
            throw new WorkspaceError('Invalid grant kinds scope');
        }
        const ttl = input.ttl_ms ?? 0;
        if (!Number.isFinite(ttl) || ttl < 0)
            throw new WorkspaceError('Invalid grant ttl');
        const grant = {
            grant_id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10),
            owner_agent: owner,
            grantee_task: task,
            grantee_agent: input.grantee_agent ?? null,
            kinds,
            created_at: Date.now(),
            expires_at: ttl > 0 ? Date.now() + ttl : 0,
            revoked_at: null,
            note: (input.note ?? '').slice(0, 2000),
        };
        this.db.prepare('INSERT INTO m4_grants (grant_id, owner_agent, grantee_task, grantee_agent, kinds_json, created_at, expires_at, revoked_at, note) VALUES (?,?,?,?,?,?,?,?,?)').run(grant.grant_id, grant.owner_agent, grant.grantee_task, grant.grantee_agent, JSON.stringify(grant.kinds), grant.created_at, grant.expires_at, null, grant.note);
        return grant;
    }
    revoke(grantId) {
        const g = this.get(grantId);
        if (g.revoked_at !== null)
            return g;
        const now = Date.now();
        this.db.prepare('UPDATE m4_grants SET revoked_at = ? WHERE grant_id = ?').run(now, grantId);
        return { ...g, revoked_at: now };
    }
    get(grantId) {
        const r = this.db.prepare('SELECT * FROM m4_grants WHERE grant_id = ?').get(grantId);
        if (!r)
            throw new WorkspaceError(`Grant not found: ${grantId}`);
        return rowToGrant(r);
    }
    list() {
        return this.db.prepare('SELECT * FROM m4_grants ORDER BY created_at ASC').all().map(rowToGrant);
    }
    /** 对给定上下文有效的 grants（默认拒绝的读面辅助）。 */
    effective(who, now) {
        return this.list().filter((g) => g.revoked_at === null && (g.expires_at === 0 || now < g.expires_at)
            && who.task_id !== null && who.task_id === g.grantee_task
            && (g.grantee_agent === null || g.grantee_agent === who.agent_id));
    }
}
/**
 * 受 grant 约束的对端工作区只读投影：
 * - 只读：绝不写本库/对端库（不混合 shared 库内容）。
 * - 范围：仅返回 grant.kinds 允许的节点。
 * - 隐私：敏感字段在边界处脱敏（副本），对端原件不可变（账本纪律）。
 * - 默认拒绝：无有效 grant 抛 WorkspaceError。
 */
export function readGranted(source, caller, grantId, opts) {
    const grant = source.grants.get(grantId);
    const now = Date.now();
    // 默认拒绝三重检查: 任务身份 (≠session)、agent 限定、有效状态
    if (caller.task_id === null || caller.task_id !== grant.grantee_task) {
        throw new WorkspaceError('Grant access denied: task identity mismatch (grants bind business task identity, never session id)');
    }
    if (grant.grantee_agent !== null && grant.grantee_agent !== caller.agent_id) {
        throw new WorkspaceError('Grant access denied: agent restriction');
    }
    if (!grantAllows(grant, { task_id: caller.task_id, agent_id: caller.agent_id }, 'observation', now)) {
        throw new WorkspaceError('Grant access denied: revoked or expired');
    }
    const rules = opts?.rules ?? DEFAULT_REDACTION_RULES;
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
    const out = [];
    let redacted = 0;
    for (const n of source.listNodes()) {
        const allowed = grant.kinds === 'all' || grant.kinds.includes(n.kind);
        if (!allowed)
            continue;
        const { node, masked } = redactNode(n, rules);
        redacted += masked;
        out.push(node);
        if (out.length >= limit)
            break;
    }
    return { grant_id: grant.grant_id, workspace: caller.workspace, nodes: out, redacted_fields: redacted, note: grant.note };
}
