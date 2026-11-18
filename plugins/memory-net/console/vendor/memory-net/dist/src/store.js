import { openWorkspaceDb, metaGet, metaSet } from './db.js';
import { WriteForbiddenError, PromoteNeedsEvidenceError, UnknownNodeError, WorkspaceError, } from './errors.js';
import { TRAIL_DIGEST_MAX_STEPS, estimateTokens, fillBudget, rankCandidates, resolveBudgets, } from './activate.js';
/** 写纪律矩阵（v1 写死）。 */
const KIND_ALLOWED_ROLES = {
    constraint: ['host'],
    observation: ['tool', 'host'],
    inference: ['model', 'host'],
    tip: ['model', 'host'],
};
const OBSERVATION_SOURCES = ['tool', 'user', 'config', 'system'];
function rowToNode(r) {
    return {
        id: r.id,
        kind: r.kind,
        agent_id: r.agent_id,
        run_id: r.run_id,
        task_id: r.task_id,
        key: r.key,
        text: r.text,
        payload: safeJson(r.payload_json, {}),
        source: r.source ?? null,
        confidence: r.confidence,
        status: r.status,
        conflict: r.conflict === 1,
        conflict_detail: r.conflict_json ? safeJson(r.conflict_json, null) : null,
        based_on: safeJson(r.based_on_json, []),
        created_at: r.created_at,
        updated_at: r.updated_at,
    };
}
function safeJson(s, fallback) {
    try {
        return JSON.parse(s);
    }
    catch {
        return fallback;
    }
}
export class MemoryNet {
    dbo;
    agentId;
    role;
    workspaceId;
    constructor(dbo, opts, wsDir) {
        this.dbo = dbo;
        this.agentId = opts.agentId;
        this.role = opts.role;
        this.workspaceId = dbo.workspaceId;
        void wsDir;
    }
    /** 打开（或创建）workspace。 */
    static open(wsDir, opts) {
        const agentId = opts?.agentId ?? 'host';
        const role = opts?.role ?? 'host';
        if (!(role === 'model' || role === 'tool' || role === 'host')) {
            throw new WorkspaceError(`未知角色: ${String(role)}（允许 model/tool/host）`);
        }
        if (!agentId || typeof agentId !== 'string') {
            throw new WorkspaceError('agent_id 必须是非空字符串（写入者身份）');
        }
        const dbo = openWorkspaceDb(wsDir, { workspaceId: opts?.workspaceId });
        return new MemoryNet(dbo, { agentId, role }, wsDir);
    }
    close() {
        try {
            this.dbo.db.close();
        }
        catch { /* 幂等：重复 close 静默 */ }
    }
    get db() {
        return this.dbo.db;
    }
    /**
     * 原子取号：seq 计数存在 meta 表，RETURNING 原子递增 ——
     * 多实例（多 agent 并发共享同一 workspace）取号不撞 UNIQUE（v1 修：实例内存计数是并发缺陷）。
     */
    nextId() {
        const row = this.db.prepare(`INSERT INTO meta (k, v) VALUES ('seq', '1')
       ON CONFLICT(k) DO UPDATE SET v = CAST(CAST(v AS INTEGER) + 1 AS TEXT)
       RETURNING v`).get();
        const seq = Number(row.v);
        return { id: `n${seq}`, seq };
    }
    assertCanWrite(kind) {
        if (kind === 'progress')
            return; // progress 全角色共享（协作核心）
        const allowed = KIND_ALLOWED_ROLES[kind];
        if (!allowed || !allowed.includes(this.role)) {
            throw new WriteForbiddenError(kind, this.role, allowed ?? []);
        }
    }
    rowById(id) {
        const r = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
        return r ? rowToNode(r) : null;
    }
    assertExists(id) {
        const n = this.rowById(id);
        if (!n)
            throw new UnknownNodeError(id);
        return n;
    }
    /** 跨进程写原子性：BEGIN IMMEDIATE 独占写锁（WAL 下写者互斥），函数式包裹自动回滚。 */
    txn(fn) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const out = fn();
            this.db.exec('COMMIT');
            return out;
        }
        catch (e) {
            try {
                this.db.exec('ROLLBACK');
            }
            catch { /* 已回滚 */ }
            throw e;
        }
    }
    // ---------------------------------------------------------------- add / get / link
    /**
     * 写入节点。progress 不走此入口（用 update_progress）。
     * observation 带 key 时执行覆盖语义：旧同 key 观测 superseded，
     * 且基于旧观测（任一被覆盖版本）的 active inference 自动 contradicted。
     */
    add(kind, input) {
        if (kind === 'progress') {
            throw new WorkspaceError("progress 不经 add 写入：使用 update_progress(task_id, patch)（同 task 单行共享）");
        }
        this.assertCanWrite(kind);
        const text = String(input.text ?? '');
        if (!text.trim() && kind !== 'constraint') {
            throw new WorkspaceError(`${kind} 的 text 不能为空`);
        }
        let source = null;
        let confidence = null;
        let payload = { ...(input.payload ?? {}) };
        if (kind === 'observation') {
            source = input.source ?? (this.role === 'tool' ? 'tool' : 'user');
            if (!OBSERVATION_SOURCES.includes(source)) {
                throw new WorkspaceError(`observation.source 必须是 ${OBSERVATION_SOURCES.join('|')}，得到: ${String(source)}`);
            }
        }
        if (kind === 'inference') {
            // Number.isFinite 先行：NaN 是 number 且比较恒 false，不加会穿透校验落库成 NULL（会话 14 P3）
            if (typeof input.confidence !== 'number' || !Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
                throw new WorkspaceError('inference 必须带 confidence（0~1）——推断必须有置信度，缺失即拒绝');
            }
            confidence = input.confidence;
        }
        if (kind === 'constraint') {
            const mode = (payload.mode ?? '');
            if (mode !== 'forbid' && mode !== 'require') {
                throw new WorkspaceError("constraint.payload.mode 必须是 'forbid' | 'require'");
            }
            if (!input.key)
                throw new WorkspaceError('constraint 必须带 key（规则名，便于引用与去重）');
        }
        const basedOn = this.validateBasedOn(input.based_on ?? []);
        const now = Date.now();
        // 带 key 的 observation：INSERT + 覆盖联动必须在同一 IMMEDIATE 事务内 ——
        // 否则跨进程同 key 并发写会互相 supersede，收敛到「零 active 观测」（中间态查无此 key）。
        // 事务序列化后：后提交者可见先提交者的新行并把它 supersede，恒有且仅有一个 active。
        const writeAll = () => {
            const { id, seq } = this.nextId();
            this.db.prepare(`INSERT INTO nodes (id, seq, kind, agent_id, run_id, task_id, key, text, payload_json,
                            source, confidence, status, based_on_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`).run(id, seq, kind, this.agentId, input.run_id ?? null, input.task_id ?? null, input.key ?? null, text, JSON.stringify(payload), source, confidence, JSON.stringify(basedOn), now, now);
            if (kind === 'observation' && input.key) {
                this.supersedeSameKey(input.key, id);
            }
            return id;
        };
        const id = kind === 'observation' && input.key ? this.txn(writeAll) : writeAll();
        return this.assertExists(id);
    }
    /** based_on 引用完整性：指向的节点必须存在。 */
    validateBasedOn(ids) {
        const out = [];
        for (const raw of ids) {
            const id = String(raw);
            if (!this.rowById(id))
                throw new UnknownNodeError(id);
            out.push(id);
        }
        return out;
    }
    /**
     * observation 覆盖联动：同 key 旧 active 观测 → superseded；
     * 基于这些旧观测的 active inference → contradicted（物理事实变了，推断自动失效）。
     */
    supersedeSameKey(key, newId) {
        const oldRows = this.db.prepare("SELECT id FROM nodes WHERE kind = 'observation' AND key = ? AND status = 'active' AND id != ?").all(key, newId);
        if (oldRows.length === 0)
            return;
        const supersededIds = oldRows.map((r) => r.id);
        const ph = supersededIds.map(() => '?').join(',');
        this.db.prepare(`UPDATE nodes SET status = 'superseded' WHERE id IN (${ph})`).run(...supersededIds);
        // contradicted 联动：based_on 含任一被覆盖观测 id ——
        // instr 精确子串（带引号 id）替代全表 JS 逐行比对，把过滤下推到 SQLite
        for (const sid of supersededIds) {
            this.db.prepare("UPDATE nodes SET status = 'contradicted', updated_at = ?\n         WHERE kind = 'inference' AND status = 'active' AND instr(based_on_json, ?) > 0").run(Date.now(), `"${sid}"`);
        }
        void newId;
    }
    get(id) {
        return this.rowById(id);
    }
    /** 补 based_on 轻量边（from 依赖 to）。 */
    link(fromId, toId) {
        const from = this.assertExists(fromId);
        this.assertExists(toId);
        if (from.based_on.includes(toId))
            return;
        const deps = [...from.based_on, toId];
        this.db.prepare('UPDATE nodes SET based_on_json = ?, updated_at = ? WHERE id = ?')
            .run(JSON.stringify(deps), Date.now(), fromId);
    }
    // ---------------------------------------------------------------- progress / trail
    /**
     * progress 按 task_id 单行共享：多 Agent 同 task 协作核心。
     * ctx.base_updated_at 提供乐观锁：与库中 updated_at 不符 = 并发写 →
     * 应用传入 patch（后写赢）但 conflict 置位并记录字段级双方值 —— 不静默双真相。
     */
    updateProgress(taskId, patch, ctx) {
        if (!taskId)
            throw new WorkspaceError('update_progress 需要 task_id');
        let existing = this.db.prepare("SELECT * FROM nodes WHERE kind = 'progress' AND task_id = ?").get(taskId);
        const now = Date.now();
        const status = patch.status !== undefined ? String(patch.status) : undefined;
        const summary = patch.summary !== undefined ? String(patch.summary) : undefined;
        const owner = patch.owner !== undefined ? String(patch.owner) : this.agentId;
        if (!existing) {
            const { id, seq } = this.nextId();
            const payload = { ...patch, status: status ?? 'open', summary: summary ?? '', owner };
            try {
                this.db.prepare(`INSERT INTO nodes (id, seq, kind, agent_id, run_id, task_id, key, text, payload_json,
                              source, confidence, status, conflict, based_on_json, created_at, updated_at)
           VALUES (?, ?, 'progress', ?, NULL, ?, NULL, ?, ?, NULL, NULL, 'active', 0, '[]', ?, ?)`).run(id, seq, this.agentId, taskId, summary ?? '', JSON.stringify(payload), now, now);
                return this.assertExists(id);
            }
            catch (e) {
                // 并发首写撞 uq_nodes_progress_task：另一进程已建行——重读并落入下方更新路径，
                // 乐观锁/conflict 语义照常生效，杜绝不标 conflict 的静默双真相
                if (!(e instanceof Error) || !/UNIQUE constraint failed/.test(e.message))
                    throw e;
                existing = this.db.prepare("SELECT * FROM nodes WHERE kind = 'progress' AND task_id = ?").get(taskId);
                if (!existing)
                    throw e;
            }
        }
        const node = rowToNode(existing);
        let conflict = false;
        let conflictDetail = null;
        if (ctx?.base_updated_at !== undefined && ctx.base_updated_at !== existing.updated_at) {
            conflict = true;
            conflictDetail = {};
            for (const [k, incoming] of Object.entries(patch)) {
                conflictDetail[k] = [node.payload[k] ?? null, incoming];
            }
            conflictDetail['updated_at'] = [existing.updated_at, ctx.base_updated_at];
        }
        const mergedPayload = { ...node.payload, ...patch, status: status ?? node.payload.status, owner };
        const newSummary = summary ?? node.text;
        this.db.prepare(`UPDATE nodes SET text = ?, payload_json = ?, conflict = ?, conflict_json = ?,
                        agent_id = ?, updated_at = ? WHERE id = ?`).run(newSummary, JSON.stringify(mergedPayload), conflict ? 1 : 0, conflictDetail ? JSON.stringify(conflictDetail) : null, this.agentId, now, existing.id);
        return this.assertExists(existing.id);
    }
    /** 追加 trail 步（per-run 有界递增序，可回放）。
     *  seq 由单语句子查询原子分配（与 nextId 同款并发纪律）：跨进程并发追加同一 run
     *  不再撞 PK(run_id,seq) 裸 SqliteError——写入锁内取 MAX+1，恒唯一。 */
    appendTrail(runId, step) {
        if (!runId)
            throw new WorkspaceError('append_trail 需要 run_id');
        const action = String(step.action ?? '');
        if (!action.trim())
            throw new WorkspaceError('trail 步骤 action 不能为空');
        const refs = (step.refs ?? []).map(String);
        for (const r of refs)
            this.assertExists(r); // refs 引用完整性
        const ts = Date.now();
        const result = this.db.prepare(`INSERT INTO trail (run_id, seq, agent_id, action, refs_json, ts)
       VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM trail WHERE run_id = ?), ?, ?, ?, ?)`).run(runId, runId, this.agentId, action, JSON.stringify(refs), ts);
        // 经 rowid 读回本行真实 seq（并发下不能用 MAX：可能已被后到者再叠一号）
        const row = this.db.prepare('SELECT seq FROM trail WHERE rowid = ?').get(result.lastInsertRowid);
        return { run_id: runId, seq: row.seq, agent_id: this.agentId, action, refs, ts, compressed: false };
    }
    /** 按 seq 有序回放 run 的 trail（可复现/排障）。 */
    replayTrail(runId) {
        const rows = this.db.prepare('SELECT * FROM trail WHERE run_id = ? ORDER BY seq ASC').all(runId);
        return rows.map((r) => ({
            run_id: r.run_id, seq: r.seq, agent_id: r.agent_id, action: r.action,
            refs: safeJson(r.refs_json, []), ts: r.ts, compressed: r.compressed === 1,
        }));
    }
    // ---------------------------------------------------------------- activate
    /**
     * 预算化激活。冻结集（constraint 全部 + 当次 progress）永不裁光；
     * contradicted / demoted / superseded 不进入激活；promoted inference 按 observation 级权重。
     */
    activate(query, opts) {
        const now = Date.now();
        const budgets = resolveBudgets(opts?.budgets);
        const constraints = this.db.prepare("SELECT * FROM nodes WHERE kind = 'constraint' AND status = 'active' ORDER BY updated_at DESC").all().map(rowToNode);
        // 当次 progress：按 task_id 优先，其次 run_id；都没给则全部 active progress（保守冻结）
        let progress;
        if (opts?.task_id) {
            progress = this.db.prepare("SELECT * FROM nodes WHERE kind = 'progress' AND task_id = ? AND status = 'active'").all(opts.task_id).map(rowToNode);
        }
        else if (opts?.run_id) {
            progress = this.db.prepare("SELECT * FROM nodes WHERE kind = 'progress' AND status = 'active' AND (run_id = ? OR run_id IS NULL)").all(opts.run_id).map(rowToNode);
        }
        else {
            progress = this.db.prepare("SELECT * FROM nodes WHERE kind = 'progress' AND status = 'active'").all().map(rowToNode);
        }
        // 竞争候选：其余 active 节点
        const competitors = this.db.prepare(`SELECT * FROM nodes WHERE status = 'active'
         AND NOT (kind = 'progress' AND task_id IS NOT NULL)
       ORDER BY updated_at DESC`).all().map(rowToNode).filter((n) => {
            if (n.kind === 'constraint')
                return false;
            if (n.kind === 'progress')
                return !progress.some((p) => p.id === n.id);
            return true;
        });
        const ranked = rankCandidates(competitors, query ?? '', now);
        // trail 摘要（weight 最低，预算紧时最先丢）
        let trailDigest;
        let trailTokens = 0;
        if (opts?.run_id) {
            const steps = this.replayTrail(opts.run_id);
            if (steps.length > 0) {
                const recent = steps.slice(-TRAIL_DIGEST_MAX_STEPS);
                const text = recent.map((s) => `#${s.seq} ${s.agent_id}:${s.action}`).join(' -> ');
                trailDigest = { kind: 'trail', run_id: opts.run_id, steps: steps.length, tokens: 0, text };
                trailTokens = estimateTokens(text) + 8;
                trailDigest.tokens = trailTokens;
            }
        }
        const { picked, trailIncluded, dropped, tokensUsed } = fillBudget([...constraints, ...progress], ranked, budgets, trailTokens, Boolean(trailDigest));
        // frozen 内的 progress 冲突可读性由消费方读取 conflict 字段（不静默）。
        let droppedTotal = dropped;
        if (trailDigest && !trailIncluded)
            droppedTotal++;
        return {
            nodes: picked.sort((a, b) => (b.weight - a.weight) || (b.score - a.score)),
            trail: trailIncluded ? trailDigest : undefined,
            tokens_used: tokensUsed,
            nodes_dropped: droppedTotal,
            budgets,
        };
    }
    // ---------------------------------------------------------------- promote / demote / contradict
    /**
     * 显式 promote（仅 inference）。需 evidence（存在的节点 id 引用）或 by=user（宿主确认）。
     * 无自动 promote 路径：库内任何写操作都不会自动把 inference 升级。
     */
    promote(id, opts) {
        const n = this.assertExists(id);
        if (n.kind !== 'inference') {
            throw new WorkspaceError(`promote 仅适用于 inference，得到 ${n.kind}: ${id}`);
        }
        if (n.status === 'promoted')
            return n;
        if (n.status !== 'active') {
            throw new WorkspaceError(`${id} 状态为 ${n.status}，不可 promote`);
        }
        const evidence = (opts?.evidence ?? []).map(String);
        if (evidence.length === 0 && opts?.by !== 'user') {
            throw new PromoteNeedsEvidenceError(id);
        }
        for (const e of evidence)
            this.assertExists(e);
        const payload = {
            ...n.payload,
            promote_evidence: evidence,
            promote_note: opts?.note ?? '',
            promote_by: opts?.by ?? 'agent',
        };
        this.db.prepare("UPDATE nodes SET status = 'promoted', payload_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(payload), Date.now(), id);
        return this.assertExists(id);
    }
    /** 显式降级（任意 kind）：不参与激活，不物理删除。
     *  角色门控：目标 kind 的写纪律矩阵同样适用于 lifecycle ——
     *  model 不得 demote constraint / observation（host-only），否则冻结集「永不裁光」可被旁路。 */
    demote(id, opts) {
        const n = this.assertExists(id);
        if (n.kind !== 'progress') {
            const allowed = KIND_ALLOWED_ROLES[n.kind];
            if (allowed && !allowed.includes(this.role)) {
                throw new WriteForbiddenError(n.kind, this.role, allowed);
            }
        }
        const payload = { ...n.payload, demote_reason: opts?.reason ?? '' };
        this.db.prepare("UPDATE nodes SET status = 'demoted', payload_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(payload), Date.now(), id);
        return this.assertExists(id);
    }
    /** 显式 contradict：推翻一条 inference（evidence 引用观测或文本说明，至少其一——禁止无依据推翻）。 */
    contradict(id, opts) {
        const n = this.assertExists(id);
        if (n.kind !== 'inference') {
            throw new WorkspaceError(`contradict 仅适用于 inference，得到 ${n.kind}: ${id}`);
        }
        const evidence = (opts?.evidence ?? []).map(String);
        for (const e of evidence)
            this.assertExists(e);
        if (evidence.length === 0 && !(opts?.note ?? '').trim()) {
            throw new WorkspaceError(`contradict 拒绝：${id} 需要 evidence（观测 id 列表）或 note（文字依据）至少其一——禁止无依据推翻推断`);
        }
        const payload = {
            ...n.payload,
            contradict_evidence: evidence,
            contradict_note: opts?.note ?? '',
        };
        this.db.prepare("UPDATE nodes SET status = 'contradicted', payload_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(payload), Date.now(), id);
        return this.assertExists(id);
    }
    // ---------------------------------------------------------------- gc
    /**
     * gc：trail 压缩（per-run 超保留上限时中间段合并，保留首尾）+ 可选 TTL 降级
     * （仅 tip/inference；observation 默认绝不因 TTL 删）+ 可选 purge（物理清理，
     * 保护被 active inference 引用的行）。
     */
    gc(opts) {
        const keep = opts?.trail_keep && opts.trail_keep >= 4 ? Math.floor(opts.trail_keep) : 50;
        const report = { trail_runs_compressed: 0, trail_steps_merged: 0, demoted_by_ttl: 0, purged: 0 };
        // 1) trail 压缩
        const runs = this.db.prepare('SELECT DISTINCT run_id FROM trail').all();
        for (const { run_id } of runs) {
            const steps = this.replayTrail(run_id);
            if (steps.length <= keep)
                continue;
            const head = steps[0];
            if (!head)
                continue;
            const tail = steps.slice(-(keep - 2));
            const middle = steps.slice(1, steps.length - (keep - 2));
            const mergedAction = `[gc] 压缩 ${middle.length} 步（${middle[0].ts} .. ${middle[middle.length - 1].ts}，明细不保留）`;
            this.db.prepare('DELETE FROM trail WHERE run_id = ?').run(run_id);
            let seq = 1;
            const write = (s, compressed) => {
                this.db.prepare('INSERT INTO trail (run_id, seq, agent_id, action, refs_json, ts, compressed) VALUES (?, ?, ?, ?, ?, ?, ?)').run(run_id, seq++, s.agent_id, s.action, JSON.stringify(s.refs), s.ts, compressed ? 1 : 0);
            };
            write(head, false);
            write({
                run_id, seq: 0, agent_id: 'gc', action: mergedAction,
                refs: middle.flatMap((m) => m.refs), ts: middle[0].ts, compressed: true,
            }, true);
            for (const t of tail)
                write(t, false);
            report.trail_runs_compressed++;
            report.trail_steps_merged += middle.length;
        }
        // 2) TTL 降级（仅 tip / inference；observation/progress/constraint 永不 TTL）
        if (opts?.ttl_days && opts.ttl_days > 0) {
            const cutoff = Date.now() - opts.ttl_days * 86400e3;
            const rows = this.db.prepare("SELECT id, payload_json FROM nodes WHERE status = 'active' AND kind IN ('tip','inference') AND updated_at < ?").all(cutoff);
            for (const r of rows) {
                const payload = { ...safeJson(r.payload_json, {}), gc_ttl: true };
                this.db.prepare("UPDATE nodes SET status = 'demoted', payload_json = ? WHERE id = ?")
                    .run(JSON.stringify(payload), r.id);
                report.demoted_by_ttl++;
            }
        }
        // 3) purge（默认关）：物理删除已降级/已推翻/已覆盖行，保护被 active inference 引用的行
        if (opts?.purge) {
            const protectedIds = new Set();
            const infRows = this.db.prepare("SELECT based_on_json FROM nodes WHERE status = 'active' AND kind = 'inference'").all();
            for (const r of infRows)
                for (const d of safeJson(r.based_on_json, []))
                    protectedIds.add(d);
            const dead = this.db.prepare("SELECT id FROM nodes WHERE status IN ('demoted','contradicted','superseded')").all();
            const del = this.db.prepare('DELETE FROM nodes WHERE id = ?');
            for (const d of dead) {
                if (protectedIds.has(d.id))
                    continue;
                del.run(d.id);
                report.purged++;
            }
        }
        return report;
    }
    // ---------------------------------------------------------------- export / import
    /** 导出单 workspace 记忆包（JSON，含全部节点与 trail）。 */
    exportPkg() {
        const nodes = this.db.prepare('SELECT * FROM nodes ORDER BY seq ASC').all().map(rowToNode);
        const trailRows = this.db.prepare('SELECT * FROM trail ORDER BY run_id ASC, seq ASC').all();
        const seq = Number(metaGet(this.db, 'seq') ?? '0');
        return {
            schema_version: 1,
            workspace_id: this.workspaceId,
            exported_at: Date.now(),
            seq,
            nodes,
            trail: trailRows.map((r) => ({
                run_id: r.run_id, seq: r.seq, agent_id: r.agent_id, action: r.action,
                refs: safeJson(r.refs_json, []), ts: r.ts, compressed: r.compressed === 1,
            })),
        };
    }
    /** 导入记忆包为新 workspace（id 冲突即拒绝，防止半写状态）。 */
    static importPkg(pkg, toDir, opts) {
        if (pkg.schema_version !== 1) {
            throw new WorkspaceError(`不支持的 schema_version: ${String(pkg.schema_version)}`);
        }
        const net = MemoryNet.open(toDir, { workspaceId: pkg.workspace_id, agentId: opts?.agentId, role: opts?.role });
        try {
            // 事务原子化：count 检查 + 全部插入同一事务——任一步失败整体回滚，
            // 目标库不留半写状态（否则重试会被"已有节点"拒绝，目标永久无法导入）
            net.db.exec('BEGIN IMMEDIATE');
            const existing = net.db.prepare('SELECT COUNT(*) AS c FROM nodes').get();
            if (existing.c > 0)
                throw new WorkspaceError(`导入目标 ${toDir} 已有节点，拒绝覆盖导入`);
            const insert = net.db.prepare(`INSERT INTO nodes (id, seq, kind, agent_id, run_id, task_id, key, text, payload_json,
                            source, confidence, status, conflict, conflict_json, based_on_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            let seqNum = 1;
            for (const n of pkg.nodes) {
                insert.run(n.id, seqNum++, n.kind, n.agent_id, n.run_id, n.task_id, n.key, n.text, JSON.stringify(n.payload), n.source, n.confidence, n.status, n.conflict ? 1 : 0, n.conflict_detail ? JSON.stringify(n.conflict_detail) : null, JSON.stringify(n.based_on), n.created_at, n.updated_at);
            }
            metaSet(net.db, 'seq', String(Math.max(pkg.seq, seqNum - 1)));
            const insertTrail = net.db.prepare('INSERT INTO trail (run_id, seq, agent_id, action, refs_json, ts, compressed) VALUES (?, ?, ?, ?, ?, ?, ?)');
            for (const t of pkg.trail) {
                insertTrail.run(t.run_id, t.seq, t.agent_id, t.action, JSON.stringify(t.refs), t.ts, t.compressed ? 1 : 0);
            }
            net.db.exec('COMMIT');
            return net;
        }
        catch (e) {
            try {
                net.db.exec('ROLLBACK');
            }
            catch {
                /* 事务未开启（schema/count 校验前置失败等） */
            }
            net.close();
            throw e;
        }
    }
}
