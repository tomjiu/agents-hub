/**
 * 付费/带 key 的 API Provider: Brave / Tavily / Exa
 * 统一 Brave 风格 freshness 语义 (WorkBuddy[07] 报告的 /agenttool/v1/search 同款 schema 思想)
 * 有 key 自动加入并行(v0-spec G1: 免 key 可用,有 key 升级)。
 */
import type { Reference } from "../types.js";
import { clampText, type Provider, type SearchCtx } from "./base.js";

// ---------- Brave ----------

const braveFreshness: Record<string, string | undefined> = {
  day: "pd", week: "pw", month: "pm", year: "py", any: undefined,
};

export const brave: Provider = {
  name: "brave",
  needsKey: true,
  keySlot: true,
  config: {},
  isConfigured() {
    return !!brave.config?.apiKey;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://api.search.brave.com/res/v1/web/search");
    u.searchParams.set("q", query);
    u.searchParams.set("count", String(Math.min(20, ctx.opts.maxResults ?? 10)));
    const f = braveFreshness[ctx.opts.freshness ?? "any"];
    if (f) u.searchParams.set("freshness", f);
    if (ctx.opts.lang) u.searchParams.set("search_lang", ctx.opts.lang);
    if (ctx.opts.domains?.allow?.length) u.searchParams.set("include_sites", ctx.opts.domains.allow.join(","));
    if (ctx.opts.domains?.block?.length) u.searchParams.set("exclude_sites", ctx.opts.domains.block.join(","));

    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, "X-Subscription-Token": brave.config!.apiKey!, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`brave http ${res.status}`);
    const data = await res.json() as {
      web?: { results?: { url: string; title: string; description: string; age?: string }[] };
    };
    return (data.web?.results ?? []).slice(0, ctx.opts.maxResults ?? 10).map((r) => ({
      url: r.url,
      title: clampText(r.title, 200),
      snippet: clampText(r.description, 400),
      engines: ["brave"],
      published: r.age,
      kind: "web" as const,
    }));
  },
};

// ---------- Tavily ----------
// 认证: Authorization Bearer(官方现行; body 塞 api_key 属 legacy 已弃)
// 超限三档码(10-b 官方文档实抄): 429=请求过快 / 432=套餐超限 / 433=PAYG 超限
// → 错误串带状态码,Router 的 classifyFailure 据此分类, 432/433 一票标记当月额度判死
// phase AB(免 Key 增量轮): 官方 keyless 模式落地(用户清单★+探针证实)——
// 无 key 时发 X-Tavily-Access-Mode: keyless 走官方匿名车道(2026-09-03 实测: 连打 6 发全 200,
// 1.3-4s, 结果质量与有 key basic 同形)。isConfigured 恒 true + keySlot=true:
// keySlots=auto 下无 key 也自动并入默认池(Phase Y 的"意外强注入"这次是故意的);
// 429 由熔断 rate_limited 档兜住(2min 冷却自愈)。
// 车道选择: 无 key 且无 baseUrl 才走 keyless(自建网关/Hikari 必须带 token, 匿名头没意义)。
export const tavily: Provider = {
  name: "tavily",
  needsKey: true,
  keySlot: true,
  config: {},
  isConfigured() {
    return true; // keyless 车道常在(有 key 走 Bearer, 无 key 走匿名)
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    // baseUrl 可指 Tavily 兼容网关(phase Y 用户接入 tavily-hikari: SC_TAVILY_BASE_URL=https://tavily.ivanli.cc/api/tavily,
    // 同款 /search 协议+Bearer token; 2026-09-03 探针: 无凭据 401 "missing token"/坏 token 401 "invalid or disabled token")
    const base = (tavily.config?.baseUrl ?? "https://api.tavily.com").replace(/\/+$/, "");
    const apiKey = tavily.config?.apiKey;
    const keyless = !apiKey && !tavily.config?.baseUrl;
    const headers: Record<string, string> = {
      "User-Agent": ctx.ua,
      "Content-Type": "application/json",
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    else if (keyless) headers["X-Tavily-Access-Mode"] = "keyless";
    const res = await ctx.fetchImpl(`${base}/search`, {
      method: "POST",
      signal: ctx.signal,
      headers,
      body: JSON.stringify({
        query,
        max_results: Math.min(20, ctx.opts.maxResults ?? 10),
        // 锁死 basic(10-b: 防 auto_parameters 偷升 advanced 扣双倍 credit)
        search_depth: "basic",
        time_range: ctx.opts.freshness && ctx.opts.freshness !== "any" ? ctx.opts.freshness : undefined,
        include_domains: ctx.opts.domains?.allow,
        exclude_domains: ctx.opts.domains?.block,
      }),
    });
    if (!res.ok) {
      const hint = res.status === 429 ? "rate limited, reduce request rate"
        : res.status === 432 ? "plan quota exceeded"
        : res.status === 433 ? "payg quota exceeded"
        : res.status === 401 ? "unauthorized (invalid api key)"
        : "";
      throw new Error(`tavily http ${res.status}${hint ? ` (${hint})` : ""}`);
    }
    const data = await res.json() as {
      results?: { url: string; title: string; content: string; published_date?: string }[];
    };
    return (data.results ?? []).slice(0, ctx.opts.maxResults ?? 10).map((r) => ({
      url: r.url,
      title: clampText(r.title, 200),
      snippet: clampText(r.content, 400),
      engines: ["tavily"],
      published: r.published_date,
      kind: "web" as const,
    }));
  },
};

// ---------- Exa ----------

export const exa: Provider = {
  name: "exa",
  needsKey: true,
  keySlot: true,
  config: {},
  isConfigured() {
    return !!exa.config?.apiKey;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const body: Record<string, unknown> = {
      query,
      numResults: Math.min(20, ctx.opts.maxResults ?? 10),
      type: "auto",
      contents: { text: { maxCharacters: 400 } },
    };
    if (ctx.opts.freshness && ctx.opts.freshness !== "any") {
      const days = { day: 1, week: 7, month: 30, year: 365 }[ctx.opts.freshness] ?? undefined;
      if (days) {
        body.startPublishedDate = new Date(Date.now() - days * 86400_000).toISOString();
      }
    }
    if (ctx.opts.domains?.allow?.length) body.includeDomains = ctx.opts.domains.allow;
    if (ctx.opts.domains?.block?.length) body.excludeDomains = ctx.opts.domains.block;

    const res = await ctx.fetchImpl("https://api.exa.ai/search", {
      method: "POST",
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, "x-api-key": exa.config!.apiKey!, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`exa http ${res.status}`);
    const data = await res.json() as {
      results?: { url: string; title: string; text?: string; publishedDate?: string }[];
    };
    return (data.results ?? []).slice(0, ctx.opts.maxResults ?? 10).map((r) => ({
      url: r.url,
      title: clampText(r.title, 200),
      snippet: clampText(r.text, 400),
      engines: ["exa"],
      published: r.publishedDate,
      kind: "web" as const,
    }));
  },
};

// ---------- GitHub 专项(keyless, 10 req/min 限额) ----------

export const github: Provider = {
  name: "github",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://api.github.com/search/repositories");
    u.searchParams.set("q", query);
    u.searchParams.set("per_page", String(Math.min(20, ctx.opts.maxResults ?? 10)));
    u.searchParams.set("sort", "best-match");
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`github http ${res.status}`);
    const data = await res.json() as {
      items?: { html_url: string; full_name: string; description?: string; pushed_at?: string; stargazers_count?: number }[];
    };
    return (data.items ?? []).slice(0, ctx.opts.maxResults ?? 10).map((r) => ({
      url: r.html_url,
      title: r.full_name,
      snippet: clampText(
        `${r.description ?? ""}${r.stargazers_count ? ` (★${r.stargazers_count})` : ""}`,
        400,
      ),
      engines: ["github"],
      published: r.pushed_at,
      kind: "github" as const,
    }));
  },
};
