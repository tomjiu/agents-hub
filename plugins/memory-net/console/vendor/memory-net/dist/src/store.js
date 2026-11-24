import { openWorkspaceDb, metaGet, metaSet } from './db.js';
import { WriteForbiddenError, PromoteNeedsEvidenceError, UnknownNodeError, WorkspaceError, } from './errors.js';
import { TRAIL_DIGEST_MAX_STEPS, estimateTokens, fillBudget, rankCandidates, resolveBudgets, } from './activate.js';
import { curationReason } from './curation.js';
import { candidateMeta, candidateReason, eventDigest, claimDigest, referenceIds, validateEvent, digest } from './candidates.js';
import { attachLedger, exportLedger, importLedgerRows, backupWorkspace } from './ledger.js';
import { GrantRegistry, readGranted as readGrantedImpl } from './grants.js';
import { attachEvidence } from './evidence.js';
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
    /** schema2 溯源账本（未挂载为 null）。 */
    ledger;
    /** M2 证据存储（账本挂载时同步挂载；未挂载为 null）。 */
    evidence;
    wsDir;
    grants_ = null;
    constructor(dbo, opts, wsDir, ledger, evidence) {
        this.dbo = dbo;
        this.agentId = opts.agentId;
        this.role = opts.role;
        this.workspaceId = dbo.workspaceId;
        this.ledger = ledger;
        this.evidence = evidence;
        this.wsDir = wsDir;
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
        let ledger = null;
        let evidence = null;
        if (opts?.ledger) {
            try {
                ledger = attachLedger(dbo.db, wsDir);
                evidence = attachEvidence(dbo.db);
            }
            catch (e) {
                dbo.db.close();
                throw e;
            }
        }
        return new MemoryNet(dbo, { agentId, role }, wsDir, ledger, evidence);
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
    /** 跨进程写原子性：BEGIN IMMEDIATE 独占写锁（WAL 下写者互斥），函数式包裹自动回滚。
     *  M1：账本挂载时同一事务覆盖 memory.db + provenance.db（ATTACH 同连接）；
     *  依赖校验一律在事务内进行（消除检查到使用竞态，含 GC 并发）。 */
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
    /** 账本修订快照（状态主体快照，不含 updated_at 墙钟）。 */
    snapshotOf(n) {
        return {
            node_id: n.id, kind: n.kind, text: n.text, payload: n.payload,
            based_on: n.based_on, status: n.status, actor: this.agentId,
        };
    }
    /** 公开返回前盖当前 head 修订戳（账本未挂载时原样返回）。 */
    withRevision(n) {
        if (!this.ledger)
            return n;
        const head = this.ledger.headRevision(n.id);
        return head === null ? n : { ...n, revision_id: head };
    }
    opInput(kind, summary, provenance) {
        return {
            actor: this.agentId, operation_kind: kind, summary,
            host_instance: provenance?.host_instance ?? null,
            session_id: provenance?.session_id ?? null,
            call_id: provenance?.call_id ?? null,
            root_call_id: provenance?.root_call_id ?? null,
            durable_event_seq: provenance?.durable_event_seq ?? null,
        };
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
        if (this.role !== 'host' && Object.hasOwn(input.payload ?? {}, 'memory_candidate'))
            throw new WorkspaceError('memory_candidate is reserved host metadata');
        if (input.evidence !== undefined && this.role === 'model')
            throw new WorkspaceError('evidence is reserved host/tool metadata：模型不可夹带证据绑定');
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
        const now = Date.now();
        // M1：全部写入走同一 BEGIN IMMEDIATE ——依赖校验入事务（消除与 GC 的检查到使用
        // 竞态）；带 key 覆盖联动沿用原语义；账本挂载时同事务记录操作+修订（含受影响节点）。
        const writeAll = () => {
            // 重放去重（先于依赖校验：已提交事件的幂等重放不因当前引用状态变化而失败）：
            // 持久坐标齐全时，同坐标同摘要幂等返回原节点（不重复写入）；
            // 同坐标异摘要由 checkOperation 抛 LedgerConflictError 拒绝。
            if (this.ledger && input.provenance?.session_id != null && input.provenance?.durable_event_seq != null) {
                const check = this.ledger.checkOperation(this.opInput('add', `${kind}:${text}`, input.provenance));
                if (check.status === 'replay') {
                    const nodeId = check.node_ids[0];
                    if (nodeId === undefined || !this.rowById(nodeId)) {
                        throw new WorkspaceError(`重放操作 ${check.op_id} 缺少可返回的节点；拒绝幂等重放`);
                    }
                    return nodeId;
                }
            }
            const basedOn = this.validateBasedOn(input.based_on ?? []);
            const { id, seq } = this.nextId();
            this.db.prepare(`INSERT INTO nodes (id, seq, kind, agent_id, run_id, task_id, key, text, payload_json,
                            source, confidence, status, based_on_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`).run(id, seq, kind, this.agentId, input.run_id ?? null, input.task_id ?? null, input.key ?? null, text, JSON.stringify(payload), source, confidence, JSON.stringify(basedOn), now, now);
            const affected = [];
            if (kind === 'observation' && input.key) {
                affected.push(...this.supersedeSameKey(input.key, id));
            }
            if (this.ledger) {
                const { op_id } = this.ledger.recordOperation(this.opInput('add', `${kind}:${text}`, input.provenance));
                // 依赖节点可能早于账本挂载存在：先补 legacy_baseline 首修订，引用才可精确固定。
                for (const ref of basedOn) {
                    const refNode = this.rowById(ref);
                    if (refNode && this.ledger.headRevision(ref) === null) {
                        this.ledger.ensureBaseline(op_id, this.snapshotOf(refNode));
                    }
                }
                this.ledger.commitRevision(op_id, this.snapshotOf(this.assertExists(id)));
                for (const changed of affected) {
                    this.ledger.commitRevision(op_id, this.snapshotOf(this.assertExists(changed)));
                }
                if (input.evidence !== undefined && this.evidence) {
                    // 坐标合并：事件坐标在 provenance 上时，证据绑定继承同一坐标（显式传入优先）。
                    const mergedEvidence = {
                        ...input.evidence,
                        session_id: input.evidence.session_id ?? input.provenance?.session_id ?? null,
                        durable_event_seq: input.evidence.durable_event_seq ?? input.provenance?.durable_event_seq ?? null,
                        call_id: input.evidence.call_id ?? input.provenance?.call_id ?? null,
                        root_call_id: input.evidence.root_call_id ?? input.provenance?.root_call_id ?? null,
                    };
                    this.evidence.bind(id, this.ledger.headRevision(id), mergedEvidence, this.agentId);
                    // 绑定与写入同事务；bind 操作复用会话坐标但不占持久事件序号（NULL 与 add op 不冲突）。
                    this.ledger.recordOperation(this.opInput('bind', `bind:${id}->${input.evidence.code_state_id}`, {
                        session_id: mergedEvidence.session_id, call_id: mergedEvidence.call_id,
                        root_call_id: mergedEvidence.root_call_id,
                    }));
                }
            }
            return id;
        };
        const id = this.txn(writeAll);
        return this.withRevision(this.assertExists(id));
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
     * 基于这些旧观测的 active/promoted inference → contradicted（物理事实变了，推断自动失效）。
     */
    supersedeSameKey(key, newId) {
        const oldRows = this.db.prepare("SELECT id FROM nodes WHERE kind = 'observation' AND key = ? AND status = 'active' AND id != ?").all(key, newId);
        if (oldRows.length === 0)
            return [];
        const supersededIds = oldRows.map((r) => r.id);
        const ph = supersededIds.map(() => '?').join(',');
        this.db.prepare(`UPDATE nodes SET status = 'superseded' WHERE id IN (${ph})`).run(...supersededIds);
        const affected = [...supersededIds];
        // contradicted 联动：based_on 含任一被覆盖观测 id ——
        // instr 精确子串（带引号 id）替代全表 JS 逐行比对，把过滤下推到 SQLite；
        // M1：先选出受影响 id 再更新（账本需要为每个状态变更提交修订）。
        for (const sid of supersededIds) {
            const rows = this.db.prepare("SELECT id FROM nodes WHERE kind = 'inference' AND status IN ('active','promoted') AND (instr(based_on_json, ?) > 0 OR EXISTS (SELECT 1 FROM json_each(nodes.payload_json, '$.promote_evidence') WHERE value = ?))").all(`"${sid}"`, sid);
            if (rows.length === 0)
                continue;
            const ids = rows.map((r) => r.id);
            this.db.prepare(`UPDATE nodes SET status = 'contradicted', updated_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`).run(Date.now(), ...ids);
            affected.push(...ids);
        }
        return affected;
    }
    get(id) {
        const n = this.rowById(id);
        return n === null ? null : this.withRevision(n);
    }
    /** 节点修订历史（账本未挂载时空数组）。 */
    historyOf(nodeId) {
        return this.ledger ? this.ledger.history(nodeId) : [];
    }
    /** M3 检索投影读面：全部节点轻量行（不含私有 db 泄漏）。 */
    nodesForProjection() {
        return this.db.prepare('SELECT id, kind, text, status, run_id, task_id, payload_json, based_on_json FROM nodes').all().map(r => ({
            id: r.id, kind: r.kind, text: r.text, status: r.status, run_id: r.run_id, task_id: r.task_id,
            payload: safeJson(r.payload_json, {}),
            based_on: safeJson(r.based_on_json, []),
        }));
    }
    /** 全量节点列表（M4 grant 视图用：完整行, 脱敏在读取边界做副本）。 */
    listNodes() {
        return this.db.prepare('SELECT * FROM nodes ORDER BY seq ASC').all().map(rowToNode);
    }
    /** 补 based_on 轻量边（from 依赖 to）。账本挂载时为修订变更：必需 expected_revision CAS。 */
    link(fromId, toId, opts) {
        return this.txn(() => {
            const from = this.assertExists(fromId);
            this.assertExists(toId);
            if (this.ledger && opts?.expected_revision === undefined) {
                throw new WorkspaceError('账本挂载时 link 需要 expected_revision（修订级 CAS，显式重读后重试）');
            }
            if (from.based_on.includes(toId))
                return this.withRevision(from);
            const deps = [...from.based_on, toId];
            this.db.prepare('UPDATE nodes SET based_on_json = ?, updated_at = ? WHERE id = ?')
                .run(JSON.stringify(deps), Date.now(), fromId);
            if (this.ledger) {
                const { op_id } = this.ledger.recordOperation(this.opInput('link', `${fromId}->${toId}`));
                this.ledger.commitRevision(op_id, this.snapshotOf(this.assertExists(fromId)), { expectedRevision: opts?.expected_revision });
            }
            return this.withRevision(this.assertExists(fromId));
        });
    }
    /** Propose an evidence-bound inference, never a physical observation or reviewed fact. */
    proposeCandidate(input) {
        if (this.role === 'tool')
            throw new WorkspaceError('Candidate proposal requires model or host role');
        const text = typeof input.text === 'string' ? input.text.normalize('NFKC').trim() : '';
        if (!text || text.length > 4000 || typeof input.confidence !== 'number' || !Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1 || typeof input.run_id !== 'string' || !input.run_id || input.run_id.length > 512)
            throw new WorkspaceError('Invalid candidate text/confidence/run scope');
        const ids = referenceIds(input.source_ids, 'Candidate source'), task = input.task_id ?? null;
        if (task !== null && (typeof task !== 'string' || !task))
            throw new WorkspaceError('Invalid candidate task scope');
        return this.txn(() => {
            const sources = {};
            for (const id of ids)
                sources[id] = eventDigest(validateEvent(this.get(id), input.run_id, task, 'Candidate source'));
            const claim = { text, confidence: input.confidence, run_id: input.run_id, task_id: task, based_on: ids };
            const fingerprint = claimDigest(claim, sources);
            const existing = this.db.prepare("SELECT * FROM nodes WHERE kind='inference' AND json_extract(payload_json,'$.memory_candidate.fingerprint')=? ORDER BY seq LIMIT 1").get(fingerprint);
            if (existing)
                return rowToNode(existing);
            const { id, seq } = this.nextId(), now = Date.now(), meta = { version: 1, state: 'pending', fingerprint, sources };
            this.db.prepare("INSERT INTO nodes(id,seq,kind,agent_id,run_id,task_id,text,payload_json,confidence,status,based_on_json,created_at,updated_at) VALUES(?,?,'inference',?,?,?,?,?,?,'active',?,?,?)").run(id, seq, this.agentId, input.run_id, task, text, JSON.stringify({ memory_candidate: meta }), input.confidence, JSON.stringify(ids), now, now);
            if (this.ledger) {
                const { op_id } = this.ledger.recordOperation(this.opInput('add', `candidate:${text}`));
                this.ledger.commitRevision(op_id, this.snapshotOf(this.assertExists(id)));
            }
            return this.assertExists(id);
        });
    }
    reviewCandidate(id, input) {
        if (this.role !== 'host')
            throw new WorkspaceError('Candidate review is host-only');
        if (!input || !['accept', 'reject'].includes(input.decision) || typeof input.reviewer !== 'string' || !input.reviewer.trim() || input.reviewer.length > 256 || typeof input.note !== 'string' || !input.note.trim() || input.note.length > 2000)
            throw new WorkspaceError('Invalid candidate review controls');
        // reject 是拒绝路径: 说明必填即可, 证据可空; accept 的 >=1 独立核验证据在下方 based_on 去重校验强制
        const evidence = referenceIds(input.evidence, 'Review evidence', { allowEmpty: input.decision === 'reject' });
        const request = { ...input, evidence, reviewer: input.reviewer.trim(), note: input.note.trim() };
        return this.txn(() => {
            const n = this.assertExists(id), c = candidateMeta(n);
            if (!c || input.expected_fingerprint !== c.fingerprint || claimDigest(n, c.sources) !== c.fingerprint)
                throw new WorkspaceError('Candidate review fingerprint conflict');
            if (c.state !== 'pending') {
                if (c.review && digest(c.review.request) === digest(request))
                    return n;
                throw new WorkspaceError('Candidate review terminal conflict');
            }
            if (n.status !== 'active' && n.status !== 'promoted')
                throw new WorkspaceError('Candidate is not active');
            for (const [sid, hash] of Object.entries(c.sources)) {
                const ref = validateEvent(this.get(sid), n.run_id, n.task_id, 'Candidate source');
                if (eventDigest(ref) !== hash)
                    throw new WorkspaceError('Candidate source snapshot stale');
            }
            if (input.decision === 'accept' && evidence.length < 1)
                throw new WorkspaceError('Candidate review accept requires independent verification evidence');
            const digests = {};
            for (const eid of evidence) {
                if (n.based_on.includes(eid))
                    throw new WorkspaceError('Review requires distinct verification evidence');
                digests[eid] = eventDigest(validateEvent(this.get(eid), n.run_id, n.task_id, 'Review evidence'));
            }
            const meta = { ...c, state: input.decision === 'accept' ? 'accepted' : 'rejected', review: { request, digests, at: Date.now() } };
            const payload = { ...n.payload, memory_candidate: meta, promote_evidence: evidence, promote_by: 'host-review', promote_note: request.note };
            this.db.prepare('UPDATE nodes SET status=?,payload_json=?,updated_at=? WHERE id=?').run(input.decision === 'accept' ? 'promoted' : 'demoted', JSON.stringify(payload), Date.now(), id);
            if (this.ledger) {
                const { op_id } = this.ledger.recordOperation(this.opInput('review', `candidate:${input.decision}:${request.reviewer}`));
                this.ledger.commitRevision(op_id, this.snapshotOf(this.assertExists(id)));
            }
            return this.assertExists(id);
        });
    }
    candidates(opts = {}) {
        const limit = opts.limit ?? 20;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100 || opts.status !== undefined && !['pending', 'accepted', 'rejected'].includes(opts.status))
            throw new WorkspaceError('Invalid candidate listing options');
        return this.db.prepare("SELECT * FROM nodes WHERE json_extract(payload_json,'$.memory_candidate.version')=1 ORDER BY seq DESC").all().map(rowToNode).filter(n => candidateMeta(n)).filter(n => (!opts.run_id || n.run_id === opts.run_id) && (!opts.status || candidateMeta(n)?.state === opts.status)).slice(0, limit);
    }
    // ---------------------------------------------------------------- progress / trail
    /**
     * progress 按 task_id 单行共享：多 Agent 同 task 协作核心。
     * ctx.base_updated_at 提供乐观锁：与库中 updated_at 不符 = 并发写 →
     * 应用传入 patch（后写赢）但 conflict 置位并记录字段级双方值 —— 不静默双真相。
     */
    // ---------------------------------------------------------------- M4 跨会话授权 (host 专属)
    /** 本工作区 grant 注册表（懒挂载；grants 表在首次访问时建）。 */
    grantRegistry() {
        if (!this.grants_)
            this.grants_ = new GrantRegistry(this.db);
        return this.grants_;
    }
    /** 显式授权（host 专属；task 身份≠session；默认拒绝一切未授权跨会话读取）。 */
    grantAccess(input) {
        if (this.role !== 'host')
            throw new WorkspaceError('Grant creation is host-only');
        return this.grantRegistry().create(this.agentId, input);
    }
    revokeGrant(grantId) {
        if (this.role !== 'host')
            throw new WorkspaceError('Grant revocation is host-only');
        return this.grantRegistry().revoke(grantId);
    }
    grants() { return this.grantRegistry().list(); }
    /**
     * 经 grant 只读投影对端工作区内容（脱敏副本；不写任何库；默认拒绝）。
     * caller 显式给出业务任务身份（task_id ≠ session_id；实例不隐式携带任务上下文，
     * 防止把会话身份误当授权键）。
     */
    readGranted(source, grantId, caller, opts) {
        if (this.role !== 'host')
            throw new WorkspaceError('Granted read is host-only');
        return readGrantedImpl({ listNodes: () => source.listNodes(), grants: source.grantRegistry() }, { workspace: this.workspaceId, task_id: caller.task_id, agent_id: opts?.agent_id ?? this.agentId, role: this.role }, grantId, opts);
    }
    updateProgress(taskId, patch, ctx) {
        if (!taskId)
            throw new WorkspaceError('update_progress 需要 task_id');
        return this.txn(() => this.updateProgressWithinTransaction(taskId, patch, ctx));
    }
    /** progress 合并语义保留（多 Agent 协作核心），但冲突判定优先修订级 CAS：
     *  账本挂载时 expected_revision 与写事务内 head 不符 → conflict 置位并记录双方值，
     *  同一毫秒墙钟不再漏判（M1 R3）。 */
    updateProgressWithinTransaction(taskId, patch, ctx) {
        let existing = this.db.prepare("SELECT * FROM nodes WHERE kind = 'progress' AND task_id = ?").get(taskId);
        const now = Date.now();
        const headBefore = this.ledger && existing ? this.ledger.headRevision(existing.id) : null;
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
                if (this.ledger) {
                    const { op_id } = this.ledger.recordOperation(this.opInput('progress', `task:${taskId} ${summary ?? ''}`));
                    this.ledger.commitRevision(op_id, this.snapshotOf(this.assertExists(id)));
                }
                return this.withRevision(this.assertExists(id));
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
        if (ctx?.expected_revision !== undefined && ctx.expected_revision !== headBefore) {
            // 修订级 CAS：progress 保留合并语义但必须显式标冲突（不静默 LWW）。
            conflict = true;
            conflictDetail = { ...(conflictDetail ?? {}) };
            conflictDetail['revision'] = [headBefore, ctx.expected_revision];
        }
        const mergedPayload = { ...node.payload, ...patch, status: status ?? node.payload.status, owner };
        const newSummary = summary ?? node.text;
        this.db.prepare(`UPDATE nodes SET text = ?, payload_json = ?, conflict = ?, conflict_json = ?,
                        agent_id = ?, updated_at = ? WHERE id = ?`).run(newSummary, JSON.stringify(mergedPayload), conflict ? 1 : 0, conflictDetail ? JSON.stringify(conflictDetail) : null, this.agentId, now, existing.id);
        if (this.ledger) {
            const { op_id } = this.ledger.recordOperation(this.opInput('progress', `task:${taskId} ${newSummary}`));
            this.ledger.commitRevision(op_id, this.snapshotOf(this.assertExists(existing.id)));
        }
        return this.withRevision(this.assertExists(existing.id));
    }
    /** 追加 trail 步（per-run 有界递增序，可回放）。
     *  seq 由单语句子查询原子分配（与 nextId 同款并发纪律）：跨进程并发追加同一 run
     *  不再撞 PK(run_id,seq) 裸 SqliteError——写入锁内取 MAX+1，恒唯一。 */
    appendTrail(runId, step) {
        if (!runId)
            throw new WorkspaceError('append_trail 需要 run_id');
        return this.txn(() => {
            const action = String(step.action ?? '');
            if (!action.trim())
                throw new WorkspaceError('trail 步骤 action 不能为空');
            const refs = (step.refs ?? []).map(String);
            for (const r of refs)
                this.assertExists(r); // refs 引用完整性（写事务内）
            const ts = Date.now();
            const result = this.db.prepare(`INSERT INTO trail (run_id, seq, agent_id, action, refs_json, ts)
         VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM trail WHERE run_id = ?), ?, ?, ?, ?)`).run(runId, runId, this.agentId, action, JSON.stringify(refs), ts);
            // 经 rowid 读回本行真实 seq（并发下不能用 MAX：可能已被后到者再叠一号）
            const row = this.db.prepare('SELECT seq FROM trail WHERE rowid = ?').get(result.lastInsertRowid);
            // M1：账本操作是稳定锚点——GC 压缩 trail 表可重编号，账本 op 坐标不可变（R4）。
            if (this.ledger) {
                this.ledger.recordOperation(this.opInput('trail', `${runId}#${row.seq} ${action}`));
            }
            return { run_id: runId, seq: row.seq, agent_id: this.agentId, action, refs, ts, compressed: false };
        });
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
        if (opts?.view !== undefined && opts.view !== 'raw' && opts.view !== 'curated')
            throw new WorkspaceError('Invalid recall view');
        const now = Date.now();
        const budgets = resolveBudgets(opts?.budgets);
        const curated = opts?.view === 'curated';
        const curation = curated ? { view: 'curated', excluded: 0, reasons: {} } : undefined;
        const eligible = (n) => {
            const reason = candidateReason(n, id => this.get(id)) ?? curationReason(n, query ?? '', opts ?? {});
            if (!reason)
                return true;
            if (curation) {
                curation.excluded++;
                curation.reasons[reason] = (curation.reasons[reason] ?? 0) + 1;
            }
            return false;
        };
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
        if (curated)
            progress = this.db.prepare("SELECT * FROM nodes WHERE kind = 'progress' AND status = 'active'").all().map(rowToNode).filter(eligible);
        // 竞争候选：其余 active 节点
        let competitors = this.db.prepare(`SELECT * FROM nodes WHERE (status = 'active' OR (kind = 'inference' AND status = 'promoted'))
         AND NOT (kind = 'progress' AND task_id IS NOT NULL)
       ORDER BY updated_at DESC`).all().map(rowToNode).filter((n) => {
            if (n.kind === 'constraint')
                return false;
            if (n.kind === 'progress')
                return !progress.some((p) => p.id === n.id);
            return true;
        });
        if (curated)
            competitors = competitors.filter(n => n.kind !== 'progress').filter(eligible);
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
            ...(curation ? { curation } : {}),
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
        return this.txn(() => {
            if (this.ledger && opts?.expected_revision === undefined) {
                throw new WorkspaceError('账本挂载时 promote 需要 expected_revision（修订级 CAS，显式重读后重试）');
            }
            const n = this.assertExists(id);
            if (n.kind !== 'inference') {
                throw new WorkspaceError(`promote 仅适用于 inference，得到 ${n.kind}: ${id}`);
            }
            if (n.status === 'promoted')
                return this.withRevision(n);
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
            if (this.ledger) {
                const { op_id } = this.ledger.recordOperation(this.opInput('promote', `inference:${id}`));
                this.ledger.commitRevision(op_id, this.snapshotOf(this.assertExists(id)), { expectedRevision: opts?.expected_revision });
            }
            return this.withRevision(this.assertExists(id));
        });
    }
    /** 显式降级（任意 kind）：不参与激活，不物理删除。
     *  角色门控：目标 kind 的写纪律矩阵同样适用于 lifecycle ——
     *  model 不得 demote constraint / observation（host-only），否则冻结集「永不裁光」可被旁路。 */
    demote(id, opts) {
        return this.txn(() => {
            if (this.ledger && opts?.expected_revision === undefined) {
                throw new WorkspaceError('账本挂载时 demote 需要 expected_revision（修订级 CAS，显式重读后重试）');
            }
            const n = this.assertExists(id);
            if (n.kind !== 'progress') {
                const allowed = KIND_ALLOWED_ROLES[n.kind];
                if (allowed && !allowed.includes(this.role)) {
                    throw new WriteForbiddenError(n.kind, this.role, allowed);
                }
            }
            const payload = { ...n.payload, demote_reason: opts?.reason ?? '' };
            this.db.prepare("UPDATE nodes SET status = 'demoted', payload_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(payload), Date.now(), id);
            if (this.ledger) {
                const { op_id } = this.ledger.recordOperation(this.opInput('demote', `${n.kind}:${id}`));
                this.ledger.commitRevision(op_id, this.snapshotOf(this.assertExists(id)), { expectedRevision: opts?.expected_revision });
            }
            return this.withRevision(this.assertExists(id));
        });
    }
    /** 显式 contradict：推翻一条 inference（evidence 引用观测或文本说明，至少其一——禁止无依据推翻）。 */
    contradict(id, opts) {
        return this.txn(() => {
            if (this.ledger && opts?.expected_revision === undefined) {
                throw new WorkspaceError('账本挂载时 contradict 需要 expected_revision（修订级 CAS，显式重读后重试）');
            }
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
            if (this.ledger) {
                const { op_id } = this.ledger.recordOperation(this.opInput('contradict', `inference:${id}`));
                this.ledger.commitRevision(op_id, this.snapshotOf(this.assertExists(id)), { expectedRevision: opts?.expected_revision });
            }
            return this.withRevision(this.assertExists(id));
        });
    }
    // ---------------------------------------------------------------- gc
    /**
     * gc：trail 压缩（per-run 超保留上限时中间段合并，保留首尾）+ 可选 TTL 降级
     * （仅 tip/inference；observation 默认绝不因 TTL 删）+ 可选 purge（物理清理，
     * 保护存活节点的传递依据（含 promote_evidence））。
     */
    gc(opts) {
        return this.txn(() => {
            const report = this.gcWithinTransaction(opts);
            if (this.ledger) {
                this.ledger.recordOperation(this.opInput('gc', `gc:${JSON.stringify(report)}`));
            }
            return report;
        });
    }
    gcWithinTransaction(opts) {
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
                if (this.ledger) {
                    const { op_id } = this.ledger.recordOperation(this.opInput('status', `ttl-demote:${r.id}`));
                    this.ledger.commitRevision(op_id, this.snapshotOf(this.assertExists(r.id)));
                }
                report.demoted_by_ttl++;
            }
        }
        // 3) purge（默认关）：物理删除已降级/已推翻/已覆盖行，保护存活节点的传递依据（含 promote_evidence）
        if (opts?.purge) {
            const rows = this.db.prepare('SELECT * FROM nodes').all();
            const byId = new Map(rows.map((r) => [r.id, rowToNode(r)]));
            const protectedIds = new Set();
            const queue = rows.filter((r) => r.status === 'active' || r.status === 'promoted').map((r) => r.id);
            while (queue.length) {
                const id = queue.pop();
                if (protectedIds.has(id))
                    continue;
                protectedIds.add(id);
                const node = byId.get(id);
                if (!node)
                    continue; // Historic missing references are not invented.
                const edges = [...node.based_on];
                for (const key of ['promote_evidence', 'contradict_evidence']) {
                    const value = node.payload[key];
                    if (Array.isArray(value)) {
                        for (const dep of value)
                            if (typeof dep === 'string')
                                edges.push(dep);
                    }
                }
                for (const dep of edges)
                    if (!protectedIds.has(dep))
                        queue.push(dep);
            }
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
    // ---------------------------------------------------------------- M1 provenance API
    /** schema2 全量导出：v1 记忆包 + 完整账本（操作/修订/head/引用链接）。
     *  仅账本挂载时可用；v1 exportPkg 保持原样，不伪装含历史。 */
    exportFullPkg() {
        if (!this.ledger)
            throw new WorkspaceError('账本未挂载：exportFullPkg 需要 open({ledger:true})');
        const base = this.exportPkg();
        const ledgerPkg = exportLedger(this.db, this.ledger.workspaceInstanceId);
        // M2：证据存在时导 v3 包（旧二进制显式拒绝，不静默丢证据）；无证据保持 v2 形状。
        if (this.evidence && this.evidence.hasEvidence()) {
            ledgerPkg.schema_version = 3;
            ledgerPkg.evidence = this.evidence.exportEvidence();
            return { ...base, schema_version: 3, ledger: ledgerPkg };
        }
        return { ...base, schema_version: 2, ledger: ledgerPkg };
    }
    /** schema2 全量导入：memory 部分 + 账本在同一事务内原子发布；目标非空拒绝。
     *  旧入口 importPkg（仅认 schema_version=1）遇到 v2 包会明确报错——降级打开被拒绝。 */
    static importFullPkg(pkg, toDir, opts) {
        if (pkg.schema_version !== 2 && pkg.schema_version !== 3) {
            throw new WorkspaceError(`importFullPkg 需要 schema_version 2 或 3，得到: ${String(pkg.schema_version)}`);
        }
        if (pkg.schema_version === 3 && !pkg.ledger.evidence) {
            throw new WorkspaceError('schema_version 3 包缺少 evidence 节（损坏或被裁剪的包）');
        }
        const net = MemoryNet.open(toDir, { workspaceId: pkg.workspace_id, agentId: opts?.agentId, role: opts?.role, ledger: true });
        try {
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
            importLedgerRows(net.db, pkg.ledger);
            if (pkg.schema_version === 3 && pkg.ledger.evidence) {
                net.evidence.importEvidence(pkg.ledger.evidence);
            }
            net.db.exec('COMMIT');
            return net;
        }
        catch (e) {
            try {
                net.db.exec('ROLLBACK');
            }
            catch {
                /* 事务未开启（校验前置失败等） */
            }
            net.close();
            throw e;
        }
    }
    // ---------------------------------------------------------------- M2 evidence API
    /** 捕获代码状态（host/tool；声明式：只记录实际观测，缺=unknown 不补造）。 */
    captureCodeState(input) {
        const ev = this.requireEvidence('captureCodeState');
        this.assertEvidenceRole('captureCodeState');
        return this.txn(() => {
            const rec = ev.capture(input, this.agentId);
            this.ledger.recordOperation(this.opInput('capture', `capture:${rec.code_state_id} ${rec.completeness}/${rec.git_status} files=${Object.keys(rec.files).length}`));
            return rec;
        });
    }
    getCodeState(id) {
        return this.evidence ? this.evidence.getCodeState(id) : null;
    }
    /** 绑定节点 → 代码状态 + 事件坐标 + 文件摘要（host/tool；追加式，旧绑定可定位）。 */
    bindEvidence(nodeId, input) {
        const ev = this.requireEvidence('bindEvidence');
        this.assertEvidenceRole('bindEvidence');
        return this.txn(() => {
            this.assertExists(nodeId);
            const ref = ev.bind(nodeId, this.ledger.headRevision(nodeId), input, this.agentId);
            this.ledger.recordOperation(this.opInput('bind', `bind:${nodeId}->${ref.code_state_id}`, {
                session_id: input.session_id ?? null, durable_event_seq: input.durable_event_seq ?? null,
                call_id: input.call_id ?? null, root_call_id: input.root_call_id ?? null,
            }));
            return ref;
        });
    }
    /** 当前生效证据绑定。 */
    evidenceOf(nodeId) {
        return this.evidence ? this.evidence.currentRef(nodeId) : null;
    }
    /** 全部绑定历史（原证据可定位）。 */
    evidenceHistory(nodeId) {
        return this.evidence ? this.evidence.refHistory(nodeId) : [];
    }
    /** 核验证据（host/tool）：related change → needs_review（追加标记修订，原证据保留）；
     *  无关变化不失效；同内容（含行尾归一）不证伪；当前态不可得 → unknown。 */
    verifyEvidence(nodeId, currentCodeStateId) {
        const ev = this.requireEvidence('verifyEvidence');
        this.assertEvidenceRole('verifyEvidence');
        return this.txn(() => {
            this.assertExists(nodeId);
            const result = ev.verify(nodeId, currentCodeStateId, this.agentId);
            const { op_id } = this.ledger.recordOperation(this.opInput('verify', `verify:${nodeId} ${result.outcome} changed=${result.changed.length}`));
            if (result.outcome === 'needs_review') {
                const node = this.assertExists(nodeId);
                const prevRef = ev.currentRef(nodeId);
                const payload = {
                    ...node.payload,
                    needs_review: {
                        reason: 'code_state_changed',
                        validation_id: result.validation_id,
                        changed_files: result.changed.map(c => c.path),
                        original_code_state_id: prevRef.code_state_id,
                        bound_revision_id: prevRef.revision_id,
                        at: result.verified_at,
                    },
                };
                this.db.prepare('UPDATE nodes SET payload_json = ?, updated_at = ? WHERE id = ?')
                    .run(JSON.stringify(payload), Date.now(), nodeId);
                this.ledger.commitRevision(op_id, this.snapshotOf(this.assertExists(nodeId)));
            }
            return result;
        });
    }
    requireEvidence(what) {
        if (!this.ledger || !this.evidence)
            throw new WorkspaceError(`${what} 需要 open({ledger:true})（证据随账本挂载）`);
        return this.evidence;
    }
    assertEvidenceRole(what) {
        if (this.role === 'model')
            throw new WorkspaceError(`${what} 是宿主/工具面能力，模型角色不可调用`);
    }
    /** 显式迁移：把 schema1 当前态导入账本为 origin=legacy_baseline 首修订。
     *  迁移前整库备份（memory.db+WAL/SHM）；不补造过去历史；已有账本内容拒绝。
     *  sidecar 可整体删除回退 schema1 行为（账本是可选叠加，不是替代）。 */
    migrateLedgerBaseline() {
        const ledger = this.ledger;
        if (!ledger)
            throw new WorkspaceError('账本未挂载：migrateLedgerBaseline 需要 open({ledger:true})');
        const backup = backupWorkspace(this.wsDir);
        return this.txn(() => {
            const ops = this.db.prepare('SELECT COUNT(*) AS c FROM ledgerdb.operations').get();
            if (ops.c > 0)
                throw new WorkspaceError('账本已有操作记录：拒绝重复迁移（基线只能建立一次）');
            const rows = this.db.prepare('SELECT * FROM nodes ORDER BY seq ASC').all();
            const { op_id } = ledger.recordOperation(this.opInput('migration', `baseline:${rows.length} nodes`));
            for (const r of rows) {
                ledger.ensureBaseline(op_id, this.snapshotOf(rowToNode(r)));
            }
            return { migrated: rows.length, backup };
        });
    }
    /** 敏感删除/脱敏：物理移除目标节点（或单修订）的账本历史及指向它的引用链接，
     *  并为每个依赖方追加 needs_review 标记修订——"不可变"是追加纪律，不是拒绝用户删除的借口。
     *  live 行的生命周期仍由 demote/gc 管理；本方法只处理账本历史的删除与关联失效。host-only。 */
    redact(target, opts) {
        const ledger = this.ledger;
        if (!ledger)
            throw new WorkspaceError('账本未挂载：redact 需要 open({ledger:true})');
        if (this.role !== 'host')
            throw new WorkspaceError('redact 仅 host 可执行');
        return this.txn(() => {
            const { op_id } = ledger.recordOperation(this.opInput('redact', `redact:${target.node_id}${target.revision_id ? '/' + target.revision_id : ''} ${opts?.note ?? ''}`));
            const result = ledger.redact(target, op_id, this.agentId);
            // 整节点脱敏可选连带 live 行删除（用户显式请求时）：
            // 依赖方 based_on 保留 id 但其修订已标 needs_review；新写入引用将校验失败。
            if (opts?.delete_live && target.revision_id === undefined) {
                this.db.prepare('DELETE FROM nodes WHERE id = ?').run(target.node_id);
            }
            return result;
        });
    }
}
