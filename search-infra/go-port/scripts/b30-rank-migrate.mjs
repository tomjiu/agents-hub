// b30-rank-migrate.mjs — 批 30: ON 窗 dump rank 字段按数组序(交付序)重编号
// 背景: b27 重排上线后二进制输出的 refs 数组序=重排交付序, 但 rank 字段残留融合层旧值;
//       dump 脚本信任 r.rank 落盘 → drift goldAt 按 rank 排序把重排撤销, gold@1 假性回落。
// 修法: 数组序才是 eval 口径(在线评测拿到的 refs 数组即交付序), rank 字段按 i+1 重编号。
//       原始文件备份 *-rawrank-b30.txt; 本迁移幂等(重跑结果不变)。
import fs from "node:fs";
for (const p of ["/tmp/eval-rerank/nq-dump.jsonl", "/tmp/eval-rerank/triviaqa-dump.jsonl"]) {
  const lines = fs.readFileSync(p, "utf8").trim().split("\n").map(l => JSON.parse(l));
  let changed = 0;
  for (const row of lines) {
    if (!row.refs) continue;
    row.refs.forEach((r, i) => { if (r.rank !== i + 1) { r.rank = i + 1; changed++; } });
  }
  fs.writeFileSync(p, lines.map(l => JSON.stringify(l)).join("\n") + "\n");
  console.log(`${p}: ${lines.length} 行, 重编号 ${changed} 个 ref`);
}
