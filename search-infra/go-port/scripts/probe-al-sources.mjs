#!/usr/bin/env node
// phase AL 探针第 5 批: 12 个 keyless 候选源(Go 侧首发, TS 侧均未接)
// 纪律: 原始输出落 /tmp/probe-al/, 只抄结论; 2 发复验; UA 统一 search-core/0.5
import { writeFileSync, mkdirSync } from 'node:fs';
const UA = 'search-core/0.5 (search-tool-rnd probe; +https://github.com/mmqz/search-tool-rnd)';
const OUT = '/tmp/probe-al';
mkdirSync(OUT, { recursive: true });

const candidates = [
  { id: 'aur',        url: 'https://aur.archlinux.org/rpc/?v=5&type=search&arg=linux-kernel', pick: j => j.resultcount ?? null },
  { id: 'homebrew',   url: 'https://formulae.brew.sh/api/search?q=wget',                      pick: j => Array.isArray(j?.formulae) ? j.formulae.length : null },
  { id: 'ietf-rfc',   url: 'https://datatracker.ietf.org/api/v1/doc/search/?q=tls+handshake&limit=5', pick: j => j?.objects?.length ?? j?.meta?.total_count ?? null },
  { id: 'datagov',    url: 'https://catalog.data.gov/api/3/action/package_search?q=climate&rows=5', pick: j => j?.result?.count ?? null },
  { id: 'zenodo',     url: 'https://zenodo.org/api/records?q=open+science&size=5',            pick: j => j?.hits?.total ?? null },
  { id: 'doaj',       url: 'https://doaj.org/api/search/articles/machine%20learning',         pick: j => j?.total ?? null },
  { id: 'repology',   url: 'https://repology.org/api/v1/project/wget',                        pick: j => Array.isArray(j) ? j.length : null },
  { id: 'ctan',       url: 'https://ctan.org/json/2.0/search?q=latex',                        pick: j => j?.hit_count ?? null },
  { id: 'metacpan',   url: 'https://fastapi.metacpan.org/v1/release/_search?q=Moose&size=5',  pick: j => j?.hits?.total?.value ?? j?.hits?.total ?? null },
  { id: 'flathub',    url: 'https://flathub.org/api/v2/search', method: 'POST', body: JSON.stringify({ search: 'editor' }), pick: j => Array.isArray(j) ? j.length : null },
  { id: 'pkggo',      url: 'https://pkg.go.dev/search?q=http+client&m=package', html: true,   pick: () => 'HTML' },
  { id: 'lobsters',   url: 'https://lobste.rs/search.json?q=rust&what=stories&order=newest',  pick: j => Array.isArray(j) ? j.length : null },
];

const results = [];
for (const c of candidates) {
  const runs = [];
  for (let i = 0; i < 2; i++) {
    const t0 = Date.now();
    try {
      const ctl = AbortSignal.timeout(15000);
      const res = await fetch(c.url, {
        method: c.method || 'GET',
        headers: { 'User-Agent': UA, Accept: c.html ? 'text/html' : 'application/json', ...(c.body ? { 'Content-Type': 'application/json' } : {}) },
        body: c.body, signal: ctl, redirect: 'follow',
      });
      const ms = Date.now() - t0;
      const text = await res.text();
      let shape = null, sample = '';
      if (!c.html) {
        try { const j = JSON.parse(text); shape = c.pick(j); sample = JSON.stringify(j).slice(0, 180); }
        catch { shape = 'NON-JSON'; sample = text.slice(0, 120); }
      } else {
        shape = text.includes('challenge') || text.includes('captcha') ? 'CHALLENGE' : `HTML ${text.length}ch`;
        sample = text.replace(/\s+/g, ' ').slice(0, 140);
      }
      runs.push({ ms, status: res.status, shape, sample });
      break; // 第 1 发成功即不重打(形状判定足够; 存活性复验只对失败做)
    } catch (e) {
      runs.push({ ms: Date.now() - t0, status: 0, shape: 'FETCH-FAIL: ' + e.message.slice(0, 60), sample: '' });
    }
  }
  const ok = runs[0].status === 200 && runs[0].shape !== 'NON-JSON' && runs[0].shape !== 'CHALLENGE' && !String(runs[0].shape).startsWith('HTML');
  results.push({ id: c.id, verdict: ok ? 'PASS' : 'REJECT', runs });
  console.log(`${ok ? '✅' : '❌'} ${c.id.padEnd(10)} ${runs.map(r => `${r.status}/${r.ms}ms/${r.shape}`).join(' | ')}`);
  console.log(`   sample: ${runs[0].sample.slice(0, 150)}`);
}
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(`\nsaved -> ${OUT}/results.json`);
