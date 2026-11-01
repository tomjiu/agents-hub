/**
 * SearXNG Provider — 免费底座标准姿势 (Perplexica[12]: /search?format=json&engines=...)
 *
 * phase AB(免 Key 增量轮)多实例回退链:
 * - 用户实测 searx.space 80 实例只有 2 个仍开 format=json(mectov 333ms / xo.st 3.9s),
 *   本轮独立复验通过(200 JSON results=10)——公共实例"刻意关 JSON+反爬"是行业现状,
 *   公共实例只能当兜底,自建最稳(docs/selfhost-searxng.md)。
 * - 链序: SC_SEARXNG_BASE_URL(自建,永远最优先) → 内置兜底实例(探针存活名单)。
 *   SC_SEARXNG_INSTANCES 可覆盖内置兜底名单。
 * - 防伪 200 教训(phase AA searx.be): 反爬挑战页会伪装 200 + HTML,
 *   所以判定标准是"能 JSON.parse 且有 results 数组",不是 HTTP 状态码。
 * - isConfigured() 恒 true: 内置兜底链让 searxng 从"配了才注册"变成"永远在线",
 *   实例全灭时抛最后一个错误交熔断(rate_limited 自愈快,2min 冷却)。
 */
import type { Reference } from "../types.js";
import { clampText, type Provider, type SearchCtx } from "./base.js";

/** 内置兜底实例(2026-09-03 探针存活;随时可能关 JSON/限流——熔断+回退链兜住,勿当唯一主力) */
export const DEFAULT_SEARXNG_INSTANCES = [
  "https://search.mectov.my.id",
  "https://sx.xo.st",
];

interface SearxngResult {
  url: string; title?: string; content?: string; publishedDate?: string; engines?: string[];
}

export const searxng: Provider = {
  name: "searxng",
  needsKey: false,
  config: {},
  isConfigured() {
    // phase AB: 有自建或内置兜底链即在线(恒 true,除非用户显式传空数组禁用)
    const inst = searxng.config?.instances ?? DEFAULT_SEARXNG_INSTANCES;
    return !!searxng.config?.baseUrl || inst.length > 0;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const candidates = [...instanceChain(searxng.config)];
    if (candidates.length === 0) throw new Error("searxng: no instance configured");

    let lastErr: Error | undefined;
    for (const base of candidates) {
      try {
        return await searchOne(base, query, ctx);
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        // 伪 200(挑战页)/429/超时都换下一家;全灭才抛最后一个错误交熔断
      }
    }
    throw lastErr ?? new Error("searxng: all instances failed");
  },
};

/** 回退链: 自建(SC_SEARXNG_BASE_URL)最优先 → 实例名单(SC_SEARXNG_INSTANCES 或内置) */
function instanceChain(cfg: searxngConfig | undefined): string[] {
  const fallback = cfg?.instances ?? DEFAULT_SEARXNG_INSTANCES;
  const chain = cfg?.baseUrl ? [cfg.baseUrl, ...fallback] : [...fallback];
  return [...new Set(chain.map((b) => b.replace(/\/+$/, "")))];
}
type searxngConfig = { baseUrl?: string; engines?: string; instances?: string[] };

async function searchOne(base: string, query: string, ctx: SearchCtx): Promise<Reference[]> {
  const u = new URL(base + "/search");
  u.searchParams.set("q", query);
  u.searchParams.set("format", "json");
  if (ctx.opts.lang) u.searchParams.set("language", ctx.opts.lang);
  if (searxng.config?.engines) u.searchParams.set("engines", searxng.config.engines);
  const tr = freshnessMap[ctx.opts.freshness ?? "any"];
  if (tr) u.searchParams.set("time_range", tr);

  const res = await ctx.fetchImpl(u.href, {
    signal: ctx.signal,
    headers: { "User-Agent": ctx.ua, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`searxng ${base} http ${res.status}`);
  let data: { results?: SearxngResult[] };
  try {
    data = await res.json() as { results?: SearxngResult[] };
  } catch {
    // searx.be 教训: 反爬挑战页伪 200 + HTML, JSON 解析失败=实例不可用,不是引擎坏
    throw new Error(`searxng ${base}: non-json response (antibot page?)`);
  }
  if (!Array.isArray(data.results)) throw new Error(`searxng ${base}: no results field (drift?)`);
  const out = data.results.slice(0, ctx.opts.maxResults ?? 10).map((r) => ({
    url: r.url,
    title: clampText(r.title, 200),
    snippet: clampText(r.content, 400),
    engines: ["searxng"],
    published: r.publishedDate,
    kind: "web" as const,
  }));
  // SERP 引擎空结果按“实例没给出货”处理 → 回退链换下一家; 全空则抛错交熔断(与其他 SERP provider 空即抛惯例一致)
  if (out.length === 0) throw new Error(`searxng ${base}: 0 results`);
  return out;
}

export const freshnessMap: Record<string, string | undefined> = {
  day: "day", week: "week", month: "month", year: "year", any: undefined,
};
