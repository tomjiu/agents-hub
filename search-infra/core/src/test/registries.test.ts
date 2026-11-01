/**
 * v0.7 注册表与垂直资产层测试
 * - 8 个新 provider: 黄金样本解析(回归清单: 结构漂移必须报错而非静默空)
 * - URL 兜底分支(official 镜像/无 landing page/ee 优先/实体 URI)
 * - 错误分类: 空结果 → throw / http 429 → 分类
 * - 域名表新主题(packages/ai-models/devops/entities) + 表序(packages 先于 programming)
 * - planner 集成: 包意图查询 → packages 4 腿, 编程报错查询仍走 programming
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  crates, packagist, rubygems, huggingface, dockerhub, openalex, dblp, wikidata,
  pypi, hfpapers, nvd, osv, ghsa, extractCveId,
  wiktionary, europepmc, clinicaltrials, worldbank,
} from "../providers/registries.js";
import { lookupDomains, DOMAIN_TABLE } from "../domains.js";
import { plan } from "../planner.js";
import type { SearchCtx } from "../providers/base.js";
import type { SearchOptions } from "../types.js";

type AnyFetch = (url: string, init?: RequestInit) => Promise<Response>;

function ctxWith(body: string, contentType = "application/json", status = 200): { ctx: SearchCtx; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: AnyFetch = async (url, _init) => {
    calls.push(String(url));
    return new Response(body, { status, headers: { "Content-Type": contentType } });
  };
  const opts: SearchOptions = { maxResults: 10 };
  return {
    calls,
    ctx: { fetchImpl: fetchImpl as unknown as SearchCtx["fetchImpl"], signal: AbortSignal.timeout(5000), ua: "test", opts },
  };
}

// ---------- crates ----------

const CRATES_JSON = JSON.stringify({
  crates: [
    { id: "serde", name: "serde", default_version: "1.0.229", downloads: 1343835423,
      description: "Serde serialization framework", keywords: ["serialization", "json"],
      updated_at: "2026-07-18T23:05:13.266456Z" },
    { name: "serde_json", default_version: "1.0.145", downloads: 900000 },
  ],
});

test("crates: parse golden + version/downloads meta + crates.io URL", async () => {
  const { ctx, calls } = ctxWith(CRATES_JSON);
  const refs = await crates.search("serde", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://crates.io/crates/serde");
  assert.equal(refs[0].title, "serde@1.0.229");
  assert.ok(refs[0].snippet.includes("1343835423 downloads"));
  assert.ok(refs[0].snippet.includes("kw: serialization"));
  // v0.8 质量评测 case-4: 长自然语言查询按 downloads 排, 头部包不再被字面匹配小众包挤掉
  assert.ok(calls[0].includes("sort=downloads"), "crates 请求应带 sort=downloads");
  assert.ok(refs[0].published?.startsWith("2026-07-18"));
  assert.ok(calls[0].includes("crates.io/api/v1/crates"));
  assert.ok(calls[0].includes("q=serde"));
});

test("crates: empty -> throws (no silent empty)", async () => {
  const { ctx } = ctxWith(JSON.stringify({ crates: [] }));
  await assert.rejects(() => crates.search("zzqqxx", ctx), /no results parsed/);
});

// ---------- packagist ----------

const PACKAGIST_JSON = JSON.stringify({
  total: 42,
  results: [
    { name: "guzzlehttp/guzzle", description: "Guzzle is a PHP HTTP client library",
      url: "https://packagist.org/packages/guzzlehttp/guzzle", downloads: 1089478617, favers: 24310 },
    { name: "psr/http-client", description: "Common interface for HTTP clients" },
  ],
});

test("packagist: parse golden + downloads/favers meta + url fallback", async () => {
  const { ctx, calls } = ctxWith(PACKAGIST_JSON);
  const refs = await packagist.search("http client", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://packagist.org/packages/guzzlehttp/guzzle");
  assert.ok(refs[0].snippet.includes("24310★"));
  assert.equal(refs[1].url, "https://packagist.org/packages/psr/http-client"); // url 缺失兜底拼
  assert.ok(calls[0].includes("packagist.org/search.json"));
});

test("packagist: empty -> throws", async () => {
  const { ctx } = ctxWith(JSON.stringify({ results: [] }));
  await assert.rejects(() => packagist.search("zzqqxx", ctx), /no results parsed/);
});

// ---------- rubygems ----------

const RUBYGEMS_JSON = JSON.stringify([
  { name: "rails", version: "8.1.3.1", info: "Ruby on Rails is a full-stack web framework",
    downloads: 1234567890, project_uri: "https://rubygems.org/gems/rails" },
  { name: "sinatra", version: "4.1.1", info: "Classic web framework", downloads: 100 },
]);

test("rubygems: parse golden + project_uri + name fallback", async () => {
  const { ctx, calls } = ctxWith(RUBYGEMS_JSON);
  const refs = await rubygems.search("web framework", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://rubygems.org/gems/rails");
  assert.equal(refs[0].title, "rails@8.1.3.1");
  assert.ok(refs[0].snippet.includes("1234567890 downloads"));
  assert.equal(refs[1].url, "https://rubygems.org/gems/sinatra");
  assert.ok(calls[0].includes("rubygems.org/api/v1/search.json"));
});

// ---------- huggingface ----------

const HF_JSON = JSON.stringify([
  { id: "openai/whisper-large-v3", likes: 6221, downloads: 4972119,
    pipeline_tag: "automatic-speech-recognition", createdAt: "2023-11-06T09:02:58.000Z" },
  { id: "meta-llama/Llama-3.3-70B-Instruct", likes: 5000, downloads: 100, pipeline_tag: undefined },
]);

test("huggingface: parse golden + downloads-sorted meta + hf URL", async () => {
  const { ctx, calls } = ctxWith(HF_JSON);
  const refs = await huggingface.search("whisper", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://huggingface.co/openai/whisper-large-v3");
  assert.ok(refs[0].snippet.includes("4972119 downloads"));
  assert.ok(refs[0].snippet.includes("6221♥"));
  assert.ok(refs[0].snippet.includes("automatic-speech-recognition"));
  assert.ok(calls[0].includes("sort=downloads")); // 默认按下载量排序
  assert.ok(calls[0].includes("limit=10"));
});

test("huggingface: empty -> throws", async () => {
  const { ctx } = ctxWith(JSON.stringify([]));
  await assert.rejects(() => huggingface.search("zzqqxx", ctx), /no results parsed/);
});

// ---------- dockerhub ----------

const DOCKERHUB_JSON = JSON.stringify({
  count: 292042,
  results: [
    { repo_name: "nginx", repo_owner: "", short_description: "Official build of Nginx.",
      star_count: 21369, pull_count: 13324268098, is_official: true },
    { repo_name: "nginx", repo_owner: "bitnami", is_official: false, star_count: 100, pull_count: 50 },
    { repo_name: "orphan", repo_owner: "", is_official: false }, // 无主非官方 → library 兜底
    { repo_name: "rapidfort/postgresql-official", repo_owner: "", is_official: false }, // repo_name 自带 namespace → 不再加前缀(实测 404 bug)
  ],
});

test("dockerhub: parse golden + official/_/r/ URL branches", async () => {
  const { ctx, calls } = ctxWith(DOCKERHUB_JSON);
  const refs = await dockerhub.search("nginx", ctx);
  assert.equal(refs.length, 4);
  assert.equal(refs[0].url, "https://hub.docker.com/_/nginx"); // official 走 _/
  assert.equal(refs[0].title, "library/nginx");
  assert.ok(refs[0].snippet.includes("official"));
  assert.equal(refs[1].url, "https://hub.docker.com/r/bitnami/nginx"); // 用户镜像走 r/
  assert.equal(refs[2].url, "https://hub.docker.com/r/library/orphan"); // 无主兜底 library
  assert.equal(refs[3].url, "https://hub.docker.com/r/rapidfort/postgresql-official"); // 自带 namespace 不叠加前缀
  assert.equal(refs[3].title, "rapidfort/postgresql-official");
  assert.ok(calls[0].includes("hub.docker.com/v2/search/repositories"));
});

test("dockerhub: empty -> throws", async () => {
  const { ctx } = ctxWith(JSON.stringify({ count: 0, results: [] }));
  await assert.rejects(() => dockerhub.search("zzqqxx", ctx), /no results parsed/);
});

// ---------- openalex ----------

const OPENALEX_JSON = JSON.stringify({
  meta: { count: 567193 },
  results: [
    { display_name: "Attention Is All You Need", doi: "https://doi.org/10.48550/arXiv.1706.03762",
      publication_year: 2017, publication_date: "2017-06-12", cited_by_count: 99999, type: "article",
      primary_location: { landing_page_url: "https://arxiv.org/abs/1706.03762",
        source: { display_name: "arXiv" } },
      authorships: [{ author: { display_name: "Ashish Vaswani" } }, { author: { display_name: "Noam Shazeer" } },
        { author: { display_name: "Niki Parmar" } }],
      open_access: { is_oa: true, oa_url: "https://arxiv.org/pdf/1706.03762" } },
    { display_name: "No-URL Work", doi: "10.1000/xyz", cited_by_count: 1 }, // 全缺 → doi.org 兜底
  ],
});

test("openalex: parse golden + citations/venue/authors meta + url ladder", async () => {
  const { ctx, calls } = ctxWith(OPENALEX_JSON);
  const refs = await openalex.search("attention transformer", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://arxiv.org/abs/1706.03762"); // landing_page 优先
  assert.ok(refs[0].snippet.includes("99999 citations"));
  assert.ok(refs[0].snippet.includes("arXiv"));
  assert.ok(refs[0].snippet.includes("Ashish Vaswani, Noam Shazeer")); // 只取前 2 作者
  assert.ok(refs[0].published?.startsWith("2017-06-12"));
  assert.equal(refs[1].url, "https://doi.org/10.1000/xyz"); // doi 兜底
  assert.ok(calls[0].includes("api.openalex.org/works"));
  assert.ok(!calls[0].includes("mailto=")); // 未配 contactEmail 时不拼 mailto
});

test("openalex: http 429 -> rate-limited classification", async () => {
  const { ctx } = ctxWith("too many", "text/plain", 429);
  await assert.rejects(() => openalex.search("x", ctx), /http 429/);
});

// ---------- dblp ----------

const DBLP_JSON = JSON.stringify({
  result: { hits: { hit: [
    { info: { title: "Attention Is All You Need", url: "https://dblp.org/rec/conf/nips/VaswaniSPUJGKP17",
      ee: "https://arxiv.org/abs/1706.03762", venue: "NeurIPS", year: "2017",
      authors: { author: [{ text: "Ashish Vaswani" }, { text: "Noam Shazeer" }, { text: "Niki Parmar" }] } } },
    { info: { title: "Solo Paper", url: "https://dblp.org/rec/x", venue: "VLDB", year: "2020",
      authors: { author: { text: "Solo Author" } } } },
    { info: { title: "No Authors Paper", url: "https://dblp.org/rec/y", year: "2021" } },
  ] } },
});

test("dblp: parse golden + ee 优先 + 单作者对象归一化 + venue/year meta", async () => {
  const { ctx, calls } = ctxWith(DBLP_JSON);
  const refs = await dblp.search("attention", ctx);
  assert.equal(refs.length, 3);
  assert.equal(refs[0].url, "https://arxiv.org/abs/1706.03762"); // ee 优先于 dblp 页
  assert.ok(refs[0].snippet.includes("NeurIPS · 2017"));
  assert.ok(refs[0].snippet.includes("Ashish Vaswani, Noam Shazeer"));
  assert.ok(refs[1].snippet.includes("Solo Author")); // 单对象(非数组)归一化
  assert.equal(refs[2].url, "https://dblp.org/rec/y"); // 无 ee 用 url
  assert.ok(refs[0].published?.startsWith("2017"));
  assert.ok(calls[0].includes("dblp.org/search/publ/api"));
  assert.ok(calls[0].includes("format=json"));
});

test("dblp: empty hits -> throws", async () => {
  const { ctx } = ctxWith(JSON.stringify({ result: { hits: { hit: [] } } }));
  await assert.rejects(() => dblp.search("zzqqxx", ctx), /no results parsed/);
});

// ---------- wikidata ----------

const WIKIDATA_JSON = JSON.stringify({
  searchinfo: { search: "einstein" },
  search: [
    { id: "Q937", label: "Albert Einstein", description: "theoretical physicist",
      concepturi: "http://www.wikidata.org/entity/Q937" },
    { id: "Q16834800", label: "Einstein" }, // 无 description/concepturi
  ],
});

test("wikidata: parse golden + Q-id 标题 + description + concepturi 兜底", async () => {
  const { ctx, calls } = ctxWith(WIKIDATA_JSON);
  const refs = await wikidata.search("einstein", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "http://www.wikidata.org/entity/Q937");
  assert.equal(refs[0].title, "Albert Einstein (Q937)");
  assert.ok(refs[0].snippet.includes("theoretical physicist"));
  assert.equal(refs[1].url, "https://www.wikidata.org/wiki/Q16834800"); // concepturi 缺失兜底
  assert.ok(refs[1].snippet.includes("(no description)"));
  assert.ok(calls[0].includes("action=wbsearchentities"));
  assert.ok(calls[0].includes("language=en")); // 默认 lang
});

// ---------- 域名表新主题 + 表序 ----------

test("domains: packages hit -> 语义无语言信号时全 5 腿(AG-1 +pypi), npm 信号时单腿", () => {
  // v0.8 质量评测 case-4 后: 腿按语言信号裁剪(rust 查询不再空跑 npm 腿)
  const r = lookupDomains("推荐一个好用的 npm 包 做 schema validation");
  assert.ok(r);
  assert.equal(r.topic, "packages"); // packages 先于 programming: " npm " 宽词不得截胡包意图
  assert.deepEqual(r.apiProviders, ["npm"]); // npm 信号 → 单腿(原 4 腿全开浪费且错位)
  const rNoSignal = lookupDomains("包管理器哪个好用");
  assert.ok(rNoSignal && rNoSignal.topic === "packages");
  assert.deepEqual(rNoSignal.apiProviders, ["npm", "crates", "packagist", "rubygems", "pypi"]); // 无信号全腿兜底
});

test("domains: rust crate 查询走 packages 而非 programming", () => {
  const r = lookupDomains("rust crate for async http client");
  assert.ok(r);
  assert.equal(r.topic, "packages");
});

test("domains: programming 仍赢编程报错类查询(npm install 报错)", () => {
  const r = lookupDomains("npm install 报错 EACCES 怎么修");
  assert.ok(r);
  assert.equal(r.topic, "programming"); // "npm install" 是编程关键词, packages 关键词不匹配
});

test("domains: ai-models hit -> huggingface", () => {
  const r = lookupDomains("找个支持中文的 开源模型 做 asr");
  assert.ok(r);
  assert.equal(r.topic, "ai-models");
  assert.deepEqual(r.apiProviders, ["huggingface"]);
});

test("domains: devops hit -> dockerhub", () => {
  const r = lookupDomains("轻量级 nginx docker 镜像 推荐");
  assert.ok(r);
  assert.equal(r.topic, "devops");
  assert.deepEqual(r.apiProviders, ["dockerhub"]);
});

test("domains: entities hit -> wikidata; 中英都行", () => {
  const r1 = lookupDomains("Elon Musk 是谁");
  assert.ok(r1);
  assert.equal(r1.topic, "entities");
  const r2 = lookupDomains("founder of OpenAI background");
  assert.ok(r2);
  assert.equal(r2.topic, "entities");
});

test("domains: academic 现为 7 腿(AG-1 +hfpapers)", () => {
  const r = lookupDomains("transformer 架构 论文 原文");
  assert.ok(r);
  assert.equal(r.topic, "academic");
  assert.deepEqual(r.apiProviders, ["arxiv", "crossref", "openalex", "dblp", "pubmed", "wikipedia", "hfpapers"]);
});

test("domains: 表完整性 — 新主题的 provider 名全部已注册(防手误)", () => {
  // 与 router.ts buildProviders 名单对齐的注册名全集
  const registered = new Set([
    "searxng", "duckduckgo", "mojeek", "yahoo", "marginalia", "hn", "wikipedia", "bingrss",
    "arxiv", "crossref", "openverse", "mwmbl", "googlenews", "wayback", "wikirev", "wiby", "keenable",
    "stackexchange", "npm", "crates", "packagist", "rubygems", "huggingface", "dockerhub",
    "openalex", "dblp", "wikidata", "brave", "tavily", "exa", "github", "mdn",
    "anysearch", "firecrawl", "pubmed", "sov2ex", // phase AB
    "nominatim", // phase AD (geo 主题)
    "pypi", "hfpapers", // phase AG-1 (packages 元数据直取 / academic AI 论文面)
    "nvd", "osv", "ghsa", "bingnews", // phase AJ (security CVE 三腿 / news RSS 腿)
    "wiktionary", "europepmc", "clinicaltrials", "worldbank", // phase AM (dictionary/medical/data 官方面)
  ]);
  for (const [topic, def] of Object.entries(DOMAIN_TABLE)) {
    for (const p of def.apiProviders) {
      assert.ok(registered.has(p), `topic ${topic} 引用未注册 provider: ${p}`);
    }
  }
});

// ---------- planner 集成 ----------

test("planner: 包意图查询 → packages api 腿(语言信号裁剪后 npm 单腿, 无 site 腿)", () => {
  const d = plan("推荐一个 npm 包 做 schema validation");
  assert.ok(d.domainPlan);
  assert.equal(d.domainPlan.topic, "packages");
  assert.deepEqual(d.domainPlan.apiProviders, ["npm"]); // v0.8 语言腿裁剪: npm 信号单腿(原 4)
  assert.equal(d.queries.length, 1); // 无 siteTargets → 只有第 0 腿
});

test("planner: 中性查询不误路由", () => {
  const d = plan("今天上海天气怎么样");
  assert.equal(d.domainPlan ?? null, null); // planner 未命中时不设 domainPlan 字段
});

// ---------- phase AD: nominatim (geo 主题) ----------

import { nominatim } from "../providers/registries.js";

const NOMINATIM_JSON = JSON.stringify([
  { place_id: 1, osm_type: "way", osm_id: 123, lat: "31.23", lon: "121.47",
    display_name: "上海, 中国", type: "city", class: "place", importance: 0.9 },
  { place_id: 2, osm_type: "node", osm_id: 456, lat: "31.24", lon: "121.48",
    display_name: "外滩, 上海", type: "attraction", class: "tourism", importance: 0.5 },
]);

test("nominatim: golden 解析 → OSM 对象链接 + geo kind", async () => {
  const { ctx, calls } = ctxWith(NOMINATIM_JSON);
  const refs = await nominatim.search("上海 在哪", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://www.openstreetmap.org/way/123");
  assert.equal(refs[0].kind, "geo");
  assert.ok(refs[0].snippet.includes("place/city"));
  assert.ok(refs[0].snippet.includes("31.23,121.47"));
  assert.ok(calls[0].includes("nominatim.openstreetmap.org/search"));
  assert.ok(calls[0].includes("format=jsonv2"));
});

test("nominatim: 空结果是合法空(非地点查询不抛错不伤熔断, geo 关键词守门在 domains 层)", async () => {
  const { ctx } = ctxWith("[]");
  const refs = await nominatim.search("python asyncio 教程", ctx);
  assert.deepEqual(refs, []);
});

test("nominatim: http 500 抛错(进熔断分类)", async () => {
  const { ctx } = ctxWith("oops", "text/html", 500);
  await assert.rejects(() => nominatim.search("x", ctx), /nominatim http 500/);
});

test("geo 主题路由: 在哪/坐标类查询进 nominatim+wikidata 腿, 人口/首都仍走 entities", () => {
  const geo = lookupDomains("北京故宫 在哪");
  assert.equal(geo?.topic, "geo");
  assert.deepEqual([...geo.apiProviders].sort(), ["nominatim", "wikidata"]);
  const ent = lookupDomains("北京 人口");
  assert.equal(ent?.topic, "entities", "实体语义不被 geo 截胡(表序 entities 先于 geo)");
  const decision = plan("故宫 坐标 是多少");
  assert.equal(decision.route, "domain");
  assert.equal(decision.domainPlan?.topic, "geo");
});

// ---------- phase AG-1: pypi(包元数据直取+license) / hfpapers(HF Papers) ----------

const PYPI_JSON = JSON.stringify({
  info: {
    name: "requests", version: "2.34.2", license: "Apache-2.0",
    summary: "Python HTTP for Humans.", requires_python: ">=3.10",
  },
  urls: [{ upload_time: "2026-05-19T10:00:00Z" }],
});

test("pypi: 包名查询 golden + license 字段透传(AG-4) + pypi.org URL", async () => {
  const { ctx, calls } = ctxWith(PYPI_JSON);
  const refs = await pypi.search("Requests", ctx); // 大小写归一
  assert.equal(refs.length, 1);
  assert.equal(refs[0].url, "https://pypi.org/project/requests/");
  assert.equal(refs[0].title, "requests@2.34.2");
  assert.equal(refs[0].license, "Apache-2.0");
  assert.ok(refs[0].snippet.includes("license: Apache-2.0"));
  assert.ok(refs[0].snippet.includes("Python HTTP for Humans."));
  assert.ok(refs[0].published?.startsWith("2026-05-19"));
  assert.ok(calls[0].includes("pypi.org/pypi/requests/json"), "应请求 JSON API 端点");
});

test("pypi: 非包名查询(含空格) → 合法空零请求(搜索端点已死的诚实边界)", async () => {
  const { ctx, calls } = ctxWith(PYPI_JSON);
  const refs = await pypi.search("python http client library", ctx);
  assert.deepEqual(refs, []);
  assert.equal(calls.length, 0, "不应发出任何请求");
});

test("pypi: 404 包不存在 → 合法空(不交熔断); 形状漂移(info.name 缺) → 抛错", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });
  }) as unknown as SearchCtx["fetchImpl"];
  const ctx404: SearchCtx = { fetchImpl, signal: AbortSignal.timeout(5000), ua: "test", opts: { maxResults: 10 } };
  assert.deepEqual(await pypi.search("zzqqxx-not-a-pkg", ctx404), []);

  const { ctx } = ctxWith(JSON.stringify({ info: { version: "1.0" } }));
  await assert.rejects(() => pypi.search("foo", ctx), /no results parsed/);
});

const HFPAPERS_JSON = JSON.stringify([
  { paper: { id: "2601.11618", title: "Geometric Attention: A Regime-Explicit Operator",
    summary: "GA specifies an attention layer by four independent inputs.",
    publishedAt: "2026-01-10T13:43:01.000Z" } },
  { paper: { id: "2501.99999", title: "Sparse Attention Revisited" } },
  { garbage: true }, // 缺 paper 字段的条目应被过滤
]);

test("hfpapers: 嵌套 paper 形状 golden + hf papers URL + 坏条目过滤", async () => {
  const { ctx, calls } = ctxWith(HFPAPERS_JSON);
  const refs = await hfpapers.search("attention mechanism", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://huggingface.co/papers/2601.11618");
  assert.equal(refs[0].title, "Geometric Attention: A Regime-Explicit Operator");
  assert.ok(refs[0].snippet.includes("arXiv:2601.11618"));
  assert.ok(refs[0].snippet.includes("four independent inputs"));
  assert.ok(refs[0].published?.startsWith("2026-01-10"));
  assert.ok(calls[0].includes("huggingface.co/api/papers/search"), "应请求 papers search API");
});

test("hfpapers: 空结果 → 抛错(no silent empty); 缺 title 的 paper 条目过滤后空也抛", async () => {
  const { ctx } = ctxWith(JSON.stringify([]));
  await assert.rejects(() => hfpapers.search("zzqqxx", ctx), /no results parsed/);
  const { ctx: ctx2 } = ctxWith(JSON.stringify([{ paper: { id: "1" } }]));
  await assert.rejects(() => hfpapers.search("zzqqxx", ctx2), /no results parsed/);
});

test("domains: AG-1 ' paper' 关键词 — en 学术题进 academic 腿, newspaper/whitepaper 不误伤", () => {
  const r = lookupDomains("transformer attention mechanism paper");
  assert.ok(r && r.topic === "academic");
  assert.ok(r.apiProviders.includes("hfpapers"));
  assert.equal(lookupDomains("today newspaper headlines"), null); // 无前导空格不匹配
  assert.equal(lookupDomains("whitepaper download best practices"), null);
});

// ---------- phase AJ: 安全三腿(CVE 编号元数据直取) + news lane 路由 ----------

const NVD_JSON = JSON.stringify({
  vulnerabilities: [{
    cve: {
      id: "CVE-2021-44228", published: "2021-12-10T10:15:00Z",
      descriptions: [{ lang: "en", value: "Apache Log4j2 2.0-beta9 through 2.15.0 JNDI remote code execution. Fix in 2.15.0." }],
      metrics: { cvssMetricV31: [{ cvssData: { baseScore: 10 } }] },
    },
  }],
});

const OSV_JSON = JSON.stringify({
  id: "CVE-2021-44228", summary: "Remote code execution in Log4j",
  details: "Apache Log4j2 <=2.14.1 JNDI features allow RCE.",
  aliases: ["GHSA-jfh8-c2jp-5v3q"], modified: "2026-08-01T00:00:00Z",
});

const GHSA_JSON = JSON.stringify([{
  ghsa_id: "GHSA-jfh8-c2jp-5v3q", html_url: "https://github.com/advisories/GHSA-jfh8-c2jp-5v3q",
  summary: "Remote code execution in Log4j", severity: "critical",
  published_at: "2021-12-10T00:00:00Z", cvss: { score: 10 },
}]);

test("extractCveId: 大小写归一 + 无编号返回 null", () => {
  assert.equal(extractCveId("log4j cve-2021-44228 mitigation"), "CVE-2021-44228");
  assert.equal(extractCveId("CVE-2024-3094"), "CVE-2024-3094");
  assert.equal(extractCveId("xz vulnerability backdoor"), null); // 无编号
  assert.equal(extractCveId("cve-202-12"), null); // 年份位数不够不误配
});

test("nvd: CVE 编号 golden — nvd.nist.gov 详情页 URL + CVSS 透传", async () => {
  const { ctx, calls } = ctxWith(NVD_JSON, "application/json");
  const refs = await nvd.search("log4j CVE-2021-44228 mitigation", ctx);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].url, "https://nvd.nist.gov/vuln/detail/CVE-2021-44228");
  assert.ok(refs[0].title.startsWith("CVE-2021-44228:"));
  assert.ok(refs[0].snippet.includes("CVSS 10"));
  assert.ok(refs[0].snippet.includes("Log4j2"));
  assert.ok(calls[0].includes("cveId=CVE-2021-44228"), "应请求 cveId 精查参数");
});

test("nvd: 无编号 → 合法空零请求; 404 → 合法空(编号不存在)", async () => {
  const { ctx, calls } = ctxWith(NVD_JSON, "application/json");
  assert.deepEqual(await nvd.search("log4j vulnerability mitigation", ctx), []);
  assert.equal(calls.length, 0, "无编号不应发请求");
  const fetch404 = (async () => new Response("nf", { status: 404 })) as unknown as SearchCtx["fetchImpl"];
  const ctx404: SearchCtx = { fetchImpl: fetch404, signal: AbortSignal.timeout(5000), ua: "test", opts: { maxResults: 10 } };
  assert.deepEqual(await nvd.search("CVE-1999-9999", ctx404), []);
});

test("osv: GET /v1/vulns/{id} golden — osv.dev 人读页 URL + aliases 进 snippet", async () => {
  const { ctx, calls } = ctxWith(OSV_JSON, "application/json");
  const refs = await osv.search("log4j CVE-2021-44228 mitigation", ctx);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].url, "https://osv.dev/vulnerability/CVE-2021-44228");
  assert.ok(refs[0].snippet.includes("GHSA-jfh8-c2jp-5v3q"));
  assert.ok(refs[0].published?.startsWith("2026-08-01"));
  assert.ok(String(calls[0]).includes("api.osv.dev/v1/vulns/CVE-2021-44228"));
});

test("osv: 无编号合法空零请求; 形状漂移(id 缺)抛错", async () => {
  const { ctx, calls } = ctxWith(OSV_JSON, "application/json");
  assert.deepEqual(await osv.search("openssl security advisory", ctx), []);
  assert.equal(calls.length, 0);
  const { ctx: ctx2 } = ctxWith(JSON.stringify({ summary: "x" }), "application/json");
  await assert.rejects(() => osv.search("CVE-2021-44228", ctx2), /no results parsed/);
});

test("ghsa: advisory golden — github.com/advisories URL + severity; 空数组=合法空; 403 交熔断", async () => {
  const { ctx } = ctxWith(GHSA_JSON, "application/json");
  const refs = await ghsa.search("CVE-2021-44228", ctx);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].url, "https://github.com/advisories/GHSA-jfh8-c2jp-5v3q");
  assert.ok(refs[0].snippet.includes("severity: critical"));

  const { ctx: ctxEmpty } = ctxWith("[]", "application/json");
  assert.deepEqual(await ghsa.search("CVE-1999-0001", ctxEmpty), []); // GHSA 未收录 = 合法空

  const fetch403 = (async () => new Response("rate limited", { status: 403 })) as unknown as SearchCtx["fetchImpl"];
  const ctx403: SearchCtx = { fetchImpl: fetch403, signal: AbortSignal.timeout(5000), ua: "test", opts: { maxResults: 10 } };
  await assert.rejects(() => ghsa.search("CVE-2021-44228", ctx403), /http 403/);
});

// ---------- phase AM: 词典/医学研究/数据 官方面(探针第 4 批) ----------

const WIKTIONARY_JSON = JSON.stringify({
  query: { search: [
    { title: "ubiquity", snippet: `The state or quality of being <span class="searchmatch">ubiquitous</span>; presence everywhere`, wordcount: 210 },
    { title: "ubiquitous", snippet: `Omnipresent; <span class="searchmatch">seeming to be</span> everywhere at once`, wordcount: 340 },
  ] },
});

test("wiktionary: golden — search API 解析 + snippet 去 HTML + wiki 直链", async () => {
  const { ctx, calls } = ctxWith(WIKTIONARY_JSON);
  const refs = await wiktionary.search("ubiquitous meaning", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://en.wiktionary.org/wiki/ubiquity");
  assert.ok(refs[0].snippet.startsWith("[wiktionary]"));
  assert.ok(!refs[0].snippet.includes("<span"), "HTML 标签必须剥离");
  assert.ok(calls[0].includes("en.wiktionary.org"), "英文查询走 en 站点");
});

test("wiktionary: CJK 查询 → zh.wiktionary; 零命中合法空", async () => {
  const { ctx, calls } = ctxWith(WIKTIONARY_JSON);
  await wiktionary.search("塞翁失马 什么意思", ctx);
  assert.ok(calls[0].includes("zh.wiktionary.org"), "中文查询走 zh 站点");
  const empty = ctxWith(JSON.stringify({ query: { search: [] } }));
  assert.deepEqual(await wiktionary.search("xqzvwk 什么意思", empty.ctx), []);
});

const EPMC_JSON = JSON.stringify({ resultList: { result: [
  { title: "Metformin and cardiovascular outcomes", authorString: "A. Smith, B. Lee",
    journalTitle: "Lancet", pubYear: "2023", pmid: "37100000", doi: "10.1000/x", isOpenAccess: "Y" },
  { title: "No id row", pubYear: "2022" },
] } });

test("europepmc: golden — MED 直链 + 作者/期刊/OA 元数据透传", async () => {
  const { ctx } = ctxWith(EPMC_JSON);
  const refs = await europepmc.search("metformin cardiovascular randomized", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://europepmc.org/article/MED/37100000");
  assert.equal(refs[1].url, "https://europepmc.org"); // 无 pmid/pmcid/doi 兜底
  assert.ok(refs[0].snippet.includes("Lancet"));
  assert.ok(refs[0].snippet.includes("OA"));
  assert.equal(refs[0].published, "2023-01-01");
});

test("europepmc: 零命中合法空", async () => {
  const { ctx } = ctxWith(JSON.stringify({ resultList: { result: [] } }));
  assert.deepEqual(await europepmc.search("zzz nonexist trial", ctx), []);
});

const CT_JSON = JSON.stringify({ studies: [
  { protocolSection: {
      identificationModule: { nctId: "NCT02338921", briefTitle: "Metformin in Type 2 Diabetes" },
      statusModule: { overallStatus: "COMPLETED" },
      conditionsModule: { conditions: ["Type 2 Diabetes"] },
  } },
] });

test("clinicaltrials: golden — NCT 直链 + 状态/适应症元数据", async () => {
  const { ctx } = ctxWith(CT_JSON);
  const refs = await clinicaltrials.search("metformin type 2 diabetes", ctx);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].url, "https://clinicaltrials.gov/study/NCT02338921");
  assert.equal(refs[0].title, "Metformin in Type 2 Diabetes");
  assert.ok(refs[0].snippet.includes("COMPLETED"));
});

test("clinicaltrials: 零命中/缺 NCT 合法空", async () => {
  const empty = ctxWith(JSON.stringify({ studies: [] }));
  assert.deepEqual(await clinicaltrials.search("zzz nonexist", empty.ctx), []);
  const noNct = ctxWith(JSON.stringify({ studies: [{ protocolSection: { identificationModule: {} } }] }));
  assert.deepEqual(await clinicaltrials.search("whatever", noNct.ctx), []);
});

const WB_ROWS = JSON.stringify([
  { page: 1, pages: 1 },
  [
    { date: "2024", value: 18729668435848, country: { id: "CN", value: "China" }, indicator: { id: "NY.GDP.MKTP.CD", value: "GDP (current US$)" } },
    { date: "2023", value: 18270356654533, country: { id: "CN", value: "China" }, indicator: { id: "NY.GDP.MKTP.CD", value: "GDP (current US$)" } },
  ],
]);

test("worldbank: golden — 指标+国家映射直取 + data.worldbank.org 直链", async () => {
  const { ctx, calls } = ctxWith(WB_ROWS);
  const refs = await worldbank.search("world bank gdp china", ctx);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].url, "https://data.worldbank.org/indicator/NY.GDP.MKTP.CD?locations=CN");
  assert.ok(refs[0].title.includes("China"));
  assert.ok(refs[0].title.includes("GDP"));
  assert.ok(refs[0].snippet.includes("2024"));
  assert.ok(calls[0].includes("/country/CN/indicator/NY.GDP.MKTP.CD"));
});

test("worldbank: 无已知指标 → 合法空零请求(pypi/CVE 纪律); 无国家默认 WLD", async () => {
  const none = ctxWith("[]");
  assert.deepEqual(await worldbank.search("world bank open data api docs", none.ctx), []);
  assert.equal(none.calls.length, 0, "未知指标必须零请求");
  const world = ctxWith(WB_ROWS);
  await worldbank.search("world bank gdp 2023", world.ctx);
  assert.ok(world.calls[0].includes("/country/WLD/"), "无国家 → WLD 兜底");
});
