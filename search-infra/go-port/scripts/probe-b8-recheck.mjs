#!/usr/bin/env node
// 探针第 8 批轮 1.5: 修正 + 复验
// - openfda: /drug/label.json (单数, 轮1 用了 labels 404)
// - lobsters: fetch failed 复试 (DNS/TLS 层)
// - jikan: 504 上游复试
// - gbooks: 429 复试确认配额池状态
// - openfoodfacts: 548KB 肥响应试 fields 裁剪
// - devto: 强区分词验证 q 参数相关性(轮1 返回疑似默认流)
// - courtlistener: 匿名 200 但 35KB, 试 fields 裁剪 + 相关性词
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
      signal: ctrl.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    const ms = Date.now() - t0;
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    let shape = 'text', data = null;
    if (ct.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
      try { data = JSON.parse(text); shape = 'json'; } catch { shape = 'json-parse-fail'; }
    }
    let sample = shape === 'json' ? JSON.stringify(data).slice(0, 1200) : text.replace(/\s+/g, ' ').slice(0, 300);
    return { name, url, status: res.status, ms, ct, shape, len: text.length, sample, data };
  } catch (e) {
    return { name, url, status: 0, ms: Date.now() - t0, err: String(e).slice(0, 200) };
  }
}

const enc = encodeURIComponent;
const out = {};

// 1. openfda 修正端点
out.openfda_fixed = await hit('openfda', `https://api.fda.gov/drug/label.json?search=${enc('aspirin')}&limit=3`);
console.log(`openfda_fixed: ${out.openfda_fixed.status} ${out.openfda_fixed.ms}ms ${(out.openfda_fixed.shape || out.openfda_fixed.err || '').slice(0,20)} ${(out.openfda_fixed.sample || '').slice(0, 150)}`);
await new Promise(r => setTimeout(r, 500));

// 2. lobsters 复试
out.lobsters_retry = await hit('lobsters', `https://lobste.rs/search.json?q=${enc('sqlite')}&what=stories&order=newest`);
console.log(`lobsters_retry: ${out.lobsters_retry.status} ${out.lobsters_retry.ms}ms ${out.lobsters_retry.err || `${out.lobsters_retry.shape} ${out.lobsters_retry.len}B`}`);
await new Promise(r => setTimeout(r, 500));

// 3. jikan 复试
out.jikan_retry = await hit('jikan', `https://api.jikan.moe/v4/anime?q=${enc('steins gate')}&limit=5`);
console.log(`jikan_retry: ${out.jikan_retry.status} ${out.jikan_retry.ms}ms ${(out.jikan_retry.shape || out.jikan_retry.err || '').slice(0,20)} ${(out.jikan_retry.sample || '').slice(0, 150)}`);
await new Promise(r => setTimeout(r, 1200));

// 4. gbooks 配额池状态
out.gbooks_retry = await hit('gbooks', `https://www.googleapis.com/books/v1/volumes?q=${enc('sherlock holmes')}&maxResults=5`);
console.log(`gbooks_retry: ${out.gbooks_retry.status} ${out.gbooks_retry.ms}ms ${(out.gbooks_retry.sample || '').slice(0, 150)}`);
await new Promise(r => setTimeout(r, 500));

// 5. openfoodfacts fields 裁剪试验
out.off_fields = await hit('off_fields', `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${enc('nutella')}&json=1&page_size=3&fields=product_name%2Cbrands%2Curl%2Cquantity%2Ccode`);
console.log(`off_fields: ${out.off_fields.status} ${out.off_fields.ms}ms ${out.off_fields.len}B ${(out.off_fields.sample || '').slice(0, 200)}`);
await new Promise(r => setTimeout(r, 1200));

// 6. devto 相关性验证: 强区分词 + 与无 q 对照
out.devto_q1 = await hit('devto_q1', `https://dev.to/api/articles?per_page=5&q=${enc('postgresql index tuning')}`);
await new Promise(r => setTimeout(r, 600));
out.devto_noq = await hit('devto_noq', `https://dev.to/api/articles?per_page=5`);
const d1 = out.devto_q1.data || [], d2 = out.devto_noq.data || [];
const t1 = d1.map(a => a.title), t2 = d2.map(a => a.title);
out.devto_relevant = JSON.stringify(t1) !== JSON.stringify(t2);
console.log(`devto_q1 titles: ${JSON.stringify(t1).slice(0, 300)}`);
console.log(`devto_noq titles: ${JSON.stringify(t2).slice(0, 300)}`);
console.log(`devto q 参数相关性: ${out.devto_relevant ? '有效(与无q不同)' : '无效(=默认流)'}`);
await new Promise(r => setTimeout(r, 500));

// 7. courtlistener fields 裁剪
out.courtlistener_fields = await hit('courtlistener_f', `https://www.courtlistener.com/api/rest/v4/search/?q=${enc('miranda')}&type=o&limit=3&fields=caseName%2CdocketNumber%2Ccourt%2Cabsolute_url%2CdateFiled%2Csnippet`);
console.log(`courtlistener_f: ${out.courtlistener_fields.status} ${out.courtlistener_fields.ms}ms ${out.courtlistener_fields.len}B ${(out.courtlistener_fields.sample || '').slice(0, 250)}`);

writeFileSync(`${OUT}/probe-b8-recheck-${Date.now()}.json`, JSON.stringify(out, null, 2));
console.log('\n已落盘 /tmp/probe-b8/');
