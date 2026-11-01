// b34-window-attrib.mjs — 批 34: 窗口翻转逐案归因(行候选机制 vs 上游换血)
// 背景: b34 在 b19BestSentence 加 b19RowCandidates(表格感知行候选: cell run ≥2 + 数字行锚 + 行级查询词)。
//       同题集活窗 b33win→b34win: NQ @1 REG 9/FIX 5, TQA @1 REG 8/FIX 10 — 须逐案裁决机制涉入。
// 方法: 对每个 @1 翻转题, 对齐两窗同 URL ref, 切 snippet 的 " · " 注入尾,
//       尾跑行候选 JS 镜像(isCellLine/数字行锚/查询词) + gold 归属(base/尾/无),
//       rank1-3 URL 集对比定上游换血; 匹配器与 eval-external-dump.mjs 逐字一致。
// 口径: hay=title+snippet 小写; verdict ∈ {row-fix(row尾交付gold), row-reg(row尾挤掉gold),
//       upstream(rank1-3 全换血/同URL但非row差异), mixed}
// 用法: node scripts/b34-window-attrib.mjs
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
// b34 行候选 JS 镜像(answer_extract.go): 注入尾是否为行候选形态
// 行候选 = "·" 连接的 cell 段(≥2) 且含纯数字段; 查询词镜像在 dump 侧不可得(尾自查近似: 段内词与 query 交集)
function rowTailShape(tail, q) {
  if (!tail || !tail.includes(" · ")) return null;
  const segs = tail.split(" · ").map(s => s.trim()).filter(Boolean);
  if (segs.length < 2) return null;
  const hasDigitSeg = segs.some(s => /^\d+$/.test(s.trim()));
  if (!hasDigitSeg) return null;
  // cell 段形态: 短(<40) 且无句末标点
  const cellSegs = segs.filter(s => s.length < 40 && !/[.!?。！？]\s*$/.test(s));
  if (cellSegs.length < 2) return null;
  const ql = q.toLowerCase();
  const terms = ql.split(/[^a-z0-9]+/).filter(t => t.length > 1 && !STOP.has(t) && !["which","where","what","when","who","how","was","were","the","and","for","did","does","do","in","of","on","at","by","from","with","about","to","is","are","a","an","or"].includes(t));
  const hasTerm = terms.some(t => tail.toLowerCase().includes(t));
  return { segs: segs.length, hasTerm, digitSeg: segs.find(s => /^\d+$/.test(s)) };
}
const load = (p) => new Map(fs.readFileSync(p, "utf8").trim().split("\n").map(l => { const r = JSON.parse(l); return [r.q, r]; }));
const hit1 = (row) => {
  const r = (row.refs || [])[0];
  if (!r) return false;
  return matchEvidence(((r.title || "") + " " + (r.snippet || "")).toLowerCase(), row.answers || []);
};
const firstHitRef = (row) => (row.refs || []).find(r => matchEvidence(((r.title || "") + " " + (r.snippet || "")).toLowerCase(), row.answers || []));
const goldIn = (s, answers) => !!s && matchEvidence(s.toLowerCase(), answers || []);

for (const [ds, oldP, newP] of [["nq", "/tmp/eval-rerank/nq-dump-b33win.jsonl", "/tmp/eval-rerank/nq-dump.jsonl"],
                                ["tqa", "/tmp/eval-rerank/triviaqa-dump-b33win.jsonl", "/tmp/eval-rerank/triviaqa-dump.jsonl"]]) {
  const old = load(oldP), neu = load(newP);
  console.log(`\n======== ${ds} ========`);
  let rowFix = 0, rowReg = 0, upstream = 0;
  for (const [q, orow] of old) {
    const nrow = neu.get(q);
    if (!nrow) continue;
    const o1 = hit1(orow), n1 = hit1(nrow);
    if (o1 === n1) continue;
    const kind = o1 ? "REG" : "FIX";
    const oUrls = (orow.refs || []).slice(0, 3).map(r => r.url);
    const nUrls = (nrow.refs || []).slice(0, 3).map(r => r.url);
    const overlap = oUrls.filter(u => nUrls.includes(u)).length;
    let verdict = "upstream", detail = "";
    if (kind === "FIX") {
      const hr = firstHitRef(nrow);
      const sn = hr ? (hr.snippet || "") : "";
      const tail = sn.includes(" · ") ? sn.rsplit ? sn.rsplit(" · ", 1)[-1] : sn.split(" · ").pop() : "";
      const shape = rowTailShape(tail, q);
      const goldWhere = goldIn(hr?.title, nrow.answers) ? "title" : (goldIn(tail, nrow.answers) ? "tail" : (goldIn(sn.split(" · ").slice(0, -1).join(" · "), nrow.answers) ? "base" : "none"));
      if (shape && shape.hasTerm && goldWhere === "tail") { verdict = "row-fix"; rowFix++; }
      else { upstream++; }
      detail = `gold@${goldWhere} rowShape=${shape ? JSON.stringify(shape) : "-"} hitUrl=${(hr?.url || "").slice(0, 60)} top3overlap=${overlap}/3`;
    } else {
      // REG: b33 hit ref 在 b34 的现状
      const ohr = firstHitRef(orow);
      const nSame = (nrow.refs || []).find(r => r.url === ohr?.url);
      const nTail = nSame && (nSame.snippet || "").includes(" · ") ? (nSame.snippet || "").split(" · ").pop() : "";
      const nShape = rowTailShape(nTail, q);
      const nStill = nSame ? goldIn(((nSame.title || "") + " " + (nSame.snippet || "")), nrow.answers) : null;
      if (nSame && nShape && !nStill && goldIn(((ohr.title || "") + " " + (ohr.snippet || "")), orow.answers)) {
        verdict = "row-reg"; rowReg++;
        detail = `同URL=${ohr.url.slice(0, 60)} b33有gold b34尾=${nTail.slice(0, 60)} rowShape=${JSON.stringify(nShape)}`;
      } else {
        upstream++;
        detail = `同URL存活=${!!nSame} 同URL仍有gold=${nStill} b33hitUrl=${(ohr?.url || "").slice(0, 55)} top3overlap=${overlap}/3`;
      }
    }
    console.log(`[${kind}][${verdict}] ${q.slice(0, 72)}`);
    console.log(`    ${detail}`);
  }
  console.log(`-- ${ds} 小计: row-fix=${rowFix} row-reg=${rowReg} upstream=${upstream}`);
}
