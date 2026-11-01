// analyze-miss-structure.mjs — 批 25: b23 修复后 miss 结构全量刷新
// 背景: b22 归因(词面错位 47% / 无gold 38% / 压顶 8% / 垃圾gold 7%)是 b23 注入修复前的旧图;
//       b23 同窗 +4.2pp hit@1 只测了 parts1-2, 结构刷新后才能裁决批 26 方向.
// 分层(对齐可行动杠杆):
//   HIT1        — dump 层 rank1 即有证据(注入层只会加 token, 最终层应 hit)
//   POOL11_20   — gold@11-20(池深, b20 已证重排空间 3-4%)
//   NOGOLD      — top-20 全无证据(检索缺口, 排序/注入均无效)
//   gold@2-10 细分(按 rank1 对 query 内容词覆盖度, b22 口径):
//     A 嫌疑压顶  — cov1 <= 1/3 (rank1 词面不沾查询, 重排挂账监控, b22 基线 8.0%)
//     B 词面错位  — cov1 >= 1/2 (rank1 高度相关缺 gold token; 细分 B1 rank1 含答案实体/主题页 →
//                   注入层理论存量[抓正文验证], B2 其他)
//     C 灰区      — 两者之间
// 输出: stdout 汇总 + /tmp/eval-rerank/structure-review-b25.txt (A/C 全量 + B 抽样渲染)
import fs from "node:fs";

const argStr = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const NQ = argStr("--nq", "/tmp/eval-rerank/nq-dump.jsonl");
const TQA = argStr("--tqa", "/tmp/eval-rerank/triviaqa-dump.jsonl");

// ---------- 匹配器(与 eval-external.mjs 逐字一致) ----------
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

// ---------- 分词 + 覆盖度(b22 同款) ----------
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
const QSTOP = new Set(["what", "who", "whom", "whose", "when", "where", "which", "how", "why", "is", "are", "was", "were", "the", "a", "an", "of", "in", "on", "for", "to", "do", "does", "did"]);
function coverage(q, title, snippet) {
  let terms = queryTerms(q).filter(t => !QSTOP.has(t) && !(t.length === 2 && isCJK(t.codePointAt(0))));
  if (!terms.length) terms = queryTerms(q);
  if (!terms.length) return 1;
  const hay = `${title}\n${snippet}`.toLowerCase();
  const hit = terms.filter(t => hay.includes(t)).length;
  return hit / terms.length;
}

// B1 判定: rank1 title 或 snippet 含"答案头 token"(答案第一个 >=4 字母词, 常见实体名主体)
// 用途: 区分"同实体主题页缺答案串"(注入层理论存量) vs "相关但可能不含答案的页"
function ansHeadToken(answers) {
  for (const a of answers) {
    const toks = a.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 4 && !STOP.has(t) && !/^\d+$/.test(t));
    if (toks.length) return toks[0];
  }
  return null;
}

let review = "";
function reviewLine(s) { review += s + "\n"; }

function analyze(rows, label) {
  const enriched = rows.filter(r => r.refs && r.refs.length).map(row => {
    const refs = row.refs.map(r => ({ ...r, mm: matchEvidence(`${r.title}\n${r.snippet}`.toLowerCase(), row.answers) }));
    const goldRank = refs.findIndex(r => r.mm) + 1;
    const cov1 = refs[0] ? coverage(row.q, refs[0].title, refs[0].snippet) : 1;
    return { q: row.q, answers: row.answers, refs, goldRank, cov1, wallMs: row.wallMs };
  });
  const n = enriched.length;
  const hit1 = enriched.filter(e => e.goldRank === 1);
  const miss1 = enriched.filter(e => e.goldRank !== 1);
  const pool = miss1.filter(e => e.goldRank > 10);
  const nogold = miss1.filter(e => e.goldRank === 0);
  const g210 = miss1.filter(e => e.goldRank >= 2 && e.goldRank <= 10);
  const A = g210.filter(e => e.cov1 <= 1 / 3);
  const B = g210.filter(e => e.cov1 >= 0.5);
  const C = g210.filter(e => e.cov1 > 1 / 3 && e.cov1 < 0.5);
  const head = ansHeadToken; // per-question below
  const B1 = B.filter(e => {
    const ht = head(e.answers);
    if (!ht) return false;
    const hay = `${e.refs[0].title}\n${e.refs[0].snippet}`.toLowerCase();
    return hay.includes(ht);
  });
  const B2 = B.filter(e => !B1.includes(e));

  const pct = (x, d) => (100 * x / (d || n)).toFixed(1);
  console.log(`\n==== ${label}: n=${n} ====
HIT1(dump层rank1即证据)   ${String(hit1.length).padStart(3)}  ${pct(hit1.length)}%
--- miss@1 ${miss1.length} (${pct(miss1.length)}%) ---
  gold@2-10 可排序救       ${String(g210.length).padStart(3)}  ${pct(g210.length)}% (占miss ${pct(g210.length, miss1.length)}%)
    A 嫌疑压顶(cov<=1/3)   ${String(A.length).padStart(3)}  ${pct(A.length)}% (占miss ${pct(A.length, miss1.length)}%)
    B 词面错位(cov>=1/2)   ${String(B.length).padStart(3)}  ${pct(B.length)}% (占miss ${pct(B.length, miss1.length)}%)
      B1 同实体页(含答案头token, 注入层理论存量) ${B1.length}
      B2 相关页(不含答案头token)                ${B2.length}
    C 灰区                 ${String(C.length).padStart(3)}  ${pct(C.length)}% (占miss ${pct(C.length, miss1.length)}%)
  gold@11-20 池深          ${String(pool.length).padStart(3)}  ${pct(pool.length)}% (占miss ${pct(pool.length, miss1.length)}%)
  无gold@20 检索缺口       ${String(nogold.length).padStart(3)}  ${pct(nogold.length)}% (占miss ${pct(nogold.length, miss1.length)}%)`);

  // 渲染: A+C 全量(压顶人工复核) + B 全量(注入层存量人工判断)
  const render = (tag, list, note) => {
    reviewLine(`\n######## ${label} — ${tag} ${list.length} 条 ${note} ########`);
    for (const e of list) {
      const g = e.goldRank ? e.refs[e.goldRank - 1] : null;
      reviewLine(`\n[${tag}] Q: ${e.q}\n  cov1=${e.cov1.toFixed(2)} gold@${e.goldRank || "-"} ans=[${e.answers.slice(0, 3).join("; ").slice(0, 80)}]`);
      reviewLine(`  rank1: ${e.refs[0].title}\n    snip: ${e.refs[0].snippet.slice(0, 200).replace(/\n/g, " ")}`);
      if (g) reviewLine(`  gold页: ${g.title}\n    snip: ${g.snippet.slice(0, 200).replace(/\n/g, " ")}`);
    }
  };
  render("A", A, "(嫌疑压顶: 重排挂账监控)");
  render("C", C, "(灰区)");
  render("B1", B1, "(同实体缺答案串: 注入层理论存量)");
  render("B2", B2, "(相关页: 可能正文也无答案)");
  return { n, hit1: hit1.length, miss1: miss1.length, A: A.length, B: B.length, B1: B1.length, B2: B2.length, C: C.length, pool: pool.length, nogold: nogold.length };
}

const rows = fs.readFileSync(NQ, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const r1 = analyze(rows, "NQ-open");
const rows2 = fs.readFileSync(TQA, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const r2 = analyze(rows2, "TriviaQA");

const tot = (k) => r1[k] + r2[k];
const N = tot("n"), MISS = tot("miss1");
console.log(`\n==== 合并: n=${N}, dump层HIT@1=${tot("hit1")}(${(100 * tot("hit1") / N).toFixed(1)}%), miss@1=${MISS}(${(100 * MISS / N).toFixed(1)}%) ====
A 嫌疑压顶=${tot("A")}(${(100 * tot("A") / MISS).toFixed(1)}% of miss)  B=${tot("B")}(B1 ${tot("B1")} / B2 ${tot("B2")})  C=${tot("C")}  池深=${tot("pool")}  无gold=${tot("nogold")}(${(100 * tot("nogold") / MISS).toFixed(1)}% of miss)`);
fs.writeFileSync("/tmp/eval-rerank/structure-review-b25.txt", review);
console.log(`\n复核文件: /tmp/eval-rerank/structure-review-b25.txt (A${tot("A")}+C${tot("C")}+B1${tot("B1")}+B2${tot("B2")} 共 ${tot("A") + tot("C") + tot("B1") + tot("B2")} 条)`);
