// ---------- 主流引擎直连批 (c): google / baidu 车道 (2026-11-25, 无 key) ----------
// 与 Go lanes_google.go / lanes_baidu.go 对齐 (同日实弹证据, 沙箱 HK 数据中心出口)。
//
// google 实弹定论:
//   - google.com/search 直连 = JS 壳页 (全 UA 矩阵: Chrome/Firefox/Edge/Lynx/Android/
//     iPhone × gbv/lite/udm14/client/CONSENT/HTTP1.1 一律 meta-refresh→enablejs);
//     真 Chromium headless 渲染也落 /sorry/ ("automated queries") — IP 信誉墙。
//   - 车道语义: 干净 IP (用户本机/住宅出口) 环境下可用; 被标记出口上墙页如实
//     blocked (classifyFailure), 不静默返空、不自动解题 (Yahoo consent 同款纪律)。
//   - 新闻意图由 googlenews RSS 覆盖 (恒可用); keyed Google = serper/serpapi (批 a)。
//
// baidu 实弹定论:
//   - 桌面端 www.baidu.com/s 直连 = "百度安全验证" JS 挑战 (referer/cookie/spider UA 均墙);
//     移动端 m.baidu.com/s 首请求返回真 SERP (SSR, 10 结果块)。
//   - 连续请求很快触发图形验证码 (302 → wappass.baidu.com): 如实归类 blocked,
//     不自动解题; 进程级限速门默认 5s (SC_BAIDU_MIN_INTERVAL_MS)。
//   - 结果块: div.c-result + data-log JSON 的 mu 字段 = 真实目标 URL (绕过
//     m.baidu.com/from=... 跳转壳); 标题 h3.cosc-title; 摘要在 <!--s-data:--> 注释
//     的 summaryData.generalLines[].data[].text (SSR 数据)。
//   - 广告过滤 (用户口径"这种一般有标识"): mu 命中 baidu.php/eclick 跳转壳、块内
//     ec-tuiguang/baidu-tuiguang 标识 class、独立"广告"文本徽标 (整节点匹配防误伤) —
//     三把尺全过滤; recommend_list/note_lead 运营位组件按 mu 摘除。

import * as cheerio from "cheerio";
import type { Reference } from "../types.js";
import type { Provider, SearchCtx } from "./base.js";
import { httpErr } from "./base.js";

function clampTextLocal(s: string | undefined | null, max = 400): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) : t;
}

function stripHtmlLocal(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

// ---------- google ----------

/** 批(c): 墙页三签名 — enablejs JS 壳 / /sorry/ 自动化查询墙 / 弃用浏览器页 */
export function googleIsWallPage(html: string): boolean {
  return html.includes("enablejs") || html.includes("/sorry/") || html.includes("Update your browser");
}

/** /url?q=<target> 跳转壳解码; google 自家域 (host 级判据, 防子串误伤) 丢弃 */
export function decodeGoogleHref(href: string | undefined): string {
  if (!href) return "";
  if (href.startsWith("/url")) {
    try {
      const u = new URL(href, "https://www.google.com");
      const target = u.searchParams.get("q") ?? "";
      return target.startsWith("http") ? target : "";
    } catch {
      return "";
    }
  }
  if (!href.startsWith("http")) return "";
  try {
    const host = new URL(href).hostname.toLowerCase().replace(/^www\./, "");
    const internal =
      host === "google.com" || host.startsWith("google.") ||
      host.endsWith(".google.com") || host.includes(".google.");
    return internal ? "" : href;
  } catch {
    return "";
  }
}

export const google: Provider = {
  name: "google",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const u = new URL("https://www.google.com/search");
    u.searchParams.set("q", query);
    u.searchParams.set("num", String(Math.min(20, ctx.opts.maxResults ?? 10)));
    u.searchParams.set("hl", "en");
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: {
        // Google 对 bot UA 直接墙; 浏览器 UA 是直连前提 (批(c) 实弹矩阵)
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) throw new Error(httpErr("google", res)); // S2: 429 携带 Retry-After
    const html = await res.text();
    if (googleIsWallPage(html)) {
      throw new Error("google: blocked (IP-reputation wall: enablejs/sorry shell page)");
    }
    const $ = cheerio.load(html);
    const out: Reference[] = [];
    const seen = new Set<string>();
    const root = $("#search").length ? $("#search") : $("#rso");
    if (!root.length) throw new Error("google: no results parsed (markup drift or blocked?)");
    root.find("div.g, div[data-snhf], div.MjjYud").each((_, el) => {
      // 赞助块 (广告): Sponsored 徽标 / uEierd 赞助容器 — 整体跳过
      if ($(el).find("span:contains('Sponsored')").length > 0 || $(el).hasClass("uEierd")) return;
      const h = $(el).find("h3").first();
      const a = $(el).find("a[href]").first();
      if (!h.length || !a.length) return;
      const url = decodeGoogleHref(a.attr("href"));
      if (!url || seen.has(url)) return;
      seen.add(url);
      const snippet = $(el).find("div.VwiC3b, div[data-sncf], div.IsZvec").first().text().trim();
      out.push({
        url,
        title: clampTextLocal(h.text(), 200),
        snippet: clampTextLocal(snippet, 400),
        engines: ["google"],
        kind: "web" as const,
      });
    });
    if (out.length === 0) throw new Error("google: no results parsed (markup drift or blocked?)");
    return out.slice(0, ctx.opts.maxResults ?? 10);
  },
};

// ---------- baidu ----------

const BAIDU_MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const BAIDU_MIN_INTERVAL_MS = (() => {
  const v = Number(process.env.SC_BAIDU_MIN_INTERVAL_MS ?? "");
  return Number.isFinite(v) && v >= 0 ? v : 5000;
})();

let baiduLastAt = 0;

/** 进程级限速门 (验证码来得快; Go baiduGate 同款, 数十 ms jitter 防多进程同频) */
async function baiduGate(): Promise<void> {
  const wait = baiduLastAt + BAIDU_MIN_INTERVAL_MS - Date.now();
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait + (Date.now() % 250)));
  }
  baiduLastAt = Date.now();
}

/** 批(c): data-log JSON mu 提取 + 广告/运营位过滤后的移动端 SERP 解析 (纯函数, 可测) */
export function parseBaiduMobileHTML(html: string, max: number): Reference[] {
  if (html.includes("百度安全验证") || html.includes("wappass.baidu.com")) return [];
  const out: Reference[] = [];
  const seen = new Set<string>();
  const tagRe = /<div[^>]*class="c-result result"[^>]*>/g;
  const tags = [...html.matchAll(tagRe)];
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i][0];
    const start = (tags[i].index ?? 0) + tag.length;
    const dl = /data-log='([^']*)'/.exec(tag);
    if (!dl) continue;
    let mu = "";
    try {
      mu = (JSON.parse(dl[1]) as { mu?: string }).mu ?? "";
    } catch {
      continue;
    }
    mu = mu.replace(/&amp;/g, "&"); // data-log 属性内 HTML 实体
    if (!mu.startsWith("http")) continue;
    if (/recommend_list\.baidu\.com|note_lead\.baidu\.com/.test(mu)) continue; // 运营位组件
    if (mu.includes("baidu.php") || mu.includes("eclick.baidu.com")) continue; // 广告跳转壳
    if (seen.has(mu)) continue;
    const end = i + 1 < tags.length ? tags[i + 1].index ?? html.length : html.length;
    const block = html.slice(start, end);
    // 广告标识: ec-tuiguang/baidu-tuiguang class + 独立"广告"文本节点徽标
    if (/ec-tuiguang|baidu-tuiguang|>\s*广告\s*</.test(block)) continue;
    const h3 = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(block);
    if (!h3) continue;
    const title = stripHtmlLocal(h3[1]).trim();
    if (!title) continue;
    // 摘要: s-data 注释 SSR JSON (summaryData.generalLines[].data[].text)
    let snippet = "";
    const sd = /<!--s-data:(\{"summaryData"[\s\S]*?)-->/.exec(block);
    if (sd) {
      try {
        const j = JSON.parse(sd[1]) as {
          summaryData?: { generalLines?: { data?: { text?: string }[] }[] };
        };
        snippet = (j.summaryData?.generalLines ?? [])
          .flatMap((ln) => (ln.data ?? []).map((d) => d.text ?? ""))
          .join(" ")
          .trim();
      } catch {
        snippet = "";
      }
    }
    seen.add(mu);
    out.push({
      url: mu,
      title: clampTextLocal(title, 200),
      snippet: clampTextLocal(stripHtmlLocal(snippet), 400),
      engines: ["baidu"],
      kind: "web" as const,
    });
    if (out.length >= max) break;
  }
  return out;
}

export const baidu: Provider = {
  name: "baidu",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    await baiduGate();
    const u = new URL("https://m.baidu.com/s");
    u.searchParams.set("word", query);
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": BAIDU_MOBILE_UA, Accept: "text/html" },
    });
    if (!res.ok) throw new Error(httpErr("baidu", res)); // S2: 429 携带 Retry-After
    // 302 → wappass 验证码: fetch 跟随后 res.url 可判 (Yahoo consent 同款手法)
    if (res.url && res.url.includes("wappass")) {
      throw new Error("baidu: blocked (captcha wall, wappass redirect)");
    }
    const html = await res.text();
    if (html.includes("百度安全验证")) {
      throw new Error("baidu: blocked (captcha wall page)");
    }
    const out = parseBaiduMobileHTML(html, ctx.opts.maxResults ?? 10);
    if (out.length === 0) throw new Error("baidu: no results parsed (markup drift or blocked?)");
    return out;
  },
};
