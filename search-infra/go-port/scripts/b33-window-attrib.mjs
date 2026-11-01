// b33-window-attrib.mjs — 批 33: 窗口翻转逐案归因(样板句惩罚改动 vs 上游换血)
// 背景: b33 在 b19BestSentence 加 b19IsBoilerplate 跳过(分号>=2 链式列表 / 数字主导列表),
//       同题集活窗对比 b30win→b33win 有翻转(TQA @1 修 7/退 12, NQ 修 7/退 5)。
//       须逐案裁决: 回退是否由本改动引起(=b30 gold 证据在被跳过的样板注入尾里)。
// 方法: 对每个 hit@1 翻转题, 定位 b30 gold 证据承载 ref, 切 snippet 的 " · " 注入尾,
//       尾句跑 b19IsBoilerplate JS 镜像 + gold 归属(base/尾), 再对 b33 同 URL 现状定案。
// 口径: 匹配器与 eval-external-dump.mjs 逐字一致(verbatim len>1 + tokenAND STOP); hay=title+snippet 小写。
// 用法: node scripts/b33-window-attrib.mjs
import fs from "node:fs";

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
// b19IsBoilerplate JS 镜像(answer_extract.go, splitRe=[^\p{L}\p{N}]+ 同切分)
function isBoilerplate(s) {
  if ((s.match(/;/g) || []).length + (s.match(/；/g) || []).length >= 2) return true;
  let digits = 0, alpha = 0;
  for (const tk of s.split(/[^\p{L}\p{N}]+/u)) {
    if (tk === "") continue;
    if (/^[0-9]+$/.test(tk)) { digits++; continue; }
    if ([...tk].length < 3) continue;
    if (/\p{L}/u.test(tk)) alpha++;
  }
  return digits >= 3 && digits > alpha;
}
const load = (p) => new Map(fs.readFileSync(p, "utf8").trim().split("\n").map(l => { const r = JSON.parse(l); return [r.q, r]; }));
const annotate = (row) => (row.refs || []).map(r => {
  const hay = ((r.title || "") + " " + (r.snippet || "")).toLowerCase();
  return { ...r, hit: matchEvidence(hay, row.answers || []) };
});

for (const ds of ["nq", "triviaqa"]) {
  const old = load(`/tmp/eval-rerank/${ds}-dump-b30win.jsonl`);
  const neu = load(`/tmp/eval-rerank/${ds}-dump.jsonl`);
  console.log(`\n==== ${ds} ====`);
  let reg = 0, fix = 0, regMine = 0, fixMine = 0;
  for (const [q, orow] of old) {
    const nrow = neu.get(q);
    if (!nrow) continue;
    const orefs = annotate(orow), nrefs = annotate(nrow);
    const o1 = orefs.findIndex(r => r.hit) + 1, n1 = nrefs.findIndex(r => r.hit) + 1;
    if (o1 === 1 && n1 !== 1) {
      reg++;
      const g = orefs[o1 - 1];
      const segs = (g.snippet || "").split(" · ");
      const tail = segs.length > 1 ? segs[segs.length - 1] : "";
      const base = segs.length > 1 ? segs.slice(0, -1).join(" · ") : (g.snippet || "");
      const goldInTail = tail && matchEvidence(tail.toLowerCase(), orow.answers || []);
      const goldInBase = !goldInTail && matchEvidence(base.toLowerCase(), orow.answers || []);
      const tailBoiler = tail ? isBoilerplate(tail) : false;
      const mine = goldInTail && tailBoiler;
      if (mine) regMine++;
      const nref = nrefs.find(r => r.url === g.url);
      const where = !nref ? "url已出池" : (nref.hit ? `仍在池 hit@${nrefs.findIndex(r => r === nref) + 1}` : "仍在池无gold");
      console.log(`[REG${mine ? "-MINE" : ""}] ${q.slice(0, 52)}`);
      console.log(`   b30 gold url=${(g.url || "").replace(/^https?:\/\/(www\.)?/, "").slice(0, 58)} rank${o1}`);
      console.log(`   证据归属: tail=${goldInTail ? "Y" : "n"} base=${goldInBase ? "Y" : "n"} tailBoiler=${tailBoiler ? "Y" : "n"} segs=${segs.length}`);
      console.log(`   tail: ${JSON.stringify(tail.slice(0, 110))}`);
      console.log(`   b33 现状: ${where}`);
    } else if (o1 !== 1 && n1 === 1) {
      fix++;
      const g = nrefs[n1 - 1];
      const segs = (g.snippet || "").split(" · ");
      const tail = segs.length > 1 ? segs[segs.length - 1] : "";
      const oref = orefs.find(r => r.url === g.url);
      const was = !oref ? "b30该url不在池/非rank1" : (oref.hit ? `b30同url有gold@${orefs.findIndex(r => r === oref) + 1}` : "b30同url无gold");
      console.log(`[FIX] ${q.slice(0, 52)}  b33 rank1 url=${(g.url || "").replace(/^https?:\/\/(www\.)?/, "").slice(0, 50)} tailBoiler=${tail ? isBoilerplate(tail) : false} | ${was}`);
    }
  }
  console.log(`-- ${ds}: REG ${reg} (本改动嫌疑 ${regMine}) | FIX ${fix}`);
}
