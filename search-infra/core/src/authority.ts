/**
 * 域名权威体系 v3 (phase AC) — 三层数据 + 分档权重 + 意图感知。
 *
 * 用户指令落地("逆向智谱来源按类补充" + "总白名单 v3" + "胆大一点"):
 * 原本只有全局学术表(AUTHORITY_DOMAINS, 通用结果里 +0.4/0.75 一刀切), 现在扩成:
 * - 第 0 层 全局表 AUTHORITY_DOMAINS(沿用, 学术+wiki, 兜底提权);
 * - 第 1 层 主题表 TOPIC_AUTHORITY: 域路由命中 topic 时生效(编程/包/运维/学术/AI/实体);
 * - 第 2 层 意图表 CATEGORY_AUTHORITY: 不改路由, 融合期按查询意图类别提权
 *   (新闻/安全/法律/金融/医疗/数据库/设计/词典/教育/数据)。
 * 三层取最强者计一次分(非叠加), ref.authority 标注命中域名。
 *
 * 分档(user v3 权重 → 本仓融合标定换算, 诚实口径):
 *   user S+/S/A+ → "s" = +1.2 (压过两词词法差 1.0; 官方文档/顶刊/政府/标准组织)
 *   user A/A-    → "a" = +0.75 (=原学术专线量级; GitHub/SO/主流新闻/预印本)
 *   user B+/B    → "b" = +0.4 (=原通用量级; 中文优质站/科技媒体/素材/灵感站)
 * 不采用 user 原始 +5..-3 裸值: 本仓 RRF*10+lex*1.5+consensus 标定下 +5 会让无关官方页
 * 压过一切强相关结果——换算档位保序不破标定。
 *
 * 意图翻转(source_policy 最小版): 查询是"找讨论/经验/观点"时, kind=community 的条目
 * 提到 s 档(官方文档保原档) — "rust 开发者在讨论什么"类查询社区源反超文档, 用户点名场景。
 *
 * 维护约定(沿用): 名单在 git 里可审查; zh 条目只在查询语言=zh 时生效(英文题零误伤);
 * 已知修正在案: djangoproject.com(非 django.project.com)/stratechery.com(非 stratchery)/
 * protocol.com 已停运不收/cbirc.gov.cn → nfra.gov.cn/learn.microsoft.com 收 docs.microsoft.com 不收。
 * 挂账: SC_AUTHORITY_JSON 外挂覆盖、license_status 字段(素材站)、GitHub 仓库级二次判断(stars/更新时间)。
 */

export interface AuthorityEntry {
  domain: string;
  tier: "s" | "a" | "b";
  /** zh 条目仅当查询语言为 zh 时提权(英文题零误伤) */
  lang?: "zh";
  /** 用途维度: official=官方事实源 community=社区讨论 media=媒体 expert=专家观点 reference=参考 */
  kind?: "official" | "community" | "media" | "expert" | "reference";
}


// ---------- AG-3: 表数据外置(core/data/authority/*.json 为单一真源; 本文件只留类型+逻辑+检测关键词) ----------
// 逐条校验: 坏条目跳过+告警(同 SC_AUTHORITY_JSON 纪律); 整文件不可读 → 空表兜底+loud warn(测试守门, 不静默降质);
// SC_AUTHORITY_JSON 外挂(mergeExternalAuthority)仍是最外层运行时覆盖。表的政策注释住在各 JSON 的 _meta 字段。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DOMAIN_SHAPE = /^[a-z0-9.-]+\.[a-z-]{2,}$/;

function loadAuthorityFile(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(fileURLToPath(new URL(`../data/authority/${file}`, import.meta.url)), "utf8")) as Record<string, unknown>;
  } catch (e) {
    console.warn(`[authority] ${file} 加载失败(${e instanceof Error ? e.message : String(e)}), 对应表空兜底 — 包损坏请重装/恢复 JSON`);
    return {};
  }
}

function sanitizeDomains(raw: unknown, file: string): string[] {
  if (!Array.isArray(raw)) { console.warn(`[authority] ${file}: domains 非数组, 空表兜底`); return []; }
  const out: string[] = [];
  for (const d of raw) {
    const s = String(d ?? "").toLowerCase().trim();
    if (!DOMAIN_SHAPE.test(s)) { console.warn(`[authority] ${file}: 非法域名跳过 "${s.slice(0, 40)}"`); continue; }
    out.push(s);
  }
  return out;
}

function sanitizeEntries(raw: unknown, file: string): AuthorityEntry[] {
  if (!Array.isArray(raw)) { console.warn(`[authority] ${file}: entries 非数组, 空表兜底`); return []; }
  const out: AuthorityEntry[] = [];
  for (const r of raw as Partial<AuthorityEntry>[]) {
    const domain = String(r?.domain ?? "").toLowerCase().trim();
    if (!DOMAIN_SHAPE.test(domain)) { console.warn(`[authority] ${file}: 非法条目跳过 "${domain.slice(0, 40)}"`); continue; }
    // 非法/缺失 tier 落 b 档(宁弱勿错, 与外挂 normalizeExternalEntry 同规则); lang/kind 白名单外丢弃
    const tier = r?.tier === "s" || r?.tier === "a" ? r.tier : "b";
    const lang = r?.lang === "zh" ? ("zh" as const) : undefined;
    const kind = (["official", "community", "media", "expert", "reference"] as const).includes(r?.kind as never)
      ? (r?.kind as AuthorityEntry["kind"]) : undefined;
    out.push({ domain, tier, ...(lang ? { lang } : {}), ...(kind ? { kind } : {}) });
  }
  return out;
}

function loadEntryTable(raw: unknown, file: string): Record<string, AuthorityEntry[]> {
  if (!raw || typeof raw !== "object") { console.warn(`[authority] ${file}: 表对象缺失, 空表兜底`); return {}; }
  const out: Record<string, AuthorityEntry[]> = {};
  for (const [k, list] of Object.entries(raw as Record<string, unknown>)) out[k] = sanitizeEntries(list, file);
  return out;
}

export const TIER_BOOST: Record<AuthorityEntry["tier"], number> = { s: 1.2, a: 0.75, b: 0.4 };
const COMMUNITY_INTENT_BOOST = 1.2; // 社区意图下 kind=community 的条目提到此档(=s)

// ---------- 第 0 层: 全局表(学术+wiki 兜底提权; 数据: data/authority/global.json) ----------

export const AUTHORITY_DOMAINS: string[] = sanitizeDomains(loadAuthorityFile("global.json").domains, "global.json");

export function matchAuthority(url: string, table: string[] = AUTHORITY_DOMAINS): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const d of table) {
    if (host === d || host.endsWith("." + d)) return d;
  }
  return null;
}

// ---------- 第 1 层: 主题表(域路由命中 topic 时生效; 数据: data/authority/topics.json, 政策注释在 _meta) ----------

export const TOPIC_AUTHORITY: Record<string, AuthorityEntry[]> = loadEntryTable(loadAuthorityFile("topics.json").topics, "topics.json");

/** 主题表 + 意图表里都可能的域名去重校验用(测试引用) */
export const ALL_TIERED_DOMAINS: string[] = Object.values(TOPIC_AUTHORITY).flat().map((x) => x.domain);

// ---------- 第 2 层: 意图表(不改路由, 融合期按查询意图类别提权) ----------
// 设计: 类别命中只在"通用结果里谁是正主"层面加分, 引擎召回面不变(召回/质量分层 — 用户架构指令)。
// 关键词选不易误伤的(与 DOMAIN_TABLE 同纪律); zh 条目沿用 lang 守卫。

export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  news: ["最新消息", "最新新闻", "新闻", "发布会", "breaking", "latest news", "news", "外媒报道", "时事"],
  security: ["漏洞", "cve", "exploit", "安全通告", "勒索", "渗透", "攻击样本", "vulnerability", "ransomware",
    // phase AI: "sql 注入" 比裸 "sql" 更长最长胜出→ security(裸 sql 查询仍落 databases)
    "sql 注入", "xss"],
  legal: ["法律", "法规", "条文", "判例", "司法解释", "合同条款", "劳动合同", "statute", "regulation", "case law",
    // phase AI(vs-zai r12 诊断): legal 检测在 zh 法条题上失活("个人信息保护法 数据跨境 规定"零命中)
    // 只加无歧义锚: "规定"在 zh 查询里几乎专指法规条款(不含"怎么办/解决"类常见误伤), "条例"同
    "规定", "条例", "个人信息保护"],
  finance: ["股市", "央行", "利率", "财报", "ipo", "基金", "汇率", "通胀", "gdp", "货币政策", "stock market", "inflation", "monetary policy",
    // phase AI: "interest rate" 是无歧义金融锚(vs-zai r12 fed 题检测失活 → 正主前排机会归零)
    "interest rate", "rate decision", "central bank"],
  medical: ["症状", "药物", "治疗", "剂量", "副作用", "诊断", "处方", "symptoms", "dosage", "diagnosis", "treatment",
    // phase AI: "side effect" 无歧义医疗锚(metformin 题失活); "medication" 同; 肠溶/缓释是无歧义药剂词形锚
    "side effect", "medication", "肠溶", "缓释",
    // phase AJ(诚实剩余「zh 药名长尾仍漏」): 常见药名/药类是无歧义医疗锚(只收全名不收缩写,
    // 防误伤; 跨类冲突靠最长关键词胜出消歧 — "疫苗 数据库设计" 仍归 databases)
    "疫苗", "抗生素", "降压药", "胰岛素", "阿司匹林", "布洛芬", "二甲双胍", "过敏",
    "vaccine", "aspirin", "ibuprofen", "metformin", "insulin"],
  databases: ["数据库", "向量库", "向量数据库", "sql 优化", "nosql", "database", "索引优化", "查询优化",
    // phase AI: 数据库品牌/术语是无歧义锚(mysql 题/redis 题检测失活; redis.io/mongodb.com 正是官方文档)
    "collation", "sql", "mysql", "postgres", "mongodb", "redis", "sqlite"],
  design: ["组件库", "图标", "icon", "logo", "配色", "设计系统", "ui 库", "ui kit", "字体", "设计规范", "design system", "插画素材",
    // phase AI: "design token"/"figma"/线框稿是无歧义设计锚(figma 题失活)
    "design token", "figma", "wireframe", "mockup"],
  education: ["公开课", "mooc", "网课", "课程推荐", "online course",
    // phase AI: "academy" 指向课程平台品牌(khan 题失活); 不收裸 "course"(误伤 "of course")
    "academy"],
  dictionary: ["词典", "释义", "词源", "单词意思", "例句", "definition", "etymology"],
  data: ["统计数据", "开放数据", "数据集", "dataset", "统计年鉴", "open data", "statistics"],
};

export const CATEGORY_AUTHORITY: Record<string, AuthorityEntry[]> = loadEntryTable(loadAuthorityFile("categories.json").categories, "categories.json");

// ---------- 意图检测(纯函数, 融合前对原查询跑一次) ----------

/** 社区意图: "找讨论/经验/观点"而非"找事实" — 命中时 kind=community 条目升 COMMUNITY_INTENT_BOOST */
const COMMUNITY_HINTS = [
  "讨论", "怎么看", "怎么看待", "大家怎么", "观点", "争议", "吐槽", "评价", "使用体验", "优缺点",
  "discussion", "opinions", "what do you think", "thoughts on", "experiences with", "hacker news", "reddit",
];

export function detectCommunityIntent(query: string): boolean {
  const low = ` ${query.toLowerCase()} `;
  return COMMUNITY_HINTS.some((h) => low.includes(h));
}

/** 意图类别检测: 多类命中时取【最长关键词】所属类(更具体的锚胜出, 防 "gdp" 抢跑 "open data"),
 *  同长保表序(表序即优先级), 未命中 null。
 *  phase AI(vs-zai r12 诊断): 原实现按表序取首个命中, "world bank open data gdp api" 被 finance
 *  的 "gdp" 抢跑(应为 data); 且 6/10 类目题因关键词覆盖不足返回 null → 类目权威层在生产路径
 *  系统性失活(评测尺用题面指认 category 掩盖了这一点)。修复 = 消歧规则升级 + 保守补词(见上)。
 */
export function detectCategory(query: string, table: Record<string, string[]> = CATEGORY_KEYWORDS): string | null {
  const low = ` ${query.toLowerCase()} `;
  let bestCat: string | null = null;
  let bestLen = 0;
  let order = 0;
  for (const [cat, kws] of Object.entries(table)) {
    // 同类内取最长命中关键词(参与跨类比较); 跨类比最长; 同长保表序(严格 > 使首类胜出)
    let clsLen = 0;
    for (const k of kws) {
      if (k.length > clsLen && low.includes(k.toLowerCase())) clsLen = k.length;
    }
    if (clsLen > bestLen) { bestCat = cat; bestLen = clsLen; }
    order++;
  }
  return bestCat;
}

// ---------- 匹配函数 ----------

/** 段精确匹配(与 matchAuthority 同规则): 子域命中, 伪装域不命中 */
function matchEntry(entry: AuthorityEntry, host: string): boolean {
  const d = entry.domain.toLowerCase();
  return host === d || host.endsWith("." + d);
}

/**
 * 主题表匹配: url 落在该 topic 表内 → 返回命中条目。
 * lang 守卫: entry.lang==="zh" 只在 queryLang==="zh" 时生效。
 * 社区意图翻转: kind=community 条目分档提升(官方档不动)。
 */
export function matchTopicAuthority(
  url: string, topic: string, lang?: string, communityIntent = false,
): { domain: string; boost: number; entry: AuthorityEntry } | null {
  const host = (() => {
    try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
  })();
  if (!host) return null;
  for (const entry of TOPIC_AUTHORITY[topic] ?? []) {
    if (entry.lang === "zh" && lang !== "zh") continue;
    if (!matchEntry(entry, host)) continue;
    const base = TIER_BOOST[entry.tier];
    const boost = communityIntent && entry.kind === "community" ? Math.max(base, COMMUNITY_INTENT_BOOST) : base;
    return { domain: entry.domain, boost, entry };
  }
  return null;
}

/** 意图表匹配: 同上, 作用于 CATEGORY_AUTHORITY */
export function matchCategoryAuthority(
  url: string, category: string, lang?: string, communityIntent = false,
): { domain: string; boost: number; entry: AuthorityEntry } | null {
  const host = (() => {
    try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
  })();
  if (!host) return null;
  for (const entry of CATEGORY_AUTHORITY[category] ?? []) {
    if (entry.lang === "zh" && lang !== "zh") continue;
    if (!matchEntry(entry, host)) continue;
    const base = TIER_BOOST[entry.tier];
    const boost = communityIntent && entry.kind === "community" ? Math.max(base, COMMUNITY_INTENT_BOOST) : base;
    return { domain: entry.domain, boost, entry };
  }
  return null;
}

// ---------- 外挂覆盖 (phase AD): SC_AUTHORITY_JSON / file.authorityOverride ----------
// 用途: 本地改表不改代码(新增/覆盖 tier), 坏配置跳过不阻塞(主链路不裸奔惯例)。
// 形状: {"topics":{"programming":[{"domain":"x.dev","tier":"a","lang":"zh","kind":"community"}]},
//        "categories":{"news":[{"domain":"x.news","tier":"s"}]}}
// 语义: 同表内同域重新声明 = 覆盖(可改 tier/lang/kind); 新域 = 追加。不支持删除内置条目(防误删)。

export interface ExternalAuthorityConfig {
  topics?: Record<string, Partial<AuthorityEntry>[]>;
  categories?: Record<string, Partial<AuthorityEntry>[]>;
}

function normalizeExternalEntry(raw: Partial<AuthorityEntry>): AuthorityEntry | null {
  const domain = String(raw.domain ?? "").toLowerCase().trim();
  if (!DOMAIN_SHAPE.test(domain)) return null;
  const tier = raw.tier === "s" || raw.tier === "a" ? raw.tier : "b"; // 缺省 b 档(最弱提权, 宁弱勿错)
  const lang = raw.lang === "zh" ? "zh" : undefined;
  const kind = ["official", "community", "media", "expert", "reference"].includes(String(raw.kind))
    ? (raw.kind as AuthorityEntry["kind"]) : undefined;
  return { domain, tier, ...(lang ? { lang } : {}), ...(kind ? { kind } : {}) };
}

function mergeIntoTable(
  table: Record<string, AuthorityEntry[]>,
  bucket: Record<string, Partial<AuthorityEntry>[]> | undefined,
): { merged: number; skipped: number } {
  let merged = 0, skipped = 0;
  for (const [key, entries] of Object.entries(bucket ?? {})) {
    const list = table[key] ?? [];
    for (const raw of entries ?? []) {
      const entry = normalizeExternalEntry(raw);
      if (!entry) { skipped++; continue; }
      const idx = list.findIndex((x) => x.domain === entry.domain);
      if (idx >= 0) list[idx] = entry; else list.push(entry);
      merged++;
    }
    table[key] = list;
  }
  return { merged, skipped };
}

/** 应用外挂权威表覆盖; 返回合并计数(诊断/journal 用)。坏 JSON 整体跳过。 */
export function mergeExternalAuthority(
  raw: string | undefined | null,
): { topics: number; categories: number; skipped: number } {
  if (!raw || !raw.trim()) return { topics: 0, categories: 0, skipped: 0 };
  let parsed: ExternalAuthorityConfig;
  try {
    parsed = JSON.parse(raw) as ExternalAuthorityConfig;
  } catch {
    return { topics: 0, categories: 0, skipped: 1 }; // 坏 JSON 不阻塞主链路
  }
  const t = mergeIntoTable(TOPIC_AUTHORITY, parsed.topics);
  const c = mergeIntoTable(CATEGORY_AUTHORITY, parsed.categories);
  return { topics: t.merged, categories: c.merged, skipped: t.skipped + c.skipped };
}

// ---------- 来源类型补密度 (phase AF): kind 从"少数条目显式声明"到"任何 URL 可分类" ----------
// 背景: vs-zai 第 7 采样的 kind 覆盖指标两侧都只有 0.1 桶(字段太稀, 只有显式声明条目有值)无判别力
// → 挂账"kind 补密度"。本节让任何 URL 都能推出 kind:
//   优先级: 条目显式 kind > 域名模式(社区/媒体/参考库) > 表默认(条目所在表) > 全局表默认 > null。
// 纪律: 纯元数据不改排序 — 社区意图翻转仍只认条目【显式】kind=community(bench 标定过的语义不动,
//       回归锁: matchTopicAuthority(github, communityIntent) 仍是 0.75)。

export type SourceKind = NonNullable<AuthorityEntry["kind"]>;

/** 各表缺省 kind: news 表=媒体; dictionary/entities 表=参考库; 其余表(官方文档/包仓库/政府/组件库)=官方 */
const TABLE_DEFAULT_KIND: Record<string, SourceKind> = {
  news: "media",
  dictionary: "reference",
  entities: "reference",
};

// 逐条目预计算缺省 kind(模块加载一次, 运行时零表扫描)
const ENTRY_KIND_DEFAULT = new Map<string, SourceKind>();
for (const [t, entries] of Object.entries(TOPIC_AUTHORITY)) {
  for (const en of entries) if (!en.kind) ENTRY_KIND_DEFAULT.set(en.domain, TABLE_DEFAULT_KIND[t] ?? "official");
}
for (const [t, entries] of Object.entries(CATEGORY_AUTHORITY)) {
  for (const en of entries) if (!en.kind) ENTRY_KIND_DEFAULT.set(en.domain, TABLE_DEFAULT_KIND[t] ?? "official");
}

/** 全局表(第 0 层)缺省: 学术出版商/预印本库=该内容第一方(official); wiki=参考库 */
const GLOBAL_KIND_DEFAULT: Record<string, SourceKind> = { "wikipedia.org": "reference" };

/** 域名模式(表外 URL 也适用 — zai 侧同尺): 社区平台/主流媒体/参考库 */
const KIND_PATTERNS: { kind: SourceKind; suffix: string[]; contains?: string[] }[] = [
  {
    kind: "community",
    suffix: [
      "github.com", "gitlab.com", "gitee.com", "codeberg.org",
      "reddit.com", "stackoverflow.com", "stackexchange.com", "superuser.com", "serverfault.com", "askubuntu.com",
      "news.ycombinator.com", "lobste.rs", "v2ex.com", "zhihu.com", "juejin.cn", "segmentfault.com",
      "cnblogs.com", "csdn.net", "jianshu.com", "oschina.net", "quora.com", "dev.to", "medium.com", "hashnode.dev",
    ],
    contains: ["forum", "discuss.", "community.", "discourse"],
  },
  { kind: "media", suffix: ["forbes.com", "dw.com", "jiemian.com", "ifeng.com", "sina.com.cn", "sohu.com", "163.com"] },
  { kind: "reference", suffix: ["wikipedia.org", "wikimedia.org", "wiktionary.org", "wikiwand.com", "britannica.com", "scholarpedia.org"] },
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * 来源类型分类: 条目显式 kind 最优先; 否则域名模式; 表内条目回退到所在表缺省;
 * 无条目(zai 侧/表外 URL)回退到表缺省的子域命中, 再无则 null(诚实未知)。
 * 用途: vs-zai kind 覆盖指标两侧同尺 + ref.sourceKind 标注 + journal; 不参与排序。
 */
export function classifySourceKind(
  url: string, entry?: { domain: string; kind?: SourceKind } | null,
): SourceKind | null {
  if (entry?.kind) return entry.kind;
  const domain = entry?.domain ?? hostOf(url);
  if (!domain) return null;
  for (const p of KIND_PATTERNS) {
    if (p.suffix.some((d) => domain === d || domain.endsWith("." + d))) return p.kind;
    if (p.contains?.some((c) => domain.includes(c))) return p.kind;
  }
  if (entry) {
    return ENTRY_KIND_DEFAULT.get(entry.domain)
      ?? GLOBAL_KIND_DEFAULT[entry.domain]
      ?? (matchAuthority(entry.domain) ? "official" : null);
  }
  for (const [d, k] of ENTRY_KIND_DEFAULT) {
    if (domain === d || domain.endsWith("." + d)) return k;
  }
  return null;
}
