// 第 10 批轮 2: 幸存者强度复验(3 查询相关性+中文词面) + 红灯修正/归因
const UA = 'Mozilla/5.0 (compatible; search-core/0.5; +https://github.com/mmqz/search-tool-rnd)';
const H = { headers: { 'User-Agent': UA } };

async function probe(id, url, init = H, note = '') {
  const t0 = Date.now();
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15000);
    const res = await fetch(url, { ...init, signal: ac.signal });
    clearTimeout(timer);
    const ms = Date.now() - t0;
    const body = await res.text();
    const compact = body.replace(/\s+/g, ' ');
    let shape = 'raw';
    try { const j = JSON.parse(body); shape = Array.isArray(j) ? 'array' : Object.keys(j).slice(0, 6).join(','); } catch {}
    console.log(`[${id}] ${res.status} ${ms}ms {${shape}} ${note} :: ${compact.slice(0, 240)}`);
    return body;
  } catch (e) {
    console.log(`[${id}] FAIL ${Date.now() - t0}ms: ${e.cause ? e.cause.code + ' ' + e.cause.message : e.message}`.slice(0, 150));
    return null;
  }
}

console.log('== 幸存者强度复验 ==');
// thecocktaildb: 精确词+泛词+无结果词
await probe('thecocktaildb/margarita', 'https://www.thecocktaildb.com/api/json/v1/1/search.php?s=margarita');
await probe('thecocktaildb/martini', 'https://www.thecocktaildb.com/api/json/v1/1/search.php?s=martini');
await probe('thecocktaildb/xyz-null', 'https://www.thecocktaildb.com/api/json/v1/1/search.php?s=zzzznotexist');
// wikivoyage: 城市+国家+中文
await probe('wikivoyage/tokyo', 'https://en.wikivoyage.org/w/api.php?action=query&list=search&srsearch=tokyo&format=json&srlimit=5');
await probe('wikivoyage/%E4%B8%9C%E4%BA%AC', 'https://en.wikivoyage.org/w/api.php?action=query&list=search&srsearch=%E6%9D%B1%E4%BA%AC&format=json&srlimit=5');
// openvsx: 泛词+窄词
await probe('openvsx/linter', 'https://open-vsx.org/api/-/search?query=linter&size=5');
await probe('openvsx/rust-analyzer', 'https://open-vsx.org/api/-/search?query=rust-analyzer&size=5');
// jetbrains: 泛词+窄词
await probe('jb/kotlin', 'https://plugins.jetbrains.com/api/searchPlugins?search=kotlin&size=5');
await probe('jb/database-tools', 'https://plugins.jetbrains.com/api/searchPlugins?search=database&size=5');
// wp-plugins: 泛词+窄词
await probe('wp/contact-form', 'https://api.wordpress.org/plugins/info/1.2/?action=query_plugins&request%5Bsearch%5D=contact%20form&request%5Bper_page%5D=5');
await probe('wp/woocommerce', 'https://api.wordpress.org/plugins/info/1.2/?action=query_plugins&request%5Bsearch%5D=woocommerce&request%5Bper_page%5D=5');

console.log('== 红灯修正 ==');
// uniprot: fields 瘦身复验(轮1 size=5 竟 617KB)
await probe('uniprot/fields', 'https://rest.uniprot.org/uniprotkb/search?query=insulin+AND+reviewed:true&format=json&size=5&fields=accession,id,protein_name,organism_name,length', H, '瘦身复验');
await probe('uniprot/gfp', 'https://rest.uniprot.org/uniprotkb/search?query=gfp+AND+reviewed:true&format=json&size=5&fields=accession,id,protein_name,organism_name,length', H, '强度');
// reliefweb v2
await probe('reliefweb/v2', 'https://api.reliefweb.int/v2/disasters?appname=search-core-probe&query%5Bvalue%5D=flood&limit=5', H, 'v2 复验');
await probe('reliefweb/v2-earthquake', 'https://api.reliefweb.int/v2/disasters?appname=search-core-probe&query%5Bvalue%5D=earthquake&limit=5', H, '强度');
// snapcraft v1 search 端点
await probe('snapcraft/v1-search', 'https://api.snapcraft.io/api/v1/snaps/search?q=firefox&series=16', { headers: { 'User-Agent': UA, 'Snap-Device-Series': '16' } }, 'v1 端点');
// BGG 401: 浏览器 UA 复试(应用层鉴权 vs TLS 指纹归因)
await probe('bgg/browser-UA', 'https://www.boardgamegeek.com/xmlapi2/search?query=catan&type=boardgame',
  { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' } }, '浏览器UA');
