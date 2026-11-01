/**
 * DuckDuckGo HTML Provider — keyless
 * 用 html.duckduckgo.com/html/ 的表单接口 + cheerio 解析。
 * Markup 会漂移: 解析失败时抛错交给 Router 健康统计,不静默返回空(Perplexica[12] 教训)。
 *
 * v0.3 反爬三件套(10-c 博客圈实测档案: 202 空页=软封会自愈,触发=burst+脏 IP,
 * DDG 流量 2026-05 暴涨 30% → 礼貌限速从优化项变生存项):
 * 1. 全局限速门: 同进程内 DDG 请求最小间隔(默认 3s, SC_DDG_MIN_INTERVAL_MS 覆盖, 0 关闭)
 * 2. 202 软封检测: DDG 封锁时返回 202+空页伪装"无结果", 显式识别为限速信号而非结果
 * 3. 空结果退避重试一次: gate 间隔后再试一枪, 两次全空才交健康统计
 */
import * as cheerio from "cheerio";
import type { Reference } from "../types.js";
import { clampText, absoluteUrl, type Provider, type SearchCtx } from "./base.js";

// 限速门: 读 env 用函数而不是模块常量, 方便测试注入 0
function ddgMinIntervalMs(): number {
  const v = Number(process.env.SC_DDG_MIN_INTERVAL_MS);
  return Number.isFinite(v) && v >= 0 ? v : 3000;
}
let lastDdgAt = 0;

async function ddgGate(): Promise<void> {
  const wait = lastDdgAt + ddgMinIntervalMs() - Date.now();
  if (wait > 0) {
    // 随机化间隔: 数十 ms 级 jitter, 避免多进程同频(10-c 社区绕法)
    await new Promise((r) => setTimeout(r, wait + Math.random() * 250));
  }
  lastDdgAt = Date.now();
}

export const duckduckgo: Provider = {
  name: "duckduckgo",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const attempt = async (): Promise<{ refs: Reference[]; html: string; status: number }> => {
      await ddgGate();
      const body = new URLSearchParams({
        q: query,
        b: "",
        kl: ctx.opts.lang ?? "",
        df: freshnessMap[ctx.opts.freshness ?? "any"] ?? "",
      });
      const res = await ctx.fetchImpl("https://html.duckduckgo.com/html/", {
        method: "POST",
        signal: ctx.signal,
        headers: {
          "User-Agent": ctx.ua,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "text/html",
        },
        body: body.toString(),
      });
      if (res.status === 202) {
        // 软封签名: 202+空页伪装"无结果"; 抛错走重试/健康统计, 绝不当真结果返回
        return { refs: [], html: "", status: 202 };
      }
      if (!res.ok) throw new Error(`ddg http ${res.status}`);
      const html = await res.text();
      const $ = cheerio.load(html);
      const out: Reference[] = [];
      $(".result, .web-result").each((_, el) => {
        const a = $(el).find("a.result__a").first();
        const href = a.attr("href") ?? "";
        // ddg 返回 //duckduckgo.com/l/?uddg=<encoded> 跳转链,需还原
        const url = decodeDdgHref(href);
        if (!url) return;
        const snippet = $(el).find(".result__snippet").first().text();
        out.push({
          url,
          title: clampText(a.text(), 200),
          snippet: clampText(snippet, 400),
          engines: ["duckduckgo"],
          kind: "web",
        });
      });
      return { refs: out, html, status: res.status };
    };

    let { refs, html } = await attempt();
    if (refs.length === 0) {
      // 空结果/202 = 限速信号(10-c: 指数退避+jitter, 这里单次退避重试, 再挂交熔断)
      // gate 关闭(测试注入 SC_DDG_MIN_INTERVAL_MS=0)时跳过真实等待
      const backoff = ddgMinIntervalMs() > 0 ? 1200 + Math.random() * 800 : 0;
      if (backoff > 0) await new Promise((r) => setTimeout(r, backoff));
      ({ refs, html } = await attempt());
    }
    if (refs.length === 0 && !html.includes("result")) {
      throw new Error("ddg: no results parsed (markup drift or soft-block?)");
    }
    return refs.slice(0, ctx.opts.maxResults ?? 10);
  },
};

export function decodeDdgHref(href: string): string {
  if (!href) return "";
  let h = absoluteUrl("https://duckduckgo.com", href);
  if (h.includes("/l/?") || h.includes("/l/?uddg=")) {
    try {
      const u = new URL(h);
      const target = u.searchParams.get("uddg");
      if (target) return target;
    } catch { /* fallthrough */ }
  }
  return h.startsWith("http") ? h : "";
}

export const freshnessMap: Record<string, string | undefined> = {
  day: "d", week: "w", month: "m", year: "y", any: undefined,
};
