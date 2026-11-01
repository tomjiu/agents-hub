// 第 9 批黄金样本落盘: fixture 全部取自实弹响应, 不靠记忆
import fs from 'fs';
const UA = 'Mozilla/5.0 (compatible; search-core/0.5; +https://github.com/mmqz/search-tool-rnd)';
const jobs = [
  ['coingecko', 'https://api.coingecko.com/api/v3/search?query=bitcoin'],
  ['themealdb', 'https://www.themealdb.com/api/json/v1/1/search.php?s=chicken'],
  ['kitsu', 'https://kitsu.io/api/edge/anime?filter[text]=cowboy%20bebop&page[limit]=8'],
  ['thesportsdb', 'https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=Los%20Angeles%20Lakers'],
  ['standardebooks', 'https://standardebooks.org/ebooks?query=sherlock'],
];
for (const [id, url] of jobs) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    const b = await r.text();
    fs.writeFileSync('/tmp/probe-b9/shapes/' + id + '.body', b);
    console.log(id, r.status, b.length + 'b');
  } catch (e) {
    console.log(id, 'FAIL', String(e.cause?.code || e.message).slice(0, 60));
  }
}
