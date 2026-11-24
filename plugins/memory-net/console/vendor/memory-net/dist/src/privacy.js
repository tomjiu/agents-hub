export const DEFAULT_REDACTION_RULES = {
    fields: [
        'password', 'passwd', 'secret', 'token', 'api_key', 'apikey', 'api-key',
        'authorization', 'auth', 'credential', 'private_key', 'client_secret',
        'access_key', 'session_token', 'cookie',
    ],
    patterns: [
        // AWS Access Key 形态
        { re: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[REDACTED:aws-key]' },
        // AWS Secret / base64 密钥长串 (40+)
        { re: /\b[A-Za-z0-9/+=]{40,}\b/g, replacement: '[REDACTED:long-secret]' },
        // Bearer token
        { re: /\bBearer\s+[A-Za-z0-9._-]{16,}/gi, replacement: 'Bearer [REDACTED]' },
        // 常见 sk- 前缀 API key
        { re: /\bsk-[A-Za-z0-9]{16,}\b/g, replacement: '[REDACTED:sk-key]' },
        // ghp_/gho_ GitHub token
        { re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replacement: '[REDACTED:gh-token]' },
    ],
};
function fieldMatches(name, fields) {
    const lower = name.toLowerCase();
    return fields.some((f) => lower.includes(f));
}
function redactText(text, patterns) {
    let out = text;
    let masked = 0;
    for (const { re, replacement } of patterns) {
        const before = out;
        out = out.replace(re, replacement);
        if (before !== out)
            masked++;
    }
    return { text: out, masked };
}
/** 单节点脱敏副本（不改原件）。返回掩码命中数（字段级 + 文本级）。 */
export function redactNode(n, rules = DEFAULT_REDACTION_RULES) {
    const maskedFields = [];
    const payload = { ...n.payload };
    for (const key of Object.keys(payload)) {
        if (!fieldMatches(key, rules.fields))
            continue;
        const v = payload[key];
        if (typeof v === 'string') {
            const { text, masked } = redactText(v, rules.patterns);
            payload[key] = masked > 0 ? text : '[REDACTED]';
        }
        else {
            payload[key] = '[REDACTED]';
        }
        maskedFields.push(key);
    }
    const { text, masked } = redactText(n.text, rules.patterns);
    const node = maskedFields.length > 0 || masked > 0
        ? { ...n, payload, text }
        : n;
    return { node, masked: maskedFields.length + masked };
}
