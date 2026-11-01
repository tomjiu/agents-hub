// 第 11 批探针轮 2: 幸存者形状深挖 + 红灯归因复验
const UA = 'Mozilla/5.0 (compatible; search-core/0.5; +https://github.com/mmqz/search-tool-rnd)';
const H = { headers: { 'User-Agent': UA, 'Accept': 'application/json' } };

async function hit(id, url, init = H, maxLen = 4000) {
  const t0 = Date.now();
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
    const res = await fetch(url, { ...init, signal: ac.signal });
    clearTimeout(timer);
    const ms = Date.now() - t0;
    const ct = res.headers.get('content-type') || '';
    const body = await res.text();
    console.log(`\n### ${id} — HTTP ${res.status} ${ms}ms ct=${ct} len=${body.length}`);
    if (ct.includes('json') && body.length > 0) {
      try {
        const j = JSON.parse(body);
        const s = JSON.stringify(j);
        console.log(s.length > maxLen ? s.slice(0, maxLen) + '…' : s);
      } catch { console.log('JSON parse fail:', body.slice(0, 200)); }
    } else {
      console.log(body.slice(0, maxLen));
    }
    return { status: res.status, body };
  } catch (e) {
    console.log(`\n### ${id} — FAIL ${Date.now() - t0}ms ${e.name}: ${e.message}`);
    return { status: 0, body: '' };
  }
}

// 红灯复验
await hit('imdbot-retry', 'https://search.imdbot.workers.dev/?q=inception');
await hit('imdbot-ua', 'https://search.imdbot.workers.dev/?q=dune',
  { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' } });
await hit('dictionaryapi-retry', 'https://api.dictionaryapi.dev/api/v2/entries/en/serendipity');

// mangadex 深挖: 英文标题/描述/外链/章节数
{
  const { body } = await hit('mangadex-raw', 'https://api.mangadex.org/manga?title=frieren&limit=2&includes[]=cover_art');
  try {
    const j = JSON.parse(body);
    const m = j.data?.[0];
    if (m) {
      console.log('\n--- mangadex attrs keys:', Object.keys(m.attributes).join(','));
      console.log('title:', JSON.stringify(m.attributes.title));
      console.log('altTitles[0..1]:', JSON.stringify((m.attributes.altTitles || []).slice(0, 2)));
      console.log('desc:', JSON.stringify(m.attributes.description).slice(0, 300));
      console.log('tags:', JSON.stringify((m.attributes.tags || []).map(t => t.attributes?.name?.en).slice(0, 5)));
      console.log('status/year/chapters:', m.attributes.status, m.attributes.year, m.attributes.lastChapter);
      console.log('relationships:', JSON.stringify((m.relationships || []).map(r => r.type)));
    }
  } catch {}
}
// mangadex 中文词面复验(批 10 wikivoyage 教训: CJK 词面)
await hit('mangadex-zh', 'https://api.mangadex.org/manga?title=' + encodeURIComponent('葬送的芙莉莲') + '&limit=3');

// lrclib: limit 参数与载荷控制
await hit('lrclib-limit', 'https://lrclib.net/api/search?q=shape+of+you&limit=5');
await hit('lrclib-cjk', 'https://lrclib.net/api/search?q=' + encodeURIComponent('晴天 周杰伦'));

// usgs: significant/minmagnitude 形状(意图解析型, 忽略 q 返回强震列表)
await hit('usgs-sig', 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=6&orderby=time&limit=5');
{
  const { body } = await hit('usgs-one', 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=6&orderby=time&limit=2');
  try {
    const f = JSON.parse(body).features?.[0];
    if (f) {
      console.log('\n--- usgs feature props:', JSON.stringify(f.properties));
      console.log('geom:', JSON.stringify(f.geometry));
    }
  } catch {}
}

// endoflife: all.json 载荷 + 产品提取复验
await hit('eol-all', 'https://endoflife.date/api/all.json', H, 300);
await hit('eol-go', 'https://endoflife.date/api/go.json', H, 600);
await hit('eol-products', 'https://endoflife.date/api/products.json', H, 400);

// pubchem: PUG REST 精确名属性查(单请求) + 病例
await hit('pubchem-prop', 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/glucose/property/MolecularFormula,MolecularWeight,IUPACName/JSON');
await hit('pubchem-prop-miss', 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/glucosxxx/property/MolecularFormula/JSON');
await hit('pubchem-syn', 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/aspirin/synonyms/JSON', H, 500);

// frankfurter: 错误形状 + 货币清单
await hit('frankfurter-bad', 'https://api.frankfurter.dev/v1/latest?base=XXX');
await hit('frankfurter-cur', 'https://api.frankfurter.dev/v1/currencies', H, 400);

// mankier: 更富查询看输出形状
await hit('mankier-tar', 'https://www.mankier.com/api/v2/explain/?q=tar+-xzvf+archive.tar.gz');

// rfc-editor: HTML 结果行结构
{
  const { body } = await hit('rfc-html', 'https://www.rfc-editor.org/search/rfc_search_detail.php?title=dns&sort=Number&pagesize=3');
  const m = body.match(/<table[\s\S]{0,200}?(?:result|search)[\s\S]{0,8000}?<\/table>/i);
  if (m) console.log('\n--- rfc table head:', m[0].replace(/\s+/g, ' ').slice(0, 1500));
  else {
    const rows = body.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    console.log(`\n--- rfc tr count=${rows.length}; first data row:`, (rows[1] || '').replace(/\s+/g, ' ').slice(0, 600));
  }
}
