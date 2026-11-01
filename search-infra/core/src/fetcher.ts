/**
 * Fetcher: 安全抓取 + 缓存 + focus 提取流程 (v0-spec §4.4)
 * - redirect: manual 逐跳过 SSRF 守卫(防重定向到内网)
 * - 抓回正文→原文入缓存→focus 读时过滤(dsh[10] 缓存原文设计)
 * - WorkBuddy[07] 口径: >15k 才值得提炼 → v0.1 不带 LLM,直接 focus 段裁剪
 */
import type { FetchOptions, FetchResult } from "./types.js";
import { Cache } from "./cache.js";
import { Budget, safeFetchUrl, validateUrl, type DomainPolicy } from "./governor.js";
import { extractHtml, extractFocus } from "./focus.js";
import type { Journal } from "./journal.js";
import type { CoreConfig } from "./config.js";

const UA_BLOCKED_HINTS = ["captcha", "unusual traffic", "access denied"];

export class Fetcher {
  #cache: Cache;
  #cfg: CoreConfig;
  #journal?: Journal;
  #fetchImpl: typeof fetch;

  constructor(cfg: CoreConfig, cache: Cache, journal?: Journal, fetchImpl?: typeof fetch) {
    this.#cfg = cfg;
    this.#cache = cache;
    this.#journal = journal;
    this.#fetchImpl = fetchImpl ?? fetch;
  }

  /**
   * phase AD 待办 1: crates.io 裸页是 SPA(空文本, 老 baselinet 上 L2 失败主力) →
   * 官方 API 端点直取(/api/v1/crates/{name}, 返回 JSON 元数据)。仅改写裸 crate 页;
   * 其他 crates 路径(如 /crates/x/versions)不动。 */
  static cratesApiRewrite(rawUrl: string): { name: string; apiUrl: string } | null {
    try {
      const u = new URL(rawUrl);
      if (u.hostname !== "crates.io") return null;
      const m = u.pathname.match(/^\/crates\/([^/]+)\/?$/);
      if (!m) return null;
      return { name: decodeURIComponent(m[1]), apiUrl: `https://crates.io/api/v1/crates/${encodeURIComponent(m[1])}` };
    } catch {
      return null;
    }
  }

  /** phase AD 待办 2: 从 url/错误信息里提 DOI(doi.org 链接或裸 DOI) */
  static doiOf(s: string): string | null {
    const m = s.match(/doi\.org\/(10\.\d{4,9}\/[^\s"&?#]+)\/?/i) ?? s.match(/\b(10\.\d{4,9}\/[^\s"&?#]+)$/i);
    return m ? decodeURIComponent(m[1]) : null;
  }

  /**
   * phase AD 待办 2: doi.org 落地 403(ssrn/wiley/emerald 类出版商反爬, bench L2 失败主力) →
   * OpenAlex 按 DOI 查 OA 直链(优先 html 落地页, pdf 兑底但 extractor 不吃 pdf 会诚实报错)。
   * OpenAlex 自身失败返回 null(不掩盖原始错)。 */
  async #resolveOaLanding(doi: string, policy?: DomainPolicy): Promise<string | null> {
    const mailto = this.#cfg.contactEmail;
    try {
      const m = mailto ? `?mailto=${encodeURIComponent(mailto)}` : "";
      // OpenAlex 文档形态: /works/https://doi.org/{doi} — 裸斜杠(按官方文档, 不 encodeURIComponent)。
      // 实弹教训(2026-09-03): 匿名池当日额度烧光时带 mailto 也 429 → 必须有第二通道。
      const r = await this.fetchSafe(`https://api.openalex.org/works/https://doi.org/${doi}${m}`, policy, 10000);
      const j = JSON.parse(r.body) as {
        best_oa_location?: { landing_page_url?: string | null; pdf_url?: string | null } | null;
        primary_location?: { landing_page_url?: string | null } | null;
      };
      const oa = j.best_oa_location?.landing_page_url
        ?? j.primary_location?.landing_page_url
        ?? j.best_oa_location?.pdf_url
        ?? null;
      if (oa) return oa;
    } catch {
      // OpenAlex 挂/429 → 换 Unpaywall 通道
    }
    if (!mailto) return null; // Unpaywall email 必填, 没配 contactEmail 就到此为止
    try {
      const r = await this.fetchSafe(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(mailto)}`, policy, 10000);
      const j = JSON.parse(r.body) as {
        best_oa_location?: { url?: string | null; url_for_landing_page?: string | null; url_for_pdf?: string | null } | null;
      };
      return j.best_oa_location?.url_for_landing_page
        ?? j.best_oa_location?.url
        ?? j.best_oa_location?.url_for_pdf
        ?? null;
    } catch {
      return null; // 双通道全挂 → 调用方抛原始错
    }
  }

  policyFor(runBlock?: string[], runAllow?: string[]): DomainPolicy {
    return { globalBlocked: this.#cfg.blockedDomains, block: runBlock, allow: runAllow };
  }

  /** 逐跳安全抓取,返回最终 URL + 内容 (SSRF 模式由 cfg.ssrf 控制) */
  async fetchSafe(
    rawUrl: string,
    policy?: DomainPolicy,
    timeoutMs = 20000,
  ): Promise<{ finalUrl: string; status: number; contentType: string | null; body: string }> {
    const ssrfOpts = {
      fakeIpCidrs: this.#cfg.fakeIpCidrs,
      allowPrivate: this.#cfg.ssrf === "allowPrivate",
    };
    let current = rawUrl;
    let res: Response | null = null;

    for (let hop = 0; hop < 5; hop++) {
      // ssrf=off: 仅协议/端口/域名校验,不做 DNS(测试/离线环境)
      const safe = this.#cfg.ssrf === "off"
        ? validateUrl(current, policy)
        : await safeFetchUrl(current, policy, ssrfOpts);
      if ("error" in safe) throw new Error(`ssrf: ${safe.error}`);
      res = await this.#fetchImpl(safe.url.href, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "User-Agent": this.#cfg.userAgent, Accept: "text/html,application/xhtml+xml,text/*;q=0.8,*/*;q=0.5" },
      });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location");
        if (!loc) break;
        current = new URL(loc, safe.url).href;
        try {
          await res.body?.cancel();
        } catch { /* ignore */ }
        continue;
      }
      break;
    }
    if (!res) throw new Error("fetch failed: no response");

    const contentType = res.headers.get("content-type");
    if (!res.ok) throw new Error(`http ${res.status} for ${current}`);

    const sizeCap = this.#cfg.maxPageBytes;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > sizeCap) {
      // 超大页截断而不是失败(全文缓存价值仍在) — 只取前 maxPageBytes
    }
    const slice = buf.byteLength > sizeCap ? buf.slice(0, sizeCap) : buf;
    const body = new TextDecoder("utf-8", { fatal: false }).decode(slice);
    return { finalUrl: current, status: res.status, contentType, body };
  }

  /** phase AD: 抓取+提取一条龙(供 OA 回退重用; crates 元数据在参数里带) */
  async #fetchExtract(
    url: string,
    policy?: DomainPolicy,
    crates?: { name: string; apiUrl: string } | null,
  ): Promise<{ status: number; contentType: string | null; text: string; title?: string; finalUrl: string }> {
    const r = crates ? await this.fetchSafe(crates.apiUrl, policy) : await this.fetchSafe(url, policy);
    const ct = (r.contentType ?? "").toLowerCase();
    if (!(ct.includes("html") || ct.includes("text") || ct.includes("json") || ct === "")) {
      throw new Error(`unsupported content-type: ${ct}`);
    }
    const lowBody = r.body.slice(0, 4000).toLowerCase();
    if (ct.includes("html") && UA_BLOCKED_HINTS.some((h) => lowBody.includes(h)) && lowBody.length < 2500) {
      throw new Error("blocked by anti-bot wall (captcha/denied)");
    }
    let text: string;
    let title: string | undefined;
    if (ct.includes("json")) {
      // phase AD: crates API JSON → 人读摘要(裸 JSON 太臃); 其他 JSON 原文返回
      const crateMeta = crates ? this.#cratesApiText(r.body, crates.name) : null;
      if (crateMeta) {
        text = crateMeta.text;
        title = crateMeta.title;
      } else {
        text = r.body;
      }
    } else {
      const ex = extractHtml(r.body);
      text = ex.text;
      title = ex.title || undefined;
    }
    if (text.length === 0) throw new Error("empty text extracted");
    return { status: r.status, contentType: r.contentType, text, title, finalUrl: r.finalUrl };
  }

  /** phase AD: crates API JSON → 人读摘要(字段缺失诚实留空, 不造假) */
  #cratesApiText(body: string, fallbackName: string): { text: string; title: string } | null {
    try {
      const j = JSON.parse(body) as { crate?: Record<string, unknown> };
      const c = j.crate ?? {};
      const name = String(c.name ?? fallbackName);
      const lines = [
        `# ${name} (crates.io)`,
        String(c.description ?? ""),
        `latest: ${String(c.max_stable_version ?? c.max_version ?? "-")}`,
        `license: ${String(c.license ?? "-")}`, // phase AG-4: crates 精确 API 本就返回 license
        `repository: ${String(c.repository ?? "-")}`,
        `documentation: ${String(c.documentation ?? "-")}`,
        `downloads: ${String(c.downloads ?? "-")}  updated: ${String(c.updated_at ?? "-")}`,
      ];
      return { text: lines.filter((l) => l && !l.endsWith(": -") && l !== "").join("\n"), title: name };
    } catch {
      return null; // 非 JSON → 回落原文路径
    }
  }

  /** 完整 fetch 工具流: 缓存→抓取→提取→focus→预算 */
  async run(
    rawUrl: string,
    opts: FetchOptions = {},
    policy?: DomainPolicy,
  ): Promise<FetchResult> {
    const t0 = Date.now();
    const ttl = opts.ttlSeconds ?? 900;
    const maxChars = opts.maxChars ?? 8000;
    const budget = new Budget(this.#cfg.budgetChars);

    let cached = opts.noCache ? null : this.#cache.getPage(rawUrl, ttl);
    let fromCache = !!cached;
    let status = 200;
    let title: string | undefined;
    let text: string;

    if (cached) {
      text = cached.text;
      title = cached.title;
    } else {
      this.#journal?.write("fetch", { url: rawUrl, cache: "miss" });
      // phase AD: 落地页改写链 — crates SPA→API 直取; doi 403/SPA 假 200 空文本→OA 直链回退(一次, 失败仍抱原始错)
      const crates = Fetcher.cratesApiRewrite(rawUrl);
      if (crates) this.#journal?.write("fetch_rewrite_crate_api", { from: rawUrl, to: crates.apiUrl });
      let finalCt: string | null = null;
      try {
        const x = await this.#fetchExtract(rawUrl, policy, crates);
        status = x.status;
        text = x.text;
        title = x.title;
        finalCt = x.contentType;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // 403(出版商反爬)与 empty text(SPA 假 200)都是"落地页拿不到正文", doi 在手就走 OA 回退
        const doi = (/\b403\b|empty text extracted/.test(msg)) ? (Fetcher.doiOf(rawUrl) ?? Fetcher.doiOf(msg)) : null;
        if (!doi) throw e;
        const oa = await this.#resolveOaLanding(doi, policy);
        // 自环守卫: Unpaywall 老记录的 OA 落地可能就是 doi.org 原链(实弹在案 2026-09-03) — 原样回取必然再 403
        if (!oa || oa.replace(/\/$/, "") === rawUrl.replace(/\/$/, "")) throw e;
        this.#journal?.write("fetch_oa_fallback", { doi, via: oa, cause: msg.slice(0, 80) });
        const x = await this.#fetchExtract(oa, policy, null);
        status = x.status;
        text = x.text;
        title = x.title;
        finalCt = x.contentType;
      }
      this.#cache.putPage(rawUrl, status, finalCt, title ?? null, text);
    }

    const textLength = text.length;
    budget.charge(maxChars, `fetch:${rawUrl.slice(0, 80)}`);
    this.#journal?.write("fetch_done", { url: rawUrl, textLength, fromCache });

    if (opts.focus) {
      const segments = extractFocus(text, opts.focus, maxChars, opts.adjacent ?? 1);
      if (segments) {
        const returnedChars = segments.join("\n…\n").length;
        return {
          url: rawUrl, title, status, fromCache,
          textLength, returnedChars,
          savedPct: Math.max(0, 1 - returnedChars / textLength),
          segments,
          elapsedMs: Date.now() - t0,
        };
      }
      // focus 无命中 → 降级: 返回头部截断(明确标注)
      return {
        url: rawUrl, title, status, fromCache,
        textLength, returnedChars: Math.min(maxChars, textLength),
        savedPct: Math.max(0, 1 - Math.min(maxChars, textLength) / textLength),
        segments: null as unknown as string[],
        text: text.slice(0, maxChars),
        elapsedMs: Date.now() - t0,
      };
    }

    // 无 focus: 头部截断返回
    const out = text.slice(0, maxChars);
    return {
      url: rawUrl, title, status, fromCache,
      textLength, returnedChars: out.length,
      savedPct: Math.max(0, 1 - out.length / textLength),
      text: out,
      elapsedMs: Date.now() - t0,
    };
  }
}
