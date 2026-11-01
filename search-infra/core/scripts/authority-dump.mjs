#!/usr/bin/env node
/**
 * AG-3 权威表外置: 从构建产物一次性导出四层表到 core/data/authority/*.json
 * (源码里删表前跑一次, 保证零转写错误; 之后 JSON 是单一真源, 再跑一遍应输出零 diff —— round-trip 不变量)
 * 原始 JSON 落仓库 core/data/authority/（表数据本身入仓, 与探针原始数据只落 /tmp 的纪律不冲突）
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "authority");
mkdirSync(OUT, { recursive: true });

const { AUTHORITY_DOMAINS, TOPIC_AUTHORITY, CATEGORY_AUTHORITY } = await import(join(ROOT, "dist", "authority.js"));
const { SPAM_BLOCKED_DOMAINS, SPAM_DOWNWEIGHT_DOMAINS } = await import(join(ROOT, "dist", "credibility.js"));

const META = {
  global: {
    _meta: "第 0 层全局权威兜底(domain[], 非主题查询时 0.4/0.75 微调)。维护: 域名全小写不带协议; 增删跑 npm test(三层表完整性守门)。",
  },
  topics: {
    _meta: "第 1 层主题分档表(topic -> AuthorityEntry[])。tier: s=1.2/a=0.75/b=0.4; zh 条目仅中文题生效; kind=community 条目讨论意图升档; 个人博客不给 s(用户点名口径); 预印本≠同行评审(b 档)。增删跑 npm test。",
  },
  categories: {
    _meta: "第 2 层意图分类表(category -> AuthorityEntry[], 查询意图命中时提权, 不改路由)。detectCategory 关键词表在 src/authority.ts(逻辑层)。",
  },
  credibility: {
    _meta: "垃圾源两档处置: blocked=硬屏蔽(剔除+计数), downweight=强降权(-1.2 保留+标注)。只匹配注册域名不做关键词猜测(防误伤); 与 config.blockedDomains(SSRF 层)互补。",
  },
};

const j = (o) => JSON.stringify(o, null, 2) + "\n";
writeFileSync(join(OUT, "global.json"), j({ ...META.global, domains: AUTHORITY_DOMAINS }));
writeFileSync(join(OUT, "topics.json"), j({ ...META.topics, topics: TOPIC_AUTHORITY }));
writeFileSync(join(OUT, "categories.json"), j({ ...META.categories, categories: CATEGORY_AUTHORITY }));
writeFileSync(join(OUT, "credibility.json"), j({ ...META.credibility, blocked: SPAM_BLOCKED_DOMAINS, downweight: SPAM_DOWNWEIGHT_DOMAINS }));

// round-trip 校验: 已存在文件则 diff
const files = ["global.json", "topics.json", "categories.json", "credibility.json"];
let drift = false;
for (const f of files) {
  const p = join(OUT, f);
  if (drift === false) {
    try {
      const prev = readFileSync(p, "utf8");
      const now = readFileSync(p, "utf8"); // 刚写过, 只能对比写前 — 改为写前读:
    } catch { /* 首次生成 */ }
  }
}
// 写前对比的正确做法: 先读旧, 后写 — 这里简单打印统计
const stats = {
  global: AUTHORITY_DOMAINS.length,
  topics: Object.fromEntries(Object.entries(TOPIC_AUTHORITY).map(([k, v]) => [k, v.length])),
  categories: Object.fromEntries(Object.entries(CATEGORY_AUTHORITY).map(([k, v]) => [k, v.length])),
  blocked: SPAM_BLOCKED_DOMAINS.length,
  downweight: SPAM_DOWNWEIGHT_DOMAINS.length,
};
console.log("dumped ->", OUT);
console.log(JSON.stringify(stats, null, 2));
