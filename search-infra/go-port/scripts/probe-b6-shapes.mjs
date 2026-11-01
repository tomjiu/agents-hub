#!/usr/bin/env node
// 落 7 个已定案源的完整响应样本 → /tmp/probe-b6/shapes/ (golden fixture 素材)
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = '/tmp/probe-b6/shapes';
mkdirSync(OUT, { recursive: true });
const UA = 'search-core/0.5 (+https://github.com/mmqz/search-tool-rnd)';
const enc = encodeURIComponent;

const jobs = [
  ['nuget.json', `https://azuresearch-usnc.nuget.org/query?q=${enc('fluentvalidation')}&take=3`],
  ['hex.json', `https://hex.pm/api/packages?search=${enc('ecto')}`],
  ['arch.json', `https://archlinux.org/packages/search/json/?q=ripgrep`],
  ['inspirehep.json', `https://inspirehep.net/api/literature?q=${enc('neutrino oscillation')}&size=5&fields=titles,abstracts,authors,arxiv_eprints,dois,publication_info,citation_count`],
  ['openaire.json', `https://api.openaire.eu/search/publications?keywords=${enc('graph neural network')}&size=3&format=json`],
  ['commonswiki.json', `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${enc('mount fuji')}&gsrnamespace=6&gsrlimit=5&prop=imageinfo&iiprop=url&iiurlwidth=400&format=json&origin=*`],
  ['openmeteo-geo.json', `https://geocoding-api.open-meteo.com/v1/search?name=${enc('Tokyo')}&count=1&language=zh`],
  ['openmeteo-fc.json', `https://api.open-meteo.com/v1/forecast?latitude=35.6895&longitude=139.69171&current=temperature_2m,weather_code&timezone=auto`],
];

for (const [file, url] of jobs) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    const text = await res.text();
    writeFileSync(`${OUT}/${file}`, text);
    console.log(`${file} ${res.status} ${text.length}B`);
  } catch (e) { console.log(`${file} ERR ${e}`); }
  await new Promise((r) => setTimeout(r, 600));
}
console.log('shapes 已落 ' + OUT);
