#!/usr/bin/env node
// b32: b19 漏抓归因 — D1 页(b31 探针正文有答案, 产品未抽出) 与产品当时 snippet 对拍。
//
// 两段式:
//   默认模式   离线对拍: probe D1 × b30 dump snippet → 不变量自检(eval 语义下 snippet 含 gold
//              则该题本应是 HIT, D1⊆miss 与之矛盾=口径警报) + 粗分桶(C 抓取墙疑似/B 抽取漏疑似)
//              → 产出 scripts/b19-miss-cases-b32.json 供 Go 重放 harness(answer_extract_b32_test.go)。
//   --join     汇总: 读 scripts/b19-replay-b32.json(harness 输出) → 终版分桶总账 +
//              写 scripts/b19-miss-attribution-b32.txt 证据件。
//
// 归因桶(终版, 以 harness 重放为准):
//   C1  产品抓取墙   — 产品 UA 下非 200/空文, b19 静默跳过(snippet 保持上游原样)
//   B4  12k 窗口截断 — 答案在正文但超出 MaxChars=12000 窗口
//   B2  切句形状     — 答案在窗口内但任何切句都不含答案(表格/超长段被剥)
//   B2a 句长门槛     — 含答案句 <40 或 >300 rune 被 b19SentenceLenOk 拒
//   B2b 覆盖门槛     — 含答案句查询内容词覆盖 <2 被拒
//   B1  选句竞争     — 含答案句过闸但 b19BestSentence 选了别的句
//   B3  560 clamp    — 含答案句被选中但 base+" · "+s clamp 560 把答案截掉
//   X   重放会命中   — 当前重放注入成功 = dump 时点漂移(瞬时墙/页内容变化), 非结构性漏抓
//
// 用法: node scripts/b19-miss-attribution.mjs [--join]

import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const D = path.join(ROOT, "eval-dumps");
const CASES_OUT = path.join(ROOT, "scripts", "b19-miss-cases-b32.json");
const REPLAY_IN = path.join(ROOT, "scripts", "b19-replay-b32.json");
const EVIDENCE_OUT = path.join(ROOT, "scripts", "b19-miss-attribution-b32.txt");

// --- 匹配器(与 eval-external-dump.mjs 逐字一致) ---
const STOP = new Set(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "season", "seasons", "episode", "episodes", "the", "and", "was", "were", "has", "have", "had"]);
function matchEvidence(hay, answers) {
  for (const a of answers) {
    const al = a.toLowerCase();
    if (al.length > 1 && hay.includes(al)) return { by: "verbatim", ans: a };
  }
  for (const a of answers) {
    const toks = a.toLowerCase().split(/[^a-z0-9]+/).filter(t => t && ((t.length >= 4 && !STOP.has(t)) || /^\d+$/.test(t)));
    if (toks.length === 0) continue;
    if (toks.every(t => hay.includes(t))) return { by: "tokenAND", ans: toks.join("+") };
  }
  return null;
}

function loadDump(name) {
  return zlib.gunzipSync(fs.readFileSync(path.join(D, name))).toString("utf8")
    .trim().split("\n").filter(Boolean).map(JSON.parse);
}

function buildCases() {
  const probes = [
    { ds: "nq", probe: JSON.parse(fs.readFileSync(path.join(D, "body-probe-nq-b31.json"), "utf8")), dump: loadDump("nq-dump-b30win.jsonl.gz") },
    { ds: "triviaqa", probe: JSON.parse(fs.readFileSync(path.join(D, "body-probe-triviaqa-b31.json"), "utf8")), dump: loadDump("triviaqa-dump-b30win.jsonl.gz") },
  ];
  const cases = [];
  const alarms = [];
  const offline = [];
  for (const { ds, probe, dump } of probes) {
    const byQ = new Map(dump.map(r => [r.q, r]));
    const d1 = probe.filter(x => x.m);
    for (const x of d1) {
      const row = byQ.get(x.q);
      if (!row) { console.log(`!! ${ds} D1 题在 dump 无行: ${x.q.slice(0, 50)}`); continue; }
      // probe JSON 的 url 落盘时截断 140ch — 用前缀匹配对齐, 以 dump 全量 URL 为抓取输入
      const ref = row.refs.find(r => r.url === x.url)
        || row.refs.find(r => r.url.startsWith(x.url) || x.url.startsWith(r.url));
      const rec = {
        dataset: ds, q: x.q, url: ref ? ref.url : x.url, probeUrl: x.url, rank: x.rank, sub: x.sub,
        answers: row.answers, probeAns: x.m.ans, probeType: x.m.type,
        probeStatus: x.status, probeRetried: !!x.retried, probeBytes: x.bytes || 0,
        dumpSnippet: ref ? (ref.snippet || "") : null,
        dumpRefTitle: ref ? (ref.title || "") : "",
        dumpRefFound: !!ref,
      };
      cases.push(rec);
      if (!ref) { offline.push({ ds, q: x.q, rank: x.rank, bucket: "D-offline", note: "URL 不在 dump refs" }); continue; }
      const hay = `${rec.dumpRefTitle}\n${rec.dumpSnippet}`.toLowerCase();
      const ev = matchEvidence(hay, row.answers);
      if (ev) {
        alarms.push({ ds, q: x.q, rank: x.rank, by: ev.by, ans: ev.ans });
        offline.push({ ds, q: x.q, rank: x.rank, bucket: "ALARM", note: `dump snippet 含 gold(${ev.by}) — 该题本应 HIT, 与 D1⊆miss 矛盾` });
        continue;
      }
      const snipLen = rec.dumpSnippet.length;
      const bucket = snipLen < 60 ? "C-prov" : "B-prov";
      offline.push({ ds, q: x.q, rank: x.rank, bucket, note: `snippet ${snipLen}ch` });
    }
  }
  fs.writeFileSync(CASES_OUT, JSON.stringify(cases, null, 1));
  console.log(`== 离线对拍 == cases=${cases.length} → ${path.relative(ROOT, CASES_OUT)}`);
  for (const o of offline) console.log(`  [${o.bucket.padEnd(9)}] ${o.ds}/${String(o.rank)} ${o.q.slice(0, 52)} (${o.note})`);
  if (alarms.length) {
    console.log(`!! 不变量警报 ${alarms.length} 条 — D1⊆miss 与 dump snippet 含 gold 矛盾, 先查口径再解读:`);
    for (const a of alarms) console.log(`   ALARM ${a.ds}/${a.rank} ${a.q.slice(0, 50)} by=${a.by} ans=${a.ans}`);
  }
  const nProv = {};
  for (const o of offline) nProv[o.bucket] = (nProv[o.bucket] || 0) + 1;
  console.log("粗分桶:", JSON.stringify(nProv));
}

function join() {
  const cases = JSON.parse(fs.readFileSync(CASES_OUT, "utf8"));
  const replay = JSON.parse(fs.readFileSync(REPLAY_IN, "utf8"));
  const byKey = new Map(replay.recs.map(r => [`${r.dataset}|${r.q}|${r.url}`, r]));
  const rows = [];
  for (const c of cases) {
    const r = byKey.get(`${c.dataset}|${c.q}|${c.url}`);
    if (!r) { rows.push({ ...c, bucket: "MISSING", note: "harness 无记录" }); continue; }
    rows.push({ ...c, ...r });
  }
  // 总账
  const tally = {};
  for (const r of rows) tally[r.bucket] = (tally[r.bucket] || 0) + 1;
  const lines = [];
  lines.push("b32 — b19 漏抓归因 (D1 页 × 产品 b19 链路重放)");
  lines.push("方法: scripts/b19-miss-cases-b32.json(11 条 D1, probe×dump 对拍) → answer_extract_b32_test.go");
  lines.push("      以产品默认 UA 精确重放 Fetcher.Run(MaxChars=12000, TTL=900, policyFor(nil,nil))+extractHtml+b19BestSentence,");
  lines.push("      全文(MaxChars=1e6)定位 12k 窗口, browser-UA 复抓量化解锁墙; 判定语义与 eval matchEvidence 逐字一致。");
  lines.push(`生成: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("== 总账 ==");
  for (const [b, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) lines.push(`  ${b.padEnd(12)} ${n}`);
  lines.push("");
  lines.push("== 逐条 ==");
  for (const r of rows) {
    lines.push(`[${r.bucket}] ${r.dataset}/${r.sub} rank${r.rank} ${r.q.slice(0, 56)}`);
    lines.push(`    url=${r.url.slice(0, 90)}`);
    lines.push(`    probe: ${r.probeStatus} retried=${r.probeRetried} matched=${r.probeType}"${r.probeAns}"`);
    if (r.dumpSnippet !== null && r.dumpSnippet !== undefined) lines.push(`    dumpSnippet(${(r.dumpSnippet || "").length}ch): ${String(r.dumpSnippet || "").slice(0, 110)}`);
    lines.push(`    replay: status=${r.status} textLen=${r.textLen} fullLen=${r.fullTextLen} ansOffset=${r.ansOffset} bestHasAns=${r.bestHasAns} probeAnsInFull=${r.fullHasAns}`);
    if (r.bestSentence) lines.push(`    best: ${String(r.bestSentence).slice(0, 110)}`);
    if (r.uaStatus) lines.push(`    UA重试(browser): status=${r.uaStatus}${r.unlockBestHasAns !== undefined ? ` unlockBestHasAns=${r.unlockBestHasAns}` : ""}`);
    for (const s of (r.answerSents || []).slice(0, 4)) lines.push(`    ansSent: runes=${s.runes} cover=${s.cover} score=${s.score?.toFixed ? s.score.toFixed(2) : s.score} lenOk=${s.lenOk} coverOk=${s.coverOk} :: ${s.text.slice(0, 90)}`);
    if (r.note) lines.push(`    note: ${r.note}`);
  }
  fs.writeFileSync(EVIDENCE_OUT, lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  console.log(`\n→ 证据件: ${EVIDENCE_OUT}`);
}

if (process.argv.includes("--join")) join(); else buildCases();
