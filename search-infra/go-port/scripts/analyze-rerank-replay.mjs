// analyze-rerank-replay.mjs — 重排变体离线重放: 用 dump 的全量 refs, 不重查上游
// 目的: 回答"embedding 重排要不要上模型" — 先量化零模型 TF-hash embedding 作为排序信号
//       能吃掉多少头部缺口(hit@1), 若≈0 则 TF-hash 无增益, 神经重排才有戏(附代价估算)。
// 变体(全部只在 dump 返回的候选集内重排, 不引入新文档):
//   base     — dump 原序(当前融合打分: rrf+lex+consensus+titleBonus+authority)
//   cosλ     — base 序分 + λ·cosine(q, title+snippet)  (TF-hash 512 桶, 与 semantic.go 同款)
//   phrase   — base 序分 + 短语奖励(query 全短语命中 title/snippet)
//   pure     — 纯 cosine 重排(embedder 单独信号的天花板参照)
//   mix      — cos 最优λ + 短语奖励(λ 在报告里注明是扫描选出)
// 口径: hit@k 只在 top-10 内统计(与官方口径一致); gold 落在 11-20 单独报告(重排池深度论据)。
// 用法: node scripts/analyze-rerank-replay.mjs [--nq .../nq-dump.jsonl] [--tqa .../triviaqa-dump.jsonl]
import fs from "node:fs";

const argStr = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const NQ = argStr("--nq", "/tmp/eval-rerank/nq-dump.jsonl");
const TQA = argStr("--tqa", "/tmp/eval-rerank/triviaqa-dump.jsonl");

// ---------- TF-hash embedder: 与 Go semantic.go 逐位对齐 ----------
const DIM = 512;
const splitRe = /[^\p{L}\p{N}]+/u;
const isCJK = (r) => (r >= 0x3400 && r <= 0x4dbf) || (r >= 0x4e00 && r <= 0x9fff) || (r >= 0xf900 && r <= 0xfaff) || (r >= 0x3040 && r <= 0x30ff);
function embedTokens(s) {
  const out = [];
  for (const run of s.toLowerCase().split(splitRe)) {
    if (!run) continue;
    const rs = [...run];
    if (rs.some(isCJK)) {
      out.push(run);
      for (let i = 0; i + 1 < rs.length; i++) out.push(rs[i] + rs[i + 1]);
    } else out.push(run);
  }
  return out;
}
function fnvBucket(token) {
  let h = 0x811c9dc5;
  for (const ch of token) {
    h = (h ^ ch.codePointAt(0)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % DIM;
}
function tfVector(s) {
  const v = new Float64Array(DIM);
  const toks = embedTokens(s);
  if (!toks.length) return v;
  for (const t of toks) v[fnvBucket(t)]++;
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}
function cosine(a, b) {
  let d = 0;
  for (let i = 0; i < DIM; i++) d += a[i] * b[i];
  return d;
}

// ---------- 匹配器(与 eval-external.mjs 逐字一致) ----------
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

function phraseBonus(q, title, snippet) {
  const ql = q.toLowerCase().replace(/[?!.。？！]+$/g, "").trim();
  if (ql.length < 8) return 0; // 太短不算短语
  if (title.toLowerCase().includes(ql)) return 0.5;
  if (snippet.toLowerCase().includes(ql)) return 0.2;
  return 0;
}

const LAMBDAS = [0.25, 0.5, 1.0];
// 序分: 以融合连续 score 为基底(rrf*10+lex*1.5+consensus+titleBonus+authority), 变体加新信号项;
// 同分时用返回名次作次要序(重排保守)。cosλ 才是真正的"增量信号"实验(纯 cosine 重排在 pure 列)。
function scoreKey(r) { return (r.score || 0) * 10 - (r.rank || 99) * 1e-4; }
function cosKeyF(l) { return (r) => (r.score || 0) * 10 + l * r.cos - (r.rank || 99) * 1e-4; }
function phraseKeyF(r) { return (r.score || 0) * 10 + r.pb * 2 - (r.rank || 99) * 1e-4; }
function pureKey(r) { return r.cos - (r.rank || 99) * 1e-6; }

function replay(rows, label) {
  // 第一遍: 打特征
  const enriched = rows.filter(r => r.refs && r.refs.length).map(row => {
    const qv = tfVector(row.q);
    const refs = row.refs.map(r => ({
      ...r,
      hit: matchEvidence(`${r.title}\n${r.snippet}`.toLowerCase(), row.answers),
      cos: cosine(qv, tfVector(r.title + " " + r.snippet)),
      pb: phraseBonus(row.q, r.title, r.snippet),
    }));
    return { q: row.q, refs, hitRank: row.hitRank || 0 };
  });

  const order = (refs, keyfn) => [...refs].sort((a, b) => keyfn(b) - keyfn(a));
  const hits = (ordered, kMax) => {
    for (let i = 0; i < Math.min(kMax, ordered.length); i++) if (ordered[i].hit) return i + 1;
    return 0;
  };

  const cosKey = (l) => cosKeyF(l);

  // λ 扫描(全量后选, 非逐题)
  const lambdaH1 = {};
  for (const l of LAMBDAS) {
    let h1 = 0;
    for (const e of enriched) if (hits(order(e.refs, cosKey(l)), 10) === 1) h1++;
    lambdaH1[l] = h1;
  }
  const bestL = LAMBDAS.reduce((a, b) => (lambdaH1[b] > lambdaH1[a] ? b : a));
  const mixKey = (r) => (r.score || 0) * 10 + bestL * r.cos + r.pb * 2 - (r.rank || 99) * 1e-4;

  const VARIANTS = {
    base: scoreKey,
    ...Object.fromEntries(LAMBDAS.map(l => [`cos${l}`, cosKey(l)])),
    phrase: phraseKeyF,
    pure: pureKey,
    mix: mixKey,
  };

  // 第二遍: 各变体统计
  const stats = Object.fromEntries(Object.keys(VARIANTS).map(v => [v, { n: 0, h1: 0, h3: 0, h5: 0, in10: 0 }]));
  let deep = 0;
  const flips = {};
  for (const e of enriched) {
    if (e.hitRank > 10) deep++;
    const baseOrdered = order(e.refs, scoreKey);
    const baseFirst = hits(baseOrdered, 10);
    for (const [v, keyfn] of Object.entries(VARIANTS)) {
      const s = stats[v];
      s.n++;
      const r = hits(order(e.refs, keyfn), 10);
      if (r === 1) s.h1++;
      if (r === 2 || r === 3) s.h3++;
      if (r === 4 || r === 5) s.h5++; // 4-5 档 exclusive, h1+h3+h5=真累计@5
      if (r > 0) s.in10++;
      // flip: base hit@1 在变体下的去留(h3 内保住算 kept-out-of-1, 掉出 top3 算 lost)
      if (v !== "base" && baseFirst === 1) {
        flips[v] = flips[v] || { kept1: 0, demoted23: 0, lost: 0 };
        if (r === 1) flips[v].kept1++;
        else if (r >= 2 && r <= 3) flips[v].demoted23++;
        else flips[v].lost++;
      }
    }
  }

  const b = stats.base;
  console.log(`\n==== ${label} (n=${b.n}, gold@11-20: ${deep}) ====`);
  console.log(`变体        hit@1    Δ@1    hit@3    hit@5    池内hit`);
  for (const [v, s] of Object.entries(stats)) {
    const p = (x) => (100 * x / s.n).toFixed(1).padStart(5) + "%";
    const d = v === "base" ? "   —" : ` ${s.h1 - b.h1 >= 0 ? "+" : ""}${s.h1 - b.h1}`;
    console.log(`${v.padEnd(10)} ${p(s.h1)} ${d.padStart(5)}  ${p(s.h1 + s.h3)}  ${p(s.h1 + s.h3 + s.h5)}  ${p(s.in10)}`);
  }
  for (const [v, f] of Object.entries(flips)) {
    console.log(`flip ${v} (base hit@1 共 ${f.kept1 + f.demoted23 + f.lost}): 保住第1 ${f.kept1} / 降到2-3 ${f.demoted23} / 掉出前3 ${f.lost}`);
  }
  console.log(`(mix 用 cosλ=${bestL}, 扫描集 ${LAMBDAS.join("/")} hit@1=${LAMBDAS.map(l => lambdaH1[l]).join("/")})`);
}

for (const [label, f] of [["NQ-open", NQ], ["TriviaQA", TQA]]) {
  if (!fs.existsSync(f)) { console.log(`skip ${label}: ${f} 不存在`); continue; }
  const rows = fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  replay(rows, label);
}
