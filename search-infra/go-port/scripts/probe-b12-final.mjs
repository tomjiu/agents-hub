// 第 12 批探针轮 3: 定案 + 黄金样本(/tmp/probe-b12/shapes/)
// 幸存者: openreview/inaturalist/openfoodfacts/pubdev + gitlab 质量裁决
// 裁决依据: golden 样本形状喂 lanes_b12_test.go fixtures, 不靠记忆
const UA = 'Mozilla/5.0 (compatible; search-core/0.5; +https://github.com/mmqz/search-tool-rnd)';
import { writeFileSync } from 'node:fs';

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
    let parsed = null;
    if (res.status === 200) {
      try { parsed = JSON.parse(body); } catch {}
      if (parsed) {
        const arr = Array.isArray(parsed) ? parsed : (parsed.notes || parsed.results || parsed.products || parsed.packages || []);
        const it = Array.isArray(parsed) ? parsed[0] : (arr && arr[0]) || parsed;
        for (const k of Object.keys(it || {}).slice(0, 16)) {
          const v = JSON.stringify(it[k]);
          console.log(`  .${k} = ${v && v.length > 140 ? v.slice(0, 140) + '…' : v}`);
        }
        if (it && it.content) {
          console.log('  content keys:', Object.keys(it.content).join(','));
          for (const k of ['title', 'summary', 'TLDR', 'venue', 'authors']) {
            if (it.content[k]) console.log(`  content.${k} = ${JSON.stringify(it.content[k]).slice(0, 200)}`);
          }
        }
      } else {
        console.log(body.slice(0, 400).replace(/\s+/g, ' '));
      }
    } else {
      console.log(body.slice(0, 250).replace(/\s+/g, ' '));
    }
    if (t.save && body && body.length < 400000) {
      writeFileSync(`/tmp/probe-b12/shapes/${t.save}.json`, body);
      console.log(`  [golden saved: /tmp/probe-b12/shapes/${t.save}.json]`);
    }
    return parsed;
  } catch (e) {
    console.log(`\n### ${t.id} — ${t.name}`);
    console.log(`FAIL ${Date.now() - t0}ms ${e.name}: ${e.message}`);
    return null;
  }
}

// ---- openreview: 轮 2 返回的是 Official_Review 笔记; 深挖 content 字段(title/summary/venue) + CJK ----
await probe({ id: 'openreview-final', name: 'OpenReview 定案(ml+limit=5)', url: 'https://api2.openreview.net/notes/search?term=retrieval+augmented+generation&limit=5',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } }, save: 'openreview-rag' });
await probe({ id: 'openreview-cjk', name: 'OpenReview CJK 词面(强化学习)', url: 'https://api2.openreview.net/notes/search?term=%E5%BC%BA%E5%8C%96%E5%AD%A6%E4%B9%A0&limit=5',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } });

// ---- inaturalist: 定案样本 + rank 字段全貌 ----
await probe({ id: 'inaturalist-final', name: 'OpenReview→iNaturalist 定案(falcon)', url: 'https://api.inaturalist.org/v1/taxa?q=falcon&per_page=5',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } }, save: 'inaturalist-falcon' });

// ---- openfoodfacts: 定案样本 + CJK 词面 ----
await probe({ id: 'openfoodfacts-final', name: 'OpenFoodFacts 定案(nutella)', url: 'https://world.openfoodfacts.org/api/v2/search?search_terms=nutella&page_size=5&fields=product_name,brands,url,quantity',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } }, save: 'openfoodfacts-nutella' });
await probe({ id: 'openfoodfacts-cjk', name: 'OpenFoodFacts CJK(牛奶)', url: 'https://world.openfoodfacts.org/api/v2/search?search_terms=%E7%89%9B%E5%A5%B6&page_size=5&fields=product_name,brands,url,quantity',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } });

// ---- pubdev: 定案样本(搜索+详情两腿) ----
await probe({ id: 'pubdev-search-final', name: 'pub.dev 定案(ocr)', url: 'https://pub.dev/api/search?q=ocr',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } }, save: 'pubdev-search-ocr' });
const sr = await probe({ id: 'pubdev-detail-final', name: 'pub.dev 详情定案(google_mlkit_text_recognition 不得法→取搜索首位)', url: 'https://pub.dev/api/packages/flutter_riverpod',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } });

// ---- gitlab 质量裁决: 热门项目首位是否权威 + 慢方差 ----
await probe({ id: 'gitlab-quality', name: 'GitLab 质量裁决(docker)', url: 'https://gitlab.com/api/v4/projects?search=docker&per_page=5&simple=true',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } });
await probe({ id: 'gitlab-quality2', name: 'GitLab 质量裁决(gitlab 本尊)', url: 'https://gitlab.com/api/v4/projects?search=gitlab&per_page=5&simple=true',
  init: { headers: { 'User-Agent': UA, 'Accept': 'application/json' } } });
