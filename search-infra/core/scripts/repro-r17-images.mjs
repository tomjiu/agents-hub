#!/usr/bin/env node
/** 复现 r17 images 题 miss: 查该题引擎构成与 refs 来源 */
import { SearchCore } from "../dist/index.js";

const core = new SearchCore();
const s = await core.search("unsplash pexels free stock photos api comparison", { noCache: true, topN: 10 });
console.log("enginesUsed:", JSON.stringify(s.meta.enginesUsed));
console.log("elapsedMs:", s.meta.elapsedMs, "refs:", s.refs.length, "rescued:", s.meta.rescued ?? false);
const enginesOf = (r) => (r.engines ?? []).join("+") || "?";
for (const r of s.refs.slice(0, 10)) {
  console.log(`  ${r.url.slice(0, 80)}  [${enginesOf(r)}]`);
}
process.exit(0);
