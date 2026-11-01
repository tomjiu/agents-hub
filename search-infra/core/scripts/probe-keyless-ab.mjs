#!/usr/bin/env node
/**
 * Phase AB 探针轮: 用户免 Key 清单 vs 现有源的差集(证据链脚本, 结论抄入 docs/keyless-increments.md)
 * 原始 JSON 落 /tmp/phase-ab/（不入仓），此处只打印结论摘要
 * 用法: node /home/z/my-project/scripts/probe-phase-ab.mjs [name ...]
 */
import { writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";

const OUT = "/tmp/phase-ab";
mkdirSync(OUT, { recursive: true });

const UA = "search-core/0.9 (+https://github.com/mmqz/search-tool-rnd)";
const UA_BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const Q = "python asyncio tutorial";
const Q2 = "crispr gene editing";

// ---------- 通用探针 ----------
async function probe(name, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    const ms = Date.now() - t0;
    await writeFile(`${OUT}/${name}.json`, JSON.stringify(r.raw ?? r.summary, null, 2)).catch(() => {});
    const line = `${name.padEnd(22)} ${String(r.status).padEnd(4)} ${String(ms).padStart(5)}ms  ${r.summary}`;
    console.log(line);
    return { name, ok: r.status >= 200 && r.status < 300, status: r.status, ms };
  } catch (e) {
    const ms = Date.now() - t0;
    const msg = String(e?.message ?? e).slice(0, 120);
    console.log(`${name.padEnd(22)} ERR ${String(ms).padStart(5)}ms  ${msg}`);
    await writeFile(`${OUT}/${name}.err.txt`, msg).catch(() => {});
    return { name, ok: false, status: 0, ms, err: msg };
  }
}

async function http(url, { method = "GET", headers = {}, body, timeoutMs = 9000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body, signal: ac.signal });
    const ct = res.headers.get("content-type") ?? "";
    const text = await res.text();
    return { res, ct, text };
  } finally { clearTimeout(timer); }
}

function shapeOf(text, ct) {
  if (!/json/i.test(ct)) {
    const head = text.slice(0, 150).replace(/\s+/g, " ");
    return `non-json ct=${ct} head="${head}"`;
  }
  try {
    const j2 = JSON.parse(text);
    if (Array.isArray(j2)) return `json array len=${j2.length}`;
    return `json keys=[${Object.keys(j2).slice(0, 8).join(",")}]`;
  } catch { return `json-parse-fail len=${text.length}`; }
}

const j = (o) => JSON.stringify(o);

// ---------- 各候选源 ----------

const probes = {
  // 1. Tavily keyless 模式（用户清单 ★：官方宣称支持）
  async "tavily-keyless"() {
    const { res, ct, text } = await http("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Tavily-Access-Mode": "keyless", "User-Agent": UA },
      body: j({ query: Q, max_results: 5 }),
    });
    let s = shapeOf(text, ct);
    try {
      const data = JSON.parse(text);
      if (data.results) s = `results=${data.results.length} first=${data.results[0]?.url?.slice(0, 60) ?? "-"}`;
    } catch {}
    return { status: res.status, summary: s, raw: { status: res.status, ct, body: text.slice(0, 4000) } };
  },

  // 2. Firecrawl keyless（POST /v2/search 无 Authorization）
  async "firecrawl-keyless"() {
    const { res, ct, text } = await http("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: j({ query: Q, limit: 5 }),
    });
    let s = shapeOf(text, ct);
    try {
      const data = JSON.parse(text);
      const web = data.data?.web ?? data.data?.results ?? data.results;
      if (web) s = `success=${data.success} results=${Array.isArray(web) ? web.length : "?"} first=${web?.[0]?.url?.slice(0, 60) ?? "-"}`;
      else s = `json keys=[${Object.keys(data).join(",")}] success=${data.success} err=${data.error ?? "-"}`;
    } catch {}
    return { status: res.status, summary: s, raw: { status: res.status, ct, body: text.slice(0, 4000) } };
  },

  // 3. Parallel 匿名 MCP（JSON-RPC initialize → tools/list）
  async "parallel-mcp"() {
    const base = "https://search.parallel.ai/mcp";
    const initBody = j({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "search-core-probe", version: "0.0.1" } },
    });
    const r1 = await http(base, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "User-Agent": UA },
      body: initBody,
    });
    const sid = r1.res.headers.get("mcp-session-id");
    let s = `init status=${r1.res.status} ct=${r1.ct.slice(0, 40)} session=${sid ? "yes" : "no"}`;
    let raw1 = r1.text.slice(0, 2500);
    if (r1.res.ok && sid) {
      const r2 = await http(base, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "User-Agent": UA, "Mcp-Session-Id": sid },
        body: j({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      });
      s += ` | tools/list=${r2.res.status}`;
      raw1 += "\n---tools/list---\n" + r2.text.slice(0, 2500);
    }
    return { status: r1.res.status, summary: s, raw: raw1 };
  },

  // 4. Qwant v3 非官方 API
  async "qwant-api"() {
    const u = new URL("https://api.qwant.com/v3/search/web");
    u.searchParams.set("q", Q);
    u.searchParams.set("count", "10");
    u.searchParams.set("locale", "en_US");
    u.searchParams.set("offset", "0");
    u.searchParams.set("device", "desktop");
    const { res, ct, text } = await http(u.href, {
      headers: { "User-Agent": UA_BROWSER, Accept: "application/json", Referer: "https://www.qwant.com/" },
    });
    let s = shapeOf(text, ct);
    try {
      const data = JSON.parse(text);
      const items = data?.data?.result?.items;
      const mainline = items?.mainline;
      if (mainline) {
        const webGroup = mainline.find((g) => g.type === "web");
        s = `status=${data.status} web items=${webGroup?.items?.length ?? 0} first=${webGroup?.items?.[0]?.url?.slice(0, 60) ?? "-"}`;
      }
    } catch {}
    return { status: res.status, summary: s, raw: { status: res.status, ct, body: text.slice(0, 3000) } };
  },

  // 5. AnySearch 匿名
  async "anysearch-anon"() {
    const { res, ct, text } = await http("https://api.anysearch.com/v1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: j({ query: Q }),
    });
    return { status: res.status, summary: shapeOf(text, ct), raw: { status: res.status, ct, body: text.slice(0, 2000) } };
  },

  // 6. Jina s.jina.ai（无 key 搜索）
  async "jina-search"() {
    const { res, ct, text } = await http(`https://s.jina.ai/${encodeURIComponent(Q)}`, {
      headers: { "User-Agent": UA, Accept: "text/plain" },
    });
    const urlCount = (text.match(/\]\(https?:\/\//g) ?? []).length;
    return { status: res.status, summary: `ct=${ct.slice(0, 30)} md-links=${urlCount} len=${text.length}`, raw: text.slice(0, 3000) };
  },

  // 7. PubMed eutils（esearch → esummary 两步）
  async "pubmed-eutils"() {
    const u1 = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
    u1.searchParams.set("db", "pubmed");
    u1.searchParams.set("term", Q2);
    u1.searchParams.set("retmode", "json");
    u1.searchParams.set("retmax", "5");
    const r1 = await http(u1.href, { headers: { "User-Agent": UA } });
    const ids = JSON.parse(r1.text)?.esearchresult?.idlist ?? [];
    let s = `esearch=${r1.res.status} ids=${ids.length}`;
    let raw = r1.text.slice(0, 1500);
    if (ids.length) {
      const u2 = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
      u2.searchParams.set("db", "pubmed");
      u2.searchParams.set("retmode", "json");
      u2.searchParams.set("id", ids.join(","));
      const r2 = await http(u2.href, { headers: { "User-Agent": UA } });
      const d2 = JSON.parse(r2.text)?.result;
      const first = d2?.[ids[0]];
      s += ` | esummary=${r2.res.status} title="${(first?.title ?? "").slice(0, 60)}"`;
      raw += "\n---esummary---\n" + r2.text.slice(0, 2500);
    }
    return { status: r1.res.status, summary: s, raw };
  },

  // 8. Semantic Scholar（无 key 免费层）
  async "semanticscholar"() {
    const u = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
    u.searchParams.set("query", Q2);
    u.searchParams.set("fields", "title,year,venue,citationCount,externalIds");
    u.searchParams.set("limit", "5");
    const { res, ct, text } = await http(u.href, { headers: { "User-Agent": UA, Accept: "application/json" } });
    let s = shapeOf(text, ct);
    try {
      const data = JSON.parse(text);
      if (data.data) s = `total=${data.total} first="${(data.data[0]?.title ?? "").slice(0, 60)}" year=${data.data[0]?.year}`;
    } catch {}
    return { status: res.status, summary: s, raw: { status: res.status, body: text.slice(0, 2500) } };
  },

  // 9/10. 用户实测仅存的开 JSON 公共 SearXNG 实例（独立复验）
  async "searxng-mectov"() {
    const { res, ct, text } = await http("https://search.mectov.my.id/search?q=test&format=json", { headers: { "User-Agent": UA, Accept: "application/json" } });
    let s = shapeOf(text, ct);
    try { const d = JSON.parse(text); s = `json results=${d.results?.length ?? 0}`; } catch {}
    return { status: res.status, summary: s, raw: { status: res.status, ct, body: text.slice(0, 1500) } };
  },
  async "searxng-xost"() {
    const { res, ct, text } = await http("https://sx.xo.st/search?q=test&format=json", { headers: { "User-Agent": UA, Accept: "application/json" } });
    let s = shapeOf(text, ct);
    try { const d = JSON.parse(text); s = `json results=${d.results?.length ?? 0}`; } catch {}
    return { status: res.status, summary: s, raw: { status: res.status, ct, body: text.slice(0, 1500) } };
  },

  // 11. sov2ex（V2EX 社区搜索, 中文面）
  async "sov2ex"() {
    const u = new URL("https://www.sov2ex.com/api/search");
    u.searchParams.set("q", "向量数据库");
    u.searchParams.set("size", "5");
    const { res, ct, text } = await http(u.href, { headers: { "User-Agent": UA, Accept: "application/json" } });
    let s = shapeOf(text, ct);
    try {
      const d = JSON.parse(text);
      if (d.hits) s = `total=${d.total} hits=${d.hits.length} first="${(d.hits[0]?._source?.title ?? "").slice(0, 50)}"`;
    } catch {}
    return { status: res.status, summary: s, raw: { status: res.status, body: text.slice(0, 2000) } };
  },

  // 12. Open Library（书籍垂直）
  async "openlibrary"() {
    const u = new URL("https://openlibrary.org/search.json");
    u.searchParams.set("q", "designing data intensive applications");
    u.searchParams.set("limit", "5");
    u.searchParams.set("fields", "title,author_name,first_publish_year,key");
    const { res, ct, text } = await http(u.href, { headers: { "User-Agent": UA, Accept: "application/json" } });
    let s = shapeOf(text, ct);
    try { const d = JSON.parse(text); s = `numFound=${d.numFound} first="${(d.docs?.[0]?.title ?? "").slice(0, 50)}"`; } catch {}
    return { status: res.status, summary: s, raw: { status: res.status, body: text.slice(0, 1500) } };
  },

  // 13. DDG Instant Answer（摘要层, 非 SERP）
  async "ddg-instant-answer"() {
    const u = new URL("https://api.duckduckgo.com/");
    u.searchParams.set("q", "who invented the web");
    u.searchParams.set("format", "json");
    u.searchParams.set("no_html", "1");
    const { res, ct, text } = await http(u.href, { headers: { "User-Agent": UA, Accept: "application/json" } });
    let s = shapeOf(text, ct);
    try {
      const d = JSON.parse(text);
      s = `Abstract="${(d.AbstractText ?? "").slice(0, 50)}" RelatedTopics=${d.RelatedTopics?.length ?? 0}`;
    } catch {}
    return { status: res.status, summary: s, raw: { status: res.status, body: text.slice(0, 1500) } };
  },

  // 14. Nominatim（地理垂直）
  async "nominatim"() {
    const u = new URL("https://nominatim.openstreetmap.org/search");
    u.searchParams.set("q", "Eiffel Tower");
    u.searchParams.set("format", "json");
    u.searchParams.set("limit", "3");
    const { res, ct, text } = await http(u.href, { headers: { "User-Agent": UA_BROWSER, Accept: "application/json" } });
    let s = shapeOf(text, ct);
    try { const d = JSON.parse(text); s = `json len=${d.length} first="${(d[0]?.display_name ?? "").slice(0, 50)}"`; } catch {}
    return { status: res.status, summary: s, raw: { status: res.status, body: text.slice(0, 1200) } };
  },

  // 15. Yep SERP（HTML 抓取可行性）
  async "yep-html"() {
    const { res, ct, text } = await http(`https://yep.com/web?q=${encodeURIComponent(Q)}`, { headers: { "User-Agent": UA_BROWSER } });
    const hrefs = (text.match(/href="(https?:\/\/[^"]+)"/g) ?? []).length;
    return { status: res.status, summary: `ct=${ct.slice(0, 30)} len=${text.length} http-links=${hrefs}`, raw: text.slice(0, 1500) };
  },

  // 16. Startpage SERP（反爬强度验证）
  async "startpage-html"() {
    const { res, ct, text } = await http(`https://www.startpage.com/sp/search?query=${encodeURIComponent(Q)}`, { headers: { "User-Agent": UA_BROWSER } });
    const blocked = /captcha|challenge|robot|verify/i.test(text.slice(0, 3000));
    return { status: res.status, summary: `ct=${ct.slice(0, 30)} len=${text.length} blocked-signals=${blocked}`, raw: text.slice(0, 1200) };
  },
};

// ---------- 执行 ----------
const args = process.argv.slice(2);
const names = args.length ? args : Object.keys(probes);
console.log(`Phase AB probe: ${names.length} candidates -> ${OUT}\n`);

// 分批并行, 批间 1s, 避免同 IP 猛打
const results = [];
for (let i = 0; i < names.length; i += 3) {
  const batch = names.slice(i, i + 3);
  const rs = await Promise.all(batch.map((n) => (probes[n] ? probe(n, probes[n]) : Promise.resolve({ name: n, ok: false, status: 0 }))));
  results.push(...rs);
  if (i + 3 < names.length) await new Promise((r) => setTimeout(r, 1000));
}

console.log("\n=== 汇总 ===");
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name} (${r.status}${r.err ? " " + r.err.slice(0, 60) : ""})`);
}

// ---------- 追加探针: 限流强度 + 形状复验(单独跑: node probe-phase-ab.mjs-rate) ----------
if (process.argv[2] === "-rate") {
  console.log("=== 限流强度探测 ===");
  // tavily keyless: 连打 6 发看第几发 429
  for (let i = 1; i <= 6; i++) {
    const t0 = Date.now();
    try {
      const r = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tavily-Access-Mode": "keyless", "User-Agent": UA },
        body: j({ query: `test query ${i}`, max_results: 3 }),
      });
      console.log(`tavily-keyless #${i}: ${r.status} ${Date.now() - t0}ms`);
    } catch (e) { console.log(`tavily-keyless #${i}: ERR ${String(e).slice(0, 60)}`); }
  }
  await new Promise((r) => setTimeout(r, 1000));
  // anysearch: 连打 6 发
  for (let i = 1; i <= 6; i++) {
    const t0 = Date.now();
    try {
      const r = await fetch("https://api.anysearch.com/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA },
        body: j({ query: `test query ${i}` }),
      });
      const t = await r.text();
      let extra = "";
      try { const d2 = JSON.parse(t); if (d2.code !== 0) extra = ` code=${d2.code} msg=${d2.message}`; } catch {}
      console.log(`anysearch #${i}: ${r.status} ${Date.now() - t0}ms${extra}`);
    } catch (e) { console.log(`anysearch #${i}: ERR ${String(e).slice(0, 60)}`); }
  }
  await new Promise((r) => setTimeout(r, 1000));
  // firecrawl: 连打 4 发
  for (let i = 1; i <= 4; i++) {
    const t0 = Date.now();
    try {
      const r = await fetch("https://api.firecrawl.dev/v2/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA },
        body: j({ query: `test query ${i}`, limit: 3 }),
      });
      console.log(`firecrawl #${i}: ${r.status} ${Date.now() - t0}ms`);
    } catch (e) { console.log(`firecrawl #${i}: ERR ${String(e).slice(0, 60)}`); }
  }
  // parallel tools/call 看结果形状
  console.log("\n=== parallel tools/call 形状 ===");
  try {
    const r1 = await fetch("https://search.parallel.ai/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "User-Agent": UA },
      body: j({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "search-core", version: "0.8.0" } } }),
    });
    const sid = r1.headers.get("mcp-session-id");
    const r2 = await fetch("https://search.parallel.ai/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "User-Agent": UA, "Mcp-Session-Id": sid },
      body: j({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    const r3 = await fetch("https://search.parallel.ai/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "User-Agent": UA, "Mcp-Session-Id": sid },
      body: j({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "web_search", arguments: { objective: "find python asyncio official docs", search_queries: ["python asyncio docs"] } } }),
    });
    const t3 = await r3.text();
    console.log(`tools/call status=${r3.status} len=${t3.length}`);
    await writeFile("/tmp/phase-ab/parallel-toolscall.json", t3.slice(0, 6000));
    console.log("head:", t3.slice(0, 800).replace(/\\n/g, " "));
  } catch (e) { console.log("parallel call ERR", String(e).slice(0, 100)); }
  // openlibrary 15s 重试
  console.log("\n=== openlibrary 重试 15s ===");
  const t0 = Date.now();
  try {
    const r = await fetch("https://openlibrary.org/search.json?q=designing+data+intensive+applications&limit=5&fields=title,author_name,first_publish_year,key", {
      headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000),
    });
    const t = await r.text();
    let s = "";
    try { const d2 = JSON.parse(t); s = `numFound=${d2.numFound} first="${d2.docs?.[0]?.title ?? ""}"`; } catch { s = `nonjson len=${t.length}`; }
    console.log(`openlibrary: ${r.status} ${Date.now() - t0}ms ${s}`);
  } catch (e) { console.log(`openlibrary: ERR ${String(e).slice(0, 80)}`); }
  process.exit(0);
}
