#!/usr/bin/env node
/**
 * Phase AM 探针第 4 批: 类目级 keyless 官方面补齐(词典/医学研究/财务监管/数据/教育)
 *   + 通用面剩余候选(s.jina.ai keyless 复核 / searxng 实例链扩容 / mysql docs 池外闭环尝试)。
 * 候选 10 项(全部免 key; s.jina.ai 预期 401 只做诚实复核)。
 * 原始 JSON 只落 /tmp/phase-am/（不入仓），此处只打印结论摘要; 结论抄入 docs/keyless-increments.md。
 * 用法: node scripts/probe-am-sources.mjs [name ...]
 */
import { writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";

const OUT = "/tmp/phase-am";
mkdirSync(OUT, { recursive: true });

const UA = "search-core/0.9 (+https://github.com/mmqz/search-tool-rnd)";
// SEC 公平访问政策要求 UA 声明身份与联系方式(GitHub noreply 可达地址)
const UA_SEC = "search-core/0.9 (research; mmqz@users.noreply.github.com)";
const UA_BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function probe(name, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    const ms = Date.now() - t0;
    await writeFile(`${OUT}/${name}.json`, JSON.stringify(r.raw ?? r.summary, null, 2)).catch(() => {});
    console.log(`${name.padEnd(16)} ${String(r.status).padEnd(4)} ${String(ms).padStart(6)}ms  ${r.summary}`);
    return { name, ok: r.status >= 200 && r.status < 300, status: r.status, ms };
  } catch (e) {
    const ms = Date.now() - t0;
    const msg = String(e?.message ?? e).slice(0, 140);
    console.log(`${name.padEnd(16)} ERR ${String(ms).padStart(6)}ms  ${msg}`);
    await writeFile(`${OUT}/${name}.err.txt`, msg).catch(() => {});
    return { name, ok: false, status: 0, ms, err: msg };
  }
}

async function http(url, { method = "GET", headers = {}, body, timeoutMs = 15000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body, signal: ac.signal });
    const text = await res.text();
    return { res, text };
  } finally { clearTimeout(timer); }
}

const nOf = (a) => (Array.isArray(a) ? a.length : -1);

// ---------- 词典面 2 候选 ----------

// dictionaryapi.dev — 免 key 无注册, en 单语
async function dictionaryapi() {
  const { res, text } = await http("https://api.dictionaryapi.dev/api/v2/entries/en/serendipity", {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  const d = JSON.parse(text);
  const e0 = Array.isArray(d) ? d[0] : null;
  const defs = e0?.meanings?.[0]?.definitions ?? [];
  const raw = { status: res.status, shape: Array.isArray(d) ? "array" : typeof d, sample: e0 ? { word: e0.word, phonetic: e0.phonetic, pos: e0.meanings?.[0]?.partOfSpeech, def0: defs[0]?.definition, example: defs[0]?.example, sourceUrl: e0.sourceUrls?.[0] } : d };
  return { status: res.status, raw, summary: `entries=${nOf(d)} word=${e0?.word ?? "?"} def0=${(defs[0]?.definition ?? "").slice(0, 60)}` };
}

// Wiktionary API(en+zh 双查) — 词典/词源面, zh.wiktionary 覆盖中文词条
async function wiktionary() {
  const out = {};
  const one = async (host, q) => {
    const u = new URL(`https://${host}/w/api.php`);
    u.searchParams.set("action", "query");
    u.searchParams.set("format", "json");
    u.searchParams.set("list", "search");
    u.searchParams.set("srsearch", q);
    u.searchParams.set("srlimit", "3");
    const { res, text } = await http(u.href, { headers: { "User-Agent": UA, Accept: "application/json" } });
    const d = JSON.parse(text);
    const hits = d.query?.search ?? [];
    return { status: res.status, n: nOf(hits), titles: hits.map((h) => h.title).join("|"), snippet0: (hits[0]?.snippet ?? "").replace(/<[^>]+>/g, "").slice(0, 60) };
  };
  out.en = await one("en.wiktionary.org", "serendipity");
  out.zh = await one("zh.wiktionary.org", encodeURIComponent("塞翁失马").length ? "塞翁失马" : "serendipity");
  const raw = out;
  const ok = out.en.status === 200 && out.zh.status === 200;
  return { status: ok ? 200 : Math.max(out.en.status, out.zh.status), raw, summary: `en n=${out.en.n} [${out.en.titles}] / zh n=${out.zh.n} [${out.zh.titles}]` };
}

// ---------- 医学研究面 2 候选 ----------

// Europe PMC REST — 免 key, 生物医学文献聚合(PMID/DOI/OA 链接)
async function europepmc() {
  const u = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
  u.searchParams.set("query", "metformin cardiovascular outcomes randomized");
  u.searchParams.set("format", "json");
  u.searchParams.set("pageSize", "5");
  const { res, text } = await http(u.href, { headers: { "User-Agent": UA, Accept: "application/json" } });
  const d = JSON.parse(text);
  const rs = d.resultList?.result ?? [];
  const raw = { status: res.status, hitCount: d.hitCount, sample: rs.map((r) => ({ title: r.title?.slice(0, 70), pmid: r.pmid, doi: r.doi, oa: r.isOpenAccess, year: r.pubYear, src: r.source ?? r.bookOrReportDetails != null ? "book" : undefined })) };
  return { status: res.status, raw, summary: `hitCount=${d.hitCount} n=${nOf(rs)} t0=${(rs[0]?.title ?? "").slice(0, 60)} oa0=${rs[0]?.isOpenAccess}` };
}

// ClinicalTrials.gov API v2 — NLM 官方, 试验注册库
async function clinicaltrials() {
  const u = new URL("https://clinicaltrials.gov/api/v2/studies");
  u.searchParams.set("query.term", "metformin type 2 diabetes");
  u.searchParams.set("pageSize", "5");
  u.searchParams.set("fields", "NCTId,BriefTitle,OverallStatus,EnrollmentCount");
  const { res, text } = await http(u.href, { headers: { "User-Agent": UA, Accept: "application/json" } });
  const d = JSON.parse(text);
  const st = d.studies ?? [];
  const raw = { status: res.status, totalCount: d.totalCount, sample: st.map((s) => ({ nct: s.protocolSection?.identificationModule?.nctId, title: s.protocolSection?.identificationModule?.briefTitle?.slice(0, 70), status: s.protocolSection?.statusModule?.overallStatus })) };
  return { status: res.status, raw, summary: `total=${d.totalCount} n=${nOf(st)} nct0=${st[0]?.protocolSection?.identificationModule?.nctId ?? "?"}` };
}

// ---------- 财务监管面 1 候选 ----------

// SEC EDGAR full-text search — 免 key(UA 纪律), 上市公司申报文件
async function secedgar() {
  const u = new URL("https://efts.sec.gov/LATEST/search-index");
  u.searchParams.set("q", "\"annual report\"");
  u.searchParams.set("forms", "10-K");
  const { res, text } = await http(u.href, { headers: { "User-Agent": UA_SEC, Accept: "application/json" } });
  const d = JSON.parse(text);
  const hits = d.hits?.hits ?? [];
  const raw = { status: res.status, total: d.hits?.total?.value, sample: hits.slice(0, 5).map((h) => ({ id: h._id, display: h._source?.display_names?.[0], fileDate: h._source?.file_date, form: h._source?.form_type })) };
  return { status: res.status, raw, summary: `total=${d.hits?.total?.value ?? "?"} n=${nOf(hits)} id0=${hits[0]?._id ?? "?"} disp0=${(hits[0]?._source?.display_names?.[0] ?? "").slice(0, 50)}` };
}

// ---------- 数据面 1 候选 ----------

// World Bank API v2 — 免 key 官方指标数据(按已知指标码直取, pypi/CVE 纪律)
async function worldbank() {
  const u = new URL("https://api.worldbank.org/v2/country/CHN/indicator/NY.GDP.MKTP.CD");
  u.searchParams.set("format", "json");
  u.searchParams.set("per_page", "5");
  u.searchParams.set("date", "2020:2024");
  const { res, text } = await http(u.href, { headers: { "User-Agent": UA, Accept: "application/json" } });
  const d = JSON.parse(text);
  const rows = Array.isArray(d) ? d[1] ?? [] : [];
  const raw = { status: res.status, meta: Array.isArray(d) ? d[0] : d, sample: rows.map((r) => ({ date: r.date, value: r.value, country: r.country?.value, indicator: r.indicator?.id })) };
  return { status: res.status, raw, summary: `rows=${nOf(rows)} v2023=${rows.find((r) => r.date === "2023")?.value ?? "?"}` };
}

// ---------- 教育面 1 候选 ----------

// Google Books API — 免 key(country 参数必带, 否则部分地域 429)
async function gbooks() {
  const u = new URL("https://www.googleapis.com/books/v1/volumes");
  u.searchParams.set("q", "rust programming language");
  u.searchParams.set("maxResults", "5");
  u.searchParams.set("country", "US");
  const { res, text } = await http(u.href, { headers: { "User-Agent": UA, Accept: "application/json" } });
  const d = JSON.parse(text);
  const items = d.items ?? [];
  const raw = { status: res.status, totalItems: d.totalItems, sample: items.map((i) => ({ title: i.volumeInfo?.title, authors: i.volumeInfo?.authors, publisher: i.volumeInfo?.publisher, link: i.volumeInfo?.infoLink, categories: i.volumeInfo?.categories })) };
  return { status: res.status, raw, summary: `total=${d.totalItems ?? "?"} n=${nOf(items)} t0=${(items[0]?.volumeInfo?.title ?? "").slice(0, 60)}` };
}

// ---------- 通用面 3 候选 ----------

// s.jina.ai — 2024-11 起要求 API key, 免 key 预期 401(诚实复核, 用户明确不给任何 key)
async function sjina() {
  const { res, text } = await http("https://s.jina.ai/what%20is%20redis", {
    headers: { "User-Agent": UA, Accept: "application/json", "X-Respond-With": "no-content" },
  });
  const raw = { status: res.status, body: text.slice(0, 300) };
  return { status: res.status, raw, summary: `body0=${text.slice(0, 80).replace(/\n/g, " ")}` };
}

// SearXNG 实例链扩容(现 2 实例=search.mectov.my.id/sx.xo.st) — 候选 6 实例 JSON 存活探测
async function searxngExpand() {
  const candidates = [
    "https://searx.be",
    "https://search.inetol.net",
    "https://priv.au",
    "https://search.hbubli.cc",
    "https://baresearch.org",
    "https://opnxng.com",
  ];
  const out = [];
  for (const base of candidates) {
    const t0 = Date.now();
    try {
      const u = new URL(`${base}/search`);
      u.searchParams.set("q", "redis cache");
      u.searchParams.set("format", "json");
      const { res, text } = await http(u.href, { headers: { "User-Agent": UA_BROWSER, Accept: "application/json" }, timeoutMs: 8000 });
      let n = -1;
      try { n = nOf(JSON.parse(text).results); } catch { /* HTML 挑战页 */ }
      out.push({ base, status: res.status, ms: Date.now() - t0, jsonResults: n });
    } catch (e) {
      out.push({ base, status: 0, ms: Date.now() - t0, err: String(e?.message ?? e).slice(0, 60) });
    }
  }
  const alive = out.filter((o) => o.jsonResults > 0);
  return { status: alive.length > 0 ? 200 : 500, raw: out, summary: `alive ${alive.length}/${candidates.length}: ${alive.map((a) => `${a.base}(${a.jsonResults}r/${a.ms}ms)`).join(", ") || "none"}` };
}

// MySQL docs search — dev.mysql.com 池外诚实剩余的闭环尝试(有无可用搜索端点)
async function mysqldocs() {
  const { res, text } = await http("https://dev.mysql.com/doc/search/?q=window%20functions", {
    headers: { "User-Agent": UA_BROWSER, Accept: "text/html" },
  });
  const isHtml = text.includes("<html") || text.includes("<!DOCTYPE");
  // 数结果链接: /doc/refman/ 与 /doc/mysql-backend-excerpt/ 的 <a> 链
  const links = [...text.matchAll(/href="(\/doc\/[^"]+)"/g)].map((m) => m[1]);
  const uniq = [...new Set(links)];
  const hasResults = /results?/i.test(text) && uniq.some((l) => l.includes("refman"));
  const raw = { status: res.status, isHtml, uniqDocLinks: uniq.length, sampleLinks: uniq.slice(0, 8) };
  return { status: res.status, raw, summary: `html=${isHtml} docLinks=${uniq.length} refman=${uniq.some((l) => l.includes("refman"))}` };
}

// ---------- runner ----------

const ALL = {
  dictionaryapi, wiktionary, europepmc, clinicaltrials, secedgar,
  worldbank, gbooks, sjina, searxngExpand, mysqldocs,
};
const only = process.argv.slice(2);
const run = only.length ? only.filter((k) => ALL[k]) : Object.keys(ALL);

const results = [];
for (const k of run) results.push(await probe(k, ALL[k]));

console.log("\n==== SUMMARY ====");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.err ? ` (${r.err.slice(0, 60)})` : ""}`);
