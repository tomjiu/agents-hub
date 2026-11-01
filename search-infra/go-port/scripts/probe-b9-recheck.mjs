// 第 9 批轮 2: 幸存者复验(参数有效性/方差/限频/词面)
const UA = 'Mozilla/5.0 (compatible; search-core/0.5; +https://github.com/mmqz/search-tool-rnd)';

async function hit(id, url, init = {}) {
  const t0 = Date.now();
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15000);
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...(init.headers || {}) }, ...init, signal: ac.signal });
    clearTimeout(timer);
    const body = await res.text();
    return { id, status: res.status, ms: Date.now() - t0, body };
  } catch (e) {
    return { id, status: 'FAIL', ms: Date.now() - t0, body: String(e.cause ? e.cause.code : e.message) };
  }
}

// 1. remotive: limit 是否生效
const r1 = await hit('remotive', 'https://remotive.com/api/remote-jobs?search=rust&limit=5');
if (r1.status === 200) {
  const j = JSON.parse(r1.body);
  console.log(`[remotive-limit] jobs数组长度=${j.jobs.length} job-count=${j['job-count']} total=${j['total-job-count']}`);
  console.log(`  首条: ${j.jobs[0] ? j.jobs[0].title + ' @ ' + j.jobs[0].company_name : 'none'}`);
}

// 2. kitsu: 方差 3 连
for (let i = 0; i < 3; i++) {
  const r = await hit('kitsu', 'https://kitsu.io/api/edge/anime?filter[text]=frieren&page[limit]=5');
  let n = '?', first = '';
  if (r.status === 200) {
    const j = JSON.parse(r.body);
    n = j.data.length;
    first = j.data[0] ? j.data[0].attributes.canonicalTitle : '';
  }
  console.log(`[kitsu-var#${i}] ${r.status} ${r.ms}ms n=${n} first=${first}`);
}

// 3. coingecko: 中文词面 + 限频(连打 5 次看是否 429)
const rc = await hit('coingecko', 'https://api.coingecko.com/api/v3/search?query=' + encodeURIComponent('以太坊'));
console.log(`[coingecko-中文] ${rc.status} ${rc.ms}ms head=${rc.body.slice(0, 150).replace(/\s+/g, ' ')}`);
for (let i = 0; i < 5; i++) {
  const r = await hit('coingecko', 'https://api.coingecko.com/api/v3/search?query=eth' + i);
  console.log(`[coingecko-burst#${i}] ${r.status} ${r.ms}ms`);
  if (r.status === 429) break;
}

// 4. poetrydb: title,Like 部分匹配语法
const rp = await hit('poetrydb', 'https://poetrydb.org/title,Like/love;linecount=10');
if (rp.status === 200) {
  try {
    const j = JSON.parse(rp.body);
    const arr = Array.isArray(j) ? j : (j.status && j.status === 404 ? [] : [j]);
    console.log(`[poetrydb-titleLike] ${rp.status} ${rp.ms}ms 命中=${arr.length} 首条=${arr[0] ? arr[0].title : 'none'}`);
  } catch { console.log(`[poetrydb-titleLike] ${rp.status} parse-fail head=${rp.body.slice(0, 120)}`); }
} else console.log(`[poetrydb-titleLike] ${rp.status} ${rp.ms}ms`);

// 5. themealdb: 中文词面(纯中文预期空 → asciiFace 模式适配?) + 换词方差
const rt = await hit('themealdb', 'https://www.themealdb.com/api/json/v1/1/search.php?s=' + encodeURIComponent('红烧肉'));
console.log(`[themealdb-中文] ${rt.status} ${rt.ms}ms meals=${rt.body === '{"meals":null}' || rt.body.includes('"meals":null') ? 'null' : '?'}`);
const rt2 = await hit('themealdb', 'https://www.themealdb.com/api/json/v1/1/search.php?s=sushi');
const rt2n = rt2.status === 200 ? (JSON.parse(rt2.body).meals || []).length : rt2.status;
console.log(`[themealdb-sushi] ${rt2.status} ${rt2.ms}ms meals=${rt2n}`);

// 6. thesportsdb: NBA Lakers 相关性确认
const rs = await hit('thesportsdb', 'https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=Los%20Angeles%20Lakers');
if (rs.status === 200) {
  const j = JSON.parse(rs.body);
  const teams = j.teams || [];
  const nba = teams.find(t => t.strLeague === 'NBA');
  console.log(`[sportsdb-lakers] 命中=${teams.length} NBA球队=${nba ? nba.strTeam + ' id=' + nba.idTeam : '无'}`);
}

// 7. standardebooks: 搜索页结构(HTML 解析可行性) — 看 result 元素形态
const rse = await hit('standardebooks', 'https://standardebooks.org/ebooks?query=sherlock&view=list');
console.log(`[standardebooks-list] ${rse.status} ${rse.ms}ms size=${rse.body.length}`);
const m = rse.body.match(/<ul class="ebooks-list">[\s\S]{0,300}/);
if (m) console.log(`  列表形态: ${m[0].replace(/\s+/g, ' ').slice(0, 250)}`);
const items = [...rse.body.matchAll(/<li[^>]*itemscope[^>]*>\s*<a href="(\/ebooks\/[^"]+)"/g)].slice(0, 3);
console.log(`  itemscope li x ${[...rse.body.matchAll(/itemscope/g)].length}, 首批链接: ${items.map(i => i[1]).join(' | ')}`);
