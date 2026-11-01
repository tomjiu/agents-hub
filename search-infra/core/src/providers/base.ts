/**
 * Provider 抽象 (v0-spec §4.2) + 健康跟踪
 * - 统一接口 search(q, opts) -> Reference[],各引擎自己适配
 * - 健康滚动统计持久化在 cache kv,连续失败自动降权(修 Perplexica[12] 单点裸奔)
 */
import type { Reference, SearchOptions, ProviderHealth, EngineStatus } from "../types.js";
import type { Cache } from "../cache.js";

export interface FetchImpl {
  (url: string, init?: RequestInit): Promise<Response>;
}

export interface SearchCtx {
  fetchImpl: FetchImpl;
  signal: AbortSignal;
  ua: string;
  opts: SearchOptions;
}

export interface Provider {
  name: string;
  needsKey: boolean;
  /** v0.4: key 引擎插槽(auto 模式下已配 key 且额度未尽时自动并入默认池,用完自动回落) */
  keySlot?: boolean;
  /** 可变配置槽位(buildProviders 注入) */
  config?: { baseUrl?: string; engines?: string; instances?: string[]; apiKey?: string; email?: string; title?: string };
  /** 配置齐全才参与并行 */
  isConfigured(): boolean;
  search(query: string, ctx: SearchCtx): Promise<Reference[]>;
}

// ---------- 失败分类器 (v0.4 失败标注契约, wigolo[09] 学走, 字段名自起) ----------

/**
 * 把引擎的错误字符串分成 6 类,驱动差异化熔断+调用方重试决策:
 * 429/202 软封 → rate_limited(自愈快); 402/432/433 → quota(本月没戏);
 * 401 → auth(得修 key); 403/挑战页 → blocked(别硬碰);
 * 超时 → timeout; 其余 → error(默认可重试)。
 */
export function classifyFailure(msg: string): { status: EngineStatus; retryable: boolean } {
  const s = msg.toLowerCase();
  if (/\b429\b|rate.?limit|too many|slow down|please reduce|\bhttp 202\b|soft.?block/.test(s)) {
    return { status: "rate_limited", retryable: true };
  }
  if (/\b402\b|\b432\b|\b433\b|quota|payment required|out of credit/.test(s)) {
    return { status: "quota", retryable: false };
  }
  if (/\b401\b|unauthorized|invalid api key|authentication|bad api key/.test(s)) {
    return { status: "auth", retryable: false };
  }
  if (/\b403\b|\b40x\b|forbidden|captcha|unusual|challenge|anubis|access denied|blocked|cloudflare/.test(s)) {
    return { status: "blocked", retryable: false };
  }
  if (/timeout|abort|etimedout|deadline|econnaborted/.test(s)) {
    return { status: "timeout", retryable: true };
  }
  return { status: "error", retryable: true };
}

// ---------- 健康跟踪 (v0.4 熔断 2.0) ----------

/** 分类熔断策略: 连败阈值 + 冷却时长(按失败类别差异化, wigolo 思路) */
const BREAKER_POLICY: Record<string, { threshold: number; cooldownMs: number }> = {
  rate_limited: { threshold: 4, cooldownMs: 2 * 60 * 1000 },   // 软封自愈快,短冷却
  blocked:      { threshold: 2, cooldownMs: 15 * 60 * 1000 },  // 挑战页不会自己好,长冷却
  quota:        { threshold: 1, cooldownMs: 30 * 60 * 1000 },  // 额度烧完再试也没用(月度由 QuotaTracker 管)
  auth:         { threshold: 1, cooldownMs: 60 * 60 * 1000 },  // key 坏了得人工修
  timeout:      { threshold: 6, cooldownMs: 5 * 60 * 1000 },
  error:        { threshold: 6, cooldownMs: 10 * 60 * 1000 },  // v0.1 默认档
};
const COOLDOWN_CAP_MS = 60 * 60 * 1000;

interface HealthState {
  ok: number; fail: number; avgMs: number;
  failStreak: number; openUntil: number;
  streakClass: string; streakCount: number;
  cooldownMs: number; // 当前冷却基数(半开探针失败后翻倍,上限 1h)
  lastStatus?: string;
  lastError?: string; lastOkAt: number;
}

export class HealthTracker {
  #cache: Cache | null;

  constructor(cache: Cache | null) {
    this.#cache = cache;
  }

  /** 供 xchain 等需要 kv 持久化的模块复用同一 cache(只读用途自己保证) */
  get backingCache(): Cache | null {
    return this.#cache;
  }

  record(name: string, ok: boolean, latencyMs: number, error?: string, status?: EngineStatus): void {
    if (!this.#cache) return;
    const k = `health:${name}`;
    const raw = this.#cache.kvGet(k);
    let st: HealthState = {
      ok: 0, fail: 0, avgMs: 0,
      failStreak: 0, openUntil: 0,
      streakClass: "", streakCount: 0, cooldownMs: 0,
      lastError: undefined, lastOkAt: 0,
    };
    if (raw) {
      try { st = { ...st, ...JSON.parse(raw) }; } catch { /* reset */ }
    }
    const total = st.ok + st.fail;
    st.avgMs = Math.round((st.avgMs * total + latencyMs) / (total + 1));
    if (ok) {
      st.ok++;
      st.failStreak = 0;
      st.openUntil = 0;
      st.streakClass = "";
      st.streakCount = 0;
      st.cooldownMs = 0;
      st.lastOkAt = Date.now();
      st.lastError = undefined;
    } else {
      const cls = status ?? classifyFailure(error ?? "").status;
      st.fail++;
      st.failStreak = (st.failStreak ?? 0) + 1;
      st.lastStatus = cls;
      // 同类连败才累加(换成另一类重新计数)
      if (st.streakClass === cls) st.streakCount++;
      else { st.streakClass = cls; st.streakCount = 1; }
      const policy = BREAKER_POLICY[cls] ?? BREAKER_POLICY.error;
      if (st.streakCount >= policy.threshold) {
        // 半开探针失败(上次冷却已过期又栽) → 冷却翻倍,指数退避到上限
        const wasExpiredOpen = st.openUntil > 0 && st.openUntil <= Date.now();
        st.cooldownMs = Math.min(
          wasExpiredOpen ? Math.max(policy.cooldownMs, (st.cooldownMs || policy.cooldownMs) * 2) : policy.cooldownMs,
          COOLDOWN_CAP_MS,
        );
        st.openUntil = Date.now() + st.cooldownMs;
      }
      st.lastError = error?.slice(0, 200);
    }
    // 滚动窗口: 记录过多时衰减一半,防止早期失败永久拉黑
    if (st.ok + st.fail > 50) {
      st.ok = Math.floor(st.ok / 2);
      st.fail = Math.floor(st.fail / 2);
    }
    this.#cache.kvSet(k, JSON.stringify(st));
  }

  /** 熔断判定: 冷却期内拒绝;冷却到期 = 半开探针(放进一个请求试水) */
  isOpen(name: string): boolean {
    if (!this.#cache) return false;
    const raw = this.#cache.kvGet(`health:${name}`);
    if (!raw) return false;
    try {
      const st = JSON.parse(raw);
      return (st.openUntil ?? 0) > Date.now();
    } catch {
      return false;
    }
  }

  snapshot(name: string, configured: boolean, needsKey: boolean): ProviderHealth {
    const empty: ProviderHealth = {
      name, configured, needsKey, ok: 0, fail: 0, avgLatencyMs: 0,
    };
    if (!this.#cache) return empty;
    const raw = this.#cache.kvGet(`health:${name}`);
    if (!raw) return empty;
    try {
      const st = JSON.parse(raw);
      return {
        name, configured, needsKey,
        ok: st.ok, fail: st.fail,
        avgLatencyMs: st.avgMs,
        lastError: st.lastError,
        lastOkAt: st.lastOkAt || undefined,
        lastStatus: st.lastStatus as ProviderHealth["lastStatus"],
        circuitOpen: (st.openUntil ?? 0) > Date.now() ? true : undefined,
      };
    } catch {
      return empty;
    }
  }
}

// ---------- 通用工具 ----------

export function clampText(s: string | undefined | null, max = 400): string {
  if (!s) return "";
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

export function absoluteUrl(base: string, href: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return "";
  }
}
