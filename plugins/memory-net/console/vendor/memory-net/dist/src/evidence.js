/**
 * M2 宿主会话／代码版本绑定 —— code_states + source_refs + evidence_validations。
 *
 * 定位：issue #2 M2。全部表在 sidecar `provenance.db`（ATTACH 为 ledgerdb）内，
 * 与 M1 账本同连接同事务。schema_version 保持 2（纯增量表 + ledger_meta 特性版本
 * 守卫：库内特性版本高于本实现时拒绝打开——前向保护；旧二进制忽略新表，安全降读）。
 *
 * 纪律（缺元数据 = unknown，绝不补造）：
 * - Git commit 不能代表完整工作树：只有 git 元数据 → completeness 至多 partial。
 * - dirty/untracked/untrackedUnknown/shell 副作用 → 至多 partial；无摘要 → unknown。
 * - completeness=complete 仅当：宿主原生捕获 + 显式全量枚举声明 + git 信息在场 +
 *   非 dirty（或 dirty 文件全部有摘要）+ untracked 完全可知。
 * - 文件 before/after 摘要缺失 → null（unknown），不编造、不用 mtime/大小冒充。
 * - needs_review 是标记不是推翻：追加修订，原绑定与原 code_state 永久可定位。
 */
import { createHash, randomUUID } from 'node:crypto';
/** 捕获策略版本（policy 版本化：策略变更时新版本号，旧记录按旧策略解释）。 */
export const CAPTURE_POLICY = 'm2-capture-v1';
/** sidecar 特性版本（前向守卫：库内版本 > 本实现 → 拒绝打开）。 */
export const EVIDENCE_FEATURE_VERSION = 'm2-v1';
export class EvidenceError extends Error {
}
/** 内容规范化：仅行尾 CRLF/CR → LF。空白/Unicode 改写都是内容变化，不归一。 */
export function normalizeContent(s) {
    return s.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}
/** 规范化摘要（sha256 hex）。 */
export function contentDigest(content) {
    return createHash('sha256').update(normalizeContent(content), 'utf8').digest('hex');
}
// ---------------------------------------------------------------- DDL 与挂载
const DDL = `
CREATE TABLE IF NOT EXISTS ledgerdb.code_states (
  code_state_id   TEXT PRIMARY KEY,
  root            TEXT NOT NULL,
  git_commit      TEXT,
  git_status      TEXT NOT NULL CHECK(git_status IN ('clean','dirty','unknown')),
  completeness    TEXT NOT NULL CHECK(completeness IN ('complete','partial','unknown')),
  files_json      TEXT NOT NULL,
  changed_json    TEXT NOT NULL,
  untracked_json  TEXT NOT NULL,
  untracked_unknown INTEGER NOT NULL DEFAULT 0,
  capture_source  TEXT NOT NULL,
  capture_policy  TEXT NOT NULL,
  captured_at     INTEGER NOT NULL,
  actor           TEXT NOT NULL,
  notes           TEXT
);
CREATE INDEX IF NOT EXISTS ledgerdb.idx_code_states_captured ON code_states(captured_at);
CREATE TABLE IF NOT EXISTS ledgerdb.source_refs (
  node_id          TEXT NOT NULL,
  seq              INTEGER NOT NULL,
  current          INTEGER NOT NULL DEFAULT 1,
  revision_id      TEXT,
  code_state_id    TEXT NOT NULL REFERENCES code_states(code_state_id),
  session_id       TEXT,
  durable_event_seq INTEGER,
  call_id          TEXT,
  root_call_id     TEXT,
  files_json       TEXT NOT NULL,
  link_status      TEXT NOT NULL CHECK(link_status IN ('captured','event_linked','persisted_unknown')),
  bound_at         INTEGER NOT NULL,
  capture_policy   TEXT NOT NULL,
  PRIMARY KEY (node_id, seq)
);
CREATE INDEX IF NOT EXISTS ledgerdb.idx_source_refs_current ON source_refs(node_id, current);
CREATE TABLE IF NOT EXISTS ledgerdb.evidence_validations (
  validation_id  TEXT PRIMARY KEY,
  node_id        TEXT NOT NULL,
  outcome        TEXT NOT NULL CHECK(outcome IN ('valid','needs_review','unknown')),
  changed_json   TEXT NOT NULL,
  unrelated_json TEXT NOT NULL,
  code_state_id  TEXT NOT NULL REFERENCES code_states(code_state_id),
  validated_at   INTEGER NOT NULL,
  actor          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ledgerdb.idx_validations_node ON evidence_validations(node_id, validated_at);
`;
function parseJson(s, fallback) {
    try {
        return JSON.parse(s);
    }
    catch {
        return fallback;
    }
}
function codeStateFromRow(r) {
    return {
        code_state_id: r.code_state_id, root: r.root, git_commit: r.git_commit,
        git_status: r.git_status,
        completeness: r.completeness,
        files: parseJson(r.files_json, {}),
        changed_files: parseJson(r.changed_json, []),
        untracked_files: parseJson(r.untracked_json, []),
        untracked_unknown: r.untracked_unknown === 1,
        capture_source: r.capture_source,
        capture_policy: r.capture_policy, captured_at: r.captured_at, actor: r.actor, notes: r.notes,
    };
}
function refFromRow(r) {
    return {
        node_id: r.node_id, revision_id: r.revision_id, code_state_id: r.code_state_id,
        session_id: r.session_id, durable_event_seq: r.durable_event_seq, call_id: r.call_id,
        root_call_id: r.root_call_id, files: parseJson(r.files_json, []),
        link_status: r.link_status, bound_at: r.bound_at, capture_policy: r.capture_policy,
        ref_seq: r.seq, is_current: r.current === 1,
    };
}
/**
 * 挂载 M2 证据表（幂等）＋特性版本前向守卫。
 * 必须在 attachLedger 之后、同一连接上调用。
 */
export function attachEvidence(db) {
    db.exec(DDL);
    const known = db.prepare("SELECT v FROM ledgerdb.ledger_meta WHERE k = 'evidence_feature_version'").get();
    if (known && known.v !== EVIDENCE_FEATURE_VERSION) {
        throw new EvidenceError(`provenance.db 证据特性版本 ${known.v} 高于本实现支持的 ${EVIDENCE_FEATURE_VERSION}，拒绝打开`);
    }
    if (!known) {
        db.prepare("INSERT INTO ledgerdb.ledger_meta (k, v) VALUES ('evidence_feature_version', ?)").run(EVIDENCE_FEATURE_VERSION);
    }
    return new EvidenceStore(db);
}
// ---------------------------------------------------------------- 存储
export class EvidenceStore {
    db;
    constructor(db) {
        this.db = db;
    }
    /** 捕获一个代码状态。规则见文件头纪律；返回记录（含推导的 completeness）。 */
    capture(input, actor) {
        if (!input || typeof input.root !== 'string' || !input.root)
            throw new EvidenceError('captureCodeState 需要 root（工作树根）');
        const source = input.source ?? 'unknown';
        const git = input.git ?? {};
        const gitCommit = typeof git.commit === 'string' && git.commit ? git.commit : null;
        const gitStatus = git.status === 'clean' || git.status === 'dirty' ? git.status : 'unknown';
        const changed = (git.changedFiles ?? []).map(String);
        const untracked = (git.untrackedFiles ?? []).map(String);
        const untrackedUnknown = git.untrackedUnknown === true || (gitStatus === 'unknown' && untracked.length === 0 && source !== 'host_native');
        const files = {};
        for (const f of input.files ?? []) {
            if (!f || typeof f.path !== 'string' || !f.path)
                continue;
            if (typeof f.digest === 'string' && f.digest)
                files[f.path] = f.digest;
            else if (typeof f.content === 'string')
                files[f.path] = contentDigest(f.content);
            // 两者皆缺 = 该文件 unknown：不入表，不编造。
        }
        // completeness 推导（从严）：
        let completeness;
        const hasGitInfo = gitStatus !== 'unknown' || gitCommit !== null;
        const canBeComplete = source === 'host_native' &&
            input.fullEnumeration === true &&
            hasGitInfo &&
            gitStatus !== 'dirty' &&
            !untrackedUnknown;
        if (canBeComplete)
            completeness = 'complete';
        else if (Object.keys(files).length > 0 || hasGitInfo)
            completeness = 'partial';
        else
            completeness = 'unknown';
        // shell 副作用观测永不证明全树已知（至多 partial；有摘要才 partial）。
        if (source === 'shell' && completeness === 'complete')
            completeness = 'partial';
        const rec = {
            code_state_id: randomUUID(), root: input.root, git_commit: gitCommit, git_status: gitStatus,
            completeness, files, changed_files: changed, untracked_files: untracked,
            untracked_unknown: untrackedUnknown, capture_source: source, capture_policy: CAPTURE_POLICY,
            captured_at: Date.now(), actor, notes: typeof input.notes === 'string' ? input.notes : null,
        };
        this.db.prepare(`INSERT INTO ledgerdb.code_states (code_state_id, root, git_commit, git_status, completeness, files_json, changed_json, untracked_json, untracked_unknown, capture_source, capture_policy, captured_at, actor, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(rec.code_state_id, rec.root, rec.git_commit, rec.git_status, rec.completeness, JSON.stringify(rec.files), JSON.stringify(rec.changed_files), JSON.stringify(rec.untracked_files), rec.untracked_unknown ? 1 : 0, rec.capture_source, rec.capture_policy, rec.captured_at, rec.actor, rec.notes);
        return rec;
    }
    getCodeState(id) {
        const row = this.db.prepare('SELECT * FROM ledgerdb.code_states WHERE code_state_id = ?').get(id);
        return row ? codeStateFromRow(row) : null;
    }
    mustGetCodeState(id) {
        const rec = this.getCodeState(id);
        if (!rec)
            throw new EvidenceError(`code_state ${id} 不存在（绑定必须在写事务内解析依赖）`);
        return rec;
    }
    nextRefSeq(nodeId) {
        const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM ledgerdb.source_refs WHERE node_id = ?').get(nodeId);
        return row.m + 1;
    }
    /** 绑定节点 → 代码状态 + 事件坐标 + 文件摘要。追加式：旧绑定 current=0 保留可查。 */
    bind(nodeId, revisionId, input, actor) {
        const cs = this.mustGetCodeState(input.code_state_id);
        const files = (input.files ?? []).map(f => ({
            path: String(f.path),
            before_digest: typeof f.before_digest === 'string' && f.before_digest ? f.before_digest : null,
            after_digest: typeof f.after_digest === 'string' && f.after_digest ? f.after_digest : null,
        })).filter(f => f.path);
        let linkStatus;
        if (input.session_id != null && input.durable_event_seq != null)
            linkStatus = 'captured';
        else if (input.call_id != null || input.root_call_id != null)
            linkStatus = 'event_linked';
        else
            linkStatus = 'persisted_unknown';
        const seq = this.nextRefSeq(nodeId);
        const now = Date.now();
        this.db.prepare('UPDATE ledgerdb.source_refs SET current = 0 WHERE node_id = ? AND current = 1').run(nodeId);
        this.db.prepare(`INSERT INTO ledgerdb.source_refs (node_id, seq, current, revision_id, code_state_id, session_id, durable_event_seq, call_id, root_call_id, files_json, link_status, bound_at, capture_policy)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(nodeId, seq, revisionId, cs.code_state_id, input.session_id ?? null, input.durable_event_seq ?? null, input.call_id ?? null, input.root_call_id ?? null, JSON.stringify(files), linkStatus, now, CAPTURE_POLICY);
        return {
            node_id: nodeId, revision_id: revisionId, code_state_id: cs.code_state_id,
            session_id: input.session_id ?? null, durable_event_seq: input.durable_event_seq ?? null,
            call_id: input.call_id ?? null, root_call_id: input.root_call_id ?? null,
            files, link_status: linkStatus, bound_at: now, capture_policy: CAPTURE_POLICY,
        };
    }
    /** 当前生效绑定。 */
    currentRef(nodeId) {
        const row = this.db.prepare('SELECT * FROM ledgerdb.source_refs WHERE node_id = ? AND current = 1').get(nodeId);
        return row ? refFromRow(row) : null;
    }
    /** 全部绑定历史（原证据可定位）。 */
    refHistory(nodeId) {
        return this.db.prepare('SELECT * FROM ledgerdb.source_refs WHERE node_id = ? ORDER BY seq ASC').all(nodeId).map(refFromRow);
    }
    /**
     * 核验：以当前 code_state 对照绑定证据。
     *  - 证据文件当前摘要可得且一致（含行尾归一）→ valid（同内容重验不证伪）
     *  - 证据文件变化 → needs_review（记录 validation，不删原绑定）
     *  - 证据文件当前摘要不可得 → unknown（不可访问源码不得伪装为已知版本）
     *  - 证据之外的文件变化 → 不影响判定，列入 unrelated_changed（无关变化不失效）
     */
    verify(nodeId, currentCodeStateId, actor) {
        const ref = this.currentRef(nodeId);
        if (!ref)
            throw new EvidenceError(`节点 ${nodeId} 未绑定证据（先 bindEvidence）`);
        const cur = this.mustGetCodeState(currentCodeStateId);
        const prev = this.mustGetCodeState(ref.code_state_id);
        const changed = [];
        const unrelated = [];
        let anyUnknown = false;
        for (const f of ref.files) {
            const curDigest = cur.files[f.path] ?? null;
            const evidenceAfter = f.after_digest ?? f.before_digest;
            if (curDigest === null) {
                anyUnknown = true;
                continue;
            }
            const expected = evidenceAfter ?? null;
            if (expected !== null && curDigest !== expected) {
                changed.push({ path: f.path, evidence_after: expected, current: curDigest });
            }
        }
        // 无关变化：当前态与原捕获态相比，不在证据文件内的已知差异。
        const evidencePaths = new Set(ref.files.map(f => f.path));
        for (const p of Object.keys(cur.files)) {
            if (evidencePaths.has(p))
                continue;
            const prevDigest = prev.files[p];
            if (prevDigest !== undefined && cur.files[p] !== prevDigest)
                unrelated.push(p);
        }
        for (const p of cur.changed_files)
            if (!evidencePaths.has(p) && !unrelated.includes(p))
                unrelated.push(p);
        let outcome;
        if (changed.length > 0)
            outcome = 'needs_review';
        else if (anyUnknown)
            outcome = 'unknown';
        else if (ref.files.length === 0)
            outcome = 'unknown'; // 无文件证据 → 无从核验内容
        else
            outcome = 'valid';
        const validationId = randomUUID();
        this.db.prepare(`INSERT INTO ledgerdb.evidence_validations (validation_id, node_id, outcome, changed_json, unrelated_json, code_state_id, validated_at, actor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(validationId, nodeId, outcome, JSON.stringify(changed), JSON.stringify(unrelated), currentCodeStateId, Date.now(), actor);
        return {
            node_id: nodeId, outcome, changed, unrelated_changed: unrelated,
            validation_id: validationId, verified_at: Date.now(),
        };
    }
    // ---------------------------------------------------------------- 导出/导入
    exportEvidence() {
        const code_states = this.db.prepare('SELECT * FROM ledgerdb.code_states ORDER BY captured_at ASC').all().map(codeStateFromRow);
        const source_refs = this.db.prepare('SELECT * FROM ledgerdb.source_refs ORDER BY node_id ASC, seq ASC').all().map(refFromRow);
        const validations = this.db.prepare('SELECT * FROM ledgerdb.evidence_validations ORDER BY validated_at ASC').all();
        return { code_states, source_refs, validations };
    }
    hasEvidence() {
        const row = this.db.prepare('SELECT (SELECT COUNT(*) FROM ledgerdb.code_states) + (SELECT COUNT(*) FROM ledgerdb.source_refs) + (SELECT COUNT(*) FROM ledgerdb.evidence_validations) AS c').get();
        return row.c > 0;
    }
    /** 导入前闭包校验 + 写入（目标须为空证据表；调用方事务内）。 */
    importEvidence(pkg) {
        const knownCs = new Set(pkg.code_states.map(c => c.code_state_id));
        if (pkg.source_refs.some(r => !knownCs.has(r.code_state_id))) {
            throw new EvidenceError('证据导入校验失败：source_refs 存在悬空 code_state 引用');
        }
        for (const v of pkg.validations) {
            if (!knownCs.has(String(v.code_state_id)))
                throw new EvidenceError('证据导入校验失败：validation 存在悬空 code_state 引用');
        }
        const existing = this.db.prepare('SELECT COUNT(*) AS c FROM ledgerdb.code_states').get();
        if (existing.c > 0)
            throw new EvidenceError('导入目标已有 code_states，拒绝覆盖导入');
        const insCs = this.db.prepare(`INSERT INTO ledgerdb.code_states (code_state_id, root, git_commit, git_status, completeness, files_json, changed_json, untracked_json, untracked_unknown, capture_source, capture_policy, captured_at, actor, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const c of pkg.code_states) {
            insCs.run(c.code_state_id, c.root, c.git_commit, c.git_status, c.completeness, JSON.stringify(c.files), JSON.stringify(c.changed_files), JSON.stringify(c.untracked_files), c.untracked_unknown ? 1 : 0, c.capture_source, c.capture_policy, c.captured_at, c.actor, c.notes);
        }
        const insRef = this.db.prepare(`INSERT INTO ledgerdb.source_refs (node_id, seq, current, revision_id, code_state_id, session_id, durable_event_seq, call_id, root_call_id, files_json, link_status, bound_at, capture_policy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const r of pkg.source_refs) {
            insRef.run(r.node_id, r.ref_seq ?? 1, r.is_current === false ? 0 : 1, r.revision_id, r.code_state_id, r.session_id, r.durable_event_seq, r.call_id, r.root_call_id, JSON.stringify(r.files), r.link_status, r.bound_at, r.capture_policy);
        }
        const insV = this.db.prepare(`INSERT INTO ledgerdb.evidence_validations (validation_id, node_id, outcome, changed_json, unrelated_json, code_state_id, validated_at, actor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const v of pkg.validations) {
            insV.run(String(v.validation_id), String(v.node_id), String(v.outcome), JSON.stringify(v.changed ?? []), JSON.stringify(v.unrelated_changed ?? []), String(v.code_state_id), Number(v.validated_at), String(v.actor));
        }
    }
}
