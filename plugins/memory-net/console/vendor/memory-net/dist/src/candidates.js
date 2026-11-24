import { createHash } from 'node:crypto';
export const digest = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const eventDigest = (n) => digest({ id: n.id, kind: n.kind, run_id: n.run_id, task_id: n.task_id, key: n.key, text: n.text, payload: n.payload, source: n.source, created_at: n.created_at });
export const claimDigest = (n, sources) => digest({ text: n.text, confidence: n.confidence, run_id: n.run_id, task_id: n.task_id, sources: n.based_on.map(id => [id, sources[id]]) });
export function candidateMeta(n) {
    const v = n.payload.memory_candidate;
    if (!v || n.kind !== 'inference' || typeof n.run_id !== 'string' || !n.run_id || v.version !== 1 || !['pending', 'accepted', 'rejected'].includes(v.state) || typeof v.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(v.fingerprint) || !v.sources || typeof v.sources !== 'object' || Array.isArray(v.sources))
        return null;
    const ids = Object.keys(v.sources).sort();
    if (!ids.length || ids.length > 32 || JSON.stringify(ids) !== JSON.stringify([...n.based_on].sort()) || ids.some(id => !/^n[1-9][0-9]*$/.test(id) || typeof v.sources[id] !== 'string' || !/^[a-f0-9]{64}$/.test(v.sources[id])))
        return null;
    if (v.state !== 'pending') {
        const r = v.review;
        if (!r || !r.request || typeof r.request.reviewer !== 'string' || !r.request.reviewer.trim() || typeof r.request.note !== 'string' || !r.request.note.trim() || r.request.expected_fingerprint !== v.fingerprint || !['accept', 'reject'].includes(r.request.decision) || !r.digests || typeof r.digests !== 'object' || Array.isArray(r.digests))
            return null;
        try {
            const evidence = referenceIds(r.request.evidence, 'Review receipt');
            if (evidence.some(id => ids.includes(id) || typeof r.digests[id] !== 'string' || !/^[a-f0-9]{64}$/.test(r.digests[id])) || JSON.stringify(Object.keys(r.digests).sort()) !== JSON.stringify(evidence))
                return null;
        }
        catch {
            return null;
        }
    }
    return v;
}
export function referenceIds(value, label, opts) {
    const min = opts?.allowEmpty ? 0 : 1;
    if (!Array.isArray(value) || value.length < min || value.length > 32 || value.some(id => typeof id !== 'string' || !/^[n][1-9][0-9]*$/.test(id)))
        throw new Error(label + ` requires ${min}..32 valid observation IDs`);
    return [...new Set(value)].sort();
}
export function validateEvent(n, run, task, label) {
    if (!n || n.kind !== 'observation' || n.status !== 'active' || n.run_id !== run || n.task_id !== task || n.payload.is_error === true)
        throw new Error(label + ' observation must be active, successful and in the same scope');
    return n;
}
export function candidateReason(n, get) {
    if (!Object.hasOwn(n.payload, 'memory_candidate'))
        return null;
    const c = candidateMeta(n);
    if (!c)
        return 'invalid_candidate';
    if (c.state !== 'accepted' || n.status !== 'promoted' || !c.review || c.review.request.decision !== 'accept')
        return 'unreviewed_candidate';
    if (claimDigest(n, c.sources) !== c.fingerprint)
        return 'changed_candidate';
    try {
        for (const [id, hash] of Object.entries({ ...c.sources, ...c.review.digests })) {
            const ref = validateEvent(get(id), n.run_id, n.task_id, 'Candidate evidence');
            if (eventDigest(ref) !== hash)
                return 'stale_candidate_evidence';
        }
    }
    catch {
        return 'stale_candidate_evidence';
    }
    return null;
}
