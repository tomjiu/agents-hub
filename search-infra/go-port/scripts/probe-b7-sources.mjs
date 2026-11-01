#!/usr/bin/env node
// 探针第 7 批(Go 侧): 12 候选 + 1 快验(biorxiv)
// 缺口: devops(helm chart) + books + music + archive + 地震 + NASA 图像 + 化学
//       + 学术(fatcat 生死/zbmath) + 航天发射(限流评估) + 数列(OEIS 守卫评估) + 浏览器扩展
// 两轮: 轮1 形状(状态/延迟/JSON形状/样本字段), 轮2 强度复验(多查询+命中率)
// 原始 JSON 落 /tmp/probe-b7/。用法: node probe-b7-sources.mjs [round1|round2|all]
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = '/tmp/probe-b7';
mkdirSync(OUT, { recursive: true });
const UA = 'search-core/0.5 (+https://github.com/mmqz/search-tool-rnd)';

async function hit(name, url, opts = {}) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: opts.accept || 'application/json', ...(opts.headers || {}) },
      method: opts.method || 'GET',
      body: opts.body,
      signal: ctrl.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    const ms = Date.now() - t0;
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    let shape = 'text';
    if (ct.includes('json')) {
      try { JSON.parse(text); shape = 'json'; } catch { shape = 'json-parse-fail'; }
    } else if (ct.includes('xml')) shape = 'xml';
    let sample = '';
    if (shape === 'json') {
      sample = JSON.stringify(JSON.parse(text)).slice(0, 900);
    } else {
      sample = text.replace(/\s+/g, ' ').slice(0, 300);
    }
    return { name, url, status: res.status, ms, ct, shape, len: text.length, sample };
  } catch (e) {
    return { name, url, status: 0, ms: Date.now() - t0, err: String(e).slice(0, 200) };
  }
}

const enc = encodeURIComponent;

const CANDIDATES = [
  {
    name: 'artifacthub', domain: 'devops(helm/opa/kube)',
    round1: { url: `https://artifacthub.io/api/v1/packages/search?q=${enc('nginx ingress')}&limit=5` },
    round2: ['prometheus', 'cert-manager', 'redis'],
    r2url: (q) => `https://artifacthub.io/api/v1/packages/search?q=${enc(q)}&limit=5`,
  },
  {
    name: 'openlibrary', domain: 'books',
    round1: { url: `https://openlibrary.org/search.json?q=${enc('sherlock holmes')}&limit=5&fields=key,title,author_name,first_publish_year,edition_count,subject` },
    round2: ['machine learning', 'crisis of the european sciences', '三体'],
    r2url: (q) => `https://openlibrary.org/search.json?q=${enc(q)}&limit=5&fields=key,title,author_name,first_publish_year,edition_count,subject`,
  },
  {
    name: 'musicbrainz', domain: 'music(1req/s 限速)',
    round1: { url: `https://musicbrainz.org/ws/2/recording?query=${enc('bohemian rhapsody')}&fmt=json&limit=5` },
    round2: ['yesterday beatles', '月光奏鸣曲', 'ROLLING IN THE DEEP'],
    r2url: (q) => `https://musicbrainz.org/ws/2/recording?query=${enc(q)}&fmt=json&limit=5`,
    throttle: 1100,
  },
  {
    name: 'archiveorg', domain: 'archive(多媒体全文)',
    round1: { url: `https://archive.org/advancedsearch.php?q=${enc('night of the living dead')}&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=description&fl%5B%5D=year&fl%5B%5D=mediatype&rows=5&page=1&output=json` },
    round2: ['computer chronicles', ' Mechanic set ', 'grateful dead'],
    r2url: (q) => `https://archive.org/advancedsearch.php?q=${enc(q)}&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=description&fl%5B%5D=year&fl%5B%5D=mediatype&rows=5&page=1&output=json`,
  },
  {
    name: 'usgs-quakes', domain: 'science(地震, 评估查询适配)',
    round1: { url: `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&limit=5&orderby=time&minmagnitude=6` },
    round2: [], // 无文本搜索语义, 轮1 形状决定去留
    r2url: () => null,
  },
  {
    name: 'nasaimages', domain: 'images(NASA)',
    round1: { url: `https://images-api.nasa.gov/search?q=${enc('apollo 11')}&media_type=image&page_size=5` },
    round2: ['hubble deep field', 'mars rover', 'saturn'],
    r2url: (q) => `https://images-api.nasa.gov/search?q=${enc(q)}&media_type=image&page_size=5`,
  },
  {
    name: 'pubchem', domain: 'chem(化合物)',
    round1: { url: `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${enc('aspirin')}/synonyms/JSON` },
    round2: ['caffeine', 'glucose', 'water'],
    r2url: (q) => `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${enc(q)}/synonyms/JSON`,
  },
  {
    name: 'fatcat', domain: 'academic(scholar.archive.org, 生死快验)',
    round1: { url: `https://api.fatcat.wiki/v0/release/search?q=${enc('transformer attention')}&limit=5` },
    round2: ['protein folding'],
    r2url: (q) => `https://api.fatcat.wiki/v0/release/search?q=${enc(q)}&limit=5`,
  },
  {
    name: 'thespacedevs', domain: 'space(发射, 匿名限流 15/h 评估)',
    round1: { url: `https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=5&search=${enc('falcon 9')}` },
    round2: [], // 限流紧张, 轮2 少打
    r2url: () => null,
  },
  {
    name: 'oeis', domain: 'math(数列, 守卫评估)',
    round1: { url: `https://oeis.org/search?q=${enc('1,1,2,3,5,8')}&fmt=json` },
    round2: [], // 数列语义特殊, 轮1 形状决定守卫化
    r2url: () => null,
  },
  {
    name: 'zbmath', domain: 'math(开放文献)',
    round1: { url: `https://api.zbmath.org/v1/document/_search?search_string=${enc('riemann hypothesis')}&page=1&results_per_page=5` },
    round2: ['algebraic geometry', 'prime number theorem', 'soft sheaves'],
    r2url: (q) => `https://api.zbmath.org/v1/document/_search?search_string=${enc(q)}&page=1&results_per_page=5`,
  },
  {
    name: 'mozilla-addons', domain: 'browser-ext(Firefox)',
    round1: { url: `https://addons.mozilla.org/api/v5/addons/search/?q=${enc('adblock')}&limit=5` },
    round2: ['dark mode', 'password manager', 'json viewer'],
    r2url: (q) => `https://addons.mozilla.org/api/v5/addons/search/?q=${enc(q)}&limit=5`,
  },
  {
    name: 'biorxiv', domain: 'academic(预印本, 预判: 不支持关键词搜索→快验关账)',
    round1: { url: `https://api.biorxiv.org/details/biorxiv/2024-01-01/2024-01-02/5` },
    round2: [],
    r2url: () => null,
  },
];

const round = process.argv[2] || 'all';
const all = {};

if (round === 'round1' || round === 'all') {
  console.log('===== 轮1: 形状(单查询) =====');
  all.round1 = [];
  for (const c of CANDIDATES) {
    const r = await hit(c.name, c.round1.url, c.round1.opts || {});
    all.round1.push(r);
    console.log(`${(r.err ? 'ERR ' : String(r.status).padEnd(4))} ${r.name.padEnd(15)} ${r.ms}ms ${r.shape || '-'} ${r.err || `${r.len}B  ${r.sample.slice(0, 170)}`}`);
    if (c.throttle) await new Promise((rs) => setTimeout(rs, c.throttle));
  }
}

if (round === 'round2' || round === 'all') {
  console.log('\n===== 轮2: 强度复验(幸存者 3 查询/候选) =====');
  all.round2 = {};
  for (const c of CANDIDATES) {
    if (!c.round2.length) { console.log(`SKIP ${c.name} (无轮2)`) ; continue; }
    const runs = [];
    for (const q of c.round2) {
      const u = c.r2url(q);
      if (!u) continue;
      const r = await hit(c.name, u, c.round1.opts || {});
      runs.push({ q, status: r.status, ms: r.ms, shape: r.shape, len: r.len, err: r.err });
      console.log(`${(r.err ? 'ERR ' : String(r.status).padEnd(4))} ${c.name.padEnd(15)} q="${q}" ${r.ms}ms ${r.shape || r.err || ''} ${r.len || 0}B`);
      if (c.throttle) await new Promise((rs) => setTimeout(rs, c.throttle));
    }
    all.round2[c.name] = runs;
    await new Promise((r) => setTimeout(r, 400)); // 探针节流
  }
}

writeFileSync(`${OUT}/probe-b7-${round === 'all' ? 'full' : round}-${Date.now()}.json`, JSON.stringify(all, null, 2));
console.log(`\n原始数据已落 ${OUT}/`);
