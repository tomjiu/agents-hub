/**
 * 免 key JSON/RSS Provider 扩池 (v0.3, Phase I 大扫库 → docs/targets-search.md P0)
 * 10-a 官方文档巡检(2026-09-03, analysis/web-crawl/e-keyless-endpoint-docs.md)后全面更新:
 * - marginalia: 独立索引通用搜索 — 2025-12-08 起迁移 api2.marginalia-search.com(header API-Key,
 *   默认 public, env SC_MARGINALIA_KEY 覆盖); 旧 api.marginalia.nu 降级 fallback(同形 JSON)
 * - openverse:  CC 图片搜索(kind:image); 匿名限流实测 20次/分+200次/天, page_size≤20
 * - hn:         Hacker News(Algolia) 免 key 垂直, hitsPerPage 服务端硬截 1000
 * - wikipedia:  REST v1 search/page; 403 之谜=UA 政策(伪装浏览器 UA 被封, Phab T400119),
 *               规范 UA 下 h1.1/h2 全通 → 已进默认池(Phase J "待 h2"结论作废)
 * - bingrss:    Bing 搜索 RSS 通道(format=rss) — 零封锁; 机会主义引擎(版权条款限个人非商业渲染)
 * - arxiv:      学术垂直(Atom XML, cheerio xmlMode); 限速 1 req/3s, 共享 IP 易吃 429 → 抛错交熔断
 * - crossref:   学术引用垂直; mailto= 进 polite pool(SC_CONTACT_EMAIL); rows≤1000; 被引数=权威性硬信号
 * - mwmbl:      Marginalia 熔断备胎; 参数是 s 不是 q!; title/extract 是 [{value,is_bold}] 需扁平化
 * - googlenews: 新闻时效垂直(kind:news); 版权条款限个人非商业渲染 → 默认不进池, 显式启用
 * - wiby:       古典独立网搜索(x-wiby 阶段探针 200 OK); 冷门/独立站面第二腿(第一腿 marginalia),
 *               JSON 数组 {URL,Title,Snippet,Description}, Description 比 Snippet 干净(Snippet 混导航噪声)
 * - keenable:   独立索引通用搜索(phase Y, 用户提案 keenable.ai); 双路: 免 key 公共路 /v1/search/public
 *               (1000 次/时/IP 不计量, X-Keenable-Title 必填) + 有 key 正式路 /v1/search(X-API-Key,
 *               SC_KEENABLE_KEY) 升 100,000 credit/月(免额, 官方 credits 页实抄); 有 key 自动升
 * 限额口径详见 analysis/search-landscape/marginalia-api-terms.md(2026-09-03 官方文档实抄+探针)
 * 解析失败照家规抛错交 Router 健康统计, 不静默返回空。
 */
import * as cheerio from "cheerio";
import type { Reference } from "../types.js";
import { clampText, type Provider, type SearchCtx } from "./base.js";

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

/** RSS item 通用解析(bingrss/googlenews 共用) */
function parseRssItems(
  xml: string,
  tag: string,
  prefix: string,
  ctx: SearchCtx,
): Reference[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const out: Reference[] = [];
  $(tag).each((_, el) => {
    const link = ($(el).find("link").first().text() || "").trim();
    const title = ($(el).find("title").first().text() || "").trim();
    const desc = stripHtml(($(el).find("description").first().text() || "").trim());
    const pub = ($(el).find("pubDate").first().text() || "").trim();
    if (!link.startsWith("http") || !title) return;
    out.push({
      url: link,
      title: clampText(title, 200),
      snippet: clampText(`[${prefix}] ${desc}`, 400),
      engines: [prefix],
      published: pub || undefined,
      kind: "web" as const,
    });
  });
  return out;
}

// ---------- Marginalia (独立索引, 免 key 通用 JSON; api2 迁移 + 旧端点 fallback) ----------

export const marginalia: Provider = {
  name: "marginalia",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const count = Math.min(20, ctx.opts.maxResults ?? 10);
    // 新 API(2025-12-08): API-Key header; 公开体验 key=public, 邮件申请正式 key 后 SC_MARGINALIA_KEY 覆盖
    const key = marginalia.config?.apiKey ?? process.env.SC_MARGINALIA_KEY ?? "public";
    let lastErr: unknown;
    // dc=3: 源头每域上限(官方参数 1-100), 与 fuseSemantic domainCap=3 对齐 — 源头多样, 融合才有多样可保
    try {
      const u = new URL("https://api2.marginalia-search.com/search");
      u.searchParams.set("query", query);
      u.searchParams.set("count", String(count));
      u.searchParams.set("dc", "3");
      const res = await ctx.fetchImpl(u.href, {
        signal: ctx.signal,
        headers: { "User-Agent": ctx.ua, Accept: "application/json", "API-Key": key },
      });
      if (!res.ok) throw new Error(`marginalia http ${res.status}`);
      return parseMarginaliaJson(await res.json(), ctx);
    } catch (e) {
      lastErr = e;
    }
    // fallback: 旧公开端点(同形 JSON, 解析代码不用改; dc 参数旧 API 同名同义)
    const u2 = `https://api.marginalia.nu/public/search/${encodeURIComponent(query)}?dc=3`;
    try {
      const res2 = await ctx.fetchImpl(u2, {
        signal: ctx.signal,
        headers: { "User-Agent": ctx.ua, Accept: "application/json" },
      });
      if (!res2.ok) throw new Error(`marginalia legacy http ${res2.status}`);
      return parseMarginaliaJson(await res2.json(), ctx);
    } catch (e2) {
      throw new Error(`marginalia api2+legacy both failed (api2: ${String(lastErr).slice(0, 80)}; legacy: ${String(e2).slice(0, 80)})`);
    }
  },
};

function parseMarginaliaJson(data: unknown, ctx: SearchCtx): Reference[] {
  const d = data as { results?: { url: string; title: string; description?: string; quality?: number }[] };
  const out: Reference[] = (d.results ?? [])
    .filter((r) => r.url?.startsWith("http"))
    .slice(0, ctx.opts.maxResults ?? 10)
    .map((r) => ({
      url: r.url,
      title: clampText(r.title, 200),
      snippet: clampText(r.description, 400),
      engines: ["marginalia"],
      kind: "web" as const,
    }));
  if (out.length === 0) throw new Error("marginalia: no results parsed");
  return out;
}

// ---------- Wiby (古典独立网搜索, 冷门面第二腿; Marginalia 覆盖外的老网/个人站) ----------
// JSON 数组 {URL,Title,Snippet,Description}(x-wiby 探针 200 OK); Snippet 混页面导航噪声,
// Description 是真摘要优先用。与 marginalia 互补: marginalia=学术倾斜的独立索引, wiby=纯手工味老网。

export const wiby: Provider = {
  name: "wiby",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://wiby.me/json/");
    u.searchParams.set("q", query);
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`wiby http ${res.status}`);
    const data = (await res.json()) as {
      URL?: string; Title?: string; Snippet?: string; Description?: string;
    }[];
    const out: Reference[] = (Array.isArray(data) ? data : [])
      .filter((r) => r.URL?.startsWith("http") && r.Title)
      .slice(0, ctx.opts.maxResults ?? 10)
      .map((r) => ({
        url: r.URL!,
        // wiby 实测 Title/Description 带 HTML 转义(&#39;), 复用 SE 的 decodeEntities
        title: clampText(decodeEntities(r.Title!), 200),
        // Description 是人工写的真摘要; Snippet 混导航(日期/菜单)噪声仅兑底
        snippet: clampText(decodeEntities(r.Description ?? stripHtml(r.Snippet ?? "")), 400),
        engines: ["wiby"],
        kind: "web" as const,
      }));
    if (out.length === 0) throw new Error("wiby: no results parsed");
    return out;
  },
};

// ---------- Keenable (独立索引通用搜索; 免 key 公共路 + 有 key 升级, phase Y) ----------
// 官方 docs.keenable.ai(2026-09-03 实抄+公共路实弹探针 200 OK/433ms): POST /v1/search 公开路
// /v1/search/public(免 key, X-Keenable-Title 必填)与正式路 /v1/search(X-API-Key)同参同响应形;
// 有 key 时认证移除时薪上限+按组织限速+10 万 credit/月免额(比 Tavily 1000/月宽 100 倍)。
// freshness → published_after(官方相对增量 1d/7d/30d/365d 直映); description 常空(探针实测),
// snippet 是真正文摘录 → snippet 优先。

export const keenable: Provider = {
  name: "keenable",
  needsKey: false,
  // ⚠ 不设 keySlot: 引擎本来就在默认池, 有 key 是 provider 内部切正式端点(/v1/search)而非"额外并联"——
  //   若设 keySlot+isConfigured()=true, keySlots=auto 会把它强注入 engines=[] 的空池(实测让引擎测试跑了真网络)
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const count = Math.min(50, ctx.opts.maxResults ?? 10); // 官方 max_results 1-50
    const key = keenable.config?.apiKey ?? process.env.SC_KEENABLE_KEY;
    const headers: Record<string, string> = {
      "User-Agent": ctx.ua,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (key) {
      headers["X-API-Key"] = key;
    } else {
      // 公共路必须自报应用名(缺了 400 Missing app identifier); config.title 或 env 可覆盖
      headers["X-Keenable-Title"] = keenable.config?.title ?? process.env.SC_KEENABLE_TITLE ?? "search-core";
    }
    const body: Record<string, unknown> = { query, max_results: count };
    const freshnessDelta = ({ day: "1d", week: "7d", month: "30d", year: "365d" } as Record<string, string | undefined>)[ctx.opts.freshness ?? "any"];
    if (freshnessDelta) body.published_after = freshnessDelta;
    const res = await ctx.fetchImpl(
      key ? "https://api.keenable.ai/v1/search" : "https://api.keenable.ai/v1/search/public",
      { method: "POST", signal: ctx.signal, headers, body: JSON.stringify(body) },
    );
    if (!res.ok) {
      const hint = res.status === 400 ? "(public lane: X-Keenable-Title missing?)"
        : res.status === 401 ? "(bad api key)"
        : res.status === 429 ? "(rate limited: 10 req/s; public lane 1000/h shared per IP)"
        : "";
      throw new Error(`keenable http ${res.status}${hint ? ` ${hint}` : ""}`);
    }
    const data = (await res.json()) as {
      results?: { url: string; title: string; description?: string; snippet?: string; published_at?: string }[];
    };
    const out: Reference[] = (data.results ?? [])
      .filter((r) => r.url?.startsWith("http") && r.title)
      .slice(0, ctx.opts.maxResults ?? 10)
      .map((r) => ({
        url: r.url,
        title: clampText(r.title, 200),
        // description 官方样本也有值但探针实测常空; snippet 是正文摘录, 优先用
        snippet: clampText(r.snippet || r.description || "", 400),
        engines: ["keenable"],
        published: r.published_at,
        kind: "web" as const,
      }));
    if (out.length === 0) throw new Error("keenable: no results parsed");
    return out;
  },
};

// ---------- Openverse (CC 图片搜索, kind:image) ----------

export const openverse: Provider = {
  name: "openverse",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://api.openverse.org/v1/images/");
    u.searchParams.set("q", query);
    // 匿名 page_size 硬上限 20(2022-06 起 v2.5.5 强制); CC license 过滤可选透传
    u.searchParams.set("page_size", String(Math.min(20, ctx.opts.maxResults ?? 10)));
    if (openverse.config?.engines) u.searchParams.set("license", openverse.config.engines);
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`openverse http ${res.status}`);
    const data = (await res.json()) as {
      results?: {
        url: string; title?: string; foreign_landing_url?: string;
        license?: string; license_version?: string; provider?: string; creator?: string;
      }[];
    };
    const out: Reference[] = (data.results ?? [])
      .filter((r) => r.url?.startsWith("http"))
      .slice(0, ctx.opts.maxResults ?? 10)
      .map((r) => ({
        // url = 图片直链(agent 直接消费); 落地页/授权信息进 snippet 供溯源
        url: r.url,
        title: clampText(r.title ?? "untitled image", 200),
        snippet: clampText(
          `[image] ${r.foreign_landing_url ?? ""} · CC-${(r.license ?? "").toUpperCase()}` +
          `${r.license_version ? ` ${r.license_version}` : ""}` +
          `${r.provider ? ` · ${r.provider}` : ""}${r.creator ? ` by ${r.creator}` : ""}`,
          400,
        ),
        engines: ["openverse"],
        kind: "image" as const,
      }));
    // phase AH(第 11 采样): 查询无对应 CC 图是"合法空"不是错误(与 pypi 非包名 404 同纪律) —
    //   throw 会给熔断器计败(images 专线唯一腿 → 熔断后整车道冷却), API 形状漂移仍走 http/parse throw
    if (out.length === 0) return [];
    return out;
  },
};

// ---------- Hacker News (Algolia 免 key 垂直) ----------

export const hn: Provider = {
  name: "hn",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://hn.algolia.com/api/v1/search");
    u.searchParams.set("query", query);
    u.searchParams.set("tags", "story");
    u.searchParams.set("hitsPerPage", String(Math.min(20, ctx.opts.maxResults ?? 10)));
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`hn http ${res.status}`);
    const data = (await res.json()) as {
      hits?: {
        title?: string; url?: string | null; objectID: string;
        points?: number; num_comments?: number; author?: string; created_at?: string;
      }[];
    };
    const out: Reference[] = (data.hits ?? [])
      .slice(0, ctx.opts.maxResults ?? 10)
      .map((h) => {
        const url = h.url && h.url.startsWith("http")
          ? h.url
          : `https://news.ycombinator.com/item?id=${h.objectID}`;
        const stat = [
          h.points !== undefined ? `${h.points} pts` : "",
          h.num_comments !== undefined ? `${h.num_comments} comments` : "",
          h.author ? `by ${h.author}` : "",
        ].filter(Boolean).join(" · ");
        return {
          url,
          title: clampText(h.title ?? "(untitled)", 200),
          snippet: clampText(`[HN] ${stat}`, 400),
          engines: ["hn"],
          published: h.created_at,
          kind: "web" as const,
        };
      });
    if (out.length === 0) throw new Error("hn: no results parsed");
    return out;
  },
};

// ---------- Wikipedia (REST v1 垂直, lang 路由语言域) ----------
// ⚠ 历史误诊更正(10-a 2026-09-03 破案): 403 与 HTTP/1.1 无关, 是 UA 政策 — Wikimedia 封杀
//   空/泛/浏览器伪装 UA(Phab T400119), 规范 UA(带项目 URL)下 h1.1/h2/en/zh/rest.php/api.php 全通。
//   DEFAULT_UA 已改规范 UA(config.ts), 本 provider 进默认池。

export const wikipedia: Provider = {
  name: "wikipedia",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    // "zh-CN"/"en-US" 取主语言码; 缺省 en
    const lang = (ctx.opts.lang ?? "en").split("-")[0].toLowerCase() || "en";
    // REST v1(10-a 推荐): 响应带 description(比 excerpt 干净)和 thumbnail
    const u = new URL(`https://${lang}.wikipedia.org/w/rest.php/v1/search/page`);
    u.searchParams.set("q", query);
    u.searchParams.set("limit", String(Math.min(20, ctx.opts.maxResults ?? 10)));
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`wikipedia http ${res.status}`);
    const data = (await res.json()) as {
      pages?: { key: string; title: string; excerpt?: string; description?: string; matched_title?: string }[];
    };
    const out: Reference[] = (data.pages ?? [])
      .slice(0, ctx.opts.maxResults ?? 10)
      .map((s) => ({
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(s.key || s.title.replace(/ /g, "_"))}`,
        title: clampText(s.title, 200),
        // description 一句话描述比 excerpt(含 searchmatch HTML)干净; excerpt 兜底
        snippet: clampText(s.description ?? stripHtml(s.excerpt ?? ""), 400),
        engines: ["wikipedia"],
        kind: "web" as const,
      }))
      .filter((r) => r.url.length > 0);
    if (out.length === 0) throw new Error("wikipedia: no results parsed");
    return out;
  },
};

// ---------- Bing RSS (format=rss 零封锁通道, 机会主义引擎) ----------

export const bingrss: Provider = {
  name: "bingrss",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://www.bing.com/search");
    u.searchParams.set("q", query);
    u.searchParams.set("format", "rss");
    u.searchParams.set("count", String(Math.min(20, ctx.opts.maxResults ?? 10)));
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/rss+xml, application/xml, text/xml" },
    });
    if (!res.ok) throw new Error(`bingrss http ${res.status}`);
    const out = parseRssItems(await res.text(), "item", "bing-rss", ctx);
    if (out.length === 0) throw new Error("bingrss: no items parsed (blocked or markup drift?)");
    return out.slice(0, ctx.opts.maxResults ?? 10);
  },
};

// ---------- phase AJ: Bing News RSS(新闻垂直; 与 bingrss 的 /search web 版不同端点) ----------
// 探针 2026-09-04(probe-aj-sources.mjs): /news/search?format=RSS 200(351ms, 4-10 item)。
// 关键差异: item 的 <link> 是 bing apiclick 跳转, 但内嵌 url=https%3a%2f%2f… 真实出版方链接
// (可解码, 不同于 googlenews 的不可解码跳转), 另有 <News:Source> 出版方字段。
// 空结果纪律与 googlenews 同款: 有效 RSS 零 item = 合法空; 根标记缺失 = 漂移抛错。
export const bingnews: Provider = {
  name: "bingnews",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://www.bing.com/news/search");
    u.searchParams.set("q", query);
    u.searchParams.set("format", "RSS");
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/rss+xml, application/xml, text/xml" },
    });
    if (!res.ok) throw new Error(`bingnews http ${res.status}`);
    const xml = await res.text();
    if (!/<rss[\s>]|<channel[\s>]/.test(xml)) throw new Error("bingnews: markup drift (blocked or non-RSS)");
    const raw = parseRssItems(xml, "item", "bing-news", ctx);
    if (raw.length === 0) return [];
    const out = raw.map((r) => {
      // apiclick 跳转内嵌 url= 参数 = 真实出版方链接; 解码失败/非 http 保底原链接
      const m = r.url.match(/[?&]url=([^&]+)/);
      if (!m) return r;
      try {
        const real = decodeURIComponent(m[1]);
        return real.startsWith("http") ? { ...r, url: real } : r;
      } catch {
        return r;
      }
    }).map((r) => ({ ...r, kind: "news" as const }));
    return out.slice(0, ctx.opts.maxResults ?? 10);
  },
};

// ---------- arXiv (学术垂直, Atom XML; 限速 1 req/3s) ----------

export const arxiv: Provider = {
  name: "arxiv",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://export.arxiv.org/api/query");
    u.searchParams.set("search_query", `all:${query}`);
    u.searchParams.set("sortBy", "relevance");
    u.searchParams.set("max_results", String(Math.min(20, ctx.opts.maxResults ?? 10)));
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/atom+xml, application/xml, text/xml" },
    });
    if (res.status === 429) throw new Error("arxiv http 429 (official courtesy 1 req/3s; backoff required)");
    if (!res.ok) throw new Error(`arxiv http ${res.status}`);
    const $ = cheerio.load(await res.text(), { xmlMode: true });
    const out: Reference[] = [];
    $("entry").each((_, el) => {
      const id = ($(el).find("id").first().text() || "").trim();
      const title = ($(el).find("title").first().text() || "").trim();
      const summary = ($(el).find("summary").first().text() || "").trim();
      const published = ($(el).find("published").first().text() || "").trim() || undefined;
      // link[type=text/html] 是 abs 页; 兜底用 entry id(本身即 abs URL)
      const abs = $(el).find('link[type="text/html"]').attr("href") || id;
      const authors = $(el).find("author > name").map((_i, n) => $(n).text().trim()).get().slice(0, 3).join(", ");
      if (!abs.startsWith("http") || !title) return;
      out.push({
        url: abs,
        title: clampText(title, 200),
        snippet: clampText(`${authors ? `${authors} · ` : ""}${summary}`, 400),
        engines: ["arxiv"],
        published,
        kind: "web" as const,
      });
    });
    if (out.length === 0) throw new Error("arxiv: no entries parsed (markup drift?)");
    return out.slice(0, ctx.opts.maxResults ?? 10);
  },
};

// ---------- Crossref (学术引用垂直; mailto polite pool; 被引数=权威性硬信号) ----------

export const crossref: Provider = {
  name: "crossref",
  needsKey: false,
  config: {},
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://api.crossref.org/works");
    u.searchParams.set("query", query);
    u.searchParams.set("rows", String(Math.min(20, ctx.opts.maxResults ?? 10)));
    // select 字段白名单减流量(10-a 实测); mailto 进 polite pool 更快更稳
    u.searchParams.set("select", "DOI,title,URL,author,issued,container-title,is-referenced-by-count");
    const mailto = crossref.config?.email ?? process.env.SC_CONTACT_EMAIL;
    if (mailto) u.searchParams.set("mailto", mailto);
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`crossref http ${res.status}`);
    const data = (await res.json()) as {
      message?: {
        items?: {
          DOI: string; title?: string[]; URL?: string;
          author?: { given?: string; family?: string }[];
          issued?: { "date-parts"?: number[][] };
          "container-title"?: string[];
          "is-referenced-by-count"?: number;
        }[];
      };
    };
    const out: Reference[] = (data.message?.items ?? [])
      .map((it) => {
        const title = it.title?.[0] ?? "";
        const authors = (it.author ?? []).slice(0, 3)
          .map((a) => [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean).join(", ");
        const year = it.issued?.["date-parts"]?.[0]?.[0];
        const cited = it["is-referenced-by-count"];
        const meta = [
          authors,
          it["container-title"]?.[0],
          year ? String(year) : "",
          cited !== undefined ? `cited ${cited}` : "",
        ].filter(Boolean).join(" · ");
        const url = it.URL && it.URL.startsWith("http") ? it.URL : `https://doi.org/${it.DOI}`;
        return {
          url,
          title: clampText(title || it.DOI, 200),
          snippet: clampText(`[paper] ${meta}`, 400),
          engines: ["crossref"],
          kind: "web" as const,
        };
      })
      .filter((r) => r.title.length > 0);
    if (out.length === 0) throw new Error("crossref: no items parsed (markup drift?)");
    return out.slice(0, ctx.opts.maxResults ?? 10);
  },
};

// ---------- Mwmbl (Marginalia 熔断备胎; 参数是 s 不是 q!) ----------

export const mwmbl: Provider = {
  name: "mwmbl",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://mwmbl.org/api/v1/search");
    u.searchParams.set("s", query); // ⚠ 参数名是 s, 用 q 得 422(10-a 实测)
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      // ⚠ mwmbl 的 nginx gzip 流不规范(Node zlib 严格校验报 "incorrect header check" terminated;
      //   2026-09-03 实测 identity 要未压缩版本稳定 200, 43KB 可接受)
      headers: { "User-Agent": ctx.ua, Accept: "application/json", "Accept-Encoding": "identity" },
    });
    if (!res.ok) throw new Error(`mwmbl http ${res.status}`);
    const data = (await res.json()) as {
      url: string;
      title?: { value: string; is_bold: boolean }[];
      extract?: { value: string; is_bold: boolean }[];
    }[];
    const out: Reference[] = (Array.isArray(data) ? data : [])
      .filter((r) => r.url?.startsWith("http"))
      .slice(0, ctx.opts.maxResults ?? 10)
      .map((r) => ({
        url: r.url,
        title: clampText((r.title ?? []).map((t) => t.value).join(""), 200),
        snippet: clampText((r.extract ?? []).map((t) => t.value).join(""), 400),
        engines: ["mwmbl"],
        kind: "web" as const,
      }))
      .filter((r) => r.title.length > 0);
    if (out.length === 0) throw new Error("mwmbl: no results parsed");
    return out;
  },
};

// ---------- Stack Exchange (编程垂直权威源, v0.6 域名表 Tier1 最佳新人) ----------
// 免 key 300 次/天/IP(api.stackexchange.com/docs/throttle 官方实抓); 免费注册 key 后 10000/天
// (SC_STACKEXCHANGE_KEY); 并发 30 req/s; 响应自带 quota_max/quota_remaining 自报额度。
// 编程问题权威度: is_answered/score/tags 是结构化质量信号, 比引擎 site: 套娃强一档。

export const stackexchange: Provider = {
  name: "stackexchange",
  needsKey: false,
  config: {},
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://api.stackexchange.com/2.3/search/advanced");
    u.searchParams.set("order", "desc");
    u.searchParams.set("sort", "relevance");
    u.searchParams.set("q", query);
    // config.engines 复用为站点名(默认 stackoverflow; 可配 serverfault/superuser 等)
    u.searchParams.set("site", stackexchange.config?.engines ?? "stackoverflow");
    u.searchParams.set("pagesize", String(Math.min(20, ctx.opts.maxResults ?? 10)));
    const key = stackexchange.config?.apiKey ?? process.env.SC_STACKEXCHANGE_KEY;
    if (key) u.searchParams.set("key", key);
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`stackexchange http ${res.status}`);
    const data = (await res.json()) as {
      items?: {
        title: string; link: string; question_id?: number;
        score?: number; answer_count?: number; is_answered?: boolean;
        tags?: string[]; last_activity_date?: number;
      }[];
      quota_max?: number; quota_remaining?: number;
    };
    const out: Reference[] = (data.items ?? [])
      .filter((it) => it.link?.startsWith("http") && it.title)
      .slice(0, ctx.opts.maxResults ?? 10)
      .map((it) => {
        const meta = [
          it.is_answered ? "answered ✓" : "open",
          it.score !== undefined ? `${it.score} score` : "",
          it.answer_count !== undefined ? `${it.answer_count} answers` : "",
          it.tags?.length ? `tags: ${it.tags.slice(0, 4).join(", ")}` : "",
        ].filter(Boolean).join(" · ");
        return {
          url: it.link,
          title: clampText(decodeEntities(it.title), 200),
          snippet: clampText(`[SO] ${meta}`, 400),
          engines: ["stackexchange"],
          published: it.last_activity_date
            ? new Date(it.last_activity_date * 1000).toISOString()
            : undefined,
          kind: "web" as const,
        };
      });
    if (out.length === 0) throw new Error("stackexchange: no results parsed");
    return out;
  },
};

// ---------- npm registry (包名垂直, v0.6 编码 agent 高频) ----------
// registry.npmjs.org/-/v1/search 免 key JSON; score 细分 popularity/quality/maintenance。

export const npm: Provider = {
  name: "npm",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://registry.npmjs.org/-/v1/search");
    u.searchParams.set("text", query);
    u.searchParams.set("size", String(Math.min(20, ctx.opts.maxResults ?? 10)));
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`npm http ${res.status}`);
    const data = (await res.json()) as {
      objects?: {
        package: {
          name: string; version: string; description?: string;
          date?: string; links?: { npm?: string; homepage?: string };
          keywords?: string[]; publisher?: { username?: string };
          score?: { final?: number; detail?: { popularity?: number; quality?: number; maintenance?: number } };
        };
      }[];
    };
    const out: Reference[] = (data.objects ?? [])
      .filter((o) => o.package?.name)
      .slice(0, ctx.opts.maxResults ?? 10)
      .map((o) => {
        const p = o.package;
        const s = p.score;
        const meta = [
          s?.final !== undefined ? `score ${s.final.toFixed(2)}` : "",
          s?.detail?.popularity !== undefined ? `pop ${(s.detail.popularity * 100).toFixed(0)}` : "",
          p.publisher?.username ? `by ${p.publisher.username}` : "",
          p.keywords?.length ? `kw: ${p.keywords.slice(0, 4).join(", ")}` : "",
        ].filter(Boolean).join(" · ");
        return {
          url: p.links?.npm?.startsWith("http") ? p.links.npm : `https://www.npmjs.com/package/${p.name}`,
          title: clampText(`${p.name}@${p.version}`, 200),
          snippet: clampText(`[npm] ${meta}${p.description ? ` · ${p.description}` : ""}`, 400),
          engines: ["npm"],
          published: p.date,
          kind: "web" as const,
        };
      });
    if (out.length === 0) throw new Error("npm: no results parsed");
    return out;
  },
};

// ---------- 实体解码(SE 的 title 是 HTML 转义文本) ----------

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&"); // &amp; 最后解, 保证 "&amp;quot;" 单次解码成 "&quot;"
}

// ---------- Google News RSS (新闻时效垂直, kind:news; 默认不进池) ----------
// 版权条款限"个人 feed 阅读器非商业渲染"(10-a 实测 RSS 内版权声明), 仅显式 engines 启用。

export const googlenews: Provider = {
  name: "googlenews",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const primary = (ctx.opts.lang ?? "en").split("-")[0].toLowerCase() || "en";
    // 语言码 ≠ 地区码: en→US, zh→CN; 其他语言取大写(如 fr→FR, ceid=FR:fr)
    const hl = primary === "zh" ? "zh-CN" : primary === "en" ? "en-US" : primary;
    const gl = primary === "zh" ? "CN" : primary === "en" ? "US" : primary.toUpperCase();
    const ceid = primary === "zh" ? "CN:zh-Hans" : `${gl}:${primary}`;
    const u = new URL("https://news.google.com/rss/search");
    u.searchParams.set("q", query); // when:1d / site: 运算符可直接拼在 query 里(10-a 实测)
    u.searchParams.set("hl", hl);
    u.searchParams.set("gl", gl);
    u.searchParams.set("ceid", ceid);
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/rss+xml, application/xml, text/xml" },
    });
    if (!res.ok) throw new Error(`googlenews http ${res.status}`);
    const xml = await res.text();
    const out = parseRssItems(xml, "item", "googlenews", ctx).map((r) => ({
      ...r,
      kind: "news" as const,
    }));
    // phase AJ(news lane 接线): 有效 RSS 零 item = 合法空(niche 新闻查询常态, 抛错会误伤熔断 —
    // AH openverse 同教训); 根标记缺失才是形状漂移(被挑战页/改版)。
    if (!/<rss[\s>]|<channel[\s>]/.test(xml)) throw new Error("googlenews: markup drift (blocked or non-RSS)");
    return out.slice(0, ctx.opts.maxResults ?? 10);
  },
};

// ---------- MDN 官方文档 (developer.mozilla.org /api/v1/search, phase AA 增量) ----------
// 对照轮增量(vs-zai-search-compare.md): z-ai 侧编程题 top 常见官方文档面(docs.python.org/
// developer.mozilla.org), 我方原来只能靠 Tier2 site: 查询(ddg/bingrss 代跑)。
// 探针实测(2026-09-03): /api/v1/search?q=fetch%20API&locale=en-US → 200, documents[10],
// 字段 title/mdn_url/summary/locale; locale=zh-CN 返回 zh-cn 内容(10 条)。
// 设计: 编程主题 Tier1 直连腿; **documents=[] 合法返回空**(抛错会误伤熔断); 仅"响应缺
// documents 字段"(API 形状漂移)才抛错交熔断。
//
// phase AE web 亲和守卫(第 7 采样实证, 附录 D): 原假设"python 等非 web 编程题在 MDN 必然
// 为空"是错的 — MDN 搜索 API 模糊匹配会把 "best practices" 泛教程页塞给 kubernetes 题
// (WebGL/PWA top3 = 该题 MISS 根因之一), asyncio 题混入 MDN zh 教程页×3(s 档域级提权
// 抬错页)。MDN 只写 web 平台: 查询无 web 平台 token → 直接返回 [](合法空, 不伤熔断)。
// token 口径: 短词(js/ts/web/dom)用词边界防 "json"→"js" 误配; async/await 故意不收
// (asyncio 子串误配, 实测其 MDN 返回全是无关教程页)。
const WEB_AFFINITY_SUBSTR: string[] = [
  "css", "html", "javascript", "typescript", "browser", "浏览器", "网页", "前端",
  "fetch", "http", "websocket", "canvas", "svg", "node", "react", "vue", "angular", "svelte", "xhr", "ajax",
];
const WEB_AFFINITY_WORD: string[] = ["js", "ts", "web", "dom"];

function hasWebAffinity(query: string): boolean {
  const low = query.toLowerCase();
  if (WEB_AFFINITY_SUBSTR.some((t) => low.includes(t))) return true;
  return WEB_AFFINITY_WORD.some((t) => new RegExp(`\\b${t}\\b`).test(low));
}

export const mdn: Provider = {
  name: "mdn",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    // 亲和守卫: 非 web 查询直接合法空(不发请求, 与 documents=[] 同语义不伤熔断)
    if (!hasWebAffinity(query)) return [];
    const primary = (ctx.opts.lang ?? "en").split("-")[0].toLowerCase() || "en";
    // locale 跟随查询语言: zh → zh-CN(探针实测返回 zh-cn 文档), 其余 en-US
    const locale = primary === "zh" ? "zh-CN" : "en-US";
    const u = new URL("https://developer.mozilla.org/api/v1/search");
    u.searchParams.set("q", query);
    u.searchParams.set("locale", locale);
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`mdn http ${res.status}`);
    const data = (await res.json()) as { documents?: { title?: string; mdn_url?: string; summary?: string }[] };
    // 形状漂移守门: documents 字段缺失 = API 变了 → 抛错交熔断(markup-drift 同款教训)
    if (!Array.isArray(data.documents)) throw new Error("mdn: no documents field parsed (api drift?)");
    const out = data.documents
      .filter((d) => d.mdn_url && d.title)
      .slice(0, ctx.opts.maxResults ?? 10)
      .map((d) => ({
        url: `https://developer.mozilla.org${d.mdn_url}`,
        title: clampText(d.title!, 200),
        snippet: clampText(d.summary ?? "", 400),
        engines: ["mdn"],
        kind: "web" as const,
      }));
    // documents=[] 是合法空(python 等非 web 编程题), 不抛不熔断
    return out;
  },
};

// ---------- AnySearch 匿名车道 (phase AB 免 Key 增量轮) ----------
// 用户清单★+探针证实(2026-09-03): POST /v1/search 无 Authorization 即可用,
// {code:0,data:{results:[{title,url,snippet,content}]}} 形状干净;
// 连打 6 发全 200(1.4-1.9s), asyncio 题返回 docs.python.org/realpython 顶位=质量像样的托管聚合面。
// 双面架构价值: 又一个不同索引的聚合源(vs-zai 对照 Jaccard 0.16 教训——聚合面扩源=覆盖增量)。
// 匿名额度官方未公开,长期强度靠熔断 rate_limited 档兜底;进默认池(第 13 名在册成员)。
export const anysearch: Provider = {
  name: "anysearch",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const res = await ctx.fetchImpl("https://api.anysearch.com/v1/search", {
      method: "POST",
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`anysearch http ${res.status}`);
    const data = (await res.json()) as {
      code?: number; message?: string;
      data?: { results?: { title?: string; url?: string; snippet?: string; content?: string }[] };
    };
    // 业务码非 0 = 服务端明确拒绝(限流/封禁), 抛错交熔断分类
    if (data.code !== 0) throw new Error(`anysearch code=${data.code} ${data.message ?? ""}`);
    const out = (data.data?.results ?? [])
      .filter((r) => r.url)
      .slice(0, ctx.opts.maxResults ?? 10)
      .map((r) => ({
        url: r.url!,
        title: clampText(r.title ?? r.url!, 200),
        snippet: clampText(r.snippet ?? r.content, 400),
        engines: ["anysearch"],
        kind: "web" as const,
      }));
    if (out.length === 0) throw new Error("anysearch: no results parsed");
    return out;
  },
};

// ---------- Firecrawl keyless 搜索 (phase AB 免 Key 增量轮) ----------
// 用户清单★+探针证实(2026-09-03): POST /v2/search 无 Authorization 返回
// {success:true,data:{web:[{url,title,description,position}]}}; 连打 4 发全 200(0.8-1.3s)。
// 坑: description 是抓取页 markdown(YouTube 页噪音可达数千字符), clampText 截断兜底。
// 不进默认池(显式 engines / research 预算启用): 描述噪音大, 聚合质量待 bench 观察再决定升池。
export const firecrawl: Provider = {
  name: "firecrawl",
  needsKey: false,
  config: {},
  isConfigured() {
    return true; // keyless 常在; 配了 apiKey 自动升级付费车道
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const headers: Record<string, string> = { "User-Agent": ctx.ua, "Content-Type": "application/json" };
    if (firecrawl.config?.apiKey) headers.Authorization = `Bearer ${firecrawl.config.apiKey}`;
    const res = await ctx.fetchImpl("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      signal: ctx.signal,
      headers,
      body: JSON.stringify({ query, limit: Math.min(20, ctx.opts.maxResults ?? 10) }),
    });
    if (!res.ok) throw new Error(`firecrawl http ${res.status}`);
    const data = (await res.json()) as {
      success?: boolean; error?: string;
      data?: { web?: { url?: string; title?: string; description?: string; position?: number }[] };
    };
    if (data.success === false) throw new Error(`firecrawl error: ${data.error ?? "unknown"}`);
    // 形状漂移守门: data.web 缺失 = API 变了(markup-drift 同款教训)
    if (!Array.isArray(data.data?.web)) throw new Error("firecrawl: no data.web field parsed (api drift?)");
    const out = data.data!.web!
      .filter((r) => r.url)
      .slice(0, ctx.opts.maxResults ?? 10)
      .map((r) => ({
        url: r.url!,
        title: clampText(r.title ?? r.url!, 200),
        snippet: clampText(r.description ?? "", 400),
        engines: ["firecrawl"],
        kind: "web" as const,
      }));
    if (out.length === 0) throw new Error("firecrawl: no results parsed");
    return out;
  },
};

// ---------- sov2ex (V2EX 社区搜索, phase AB 免 Key 增量轮) ----------
// 探针证实(2026-09-03): GET /api/search?q=&size= → {total,hits:[{_source:{id,title,content,created}}]};
// 中文技术题返回高质量社区讨论(向量数据库题 total=51399)。
// 路由: programming 主题 + 查询含中文 → 追加腿(domains.ts lookupDomains 内 lang-guard);
// 英文编程题不打它(内容以中文为主, 纯噪音)。
export const sov2ex: Provider = {
  name: "sov2ex",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://www.sov2ex.com/api/search");
    u.searchParams.set("q", query);
    u.searchParams.set("size", String(Math.min(20, ctx.opts.maxResults ?? 10)));
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`sov2ex http ${res.status}`);
    const data = (await res.json()) as {
      total?: number;
      hits?: { _source?: { id?: number; title?: string; content?: string; created?: string } }[];
    };
    const out = (data.hits ?? [])
      .map((h) => h._source)
      .filter((s): s is { id: number; title: string; content?: string; created?: string } => !!(s?.id && s?.title))
      .slice(0, ctx.opts.maxResults ?? 10)
      .map((s) => ({
        url: `https://www.v2ex.com/t/${s.id}`,
        title: clampText(s.title, 200),
        snippet: clampText(s.content, 400),
        engines: ["sov2ex"],
        published: s.created,
        kind: "web" as const,
      }));
    if (out.length === 0) throw new Error("sov2ex: no results parsed");
    return out;
  },
};
