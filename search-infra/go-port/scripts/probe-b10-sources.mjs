// 第 10 批探针: 12 候选 (新域 6 + 域加强 3 + 机动/复核 3)
// 新域: thecocktaildb(drinks) boardgamegeek(boardgames, XML) wikivoyage(travel)
//       openvsx+jetbrains-plugins(ide-ext) wp-plugins(plugins) reliefweb(disaster)
// 域加强: uniprot(species/protein) snapcraft(devops) gdelt(news)
// 机动: softwareheritage(code-archive) homebrew(关账复核: 批5 判"无API", formulae.brew.sh search 端点有据重探)
const UA = 'Mozilla/5.0 (compatible; search-core/0.5; +https://github.com/mmqz/search-tool-rnd)';

const tests = [
  { id: 'thecocktaildb', name: 'TheCocktailDB 鸡尾酒(mealdb 姊妹)', url: 'https://www.thecocktaildb.com/api/json/v1/1/search.php?s=margarita',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'boardgamegeek', name: 'BoardGameGeek 桌游(XML API2)', url: 'https://www.boardgamegeek.com/xmlapi2/search?query=catan&type=boardgame',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'wikivoyage', name: 'Wikivoyage 旅行指南(MediaWiki)', url: 'https://en.wikivoyage.org/w/api.php?action=query&list=search&srsearch=kyoto&format=json&srlimit=5',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'uniprot', name: 'UniProt 蛋白质', url: 'https://rest.uniprot.org/uniprotkb/search?query=insulin&format=json&size=5',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'openvsx', name: 'Open VSX 扩展(VS Code 生态)', url: 'https://open-vsx.org/api/-/search?query=python&size=5',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'jetbrains-plugins', name: 'JetBrains 插件', url: 'https://plugins.jetbrains.com/api/searchPlugins?search=python&size=5',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'wp-plugins', name: 'WordPress 插件', url: 'https://api.wordpress.org/plugins/info/1.2/?action=query_plugins&request%5Bsearch%5D=seo&request%5Bper_page%5D=5',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'reliefweb', name: 'ReliefWeb 灾害人道', url: 'https://api.reliefweb.int/v1/disasters?appname=search-core-probe&query%5Bvalue%5D=flood&limit=5',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'snapcraft', name: 'Snapcraft(需设备系列头)', url: 'https://api.snapcraft.io/v2/snaps/info?q=firefox',
    init: { headers: { 'User-Agent': UA, 'Snap-Device-Series': '16' } } },
  { id: 'gdelt', name: 'GDELT 全球新闻', url: 'https://api.gdeltproject.org/api/v2/doc/doc?query=climate&mode=artlist&maxrecords=5&format=json',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'softwareheritage', name: 'Software Heritage 代码档案', url: 'https://archive.softwareheritage.org/api/1/origin/search/nginx/?limit=5',
    init: { headers: { 'User-Agent': UA } } },
  { id: 'homebrew', name: 'Homebrew formulae(关账复核)', url: 'https://formulae.brew.sh/api/search.json?q=wget',
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
    console.log(`  head: ${compact.slice(0, 260)}`);
  } catch (e) {
    const ms = Date.now() - t0;
    console.log(`[${t.id}] FAIL ${ms}ms: ${e.cause ? e.cause.code + ' ' + e.cause.message : e.message}`.slice(0, 150));
  }
}
