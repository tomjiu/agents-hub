#!/usr/bin/env node
// 探针第 6 批轮3: 存疑案定案 — maven 超时率 / conda 时延分布 / debian 套件路径修正
// / inspirehep fields 参数瘦身 / open-meteo 复验(含 forecast 二腿)
// 用法: node probe-b6-recheck.mjs [maven|conda|debian|inspirehep|openmeteo|all]
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = '/tmp/probe-b6';
mkdirSync(OUT, { recursive: true });
const UA = 'search-core/0.5 (+https://github.com/mmqz/search-tool-rnd)';
const enc = encodeURIComponent;

async function hit(label, url, timeoutMs = 10000) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal });
    clearTimeout(timer);
    const text = await res.text();
    let shape = 'text';
    try { JSON.parse(text); shape = 'json'; } catch {}
    return { label, status: res.status, ms: Date.now() - t0, shape, len: text.length, text };
  } catch (e) { return { label, status: 0, ms: Date.now() - t0, err: String(e).slice(0, 120) }; }
}
const sleep = (m) => new Promise((r) => setTimeout(r, m));
const out = {};
const SECT = process.argv[2] || 'all';
const want = (s) => SECT === 'all' || SECT === s;

// 1) maven 连发 5 次定超时率
if (want('maven')) {
  out.maven = [];
  for (const q of ['spring core', 'junit', 'guava', 'okhttp', 'log4j']) {
    const r = await hit('maven:' + q, `https://search.maven.org/solrsearch/select?q=${enc(q)}&rows=5&wt=json`);
    out.maven.push({ q, status: r.status, ms: r.ms, err: r.err, len: r.len });
    console.log(`maven q="${q}" ${r.status} ${r.ms}ms ${r.err || (r.len || 0) + 'B'}`);
    await sleep(500);
  }
}

// 2) conda 时延分布(10s 上限放宽观察)
if (want('conda')) {
  out.conda = [];
  for (const q of ['scipy', 'requests']) {
    const r = await hit('conda:' + q, `https://api.anaconda.org/search?name=${enc(q)}&type=conda`, 10000);
    out.conda.push({ q, status: r.status, ms: r.ms, err: r.err, len: r.len });
    console.log(`conda q="${q}" ${r.status} ${r.ms}ms ${r.err || (r.len || 0) + 'B'}`);
    await sleep(500);
  }
}

// 3) debian 修正: {suite}/{query} 路径
if (want('debian')) {
  out.debian = [];
  for (const [suite, q] of [['bookworm', 'curl'], ['sid', 'vim'], ['trixie', 'htop']]) {
    const r = await hit(`debian:${suite}:${q}`, `https://sources.debian.org/api/search/${suite}/${enc(q)}/`);
    out.debian.push({ suite, q, status: r.status, ms: r.ms, len: r.len, sample: (r.text || '').slice(0, 200) });
    console.log(`debian suite=${suite} q="${q}" ${r.status} ${r.ms}ms ${(r.len || 0) + 'B'}`);
    await sleep(400);
  }
}

// 4) inspirehep fields 参数瘦身复验
if (want('inspirehep')) {
  out.inspirehep = [];
  const F = 'fields=titles,abstracts,authors,arxiv_eprints,dois,publication_info,citation_count';
  for (const q of ['higgs boson', 'neutrino oscillation']) {
    const r = await hit('inspirehep:fields', `https://inspirehep.net/api/literature?q=${enc(q)}&size=5&${F}`);
    out.inspirehep.push({ q, status: r.status, ms: r.ms, len: r.len });
    console.log(`inspirehep+fields q="${q}" ${r.status} ${r.ms}ms ${(r.len || 0) + 'B'}`);
    await sleep(400);
  }
}

// 5) open-meteo 复验: geocode×3 带间隔 + forecast 二腿
if (want('openmeteo')) {
  out.openmeteo = [];
  for (const q of ['Tokyo', 'Paris', '北京']) {
    const g = await hit('geocode', `https://geocoding-api.open-meteo.com/v1/search?name=${enc(q)}&count=1&language=zh`);
    let line = `open-meteo geocode q="${q}" ${g.status} ${g.ms}ms`;
    const rec = { q, geocode: { status: g.status, ms: g.ms, len: g.len, err: g.err } };
    if (g.status === 200 && g.shape === 'json') {
      const full = JSON.parse(g.text);
      const f = full.results?.[0];
      if (f) {
        const fc = await hit('forecast', `https://api.open-meteo.com/v1/forecast?latitude=${f.latitude}&longitude=${f.longitude}&current=temperature_2m,weather_code&timezone=auto`);
        rec.forecast = { status: fc.status, ms: fc.ms, sample: (fc.text || '').slice(0, 300), err: fc.err };
        line += ` → forecast ${fc.status} ${fc.ms}ms`;
      }
    }
    out.openmeteo.push(rec);
    console.log(line);
    await sleep(1500);
  }
}

writeFileSync(`${OUT}/probe-b6-recheck-${Date.now()}.json`, JSON.stringify(out, null, 2));
console.log('\n轮3 数据已落 ' + OUT);
