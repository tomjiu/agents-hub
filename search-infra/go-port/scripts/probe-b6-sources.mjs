#!/usr/bin/env node
// 探针第 6 批(Go 侧): 12 候选 — 包生态缺口(nuget/maven/hex/conda) + 发行版(arch/debian)
// + 学术(inspirehep/openaire) + 公版书(gutendex) + 自由媒体(commonswiki) + 社区(reddit) + 天气(open-meteo)
// 两轮: 轮1 形状(状态/延迟/JSON形状/样本字段), 轮2 强度复验(多查询+命中率)
// 原始 JSON 落 /tmp/probe-b6/。用法: node probe-b6-sources.mjs [round1|round2|all]
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = '/tmp/probe-b6';
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
      const j = JSON.parse(text);
      sample = JSON.stringify(j).slice(0, 600);
    } else {
      sample = text.replace(/\s+/g, ' ').slice(0, 300);
    }
    return { name, url, status: res.status, ms, ct, shape, len: text.length, sample };
  } catch (e) {
    return { name, url, status: 0, ms: Date.now() - t0, err: String(e).slice(0, 200) };
  }
}

const enc = encodeURIComponent;

// 候选定义: 每项 { name, domain, round1: {url}, round2: [{q}] }
const CANDIDATES = [
  {
    name: 'nuget', domain: 'packages(.NET)',
    round1: { url: `https://azuresearch-usnc.nuget.org/query?q=${enc('fluentvalidation')}&take=5` },
    round2: ['json serializer', 'serilog', 'grpc client'],
    r2url: (q) => `https://azuresearch-usnc.nuget.org/query?q=${enc(q)}&take=5`,
  },
  {
    name: 'maven', domain: 'packages(Java)',
    round1: { url: `https://search.maven.org/solrsearch/select?q=${enc('jackson databind')}&rows=5&wt=json` },
    round2: ['logback', 'spring core', 'junit'],
    r2url: (q) => `https://search.maven.org/solrsearch/select?q=${enc(q)}&rows=5&wt=json`,
  },
  {
    name: 'hex', domain: 'packages(Elixir)',
    round1: { url: `https://hex.pm/api/packages?search=${enc('ecto')}` },
    round2: ['phoenix', 'jason', 'oban'],
    r2url: (q) => `https://hex.pm/api/packages?search=${enc(q)}`,
  },
  {
    name: 'conda', domain: 'packages(conda)',
    round1: { url: `https://api.anaconda.org/search?name=${enc('numpy')}&type=conda` },
    round2: ['pytorch', 'pandas', 'scipy'],
    r2url: (q) => `https://api.anaconda.org/search?name=${enc(q)}&type=conda`,
  },
  {
    name: 'arch', domain: 'distro(Arch)',
    round1: { url: `https://archlinux.org/packages/search/json/?q=linux` },
    round2: ['ripgrep', 'fish', 'sqlite'],
    r2url: (q) => `https://archlinux.org/packages/search/json/?q=${enc(q)}`,
  },
  {
    name: 'debian', domain: 'distro(Debian)',
    round1: { url: `https://sources.debian.org/api/search/release/${enc('curl')}/` },
    round2: ['vim', 'htop', 'ffmpeg'],
    r2url: (q) => `https://sources.debian.org/api/search/release/${enc(q)}/`,
  },
  {
    name: 'inspirehep', domain: 'academic(physics)',
    round1: { url: `https://inspirehep.net/api/literature?q=${enc('higgs boson')}&size=5` },
    round2: ['dark matter detection', 'lattice qcd', 'neutrino oscillation'],
    r2url: (q) => `https://inspirehep.net/api/literature?q=${enc(q)}&size=5`,
  },
  {
    name: 'openaire', domain: 'academic(EU)',
    round1: { url: `https://api.openaire.eu/search/publications?keywords=${enc('graph neural network')}&size=5&format=json` },
    round2: ['covid vaccine efficacy', 'transformer attention', 'quantum error correction'],
    r2url: (q) => `https://api.openaire.eu/search/publications?keywords=${enc(q)}&size=5&format=json`,
  },
  {
    name: 'gutendex', domain: 'books(公版)',
    round1: { url: `https://gutendex.com/books?search=${enc('sherlock holmes')}` },
    round2: ['pride and prejudice', 'frankenstein', 'moby dick'],
    r2url: (q) => `https://gutendex.com/books?search=${enc(q)}`,
  },
  {
    name: 'commonswiki', domain: 'images(自由媒体)',
    round1: { url: `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${enc('sagrada familia')}&gsrnamespace=6&gsrlimit=5&prop=imageinfo&iiprop=url&iiurlwidth=400&format=json&origin=*` },
    round2: ['mount fuji', 'golden gate bridge', 'aurora borealis'],
    r2url: (q) => `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${enc(q)}&gsrnamespace=6&gsrlimit=5&prop=imageinfo&iiprop=url&iiurlwidth=400&format=json&origin=*`,
  },
  {
    name: 'reddit', domain: 'community(风险预判: 403 率)',
    round1: { url: `https://www.reddit.com/search.json?q=${enc('rust vs go')}&limit=5&sort=relevance` },
    round2: ['best vpn', 'mechanical keyboard', 'nvme overheating'],
    r2url: (q) => `https://www.reddit.com/search.json?q=${enc(q)}&limit=5&sort=relevance`,
  },
  {
    name: 'open-meteo', domain: 'weather(两腿: geocode+forecast)',
    round1: { url: `https://geocoding-api.open-meteo.com/v1/search?name=${enc('Shanghai')}&count=1&language=zh` },
    round2: ['Tokyo', 'Paris', '北京'],
    r2url: (q) => `https://geocoding-api.open-meteo.com/v1/search?name=${enc(q)}&count=1&language=zh`,
    // r2 附加: 用 geocode 结果打 forecast 二腿
    r2follow: async (g) => {
      const j = JSON.parse(g);
      const f = j.results?.[0];
      if (!f) return null;
      return hit('open-meteo:forecast', `https://api.open-meteo.com/v1/forecast?latitude=${f.latitude}&longitude=${f.longitude}&current=temperature_2m,weather_code&timezone=auto`);
    },
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
    console.log(`${(r.err ? 'ERR ' : String(r.status).padEnd(4))} ${r.name.padEnd(12)} ${r.ms}ms ${r.shape || '-'} ${r.err || `${r.len}B  ${r.sample.slice(0, 160)}`}`);
  }
}

if (round === 'round2' || round === 'all') {
  console.log('\n===== 轮2: 强度复验(3 查询/候选 + open-meteo 二腿) =====');
  all.round2 = {};
  for (const c of CANDIDATES) {
    const runs = [];
    for (const q of c.round2) {
      const r = await hit(c.name, c.r2url(q), c.round1.opts || {});
      runs.push({ q, ...r, sample: undefined });
      console.log(`${(r.err ? 'ERR ' : String(r.status).padEnd(4))} ${c.name.padEnd(12)} q="${q}" ${r.ms}ms ${r.shape || r.err || ''}`);
      if (c.r2follow && r.shape === 'json' && r.status === 200) {
        const f = await c.r2follow(requireText(r));
        if (f) { runs.push({ q: q + ' →forecast', ...f, sample: f.sample.slice(0, 200) }); console.log(`      ↳ forecast ${f.status} ${f.ms}ms ${f.sample.slice(0, 120)}`); }
      }
    }
    all.round2[c.name] = runs;
    await new Promise((r) => setTimeout(r, 400)); // 探针节流
  }
}

function requireText(r) { return r.sample; } // round1 的 sample 是原始 JSON 前 600B, 足够 geocode 解析(含 results[0])

writeFileSync(`${OUT}/probe-b6-${round === 'all' ? 'full' : round}-${Date.now()}.json`, JSON.stringify(all, null, 2));
console.log(`\n原始数据已落 ${OUT}/`);
