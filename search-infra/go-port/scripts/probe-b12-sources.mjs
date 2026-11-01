// 第 12 批探针轮 1: 12 候选 (域加强 11 + 机动 1, 全部注册表查重不在册)
// academic 加强: semanticscholar(引用数维度) openreview(CS/ML 会议预印本)
// music 加强: deezer(试听/热度, musicbrainz 纯元数据)
// entities 加强: restcountries(国家事实: 首都/人口/币种)
// species 加强: inaturalist(俗名/观察, gbif 纯分类背骨)
// finance 加强: coinpaprika(coingecko 5 连打即 429 脆弱, 第二 crypto 源)
// food 加强: openfoodfacts(加工食品营养, themealdb 纯食谱)
// programming 加强: searchcode(真代码搜索空白) gitlab(项目搜索第二源)
// packages 加强: pubdev(dart/flutter 语言空白)
// news 加强: lobsters(技术社区)
// devops 加强: nixos(nix 包空白; 疑 SPA 无服务端结果, 先验低)
const UA = 'Mozilla/5.0 (compatible; search-core/0.5; +https://github.com/mmqz/search-tool-rnd)';

const tests = [
  { id: 'semanticscholar', name: 'Semantic Scholar 论文(引用数)', url: 'https://api.semanticscholar.org/graph/v1/paper/search?query=attention+is+all+you+need&fields=title,url,abstract,year,venue,citationCount&limit=5',
    init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } },
  { id: 'openreview-v2', name: 'OpenReview v2 笔记搜索', url: 'https://api2.openreview.net/notes/search?term=llm+reasoning&limit=5',
    init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } },
  { id: 'deezer', name: 'Deezer 曲库搜索', url: 'https://api.deezer.com/search?q=hello+adele&limit=5',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'restcountries', name: 'REST Countries 国家事实', url: 'https://restcountries.com/v3.1/name/germany?fields=name,capital,population,currencies,region,cca2',
    init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } },
  { id: 'inaturalist', name: 'iNaturalist 物种', url: 'https://api.inaturalist.org/v1/taxa?q=falcon&per_page=5',
    init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } },
  { id: 'coinpaprika', name: 'CoinPaprika 加密货币', url: 'https://api.coinpaprika.com/v1/search?q=bitcoin&c=currencies&limit=5',
    init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } },
  { id: 'openfoodfacts', name: 'OpenFoodFacts 食品', url: 'https://world.openfoodfacts.org/cgi/search.pl?search_terms=nutella&json=1&page_size=5&fields=product_name,brands,url,quantity',
    init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } },
  { id: 'searchcode', name: 'searchcode 代码搜索', url: 'https://searchcode.com/api/codesearch_I/?q=quicksort&per_page=5',
    init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } },
  { id: 'gitlab', name: 'GitLab 项目搜索', url: 'https://gitlab.com/api/v4/projects?search=ripgrep&order_by=stars&sort=desc&per_page=5&simple=true',
    init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } },
  { id: 'pubdev', name: 'pub.dev Dart/Flutter 包', url: 'https://pub.dev/api/search?q=state+management',
    init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } },
  { id: 'lobsters', name: 'Lobsters 技术社区', url: 'https://lobste.rs/search.json?q=containerd&what=stories&order=newest',
    init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } },
  { id: 'nixos', name: 'NixOS 包搜索(疑 SPA)', url: 'https://search.nixos.org/packages?query=ripgrep',
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
    console.log(`\n### ${t.id} — ${t.name}`);
    console.log(`HTTP ${res.status} ${ms}ms ct=${ct} len=${body.length}`);
    if (res.status === 200) {
      if (ct.includes('json') || body.trimStart().startsWith('{') || body.trimStart().startsWith('[')) {
        try {
          const j = JSON.parse(body);
          const keys = Array.isArray(j) ? `[array len=${j.length}]` : Object.keys(j).join(',');
          console.log(`top: ${keys}`);
          const probe = Array.isArray(j) ? j[0] : j;
          for (const k of Object.keys(probe || {}).slice(0, 12)) {
            const v = JSON.stringify(probe[k]);
            console.log(`  .${k} = ${v && v.length > 160 ? v.slice(0, 160) + '…' : v}`);
          }
        } catch (e) { console.log(`JSON 解析失败: ${e.message}`); }
      } else {
        console.log(body.slice(0, 500).replace(/\s+/g, ' '));
      }
    } else {
      console.log(body.slice(0, 300).replace(/\s+/g, ' '));
    }
  } catch (e) {
    console.log(`\n### ${t.id} — ${t.name}`);
    console.log(`FAIL ${Date.now() - t0}ms ${e.name}: ${e.message}`);
  }
}
