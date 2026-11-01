/**
 * vs-zai 全量题库 v1 (用户指令: "进行更多题目的测试起码20道各个领域的题目")
 *
 * 25 题覆盖设计(每题标注所属领域面):
 *   - topic 专线 7/7: programming(en+zh) / packages(npm+pypi) / devops×2 / academic / ai-models / entities / images
 *   - category 类 10/10: news / security / legal(zh) / finance / medical(en+zh) / databases / design / dictionary / education / data
 *   - 横切意图 3: community(reddit) / zh-tutorial / zh-fact
 *
 * 诚实口径:
 *   - topic 由题面给定(等价 planner 决策, 与内置 9 题同口径);
 *   - category 优先用题面指认(category 字段), 缺省走 detectCategory 运行时——两种都
 *     对两侧同尺生效, 不构成偏袒;
 *   - expect 只做 L1 合法性哨兵(top-5 是否切题), 不参与质量分档。
 */
export const CASES = [
  // ---------- topic 专线面(7/7) ----------
  { q: "rust lifetimes explained with examples", topic: "programming", expect: ["lifetime"], type: "en-programming" },
  { q: "golang goroutine 泄漏 排查 pprof", topic: "programming", lang: "zh", expect: ["goroutine"], type: "zh-programming" },
  { q: "zod npm package schema validation", topic: "packages", expect: ["zod"], type: "packages-npm" },
  { q: "fastapi python async framework", topic: "packages", expect: ["fastapi"], type: "packages-pypi" },
  { q: "github actions cache docker layers", topic: "devops", expect: ["actions", "cache"], type: "devops" },
  { q: "kubernetes helm chart vs kustomize", topic: "devops", expect: ["helm", "kustomize"], type: "devops" },
  { q: "diffusion probabilistic models paper ho 2020", topic: "academic", expect: ["diffusion"], type: "academic" },
  { q: "claude vs gpt context window comparison", topic: "ai-models", expect: ["context"], type: "ai-models" },
  { q: "who created the C programming language", topic: "entities", expect: ["ritchie"], type: "fact" },
  { q: "unsplash pexels free stock photos api comparison", topic: "images", expect: ["unsplash", "pexels"], type: "images" },

  // ---------- category 类目面(10/10) ----------
  { q: "EU AI Act implementation timeline latest news", category: "news", expect: ["ai act"], type: "news" },
  { q: "log4j CVE-2021-44228 mitigation guide", category: "security", expect: ["log4j", "44228"], type: "security" },
  { q: "个人信息保护法 数据跨境 规定", lang: "zh", category: "legal", expect: ["个人信息保护", "跨境"], type: "zh-legal" },
  { q: "federal reserve interest rate decision 2026", category: "finance", expect: ["fed", "rate"], type: "finance" },
  { q: "metformin side effects long term", category: "medical", expect: ["metformin"], type: "medical" },
  { q: "阿司匹林 肠溶片 什么时候吃", lang: "zh", category: "medical", expect: ["阿司匹林"], type: "zh-medical" },
  { q: "mysql utf8mb4 collation difference", category: "databases", expect: ["utf8mb4"], type: "databases" },
  { q: "design tokens figma vs tailwind comparison", category: "design", expect: ["figma", "design token"], type: "design" },
  { q: "ubiquitous meaning etymology", category: "dictionary", expect: ["ubiquitous"], type: "dictionary" },
  { q: "khan academy linear algebra course", category: "education", expect: ["linear algebra"], type: "education" },
  { q: "world bank open data gdp api", category: "data", expect: ["world bank"], type: "data" },

  // ---------- 横切意图面(3) ----------
  { q: "vim vs emacs which better reddit", expect: ["vim"], type: "community" },
  { q: "pandas 合并多个 excel 文件 教程", topic: "programming", lang: "zh", expect: ["pandas"], type: "zh-tutorial" },
  { q: "量子计算 是什么 原理", lang: "zh", expect: ["量子"], type: "zh-fact" },
];
