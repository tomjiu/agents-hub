// v0.6 真网络探测: stackexchange / npm 两个新 Tier1 provider + 域名路由端到端
import { stackexchange, npm } from "../dist/providers/keyless-apis.js";
import { plan } from "../dist/planner.js";

const UA = "search-core/0.6 (https://github.com/mmqz/search-tool-rnd)";
const ctxOf = (maxResults = 5) => ({
  fetchImpl: fetch,
  signal: AbortSignal.timeout(12000),
  ua: UA,
  opts: { maxResults },
});

async function probe(name, provider, query) {
  const t0 = Date.now();
  try {
    const refs = await provider.search(query, ctxOf());
    console.log(JSON.stringify({
      name, ok: true, ms: Date.now() - t0, n: refs.length,
      first: refs[0] ? { title: refs[0].title.slice(0, 60), url: refs[0].url.slice(0, 70) } : null,
    }));
  } catch (e) {
    console.log(JSON.stringify({ name, ok: false, ms: Date.now() - t0, err: String(e).slice(0, 100) }));
  }
}

await probe("stackexchange", stackexchange, "python asyncio gather exception handling");
await probe("npm", npm, "schema validation typescript");

// 域名路由端到端(仅 planner 层, 不真打引擎)
const d1 = plan("python asyncio 报错 asyncio.gather");
console.log(JSON.stringify({ planner: "python query", topic: d1.domainPlan?.topic, legs: d1.queries.length }));
const d2 = plan("上海今天天气");
console.log(JSON.stringify({ planner: "neutral query", topic: d2.domainPlan?.topic ?? null }));
