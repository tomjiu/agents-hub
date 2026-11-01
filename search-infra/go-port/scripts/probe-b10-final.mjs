// 第 10 批轮 3(定案): 7 车道完整形状采黄金样本 + payload 尺寸
import { writeFileSync, mkdirSync } from 'fs';
const UA = 'Mozilla/5.0 (compatible; search-core/0.5; +https://github.com/mmqz/search-tool-rnd)';
const H = { headers: { 'User-Agent': UA } };
mkdirSync('/tmp/probe-b10/shapes', { recursive: true });

async function shape(id, url, init = H, pick = null) {
  const t0 = Date.now();
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15000);
    const res = await fetch(url, { ...init, signal: ac.signal });
    clearTimeout(timer);
    const body = await res.text();
    writeFileSync(`/tmp/probe-b10/shapes/${id}.json`, body);
    const j = JSON.parse(body);
    const item = pick ? pick(j) : (Array.isArray(j) ? j[0] : null);
    console.log(`[${id}] ${res.status} ${Date.now() - t0}ms size=${body.length}`);
    if (item) console.log(`  fields: ${Object.keys(item).slice(0, 25).join(',')}`);
    else console.log(`  top: ${JSON.stringify(j).slice(0, 200)}`);
    return j;
  } catch (e) {
    console.log(`[${id}] FAIL ${Date.now() - t0}ms: ${e.message}`.slice(0, 120));
    return null;
  }
}

const cocktail = await shape('thecocktaildb', 'https://www.thecocktaildb.com/api/json/v1/1/search.php?s=margarita', H, j => (j.drinks || [])[0]);
if (cocktail) console.log('  keys30+: ' + Object.keys(cocktail).filter(k => k.includes('str')).slice(0, 30).join(','));

await shape('wikivoyage', 'https://en.wikivoyage.org/w/api.php?action=query&list=search&srsearch=kyoto&format=json&srlimit=8', H, j => (j.query?.search || [])[0]);
await shape('uniprot', 'https://rest.uniprot.org/uniprotkb/search?query=insulin+AND+reviewed:true&format=json&size=5&fields=accession,id,protein_name,organism_name,length', H, j => (j.results || [])[0]);
await shape('openvsx', 'https://open-vsx.org/api/-/search?query=rust-analyzer&size=8', H, j => (j.extensions || [])[0]);
await shape('jetbrains-plugins', 'https://plugins.jetbrains.com/api/searchPlugins?search=kotlin&size=8', H, j => (j.plugins || [])[0]);
await shape('wp-plugins', 'https://api.wordpress.org/plugins/info/1.2/?action=query_plugins&request%5Bsearch%5D=seo&request%5Bper_page%5D=8', H, j => (j.plugins || [])[0]);
await shape('snapcraft', 'https://api.snapcraft.io/api/v1/snaps/search?q=firefox&series=16', { headers: { 'User-Agent': UA, 'Snap-Device-Series': '16' } }, j => (j._embedded?.['clickindex:package'] || [])[0]);
