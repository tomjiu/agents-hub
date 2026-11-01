/**
 * v0.5 冒烟探针: 时间机器双 provider(wayback/wikirev) + FTS5 缓存搜索面
 * 真实网络验证, 不进测试套件。
 * 用法: npm run build && node scripts/probe-v05.mjs
 */
import { SearchCore } from "../dist/engine.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "sc-probe-v05-"));
// CDX 大库查询 P95 常 >6s, wayback 场景软截止放宽到 12s(engines.md 有记录)
const core = new SearchCore({
  config: { dataDir: dir, timeoutMs: 20000, softDeadlineMs: 12000 },
});

async function probe(engine, query, lang) {
  const t0 = Date.now();
  try {
    const r = await core.search(query, { topN: 3, lang, engines: [engine], noCache: true });
    const ms = Date.now() - t0;
    if (r.refs.length === 0) {
      console.log(`✗ ${engine}: 0 refs (${ms}ms) failed=${r.meta.enginesFailed.map((f) => `${f.status}:${f.error.slice(0, 60)}`).join(";")}`);
      return;
    }
    const first = r.refs[0];
    console.log(`✓ ${engine}: ${r.refs.length} refs ${ms}ms [${first.kind}] ${first.title.slice(0, 60)}`);
    console.log(`    ${first.url.slice(0, 110)}`);
    console.log(`    ${first.snippet.slice(0, 110)}`);
  } catch (e) {
    console.log(`✗ ${engine}: threw ${String(e).slice(0, 90)} (${Date.now() - t0}ms)`);
  }
}

async function main() {
  console.log("== v0.5 时间机器双 provider(真实网络) ==");
  await probe("wayback", "https://www.wikipedia.org/");          // 查一个必然被存档的 URL
  await probe("wayback", "example.com");                          // 裸域名形态
  await probe("wikirev", "Rust (programming language)");          // 词条修订历史
  await probe("wikirev", "https://en.wikipedia.org/wiki/Python_(programming_language)"); // URL 输入形态

  console.log("\n== v0.5 FTS5 缓存即搜索面(离线) ==");
  // 先喂两页"抓过的页面"进缓存(直接调 putPage 模拟 fetch 结果)
  core.cache.putPage("https://a.io/rust-book", 200, "text/html", "Rust Book - Ownership",
    "The ownership system has three rules: each value has one owner, ownership transfers on move, borrow checker enforces lifetimes.");
  core.cache.putPage("https://a.io/sqlite", 200, "text/html", "SQLite FTS5 全文检索",
    "SQLite 的 FTS5 虚表支持 trigram 分词，中文三字以上子串检索可用，短词回落 LIKE。");
  const t0 = Date.now();
  const hitsEn = core.searchCache("borrow checker");
  const msEn = Date.now() - t0;
  console.log(`✓ cache-en: ${hitsEn.length} hit ${msEn}ms via=${hitsEn[0]?.via} → ${hitsEn[0]?.url ?? "-"}`);
  const t1 = Date.now();
  const hitsZh = core.searchCache("trigram 分词");
  console.log(`✓ cache-zh: ${hitsZh.length} hit ${Date.now() - t1}ms via=${hitsZh[0]?.via} → ${hitsZh[0]?.title ?? "-"}`);
  const hitsShort = core.searchCache("全文");
  console.log(`✓ cache-short(2char→LIKE): ${hitsShort.length} hit via=${hitsShort[0]?.via} → ${hitsShort[0]?.title ?? "-"}`);
  console.log(`  stats: ${JSON.stringify(core.stats().counters)}`);
  core.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
