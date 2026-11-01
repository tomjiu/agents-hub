// 第 11 批探针轮 1: 12 候选 (新域 4 + 域加强 5 + 机动 3)
// 新域: imdbot(movies 大空白!) mangadex(manga) scryfall(cardgames) lrclib(lyrics)
// 域加强: usgs-quakes(geo/最近地震) endoflife(devops/版本 EOL) pubchem-chem(chemistry)
//         frankfurter(finance/汇率) dictionaryapi(dictionary/英词典)
// 机动: nagerdate(holidays, 疑似无关键词搜索) mankier(man 页解释) rfc-editor(标准 HTML)
const UA = 'Mozilla/5.0 (compatible; search-core/0.5; +https://github.com/mmqz/search-tool-rnd)';

const tests = [
  { id: 'imdbot', name: 'IMDb 搜索(keyless workers 代理)', url: 'https://search.imdbot.workers.dev/?q=dune',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'mangadex', name: 'MangaDex 漫画库', url: 'https://api.mangadex.org/manga?title=frieren&limit=5',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'scryfall', name: 'Scryfall MTG 卡牌', url: 'https://api.scryfall.com/cards/search?q=jace',
    init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } },
  { id: 'lrclib', name: 'LRCLIB 歌词库', url: 'https://lrclib.net/api/search?q=hello+adele',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'nagerdate', name: 'Nager.Date 公共节假日(疑无关键词搜索)', url: 'https://date.nager.at/api/v3/publicholidays/2026/US',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'usgs-quakes', name: 'USGS 地震(疑无关键词)', url: 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&limit=5&orderby=time',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'endoflife', name: 'endoflife.date 版本 EOL', url: 'https://endoflife.date/api/python.json',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'pubchem-autocomplete', name: 'PubChem 化合物自动补全', url: 'https://pubchem.ncbi.nlm.nih.gov/rest/autocomplete/compound/gluc/JSON?limit=5',
    init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } },
  { id: 'frankfurter', name: 'Frankfurter 汇率(ECB)', url: 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY,EUR',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'dictionaryapi', name: 'FreeDictionaryAPI 英词典', url: 'https://api.dictionaryapi.dev/api/v2/entries/en/serendipity',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'mankier', name: 'ManKier man 页解释', url: 'https://www.mankier.com/api/v2/explain/?q=docker+run',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'rfc-editor', name: 'RFC 编辑器检索(HTML)', url: 'https://www.rfc-editor.org/search/rfc_search_detail.php?title=dns&sort=Number&pagesize=5',
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
      if (ct.includes('json')) {
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
