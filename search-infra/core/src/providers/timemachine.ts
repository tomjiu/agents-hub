/**
 * 时间机器双 Provider (v0.5, quick-mirothinker.md 裁决"值得抄"的落地)
 * - wayback: Internet Archive Wayback Machine — 给一个 URL 查它的历史快照时间线
 *            (死链复活/页面演变/被删内容取证)。CDX API 免 key。
 * - wikirev: Wikipedia 修订历史 — 给一个词条名查它的每次编辑记录
 *            (谁改的/改了多大/为什么改)。REST v1 history 端点, 与 wikipedia provider 同族。
 *
 * 共同点: 都不是关键词引擎 — query 是 URL/词条名, 传关键词进来抛错教学(诚实话术)。
 * 默认不进池(普通关键词查询轮不到它们), engines:["wayback"] / ["wikirev"] 显式启用。
 *
 * 空结果语义(与关键词引擎不同): 没被存档/没修订历史是确定性的正常结果,
 * HTTP 200 + 空数组 → 返回 [] 不抛错(抛错会误触发熔断把好引擎拉黑);
 * 但结构解析异常/HTTP 非 200 照家规抛错交 Router 健康统计。
 */
import type { Reference } from "../types.js";
import { clampText, type Provider, type SearchCtx } from "./base.js";

const ARCHIVE_KIND = "archive" as const;

/** query 是否像 URL/域名(至少有个点);纯关键词如 "rust lang" 不是时间机器的输入 */
function looksLikeUrlOrDomain(q: string): boolean {
  if (/^https?:\/\//i.test(q)) return true;
  // example.com / example.com/path / www.example.com — 域名形状
  return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q.trim());
}

// ---------- Wayback (CDX API: URL → 历史快照时间线) ----------

export const wayback: Provider = {
  name: "wayback",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const q = query.trim();
    if (!looksLikeUrlOrDomain(q)) {
      throw new Error(
        `wayback: "${q.slice(0, 60)}" is not a URL/domain — wayback is a time machine, pass an address like "example.com/page" (keyword search belongs to other engines)`,
      );
    }
    // CDX API(免 key): fl 定字段序, collapse=timestamp:6 同月去重(时间线颗粒度≈月),
    // filter=statuscode:200 只看存得好的快照
    const u = new URL("https://web.archive.org/cdx/search/cdx");
    u.searchParams.set("url", q);
    u.searchParams.set("output", "json");
    u.searchParams.set("fl", "timestamp,original,statuscode,mimetype");
    u.searchParams.set("filter", "statuscode:200");
    u.searchParams.set("collapse", "timestamp:6");
    u.searchParams.set("limit", String(Math.min(50, ctx.opts.maxResults ?? 10)));
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`wayback cdx http ${res.status}`);
    const rows = (await res.json()) as unknown;
    // [[header...], [row...], ...]; 空库返回 [] — 确定性"没被存档", 诚实返回空
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const header = (rows[0] as string[]).map((h) => String(h).toLowerCase());
    const ti = header.indexOf("timestamp");
    const oi = header.indexOf("original");
    const si = header.indexOf("statuscode");
    const mi = header.indexOf("mimetype");
    if (ti < 0 || oi < 0) throw new Error("wayback: unexpected CDX header (markup drift?)");
    const out: Reference[] = [];
    for (const row of rows.slice(1)) {
      const cells = row as (string | number)[];
      const ts = String(cells[ti] ?? "");
      const original = String(cells[oi] ?? "");
      if (!/^\d{14}$/.test(ts) || !original.startsWith("http")) continue;
      // 快照直链: web.archive.org/web/<ts>/<original> (agent 可直接 fetch 复活旧页面)
      const snapshot = `https://web.archive.org/web/${ts}/${original}`;
      // ts=yyyyMMddhhmmss → 人类可读
      const when = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)} ${ts.slice(8, 10)}:${ts.slice(10, 12)}`;
      const meta = [
        "200",
        String(cells[mi] ?? "").split(";")[0] || undefined,
      ].filter(Boolean).join(" · ");
      out.push({
        url: snapshot,
        title: clampText(`${original} @ ${when}`, 200),
        snippet: clampText(`[snapshot] ${meta}`, 400),
        engines: ["wayback"],
        published: when,
        kind: ARCHIVE_KIND,
      });
    }
    return out.slice(0, ctx.opts.maxResults ?? 10);
  },
};

// ---------- WikiRev (Wikipedia 修订历史: 词条 → 编辑记录) ----------

/** 接受裸词条名("Python (programming language)")或完整 wiki URL;统一成词条 title */
function extractPageTitle(q: string): string {
  let s = q.trim();
  const m = s.match(/wikipedia\.org\/wiki\/([^?#]+)/i);
  if (m) {
    try { s = decodeURIComponent(m[1]); } catch { s = m[1]; }
  }
  return s.replace(/_/g, " ").trim();
}

export const wikirev: Provider = {
  name: "wikirev",
  needsKey: false,
  isConfigured() {
    return true;
  },

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const title = extractPageTitle(query);
    if (!title || title.length > 300) {
      throw new Error(
        `wikirev: "${query.slice(0, 60)}" — pass a Wikipedia article name or wiki URL (this is an edit-history lookup, not keyword search)`,
      );
    }
    const lang = (ctx.opts.lang ?? "en").split("-")[0].toLowerCase() || "en";
    // REST v1 history(同族 wikipedia provider 的规范 UA 已解锁);匿名档 limit 保守 cap 50
    const u = new URL(`https://${lang}.wikipedia.org/w/rest.php/v1/page/${encodeURIComponent(title)}/history`);
    u.searchParams.set("limit", String(Math.min(50, ctx.opts.maxResults ?? 10)));
    const res = await ctx.fetchImpl(u.href, {
      signal: ctx.signal,
      headers: { "User-Agent": ctx.ua, Accept: "application/json" },
    });
    if (res.status === 404) throw new Error(`wikirev http 404 (page "${title.slice(0, 60)}" not found on ${lang}.wikipedia)`);
    if (!res.ok) throw new Error(`wikirev http ${res.status}`);
    const data = (await res.json()) as {
      revisions?: {
        id: number; timestamp: string;
        /** REST v1: user 是 {id, name} 对象不是字符串(2026-09-03 实探) */
        user?: { id?: number; name?: string };
        comment?: string; size?: number; delta?: number;
      }[];
    };
    const revs = data.revisions ?? [];
    // 空修订历史是正常语义(理论上首页也有修订, 空基本只见于极冷门页) — 诚实返回空
    if (revs.length === 0) return [];
    const out: Reference[] = revs
      .filter((r) => Number.isFinite(r.id))
      .map((r) => {
        // oldid 直链: 永久定格在那个版本的页面(agent 可直接 fetch 取证)
        const url = `https://${lang}.wikipedia.org/w/index.php?title=${encodeURIComponent(title.replace(/ /g, "_"))}&oldid=${r.id}`;
        const when = (r.timestamp ?? "").replace("T", " ").replace("Z", "");
        const meta = [
          r.user?.name,
          when,
          r.size !== undefined ? `${r.size} bytes${r.delta !== undefined ? ` (${r.delta >= 0 ? "+" : ""}${r.delta})` : ""}` : "",
          r.comment,
        ].filter(Boolean).join(" · ");
        return {
          url,
          title: clampText(`${title} · rev ${r.id}`, 200),
          snippet: clampText(`[revision] ${meta}`, 400),
          engines: ["wikirev"],
          published: r.timestamp,
          kind: ARCHIVE_KIND,
        };
      });
    return out.slice(0, ctx.opts.maxResults ?? 10);
  },
};
