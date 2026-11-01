#!/usr/bin/env node
// phase AL 复验轮: 3 个 REJECT 换姿势复审 + 4 个 PASS 强度复验(连打 3 发)
import { writeFileSync } from 'node:fs';
const UA_BROWSER = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const UA = 'search-core/0.5 (search-tool-rnd probe; +https://github.com/mmqz/search-tool-rnd)';
const out = [];

async function hit(label, url, { ua = UA, method = 'GET', body, expect = 'json' } = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method, headers: { 'User-Agent': ua, Accept: expect === 'json' ? 'application/json' : 'text/html', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body, signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    let shape;
    if (expect === 'json') { try { shape = 'JSON ok'; } catch { shape = 'NON-JSON'; } }
    else shape = text.includes('hallenge') || text.includes('Anubis') || text.includes('captcha') ? 'CHALLENGE' : `HTML ${text.length}ch`;
    const ms = Date.now() - t0;
    out.push({ label, status: res.status, ms, shape });
    console.log(`${res.status === 200 && shape !== 'NON-JSON' && shape !== 'CHALLENGE' ? '✅' : '❌'} ${label.padEnd(28)} ${res.status}/${ms}ms/${shape}`);
    return { res, text };
  } catch (e) {
    out.push({ label, status: 0, ms: Date.now() - t0, shape: 'FETCH-FAIL ' + e.message.slice(0, 50) });
    console.log(`❌ ${label.padEnd(28)} FETCH-FAIL ${e.message.slice(0, 60)}`);
    return null;
  }
}

// --- REJECT 复审 ---
await hit('aur browser-UA', 'https://aur.archlinux.org/rpc/?v=5&type=search&arg=linux-kernel', { ua: UA_BROWSER });
await hit('datagov no-rows', 'https://catalog.data.gov/api/3/action/package_search?q=climate');
await hit('flathub query-shape', 'https://flathub.org/api/v2/search', { method: 'POST', body: JSON.stringify({ query: 'editor' }) });

// --- PASS 强度复验(3 连发) ---
for (const [label, url] of [
  ['zenodo x3', 'https://zenodo.org/api/records?q=quantum+error+correction&size=5'],
  ['doaj x3', 'https://doaj.org/api/search/articles/federated%20learning'],
  ['repology x3', 'https://repology.org/api/v1/project/python'],
  ['metacpan x3', 'https://fastapi.metacpan.org/v1/release/_search?q=Plack&size=5'],
]) {
  for (let i = 0; i < 3; i++) await hit(`${label}#${i + 1}`, url);
}
// 形状抽检: zenodo/doaj 首条字段
const z = await (await fetch('https://zenodo.org/api/records?q=transformer&size=3', { headers: { 'User-Agent': UA } })).json();
console.log('zenodo first-hit keys:', Object.keys(z.hits.hits[0] || {}).slice(0, 10).join(','), '| title:', z.hits.hits[0]?.metadata?.title?.slice(0, 60), '| doi:', z.hits.hits[0]?.doi);
const d = await (await fetch('https://doaj.org/api/search/articles/transformer', { headers: { 'User-Agent': UA } })).json();
console.log('doaj first-hit keys:', Object.keys((d.results || [])[0] || {}).slice(0, 10).join(','), '| title:', d.results?.[0]?.bibjson?.title?.slice(0, 60));
const m = await (await fetch('https://fastapi.metacpan.org/v1/release/_search?q=Catalyst&size=3', { headers: { 'User-Agent': UA } })).json();
console.log('metacpan first-hit:', (m.hits.hits || [])[0]?._source?.name, '| abstract?', !!m.hits.hits?.[0]?._source?.abstract);
const r = await (await fetch('https://repology.org/api/v1/project/nodejs', { headers: { 'User-Agent': UA } })).json();
console.log('repology first-entry:', JSON.stringify((r || [])[0])?.slice(0, 120));
import { writeFileSync as wf } from 'node:fs';
wf('/tmp/probe-al/recheck.json', JSON.stringify(out, null, 2));
