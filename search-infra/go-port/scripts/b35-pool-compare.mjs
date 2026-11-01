// b35-pool-compare.mjs — pool=20 同池重放对拍(b31 挂账量化)
//
// 口径: b34win(topn20+pool10, CE 只作用于交付前 10; 11-20=融合层尾序 CE 不可达)
//   vs pool20(topn20+SC_RERANK_POOL=20, CE 作用于全部 20 条)。
// 同题集确定性抽样(NQ 98/TQA 100), 双窗采集间隔上游会换血 — 逐案归因区分:
//   POOL-GAIN  : b34win hit@11-20(CE 不可达) 且 pool20 hit@1-10 且同一 gold ref URL
//                在 b34win refs 的 11-20 位存在 → CE 提拔=真池深效应
//   UPSTREAM   : 其余翻转(新 URL 进出池/内容漂移) → 上游换血, 不记功 pool
//   REG        : b34win hit@1-10 → pool20 miss@10(位次挤出或换血)
// 水位: hit@1/@10/@20 + rank1 垃圾率(junk 域名表与 analyze-transition 同源) + 延迟。
import fs from "node:fs";
import { isJunkPage } from "./junk-gold.mjs";

const load = (p) => fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const matchEvidence = (hay, answers) => {
  const STOP = new Set(["one","two","three","four","five","six","seven","eight","nine","ten",
    "season","seasons","episode","episodes","the","and","was","were","has","have","had"]);
  for (const a of answers) {
    const al = a.toLowerCase();
    if (al.length > 1 && hay.includes(al)) return a;
  }
  for (const a of answers) {
    const toks = a.toLowerCase().split(/[^a-z0-9]+/).filter(t => t && ((t.length >= 4 && !STOP.has(t)) || /^\d+$/.test(t)));
    if (toks.length === 0) continue;
    if (toks.every(t => hay.includes(t))) return toks.join("+");
  }
  return null;
};
const goldRef = (row, rankHi) => {
  // 交付序第 rankHi 位 ref 是否含 gold, 命中返回该 ref
  const i = rankHi - 1;
  if (i < 0 || i >= row.refs.length) return null;
  const r = row.refs[i];
  return matchEvidence(`${r.title}\n${r.snippet}`.toLowerCase(), row.answers) ? r : null;
};
const firstHit = (row, hi) => {
  for (let i = 0; i < Math.min(hi, row.refs.length); i++) {
    const r = row.refs[i];
    if (matchEvidence(`${r.title}\n${r.snippet}`.toLowerCase(), row.answers)) return i + 1;
  }
  return null;
};

const DS = process.argv[2] || "nq";
const base = load(`/tmp/eval-rerank/${DS}-dump-b34win.jsonl`);
const p20 = load(`/tmp/eval-rerank/${DS}-dump-pool20.jsonl`);
const b34 = new Map(base.map(r => [r.q, r]));
const pairs = p20.filter(r => b34.has(r.q));

let w = { base: [0, 0, 0], p20: [0, 0, 0] }; // @1/@10/@20
let junk1 = { base: 0, p20: 0 };
let wallSum = { base: 0, p20: 0, n: 0 };
let poolGain = [], reg = [], upstream = [];
for (const r of pairs) {
  const b = b34.get(r.q);
  for (const [k, row] of [["base", b], ["p20", r]]) {
    const h1 = firstHit(row, 1) ? 1 : 0, h10 = firstHit(row, 10) ? 1 : 0, h20 = firstHit(row, 20) ? 1 : 0;
    w[k][0] += h1; w[k][1] += h10; w[k][2] += h20;
    const r1 = row.refs[0];
    if (r1 && isJunkPage(r1)) junk1[k]++;
    wallSum[k] += row.wallMs || 0;
  }
  wallSum.n++;
  const hb = firstHit(b, 20), hp = firstHit(r, 20);
  const b10 = firstHit(b, 10), p10 = firstHit(r, 10);
  if (b10 === null && hp !== null && hp <= 10) {
    // pool20 提进 top-10: 检查 b34win 11-20 位是否有同 gold ref(同 URL)
    const grefPool20 = goldRef(r, hp);
    let inTail = false;
    for (let i = 10; i < 20 && i < b.refs.length; i++) {
      const rb = b.refs[i];
      if (rb.url === grefPool20?.url) { inTail = true; break; }
    }
    (inTail ? poolGain : upstream).push({ q: r.q, b34rank: firstHit(b, 20), pool20rank: hp, url: grefPool20?.url || "", same: inTail });
  } else if (b10 !== null && p10 === null) {
    const oldUrl = goldRef(b, b10)?.url || "";
    let stillThere = false;
    for (const rr of r.refs) if (rr.url === oldUrl) { stillThere = true; break; }
    reg.push({ q: r.q, b34rank: b10, url: oldUrl, urlStillInPool20: stillThere });
  } else if (b10 === null && p10 === null && hb === null && hp !== null) {
    upstream.push({ q: r.q, b34rank: null, pool20rank: hp, url: goldRef(r, hp)?.url || "", same: false });
  }
}
const n = pairs.length;
const pct = (x, d) => (100 * x / d).toFixed(1);
console.log(`== ${DS}: 同题 ${n} ==`);
console.log(`水位  b34win(pool10): @1 ${pct(w.base[0], n)} / @10 ${pct(w.base[1], n)} / @20 ${pct(w.base[2], n)}`);
console.log(`水位  pool20:        @1 ${pct(w.p20[0], n)} / @10 ${pct(w.p20[1], n)} / @20 ${pct(w.p20[2], n)}`);
console.log(`rank1 垃圾率: base ${junk1.base}/${n} pool20 ${junk1.p20}/${n}`);
console.log(`均墙钟: base ${Math.round(wallSum.base / n)}ms pool20 ${Math.round(wallSum.p20 / n)}ms (+${Math.round(wallSum.p20 / n - wallSum.base / n)}ms)`);
console.log(`\nPOOL-GAIN(真池深效应, b34win 11-20 同 URL 被 CE 提进 top10): ${poolGain.length}`);
for (const g of poolGain) console.log(`  @${g.b34rank}→@${g.pool20rank} ${g.q.slice(0, 50)} | ${g.url.slice(0, 60)}`);
console.log(`\nREG(b34win hit@10 → pool20 miss@10): ${reg.length}`);
for (const g of reg) console.log(`  @${g.b34rank}→miss urlStillInPool20=${g.urlStillInPool20} ${g.q.slice(0, 48)} | ${g.url.slice(0, 55)}`);
console.log(`\nUPSTREAM(翻转但 gold ref 非 b34win 尾部同 URL / 换血进池): ${upstream.length}`);
for (const g of upstream.slice(0, 12)) console.log(`  ${g.b34rank === null ? "miss→" + g.pool20rank : g.b34rank + "→?"} ${g.q.slice(0, 50)} | ${String(g.url).slice(0, 55)}`);
