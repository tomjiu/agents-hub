// 第 9 批探针: 12 候选 (新域 5 + 复验/机动 7)
// 新域: coingecko(finance) themealdb(food) kitsu(anime) thesportsdb(sport) remotive(jobs)
// 复验: oeis(CF 403 史, 带UA复试) gbooks(429 史) openlibrary(超时史) jikan(上游拒连史)
// 机动: standardebooks(books) poetrydb(lit) relevantxkcd(comics)
const UA = 'Mozilla/5.0 (compatible; search-core/0.5; +https://github.com/mmqz/search-tool-rnd)';

const tests = [
  { id: 'coingecko', name: 'CoinGecko 加密货币', url: 'https://api.coingecko.com/api/v3/search?query=bitcoin',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'themealdb', name: 'TheMealDB 食谱', url: 'https://www.themealdb.com/api/json/v1/1/search.php?s=chicken',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'kitsu', name: 'Kitsu 动漫(jikan替代)', url: 'https://kitsu.io/api/edge/anime?filter[text]=cowboy%20bebop&page[limit]=5',
    init: { headers: { 'User-Agent': UA, 'Accept': 'application/vnd.api+json' } } },
  { id: 'thesportsdb', name: 'TheSportsDB 体育', url: 'https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=lakers',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'remotive', name: 'Remotive 远程职位', url: 'https://remotive.com/api/remote-jobs?search=rust&limit=5',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'oeis', name: 'OEIS 数列(CF复验)', url: 'https://oeis.org/search?q=1,1,2,3,5&fmt=json',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'gbooks', name: 'Google Books(429复验)', url: 'https://www.googleapis.com/books/v1/volumes?q=rust+programming&maxResults=5',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'openlibrary', name: 'OpenLibrary(超时复验)', url: 'https://openlibrary.org/search.json?q=rust&limit=5&fields=title,key,author_name,first_publish_year',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'jikan', name: 'Jikan(上游拒连复验)', url: 'https://api.jikan.moe/v4/anime?q=frieren&limit=5',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'standardebooks', name: 'Standard Ebooks', url: 'https://standardebooks.org/ebooks?query=sherlock',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'poetrydb', name: 'PoetryDB 诗歌', url: 'https://poetrydb.org/author/Shakespeare',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'relevantxkcd', name: 'Relevant xkcd 漫画', url: 'https://relevantxkcd.appspot.com/api/search?query=bicycles',
    init: { headers: { 'User-Agent': UA } } },
];

for (const t of tests) {
  const t0 = Date.now();
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
    const res = await fetch(t.url, { ...t.init, signal: ac.signal });
    clearTimeout(timer);
    const ms = Date.now() - t0;
    const ct = res.headers.get('content-type') || '';
    const body = await res.text();
    const compact = body.replace(/\s+/g, ' ');
    let shape = 'unknown', size = body.length;
    if (ct.includes('json') || body.trim().startsWith('{') || body.trim().startsWith('[')) {
      try {
        const j = JSON.parse(body);
        shape = Array.isArray(j) ? 'array' : Object.keys(j).slice(0, 8).join(',');
      } catch { shape = 'json-parse-fail'; }
    } else shape = `html(${size}b)`;
    console.log(`[${t.id}] ${res.status} ${ms}ms ct=${ct.split(';')[0]} shape={${shape}} size=${size}`);
    console.log(`  head: ${compact.slice(0, 220)}`);
  } catch (e) {
    const ms = Date.now() - t0;
    console.log(`[${t.id}] FAIL ${ms}ms: ${e.cause ? e.cause.code + ' ' + e.cause.message : e.message}`.slice(0, 150));
  }
}
