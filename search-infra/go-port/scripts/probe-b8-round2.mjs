#!/usr/bin/env node
// 探针第 8 批轮 2: 7 幸存者强度复验(3 查询/候选) + devto forem 内部搜索快验 + courtlistener 单条结构
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = '/tmp/probe-b8';
mkdirSync(OUT, { recursive: true });
const UA = 'search-core/0.5 (+https://github.com/mmqz/search-tool-rnd)';

async function hit(name, url, opts = {}) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 10000);
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: opts.accept || 'application/json', ...(opts.headers || {}) },
      signal: ctrl.signal, redirect: 'follow',
    });
    clearTimeout(timer);
    const ms = Date.now() - t0;
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    let shape = 'text', data = null;
    if (ct.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
      try { data = JSON.parse(text); shape = 'json'; } catch { shape = 'json-parse-fail'; }
    }
    return { name, url, status: res.status, ms, ct, shape, len: text.length, data, sample: shape === 'json' ? JSON.stringify(data).slice(0, 1000) : text.replace(/\s+/g, ' ').slice(0, 200) };
  } catch (e) {
    return { name, url, status: 0, ms: Date.now() - t0, err: String(e).slice(0, 200) };
  }
}

const enc = encodeURIComponent;
const out = {};

// ===== devto forem 内部搜索快验 =====
out.devto_forem = await hit('devto_forem', `https://dev.to/search/feed_content?per_page=5&class_name=Article&search_fields=${enc('postgres index')}`);
const df = out.devto_forem.data;
if (df && Array.isArray(df.result)) {
  console.log(`devto_forem: ${out.devto_forem.status} ${out.devto_forem.ms}ms ${out.devto_forem.len}B 相关性样本:`);
  for (const a of df.result.slice(0, 3)) console.log(`   - ${(a.title || '').slice(0, 90)}`);
} else {
  console.log(`devto_forem: ${out.devto_forem.status} ${out.devto_forem.ms}ms ${out.devto_forem.err || out.devto_forem.sample.slice(0, 150)}`);
}
await new Promise(r => setTimeout(r, 600));

// ===== courtlistener 单条结构 =====
const cl = await hit('cl_struct', `https://www.courtlistener.com/api/rest/v4/search/?q=${enc('fourth amendment search')}&type=o&limit=2`);
if (cl.data?.results?.[0]) {
  const r0 = cl.data.results[0];
  console.log(`courtlistener 单条字段: ${Object.keys(r0).join(',').slice(0, 400)}`);
  console.log(`  caseName=${r0.caseName} | court=${r0.court} | absolute_url=${r0.absolute_url} | dateFiled=${r0.dateFiled}`);
  out.cl_keys = Object.keys(r0);
}
await new Promise(r => setTimeout(r, 800));

// ===== 7 幸存者强度复验 =====
const SURVIVORS = [
  {
    name: 'tvmaze',
    queries: ['frieren', '黑镜', 'the office'],
    url: (q) => `https://api.tvmaze.com/search/shows?q=${enc(q)}`,
  },
  {
    name: 'itunes',
    queries: ['huberman lab', '硅谷101', 'the daily'],
    url: (q) => `https://itunes.apple.com/search?term=${enc(q)}&media=podcast&limit=5`,
    throttle: 3300,
  },
  {
    name: 'steam',
    queries: ['elden ring', '空洞骑士', 'factorio'],
    url: (q) => `https://store.steampowered.com/api/storesearch/?term=${enc(q)}&cc=US&l=en`,
  },
  {
    name: 'gbif',
    queries: ['ginkgo biloba', '大熊猫', 'apis mellifera'],
    url: (q) => `https://api.gbif.org/v1/species/search?q=${enc(q)}&rank=SPECIES&status=ACCEPTED&limit=5`,
  },
  {
    name: 'openfda',
    queries: ['ibuprofen', 'metformin', 'penicillin'],
    url: (q) => `https://api.fda.gov/drug/label.json?search=${enc(q)}&limit=3`,
    throttle: 600,
  },
  {
    name: 'federalregister',
    queries: ['data privacy', 'export control', 'clean air'],
    url: (q) => `https://www.federalregister.gov/api/v1/documents.json?conditions%5Bterm%5D=${enc(q)}&per_page=5&fields%5B%5D=title&fields%5B%5D=html_url&fields%5B%5D=abstract&fields%5B%5D=publication_date&fields%5B%5D=agencies`,
  },
  {
    name: 'courtlistener',
    queries: ['fair use copyright', 'qualified immunity', 'antitrust merger'],
    url: (q) => `https://www.courtlistener.com/api/rest/v4/search/?q=${enc(q)}&type=o&limit=5`,
    throttle: 900,
  },
];

console.log('\n===== 轮2: 强度复验 =====');
out.round2 = {};
for (const c of SURVIVORS) {
  const runs = [];
  for (const q of c.queries) {
    const r = await hit(c.name, c.url(q));
    // 相关性粗判: JSON 里出现查询词的比例
    let relevance = 'n/a';
    if (r.data) {
      const blob = JSON.stringify(r.data).toLowerCase();
      const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const hits = words.filter(w => blob.includes(w)).length;
      relevance = `${hits}/${words.length}`;
    }
    runs.push({ q, status: r.status, ms: r.ms, shape: r.shape, len: r.len, err: r.err, relevance });
    console.log(`${String(r.status).padEnd(4)} ${c.name.padEnd(16)} q="${q}" ${r.ms}ms ${r.shape || r.err || ''} ${r.len || 0}B 相关词命中=${relevance}`);
    if (c.throttle) await new Promise(rs => setTimeout(rs, c.throttle));
  }
  out.round2[c.name] = runs;
  await new Promise(r => setTimeout(r, 500));
}

writeFileSync(`${OUT}/probe-b8-round2-${Date.now()}.json`, JSON.stringify(out, null, 2));
console.log('\n已落盘 /tmp/probe-b8/');
