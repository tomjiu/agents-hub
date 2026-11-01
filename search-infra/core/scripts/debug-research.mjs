import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../dist/config.js";
import { Cache } from "../dist/cache.js";
import { HealthTracker } from "../dist/providers/base.js";
import { Router } from "../dist/router.js";
import { Fetcher } from "../dist/fetcher.js";
import { ResearchLoop } from "../dist/research.js";

const QUERY = "vector database landscape";
const ANGLES = ["definition", "comparison"];
let urlCounter = 0;

const provider = {
  name: "fake", needsKey: false, isConfigured: () => true,
  async search(query) {
    const out = [];
    for (let i = 0; i < 2; i++) {
      urlCounter++;
      const n = urlCounter;
      out.push({
        url: `https://p.test/doc/${n}`,
        title: `${query} — doc ${n}`,
        snippet: `${query} overview part ${n}`,
        engines: ["fake"], rank: i + 1,
      });
    }
    return out;
  },
};

function pageFor(query, angle) {
  const words = [...new Set([...query.split(/\s+/), angle])].join(", ");
  const para = (k) =>
    `Paragraph ${k}: the ${words} discussion continues here with enough length to survive the quote threshold check easily. It mentions ${angle} of ${query} in detail number ${k}.`;
  return `<html><head><title>Doc</title></head><body><article>` +
    [1, 2, 3, 4].map(para).map((p) => `<p>${p}</p>`).join("") + `</article></body></html>`;
}

const dir = mkdtempSync(join(tmpdir(), "sc-dbg-"));
const cfg = loadConfig({
  dataDir: dir, engines: ["fake"], timeoutMs: 2000, ssrf: "off",
  x: { guestEnabled: false },
  research: { maxLoops: 3, minFacts: 3, referenceBudget: 50, fetchBudget: 10, fetchPerLoop: 4, strict: false },
});
const cache = new Cache(dir);
const health = new HealthTracker(cache);
const router = new Router({ config: cfg, health, cache, providers: [provider] });
const fetchImpl = (async (url) => {
  return new Response(pageFor(QUERY, "definition"), { status: 200, headers: { "Content-Type": "text/html" } });
});
const fetcher = new Fetcher(cfg, cache, undefined, fetchImpl);
const loop = new ResearchLoop({ config: cfg, router, fetcher, cache }, dir);

const r = await loop.run(QUERY, { angles: ANGLES, minFacts: 3, maxLoops: 3 }, (e) => {
  if (e.type === "fetch_error") console.log("FETCH_ERROR", JSON.stringify(e));
  if (e.type === "fetch_done") console.log("FETCH_DONE", JSON.stringify(e));
  if (e.type === "reflect") console.log("REFLECT", JSON.stringify(e.scores), "facts=", e.facts);
  if (e.type === "decide") console.log("DECIDE", e.decision);
});
console.log("stop:", JSON.stringify(r.stop));
console.log("facts:", r.facts.length, "fetchUsed:", r.stats.fetchUsed, "fetchErrors:", r.stats.fetchErrors);
console.log("first fact quote:", JSON.stringify((r.facts[0]?.quote ?? "").slice(0, 80)));
rmSync(dir, { recursive: true, force: true });
