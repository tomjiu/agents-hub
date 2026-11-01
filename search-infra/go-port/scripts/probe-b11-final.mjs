// 第 11 批探针轮 3: 定案轮 — 红灯 curl 交叉归因 + 幸存者黄金样本采集
const UA = 'Mozilla/5.0 (compatible; search-core/0.5; +https://github.com/mmqz/search-tool-rnd)';
const H = { headers: { 'User-Agent': UA, 'Accept': 'application/json' } };
import { execSync } from 'node:child_process';

async function curl(id, url, hdrs = ['-H', 'User-Agent: ' + UA]) {
  const t0 = Date.now();
  try {
    const out = execSync(
      `curl -sS -m 10 -o /tmp/probe-b11/curl-${id}.body -w '%{http_code} %{time_total}s %{size_download}B' ` +
      hdrs.map(h => `'${h}'`).join(' ') + ` '${url}' 2>&1`, { shell: '/bin/bash' }).toString();
    console.log(`\n### curl ${id} — HTTP ${out} (${Date.now() - t0}ms)`);
    const fs = await import('node:fs');
    // eslint-disable-next-line no-invalid-await
    const body = fs.default.readFileSync(`/tmp/probe-b11/curl-${id}.body`, 'utf8');
    console.log(body.slice(0, 220).replace(/\s+/g, ' '));
  } catch (e) {
    console.log(`\n### curl ${id} — FAIL (${Date.now() - t0}ms) ${e.message.slice(0, 150)}`);
  }
}

// --- 红灯定案归因(curl 交叉验证, 批 8 方法学) ---
curl('imdbot', 'https://search.imdbot.workers.dev/?q=inception');
curl('dictionaryapi', 'https://api.dictionaryapi.dev/api/v2/entries/en/serendipity', ['-H', 'User-Agent: ' + UA, '-m', '15']);
curl('scryfall', 'https://api.scryfall.com/cards/search?q=jace');

// --- mangadex: contentRating 守卫 + one piece 黄金样本 ---
{
  const fsx = await import('node:fs');
  const mg = await (await fetch('https://api.mangadex.org/manga?title=one%20piece&limit=3&contentRating[]=safe', H)).json();
  fsx.default.writeFileSync('/tmp/probe-b11/shapes/mangadex-onepiece.json', JSON.stringify(mg));
  console.log('\n### mangadex-golden — len=' + JSON.stringify(mg).length);
  console.log(JSON.stringify(mg, null, 1).slice(0, 3200));
}

// --- lrclib: 规范页 URL 探测 ---
for (const p of [`https://lrclib.net/lrc/36280763`, `https://lrclib.net/track/36280763`, `https://lrclib.net/search/shape%20of%20you`]) {
  try {
    const r = await fetch(p, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    console.log(`### lrclib-page ${p} → ${r.status} ${r.headers.get('location') || ''}`);
  } catch (e) { console.log(`### lrclib-page ${p} → FAIL ${e.message.slice(0, 80)}`); }
}

// --- pubchem: CJK 化学名查(葡萄糖/咖啡因) ---
for (const n of ['glucose', 'glucosxxx']) {
  const r = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(n)}/property/MolecularFormula,MolecularWeight,IUPACName/JSON`, H);
  console.log(`### pubchem ${n} → ${r.status}`);
}
{
  const r = await fetch('https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/' + encodeURIComponent('葡萄糖') + '/property/MolecularFormula,MolecularWeight,IUPACName/JSON', H);
  const t = await r.text();
  console.log(`### pubchem 葡萄糖 → ${r.status} ${t.slice(0, 260)}`);
  const r2 = await fetch('https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/' + encodeURIComponent('咖啡因') + '/property/MolecularFormula,MolecularWeight,IUPACName/JSON', H);
  const t2 = await r2.text();
  console.log(`### pubchem 咖啡因 → ${r2.status} ${t2.slice(0, 260)}`);
}

// --- frankfurter: 完整流(多币提取) + 规范页探测 ---
{
  const r = await fetch('https://api.frankfurter.dev/v1/latest?base=CNY&symbols=JPY,USD', H);
  console.log(`\n### frankfurter-multi → ${r.status} ${await r.text()}`);
}
for (const p of ['https://frankfurter.app/', 'https://frankfurter.app/2026-09-04/USD/CNY', 'https://www.frankfurter.app/?from=USD&to=CNY']) {
  try {
    const r = await fetch(p, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    console.log(`### frankfurter-page ${p} → ${r.status} ${r.headers.get('location') || ''}`);
  } catch (e) { console.log(`### frankfurter-page ${p} → FAIL ${e.message.slice(0, 80)}`); }
}

// --- usgs: 黄金样本落盘 ---
{
  const fsx = await import('node:fs');
  fsx.default.writeFileSync('/tmp/probe-b11/shapes/usgs-sig.json',
    await (await fetch('https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=6&orderby=time&limit=5', H)).text());
  console.log('### usgs golden saved');
}

// --- endoflife: python 黄金样本落盘 ---
{
  const fsx = await import('node:fs');
  fsx.default.writeFileSync('/tmp/probe-b11/shapes/eol-python.json',
    await (await fetch('https://endoflife.date/api/python.json', H)).text());
  console.log('### eol golden saved');
}

// --- pubchem 葡萄糖样本落盘(若 200) ---
{
  const fsx = await import('node:fs');
  const r = await fetch('https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/' + encodeURIComponent('葡萄糖') + '/property/MolecularFormula,MolecularWeight,IUPACName/JSON', H);
  if (r.status === 200) {
    fsx.default.writeFileSync('/tmp/probe-b11/shapes/pubchem-glucose-zh.json', await r.text());
    console.log('### pubchem golden saved');
  }
}

// --- frankfurter 黄金样本落盘 ---
{
  const fsx = await import('node:fs');
  fsx.default.writeFileSync('/tmp/probe-b11/shapes/frankfurter-usd.json',
    await (await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY,EUR', H)).text());
  console.log('### frankfurter golden saved');
}

// --- lrclib 晴天黄金样本落盘 ---
{
  const fsx = await import('node:fs');
  const r = await fetch('https://lrclib.net/api/search?q=' + encodeURIComponent('晴天 周杰伦'), H);
  const body = await r.text();
  fsx.default.writeFileSync('/tmp/probe-b11/shapes/lrclib-qingtian.json', body.slice(0, 3000));
  console.log(`### lrclib golden saved (${body.length}B, 首条 ${(JSON.parse(body)[0] || {}).trackName})`);
}
console.log('\n=== round 3 done ===');
