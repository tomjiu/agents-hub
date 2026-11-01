// 第 9 批轮 3: 定案复验 — poetrydb 结构 / standardebooks HTML 形态 / remotive 相关性
const UA = 'Mozilla/5.0 (compatible; search-core/0.5; +https://github.com/mmqz/search-tool-rnd)';

async function hit(id, url) {
  const t0 = Date.now();
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15000);
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ac.signal });
    clearTimeout(timer);
    return { id, status: res.status, ms: Date.now() - t0, body: await res.text() };
  } catch (e) {
    return { id, status: 'FAIL', ms: Date.now() - t0, body: String(e.cause ? e.cause.code : e.message) };
  }
}

// 1. poetrydb: 结构细看 — title,Like 的合法语法其实是 /title/Like (部分匹配用通配? 官网: /author,author/ 字段联查, /title/ 精确)
// PoetryDB 文档: wildcard 支持 /title/Love/ 前后通配. 试 /title/love (精确) vs /title/love/ (通配包含)
const p1 = await hit('poetrydb1', 'https://poetrydb.org/title/love');
console.log(`[poetrydb-精确love] ${p1.status} ${p1.ms}ms head=${p1.body.slice(0, 100).replace(/\s+/g, ' ')}`);
const p2 = await hit('poetrydb2', 'https://poetrydb.org/title/love');
// 官方 wildcard 语法: /title/Love/ 尾斜杠=通配
const p3 = await hit('poetrydb3', 'https://poetrydb.org/title/Love/');
console.log(`[poetrydb-通配Love/] ${p3.status} ${p3.ms}ms head=${p3.body.slice(0, 100).replace(/\s+/g, ' ')}`);
if (p3.status === 200) {
  try {
    const j = JSON.parse(p3.body);
    const arr = Array.isArray(j) ? j : [];
    console.log(`  通配命中=${arr.length} 首3=${arr.slice(0, 3).map(x => x.title).join(' | ')}`);
  } catch { console.log('  parse-fail'); }
}

// 2. standardebooks: HTML 结构细看
const rse = await hit('se', 'https://standardebooks.org/ebooks?query=sherlock');
if (rse.status === 200) {
  // 找列表元素: 先看有哪些 <ol>/<ul> class
  const lists = [...rse.body.matchAll(/<(ol|ul)[^>]*class="([^"]*)"/g)].slice(0, 6);
  console.log(`[se-lists] ${lists.map(m => `<${m[1]} class="${m[2]}">`).join(' ')}`);
  // 找 /ebooks/ 链接条目
  const links = [...rse.body.matchAll(/href="(\/ebooks\/[a-z-]+\/[a-z-]+)"/g)].slice(0, 5);
  console.log(`[se-links] /ebooks/xx/yy 形态 x ${links.length}: ${[...new Set(links.map(l => l[1]))].slice(0, 4).join(' | ')}`);
  // h2/title 形态
  const titles = [...rse.body.matchAll(/<h2[^>]*>([\s\S]{0,80}?)<\/h2>/g)].slice(0, 3);
  console.log(`[se-h2] ${titles.map(t => t[1].replace(/<[^>]+>/g, '').trim().slice(0, 40)).join(' | ')}`);
}

// 3. remotive 相关性: golang / kubernetes 对照
for (const q of ['golang', 'kubernetes']) {
  const r = await hit('remotive-' + q, 'https://remotive.com/api/remote-jobs?search=' + q);
  if (r.status === 200) {
    const j = JSON.parse(r.body);
    const jobs = j.jobs || [];
    console.log(`[remotive-${q}] 命中=${jobs.length} 首3=${jobs.slice(0, 3).map(x => x.title.slice(0, 40)).join(' | ')}`);
  } else console.log(`[remotive-${q}] ${r.status}`);
}

// 4. coingecko 守卫词面抽查: bitcoin/blockchain/nft 三个高置信词
for (const q of ['bitcoin', 'blockchain', 'nft']) {
  const r = await hit('cg-' + q, 'https://api.coingecko.com/api/v3/search?query=' + q);
  let n = '?', first = '';
  if (r.status === 200) {
    const j = JSON.parse(r.body);
    n = j.coins.length;
    first = j.coins[0] ? j.coins[0].name + '(' + j.coins[0].symbol + ')' : '';
  }
  console.log(`[cg-${q}] ${r.status} ${r.ms}ms coins=${n} first=${first}`);
  await new Promise(res => setTimeout(res, 6500)); // 避免限频干扰
}
