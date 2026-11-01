/**
 * Mojeek Provider — keyless,索引独立(非 Google/Bing 代理),结果干净
 * https://www.mojeek.com/search?q=
 */
import * as cheerio from "cheerio";
import type { Reference } from "../types.js";
import { clampText, type Provider, type SearchCtx } from "./base.js";

export const mojeek: Provider = {
  name: "mojeek",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://www.mojeek.com/search");
    u.searchParams.set("q", query);
    if (ctx.opts.lang) u.searchParams.set("lang", ctx.opts.lang);
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "text/html" },
    });
    if (!res.ok) throw new Error(`mojeek http ${res.status}`);
    const $ = cheerio.load(await res.text());
    const out: Reference[] = [];
    $("ul.results-standard li, li.result").each((_, el) => {
      const a = $(el).find("a.title, h2 a").first();
      const url = a.attr("href") ?? "";
      if (!url?.startsWith("http")) return;
      out.push({
        url,
        title: clampText(a.text(), 200),
        snippet: clampText($(el).find("p.s, p.sc").first().text(), 400),
        engines: ["mojeek"],
        kind: "web",
      });
    });
    if (out.length === 0) throw new Error("mojeek: no results parsed (markup drift?)");
    return out.slice(0, ctx.opts.maxResults ?? 10);
  },
};
