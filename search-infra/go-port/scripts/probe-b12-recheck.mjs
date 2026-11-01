// 第 12 批探针轮 2: 幸存者深挖 + 红灯修正 + curl 交叉归因 + wikidata 清账取证
// 幸存者: openreview/inaturalist/coinpaprika/pubdev
// 红灯修正: restcountries(新 host api.restcountries.com) openfoodfacts(v2 API) gitlab(去 order_by)
//           semanticscholar(退避重试) searchcode(变体端点) nixos(backend API 猜测, 预期 404 关账)
// 交叉归因: deezer/lobsters curl 传输层(批 8 方法学)
// 清账取证: wikidata 全短语 vs 剥离短语(批 11 挂账)
const UA = 'Mozilla/5.0 (compatible; search-core/0.5; +https://github.com/mmqz/search-tool-rnd)';

async function probe(t) {
  const t0 = Date.now();
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
    const res = await fetch(t.url, { ...t.init, signal: ac.signal });
    clearTimeout(timer);
    const ms = Date.now() - t0;
    const ct = res.headers.get('content-type') || '';
    const body = await res.text();
    console.log(`\n### ${t.id} — ${t.name}`);
    console.log(`HTTP ${res.status} ${ms}ms ct=${ct} len=${body.length}`);
    if (res.status === 200) {
      if (ct.includes('json') || body.trimStart().startsWith('{') || body.trimStart().startsWith('[')) {
        try {
          const j = JSON.parse(body);
          const keys = Array.isArray(j) ? `[array len=${j.length}]` : Object.keys(j).join(',');
          console.log(`top: ${keys}`);
          const arr = Array.isArray(j) ? j : (j.notes || j.results || j.packages || j.currencies || []);
          const probeItem = Array.isArray(j) ? j[0] : (arr && arr[0]) || j;
          for (const k of Object.keys(probeItem || {}).slice(0, 14)) {
            const v = JSON.stringify(probeItem[k]);
            console.log(`  .${k} = ${v && v.length > 150 ? v.slice(0, 150) + '…' : v}`);
          }
        } catch (e) { console.log(`JSON 解析失败: ${e.message}`); }
      } else {
        console.log(body.slice(0, 400).replace(/\s+/g, ' '));
      }
    } else {
      console.log(body.slice(0, 250).replace(/\s+/g, ' '));
    }
  } catch (e) {
    console.log(`\n### ${t.id} — ${t.name}`);
    console.log(`FAIL ${Date.now() - t0}ms ${e.name}: ${e.message}`);
  }
}

// ---- 幸存者深挖 ----
await probe({ id: 'openreview-v2-title', name: 'OpenReview 字段深挖(title/abstract/venue)', url: 'https://api2.openreview.net/notes/search?term=tool+use+llm&limit=3',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } });
await probe({ id: 'inaturalist-cjk', name: 'iNaturalist 中文俗名(隼)', url: 'https://api.inaturalist.org/v1/taxa?q=%E9%9A%BC&per_page=5',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } });
await probe({ id: 'inaturalist-ascii', name: 'iNaturalist ASCII 词面(gyrfalcon)', url: 'https://api.inaturalist.org/v1/taxa?q=gyrfalcon&per_page=3',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } });
await probe({ id: 'coinpaprika-ticker', name: 'CoinPaprika ticker 词面(sol)', url: 'https://api.coinpaprika.com/v1/search?q=sol&c=currencies&limit=5',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } });
await probe({ id: 'coinpaprika-double', name: 'CoinPaprika 连打 2 次(限频探测)', url: 'https://api.coinpaprika.com/v1/search?q=ethereum&c=currencies&limit=5',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } });
await probe({ id: 'pubdev-detail', name: 'pub.dev 包详情第二腿(riverpod)', url: 'https://pub.dev/api/packages/riverpod',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } });

// ---- 红灯修正 ----
await probe({ id: 'restcountries-apiv3', name: 'REST Countries 新 host', url: 'https://api.restcountries.com/v3.1/name/germany?fields=name,capital,population,currencies,region,cca2',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } });
await probe({ id: 'openfoodfacts-v2', name: 'OpenFoodFacts v2 search API', url: 'https://world.openfoodfacts.org/api/v2/search?search_terms=nutella&page_size=5&fields=product_name,brands,url,quantity',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } });
await probe({ id: 'gitlab-nofix', name: 'GitLab 去 order_by', url: 'https://gitlab.com/api/v4/projects?search=ripgrep&per_page=5&simple=true',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } });
await probe({ id: 'semanticscholar-retry', name: 'Semantic Scholar 退避重试', url: 'https://api.semanticscholar.org/graph/v1/paper/search?query=transformer&fields=title,url,year,citationCount&limit=5',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } });
await probe({ id: 'searchcode-new', name: 'searchcode 变体端点', url: 'https://searchcode.com/api/codesearch_J/?q=quicksort&per_page=5',
  init: { headers: { 'User-Agent': UA } } });
await probe({ id: 'nixos-backend', name: 'NixOS backend API 猜测(预期关账取证)', url: 'https://search.nixos.org/backend/api/search/?query=ripgrep&channel=unstable',
  init: { headers: { 'User-Agent': UA } } });

// ---- wikidata 清账取证(批 11 挂账) ----
await probe({ id: 'wikidata-fullphrase', name: 'wikidata 全短语 "who is linus torvalds"(复现败因)', url: 'https://www.wikidata.org/w/api.php?action=wbsearchentities&search=who%20is%20linus%20torvalds&language=en&format=json&limit=5&origin=*',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } });
await probe({ id: 'wikidata-stripped', name: 'wikidata 剥离短语 "linus torvalds"(修法取证)', url: 'https://www.wikidata.org/w/api.php?action=wbsearchentities&search=linus%20torvalds&language=en&format=json&limit=5&origin=*',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } });
await probe({ id: 'wikidata-cjk', name: 'wikidata 中文意图词 "东京 人口"(修法取证)', url: 'https://www.wikidata.org/w/api.php?action=wbsearchentities&search=%E6%9D%B1%E4%BA%AC&language=zh&format=json&limit=5&origin=*',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } });

// ---- 限频第二枪: coinpaprika 连打第二次(放最后) ----
await probe({ id: 'coinpaprika-double2', name: 'CoinPaprika 连打第 2 次', url: 'https://api.coinpaprika.com/v1/search?q=cardano&c=currencies&limit=5',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } });
console.log('\n[curl 交叉归因 deezer/lobsters 由 shell 执行]');
