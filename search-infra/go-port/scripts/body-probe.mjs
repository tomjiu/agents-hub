// body-probe.mjs — 批 31: D 桶正文层探针 (b30 候选①, miss 结构最大桶 48.7% 的定界问题)
// 问题: D 桶 miss (top-20 title+snippet 无严格 gold) 的 rank1-3 页面正文里有没有答案?
//   D1 = 正文有答案 — snippet 层缺失: 页面对了, 摘要字段没带证据 (b19 注入层漏抓/漏注入的可救空间)
//   D2 = 正文无答案 — 真召回缺失: 语料/召回问题, 排序/注入都救不了 (召回侧工程的定界证据)
//   ERR = fetch 失败/超时/反爬/非 HTML (单列, 不进 D1/D2 分母)
// 子类: nogold=top-20 全无证据页 | deep=严格 gold 在 11-20 (池深问题, pool 扩容候选定量)
// 口径: 匹配器与 eval 逐字一致(hay 侧小写契约); 正文剥 HTML 取文本上限 1.5M chars;
//       命中句带 query 内容词重叠标记(rel)供裁决 — tokenAND 命中可能是导航/相关文章等偶然词面。
// 注意: dump 采集时 b19 答案抓取已在线上跑过(SC_ANSWER_TOPN 缺省 5) — D1 实为 b19 残余漏抓,
//       不是"注入层未覆盖"的抽象空间, 解读时必须带上这层。
// 用法: node scripts/body-probe.mjs --dataset nq|triviaqa [--top 3] [--conc 4]
// 输出: stdout 汇总 + /tmp/eval-rerank/body-probe-{ds}.json(断点续跑) + body-probe-{ds}.txt(逐案明细)
import fs from "node:fs";
import { junkReason } from "./junk-gold.mjs";

const argStr = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const argOf = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? parseInt(process.argv[i + 1], 10) : d; };
const DS = argStr("--dataset", "nq");
const TOPN = argOf("--top", 3);
const CONC = argOf("--conc", 4);
const DUMP = DS === "nq" ? "/tmp/eval-rerank/nq-dump.jsonl" : "/tmp/eval-rerank/triviaqa-dump.jsonl";
const OUT_JSON = `/tmp/eval-rerank/body-probe-${DS}.json`;
const OUT_TXT = `/tmp/eval-rerank/body-probe-${DS}.txt`;

// ---------- 匹配器(与 eval-external.mjs 逐字一致; hay 侧小写是调用方契约 — b29 教训) ----------
const STOP = new Set(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "season", "seasons", "episode", "episodes", "the", "and", "was", "were", "has", "have", "had"]);
function matchEvidence(hay, answers) {
  for (const a of answers) {
    const al = a.toLowerCase();
    if (al.length > 1 && hay.includes(al)) return { ans: a, type: "verbatim" };
  }
  for (const a of answers) {
    const toks = a.toLowerCase().split(/[^a-z0-9]+/).filter(t => t && ((t.length >= 4 && !STOP.has(t)) || /^\d+$/.test(t)));
    if (toks.length === 0) continue;
    if (toks.every(t => hay.includes(t))) return { ans: a, type: "tokenAND" };
  }
  return null;
}

// ---------- D 桶识别(与 analyze-suppression 分桶逐字对齐) ----------
const rows = fs.readFileSync(DUMP, "utf8").trim().split("\n").map(JSON.parse);
const dRows = [];
for (const row of rows) {
  if (!row.refs || !row.refs.length) continue;
  const refs = row.refs.map(r => ({
    ...r,
    hit: matchEvidence(`${r.title || ""}\n${r.snippet || ""}`.toLowerCase(), row.answers),
    junk: junkReason(r),
  }));
  const rawGold = refs.findIndex(r => r.hit) + 1;
  const strictGold = refs.findIndex(r => r.hit && !r.junk) + 1;
  const miss1 = strictGold !== 1;
  if (!miss1) continue;
  let sub = null;
  if (strictGold === 0 && rawGold > 0) sub = "E";
  else if (strictGold === 0) sub = "nogold";
  else if (strictGold > 10) sub = "deep";
  if (sub) dRows.push({ q: row.q, answers: row.answers, sub, strictGold, rawGold, refs });
}

// ---------- HTML 剥离 ----------
function htmlToText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|table|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&apos;|&#0*39;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return " "; } })
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

// ---------- fetch (ua: eval=探针标识 UA / browser=重试用真实浏览器 UA, 部分站点按 UA 拒爬) ----------
const UAS = {
  eval: "Mozilla/5.0 (compatible; searchcore-eval/0.1; local eval rig)",
  browser: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};
async function fetchBody(url, ua = "eval") {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: ac.signal, redirect: "follow",
      headers: { "user-agent": UAS[ua], "accept": "text/html,application/xhtml+xml,text/plain,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" },
    });
    const ms = Date.now() - t0;
    if (!res.ok) return { status: `HTTP${res.status}`, ms, text: "" };
    const ct = (res.headers.get("content-type") || "").split(";")[0];
    if (!/text\/html|text\/plain|xhtml/.test(ct)) return { status: `CT:${ct || "?"}`, ms, text: "" };
    const raw = await res.text();
    return { status: "OK", ms, text: htmlToText(raw).slice(0, 1500000) };
  } catch (e) {
    return { status: e.name === "AbortError" ? "TIMEOUT" : `ERR:${String(e.cause?.code || e.message).slice(0, 40)}`, ms: Date.now() - t0, text: "" };
  } finally { clearTimeout(timer); }
}

// ---------- 正文命中定位(带上下文 + query 内容词重叠标记) ----------
const QSTOP = new Set(["what", "who", "whom", "whose", "when", "where", "which", "how", "why", "is", "are", "was", "were", "the", "a", "an", "of", "in", "on", "for", "to", "do", "does", "did"]);
function queryTerms(q) {
  return [...new Set(q.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !QSTOP.has(t) && !STOP.has(t)))];
}
function locate(text, answers, q) {
  const low = text.toLowerCase();
  for (const a of answers) {
    const al = a.toLowerCase();
    if (al.length > 1 && low.includes(al)) {
      const i = low.indexOf(al);
      const ctx = text.slice(Math.max(0, i - 100), i + al.length + 120).replace(/\n/g, " ");
      const terms = queryTerms(q), rel = terms.filter(t => ctx.toLowerCase().includes(t)).length;
      return { ans: a, type: "verbatim", ctx: ctx.slice(0, 240), relOf: `${rel}/${terms.length}` };
    }
  }
  for (const a of answers) {
    const toks = a.toLowerCase().split(/[^a-z0-9]+/).filter(t => t && ((t.length >= 4 && !STOP.has(t)) || /^\d+$/.test(t)));
    if (!toks.length) continue;
    if (toks.every(t => low.includes(t))) {
      let i = -1;
      for (const t of toks) { const p = low.indexOf(t); if (p > -1 && (i < 0 || p < i)) i = p; }
      const ctx = text.slice(Math.max(0, i - 100), i + 220).replace(/\n/g, " ");
      const terms = queryTerms(q), rel = terms.filter(t => ctx.toLowerCase().includes(t)).length;
      return { ans: a, type: "tokenAND", toks, ctx: ctx.slice(0, 240), relOf: `${rel}/${terms.length}` };
    }
  }
  return null;
}

// ---------- 断点续跑 + 并发池 ----------
const done = new Map();
if (fs.existsSync(OUT_JSON)) for (const r of JSON.parse(fs.readFileSync(OUT_JSON, "utf8"))) done.set(r.q + "|" + r.rank, r);
const tasks = [];
for (const d of dRows) {
  for (let i = 0; i < Math.min(TOPN, d.refs.length); i++) {
    const ref = d.refs[i];
    if (!ref.url) continue;
    const key = d.q + "|" + (i + 1);
    if (!done.has(key)) tasks.push({ d, rank: i + 1, ref, key });
  }
}
let cursor = 0;
async function worker() {
  while (cursor < tasks.length) {
    const t = tasks[cursor++];
    const r = await fetchBody(t.ref.url);
    const m = r.text ? locate(r.text, t.d.answers, t.d.q) : null;
    const rec = { q: t.d.q, sub: t.d.sub, rank: t.rank, url: t.ref.url.slice(0, 120), title: (t.ref.title || "").slice(0, 70), status: r.status, ms: r.ms, bytes: r.text.length, m };
    done.set(t.key, rec);
    if (cursor % 8 === 0 || cursor === tasks.length) {
      fs.writeFileSync(OUT_JSON, JSON.stringify([...done.values()], null, 0));
      console.error(`  [${cursor}/${tasks.length}] ${t.d.q.slice(0, 40)} rank${t.rank} ${r.status}${m ? " " + m.type : ""}`);
    }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
fs.writeFileSync(OUT_JSON, JSON.stringify([...done.values()], null, 0));

// ---------- 重试轮: 非 OK 记录用浏览器 UA 再抓一次 (403 拒爬常按 UA 过滤, b31 实测 <150ms 即拒) ----------
const RETRY = argOf("--retry", 1);
if (RETRY) {
  const failed = [...done.entries()].filter(([, r]) => r.status !== "OK");
  console.error(`重试轮: ${failed.length} 条非 OK 记录用 browser UA 重抓`);
  let cur = 0;
  const retryTasks = failed.filter(([, r]) => r.url);
  async function retryWorker() {
    while (cur < retryTasks.length) {
      const [key, rec] = retryTasks[cur++];
      const r = await fetchBody(rec.url, "browser");
      const m = r.text ? locate(r.text, dRows.find(d => d.q === rec.q)?.answers || [], rec.q) : null;
      Object.assign(rec, { status: r.status, ms: r.ms, bytes: r.text.length, m, retried: true });
      if (m) console.error(`  重试命中: ${rec.q.slice(0, 40)} rank${rec.rank} ${rec.status}`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, retryWorker));
  fs.writeFileSync(OUT_JSON, JSON.stringify([...done.values()], null, 0));
}

// ---------- 汇总 ----------
const byQ = new Map();
for (const rec of done.values()) {
  if (!byQ.has(rec.q)) byQ.set(rec.q, { answers: dRows.find(d => d.q === rec.q)?.answers || [], recs: [] });
  byQ.get(rec.q).recs.push(rec);
}
const agg = { nogold: { D1: 0, D2: 0, ERR: 0 }, deep: { D1: 0, D2: 0, ERR: 0 }, E: { D1: 0, D2: 0, ERR: 0 } };
const d1ranks = [];
let detail = "";
for (const [q, { answers, recs }] of byQ) {
  const sub = recs[0].sub;
  const hit = recs.filter(r => r.m);
  const okFetch = recs.filter(r => r.status === "OK");
  let verdict;
  if (hit.length) { verdict = "D1"; agg[sub].D1++; d1ranks.push(...hit.map(h => h.rank)); }
  else if (!okFetch.length) { verdict = "ERR"; agg[sub].ERR++; }
  else { verdict = "D2"; agg[sub].D2++; }
  detail += `\n[${verdict}/${sub}] Q: ${q.slice(0, 90)}\n  ans=[${answers.join("; ").slice(0, 70)}]\n`;
  for (const r of recs.sort((a, b) => a.rank - b.rank)) {
    detail += `  r${r.rank} ${r.status} ${r.ms}ms ${r.bytes}B ${r.m ? `=> ${r.m.type} ans="${r.m.ans}" rel=${r.m.relOf}` : ""}\n    ${r.title}\n    ${r.m ? "CTX: " + r.m.ctx : ""}\n`;
  }
}
const tot = Object.fromEntries(Object.keys(agg).map(k => [k, agg[k].D1 + agg[k].D2 + agg[k].ERR]));
console.log(`\n==== ${DS}: D 桶探针 (n=${dRows.length}, rank1-${TOPN}, fetch ${[...done.values()].length} URL) ====`);
for (const sub of ["nogold", "deep", "E"]) {
  if (!tot[sub]) continue;
  const den = agg[sub].D1 + agg[sub].D2;
  console.log(`${sub}: D1 正文有答案=${agg[sub].D1}${den ? `(${(100 * agg[sub].D1 / den).toFixed(0)}% of 可判)` : ""}  D2 真召回缺失=${agg[sub].D2}  ERR=${agg[sub].ERR}`);
}
console.log(`D1 命中位次分布: rank${[...new Set(d1ranks)].sort().join(",rank")} ; 全部明细: ${OUT_TXT}`);
fs.writeFileSync(OUT_TXT, detail);
