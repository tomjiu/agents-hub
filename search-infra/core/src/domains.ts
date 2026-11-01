/**
 * 域名路由表 v0.6 — 用户提案"AI 维护动态域名表"落地(设计定稿见
 * analysis/search-landscape/e-ai-invocable-domain-routing.md §3)。
 *
 * 思想: 通用引擎是"撒大网", 域名表是"指定鱼塘钓鱼"——
 * - Tier1 有免 key API 的领域 → apiProviders 直连(官方欢迎调用, 不会被反爬封, 37ms-1s 级)
 * - Tier2 无 API 的权威域 → site: 前缀交给通用引擎(googlenews 的 site: 已实测有效)
 * - Tier3 表未命中 → 通用池兜底(planner 原有 web 路由)
 *
 * 克制条款(诚实设计):
 * - 表变化慢, 真正动态的是健康状态 → 生死归 breaker, 本表只管"去哪找";
 * - 新条目必须过 smoke(真实打一发验证 tier/provider 判断)才入表, 防 LLM 幻觉造域名;
 * - 长尾问题没有权威域 → 别硬路由, 留给 Tier3;
 * - 表在 git 里 = 变更可审查可回滚(SC_DOMAINS_JSON 可外挂覆盖, 后续版本)。
 */

export interface DomainTopic {
  /** Tier1: 免 key API 直连 provider 名(必须是 buildProviders 里已注册的名字) */
  apiProviders: string[];
  /** Tier2: 无 API 的权威域(拼 `${query} site:${domain}`) */
  siteTargets: string[];
  /** site: 查询派给哪些通用引擎(选 1-2 个省预算; 少于等于 siteTargets 时循环复用) */
  siteEngines: string[];
  /** 触发关键词(小写子串匹配; 关键词要选不易误伤的) */
  keywords: string[];
}

/**
 * 种子表(2026-09-03, 7 领域 15 个 Tier1 provider + 1 个 site 域)。
 * 表序即优先级: packages/devops(窄关键词,必须先判防 programming 的 " npm "/"docker" 宽词截胡)
 *   > programming > academic > ai-models > entities > images。
 * 维护约定: 每条新领域/新 provider 进表前先跑 scripts/probe-v0*.mjs 验证。
 */
export const DOMAIN_TABLE: Record<string, DomainTopic> = {
  // 包管理器(跨语言): npm(JS) + crates(Rust) + packagist(PHP) + rubygems(Ruby)
  // 放表首: programming 的 " npm "/"rust " 宽关键词会截胡包意图查询, 窄关键词必须先判。
  // PyPI 无官方 search API(XML-RPC 已关停) → 不做 HTML 爬; phase AG-1: JSON API 包名精确
  // 查询接进腿(pypi, 非包名查询合法空), python 包关键词先路由进 packages 主题再混源搜。
  packages: {
    apiProviders: ["npm", "crates", "packagist", "rubygems", "pypi"],
    siteTargets: [],
    siteEngines: ["duckduckgo"],
    keywords: [
      "npm 包", "npm package", "best npm", "crates.io", "rust crate", "cargo 依赖", "cargo 包",
      "packagist", "composer 包", "php 包", "rubygems", "ruby gem", "哪个包", "包推荐", "替代包",
      "包管理器", "package manager", "library recommendation", "库推荐",
      "pypi", "pip 包", "python 包",
    ],
  },
  // 容器/DevOps: Docker Hub 镜像搜索
  devops: {
    apiProviders: ["dockerhub"],
    siteTargets: [],
    siteEngines: ["duckduckgo"],
    keywords: [
      "docker 镜像", "容器镜像", "docker image", "container image", "官方镜像",
      "docker hub", "镜像推荐", "哪个镜像", "base image",
    ],
  },

  // 编程: StackExchange API 免 key 300/天(注册 key 10000/天) + github 专项 + HN 讨论
  // phase Z(对照实测教训): 三条英文系腿对中文教程题太脆——"python asyncio 教程"实测
  // stackexchange error + ddg rate_limited 后整题塌到 bingrss 单腿 L1=miss(vs-zai 对比轮唯一败题)。
  // keenable 进编程腿: 免 key 独立索引、中文能力强(第 5 轮 milvus 中文题翻绿主力)、426ms/9-0 健康,做保底。
  // phase AA(对照轮增量): mdn 直连 API 进 Tier1(原 Tier2 site:developer.mozilla.org 升级——
  // 探针 200/documents[10]/locale=zh-CN 中文内容坐实); site: 槽位补 docs.python.org
  // (asyncio 对比轮 zai 侧 top 里的官方文档面, bingrss site: 探针 200 坐实)。
  programming: {
    apiProviders: ["stackexchange", "github", "hn", "keenable", "mdn"],
    siteTargets: ["docs.python.org"],
    siteEngines: ["duckduckgo", "bingrss"],
    keywords: [
      // 语言/框架名(小写子串)
      "python", "javascript", "typescript", "nodejs", "node.js", " npm ", "react", "vue",
      "rust ", "rust-", "golang", " golang", "java ", "kotlin", "swift", "c++", "c#",
      "css", "html", "sql", "regex", "正则", "async", "docker", "kubernetes", "git ",
      // 编程意图词(中英)
      "报错", "编译错误", "运行报错", "error:", "exception", "stack trace", "堆栈",
      "修复", "debug", "how to fix", "api 调用", "库推荐", "教程", "tutorial",
      "安装依赖", "dependency", "pip install", "npm install", "配置文件", "语法",
    ],
  },
  // 学术: arXiv 预印本 + Crossref 引文(带被引数) + OpenAlex(OA 链接+被引) + DBLP(CS 会议目录)
  //   + PubMed(生物医学, phase AB) + Wikipedia 背景
  //   (arXiv 刷屏治理: pubmed/openalex/dblp 多腿稀释, 第 8 轮 bench 观察是否还需 topic 感知 domainCap)
  //   phase AG-1: hfpapers 进腿(HF Papers AI 论文面, arXiv 号直链, AI 题再添一腿稀释)
  academic: {
    apiProviders: ["arxiv", "crossref", "openalex", "dblp", "pubmed", "wikipedia", "hfpapers"],
    siteTargets: [],
    siteEngines: ["duckduckgo"],
    keywords: [
      "论文", "文献", "arxiv", "preprint", "citation", "被引", "引用数", "impact factor",
      "survey paper", "state of the art", "benchmark 论文", "ablation", "模型架构论文",
      // phase AG-1: " paper" 带前导空格(en 学术题路由; "newspaper"/"whitepaper" 不带空格不误伤)
      " paper",
    ],
  },
  // AI 模型资产: HuggingFace 模型权重(按下载量排序)
  "ai-models": {
    apiProviders: ["huggingface"],
    siteTargets: [],
    siteEngines: ["duckduckgo"],
    keywords: [
      "huggingface", "开源模型", "模型权重", "预训练模型", "开源 llm", "开源大模型",
      "模型下载", "download model", "model weights", "open weights", "base model",
    ],
  },
  // 实体背景(表尾最低优先): Wikidata 实体搜索 — agent 背景调查/消歧; 误伤成本低(快且免 key)
  entities: {
    apiProviders: ["wikidata"],
    siteTargets: [],
    siteEngines: ["duckduckgo"],
    keywords: [
      "who is", "是谁", "什么人", "创始人", "founder of", "ceo of", "cto of",
      "人口", "population of", "capital of", "首都", "wikidata",
    ],
  },
  // 地理/地点(phase AD): Nominatim(OSM 官方地理编码) + Wikidata 背景。
  // 放 entities 之后: "人口/首都"类仍先走 entities(wikidata 语义);"在哪/坐标/地址"类进本腿。
  geo: {
    apiProviders: ["nominatim", "wikidata"],
    siteTargets: [],
    siteEngines: ["duckduckgo"],
    keywords: [
      "在哪", "位置", "坐标", "地址", "地标", "地图", "经纬度",
      "where is", "location of", "coordinates", "address of", "landmark", "geocode",
    ],
  },
  // 图片: Openverse(CC 授权, kind:image) — kind 由 provider 自己标, 查表只管路由
  images: {
    apiProviders: ["openverse"],
    siteTargets: [],
    siteEngines: ["duckduckgo"],
    keywords: ["图片", "照片", "配图", "图搜", "cc 图片", "可商用图片", "stock photo", "image of"],
  },
  // 安全(phase AJ 探针第 3 批, 攻附录 G 诚实剩余「security 官方源召回面差距」):
  // CVE 编号直取三腿(NVD/OSV/GHSA 官方元数据, 无编号合法空零请求) + 聚合兜底腿(laneLegProviders)。
  // 放表尾不遮蔽既有主题; 锚只收强安全意图(cve- 前缀/漏洞/exploit 等)。
  security: {
    apiProviders: ["nvd", "osv", "ghsa"],
    siteTargets: [],
    siteEngines: ["duckduckgo"],
    keywords: [
      "cve-", "cve ", "漏洞", "exploit", "rce", "0-day", "0day", "vulnerability",
      "安全公告", "security advisory", "ransomware", "勒索", "攻击样本",
    ],
  },
  // 新闻(phase AJ): googlenews + bingnews 双 RSS 腿 + 聚合兜底腿。
  // 锚只收强新闻意图: " news " 独立词(" npm " 同款双空格纪律, 防 newsletter 误配);
  // 不收"最新进展"(AI/学术查询常用语, 会把非新闻题劫进新闻腿 — 保守审计决定)。
  news: {
    apiProviders: ["googlenews", "bingnews"],
    siteTargets: [],
    siteEngines: ["duckduckgo"],
    keywords: [
      " news ", "latest news", "breaking news", "news today", "top news", "world news",
      "快讯", "最新消息", "新闻",
    ],
  },
  // 词典(phase AM 探针第 4 批): Wiktionary API(en+zh 双语词义/词源/释义, 零命中合法空)。
  // 锚只收强查词意图: "什么意思"/"etymology"/"meaning of" — 不收裸"定义"/"define"
  // (编程查询 "接口定义"/"define function" 高频, 劫持成本高); 编程题由表序先行(programming 在前)。
  dictionary: {
    apiProviders: ["wiktionary"],
    siteTargets: [],
    siteEngines: ["duckduckgo"],
    keywords: [
      "什么意思", "是什么意思", "意思是", "释义", "词源", "词典", "词条",
      "meaning of", "definition of", "etymology", "word origin", "dictionary",
    ],
  },
  // 医学研究(phase AM): Europe PMC + ClinicalTrials.gov 双腿(生物医学文献/试验注册, 官方 API)。
  // 锚只收研究意图(临床/循证) — 药名/副作用题不进线(那是 generic 池 + medlineplus 表提权,
  // 24 题阿司匹林/metformin 题实证): 把医学题全劫进 PubMed 面会毁 zh 健康内容广度。
  medical: {
    apiProviders: ["europepmc", "clinicaltrials"],
    siteTargets: [],
    siteEngines: ["duckduckgo"],
    keywords: [
      "clinical trial", "clinical study", "randomized", "meta-analysis", "systematic review",
      "cohort study", "pubmed", "europe pmc",
      "临床试验", "随机对照", "荟萃分析", "系统综述", "循证",
    ],
  },
  // 数据(phase AM): World Bank API v2(指标码+国家码直取, pypi/CVE 纪律: 未知指标合法空零请求)。
  // 锚只收强官方统计意图; 指标/国家由 provider 内小保守映射管("查什么"), 表锚管"进不进线"。
  data: {
    apiProviders: ["worldbank"],
    siteTargets: [],
    siteEngines: ["duckduckgo"],
    keywords: [
      "world bank", "worldbank", "开放数据", "open data", "宏观数据",
      "统计数据", "statistics data", "统计年鉴", "世界银行",
    ],
  },
};

export interface DomainRoute {
  topic: string;
  apiProviders: string[];
  siteQueries: string[];
  siteEngines: string[];
}

/**
 * v0.8 质量评测 case-4: packages 主题按语言信号裁剪腿 —
 * "rust crate async runtime tokio" 不再空跑 npm/packagist/rubygems 腿
 * (npm 对 rust 查询返回纯噪音, 实测 @ubjs/node/regenerator-runtime 占坑)。
 * 无信号 → 全腿兕底(混合查询不丢面)。
 */
const PACKAGE_LANG_SIGNALS: { signals: string[]; provider: string }[] = [
  { signals: ["rust", "cargo", "crate"], provider: "crates" },
  { signals: ["npm", "node", "nodejs", "node.js", "javascript", "typescript"], provider: "npm" },
  { signals: ["php", "composer", "packagist"], provider: "packagist" },
  { signals: ["ruby", "rubygems", "gemfile"], provider: "rubygems" },
];

export function condensePackagesLeg(query: string, apiProviders: string[]): string[] {
  const low = query.toLowerCase();
  for (const { signals, provider } of PACKAGE_LANG_SIGNALS) {
    if (signals.some((s) => low.includes(s))) {
      const pick = apiProviders.filter((p) => p === provider);
      if (pick.length) return pick; // 信号命中且该 provider 在腿里 → 单腿
    }
  }
  return apiProviders;
}

/**
 * phase AB: 中文题强化腿 — 查询含 CJK 才追加的源(纯英文题打它们是噪音)。
 * 现: sov2ex(V2EX 社区, 中文技术讨论质量高, 英文内容占比低)。
 * planner 的 decision.lang 是全局语言标记; 这里按查询本身判(域路由在 planner 前层, 拿得到原文)。
 */
export function zhBoostProviders(query: string): string[] {
  return /[\u4e00-\u9fff]/.test(query) ? ["sov2ex"] : [];
}

/**
 * 查表路由: 小写子串匹配 keywords(空格 padding 防 "c++" 类词尾误伤已是关键词自带)。
 * 命中多个领域时取第一个(表序即优先级)。未命中返回 null → planner 走原路由。
 * x/github 等显式路由在 planner 里先于本函数判断(专域关键词 > 领域专线)。
 */
export function lookupDomains(query: string, table: Record<string, DomainTopic> = DOMAIN_TABLE): DomainRoute | null {
  const low = ` ${query.toLowerCase().trim()} `;
  for (const [topic, def] of Object.entries(table)) {
    if (!def.keywords.some((k) => low.includes(k.toLowerCase()))) continue;
    const providers = [...def.apiProviders];
    // 编程主题中文题追加 sov2ex 社区腿(英文题不追加, 纯噪音); 其他主题暂不强化
    if (topic === "programming") providers.push(...zhBoostProviders(query));
    return {
      topic,
      // packages 主题按语言信号裁剪腿(质量评测 case-4)
      apiProviders: topic === "packages" ? condensePackagesLeg(query.trim(), providers) : providers,
      // 每个 site 域生成一条子查询; 原查询保留在第 0 条(core.search 按 index 分腿)
      siteQueries: def.siteTargets.map((d) => `${query.trim()} site:${d}`),
      siteEngines: [...def.siteEngines],
    };
  }
  return null;
}

/**
 * phase AE(vs-zai 第 7 采样实证, 附录 D): 专线 leg-0 只跑 apiProviders, 聚合车道
 * (searxng/tavily)永不参与, 窄腿静默时整题塌方(k8s "best practices" 题 MISS 根因,
 * 复跑两次均复现)。programming 混源主题 leg-0 补两条 keyless 聚合兜底腿;
 * registry 专线(packages/devops)保持纯 API 腿不变 — case-4 教训: registry 腿的
 * 域名纯度是特性不是缺陷, 混入 web 聚合会往 cap=0 的容器/包查询里灌博客噪音。
 */
export function laneLegProviders(topic: string, apiProviders: string[]): string[] {
  // images 加入(phase AH 第 11 采样): openverse 单腿对"stock photo api 对比"类查询合法空
  // → 整题塌方(zai 侧 8 独占源 vs core 0); images 非 registry 专线无纯度包袱
  // (AE 教训只保护 packages/devops), 补聚合兜底腿与 programming 同款。
  // security/news 加入(phase AJ): security 官方三腿每腿只出 1 ref(元数据直取非搜索)太薄,
  // news RSS 腿对 niche 查询合法空 — 两类 lane 都必须带聚合兜底防窄腿塌方(images 同款)。
  // dictionary/medical/data 加入(phase AM): wiktionary 生僻词零命中合法空/worldbank 未知
  // 指标合法空零请求/医学双腿对非研究题可能双空 — 单腿塌方同款风险, 均带聚合兜底。
  // images 第 4 兜底腿 keenable(phase AN): 第 17 采样 images 题实证兜底双腿同时掉链
  // (openverse 对 "api comparison" 题面合法空 + tavily rate_limited + 公共 searxng 实例
  // 垃圾轮换三套三样) — keenable 免 key 独立索引对该题实弹验证返回 unsplash.com/developers
  // 官方面 + g2 对比页(AE 加腿同款: 兜底腿多条独立索引, 单实例垃圾轮换不再整题塌方)。
  const fallback = ["searxng", "tavily"];
  if (topic === "images") fallback.push("keenable");
  return ["programming", "images", "security", "news", "dictionary", "medical", "data"].includes(topic)
    ? [...apiProviders, ...fallback]
    : [...apiProviders];
}
