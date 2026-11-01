#!/usr/bin/env node
/**
 * Phase AJ 探针第 3 批: 攻 vs-zai 附录 G 诚实剩余「news/security 官方源召回面差距」。
 * 候选 7 项(全部免 key): NVD API 2.0(keyword+cveId 两查法) / OSV.dev(id 直查) /
 * CISA KEV feed(静态 JSON 本地过滤) / GitHub Advisory API(免 key) /
 * Google News RSS(复验+官方源出勤检查) / Bing News RSS(独立端点, bingrss 是 web 不是 news)。
 * 原始 JSON 只落 /tmp/phase-aj/（不入仓），此处只打印结论摘要; 结论抄入 docs/keyless-increments.md。
 * 用法: node scripts/probe-aj-sources.mjs [name ...]
 */
import { writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";

const OUT = "/tmp/phase-aj";
mkdirSync(OUT, { recursive: true });

const UA = "search-core/0.9 (+https://github.com/mmqz/search-tool-rnd)";
const UA_BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const Q_SEC = "log4j CVE-2021-44228 mitigation"; // vs-zai 24 题 security 面真题
const Q_NEWS = "EU AI Act implementation timeline latest news"; // vs-zai 24 题 news 面真题

async function probe(name, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    const ms = Date.now() - t0;
    await writeFile(`${OUT}/${name}.json`, JSON.stringify(r.raw ?? r.summary, null, 2)).catch(() => {});
    console.log(`${name.padEnd(20)} ${String(r.status).padEnd(4)} ${String(ms).padStart(6)}ms  ${r.summary}`);
    return { name, ok: r.status >= 200 && r.status < 300, status: r.status, ms };
  } catch (e) {
    const ms = Date.now() - t0;
    const msg = String(e?.message ?? e).slice(0, 140);
    console.log(`${name.padEnd(20)} ERR ${String(ms).padStart(6)}ms  ${msg}`);
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- security 面 4 候选 ----------

// NVD API 2.0 keywordSearch — keyless 限速 5 req/30s(滚窗), 探针只打 2 发间隔 6s
async function nvdKeyword() {
  const u = new URL("https://services.nvd.nist.gov/rest/json/cves/2.0");
  u.searchParams.set("keywordSearch", Q_SEC);
  u.searchParams.set("resultsPerPage", "5");
  const { res, text } = await http(u.href, { headers: { "User-Agent": UA, Accept: "application/json" } });
  const d = JSON.parse(text);
  const vulns = (d.vulnerabilities ?? []).map((v) => ({
    id: v.cve?.id, published: v.cve?.published,
    desc: (v.cve?.descriptions ?? []).find((x) => x.lang === "en")?.value?.slice(0, 120),
  }));
  await writeFile(`${OUT}/nvd-keyword.json`, JSON.stringify({ totalResults: d.totalResults, vulns }, null, 2));
  return { status: res.status, summary: `totalResults=${d.totalResults} first=${vulns[0]?.id ?? "-"}`, raw: vulns };
}

// NVD API 2.0 cveId 精确查 — 安全题常带 CVE 编号, 精查法零噪音
async function nvdCveId() {
  await sleep(6000); // keyless 滚窗 5/30s, 探针两发保持距离
  const u = new URL("https://services.nvd.nist.gov/rest/json/cves/2.0");
  u.searchParams.set("cveId", "CVE-2021-44228");
  const { res, text } = await http(u.href, { headers: { "User-Agent": UA, Accept: "application/json" } });
  const d = JSON.parse(text);
  const v = d.vulnerabilities?.[0]?.cve;
  return {
    status: res.status,
    summary: `found=${!!v} desc="${(v?.descriptions ?? [])[0]?.value?.slice(0, 80) ?? "-"}"`,
    raw: { id: v?.id, published: v?.published, refs: (v?.references?.length ?? 0) },
  };
}

// OSV.dev — POST /v1/query 按 id 直查(CVE id 应命中别名); 诚实边界: OSV 无关键词搜索端点
async function osvById() {
  const { res, text } = await http("https://api.osv.dev/v1/query", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/json" },
    body: JSON.stringify({ id: "CVE-2021-44228" }),
  });
  const d = JSON.parse(text);
  const v = d.vulns?.[0];
  return {
    status: res.status,
    summary: `found=${!!v} id=${v?.id ?? "-"} aliases=${(v?.aliases ?? []).length} refs=${(v?.references ?? []).length}`,
    raw: { id: v?.id, title: v?.title?.slice(0, 80), aliases: v?.aliases, refSample: (v?.references ?? []).slice(0, 3).map((r) => r.url) },
  };
}

// CISA KEV feed — 静态 JSON 全量下载(~2MB 量级), 实测体积/耗时, 本地过滤 log4j 验证可查性
async function cisaKev() {
  const { res, text } = await http(
    "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
    { headers: { "User-Agent": UA, Accept: "application/json" }, timeoutMs: 20000 },
  );
  const d = JSON.parse(text);
  const vs = d.vulnerabilities ?? [];
  const log4j = vs.filter((v) => /44228|log4shell|log4j/i.test(`${v.cveID} ${v.vendorProject} ${v.product}`));
  await writeFile(`${OUT}/cisa-kev-sample.json`, JSON.stringify(log4j, null, 2));
  return {
    status: res.status,
    summary: `bytes=${text.length} count=${d.count} titleCount=${vs.length} log4jHits=${log4j.length}`,
    raw: log4j[0],
  };
}

// GitHub Advisory API — 免 key(60/hr), cve_id 参数精查; 顺带看 unauth 限额响应头
async function ghsaApi() {
  const { res, text } = await http("https://api.github.com/advisories?cve_id=CVE-2021-44228", {
    headers: { "User-Agent": UA, Accept: "application/vnd.github+json" },
  });
  const d = JSON.parse(text);
  const a = Array.isArray(d) ? d[0] : null;
  return {
    status: res.status,
    summary: `count=${Array.isArray(d) ? d.length : "-"} ghsa=${a?.ghsa_id ?? "-"} sev=${a?.severity ?? "-"}`,
    raw: { ghsa_id: a?.ghsa_id, html_url: a?.html_url, severity: a?.severity },
  };
}

// ---------- news 面 3 候选 ----------

// Google News RSS — 复验现有 googlenews provider 端点; 检查官方源(europa.eu/gov)是否出勤
async function googlenewsAj() {
  const u = new URL("https://news.google.com/rss/search");
  u.searchParams.set("q", Q_NEWS);
  u.searchParams.set("hl", "en-US");
  u.searchParams.set("gl", "US");
  u.searchParams.set("ceid", "US:en");
  const { res, text } = await http(u.href, { headers: { "User-Agent": UA_BROWSER, Accept: "application/rss+xml, application/xml, text/xml" } });
  const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 10).map((m) => {
    const pick = (t) => m[1].match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "") ?? "";
    return { title: pick("title"), link: pick("link"), source: m[1].match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "") };
  });
  const domains = items.map((i) => { try { return new URL(i.link).hostname; } catch { return "?"; } });
  await writeFile(`${OUT}/googlenews-aj.json`, { items, domains }.valueOf ? JSON.stringify({ items, domains }, null, 2) : "{}");
  return {
    status: res.status,
    summary: `items=${items.length} domains=[${[...new Set(domains)].slice(0, 6).join(", ")}] govHit=${domains.some((d) => /europa\.eu|gov|aiact/i.test(d))}`,
    raw: { items },
  };
}

// Bing News RSS — 独立端点(/news/search, 与既有 bingrss 的 /search 不同)
async function bingnewsRss() {
  const u = new URL("https://www.bing.com/news/search");
  u.searchParams.set("q", Q_NEWS);
  u.searchParams.set("format", "RSS");
  const { res, text } = await http(u.href, { headers: { "User-Agent": UA_BROWSER, Accept: "application/rss+xml, application/xml, text/xml" } });
  const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 10).map((m) => ({
    title: m[1].match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, ""),
    link: m[1].match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim(),
  }));
  await writeFile(`${OUT}/bingnews-rss.json`, JSON.stringify({ items }, null, 2));
  return { status: res.status, summary: `items=${items.length} first="${items[0]?.title?.slice(0, 60) ?? "-"}"`, raw: { items } };
}

// ---------- 主流程 ----------
const candidates = {
  "nvd-keyword": nvdKeyword,
  "nvd-cveid": nvdCveId,
  "osv-byid": osvById,
  "cisa-kev": cisaKev,
  "ghsa-api": ghsaApi,
  "googlenews-aj": googlenewsAj,
  "bingnews-rss": bingnewsRss,
};

const filter = process.argv.slice(2);
const results = [];
for (const [name, fn] of Object.entries(candidates)) {
  if (filter.length && !filter.includes(name)) continue;
  results.push(await probe(name, fn));
  await sleep(1200); // 通用礼貌间隔
}
const ok = results.filter((r) => r.ok);
console.log(`\n=== ${ok.length}/${results.length} pass ===`);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.err ? `: ${r.err}` : ""}`);
