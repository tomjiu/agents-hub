export function contextReason(n, opts) {
    if (n.kind === 'constraint')
        return null;
    if (n.task_id !== null) {
        if (opts.task_id) {
            if (n.task_id !== opts.task_id)
                return 'other_task';
        }
        else if (!opts.run_id || n.run_id !== opts.run_id)
            return 'unscoped_task';
    }
    if (n.run_id !== null) {
        if (opts.run_id) {
            if (n.run_id !== opts.run_id)
                return 'other_run';
        }
        else if (!opts.task_id || n.task_id !== opts.task_id)
            return 'unscoped_run';
    }
    return null;
}
/** NFKC literal tokens, ASCII word boundaries; not embeddings or semantic matching. */
export function curatedMatch(query, n) {
    const words = query.normalize('NFKC').toLowerCase().split(/[\s,，、;；]+/u).filter(Boolean);
    const hay = ((n.key ?? '') + ' ' + n.text).normalize('NFKC').toLowerCase();
    return words.some(word => {
        if (!/^[a-z0-9_]+$/.test(word))
            return hay.includes(word);
        let at = hay.indexOf(word);
        while (at >= 0) {
            const before = hay[at - 1] ?? '', after = hay[at + word.length] ?? '';
            if (!/[a-z0-9_]/.test(before) && !/[a-z0-9_]/.test(after))
                return true;
            at = hay.indexOf(word, at + 1);
        }
        return false;
    });
}
export function curationReason(n, query, opts) {
    if (n.kind === 'constraint')
        return null;
    const scope = contextReason(n, opts);
    if (scope)
        return scope;
    if (n.kind === 'progress')
        return null; // Current progress is protected, even without query evidence.
    if (n.kind === 'observation' && typeof n.payload.tool === 'string')
        return 'auto_observation';
    if (query.trim())
        return curatedMatch(query, n) ? null : 'query_miss';
    if (n.kind === 'tip' || (n.kind === 'inference' && n.status === 'promoted'))
        return null;
    const scoped = Boolean((opts.task_id && n.task_id === opts.task_id) || (opts.run_id && n.run_id === opts.run_id));
    return scoped ? null : 'not_durable';
}
