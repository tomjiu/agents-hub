// analyze-suppression.mjs — 批 22: miss 归因补"语义压顶"口径 / 批 29: 垃圾 gold 过滤(E 桶)
// 检验 b20 挂账的神经重排触发条件: miss@1 中"gold 在 top-10 内但被语义无关页压顶"占比 >15%?
//
// 口径定义(精确化):
//   语义压顶候选 = miss@1 且 gold 证据(评测匹配器口径)出现在 rank2-10 的 title+snippet
//   自动预分类按 rank1 页对 query 的内容词覆盖度分三档, 人工复核为最终裁决:
//     A 嫌疑压顶  — cov1 ≤ 1/3 (rank1 词面几乎不沾查询)
//     B 词面错位  — cov1 ≥ 1/2 (rank1 高度相关, 只是缺 gold 词面 — 重排救不了)
//     C 灰区      — 介于两者, 全量人工复核
//     D 无 gold   — top-20 全无 gold 证据(语料/召回问题, 与排序无关)
// 批 29 新增(b23 候选②工程化):
//     E 垃圾 gold — 唯一证据页是垃圾页(社媒 reel/题库农场, junk-gold.mjs 信号), 即匹配器假阳性嫌疑:
//                   b22 人工裁决已实锤 2 条, 此前混在 A/C 桶里抬高"可重排修复"估计
//   gold 侧判定改用"严格 gold"(剔除垃圾页后的首个证据页); eval hit@N 口径不动(跨窗可比性红线)。
//   垃圾 rank1 单独计量(rank1JunkRate / junkHit1) — 为产品侧"垃圾页压制"批次提供数据, 本批不动产品。
// 输出: stdout 汇总 + /tmp/eval-rerank/suppression-review.txt(A+C+E 全量渲染供人工裁决)
import fs from "node:fs";
import { junkReason } from "./junk-gold.mjs";

const argStr = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const NQ = argStr("--nq", "/tmp/eval-rerank/nq-dump.jsonl");
const TQA = argStr("--tqa", "/tmp/eval-rerank/triviaqa-dump.jsonl");

// ---------- 匹配器(与 eval-external.mjs 逐字一致; hay 侧小写是调用方契约 — b29 教训) ----------
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

// ---------- 分词(与 fusion.go/semantic.go 同款: 词 + CJK bigram) ----------
const splitRe = /[^\p{L}\p{N}]+/u;
const isCJK = (r) => (r >= 0x3400 && r <= 0x4dbf) || (r >= 0x4e00 && r <= 0x9fff) || (r >= 0xf900 && r <= 0xfaff) || (r >= 0x3040 && r <= 0x30ff);
function queryTerms(q) {
  const out = [];
  for (const run of q.toLowerCase().split(splitRe)) {
    if (!run) continue;
    const rs = [...run];
    if (rs.some(isCJK)) {
      out.push(run);
      for (let i = 0; i + 1 < rs.length; i++) out.push(rs[i] + rs[i + 1]);
    } else out.push(run);
  }
  return [...new Set(out)];
}
// rank1 内容词覆盖: 去掉纯疑问词后算(疑问词人人都沾, 无判别力)
const QSTOP = new Set(["what", "who", "whom", "whose", "when", "where", "which", "how", "why", "is", "are", "was", "were", "the", "a", "an", "of", "in", "on", "for", "to", "do", "does", "did"]);
function coverage(q, title, snippet) {
  let terms = queryTerms(q).filter(t => !QSTOP.has(t) && !(t.length === 2 && isCJK(t.codePointAt(0))));
  if (!terms.length) terms = queryTerms(q);
  if (!terms.length) return 1;
  const hay = `${title}\n${snippet}`.toLowerCase();
  const hit = terms.filter(t => hay.includes(t)).length;
  return hit / terms.length;
}

let review = "";
function reviewLine(s) { review += s + "\n"; }

function analyze(rows, label) {
  const enriched = rows.filter(r => r.refs && r.refs.length).map(row => {
    const refs = row.refs.map(r => ({
      ...r,
      hit: matchEvidence(`${r.title || ""}\n${r.snippet || ""}`.toLowerCase(), row.answers),
      junk: junkReason(r),
    }));
    const rawGold = refs.findIndex(r => r.hit) + 1;                      // eval 口径 gold(含垃圾页)
    const strictIdx = refs.findIndex(r => r.hit && !r.junk);             // 严格 gold(剔垃圾页)
    const strictGold = strictIdx + 1;
    return {
      q: row.q, answers: row.answers, refs,
      rawGold, strictGold,
      cov1: refs[0] ? coverage(row.q, refs[0].title, refs[0].snippet) : 1,
    };
  });
  const miss1 = enriched.filter(e => e.strictGold !== 1);
  const cls = { A: [], B: [], C: [], D: [], E: [] };
  let junkHit1 = 0, rank1Junk = 0;
  for (const e of enriched) {
    if (e.refs[0] && e.refs[0].junk) {
      rank1Junk++;
      if (e.rawGold === 1) junkHit1++;
    }
  }
  for (const e of miss1) {
    if (e.strictGold === 0) {
      if (e.rawGold > 0) cls.E.push(e);   // 唯一证据在垃圾页 — 匹配器假阳性嫌疑
      else cls.D.push(e);                 // 全无证据
      continue;
    }
    if (e.strictGold > 10) { cls.D.push(e); continue; } // gold 在 11-20: 池深问题, 不算压顶
    if (e.cov1 <= 1 / 3) cls.A.push(e);
    else if (e.cov1 >= 0.5) cls.B.push(e);
    else cls.C.push(e);
  }
  console.log(`\n==== ${label}: miss@1(严格)=${miss1.length}/${enriched.length} ====`);
  console.log(`A 嫌疑压顶(cov≤1/3): ${cls.A.length}  B 词面错位(cov≥1/2): ${cls.B.length}  C 灰区: ${cls.C.length}  D 无gold/池外: ${cls.D.length}  E 垃圾gold: ${cls.E.length}`);
  console.log(`垃圾信号: rank1 为垃圾页 ${rank1Junk}/${enriched.length}=${(100 * rank1Junk / enriched.length).toFixed(1)}%  其中 hit@1 靠垃圾页撑 ${junkHit1}(eval 口径照算, 单独计量)`);
  const render = (tag, list) => {
    reviewLine(`\n######## ${label} — ${tag} ${list.length} 条 ########`);
    for (const e of list) {
      const g = e.refs[(tag === "E" ? e.rawGold : e.strictGold) - 1];
      const junkNote = tag === "E" ? ` [junk: ${g.junk}]` : (e.refs[0] && e.refs[0].junk ? ` [rank1 junk: ${e.refs[0].junk}]` : "");
      reviewLine(`\n[${tag}] Q: ${e.q}${junkNote}\n  cov1=${e.cov1.toFixed(2)} strictGold@${e.strictGold || "-"} rawGold@${e.rawGold || "-"} ans=[${e.answers.slice(0, 3).join("; ").slice(0, 80)}]\n  rank1: ${e.refs[0].title}\n    snip: ${e.refs[0].snippet.slice(0, 150).replace(/\n/g, " ")}\n  gold页: ${g.title}\n    snip: ${g.snippet.slice(0, 150).replace(/\n/g, " ")}`);
    }
  };
  render("A", cls.A);
  render("C", cls.C);
  render("E", cls.E);
  return { n: enriched.length, miss1: miss1.length, cls, junkHit1, rank1Junk };
}

const rows = fs.readFileSync(NQ, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const r1 = analyze(rows, "NQ-open");
const rows2 = fs.readFileSync(TQA, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const r2 = analyze(rows2, "TriviaQA");
fs.writeFileSync("/tmp/eval-rerank/suppression-review.txt", review);
const sum = (f) => f(r1) + f(r2);
console.log(`\n复核文件: /tmp/eval-rerank/suppression-review.txt (A+C+E 共 ${sum(r => r.cls.A.length + r.cls.C.length + r.cls.E.length)} 条)`);
const miss = sum(r => r.miss1), n = sum(r => r.n), a = sum(r => r.cls.A.length), c = sum(r => r.cls.C.length), e = sum(r => r.cls.E.length);
console.log(`合并: miss@1(严格)=${miss}/${n}, A 嫌疑=${a}(${(100 * a / miss).toFixed(1)}%), A+C=${a + c}(${(100 * (a + c) / miss).toFixed(1)}%), E 垃圾gold=${e}(${(100 * e / miss).toFixed(1)}%), A+C+E=${a + c + e}(${(100 * (a + c + e) / miss).toFixed(1)}%)`);
