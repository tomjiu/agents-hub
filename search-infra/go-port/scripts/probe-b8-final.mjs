#!/usr/bin/env node
// 探针第 8 批定案轮: tvmaze 三审(轮2 间歇失败) + devto search_term 修正 + steam 中文词面探边界
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
      headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) },
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
    return { name, url, status: res.status, ms, ct, shape, len: text.length, data, sample: shape === 'json' ? JSON.stringify(data).slice(0, 600) : text.replace(/\s+/g, ' ').slice(0, 200) };
  } catch (e) {
    return { name, url, status: 0, ms: Date.now() - t0, err: String(e).slice(0, 200) };
  }
}

const enc = encodeURIComponent;
const out = {};

// 1. tvmaze 三审: 6 连发看稳定性(含轮2失败的两词)
console.log('===== tvmaze 三审(6 连发) =====');
out.tvmaze3 = [];
for (const q of ['frieren', '黑镜', 'the office', 'breaking bad', 'succession', 'shogun']) {
  const r = await hit('tvmaze', `https://api.tvmaze.com/search/shows?q=${enc(q)}`);
  out.tvmaze3.push({ q, status: r.status, ms: r.ms, err: r.err, len: r.len });
  console.log(`${String(r.status).padEnd(4)} q="${q}" ${r.ms}ms ${r.err || `${r.len}B`}`);
  await new Promise(rs => setTimeout(rs, 700));
}

// 2. devto forem search_term 修正
console.log('\n===== devto search_term 修正 =====');
out.devto2 = await hit('devto2', `https://dev.to/search/feed_content?per_page=5&class_name=Article&search_fields=title,body_summary&search_term=${enc('postgres index')}`);
const dd = out.devto2.data;
if (dd && Array.isArray(dd.result)) {
  console.log(`devto2: ${out.devto2.status} ${out.devto2.ms}ms ${out.devto2.len}B, ${dd.result.length} 条`);
  for (const a of dd.result.slice(0, 4)) console.log(`   - ${(a.title || '').slice(0, 90)} | path=${a.path || a.url || '?'}`);
} else {
  console.log(`devto2: ${out.devto2.status} ${out.devto2.ms}ms ${out.devto2.err || out.devto2.sample.slice(0, 200)}`);
}
await new Promise(r => setTimeout(r, 600));
// 英文再验一发
out.devto3 = await hit('devto3', `https://dev.to/search/feed_content?per_page=3&class_name=Article&search_fields=title,body_summary&search_term=${enc('rust async runtime')}`);
const d3 = out.devto3.data;
if (d3 && Array.isArray(d3.result)) {
  console.log(`devto3: ${out.devto3.status} ${out.devto3.ms}ms, ${d3.result.length} 条`);
  for (const a of d3.result.slice(0, 3)) console.log(`   - ${(a.title || '').slice(0, 90)}`);
}

// 3. steam 中文词面探边界(cc=CN&l=zh-CN)
console.log('\n===== steam 中文边界 =====');
out.steam_cn = await hit('steam_cn', `https://store.steampowered.com/api/storesearch/?term=${enc('空洞骑士')}&cc=CN&l=zh-CN`);
console.log(`steam_cn: ${out.steam_cn.status} ${out.steam_cn.ms}ms ${out.steam_cn.len}B ${(out.steam_cn.sample || '').slice(0, 200)}`);
await new Promise(r => setTimeout(r, 500));
out.steam_cn2 = await hit('steam_cn2', `https://store.steampowered.com/api/storesearch/?term=${enc('hollow knight')}&cc=CN&l=zh-CN`);
console.log(`steam_cn2(英文词): ${out.steam_cn2.status} ${out.steam_cn2.ms}ms ${out.steam_cn2.len}B ${(out.steam_cn2.sample || '').slice(0, 200)}`);

writeFileSync(`${OUT}/probe-b8-final-${Date.now()}.json`, JSON.stringify(out, null, 2));
console.log('\n已落盘 /tmp/probe-b8/');
