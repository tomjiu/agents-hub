#!/usr/bin/env node
// 探针第 8 批(Go 侧): 12 候选 — 消费内容(books/tv/podcast/games/anime) + 生命科学(species/drug/food)
//                          + legal(法规/判例) + 开发者内容(devblog/tech-news)
// 背景: 17 域外全空白面 — books(openlibrary 关账后无库)/tv/podcast/games/anime/food/legal 零覆盖
// 两轮: 轮1 形状(状态/延迟/JSON形状/样本字段), 轮2 强度复验(多查询+命中率)
// 原始 JSON 落 /tmp/probe-b8/。用法: node probe-b8-sources.mjs [round1|round2|all]
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
    name: 'gbooks', domain: 'books(Google Books, openlibrary 关账后补位)',
    round1: { url: `https://www.googleapis.com/books/v1/volumes?q=${enc('machine learning')}&maxResults=5` },
    round2: ['sherlock holmes', '三体', 'crisis of the european sciences'],
    r2url: (q) => `https://www.googleapis.com/books/v1/volumes?q=${enc(q)}&maxResults=5`,
  },
  {
    name: 'tvmaze', domain: 'tv(剧集, 官方自称无限流)',
    round1: { url: `https://api.tvmaze.com/search/shows?q=${enc('breaking bad')}` },
    round2: ['frieren', '黑镜', 'the office'],
    r2url: (q) => `https://api.tvmaze.com/search/shows?q=${enc(q)}`,
  },
  {
    name: 'itunes', domain: 'podcast(Apple 官方, ~20 req/min 节流)',
    round1: { url: `https://itunes.apple.com/search?term=${enc('syntax fm')}&media=podcast&limit=5` },
    round2: ['huberman lab', '硅谷101', 'the daily'],
    r2url: (q) => `https://itunes.apple.com/search?term=${enc(q)}&media=podcast&limit=5`,
    throttle: 3300,
  },
  {
    name: 'steam', domain: 'games(Valve 官方 storesearch)',
    round1: { url: `https://store.steampowered.com/api/storesearch/?term=${enc('portal')}&cc=US&l=en` },
    round2: ['elden ring', '空洞骑士', 'factorio'],
    r2url: (q) => `https://store.steampowered.com/api/storesearch/?term=${enc(q)}&cc=US&l=en`,
  },
  {
    name: 'jikan', domain: 'anime(MyAnimeList 非官方, 3req/s 60/min)',
    round1: { url: `https://api.jikan.moe/v4/anime?q=${enc('frieren')}&limit=5` },
    round2: ['steins gate', '进击的巨人', 'cowboy bebop'],
    r2url: (q) => `https://api.jikan.moe/v4/anime?q=${enc(q)}&limit=5`,
    throttle: 1200,
  },
  {
    name: 'gbif', domain: 'species(全球生物多样性 GBIF)',
    round1: { url: `https://api.gbif.org/v1/species/search?q=${enc('quercus')}&rank=SPECIES&status=ACCEPTED&limit=5` },
    round2: ['ginkgo biloba', '大熊猫', 'apis mellifera'],
    r2url: (q) => `https://api.gbif.org/v1/species/search?q=${enc(q)}&rank=SPECIES&status=ACCEPTED&limit=5`,
  },
  {
    name: 'openfda', domain: 'drug(openFDA 药品标签, 240/min 匿名)',
    round1: { url: `https://api.fda.gov/drug/labels.json?search=${enc('aspirin')}&limit=3` },
    round2: ['ibuprofen', 'metformin', 'penicillin'],
    r2url: (q) => `https://api.fda.gov/drug/labels.json?search=${enc(q)}&limit=3`,
  },
  {
    name: 'federalregister', domain: 'legal(美国联邦公报法规)',
    round1: {
      url: `https://www.federalregister.gov/api/v1/documents.json?conditions%5Bterm%5D=${enc('artificial intelligence')}&per_page=5&fields%5B%5D=title&fields%5B%5D=html_url&fields%5B%5D=abstract&fields%5B%5D=publication_date&fields%5B%5D=agencies`,
    },
    round2: ['data privacy', 'export control', 'clean air'],
    r2url: (q) => `https://www.federalregister.gov/api/v1/documents.json?conditions%5Bterm%5D=${enc(q)}&per_page=5&fields%5B%5D=title&fields%5B%5D=html_url&fields%5B%5D=abstract&fields%5B%5D=publication_date&fields%5B%5D=agencies`,
  },
  {
    name: 'courtlistener', domain: 'legal(判例, v4 匿名配额评估)',
    round1: { url: `https://www.courtlistener.com/api/rest/v4/search/?q=${enc('miranda')}&type=o&limit=5` },
    round2: [],
    r2url: () => null, // 轮1 看匿名可用性再定
  },
  {
    name: 'openfoodfacts', domain: 'food(Open Food Facts, 官方自嘲慢 timeout 12s)',
    round1: {
      url: `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${enc('nutella')}&json=1&page_size=5`,
      timeout: 12000,
    },
    round2: ['coca cola', 'oreo'],
    r2url: (q) => `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${enc(q)}&json=1&page_size=5`,
    throttle: 1200,
  },
  {
    name: 'devto', domain: 'devblog(dev.to 文章, q 参数可用性评估)',
    round1: { url: `https://dev.to/api/articles?per_page=5&q=${enc('rust async')}` },
    round2: ['go generics', 'react hooks', 'postgres index'],
    r2url: (q) => `https://dev.to/api/articles?per_page=5&q=${enc(q)}`,
  },
  {
    name: 'lobsters', domain: 'tech-news(lobste.rs, hn 同域增补, CF 评估)',
    round1: { url: `https://lobste.rs/search.json?q=${enc('rust')}&what=stories&order=newest` },
    round2: ['go', 'sqlite', 'postgresql'],
    r2url: (q) => `https://lobste.rs/search.json?q=${enc(q)}&what=stories&order=newest`,
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
    console.log(`${(r.err ? 'ERR ' : String(r.status).padEnd(4))} ${r.name.padEnd(16)} ${r.ms}ms ${r.shape || '-'} ${r.err || `${r.len}B  ${r.sample.slice(0, 170)}`}`);
    if (c.throttle) await new Promise((rs) => setTimeout(rs, c.throttle));
  }
}

if (round === 'round2' || round === 'all') {
  console.log('\n===== 轮2: 强度复验(幸存者 3 查询/候选) =====');
  all.round2 = {};
  for (const c of CANDIDATES) {
    if (!c.round2.length) { console.log(`SKIP ${c.name} (无轮2)`); continue; }
    const runs = [];
    for (const q of c.round2) {
      const u = c.r2url(q);
      if (!u) continue;
      const r = await hit(c.name, u, c.round1.opts || {});
      runs.push({ q, status: r.status, ms: r.ms, shape: r.shape, len: r.len, err: r.err });
      console.log(`${(r.err ? 'ERR ' : String(r.status).padEnd(4))} ${c.name.padEnd(16)} q="${q}" ${r.ms}ms ${r.shape || r.err || ''} ${r.len || 0}B`);
      if (c.throttle) await new Promise((rs) => setTimeout(rs, c.throttle));
    }
    all.round2[c.name] = runs;
    await new Promise((r) => setTimeout(r, 400)); // 探针节流
  }
}

writeFileSync(`${OUT}/probe-b8-${round === 'all' ? 'full' : round}-${Date.now()}.json`, JSON.stringify(all, null, 2));
console.log(`\n原始数据已落 ${OUT}/`);
