#!/usr/bin/env node
/**
 * 智谱系搜索来源逆向挖掘 (phase AC, 用户指令: "通过智谱清言的搜索结果逆向他的网站来源补充,
 * 记得根据来源分类而不是每次都用全量库")
 *
 * 做什么: 按类目采样 z-ai 托管 web_search(智谱系搜索 API, 清言同源近似口径),
 * 聚合 host_name 频次 → 输出"每类目高频来源榜" → 人工甄别后并入 authority.ts
 * TOPIC_AUTHORITY(分类权威表, 按类路由提权, 非全量库全局提权)。
 *
 * 诚实口径:
 * - 采样源是 z-ai CLI 的 web_search 托管函数, 不是清言网页产品本身——同源近似, 不是精确复刻;
 * - 原始 JSON 只落 /tmp/zhipu-mining(不入仓), 本脚本只输出聚合统计;
 * - 高频 ≠ 高质: csdn/百家号类灌水站即使高频也不入权威表(credibility 已硬屏蔽),
 *   入表只看"是否对 agent 有提取价值的正主站点"。
 *
 * 用法: node core/scripts/zhipu-source-mining.mjs [--num 10]
 * 依赖: z-ai CLI 在 PATH(沙箱已验证)。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = "/tmp/zhipu-mining";
const num = Number(process.argv[2] === "--num" ? process.argv[3] : 10) || 10;

/**
 * 采样题组(按类目)。设计原则:
 * - 每类 2-4 题, 覆盖中英双面(zh 是本轮重点——Phase Z/zh-check 实测差距在中文教程厚度);
 * - 题目用自然问法(模拟真实用户), 不塞 site: 等操作符;
 * - zh-programming 4 题对应 zh-check 五连的薄弱面(教程池厚度)。
 */
const SAMPLES = [
  // zh 编程(教程/报错两类意图)
  { cat: "zh-programming", q: "python asyncio 教程" },
  { cat: "zh-programming", q: "rust 入门教程" },
  { cat: "zh-programming", q: "docker compose 报错怎么解决" },
  { cat: "zh-programming", q: "pydantic v2 用法" },
  // en 编程(对照: 看英文面他依赖谁)
  { cat: "en-programming", q: "python asyncio tutorial" },
  { cat: "en-programming", q: "rust async runtime tokio guide" },
  // 学术
  { cat: "academic", q: "retrieval augmented generation survey paper" },
  { cat: "academic", q: "transformer 注意力机制 论文" },
  // 新闻
  { cat: "news", q: "OpenAI 最新新闻" },
  { cat: "news", q: "NVIDIA latest news" },
  // 通用事实
  { cat: "general", q: "rust 语言是什么" },
  { cat: "general", q: "what is retrieval augmented generation" },
  // zh 通用(生活/概念, 看通用中文面)
  { cat: "zh-general", q: "向量数据库是什么" },
  { cat: "zh-general", q: "上海 养老金 调整 2026" },
];

import { readFileSync } from "node:fs";
function callWebSearch2(query) {
  const outfile = join(OUT_DIR, `raw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`);
  const r = spawnSync("z-ai", ["function", "-n", "web_search", "-a", JSON.stringify({ query, num }), "-o", outfile], {
    encoding: "utf8", timeout: 60_000,
  });
  if (r.status !== 0) {
    return { error: `exit ${r.status}: ${(r.stderr || r.stdout || "").slice(0, 120)}` };
  }
  try {
    return JSON.parse(readFileSync(outfile, "utf8"));
  } catch (e) {
    return { error: `parse: ${e.message}` };
  }
}

const byCat = new Map();
let okCount = 0, failCount = 0;

for (const { cat, q } of SAMPLES) {
  const items = callWebSearch2(q);
  if (!Array.isArray(items)) {
    failCount++;
    console.error(`[FAIL] ${cat} "${q}": ${items.error}`);
    continue;
  }
  okCount++;
  if (!byCat.has(cat)) byCat.set(cat, new Map());
  const freq = byCat.get(cat);
  const perQuery = [];
  for (const it of items) {
    const host = (it.host_name || "").toLowerCase().replace(/^www\./, "");
    if (!host) continue;
    perQuery.push({ rank: it.rank, host, url: it.url, title: it.name });
    freq.set(host, (freq.get(host) ?? 0) + 1);
  }
  console.log(`[OK] ${cat} "${q}" -> ${perQuery.length} 条 (top3: ${perQuery.slice(0, 3).map((p) => p.host).join(", ")})`);
}

console.log(`\n=== 采样完成: ${okCount}/${SAMPLES.length} 题, 原始 JSON 在 ${OUT_DIR} ===\n`);
console.log("=== 每类目 host 频次榜(num>=2 的才列出; 括号=出现次数/总条数) ===\n");

const report = {};
for (const [cat, freq] of byCat) {
  const total = [...freq.values()].reduce((a, b) => a + b, 0);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  report[cat] = { total, hosts: Object.fromEntries(sorted) };
  const shown = sorted.filter(([, n]) => n >= 2);
  console.log(`## ${cat} (${total} 条)`);
  if (shown.length === 0) console.log("  (无重复 host, 全部长尾)");
  for (const [host, n] of shown) console.log(`  ${host} ×${n} (${((n / total) * 100).toFixed(0)}%)`);
  console.log("");
}

writeFileSync(join(OUT_DIR, "aggregate.json"), JSON.stringify(report, null, 2));
console.log(`聚合统计已写 ${OUT_DIR}/aggregate.json (仍不入仓, 结论由人工甄别后进 authority.ts)`);
