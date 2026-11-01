// analyze-transition.mjs — 批 30: 双窗同题 transition 四象限工具 (OFF 窗 vs ON 窗)
// 用法: node scripts/analyze-transition.mjs (默认对齐 /tmp/eval-rerank/{ds}-dump.jsonl 与 {ds}-dump-b29win.jsonl)
// 口径: eval 匹配器逐字一致(hay 小写契约); 遍历 refs 数组序=交付序(b30 口径, 不信任 rank 字段);
//       hit@10 为主口径, @1 附注; 明细(REG 回退/FIX 修复/JUNK1 垃圾撑头)落 /tmp/eval-rerank/transition-{ds}.txt
import fs from "node:fs";
import { junkReason } from "./junk-gold.mjs";

const load = (p) => new Map(fs.readFileSync(p, "utf8").trim().split("\n").map(l => { const r = JSON.parse(l); return [r.q, r]; }));

const STOP = new Set(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "season", "seasons", "episode", "episodes", "the", "and", "was", "were", "has", "have", "had"]);
function matchEvidence(hay, answers) {
  for (const a of answers) {
    const al = a.toLowerCase();
    if (al.length > 1 && hay.includes(al)) return true;
  }
  for (const a of answers) {
    const toks = a.toLowerCase().split(/[^a-z0-9]+/).filter(t => t && ((t.length >= 4 && !STOP.has(t)) || /^\d+$/.test(t)));
    if (toks.length === 0) continue;
    if (toks.every(t => hay.includes(t))) return true;
  }
  return false;
}
// 每 ref 打标: eval 口径证据(hit) + 是否垃圾页; 返回 {evalHitRank, strictHitRank, strictGoldRank, goldRankAny}
function annotate(row) {
  const refs = (row.refs || []).map(r => {
    const hay = ((r.title || "") + " " + (r.snippet || "")).toLowerCase();
    return { ...r, hit: matchEvidence(hay, row.answers || []), junk: !!junkReason(r) };
  });
  const evalHitRank = refs.findIndex(r => r.hit) + 1 || 0;          // eval 口径首个证据(含垃圾)
  const strictIdx = refs.findIndex(r => r.hit && !r.junk);
  const strictHitRank = strictIdx + 1 || 0;
  return { refs, evalHitRank, strictHitRank };
}
const hitEval = (a) => a.evalHitRank >= 1 && a.evalHitRank <= 10;   // 评测 hit@N 口径 N=10 为可比主口径(dump topn=20)
// 注: 上游水位口径用 @1/@10/@20; 本批 transition 主口径 @1, 附 @10

function report(ds, offPath, onPath) {
  const OFF = load(offPath), ON = load(onPath);
  let rows = [];
  for (const [q, off] of OFF) {
    const on = ON.get(q);
    if (!on) continue;
    const a = annotate(off), b = annotate(on);
    rows.push({ q, a, b, answers: off.answers || on.answers });
  }
  const four = { fix: [], reg: [], hit: [], miss: [] };
  for (const r of rows) {
    const o = hitEval(r.a), n = hitEval(r.b);
    if (!o && n) four.fix.push(r);
    else if (o && !n) four.reg.push(r);
    else if (o && n) four.hit.push(r);
    else four.miss.push(r);
  }
  const pct = (x) => (100 * x / rows.length).toFixed(1);
  console.log(`\n==== ${ds}: 同题 ${rows.length} 条 (hit@10 eval 口径) ====`);
  console.log(`保持命中: ${four.hit.length} (${pct(four.hit.length)}%)  修复 OFF-miss→ON-hit: ${four.fix.length} (${pct(four.fix.length)}%)`);
  console.log(`回退 OFF-hit→ON-miss: ${four.reg.length} (${pct(four.reg.length)}%)  保持 miss: ${four.miss.length} (${pct(four.miss.length)}%)`);
  console.log(`水位: OFF hit@10=${pct(four.hit.length + four.reg.length)}% → ON hit@10=${pct(four.hit.length + four.fix.length)}%`);

  // @1 四象限
  const f1 = { fix: 0, reg: 0, hit: 0, miss: 0 };
  for (const r of rows) {
    const o = r.a.evalHitRank === 1, n = r.b.evalHitRank === 1;
    if (!o && n) f1.fix++; else if (o && !n) f1.reg++; else if (o && n) f1.hit++; else f1.miss++;
  }
  console.log(`@1: 保持命中 ${f1.hit}  修复 ${f1.fix}  回退 ${f1.reg}  保持miss ${f1.miss}  (OFF hit@1=${pct(f1.hit + f1.reg)}% → ON=${pct(f1.hit + f1.fix)}%)`);

  // survived miss 的 rank1 垃圾/严格 gold 分布
  const survivedJunk1 = four.miss.filter(r => r.b.refs[0] && r.b.refs[0].junk).length;
  console.log(`保持 miss 中 rank1=垃圾页: ${survivedJunk1}/${four.miss.length}`);

  // 明细: 回退 + 修复全列
  const brief = (r, tag) => {
    const b = r.b, a = r.a;
    return `\n[${tag}] ${r.q}\n  ans=[${r.answers.slice(0, 2).join("; ").slice(0, 60)}]\n  OFF rank1: ${a.refs[0]?.title?.slice(0, 70)} (evalGold@${a.evalHitRank || "-"}, junk=${a.refs[0]?.junk ? 1 : 0})\n  ON  rank1: ${b.refs[0]?.title?.slice(0, 70)} (evalGold@${b.evalHitRank || "-"}, junk=${b.refs[0]?.junk ? 1 : 0})  ON gold页@${b.evalHitRank || "-"}: ${b.refs[b.evalHitRank - 1]?.title?.slice(0, 60) || "-"}`;
  };
  let detail = "";
  for (const r of four.reg) detail += brief(r, "REG");
  for (const r of four.fix) detail += brief(r, "FIX");
  // junkHit1 明细(ON 窗)
  for (const r of rows) {
    if (r.b.evalHitRank === 1 && r.b.refs[0]?.junk) detail += brief(r, "JUNK1");
  }
  fs.writeFileSync(`/tmp/eval-rerank/transition-${ds}.txt`, detail);
  console.log(`明细: /tmp/eval-rerank/transition-${ds}.txt (REG ${four.reg.length} + FIX ${four.fix.length} + JUNK1)`);
}

// b34: 窗口路径参数化(b34win 对比 b33win), 缺省保持 b29win→b33win 期行为
const OLD_NQ = process.env.SC_TRANS_OLD_NQ || "/tmp/eval-rerank/nq-dump-b29win.jsonl";
const OLD_TQA = process.env.SC_TRANS_OLD_TQA || "/tmp/eval-rerank/triviaqa-dump-b29win.jsonl";
report("nq", OLD_NQ, "/tmp/eval-rerank/nq-dump.jsonl");
report("tqa", OLD_TQA, "/tmp/eval-rerank/triviaqa-dump.jsonl");
