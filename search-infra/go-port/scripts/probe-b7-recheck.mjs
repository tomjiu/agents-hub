#!/usr/bin/env node
// 探针第 7 批轮2: 幸存者强度复验 + 黄灯瘦身复验 + 形态修正
// - openlibrary: 去 subject 瘦身 + limit=3 复验
// - archiveorg: 原样复验(判瞬时/持续)
// - pubchem: autocomplete 形态(比 name lookup 更贴近搜索语义)
// - mozilla-addons: page_size 参数修正
// - thespacedevs: 只打 1 次(匿名 15/h 限流)
// - zbmath: results_per_page=3 验延迟
// - usgs: FDSN 无文本搜索 → 补验是否有可用近文本端点(无则关账)
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = '/tmp/probe-b7';
mkdirSync(OUT, { recursive: true });
const UA = 'search-core/0.5 (+https://github.com/mmqz/search-tool-rnd)';

async function hit(name, url, opts = {}) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    const ms = Date.now() - t0;
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    let shape = 'text', j = null;
    if (ct.includes('json')) { try { j = JSON.parse(text); shape = 'json'; } catch { shape = 'json-parse-fail'; } }
    const sample = shape === 'json' ? JSON.stringify(j).slice(0, 900) : text.replace(/\s+/g, ' ').slice(0, 300);
    return { name, url, status: res.status, ms, shape, len: text.length, sample, j };
  } catch (e) {
    return { name, url, status: 0, ms: Date.now() - t0, err: String(e).slice(0, 120) };
  }
}

const enc = encodeURIComponent;
const all = { plans: [] };

async function plan(name, items) {
  console.log(`\n----- ${name} -----`);
  const runs = [];
  for (const it of items) {
    const r = await hit(it.n || name, it.url, it.opts);
    const row = { q: it.q || it.n, status: r.status, ms: r.ms, shape: r.shape, len: r.len, err: r.err };
    runs.push(row);
    console.log(`${String(r.status).padEnd(4)} q="${row.q}" ${r.ms}ms ${r.shape || r.err} ${r.len || 0}B`);
    if (it.inspect && r.j) console.log('   ↳ ' + it.inspect(r.j).slice(0, 220));
    all.plans.push({ plan: name, ...row });
    await new Promise((rs) => setTimeout(rs, it.wait ?? 400));
  }
  return runs;
}

// 1. artifacthub 3 查询
await plan('artifacthub', [
  { q: 'prometheus', url: `https://artifacthub.io/api/v1/packages/search?q=${enc('prometheus')}&limit=5` },
  { q: 'cert-manager', url: `https://artifacthub.io/api/v1/packages/search?q=${enc('cert-manager')}&limit=5` },
  { q: 'redis', url: `https://artifacthub.io/api/v1/packages/search?q=${enc('redis')}&limit=5`,
    inspect: (j) => 'pkgs=' + (j.packages || []).slice(0, 3).map((p) => `${p.name}/${p.kind_name || p.kind || '?'} v${p.version || '?'}`).join(' | ') },
]);

// 2. openlibrary 瘦身复验(去 subject, limit=3)
await plan('openlibrary-slim', [
  { q: 'machine learning', url: `https://openlibrary.org/search.json?q=${enc('machine learning')}&limit=3&fields=key,title,author_name,first_publish_year,edition_count` },
  { q: 'sherlock holmes', url: `https://openlibrary.org/search.json?q=${enc('sherlock holmes')}&limit=3&fields=key,title,author_name,first_publish_year,edition_count` },
  { q: '三体', url: `https://openlibrary.org/search.json?q=${enc('三体')}&limit=3&fields=key,title,author_name,first_publish_year,edition_count` },
]);

// 3. archiveorg 复验
await plan('archiveorg', [
  { q: 'computer chronicles', url: `https://archive.org/advancedsearch.php?q=${enc('computer chronicles')}&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year&fl%5B%5D=mediatype&rows=5&page=1&output=json` },
  { q: 'grateful dead', url: `https://archive.org/advancedsearch.php?q=${enc('grateful dead')}&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year&fl%5B%5D=mediatype&rows=5&page=1&output=json` },
]);

// 4. musicbrainz 3 查询(1.1s 节流)
await plan('musicbrainz', [
  { q: 'yesterday beatles', url: `https://musicbrainz.org/ws/2/recording?query=${enc('yesterday beatles')}&fmt=json&limit=5`, wait: 1200 },
  { q: '月光奏鸣曲', url: `https://musicbrainz.org/ws/2/recording?query=${enc('月光奏鸣曲')}&fmt=json&limit=5`, wait: 1200 },
  { q: 'ROLLING IN THE DEEP', url: `https://musicbrainz.org/ws/2/recording?query=${enc('ROLLING IN THE DEEP')}&fmt=json&limit=5`, wait: 1200 },
]);

// 5. nasaimages 3 查询
await plan('nasaimages', [
  { q: 'hubble deep field', url: `https://images-api.nasa.gov/search?q=${enc('hubble deep field')}&media_type=image&page_size=5` },
  { q: 'mars rover', url: `https://images-api.nasa.gov/search?q=${enc('mars rover')}&media_type=image&page_size=5` },
  { q: 'saturn', url: `https://images-api.nasa.gov/search?q=${enc('saturn')}&media_type=image&page_size=5` },
]);

// 6. pubchem autocomplete 形态
await plan('pubchem-autoc', [
  { q: 'caff', url: `https://pubchem.ncbi.nlm.nih.gov/rest/pug/autocomplete/compound/q/${enc('caff')}/JSON` },
  { q: 'benze', url: `https://pubchem.ncbi.nlm.nih.gov/rest/pug/autocomplete/compound/q/${enc('benze')}/JSON` },
]);

// 7. thespacedevs 只打 1 次
await plan('thespacedevs', [
  { q: 'starship', url: `https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=3&search=${enc('starship')}`, wait: 100 },
]);

// 8. zbmath rpp=3 延迟
await plan('zbmath', [
  { q: 'algebraic geometry', url: `https://api.zbmath.org/v1/document/_search?search_string=${enc('algebraic geometry')}&page=1&results_per_page=3` },
  { q: 'prime number theorem', url: `https://api.zbmath.org/v1/document/_search?search_string=${enc('prime number theorem')}&page=1&results_per_page=3` },
]);

// 9. mozilla-addons page_size 修正
await plan('mozaddons', [
  { q: 'dark mode', url: `https://addons.mozilla.org/api/v5/addons/search/?q=${enc('dark mode')}&page_size=5` },
  { q: 'json viewer', url: `https://addons.mozilla.org/api/v5/addons/search/?q=${enc('json viewer')}&page_size=5`,
    inspect: (j) => 'n=' + (j.results || []).length + ' first=' + ((j.results || [])[0] || {}).name },
]);

// 10. usgs 近文本端点快验
await plan('usgs-check', [
  { n: 'geoserve', url: `https://earthquake.usgs.gov/ws/geoserve/places/json?type=region&minlatitude=30&maxlatitude=32&minlongitude=120&maxlongitude=122` },
]);

writeFileSync(`${OUT}/probe-b7-recheck-${Date.now()}.json`, JSON.stringify(all, null, 2));
console.log(`\n已落 ${OUT}/`);
