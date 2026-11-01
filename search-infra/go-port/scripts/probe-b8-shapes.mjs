#!/usr/bin/env node
// 探针第 8 批形状抓取: 7 接入源各一响应落 /tmp/probe-b8/shapes/, 作黄金样本 fixture 母本
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = '/tmp/probe-b8/shapes';
mkdirSync(OUT, { recursive: true });
const UA = 'search-core/0.5 (+https://github.com/mmqz/search-tool-rnd)';

async function grab(name, url) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(timer);
    const text = await res.text();
    writeFileSync(`${OUT}/${name}.json`, text);
    console.log(`${String(res.status).padEnd(4)} ${name.padEnd(16)} ${Date.now() - t0}ms ${text.length}B -> ${OUT}/${name}.json`);
  } catch (e) {
    console.log(`ERR  ${name.padEnd(16)} ${Date.now() - t0}ms ${String(e).slice(0, 120)}`);
  }
}

const enc = encodeURIComponent;
await grab('tvmaze', `https://api.tvmaze.com/search/shows?q=${enc('breaking bad')}`);
await new Promise(r => setTimeout(r, 700));
await grab('itunes', `https://itunes.apple.com/search?term=${enc('syntax fm')}&media=podcast&limit=5`);
await new Promise(r => setTimeout(r, 700));
await grab('steam', `https://store.steampowered.com/api/storesearch/?term=${enc('portal')}&cc=US&l=en`);
await new Promise(r => setTimeout(r, 700));
await grab('gbif', `https://api.gbif.org/v1/species/search?q=${enc('quercus')}&rank=SPECIES&status=ACCEPTED&limit=5`);
await new Promise(r => setTimeout(r, 700));
await grab('openfda', `https://api.fda.gov/drug/label.json?search=${enc('aspirin')}&limit=3`);
await new Promise(r => setTimeout(r, 900));
await grab('federalregister', `https://www.federalregister.gov/api/v1/documents.json?conditions%5Bterm%5D=${enc('artificial intelligence')}&per_page=5&fields%5B%5D=title&fields%5B%5D=html_url&fields%5B%5D=abstract&fields%5B%5D=publication_date&fields%5B%5D=agencies&fields%5B%5D=type`);
await new Promise(r => setTimeout(r, 900));
await grab('courtlistener', `https://www.courtlistener.com/api/rest/v4/search/?q=${enc('miranda')}&type=o&limit=3`);
console.log('\n形状抓取完成');
