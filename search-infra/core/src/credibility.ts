/**
 * 置信度筛选 v0.8 — 用户提案落地("做置信度筛选, 屏蔽 csdn 这种垃圾网站等
 * 百度百家号搜狐新闻等这些垃圾灌水网站")。
 *
 * 与 authority.ts 互为镜像: authority=白名单提权, 本表=黑名单处置。
 * 与 config.blockedDomains(fetch 层 SSRF 策略)互补: 那边管"不去抓", 这边管"不混进结果"。
 *
 * 两档处置(诚实设计):
 * - BLOCKED(硬屏蔽): 内容农场/文库爬虫站/点名灌水站 — 从融合结果剔除, meta.spamBlocked 计数。
 *   判断标准: 对 agent 无提取价值(文档下载墙)或大面积搬运/洗稿(点名站)。
 * - DOWNWEIGHT(强降权): 内容薄但不算纯垃圾的 SEO 农场 — -1.2 分(压过 authority 0.75
 *   与一个词的词法差 0.5 之和), 结果保留但标注 ref.spam, 消费方可自行过滤。
 * - 名单在 git 里 = 可审查可增删; 只匹配注册域名, 不做关键词猜测(防误伤)。
 */

// ---------- AG-3: 表数据外置(data/authority/credibility.json 为单一真源, 政策注释在 _meta) ----------
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function loadCredibilityFile(): { blocked: string[]; downweight: string[] } {
  try {
    return JSON.parse(readFileSync(fileURLToPath(new URL("../data/authority/credibility.json", import.meta.url)), "utf8")) as { blocked: string[]; downweight: string[] };
  } catch (e) {
    console.warn(`[credibility] credibility.json 加载失败(${e instanceof Error ? e.message : String(e)}), 两档表空兜底 — 包损坏请重装/恢复 JSON`);
    return { blocked: [], downweight: [] };
  }
}

const _cred = loadCredibilityFile();

/** 硬屏蔽名单(用户点名灌水站/文库爬虫站/百度系; 增删改 data/authority/credibility.json) */
export const SPAM_BLOCKED_DOMAINS: string[] = _cred.blocked;

/** 强降权(-1.2)名单(SEO 农场, 保留但标注; 增删改 data/authority/credibility.json) */
export const SPAM_DOWNWEIGHT_DOMAINS: string[] = _cred.downweight;

export const SPAM_DOWNWEIGHT_PENALTY = -1.2;

/** 段精确匹配(与 authority.ts 同规则): 子域命中, 伪装域不命中 */
function matchDomain(url: string, table: string[]): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const d of table) {
    if (host === d || host.endsWith("." + d)) return d;
  }
  return null;
}

/** 硬屏蔽命中 → 返回命中域名(应从结果剔除) */
export function matchSpamBlocked(url: string): string | null {
  return matchDomain(url, SPAM_BLOCKED_DOMAINS);
}

/** 降权命中 → 返回命中域名(应打 -1.2 并标注 ref.spam) */
export function matchSpamDownweight(url: string): string | null {
  return matchDomain(url, SPAM_DOWNWEIGHT_DOMAINS);
}
