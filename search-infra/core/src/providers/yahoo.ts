/**
 * Yahoo Web Search Provider — keyless (dsh[10] 四路免费层成员)
 * search.yahoo.com/search?p=
 */
import * as cheerio from "cheerio";
import type { Reference } from "../types.js";
import { clampText, type Provider, type SearchCtx } from "./base.js";

export const yahoo: Provider = {
  name: "yahoo",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://search.yahoo.com/search");
    u.searchParams.set("p", query);
    u.searchParams.set("n", String(Math.min(20, ctx.opts.maxResults ?? 10)));
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "text/html" },
    });
    if (!res.ok) throw new Error(`yahoo http ${res.status}`);
    const $ = cheerio.load(await res.text());
    const out: Reference[] = [];
    // 主结果: div#web ol li / div.dd.algo... 标记会漂移,多选择器兜底
    const seen = new Set<string>();
    $("div#web ol li div.compTitle, li div.compTitle").each((_, el) => {
      const a = $(el).find("a").first();
      const href = a.attr("href") ?? "";
      // yahoo 返回 r.search.yahoo.com/_ylt=.../RU=<encoded>/RK=... 跳转链
      const url = decodeYahooHref(href);
      if (!url || seen.has(url)) return;
      seen.add(url);
      const cap = $(el).closest("li").find("div.compText, p").first().text();
      out.push({
        url,
        title: clampText(a.text(), 200),
        snippet: clampText(cap, 400),
        engines: ["yahoo"],
        kind: "web",
      });
    });
    if (out.length === 0) throw new Error("yahoo: no results parsed (markup drift?)");
    return out.slice(0, ctx.opts.maxResults ?? 10);
  },
};

export function decodeYahooHref(href: string): string {
  if (!href) return "";
  if (href.startsWith("http") && !href.includes("r.search.yahoo.com")) return href;
  const m = href.match(/\/RU=([^/]+)\//);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch { /* fallthrough */ }
  }
  return "";
}
