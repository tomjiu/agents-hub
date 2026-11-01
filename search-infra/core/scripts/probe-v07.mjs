// v0.7 真网络探测: 8 个新注册表/垂直资产 provider + 域名路由端到端
// (semantic scholar 免 key 10s 超时 / lobsters 沙箱 TCP 不可达 — 均不实现, 见 targets-search.md)
import {
  crates, packagist, rubygems, huggingface, dockerhub, openalex, dblp, wikidata,
} from "../dist/providers/registries.js";
import { plan } from "../dist/planner.js";

const UA = "search-core/0.7 (https://github.com/mmqz/search-tool-rnd)";
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

await probe("crates", crates, "async runtime");
await probe("packagist", packagist, "http client");
await probe("rubygems", rubygems, "web scraping");
await probe("huggingface", huggingface, "whisper");
await probe("dockerhub", dockerhub, "postgres");
await probe("openalex", openalex, "retrieval augmented generation");
await probe("dblp", dblp, "vector database");
await probe("wikidata", wikidata, "Alan Turing");

// 域名路由端到端(仅 planner 层, 不真打引擎)
const d1 = plan("推荐一个 rust crate 做 http 请求");
console.log(JSON.stringify({ planner: "crate query", topic: d1.domainPlan?.topic, legs: d1.queries.length }));
const d2 = plan("docker 镜像 推荐 轻量 postgres");
console.log(JSON.stringify({ planner: "docker image query", topic: d2.domainPlan?.topic, legs: d2.queries.length }));
const d3 = plan("python asyncio 报错 asyncio.gather");
console.log(JSON.stringify({ planner: "programming query", topic: d3.domainPlan?.topic }));
const d4 = plan("上海今天天气");
console.log(JSON.stringify({ planner: "neutral query", topic: d4.domainPlan?.topic ?? null }));
