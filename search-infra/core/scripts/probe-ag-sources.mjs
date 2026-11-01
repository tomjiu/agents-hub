#!/usr/bin/env node
/**
 * Phase AG-1 探针第 2 批: 挂账重试(Open Library/Semantic Scholar/Qwant) + 新候选 6 项
 * 原始 JSON 只落 /tmp/phase-ag/（不入仓），此处只打印结论摘要; 结论抄入 docs/keyless-increments.md
 * 用法: node scripts/probe-ag-sources.mjs [name ...]
 */
import { writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";

const OUT = "/tmp/phase-ag";
mkdirSync(OUT, { recursive: true });

const UA = "search-core/0.9 (+https://github.com/mmqz/search-tool-rnd)";
const UA_BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const Q = "python asyncio tutorial";
const Q_ACADEMIC = "transformer attention mechanism";
const Q_NEWS = "semiconductor supply chain";
const Q_PKG = "requests";

async function probe(name, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    const ms = Date.now() - t0;
    await writeFile(`${OUT}/${name}.json`, JSON.stringify(r.raw ?? r.summary, null, 2)).catch(() => {});
    console.log(`${name.padEnd(22)} ${String(r.status).padEnd(4)} ${String(ms).padStart(5)}ms  ${r.summary}`);
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

const j = (o) => JSON.stringify(o);

const probes = {
  // 1. 挂账重试: Open Library(AB 沙箱网络失败)
  async "openlibrary-retry"() {
    const { res, ct, text } = await http(`https://openlibrary.org/search.json?q=${encodeURIComponent("the moonstone")}&fields=title,author_name,first_publish_year&limit=5`, { headers: { "User-Agent": UA } });
    let s = `ct=${ct}`;
    try {
      const d = JSON.parse(text);
      s = `docs=${d.docs?.length ?? 0} first="${d.docs?.[0]?.title ?? "-"}" numFound=${d.numFound ?? "-"}`;
    } catch {}
    return { status: res.status, summary: s, raw: { status: res.status, body: text.slice(0, 2000) } };
  },

  // 2. 挂账重试: Semantic Scholar(AB 429 — 当日限额; 换学术题重试)
  async "s2-retry"() {
    const { res, ct, text } = await http(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(Q_ACADEMIC)}&limit=5&fields=title,year,citationCount`, { headers: { "User-Agent": UA } });
    let s = `ct=${ct}`;
    try {
      const d = JSON.parse(text);
      s = `total=${d.total ?? "-"} data=${d.data?.length ?? 0} first="${d.data?.[0]?.title?.slice(0, 50) ?? "-"}" cites=${d.data?.[0]?.citationCount ?? "-"}`;
    } catch {}
    return { status: res.status, summary: s, raw: { status: res.status, body: text.slice(0, 2000) } };
  },

  // 3. 挂账重试: Qwant v3(AB 403 — 换浏览器头+Accept 全套)
  async "qwant-retry"() {
    const { res, ct, text } = await http(`https://api.qwant.com/v3/search/web?q=${encodeURIComponent(Q)}&locale=en_US&offset=0&count=10`, {
      headers: {
        "User-Agent": UA_BROWSER,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.qwant.com/",
        "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-site",
      },
    });
    let s = `ct=${ct} head=${text.slice(0, 60).replace(/\s+/g, " ")}`;
    try {
      const d = JSON.parse(text);
      const items = d?.data?.res?.items ?? {};
      s = `status-line=${d.status ?? "-"} mainline=${items.mainline?.length ?? 0} head="${items.mainline?.[0]?.items?.[0]?.url?.slice(0, 60) ?? "-"}"`;
    } catch {}
    return { status: res.status, summary: s, raw: { status: res.status, body: text.slice(0, 2000) } };
  },

  // 4. 新候选: GitLab 项目搜索 API(开发者资产, keyless)
  async "gitlab-api"() {
    const { res, ct, text } = await http(`https://gitlab.com/api/v4/projects?search=${encodeURIComponent("docker compose")}&per_page=5&order_by=stars`, { headers: { "User-Agent": UA } });
    let s = `ct=${ct}`;
    try {
      const d = JSON.parse(text);
      s = `arr=${d.length ?? 0} first="${d?.[0]?.path_with_namespace ?? "-"}" stars=${d?.[0]?.star_count ?? "-"} last="${d?.[d.length - 1]?.path_with_namespace ?? "-"}"`;
    } catch {}
    return { status: res.status, summary: s, raw: { status: res.status, body: text.slice(0, 3000) } };
  },

  // 5. 新候选: PyPI JSON API(包元数据垂直; 搜索端点已死, 只能按包名查)
  async "pypi-json"() {
    const { res, ct, text } = await http(`https://pypi.org/pypi/${Q_PKG}/json`, { headers: { "User-Agent": UA } });
    let s = `ct=${ct}`;
    try {
      const d = JSON.parse(text);
      s = `name="${d.info?.name}" ver=${d.info?.version} license="${(d.info?.license ?? "-").slice(0, 30)}" requires="${d.info?.requires_python ?? "-"}"`;
    } catch {}
    return { status: res.status, summary: s, raw: { status: res.status, body: text.slice(0, 1500) } };
  },

  // 6. 新候选: searchcode 代码搜索(keyless)
  async "searchcode"() {
    const { res, ct, text } = await http(`https://searchcode.com/api/codesearch_I/?q=${encodeURIComponent("asyncio gather")}&per_page=5`, { headers: { "User-Agent": UA } });
    let s = `ct=${ct}`;
    try {
      const d = JSON.parse(text);
      s = `total=${d.total ?? "-"} results=${d.results?.length ?? 0} first="${d.results?.[0]?.filename ?? "-"}@${d.results?.[0]?.repo?.slice(0, 40) ?? "-"}"`;
    } catch {}
    return { status: res.status, summary: s, raw: { status: res.status, body: text.slice(0, 2000) } };
  },

  // 7. 新候选: HuggingFace Papers 搜索(AI 论文, keyless)
  async "hf-papers"() {
    const { res, ct, text } = await http(`https://huggingface.co/api/papers/search?q=${encodeURIComponent(Q_ACADEMIC)}`, { headers: { "User-Agent": UA } });
    let s = `ct=${ct}`;
    try {
      const d = JSON.parse(text);
      s = `arr=${d.length ?? 0} first="${(d?.[0]?.title ?? d?.[0]?.paper?.title ?? "-").slice(0, 50)}" id=${d?.[0]?.id ?? d?.[0]?.paper?.id ?? "-"}`;
    } catch {}
    return { status: res.status, summary: s, raw: { status: res.status, body: text.slice(0, 2500) } };
  },

  // 8. 新候选: GDELT 新闻文档 API(新闻垂直, keyless)
  async "gdelt"() {
    const { res, ct, text } = await http(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(Q_NEWS)}&mode=artlist&format=json&maxrecords=5&timespan=7d`, { headers: { "User-Agent": UA } });
    let s = `ct=${ct}`;
    try {
      const d = JSON.parse(text);
      s = `articles=${d.articles?.length ?? 0} first="${(d.articles?.[0]?.title ?? "-").slice(0, 50)}" dom=${d.articles?.[0]?.domain ?? "-"}`;
    } catch {}
    return { status: res.status, summary: s, raw: { status: res.status, body: text.slice(0, 2500) } };
  },

  // 9. 新候选: Internet Archive advancedsearch(实体/资源, keyless; 与 timemachine 的 CDX API 不同)
  async "ia-advancedsearch"() {
    const { res, ct, text } = await http(`https://archive.org/advancedsearch.php?q=${encodeURIComponent('title:"the moonstone"')}&fl[]=identifier&fl[]=title&fl[]=year&rows=5&output=json`, { headers: { "User-Agent": UA } });
    let s = `ct=${ct}`;
    try {
      const d = JSON.parse(text);
      const docs = d?.response?.docs ?? [];
      s = `numFound=${d?.response?.numFound ?? "-"} docs=${docs.length} first="${docs[0]?.identifier ?? "-"}"`;
    } catch {}
    return { status: res.status, summary: s, raw: { status: res.status, body: text.slice(0, 2000) } };
  },
};

const only = process.argv.slice(2);
const results = [];
for (const [name, fn] of Object.entries(probes)) {
  if (only.length && !only.includes(name)) continue;
  results.push(await probe(name, fn));
}
console.log("\n=== SUMMARY ===");
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name} (${r.status}${r.err ? " " + r.err.slice(0, 50) : ""})`);
}
