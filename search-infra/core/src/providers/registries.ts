/**
 * v0.7 注册表与垂直资产层 — "继续扩大搜索面"第二批(targets-search.md v0.7 候选)。
 *
 * 8 个免 key 官方 API, 2026-09-03 全部实抓 200 验证(0.25-1.3s):
 * - 包管理器四兄弟: crates(Rust) / packagist(PHP) / rubygems(Ruby) — 补 npm(JS) 的跨语言版图
 *   (PyPI 无官方 search API, XML-RPC search 已关停 — 诚实不做 HTML 爬, site: 路由兜底)
 * - 开发者资产: huggingface(模型权重) / dockerhub(容器镜像)
 * - 学术双补: openalex(2.5 亿 works, 被引数+OA 链接) / dblp(CS 会议目录, 补 crossref 的会议盲区)
 * - 实体背景: wikidata(wbsearchentities, agent 背景调查/消歧)
 *
 * phase AG-1 探针第 2 批(2026-09-04, 结论抄 docs/keyless-increments.md):
 * - 证实接入: pypi(JSON API 包元数据直取+license, 搜索端点仍死) / hfpapers(HF Papers AI 论文搜索)
 * - 诚实不接: openlibrary(沙箱网络两次超时) / semantic scholar(429) / qwant(浏览器头仍 403)
 *   / gitlab(403 挑战页) / searchcode(API 404 死亡) / gdelt(429 强制 1req/5s 与并行池+软截止冲突)
 *   / archive advancedsearch(沙箱网络层失败)
 *
 * 全部默认不进通用池(显式 engines / 域名路由启用) — 通用查询打它们是浪费,
 * 垂直查询打通用引擎是污染。接入了 domains.ts 的 packages/ai-models/devops/entities 主题。
 */
import { clampText, type Provider, type SearchCtx } from "./base.js";
import type { Reference } from "../types.js";

// ---------- 通用小件 ----------

function firstLang(ctx: SearchCtx): string {
  return (ctx.opts.lang ?? "en").split("-")[0].toLowerCase() || "en";
}

function take<T>(arr: T[] | undefined, n: number): T[] {
  return (arr ?? []).slice(0, n);
}

// ---------- crates.io (Rust 包, 官方 API, 必须带 UA) ----------

export const crates: Provider = {
  name: "crates",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://crates.io/api/v1/crates");
    u.searchParams.set("q", query);
    // v0.8 质量评测 case-4 实测: 长自然语言查询默认相关度排序会让 tokio 这类头部包
    // 排不进前列(字面匹配小众包占坑) — 按 downloads 排, 包名命中 + 权威下载量双信号
    u.searchParams.set("sort", "downloads");
    u.searchParams.set("per_page", String(Math.min(20, ctx.opts.maxResults ?? 10)));
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`crates http ${res.status}`);
    const data = (await res.json()) as {
      crates?: {
        id?: string; name?: string; description?: string;
        downloads?: number; default_version?: string;
        documentation?: string; repository?: string;
        keywords?: string[]; updated_at?: string;
      }[];
    };
    const out: Reference[] = take(data.crates, ctx.opts.maxResults ?? 10)
      .filter((c) => c.name)
      .map((c) => {
        const meta = [
          c.default_version ? `v${c.default_version}` : "",
          c.downloads !== undefined ? `${c.downloads} downloads` : "",
          c.keywords?.length ? `kw: ${c.keywords.slice(0, 4).join(", ")}` : "",
        ].filter(Boolean).join(" · ");
        return {
          url: `https://crates.io/crates/${c.name}`,
          title: clampText(`${c.name}${c.default_version ? `@${c.default_version}` : ""}`, 200),
          snippet: clampText(`[crates] ${meta}${c.description ? ` · ${c.description}` : ""}`, 400),
          engines: ["crates"],
          published: c.updated_at,
          kind: "web" as const,
        };
      });
    if (out.length === 0) throw new Error("crates: no results parsed");
    return out;
  },
};

// ---------- Packagist (PHP 包, 官方 search API) ----------

export const packagist: Provider = {
  name: "packagist",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://packagist.org/search.json");
    u.searchParams.set("q", query);
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`packagist http ${res.status}`);
    const data = (await res.json()) as {
      results?: {
        name?: string; description?: string; url?: string;
        repository?: string; downloads?: number; favers?: number;
      }[];
    };
    const out: Reference[] = take(data.results, ctx.opts.maxResults ?? 10)
      .filter((r) => r.name)
      .map((r) => ({
        url: r.url?.startsWith("http") ? r.url : `https://packagist.org/packages/${r.name}`,
        title: clampText(r.name!, 200),
        snippet: clampText(
          `[packagist] ${[
            r.downloads !== undefined ? `${r.downloads} downloads` : "",
            r.favers !== undefined ? `${r.favers}★` : "",
          ].filter(Boolean).join(" · ")}${r.description ? ` · ${r.description}` : ""}`,
          400,
        ),
        engines: ["packagist"],
        kind: "web" as const,
      }));
    if (out.length === 0) throw new Error("packagist: no results parsed");
    return out;
  },
};

// ---------- RubyGems (Ruby 包, 官方 API) ----------

export const rubygems: Provider = {
  name: "rubygems",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://rubygems.org/api/v1/search.json");
    u.searchParams.set("query", query);
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`rubygems http ${res.status}`);
    const data = (await res.json()) as {
      name?: string; version?: string; info?: string;
      downloads?: number; project_uri?: string;
    }[];
    const out: Reference[] = take(data, ctx.opts.maxResults ?? 10)
      .filter((g) => g.name)
      .map((g) => ({
        url: g.project_uri?.startsWith("http") ? g.project_uri : `https://rubygems.org/gems/${g.name}`,
        title: clampText(`${g.name}${g.version ? `@${g.version}` : ""}`, 200),
        snippet: clampText(
          `[rubygems] ${g.downloads !== undefined ? `${g.downloads} downloads` : "n/a"}${g.info ? ` · ${g.info}` : ""}`,
          400,
        ),
        engines: ["rubygems"],
        kind: "web" as const,
      }));
    if (out.length === 0) throw new Error("rubygems: no results parsed");
    return out;
  },
};

// ---------- Hugging Face (AI 模型权重, 官方 API, 按下载量排序) ----------

export const huggingface: Provider = {
  name: "huggingface",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://huggingface.co/api/models");
    u.searchParams.set("search", query);
    u.searchParams.set("limit", String(Math.min(20, ctx.opts.maxResults ?? 10)));
    u.searchParams.set("sort", "downloads");
    u.searchParams.set("direction", "-1");
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`huggingface http ${res.status}`);
    const data = (await res.json()) as {
      id?: string; likes?: number; downloads?: number;
      pipeline_tag?: string; tags?: string[]; createdAt?: string; updatedAt?: string;
    }[];
    const out: Reference[] = take(data, ctx.opts.maxResults ?? 10)
      .filter((m) => m.id)
      .map((m) => {
        const meta = [
          m.downloads !== undefined ? `${m.downloads} downloads` : "",
          m.likes !== undefined ? `${m.likes}♥` : "",
          m.pipeline_tag ?? "",
        ].filter(Boolean).join(" · ");
        return {
          url: `https://huggingface.co/${m.id}`,
          title: clampText(m.id!, 200),
          snippet: clampText(`[hf] ${meta}`, 400),
          engines: ["huggingface"],
          published: m.createdAt,
          kind: "web" as const,
        };
      });
    if (out.length === 0) throw new Error("huggingface: no results parsed");
    return out;
  },
};

// ---------- Docker Hub (容器镜像, 官方 v2 API) ----------

export const dockerhub: Provider = {
  name: "dockerhub",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://hub.docker.com/v2/search/repositories/");
    u.searchParams.set("query", query);
    u.searchParams.set("page_size", String(Math.min(20, ctx.opts.maxResults ?? 10)));
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`dockerhub http ${res.status}`);
    const data = (await res.json()) as {
      results?: {
        repo_name?: string; repo_owner?: string; short_description?: string;
        star_count?: number; pull_count?: number; is_official?: boolean;
      }[];
    };
    const out: Reference[] = take(data.results, ctx.opts.maxResults ?? 10)
      .filter((r) => r.repo_name)
      .map((r) => {
        const name = r.repo_name ?? ""; // filter 已保证非空, 局部变量保类型收窄
        const official = !!r.is_official;
        const meta = [
          r.star_count !== undefined ? `★${r.star_count}` : "",
          r.pull_count !== undefined ? `${r.pull_count} pulls` : "",
          official ? "official" : "",
        ].filter(Boolean).join(" · ");
        return {
          // v0.8 质量评测实抓 bug: API 的 repo_name 有时自带 namespace(rapidfort/postgresql-official),
          // 此时再叠加 owner/library 前缀会拼出 /r/library/rapidfort/... → 404。含 "/" 直接用。
          url: official
            ? `https://hub.docker.com/_/${name}`
            : name.includes("/")
              ? `https://hub.docker.com/r/${name}`
              : `https://hub.docker.com/r/${r.repo_owner || "library"}/${name}`,
          title: clampText(
            official && !name.includes("/")
              ? `library/${name}`
              : name.includes("/") || official
                ? name
                : `${r.repo_owner ? `${r.repo_owner}/` : "library/"}${name}`,
            200,
          ),
          snippet: clampText(`[dockerhub] ${meta}${r.short_description ? ` · ${r.short_description}` : ""}`, 400),
          engines: ["dockerhub"],
          kind: "web" as const,
        };
      });
    if (out.length === 0) throw new Error("dockerhub: no results parsed");
    return out;
  },
};

// ---------- OpenAlex (2.5 亿学术 works, 被引数 + OA 链接; 礼貌池用 contactEmail) ----------

export const openalex: Provider = {
  name: "openalex",
  needsKey: false,
  config: {},
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://api.openalex.org/works");
    u.searchParams.set("search", query);
    u.searchParams.set("per-page", String(Math.min(20, ctx.opts.maxResults ?? 10)));
    // mailto 进 polite pool(同 crossref 模式, 更快更稳)
    const mailto = openalex.config?.email ?? process.env.SC_CONTACT_EMAIL;
    if (mailto) u.searchParams.set("mailto", mailto);
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`openalex http ${res.status}`);
    const data = (await res.json()) as {
      results?: {
        display_name?: string; doi?: string; publication_year?: number; publication_date?: string;
        cited_by_count?: number; type?: string;
        primary_location?: {
          landing_page_url?: string; pdf_url?: string;
          source?: { display_name?: string } | null;
        } | null;
        authorships?: { author?: { display_name?: string } }[];
        open_access?: { is_oa?: boolean; oa_url?: string } | null;
      }[];
    };
    const out: Reference[] = take(data.results, ctx.opts.maxResults ?? 10)
      .filter((w) => w.display_name)
      .map((w) => {
        const venue = w.primary_location?.source?.display_name ?? "";
        const authors = take(w.authorships?.map((a) => a.author?.display_name).filter(Boolean) as string[], 2).join(", ");
        const oa = w.open_access?.is_oa ? "OA" : "";
        const meta = [
          w.publication_year ?? "",
          w.cited_by_count !== undefined ? `${w.cited_by_count} citations` : "",
          venue, authors, oa,
        ].filter(Boolean).join(" · ");
        const url = w.primary_location?.landing_page_url?.startsWith("http")
          ? w.primary_location.landing_page_url
          : w.open_access?.oa_url?.startsWith("http")
            ? w.open_access.oa_url
            : w.doi
              ? `https://doi.org/${w.doi.replace("https://doi.org/", "")}`
              : "https://openalex.org";
        return {
          url,
          title: clampText(w.display_name!, 200),
          snippet: clampText(`[openalex] ${meta}`, 400),
          engines: ["openalex"],
          published: w.publication_date ?? (w.publication_year ? `${w.publication_year}-01-01` : undefined),
          kind: "web" as const,
        };
      });
    if (out.length === 0) throw new Error("openalex: no results parsed");
    return out;
  },
};

// ---------- DBLP (CS 会议/期刊目录, 补 crossref 对会议论文的盲区) ----------

export const dblp: Provider = {
  name: "dblp",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://dblp.org/search/publ/api");
    u.searchParams.set("q", query);
    u.searchParams.set("format", "json");
    u.searchParams.set("h", String(Math.min(20, ctx.opts.maxResults ?? 10)));
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`dblp http ${res.status}`);
    const data = (await res.json()) as {
      result?: {
        hits?: {
          hit?: {
            info?: {
              title?: string; url?: string; ee?: string;
              venue?: string; year?: string;
              authors?: { author?: { text?: string } | { text?: string }[] };
            };
          }[];
        };
      };
    };
    // authors.author 可能是单对象/数组/缺失 — 归一化
    const authorsOf = (info: NonNullable<NonNullable<NonNullable<typeof data.result>["hits"]>["hit"]>[number]["info"]): string => {
      const a = info?.authors?.author;
      if (!a) return "";
      const list = Array.isArray(a) ? a : [a];
      return take(list.map((x) => x.text).filter(Boolean) as string[], 2).join(", ");
    };
    const hits = data.result?.hits?.hit;
    const out: Reference[] = take(hits, ctx.opts.maxResults ?? 10)
      .map((h) => h.info)
      .filter((i) => i?.title)
      .map((i) => ({
        url: i!.ee?.startsWith("http") ? i!.ee : i!.url?.startsWith("http") ? i!.url : "https://dblp.org",
        title: clampText(i!.title!, 200),
        snippet: clampText(
          `[dblp] ${[i!.venue ?? "", i!.year ?? "", authorsOf(i!)].filter(Boolean).join(" · ")}`,
          400,
        ),
        engines: ["dblp"],
        published: i!.year ? `${i!.year}-01-01` : undefined,
        kind: "web" as const,
      }));
    if (out.length === 0) throw new Error("dblp: no results parsed");
    return out;
  },
};

// ---------- Wikidata (实体搜索, agent 背景调查/消歧; kind 留 web) ----------

export const wikidata: Provider = {
  name: "wikidata",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://www.wikidata.org/w/api.php");
    u.searchParams.set("action", "wbsearchentities");
    u.searchParams.set("search", query);
    u.searchParams.set("language", firstLang(ctx));
    u.searchParams.set("format", "json");
    u.searchParams.set("limit", String(Math.min(20, ctx.opts.maxResults ?? 10)));
    u.searchParams.set("origin", "*");
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`wikidata http ${res.status}`);
    const data = (await res.json()) as {
      search?: { id?: string; label?: string; description?: string; concepturi?: string }[];
    };
    const out: Reference[] = take(data.search, ctx.opts.maxResults ?? 10)
      .filter((e) => e.id && e.label)
      .map((e) => ({
        url: e.concepturi ?? `https://www.wikidata.org/wiki/${e.id}`,
        title: clampText(`${e.label} (${e.id})`, 200),
        snippet: clampText(`[wikidata] ${e.description ?? "(no description)"}`, 400),
        engines: ["wikidata"],
        kind: "web" as const,
      }));
    if (out.length === 0) throw new Error("wikidata: no results parsed");
    return out;
  },
};

// ---------- PubMed (生物医学文献, eutils 免 key 两步式; phase AB 免 Key 增量轮) ----------
// 用户清单+探针证实(2026-09-03): esearch(拿 PMID 列表)→esummary(拿题录)全 200, 632ms。
// eutils 政策: 建议带 tool+email 标识(SC_CONTACT_EMAIL, 同 crossref/openalex 礼貌池模式)。
// 路由: academic 主题腿(医学/生物向补 arXiv/crossref 的盲区)。
export const pubmed: Provider = {
  name: "pubmed",
  needsKey: false,
  config: {},
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const politeness = new URLSearchParams();
    politeness.set("tool", "search-core");
    const email = pubmed.config?.email ?? process.env.SC_CONTACT_EMAIL;
    if (email) politeness.set("email", email);

    // 第 1 步: esearch 拿 PMID 列表
    const u1 = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
    u1.searchParams.set("db", "pubmed");
    u1.searchParams.set("term", query);
    u1.searchParams.set("retmode", "json");
    u1.searchParams.set("retmax", String(Math.min(20, ctx.opts.maxResults ?? 10)));
    for (const [k, v] of politeness) u1.searchParams.set(k, v);
    const r1 = await ctx.fetchImpl(u1.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!r1.ok) throw new Error(`pubmed esearch http ${r1.status}`);
    const d1 = (await r1.json()) as { esearchresult?: { idlist?: string[]; errorlist?: unknown } };
    const ids = (d1.esearchresult?.idlist ?? []).filter(Boolean);
    if (ids.length === 0) throw new Error("pubmed: no results parsed");

    // 第 2 步: esummary 拿题录(标题/期刊/日期/作者)
    const u2 = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
    u2.searchParams.set("db", "pubmed");
    u2.searchParams.set("retmode", "json");
    u2.searchParams.set("id", ids.join(","));
    for (const [k, v] of politeness) u2.searchParams.set(k, v);
    const r2 = await ctx.fetchImpl(u2.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!r2.ok) throw new Error(`pubmed esummary http ${r2.status}`);
    const d2 = (await r2.json()) as {
      result?: Record<string, {
        title?: string; fulljournalname?: string; booktitle?: string;
        pubdate?: string; lastauthor?: string; sortfirstauthor?: string;
      }>;
    };
    const out = ids
      .map((id) => ({ id, s: d2.result?.[id] }))
      .filter((x): x is { id: string; s: { title: string; fulljournalname?: string; booktitle?: string; pubdate?: string; lastauthor?: string; sortfirstauthor?: string } } => !!x.s?.title)
      .slice(0, ctx.opts.maxResults ?? 10)
      .map(({ id, s }) => ({
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        title: clampText(s.title, 200),
        snippet: clampText(
          `[pubmed] ${[s.fulljournalname ?? s.booktitle ?? "", s.pubdate ?? "", s.sortfirstauthor ?? s.lastauthor ?? ""].filter(Boolean).join(" · ")}`,
          400,
        ),
        engines: ["pubmed"],
        published: s.pubdate,
        kind: "web" as const,
      }));
    if (out.length === 0) throw new Error("pubmed: no results parsed");
    return out;
  },
};

// phase AD 待办 4: Nominatim(OSM 官方地理编码, 探针 200 已过挂账转正)
// 政策: 规范 UA(本仓默认 UA 自标识) + 单发不批量(每次 search 1 发, 天然 ≤1 req/s)。
// 空结果是合法空(非地理查询不该进这腿 — geo 主题关键词在 domains.ts 守门), 不抛错不伤熔断。
export const nominatim: Provider = {
  name: "nominatim",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://nominatim.openstreetmap.org/search");
    u.searchParams.set("q", query);
    u.searchParams.set("format", "jsonv2");
    u.searchParams.set("limit", String(Math.min(10, ctx.opts.maxResults ?? 8)));
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`nominatim http ${res.status}`);
    const data = (await res.json()) as {
      osm_type?: string; osm_id?: number; lat?: string; lon?: string;
      display_name?: string; type?: string; class?: string; importance?: number;
    }[];
    // 合法空: 查询不是地点(geo 主题关键词兜不住的长尾), 直接回 [] 不伤健康
    if (!Array.isArray(data) || data.length === 0) return [];
    return data
      .filter((p) => p.display_name && p.osm_type && p.osm_id != null)
      .map((p) => ({
        url: `https://www.openstreetmap.org/${p.osm_type}/${p.osm_id}`,
        title: clampText(p.display_name!, 200),
        snippet: clampText(`[geo] ${p.class ?? ""}/${p.type ?? ""} @ ${p.lat ?? "?"},${p.lon ?? "?"}`, 400),
        engines: ["nominatim"],
        kind: "geo" as const,
      }));
  },
};

// ---------- phase AG-1: PyPI JSON API(包元数据直取; 搜索端点仍死, 只做包名精确查询) ----------

export const pypi: Provider = {
  name: "pypi",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    // JSON API 按 <name>/json 取元数据, 不是关键词搜索:
    // 查询不是合法包名(含空格/路径/超长) → 合法空, 不发请求不伤健康。
    const name = query.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(name)) return [];
    const res = await ctx.fetchImpl(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    // 404 = 包不存在 = 合法空(用户就是在查这个名字在不在), 不交熔断
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`pypi http ${res.status}`);
    const data = (await res.json()) as {
      info?: {
        name?: string; version?: string; summary?: string; license?: string;
        requires_python?: string;
      };
      urls?: { upload_time?: string }[];
    };
    const info = data.info;
    if (!info?.name) throw new Error("pypi: no results parsed");
    const v = info.version ?? "";
    const meta = [
      v ? `v${v}` : "",
      info.license ? `license: ${info.license}` : "",
      data.urls?.[0]?.upload_time ? `published ${data.urls[0].upload_time.slice(0, 10)}` : "",
    ].filter(Boolean).join(" · ");
    return [{
      url: `https://pypi.org/project/${info.name}/`,
      title: clampText(`${info.name}${v ? `@${v}` : ""}`, 200),
      snippet: clampText(`[pypi] ${meta}${info.summary ? ` · ${info.summary}` : ""}`, 400),
      engines: ["pypi"],
      published: data.urls?.[0]?.upload_time,
      // phase AG-4: pypi API 本就返回 license → 透传(其余 registry 搜索 API 不带, 诚实不做二次请求)
      license: info.license || undefined,
      kind: "web" as const,
    }];
  },
};

// ---------- phase AG-1: HuggingFace Papers(AI 论文搜索, keyless) ----------

export const hfpapers: Provider = {
  name: "hfpapers",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://huggingface.co/api/papers/search");
    u.searchParams.set("q", query);
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`hfpapers http ${res.status}`);
    // 形状(2026-09-04 探针): [{ paper: { id(arXiv号), title, summary(arXiv 摘要全文), publishedAt, ... } }]
    const data = (await res.json()) as {
      paper?: { id?: string; title?: string; summary?: string; publishedAt?: string };
    }[];
    const papers = (data ?? [])
      .map((x) => x.paper)
      .filter((p): p is { id: string; title: string; summary?: string; publishedAt?: string } =>
        !!p?.id && !!p?.title);
    const out: Reference[] = take(papers, ctx.opts.maxResults ?? 10).map((p) => ({
      url: `https://huggingface.co/papers/${p.id}`,
      title: clampText(p.title, 200),
      snippet: clampText(`[hf-paper] arXiv:${p.id}${p.summary ? ` · ${p.summary.slice(0, 160)}` : ""}`, 400),
      engines: ["hfpapers"],
      published: p.publishedAt,
      kind: "web" as const,
    }));
    if (out.length === 0) throw new Error("hfpapers: no results parsed");
    return out;
  },
};

// ---------- phase AJ(vs-zai 附录 G 诚实剩余「security 官方源召回面差距」): CVE 元数据三腿 ----------
// 探针 2026-09-04(core/scripts/probe-aj-sources.mjs, 原始 JSON /tmp/phase-aj):
// - NVD API 2.0: cveId 精查 200(冷启 7.4s / 暖 1.1s 方差, keyless 滚窗 5req/30s)
// - OSV.dev: GET /v1/vulns/{id} 200(315ms, 52 refs 含 cisagov 官方库; POST /v1/query 按 id 是 400, 用 GET)
// - GitHub Advisory: api.github.com/advisories?cve_id= 200(470ms, 免 key 60/hr)
// - CISA KEV feed: DC IP 拿到 HTML 挑战页 ❌ 关账(qwant/gitlab 同案)
// pypi 同纪律: 这是**按编号直取的元数据 API, 不是搜索** — 查询无 CVE 编号 → 合法空零请求
// (不猜关键词, 通用安全面由聚合兜底腿+默认池覆盖); 404/无匹配 = 编号不存在 = 合法空;
// 只有 HTTP 非 2xx/形状漂移才抛错交熔断。

export function extractCveId(query: string): string | null {
  const m = query.match(/\bCVE-\d{4}-\d{4,7}\b/i);
  return m ? m[0].toUpperCase() : null;
}

export const nvd: Provider = {
  name: "nvd",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const cve = extractCveId(query);
    if (!cve) return [];
    const u = new URL("https://services.nvd.nist.gov/rest/json/cves/2.0");
    u.searchParams.set("cveId", cve);
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`nvd http ${res.status}`);
    const data = (await res.json()) as {
      vulnerabilities?: {
        cve?: {
          id?: string; published?: string;
          descriptions?: { lang?: string; value?: string }[];
          metrics?: { cvssMetricV31?: { cvssData?: { baseScore?: number } }[]; cvssMetricV30?: { cvssData?: { baseScore?: number } }[] };
        };
      }[];
    };
    const v = data.vulnerabilities?.[0]?.cve;
    if (!v?.id) throw new Error("nvd: no results parsed");
    const desc = (v.descriptions ?? []).find((d) => d.lang === "en")?.value ?? "";
    const score = v.metrics?.cvssMetricV31?.[0]?.cvssData?.baseScore
      ?? v.metrics?.cvssMetricV30?.[0]?.cvssData?.baseScore;
    return [{
      url: `https://nvd.nist.gov/vuln/detail/${v.id}`,
      title: clampText(`${v.id}: ${desc.split(". ")[0] ?? ""}`, 200),
      snippet: clampText(`[nvd] ${desc}${score != null ? ` · CVSS ${score}` : ""}`, 400),
      engines: ["nvd"],
      published: v.published,
      kind: "web" as const,
    }];
  },
};

export const osv: Provider = {
  name: "osv",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const cve = extractCveId(query);
    if (!cve) return [];
    const res = await ctx.fetchImpl(`https://api.osv.dev/v1/vulns/${encodeURIComponent(cve)}`, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`osv http ${res.status}`);
    const d = (await res.json()) as {
      id?: string; summary?: string; details?: string;
      aliases?: string[]; modified?: string;
    };
    if (!d.id) throw new Error("osv: no results parsed");
    const aliases = (d.aliases ?? []).slice(0, 3).join(", ");
    return [{
      url: `https://osv.dev/vulnerability/${cve}`,
      title: clampText(`${cve}${d.summary ? `: ${d.summary}` : ""}`, 200),
      snippet: clampText(`[osv] ${d.summary ?? ""}${d.details ? ` · ${d.details}` : ""}${aliases ? ` · aliases: ${aliases}` : ""}`, 400),
      engines: ["osv"],
      published: d.modified,
      kind: "web" as const,
    }];
  },
};

export const ghsa: Provider = {
  name: "ghsa",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const cve = extractCveId(query);
    if (!cve) return [];
    const u = new URL("https://api.github.com/advisories");
    u.searchParams.set("cve_id", cve);
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/vnd.github+json" },
    });
    // 403 = 免 key 60/hr 限额打满 → 抛错交熔断(rate_limited 档自愈); 404 不该出现(无匹配返回 [])
    if (!res.ok) throw new Error(`ghsa http ${res.status}`);
    const list = (await res.json()) as {
      ghsa_id?: string; html_url?: string; summary?: string;
      severity?: string; published_at?: string; cvss?: { score?: number };
    }[];
    const a = (list ?? [])[0];
    // 无对应公告 = 合法空(编号真实存在但 GHSA 未收录, 如部分 CUDA/闭源 CVE)
    if (!a?.ghsa_id) return [];
    return [{
      url: a.html_url ?? `https://github.com/advisories/${a.ghsa_id}`,
      title: clampText(`${a.summary || cve} (${a.ghsa_id})`, 200),
      snippet: clampText(`[ghsa] severity: ${a.severity ?? "?"}${a.cvss?.score != null ? ` · CVSS ${a.cvss.score}` : ""} · ${cve}`, 400),
      engines: ["ghsa"],
      published: a.published_at,
      kind: "web" as const,
    }];
  },
};

// ---------- phase AM: 词典/医学研究/数据 类目官方面(探针第 4 批, 全部免 key) ----------

// Wiktionary API(en+zh 双语) — 词典面第一方内容本体: 词义/词源/释义。
// 语言按查询文本判(CJK → zh.wiktionary, 其余 → en); list=search 全文检索, 零命中合法空。
export const wiktionary: Provider = {
  name: "wiktionary",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const zh = /[\u4e00-\u9fff]/.test(query);
    const host = zh ? "zh.wiktionary.org" : "en.wiktionary.org";
    const u = new URL(`https://${host}/w/api.php`);
    u.searchParams.set("action", "query");
    u.searchParams.set("format", "json");
    u.searchParams.set("list", "search");
    u.searchParams.set("srsearch", query);
    u.searchParams.set("srlimit", String(Math.min(10, ctx.opts.maxResults ?? 5)));
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`wiktionary http ${res.status}`);
    const data = (await res.json()) as {
      query?: { search?: { title?: string; snippet?: string; wordcount?: number }[] };
    };
    const hits = take(data.query?.search, ctx.opts.maxResults ?? 5).filter((h) => h.title);
    // 零命中=合法空(生僻词/专名不在词典, 不伤健康不熔断)
    if (hits.length === 0) return [];
    return hits.map((h) => ({
      url: `https://${host}/wiki/${encodeURIComponent(h.title!)}`,
      title: clampText(h.title!, 200),
      snippet: clampText(`[wiktionary] ${(h.snippet ?? "").replace(/<[^>]+>/g, "")}`, 400),
      engines: ["wiktionary"],
      kind: "web" as const,
    }));
  },
};

// Europe PMC REST — 生物医学文献聚合(EMBL-EBI 官方): PMID/PMCID/DOI 直链 + OA 标记。
// 学术研究意图腿(medical lane); 与 pubmed(eutils 两步式)互补, 零命中合法空。
export const europepmc: Provider = {
  name: "europepmc",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
    u.searchParams.set("query", query);
    u.searchParams.set("format", "json");
    u.searchParams.set("pageSize", String(Math.min(25, ctx.opts.maxResults ?? 5)));
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`europepmc http ${res.status}`);
    const data = (await res.json()) as {
      resultList?: {
        result?: {
          title?: string; authorString?: string; journalTitle?: string; pubYear?: string;
          doi?: string; pmid?: string; pmcid?: string; isOpenAccess?: string;
        }[];
      };
    };
    const rows = take(data.resultList?.result, ctx.opts.maxResults ?? 5).filter((r) => r.title);
    if (rows.length === 0) return []; // 零命中合法空
    return rows.map((r) => {
      const meta = [
        r.authorString ?? "",
        r.journalTitle ?? "",
        r.pubYear ?? "",
        r.isOpenAccess === "Y" ? "OA" : "",
      ].filter(Boolean).join(" · ");
      const url = r.pmid
        ? `https://europepmc.org/article/MED/${r.pmid}`
        : r.pmcid
          ? `https://europepmc.org/article/PMC/${r.pmcid}`
          : r.doi
            ? `https://doi.org/${r.doi}`
            : "https://europepmc.org";
      return {
        url,
        title: clampText(r.title!, 200),
        snippet: clampText(`[europepmc] ${meta}`, 400),
        engines: ["europepmc"],
        published: r.pubYear ? `${r.pubYear}-01-01` : undefined,
        kind: "web" as const,
      };
    });
  },
};

// ClinicalTrials.gov API v2 — NLM 官方试验注册库: NCT 编号直链 + 状态/适应症元数据。
// 医学研究意图腿(medical lane); 零命中合法空。
export const clinicaltrials: Provider = {
  name: "clinicaltrials",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://clinicaltrials.gov/api/v2/studies");
    u.searchParams.set("query.term", query);
    u.searchParams.set("pageSize", String(Math.min(20, ctx.opts.maxResults ?? 5)));
    u.searchParams.set("fields", "NCTId,BriefTitle,OverallStatus,Condition,EnrollmentCount");
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`clinicaltrials http ${res.status}`);
    const data = (await res.json()) as {
      studies?: {
        protocolSection?: {
          identificationModule?: { nctId?: string; briefTitle?: string };
          statusModule?: { overallStatus?: string };
          conditionsModule?: { conditions?: string[] };
        };
      }[];
    };
    const out = take(data.studies, ctx.opts.maxResults ?? 5)
      .map((s) => s.protocolSection)
      .filter((p): p is { identificationModule: { nctId: string; briefTitle?: string } } & typeof p =>
        !!p?.identificationModule?.nctId)
      .map((p) => {
        const nct = p.identificationModule.nctId;
        const status = p.statusModule?.overallStatus ?? "";
        const cond = (p.conditionsModule?.conditions ?? [])[0] ?? "";
        return {
          url: `https://clinicaltrials.gov/study/${nct}`,
          title: clampText(p.identificationModule.briefTitle ?? nct, 200),
          snippet: clampText(`[clinicaltrials] ${[nct, status, cond].filter(Boolean).join(" · ")}`, 400),
          engines: ["clinicaltrials"],
          kind: "web" as const,
        };
      });
    // 零命中合法空
    return out;
  },
};

// World Bank API v2 — 官方宏观数据(指标码+国家码直取, pypi/CVE 纪律): 未知指标合法空零请求。
// 已知指标×已知国家的小保守映射(数据面关键词只路由强官方统计意图, 映射表管"查什么")。
const WB_INDICATORS: { keys: string[]; code: string; label: string }[] = [
  { keys: ["gdp", "国内生产总值", "经济总量"], code: "NY.GDP.MKTP.CD", label: "GDP" },
  { keys: ["gni", "人均收入"], code: "NY.GNP.PCAP.CD", label: "GNI per capita" },
  { keys: ["population", "人口"], code: "SP.POP.TOTL", label: "Population" },
  { keys: ["inflation", "通胀", "通货膨胀"], code: "FP.CPI.TOTL.ZG", label: "Inflation" },
  { keys: ["unemployment", "失业率"], code: "SL.UEM.TOTL.ZS", label: "Unemployment" },
  { keys: ["co2", "碳排放"], code: "EN.ATM.CO2E.PC", label: "CO2 per capita" },
];
const WB_COUNTRIES: { keys: string[]; iso: string }[] = [
  { keys: ["china", "chinese", "中国"], iso: "CN" },
  { keys: ["united states", "usa", "america", "美国"], iso: "US" },
  { keys: ["japan", "日本"], iso: "JP" },
  { keys: ["india", "印度"], iso: "IN" },
  { keys: ["germany", "德国"], iso: "DE" },
  { keys: ["united kingdom", "britain", "英国"], iso: "GB" },
  { keys: ["russia", "俄罗斯"], iso: "RU" },
  { keys: ["korea", "韩国"], iso: "KR" },
  { keys: ["brazil", "巴西"], iso: "BR" },
  { keys: ["world", "global", "全球", "世界"], iso: "WLD" },
];
export const worldbank: Provider = {
  name: "worldbank",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const low = query.toLowerCase();
    // 指标: 长词优先(gdp per capita 先于 gdp); 无已知指标 → 合法空零请求
    const ind = WB_INDICATORS
      .filter((i) => i.keys.some((k) => low.includes(k)))
      .sort((a, b) => Math.max(...b.keys.map((k) => k.length)) - Math.max(...a.keys.map((k) => k.length)))[0];
    if (!ind) return [];
    const c = WB_COUNTRIES.find((x) => x.keys.some((k) => low.includes(k))) ?? { keys: [], iso: "WLD" };
    // 年份: 查询带年份 → 该年前后窗; 否则近 6 年
    const ym = low.match(/\b(19|20)\d{2}\b/);
    const nowY = new Date().getFullYear();
    const date = ym ? `${Number(ym[0]) - 2}:${ym[0]}` : `${nowY - 5}:${nowY}`;
    const u = new URL(`https://api.worldbank.org/v2/country/${c.iso}/indicator/${ind.code}`);
    u.searchParams.set("format", "json");
    u.searchParams.set("per_page", "6");
    u.searchParams.set("date", date);
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    // 404/空 = 该国无此指标数据 = 合法空
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`worldbank http ${res.status}`);
    const data = (await res.json()) as [
      unknown,
      { date?: string; value?: number | null; country?: { id?: string; value?: string }; indicator?: { id?: string; value?: string } }[] | null,
    ];
    const rows = (Array.isArray(data) ? data[1] : null) ?? [];
    if (rows.length === 0) return []; // 合法空
    const pts = rows
      .filter((r) => r.value != null)
      .map((r) => `${r.date}: ${r.value}`)
      .slice(0, 4)
      .join(" · ");
    const countryName = rows[0]?.country?.value ?? c.iso;
    return [{
      url: `https://data.worldbank.org/indicator/${ind.code}?locations=${rows[0]?.country?.id ?? c.iso}`,
      title: clampText(`${countryName} ${ind.label} — World Bank`, 200),
      snippet: clampText(`[worldbank] ${pts || "no data in window"}`, 400),
      engines: ["worldbank"],
      kind: "web" as const,
    }];
  },
};
