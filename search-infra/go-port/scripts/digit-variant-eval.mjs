// digit-variant-eval.mjs — 批 31 候选④: matcher 数字变体假阴性定量 (只评估, eval 口径红线不动)
// 动机: b30 裁决实锤 1 条 (TQA Michelle Smith: rank1 正文 "four years", 答案字面 "4 years" 数字形式不匹配),
//       D1 正文探针又见缩写变体 (48 Hrs. vs 48 Hours)。本工具定量: 若把答案做 数字↔英文词/%↔percent
//       的 token 级变体展开, 有多少 eval miss 会翻转?
// 口径: 匹配器与 eval 逐字一致; 变体只作用于答案侧, hay 不动; rank1 翻转=hit@1 假阴性下界,
//       top20 翻转=strict gold 出现(影响 D 桶计数)。产物仅作口径评估证据, 不改任何产品/评测行为。
// 用法: node scripts/digit-variant-eval.mjs
import fs from "node:fs";
import { junkReason } from "./junk-gold.mjs";

const NUMWORD = { 0: "zero", 1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten", 11: "eleven", 12: "twelve", 13: "thirteen", 14: "fourteen", 15: "fifteen", 16: "sixteen", 17: "seventeen", 18: "eighteen", 19: "nineteen", 20: "twenty", 30: "thirty", 40: "forty", 50: "fifty", 60: "sixty", 70: "seventy", 80: "eighty", 90: "ninety", 100: "hundred", 1000: "thousand" };
const WORDNUM = Object.fromEntries(Object.entries(NUMWORD).map(([d, w]) => [w, d]));
const MISC = { "%": "percent", "&": "and" };
const MISC_REV = { percent: "%", and: "&" };

// token 级替换: 保留分隔符结构, 只换可替换 token; 单 token 变体 + ≤2 token 的组合变体
function variants(ans) {
  const parts = ans.split(/([A-Za-z0-9%&]+)/).filter(p => p !== "");
  const opts = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i], low = p.toLowerCase();
    let alt = null;
    if (/^\d+$/.test(p) && NUMWORD[+p]) alt = NUMWORD[+p];
    else if (WORDNUM[low]) alt = WORDNUM[low];
    else if (MISC[p]) alt = MISC[p];
    else if (MISC_REV[low]) alt = MISC_REV[low];
    if (alt && alt.toLowerCase() !== low) opts.push([i, alt]);
  }
  const out = new Set();
  for (const [i, alt] of opts) {
    const v = [...parts]; v[i] = alt;
    out.add(v.join(""));
  }
  if (opts.length === 2) {
    const v = [...parts];
    v[opts[0][0]] = opts[0][1]; v[opts[1][0]] = opts[1][1];
    out.add(v.join(""));
  }
  return [...out];
}

const STOP = new Set(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "season", "seasons", "episode", "episodes", "the", "and", "was", "were", "has", "have", "had"]);
function matchEvidence(hay, answers) {
  for (const a of answers) {
    const al = a.toLowerCase();
    if (al.length > 1 && hay.includes(al)) return a;
  }
  for (const a of answers) {
    const toks = a.toLowerCase().split(/[^a-z0-9]+/).filter(t => t && ((t.length >= 4 && !STOP.has(t)) || /^\d+$/.test(t)));
    if (toks.length === 0) continue;
    if (toks.every(t => hay.includes(t))) return a;
  }
  return null;
}

let totMiss = 0, totR1 = 0, totTop20 = 0, cases = "";
for (const [ds, path] of [["nq", "/tmp/eval-rerank/nq-dump.jsonl"], ["tqa", "/tmp/eval-rerank/triviaqa-dump.jsonl"]]) {
  const rows = fs.readFileSync(path, "utf8").trim().split("\n").map(JSON.parse);
  let miss = 0, r1flip = 0, top20flip = 0;
  for (const row of rows) {
    if (!row.refs || !row.refs.length) continue;
    const hay = i => `${row.refs[i].title || ""}\n${row.refs[i].snippet || ""}`.toLowerCase();
    const baseAll = matchEvidence(hay(0), row.answers);          // rank1 判定(eval 只看 rank1? 不 — hit@1 用 rank1)
    // 与 analyze-suppression 对齐: strict gold 位置
    const hitsAt = row.refs.map((r, i) => matchEvidence(`${r.title || ""}\n${r.snippet || ""}`.toLowerCase(), row.answers) && !junkReason(r) ? i + 1 : 0).filter(Boolean);
    const strictGold = hitsAt[0] || 0;
    if (strictGold === 1) continue;
    miss++;
    const r1Hay = hay(0);
    let flipped1 = null, flipped20 = null;
    for (const a of row.answers) {
      for (const v of variants(a)) {
        if (v.toLowerCase() === String(a).toLowerCase()) continue;
        if (!flipped1 && matchEvidence(r1Hay, [v])) flipped1 = `${a} → ${v}`;
        if (!flipped20) {
          for (let i = 0; i < row.refs.length; i++) {
            if (matchEvidence(hay(i), [v]) && !junkReason(row.refs[i])) { flipped20 = `r${i + 1} ${a} → ${v}`; break; }
          }
        }
        if (flipped1 && flipped20) break;
      }
      if (flipped1 && flipped20) break;
    }
    if (flipped1) { r1flip++; cases += `[${ds}][rank1翻转] ${row.q.slice(0, 70)}\n  ${flipped1} | rank1: ${(row.refs[0].title || "").slice(0, 60)}\n`; }
    if (flipped20) top20flip++;
  }
  console.log(`${ds}: miss@1(严格)=${miss}  数字变体可翻转 rank1=${r1flip}  top20 出现严格 gold=${top20flip}`);
  totMiss += miss; totR1 += r1flip; totTop20 += top20flip;
}
console.log(`\n合并: miss=${totMiss}, rank1 翻转=${totR1}(${(100 * totR1 / totMiss).toFixed(1)}%), top20 翻转=${totTop20}`);
console.log("\n==== 逐案 ====");
console.log(cases || "(无)");
