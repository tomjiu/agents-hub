/**
 * QuotaTracker (v0.4 key 引擎插槽的额度计数器, targets-search.md P1)
 * - 月度循环额度(默认 Tavily 1000 credit/月): 本地计数,用完自动跳过该引擎
 * - 432(套餐超限)/433(PAYG 超限) 一票标记: 当月直接判死,不用再烧请求去试
 * - 持久化在 cache kv, 重启不丢; 月份自动滚动(YYYY-MM key)
 * 配合 Router: allow() 不过 → 引擎不进并行池 → 免 key 池天然接管(回落零代码)。
 */
import type { Cache } from "./cache.js";

export interface QuotaState {
  used: number;
  limit: number;
  /** 当月剩余; exhausted=true 时恒为 0 */
  remaining: number;
  exhausted: boolean;
  /** 额度窗口结束时刻(月末, ISO) */
  resetsAt: string;
}

function monthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function endOfMonthISO(d = new Date()): string {
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return end.toISOString();
}

interface QuotaRecord {
  month: string;
  used: number;
  /** 432/433 一票标记: 当月不再尝试 */
  dead: boolean;
}

export class QuotaTracker {
  #cache: Cache | null;
  #limits: Map<string, number>;

  /**
   * @param limits 引擎名 → 月度额度(未登记的引擎不做额度管控)
   */
  constructor(cache: Cache | null, limits: Record<string, number>) {
    this.#cache = cache;
    this.#limits = new Map(Object.entries(limits).filter(([, v]) => v > 0));
  }

  /** 该引擎是否受额度管控 */
  governed(name: string): boolean {
    return this.#limits.has(name);
  }

  limitOf(name: string): number {
    return this.#limits.get(name) ?? 0;
  }

  #load(name: string): QuotaRecord {
    const raw = this.#cache?.kvGet(`quota:${name}`);
    const rec: QuotaRecord = raw ? JSON.parse(raw) : { month: monthKey(), used: 0, dead: false };
    if (rec.month !== monthKey()) {
      // 月份滚动: 额度重置(免费额度每月刷新)
      rec.month = monthKey();
      rec.used = 0;
      rec.dead = false;
    }
    return rec;
  }

  #save(name: string, rec: QuotaRecord): void {
    this.#cache?.kvSet(`quota:${name}`, JSON.stringify(rec));
  }

  /** 能否发起一次请求(额度未用尽且未被一票标记) */
  allow(name: string): boolean {
    const limit = this.#limits.get(name);
    if (!limit) return true; // 不受管控
    const rec = this.#load(name);
    return !rec.dead && rec.used < limit;
  }

  /** 成功消耗一次(1 query = 1 credit 口径) */
  record(name: string): void {
    const limit = this.#limits.get(name);
    if (!limit) return;
    const rec = this.#load(name);
    rec.used++;
    if (rec.used >= limit) rec.dead = true; // 计数到顶,当月判死
    this.#save(name, rec);
  }

  /** 432/433 一票标记: 官方明确说额度烧完,本月别再试 */
  exhaust(name: string): void {
    const limit = this.#limits.get(name);
    if (!limit) return;
    const rec = this.#load(name);
    rec.used = Math.max(rec.used, limit);
    rec.dead = true;
    this.#save(name, rec);
  }

  /** 状态快照(providers()/诊断出口用) */
  snapshot(name: string): QuotaState | undefined {
    const limit = this.#limits.get(name);
    if (!limit) return undefined;
    const rec = this.#load(name);
    return {
      used: rec.used,
      limit,
      remaining: rec.dead ? 0 : Math.max(0, limit - rec.used),
      exhausted: rec.dead,
      resetsAt: endOfMonthISO(),
    };
  }
}
