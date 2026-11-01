// analyze-upstream-drift.mjs — 上游漂移双窗 diff (b24)
// 背景: b23 同窗 A/B 实锤上游漂移 -7pp hit@1(b21 窗 30.2% -> b23 窗 22.9%, PASS=0 同二进制对拍),
//       绝对值跨窗对比会同时冤枉好修复/放过坏修复。本脚本把"窗口质量可比性"机器化:
//       同题集两版 dump(检索链路不变, 差异=纯上游)逐题 diff, 回答漂移了多少/哪些题/哪条腿。
// 用法: node scripts/analyze-upstream-drift.mjs --dataset nq|triviaqa
//         [--old /tmp/eval-rerank/{ds}-dump-b22win.jsonl] [--new /tmp/eval-rerank/{ds}-dump.jsonl]
// 口径: snippet 层 gold 判定(匹配器与 eval-external / eval-external-dump 逐字一致, verbatim+tokenAND+STOP)
// 归因维度: hit@1/@10 窗口差 / 翻转题(regress/improve) / rank1 换页率 / gold 池存留与 rank 移动 /
//           引擎腿出现率变化(题级 engines 并集) / 腿数分布 / 延迟
// 输出: stdout + /tmp/eval-rerank/drift-{ds}.txt + 锚窗 journal(scripts/upstream-anchor-journal.jsonl, append-only)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argStr = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const DS = argStr("--dataset", "nq");
if (!["nq", "triviaqa"].includes(DS)) { console.error("--dataset 须在 nq|triviaqa"); process.exit(1); }
const OLD = argStr("--old", `/tmp/eval-rerank/${DS}-dump-b22win.jsonl`);
const NEW = argStr("--new", `/tmp/eval-rerank/${DS}-dump.jsonl`);
const OUT = argStr("--out", `/tmp/eval-rerank/drift-${DS}.txt`);
const JOURNAL_ONLY = process.argv.includes("--journal-only"); // b29: 单窗入档模式(旧窗文件丢失/仅需锚窗快照时用)
const JOURNAL = argStr("--journal", new URL("upstream-anchor-journal.jsonl", import.meta.url).pathname); // 提前声明(单窗分支在底部 const 之前调用 journalAppend)
const pct = (n, d) => (d ? (100 * n / d).toFixed(1) : "0.0"); // 同上, winSnapshot 依赖

const readJsonl = (p) => fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);

// --- 匹配器(与 eval-external.mjs / eval-external-dump.mjs 逐字一致) ---
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

// snippet 层 gold 判定: rank<=k 内首个命中页
// b29 修复: hay 必须先 toLowerCase() — matchEvidence 只对 answers 小写, hay 侧小写是调用方契约
// (eval-external/eval-external-dump/analyze-suppression/analyze-rerank-replay 四处调用方全部先小写,
//  唯独本函数 b24 版漏了 → 大小写敏感匹配把专名型答案(China/Debra Winger/New Zealand…)全部漏判,
//  journal 首 4 行 hit 值被低估 ~2.7 倍, b24 报告 gold 层结论作废重审, 详见 EVAL-METHODOLOGY §8a/§13)
function goldAt(row, k) {
  const sorted = [...row.refs].sort((a, b) => a.rank - b.rank);
  for (const r of sorted) {
    if (r.rank > k) break;
    if (matchEvidence(`${r.title || ""}\n${r.snippet || ""}`.toLowerCase(), row.answers)) return { rank: r.rank, url: r.url || "" };
  }
  return null;
}
const engSet = (row) => new Set((row.refs || []).flatMap(r => r.engines || []));

// --- 常驻自检: 匹配器对等性金样本(b29 起, 每次运行先验证, 断言失败即拒跑) ---
// 防同类"跨工具拷贝不走样"复发: 金样本必须覆盖 ①专名大小写 ②tokenAND 数字 ③rank 字段乱序
function selfcheck() {
  const mk = (rank, title, snippet) => ({ rank, title, snippet, url: "u" + rank, engines: ["t"] });
  const row = {
    q: "selfcheck", answers: ["Debra Winger", "1990"],
    refs: [mk(1, "Some Page", "nothing here"), mk(2, "Wonder Girl reel", "played by Debra Winger as Drusilla"), mk(3, "timeline", "ended in 1990")],
  };
  const g1 = goldAt(row, 1), g2 = goldAt(row, 2), g3 = goldAt(row, 3);
  const ok = g2 && g2.rank === 2 && g3 && g3.rank === 2 && !g1; // rank1 无证据, rank2 专名命中
  if (!ok) { console.error(`selfcheck FAIL: gold@1=${JSON.stringify(g1)} gold@2=${JSON.stringify(g2)} gold@3=${JSON.stringify(g3)} — 匹配器与 eval 口径不等价, 拒绝出数`); process.exit(2); }
  // 乱序 rank 字段: 数组序与 rank 序不同时仍按 rank 判
  const row2 = { q: "selfcheck2", answers: ["China"], refs: [mk(5, "x", "china east"), mk(1, "medal table", "China topped the table")] };
  const r2 = goldAt(row2, 20);
  if (!r2 || r2.rank !== 1) { console.error(`selfcheck FAIL(rank 乱序): ${JSON.stringify(r2)}`); process.exit(2); }
  console.log("selfcheck PASS (matcher parity golden samples)");
}
selfcheck();

const oldRows = JOURNAL_ONLY ? null : readJsonl(OLD), newRows = readJsonl(NEW);
// --- 单窗入档模式(b29): 只读 --new, 快照入档即退, 不做双窗 diff ---
if (JOURNAL_ONLY) {
  const snap = winSnapshot(NEW);
  journalAppend([snap]);
  const rep = [`== journal-only: ${DS} ==`, `win: ${snap.win} mtime=${snap.mtime} n=${snap.n}`, `gold@1=${snap.hit1}% gold@10=${snap.hit10}% gold@20=${snap.hit20}% 墙钟=${snap.avgWallMs}ms`, `legs: ${Object.entries(snap.legs).map(([k, v]) => `${k}=${v}%`).join(" ")}`, ""].join("\n");
  fs.writeFileSync(OUT, rep + "\n");
  console.log(rep);
  console.log(`报告已写: ${OUT}`);
  process.exit(0);
}

const newByQ = new Map(newRows.map(r => [r.q, r]));
const pairs = oldRows.filter(r => newByQ.has(r.q)).map(r => [r, newByQ.get(r.q)]);

let out = [];
const say = (s) => { out.push(s); console.log(s); };

say(`== upstream drift: ${DS} ==`);
say(`old: ${OLD} (${oldRows.length} 题)  new: ${NEW} (${newRows.length} 题)`);
say(`题集对齐(按 q): ${pairs.length} 对 (未对齐 old=${oldRows.length - pairs.length} new=${newRows.length - pairs.length})`);
say("");

// --- ① 头部指标窗口差 ---
const h = (rows, k) => rows.filter(r => goldAt(r, k)).length;
const o1 = h(oldRows, 1), n1 = h(newRows, 1), o10 = h(oldRows, 10), n10 = h(newRows, 10), o20 = h(oldRows, 20), n20 = h(newRows, 20);
say(`[gold@1] old ${o1}/${pairs.length}=${pct(o1, pairs.length)}%  ->  new ${n1}/${pairs.length}=${pct(n1, pairs.length)}%  (Δ${(pct(n1, pairs.length) - pct(o1, pairs.length)).toFixed(1)}pp)`);
say(`[gold@10] old ${o10}/${pairs.length}=${pct(o10, pairs.length)}%  ->  new ${n10}/${pairs.length}=${pct(n10, pairs.length)}%  (Δ${(pct(n10, pairs.length) - pct(o10, pairs.length)).toFixed(1)}pp)`);
say(`[gold@20] old ${o20}/${pairs.length}=${pct(o20, pairs.length)}%  ->  new ${n20}/${pairs.length}=${pct(n20, pairs.length)}%  (Δ${(pct(n20, pairs.length) - pct(o20, pairs.length)).toFixed(1)}pp)`);
const wOld = oldRows.reduce((s, r) => s + (r.wallMs || 0), 0) / (oldRows.length || 1);
const wNew = newRows.reduce((s, r) => s + (r.wallMs || 0), 0) / (newRows.length || 1);
say(`[墙钟] old avg ${wOld.toFixed(0)}ms  ->  new avg ${wNew.toFixed(0)}ms`);
say("");

// --- ② 翻转题与 rank1 换页 ---
let regress = [], improve = [], rank1Changed = 0;
for (const [o, n] of pairs) {
  const og1 = goldAt(o, 1), ng1 = goldAt(n, 1);
  if (og1 && !ng1) regress.push([o, n, og1, ng1]);
  if (!og1 && ng1) improve.push([o, n, og1, ng1]);
  const or1 = (o.refs || []).find(r => r.rank === 1), nr1 = (n.refs || []).find(r => r.rank === 1);
  if (or1 && nr1 && (or1.url || "") !== (nr1.url || "")) rank1Changed++;
}
say(`[rank1 换页] ${rank1Changed}/${pairs.length}=${pct(rank1Changed, pairs.length)}% 的题 rank1 URL 变了(上游整体换血度)`);
say(`[翻转] regress(old gold@1 -> new 无): ${regress.length}  |  improve(反向): ${improve.length}`);
say("");

// --- ③ gold 池存留与 rank 移动(regress 题里 gold 页去哪了) ---
const driftMoves = [];
let goldDropped = 0, goldTracked = 0;
for (const [o, n, og1] of regress) {
  const url = og1.url;
  if (!url) continue;
  const nr = (n.refs || []).find(r => (r.url || "") === url);
  if (!nr) { goldDropped++; driftMoves.push([o.q, og1.rank, "OUT"]); }
  else { goldTracked++; driftMoves.push([o.q, og1.rank, nr.rank]); }
}
say(`[regress 题 gold 页去向] url 可追踪 ${regress.length - driftMoves.length + driftMoves.length} 中: 仍在池 ${goldTracked}(降位), 被上游丢弃 ${goldDropped}`);
const moved = driftMoves.filter(m => m[2] !== "OUT").map(m => m[2] - 1);
if (moved.length) {
  moved.sort((a, b) => a - b);
  say(`  仍在池者新 rank 分布: ${moved.join(",")}`);
}
say("");

// --- ④ 引擎腿出现率(题级 engines 并集) ---
const allEng = new Set();
for (const [o, n] of pairs) { for (const e of engSet(o)) allEng.add(e); for (const e of engSet(n)) allEng.add(e); }
say(`[引擎出现率/题] (题级 engines 并集, Δ=腿量变化, 掉腿>10pp 标记 *)`);
const engRows = [...allEng].sort().map(e => {
  const co = pairs.filter(([o]) => engSet(o).has(e)).length;
  const cn = pairs.filter(([, n]) => engSet(n).has(e)).length;
  return [e, co, cn];
});
engRows.sort((a, b) => (b[1] - b[2]) - (a[1] - a[2]));
for (const [e, co, cn] of engRows) {
  const d = cn - co;
  const flag = d <= -pairs.length * 0.10 ? " *" : "";
  say(`  ${e.padEnd(14)} old ${pct(co, pairs.length).padStart(5)}%  new ${pct(cn, pairs.length).padStart(5)}%  (Δ${d >= 0 ? "+" : ""}${d} 题)${flag}`);
}
const legOld = pairs.reduce((s, [o]) => s + engSet(o).size, 0) / (pairs.length || 1);
const legNew = pairs.reduce((s, [, n]) => s + engSet(n).size, 0) / (pairs.length || 1);
say(`[腿数] old avg ${legOld.toFixed(2)}  ->  new avg ${legNew.toFixed(2)}`);
say("");

// --- ⑤ regress 题明细(带引擎变化) ---
if (regress.length) {
  say(`[regress 明细 ${regress.length} 题] (q 截 60ch | old gold@r -> new gold@r/OUT | 掉腿)`);
  for (const [o, n, og1, ng1] of regress) {
    const lost = [...engSet(o)].filter(e => !engSet(n).has(e));
    const gained = [...engSet(n)].filter(e => !engSet(o).has(e));
    const og20 = goldAt(o, 20), ng20 = goldAt(n, 20);
    say(`  - ${o.q.slice(0, 60).padEnd(60)} @1->${ng1 ? `@${ng1.rank}` : (ng20 ? `@${ng20.rank}(10外)` : "OUT")} legs[${[...engSet(o)].join(",")}->${[...engSet(n)].join(",")}] lost=[${lost}] gained=[${gained}]`);
  }
  say("");
}
if (improve.length) {
  say(`[improve 明细 ${improve.length} 题]`);
  for (const [o, n, , ng1] of improve) {
    say(`  + ${o.q.slice(0, 60).padEnd(60)} ->@${ng1.rank}`);
  }
  say("");
}

fs.writeFileSync(OUT, out.join("\n") + "\n");
console.log(`\n报告已写: ${OUT}`);

// --- ⑥ 锚窗 journal: 双窗质量快照落档(append-only, 同窗同集去重) ---
// 语义: 每次跑 drift 分析, 两窗的头部水位/腿出现率/延迟各记一行; 未来任意新锚窗跑本脚本即自动入档,
//       跨窗对比从 journal 读历史, 不再依赖易失的 /tmp。
// b29: 提前定义 + 新增 --journal-only 单窗入档模式(旧窗文件丢失/仅需锚窗快照时用);
//      修正行机制: kind=correction 行声明此前 hit* 字段受 bug 影响, 不改写历史行(append-only)。
// b29: 声明上移至参数区(单窗分支在底部 const 之前调用 journalAppend); winSnapshot/journalAppend 函数声明提升可用
function winSnapshot(file) {
  const rows = readJsonl(file);
  const n = rows.length || 1;
  const legs = {};
  for (const r of rows) for (const e of engSet(r)) legs[e] = (legs[e] || 0) + 1;
  for (const k of Object.keys(legs)) legs[k] = +pct(legs[k], n);
  const h = (k) => rows.filter(r => goldAt(r, k)).length;
  return {
    win: path.basename(file),
    mtime: fs.statSync(file).mtime.toISOString().slice(0, 19) + "Z",
    ds: DS, n: rows.length,
    hit1: +pct(h(1), n), hit10: +pct(h(10), n), hit20: +pct(h(20), n), // 字段名 hit* 沿用 eval 口径, 打印层用 gold* 避开终端渲染吞 [h 序列
    avgWallMs: Math.round(rows.reduce((s, r) => s + (r.wallMs || 0), 0) / n),
    legs,
  };
}
function journalAppend(entries) {
  const exist = fs.existsSync(JOURNAL)
    ? fs.readFileSync(JOURNAL, "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return {}; } })
    : [];
  const key = (j) => `${j.win}|${j.mtime}|${j.ds}`;
  const have = new Set(exist.map(key));
  const add = entries.filter(j => !have.has(key(j)) || j.kind === "correction"); // 修正行永准入档
  if (add.length) {
    fs.appendFileSync(JOURNAL, add.map(j => JSON.stringify(j)).join("\n") + "\n");
    console.log(`journal +${add.length} 行 -> ${JOURNAL}`);
  } else {
    console.log("journal 无新增(同窗已记)");
  }
}

const js = [winSnapshot(OLD), winSnapshot(NEW)];
journalAppend(js);
