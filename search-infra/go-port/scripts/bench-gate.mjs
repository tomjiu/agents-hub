/**
 * bench-gate.mjs — go-port L1 质量门禁 bench (24 题, 对齐 b8 批题库)
 *
 * L1=搜索层(title+snippet) 关键词命中制; 指标: hits/total, uniqDom 均值, 引擎出勤均值, 延迟均值。
 * 诚实口径: 命中≠真解决(代理指标); uniqDom 是广度代理(域名去重数)。
 * 原始 JSON 落 /tmp/bench-b9-<label>.json(不入仓), stdout 抄结论入报告。
 *
 * 用法: node scripts/bench-gate.mjs <binary> [--label run1] [--cold(绕缓存无关, 仅标记)]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const BIN = process.argv[2] || "/tmp/sc9";
const labelIdx = process.argv.indexOf("--label");
const label = labelIdx > -1 ? process.argv[labelIdx + 1] : "run1";

// 24 题题库(逐题拷贝自 b8 批 bench-b8-run1.json, q/type/expect 不变)
const CASES = [
  { q: "rust lifetimes explained with examples", type: "en-programming", expect: ["lifetime"] },
  { q: "golang goroutine 泄漏 排查 pprof", type: "zh-programming", expect: ["goroutine"] },
  { q: "zod npm package schema validation", type: "packages-npm", expect: ["zod"] },
  { q: "fastapi python async framework", type: "packages-pypi", expect: ["fastapi"] },
  { q: "github actions cache docker layers", type: "devops", expect: ["actions"] },
  { q: "kubernetes helm chart vs kustomize", type: "devops", expect: ["helm"] },
  { q: "diffusion probabilistic models paper ho 2020", type: "academic", expect: ["diffusion"] },
  { q: "claude vs gpt context window comparison", type: "ai-models", expect: ["context"] },
  { q: "who created the C programming language", type: "fact", expect: ["ritchie"] },
  { q: "unsplash pexels free stock photos api comparison", type: "images", expect: ["unsplash"] },
  { q: "EU AI Act implementation timeline latest news", type: "news", expect: ["ai act"] },
  { q: "log4j CVE-2021-44228 mitigation guide", type: "security", expect: ["log4j"] },
  { q: "个人信息保护法 数据跨境 规定", type: "zh-legal", expect: ["个人信息保护"] },
  { q: "federal reserve interest rate decision 2026", type: "finance", expect: ["fed"] },
  { q: "metformin side effects long term", type: "medical", expect: ["metformin"] },
  { q: "阿司匹林 肠溶片 什么时候吃", type: "zh-medical", expect: ["阿司匹林"] },
  { q: "mysql utf8mb4 collation difference", type: "databases", expect: ["utf8mb4"] },
  { q: "design tokens figma vs tailwind comparison", type: "design", expect: ["figma"] },
  { q: "ubiquitous meaning etymology", type: "dictionary", expect: ["ubiquitous"] },
  { q: "khan academy linear algebra course", type: "education", expect: ["linear algebra"] },
  { q: "world bank open data gdp api", type: "data", expect: ["world bank"] },
  { q: "vim vs emacs which better reddit", type: "community", expect: ["vim"] },
  { q: "pandas 合并多个 excel 文件 教程", type: "zh-tutorial", expect: ["pandas"] },
  { q: "量子计算 是什么 原理", type: "zh-fact", expect: ["量子"] },
];

const host = (u) => { try { return new URL(u).hostname; } catch { return "?"; } };

const rows = [];
for (const c of CASES) {
  const t0 = Date.now();
  const p = spawnSync(BIN, ["search", c.q, "--json", "true", "--topn", "10", "--timeout", "20000"], {
    timeout: 60_000, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  });
  const ms = Date.now() - t0;
  let out = null;
  try { out = JSON.parse(p.stdout); } catch { /* stderr 落 row */ }
  if (!out || !Array.isArray(out.refs)) {
    rows.push({ q: c.q, type: c.type, hit: false, err: (p.stderr || "no json").slice(0, 120), ms });
    continue;
  }
  const refs = out.refs;
  const hay = refs.map(r => `${r.title}\n${r.snippet}`).join("\n").toLowerCase();
  const hitWord = c.expect.find(e => hay.includes(e.toLowerCase())) ?? null;
  const uniqDom = new Set(refs.map(r => host(r.url))).size;
  const used = (out.enginesUsed || []).length;
  rows.push({
    q: c.q, type: c.type, hit: hitWord !== null, hitWord,
    nRefs: refs.length, uniqDom, used, failed: (out.enginesFailed || []).length,
    ms: out.elapsedMs ?? ms,
  });
  const mark = hitWord ? "HIT " : "MISS";
  console.log(`${mark} [${c.type}] ${c.q} → ${hitWord ?? "—"} (refs=${refs.length}, uniqDom=${uniqDom}, engines=${used}, ${rows.at(-1).ms}ms)`);
}

const hits = rows.filter(r => r.hit).length;
const valid = rows.filter(r => !r.err);
const uniqDomAvg = valid.length ? valid.reduce((s, r) => s + r.uniqDom, 0) / valid.length : 0;
const enginesAvg = valid.length ? valid.reduce((s, r) => s + r.used, 0) / valid.length : 0;
const msAvg = valid.length ? valid.reduce((s, r) => s + r.ms, 0) / valid.length : 0;

console.log(`\nL1 ${hits}/${rows.length} ${hits === rows.length ? "ALL HIT" : "!! FAIL"}`);
console.log(`广度: uniqDom 均值 ${uniqDomAvg.toFixed(2)} | 引擎出勤均值 ${enginesAvg.toFixed(1)} | 延迟均值 ${Math.round(msAvg)}ms`);

const json = { hits, total: rows.length, uniqDomAvg, enginesAvg, msAvg, rows, at: new Date().toISOString() };
fs.writeFileSync(`/tmp/bench-b9-${label}.json`, JSON.stringify(json, null, 1));
console.log(`原始 JSON: /tmp/bench-b9-${label}.json`);
