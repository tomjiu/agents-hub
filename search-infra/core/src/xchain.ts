/**
 * X/Twitter 搜索降级链 (v0.2) — dsh[10] xfallback.js 设计的独立实现
 * 证据: reports/10-dsh-search-boost.md §5:
 *  - keyword/semantic → 多免费引擎 site:x.com → 对 top 1-2 status URL 做 oEmbed 全文增强
 *  - Guest GraphQL: x.com 匿名 web bearer(前端公开值) + guest token(磁盘缓存 2h)
 *  - 自愈三件套: GraphQL 失效时从 x.com JS bundle 重提取轮换的 queryId(xfallback.js:182)、
 *    guest token 401/403 重铸、HTML 实体全量解码
 *
 * 链路(v0.2): 官方 API(有 key 时) ∥ Guest GraphQL ∥ site:x.com keyless 引擎 → allSettled 合并
 *            → oEmbed 增强 keyless 来源的 top 状态。
 * 纪律: 每层独立超时+熔断,单层失败不阻塞其他层;与平台对抗的部分(queryId)带轮换自愈。
 */
import type { CoreConfig } from "./config.js";
import type { Cache } from "./cache.js";
import type { HealthTracker } from "./providers/base.js";
import type { Journal } from "./journal.js";
import type { Reference, SearchOptions, EngineFailure } from "./types.js";
import { classifyFailure } from "./providers/base.js";
import type { FetchImpl } from "./providers/base.js";
import { clampText } from "./providers/base.js";
import { normalizeUrl } from "./fusion.js";

/** x.com 前端公开匿名 bearer(dsh[10] "x.com 前端公开值";开源工具通用公开常量) */
const PUBLIC_WEB_BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const GUEST_TTL_SECONDS = 2 * 3600;      // dsh[10]: guest token 磁盘缓存 2h
const QUERYID_TTL_SECONDS = 24 * 3600;

export interface XChainDeps {
  config: CoreConfig;
  cache: Cache;
  health: HealthTracker;
  journal?: Journal;
  fetchImpl?: FetchImpl;
  /** keyless site: 引擎层(由 Router 提供,避免循环依赖) */
  runKeyless: (siteQuery: string, opts: SearchOptions) => Promise<{ refs: Reference[]; used: string[]; failed: EngineFailure[]; skipped?: unknown[]; degraded?: boolean }>;
}

export interface XChainResult {
  refs: Reference[];
  used: string[];   // 参与的层: x-official / x-guest / x-keyless / x-oembed
  failed: EngineFailure[];
}

function decodeEntities(s: string): string {
  // dsh[10] 自愈三件套之一: HTML 实体全量解码
  const named: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };
  return s
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => named[m] ?? m)
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)));
}

async function jfetch<T>(impl: FetchImpl, url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const res = await impl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`http ${res.status} for ${new URL(url).host}`);
  return (await res.json()) as T;
}

/** FetchImpl 缺省适配(无注入时用全局 fetch) */
const defaultImpl: FetchImpl = (url, init) => fetch(url as string, init);

// ---------- 层 1: 官方 API(有 Bearer 才参与) ----------

interface Twt {
  id: string; text: string; created_at?: string; author_id?: string;
}
interface TwtResp {
  data?: Twt[];
  includes?: { users?: { id: string; username: string }[] };
}

async function officialLayer(deps: XChainDeps, query: string, opts: SearchOptions): Promise<Reference[]> {
  const bearer = deps.config.x?.bearerToken;
  if (!bearer) throw new Error("no bearer configured");
  const n = Math.min(opts.maxResults ?? 10, 100);
  const url = `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=${Math.max(n, 10)}` +
    `&tweet.fields=created_at&expansions=author_id&user.fields=username`;
  const json = await jfetch<TwtResp>(deps.fetchImpl ?? defaultImpl, url, {
    headers: { Authorization: `Bearer ${bearer}` },
  }, deps.config.timeoutMs);
  const users = new Map((json.includes?.users ?? []).map((u) => [u.id, u.username]));
  return (json.data ?? []).map((t) => {
    const sn = t.author_id ? users.get(t.author_id) : undefined;
    return {
      url: sn ? `https://x.com/${sn}/status/${t.id}` : `https://x.com/i/web/status/${t.id}`,
      title: sn ? `@${sn}` : "x.com status",
      snippet: clampText(decodeEntities(t.text), 400),
      engines: ["x-official"],
      kind: "x" as const,
      published: t.created_at,
    };
  });
}

// ---------- 层 2: Guest GraphQL(queryId 轮换自愈) ----------

function kvJson(cache: Cache, key: string): { at: number; value: unknown } | null {
  try {
    const raw = cache.kvGet(key);
    return raw ? (JSON.parse(raw) as { at: number; value: unknown }) : null;
  } catch {
    return null;
  }
}

async function getGuestToken(deps: XChainDeps): Promise<string> {
  const cached = kvJson(deps.cache, "x:guest_token");
  if (cached && Date.now() - cached.at < GUEST_TTL_SECONDS * 1000) return cached.value as string;
  const json = await jfetch<{ guest_token: string }>(
    deps.fetchImpl ?? defaultImpl,
    "https://api.x.com/1.1/guest/activate.json",
    { method: "POST", headers: { Authorization: `Bearer ${PUBLIC_WEB_BEARER}` } },
    8000,
  );
  deps.cache.kvSet("x:guest_token", JSON.stringify({ at: Date.now(), value: json.guest_token }));
  return json.guest_token;
}

/** 从 x.com 前端 JS bundle 提取 SearchTimeline 的 queryId(dsh[10] xfallback.js:182 的轮换自愈) */
export async function extractSearchQueryId(deps: XChainDeps): Promise<string> {
  const impl = deps.fetchImpl ?? defaultImpl;
  const home = await impl("https://x.com/home", {
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": deps.config.userAgent, Accept: "text/html" },
  });
  if (!home.ok) throw new Error(`x.com home http ${home.status}`);
  const html = await home.text();
  const srcs = [...html.matchAll(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web[^"']+\.js/g)]
    .map((m) => m[0])
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .sort((a, b) => {
      const score = (s: string) => (/main\./.test(s) ? 0 : /api/.test(s) ? 1 : /search/.test(s) ? 2 : 3);
      return score(a) - score(b);
    })
    .slice(0, 3);
  if (srcs.length === 0) throw new Error("no bundle scripts found on x.com home");
  for (const src of srcs) {
    try {
      const js = await (await impl(src, { signal: AbortSignal.timeout(10000) })).text();
      // bundle 里 SearchTimeline 定义形如 queryId:"<64hex>",...,operationName:"SearchTimeline";向后回看 250 字符
      for (const idx of [...js.matchAll(/SearchTimeline/g)].map((m) => m.index ?? 0)) {
        const window = js.slice(Math.max(0, idx - 250), idx);
        const ids = [...window.matchAll(/queryId["':\s]+([0-9a-f]{64})/g)];
        if (ids.length > 0) {
          const qid = ids[ids.length - 1][1];
          deps.cache.kvSet("x:queryId", JSON.stringify({ at: Date.now(), value: qid }));
          return qid;
        }
      }
    } catch { /* 下一个 bundle */ }
  }
  throw new Error("SearchTimeline queryId not found in bundles");
}

async function getQueryId(deps: XChainDeps): Promise<string> {
  const cached = kvJson(deps.cache, "x:queryId");
  if (cached && Date.now() - cached.at < QUERYID_TTL_SECONDS * 1000) return cached.value as string;
  return extractSearchQueryId(deps);
}

const GQL_FEATURES: Record<string, boolean> = {
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

interface GqlTweet {
  rest_id?: string;
  legacy?: { full_text?: string; created_at?: string };
  core?: { user_results?: { result?: { legacy?: { screen_name?: string }; core?: { screen_name?: string } } } };
  tweet?: GqlTweet; // TweetWithVisibilityResults 包装
}

async function guestSearchOnce(deps: XChainDeps, queryId: string, query: string, guestToken: string): Promise<Reference[]> {
  const variables = JSON.stringify({
    rawQuery: query, count: 20, querySource: "typed_query", product: "Latest",
  });
  const features = encodeURIComponent(JSON.stringify(GQL_FEATURES));
  const url = `https://x.com/i/api/graphql/${queryId}/SearchTimeline?variables=${encodeURIComponent(variables)}&features=${features}`;
  const impl = deps.fetchImpl ?? defaultImpl;
  const res = await impl(url, {
    method: "GET",
    signal: AbortSignal.timeout(9000),
    headers: {
      Authorization: `Bearer ${PUBLIC_WEB_BEARER}`,
      "x-guest-token": guestToken,
      "Content-Type": "application/json",
      "x-twitter-active-user": "yes",
      "x-twitter-client-language": "en",
      "User-Agent": deps.config.userAgent,
    },
  });
  if (!res.ok) throw new Error(`guest gql http ${res.status}`);
  const json = (await res.json()) as {
    data?: { search_by_raw_query?: { search_timeline?: { timeline?: { entries?: { content?: { entryType?: string; itemContent?: { tweet_results?: { result?: GqlTweet } } } }[] } } } };
  };
  const entries = json.data?.search_by_raw_query?.search_timeline?.timeline?.entries ?? [];
  const out: Reference[] = [];
  for (const e of entries) {
    if (e.content?.entryType !== "TimelineTimelineItem") continue;
    let result = e.content.itemContent?.tweet_results?.result;
    if (!result) continue;
    if (!result.rest_id && result.tweet) result = result.tweet; // visibility 包装
    const id = result.rest_id;
    const text = result.legacy?.full_text;
    if (!id || !text) continue;
    const sn = result.core?.user_results?.result?.core?.screen_name
      ?? result.core?.user_results?.result?.legacy?.screen_name;
    out.push({
      url: sn ? `https://x.com/${sn}/status/${id}` : `https://x.com/i/web/status/${id}`,
      title: sn ? `@${sn}` : "x.com status",
      snippet: clampText(decodeEntities(text), 400),
      engines: ["x-guest"],
      kind: "x",
      published: result.legacy?.created_at,
    });
  }
  return out;
}

/** guest 层: 自愈逻辑 — 401/403 重铸 token;4xx 轮换 queryId 后重试一次 */
async function guestLayer(deps: XChainDeps, query: string): Promise<Reference[]> {
  try {
    const [token, qid] = [await getGuestToken(deps), await getQueryId(deps)];
    try {
      return await guestSearchOnce(deps, qid, query, token);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 自愈: 401/403 → 重铸 token;queryId 失效(http 4xx) → 重提取
      if (/http 40[134]/.test(msg)) {
        deps.cache.kvSet("x:guest_token", JSON.stringify({ at: 0, value: "" })); // 失效
        const freshToken = await getGuestToken(deps);
        if (/http 40[04]/.test(msg)) {
          const freshQid = await extractSearchQueryId(deps);
          return await guestSearchOnce(deps, freshQid, query, freshToken);
        }
        return await guestSearchOnce(deps, qid, query, freshToken);
      }
      throw e;
    }
  } catch (e) {
    // queryId 缓存可能是坏的: 清掉后整体重试一次
    const msg = e instanceof Error ? e.message : String(e);
    if (/http 40[034]/.test(msg) && kvJson(deps.cache, "x:queryId")) {
      deps.cache.kvSet("x:queryId", JSON.stringify({ at: 0, value: "" }));
      const token = await getGuestToken(deps);
      const qid = await extractSearchQueryId(deps);
      return guestSearchOnce(deps, qid, query, token);
    }
    throw e;
  }
}

// ---------- oEmbed 全文增强(dsh[10]: 对 top status URL 增强 snippet) ----------

async function oembedEnhance(deps: XChainDeps, ref: Reference): Promise<Reference> {
  const m = ref.url.match(/\/status(?:es)?\/(\d+)/);
  if (!m) return ref;
  try {
    const json = await jfetch<{ text?: string; created_at?: string }>(
      deps.fetchImpl ?? defaultImpl,
      `https://cdn.syndication.twimg.com/tweet-result?id=${m[1]}&lang=en&token=a`,
      { headers: { "User-Agent": deps.config.userAgent } },
      6000,
    );
    if (json.text && json.text.length > (ref.snippet.length ?? 0)) {
      return {
        ...ref,
        snippet: clampText(decodeEntities(json.text), 400),
        published: ref.published ?? json.created_at,
        engines: [...new Set([...ref.engines, "x-oembed"])],
      };
    }
  } catch { /* 增强失败保持原 snippet */ }
  return ref;
}

// ---------- 链编排 ----------

export async function xSearchChain(query: string, opts: SearchOptions, deps: XChainDeps): Promise<XChainResult> {
  const layers: Promise<{ name: string; refs: Reference[] }>[] = [];
  const failed: EngineFailure[] = [];

  if (deps.config.x?.bearerToken) {
    layers.push(officialLayer(deps, query, opts).then((refs) => ({ name: "x-official", refs })));
  }
  if (deps.config.x?.guestEnabled !== false && !deps.health.isOpen("x-guest")) {
    layers.push(guestLayer(deps, query).then((refs) => ({ name: "x-guest", refs })));
  }
  const siteQuery = `${query} (site:x.com OR site:twitter.com)`;
  const keylessNames = ["duckduckgo", "mojeek", "yahoo", ...(deps.config.searxng ? ["searxng"] : [])];
  layers.push(
    deps.runKeyless(siteQuery, { ...opts, engines: keylessNames }).then((r) => ({
      name: "x-keyless",
      refs: r.refs.map((ref) => ({ ...ref, engines: ref.engines.map((e) => `x-keyless:${e}`), kind: "x" as const })),
    })),
  );

  const settled = await Promise.allSettled(layers);
  const byUrl = new Map<string, Reference>();
  const used = new Set<string>();

  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === "fulfilled") {
      used.add(s.value.name);
      deps.health.record(s.value.name, true, 0);
      deps.journal?.write("x_layer_done", { layer: s.value.name, count: s.value.refs.length });
      for (const r of s.value.refs) {
        const key = normalizeUrl(r.url);
        const ex = byUrl.get(key);
        if (ex) {
          for (const e of r.engines) if (!ex.engines.includes(e)) ex.engines.push(e);
          if (r.snippet.length > ex.snippet.length) ex.snippet = r.snippet;
        } else {
          byUrl.set(key, { ...r, url: key });
        }
      }
    } else {
      // 层失败: 找回层名(按约定 layers 顺序),记 health 与 journal
      const name = deps.config.x?.bearerToken && i === 0 ? "x-official" : i === settled.length - 1 ? "x-keyless" : "x-guest";
      const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
      const cls = classifyFailure(msg);
      failed.push({ name, error: msg.slice(0, 200), elapsedMs: 0, status: cls.status, retryable: cls.retryable });
      deps.health.record(name, false, 0, msg, cls.status);
      deps.journal?.write("x_layer_error", { layer: name, error: msg.slice(0, 200) });
    }
  }

  let refs = [...byUrl.values()];
  // 排序: 引擎佐证多在前,官方/guest 全文层优先
  refs.sort((a, b) => b.engines.length - a.engines.length);
  // oEmbed 增强: 只对没有全文的 keyless 来源,取 top 2(dsh[10] 口径)
  const needEnhance = refs.filter((r) => r.engines.every((e) => e.startsWith("x-keyless"))).slice(0, 2);
  if (needEnhance.length > 0) {
    const enhanced = await Promise.all(needEnhance.map((r) => oembedEnhance(deps, r)));
    const emap = new Map(enhanced.map((r) => [r.url, r]));
    refs = refs.map((r) => emap.get(r.url) ?? r);
    if (enhanced.some((r) => r.engines.includes("x-oembed"))) used.add("x-oembed");
  }

  return { refs, used: [...used], failed };
}
