// analyze-external-miss.mjs — 批 18-A: 外部基准 miss 题逐题导出, 供人工归因分类
// 分类维度(人工判): ①零输出(enginesUsed 空) ②排序 miss(gold 不在 top10 title+snippet 但 top1 相关)
// ③检索跑偏(top1 明显无关) ④数据集过期/时效漂移 ⑤语料天花板(web 上无此答案)
// 用法: node scripts/analyze-external-miss.mjs [--dataset nq]
import fs from "node:fs";

const argStr = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const DS = argStr("--dataset", "nq");
const FILE = `/tmp/eval-external/${DS}.jsonl`;

const rows = fs.readFileSync(FILE, "utf8").trim().split("\n").map(JSON.parse);
const n = rows.length;
const hit1 = rows.filter(r => r.hitRank === 1).length;
const hit3 = rows.filter(r => r.hitRank && r.hitRank <= 3).length;
const hit10 = rows.filter(r => r.hit10).length;
const zeroOut = rows.filter(r => r.err || r.nRefs === 0).length;
const miss = rows.filter(r => !r.hit10);

console.log(`== ${DS} n=${n}: hit@1=${(hit1/n*100).toFixed(1)}% hit@3=${(hit3/n*100).toFixed(1)}% hit@10=${(hit10/n*100).toFixed(1)}% | miss=${miss.length} 零输出=${zeroOut} ==\n`);

for (const r of miss) {
  console.log(`Q: ${r.q}`);
  console.log(`   gold: ${r.answers.slice(0, 3).join(" | ")}${r.answers.length > 3 ? " ..." : ""}`);
  console.log(`   top1: ${r.top1 ? `${r.top1.title.slice(0, 70)} (${r.top1.url.slice(0, 60)})` : "(none)"}`);
  console.log(`   engines: [${(r.enginesUsed || []).join(",")}] nRefs=${r.nRefs} err=${r.err ? "Y" : "-"}`);
  console.log("");
}
