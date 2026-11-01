// b37-window-attrib.mjs — 批 37: 窗口翻转逐案归因(snippet 合并判据 vs 上游换血)
// 背景: b37 在 fuseV3 URL 合并与 TF 去重把"长 snippet 胜出"改为"查询关键 token 命中数优先,
//       次取长度"(打平回退长度=旧行为逐字节)。同题集活窗 b34win→b37win, 本窗换血极重
//       (rank1 换页 60-63%, DDG 腿双集消失 82.7%→10.2% / 72%→0%), 跨窗差值必须逐案裁决。
// 判定(对每个 @1 翻转题):
//   b37-fix   rank1 同 URL 且 snippet 变了, gold 旧窗不在 rank1 hay、新窗在 = 改动正向
//   b37-reg   rank1 同 URL 且 snippet 变了, gold 旧窗在 rank1 hay、新窗不在 = 改动回退(门禁=0)
//   upstream  旧 rank1 URL 在新窗 top-20 消失(出池)或 rank1-3 URL 集全换(换血)
//   demoted   旧 rank1 URL 仍在池但降位(位次波动; 腿面剧变时归上游)
//   content   同 URL 同 snippet 内容本身漂移(页面变化)
//   mixed     rank1 同 URL snippet 变但 gold 在两侧 hay 同状态(改动涉入但非翻转主因)
// 匹配器与 eval-external-dump.mjs 逐字一致(verbatim len>1 / tokenAND 停用词表)。
// 用法: node scripts/b37-window-attrib.mjs
import fs from "node:fs";

const OLDNQ = "/tmp/eval-rerank/nq-dump-b34win.jsonl";
const NEWNQ = "/tmp/eval-rerank/nq-dump-b37win.jsonl";
const OLDT = "/tmp/eval-rerank/triviaqa-dump-b34win.jsonl";
const NEWT = "/tmp/eval-rerank/triviaqa-dump-b37win.jsonl";

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
const hay1 = (r) => (r.title + "\n" + r.snippet).toLowerCase();

function load(p) {
  const m = new Map();
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    m.set(j.q, j);
  }
  return m;
}

function attr(ds, oldP, newP) {
  const O = load(oldP), N = load(newP);
  const lines = [];
  const tally = {};
  for (const [q, oj] of O) {
    const nj = N.get(q);
    if (!nj) continue;
    const o1 = oj.refs[0], n1 = nj.refs[0];
    if (!o1 || !n1) continue;
    const oHit = matchEvidence(hay1(o1), oj.answers);
    const nHit = matchEvidence(hay1(n1), nj.answers);
    if (oHit === nHit) continue; // 只看 @1 翻转
    const flip = oHit ? "REG" : "FIX";
    const sameURL = o1.url === n1.url;
    const sameSnip = o1.snippet === n1.snippet;
    const inNewPool = nj.refs.some(r => r.url === o1.url);
    let v;
    if (sameURL && !sameSnip) {
      if (flip === "FIX" && nHit) v = "b37-fix";
      else if (flip === "REG" && oHit && !nHit) v = "b37-reg";
      else v = "mixed";
    } else if (sameURL && sameSnip) {
      v = "content"; // 同 URL 同 snippet 却翻转 → 理论上不可能, 防御桶
    } else if (!inNewPool) {
      v = "upstream-出池";
    } else {
      const oTop3 = new Set(oj.refs.slice(0, 3).map(r => r.url));
      const nTop3 = new Set(nj.refs.slice(0, 3).map(r => r.url));
      const overlap = [...oTop3].filter(u => nTop3.has(u)).length;
      v = overlap === 0 ? "upstream-换血" : (oHit && !nHit ? "demoted/换血" : "upstream-重排入顶");
    }
    tally[v] = (tally[v] || 0) + 1;
    lines.push(`[${ds} ${flip} ${v}] ${q.slice(0, 58)}`);
    lines.push(`   old@1 ${o1.url.slice(0, 78)}`);
    lines.push(`   snip: ${(o1.snippet || "").slice(0, 90)}`);
    lines.push(`   new@1 ${n1.url.slice(0, 78)}`);
    lines.push(`   snip: ${(n1.snippet || "").slice(0, 90)}`);
    lines.push(`   goldInOldTop20@rank=${oj.refs.findIndex(r => matchEvidence(hay1(r), oj.answers)) + 1} goldInNewTop20@rank=${nj.refs.findIndex(r => matchEvidence(hay1(r), nj.answers)) + 1}`);
  }
  return { lines, tally };
}

const a1 = attr("nq", OLDNQ, NEWNQ);
const a2 = attr("tqa", OLDT, NEWT);
const out = [];
out.push("批 37 窗口翻转逐案归因 (b34win → b37win, SC_RERANK=1, 同题集)");
out.push("判定签名: b37-fix/b37-reg=同URL snippet 变(改动涉入); 其余=上游(出池/换血/降位)");
out.push("");
out.push(`NQ tally: ${JSON.stringify(a1.tally)}`);
out.push(`TQA tally: ${JSON.stringify(a2.tally)}`);
out.push("");
out.push(...a1.lines, ...a2.lines);
fs.writeFileSync("/tmp/eval-rerank/b37-window-attrib.txt", out.join("\n"));
console.log(out.slice(0, 6).join("\n"));
console.log("明细 -> /tmp/eval-rerank/b37-window-attrib.txt");
