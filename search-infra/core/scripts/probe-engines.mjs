/**
 * 临时探针: 逐引擎真实连通性验证(v0.3 扩池验收用, 不进测试套件)
 * 用法: npm run build && node scripts/probe-engines.mjs
 */
import { SearchCore } from "../dist/engine.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "sc-probe-"));
const core = new SearchCore({
  config: { dataDir: dir, timeoutMs: 12000 },
});

const CASES = [
  ["wikipedia", "vector database"],
  ["crossref", "attention transformer"],
  ["arxiv", "retrieval augmented generation"],
  ["openverse", "cat"], // 图片 kind=image
  ["mwmbl", "test"],
  ["googlenews", "人工智能", "zh-CN"],
  ["marginalia", "sqlite"],
  ["bingrss", "sqlite vector"],
  ["hn", "sqlite-vec"],
];

async function main() {
  for (const [engine, query, lang] of CASES) {
    const t0 = Date.now();
    try {
      const r = await core.search(query, { topN: 3, lang, engines: [engine], noCache: true });
      const ms = Date.now() - t0;
      if (r.refs.length === 0) {
        console.log(`✗ ${engine}: 0 refs (${ms}ms) failed=${r.meta.enginesFailed.map((f) => f.error.slice(0, 60)).join(";")}`);
        continue;
      }
      const first = r.refs[0];
      console.log(`✓ ${engine}: ${r.refs.length} refs ${ms}ms [${first.kind}] ${first.title.slice(0, 55)}`);
      console.log(`    ${first.url.slice(0, 100)}`);
    } catch (e) {
      console.log(`✗ ${engine}: ${(e).message.slice(0, 90)} (${Date.now() - t0}ms)`);
    }
  }
  rmSync(dir, { recursive: true, force: true });
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
