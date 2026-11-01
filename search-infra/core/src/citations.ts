/**
 * 引用出口校验 (v0.2) — v0-spec §3.3 "引用三段式生成 + 出口校验"的落地
 * 验收标准 (v0-spec §6): 引用出口校验 100% — 输出文本中的 [n] 必须全部可回溯到引用注册表。
 * 场景: Research Loop 终稿、任何把 [refId] 写进正文的合成输出。
 *
 * 规则来源: WorkBuddy[07] deep-research "无 source 的事实剔除" +
 *          Perplexica[12] 引用 prompt 约定 [n] → 前端正则零解析器实现。
 */

import type { Reference } from "./types.js";

/** refId → 引用元数据;输出前建好,输出后校验 */
export type CitationRegistry = Map<number, { url: string; title: string }>;

export function buildCitationRegistry(refs: Reference[]): CitationRegistry {
  const m: CitationRegistry = new Map();
  for (const r of refs) {
    if (r.refId !== undefined && !m.has(r.refId)) {
      m.set(r.refId, { url: r.url, title: r.title });
    }
  }
  return m;
}

export interface CitationAudit {
  /** 文本中出现的引用编号(去重升序) */
  cited: number[];
  /** 出现了但注册表里没有的编号 — 这就是"幻觉引用" */
  unknown: number[];
  /** 注册表里从未被引用的编号(仅提示,不算失败) */
  unused: number[];
  ok: boolean;
}

const CITE_RE = /\[(\d{1,3})\]/g;

/** 扫描文本中的 [n] 引用并对注册表核验 */
export function auditCitations(text: string, registry: CitationRegistry): CitationAudit {
  const cited = new Set<number>();
  for (const m of text.matchAll(CITE_RE)) {
    cited.add(Number(m[1]));
  }
  const citedArr = [...cited].sort((a, b) => a - b);
  const unknown = citedArr.filter((n) => !registry.has(n));
  const unused = [...registry.keys()].filter((n) => !cited.has(n)).sort((a, b) => a - b);
  return { cited: citedArr, unknown, unused, ok: unknown.length === 0 };
}

export interface EnforceOptions {
  /** strict(默认): 有幻觉引用直接抛错 — 验收口径;strip: 剔除幻觉引用后放行并标注 */
  mode?: "strict" | "strip";
}

/**
 * 出口校验。strict 模式校验失败抛 Error(调用方必须修);
 * strip 模式把 [n](未注册) 替换为空并在返回值里报告 — 给"宁可少引用不可假引用"的降级路径。
 */
export function enforceCitations(
  text: string,
  registry: CitationRegistry,
  opts: EnforceOptions = {},
): { text: string; audit: CitationAudit } {
  const audit = auditCitations(text, registry);
  if (audit.ok) return { text, audit };
  if ((opts.mode ?? "strict") === "strict") {
    throw new Error(
      `citation exit validation failed: [${audit.unknown.join(",")}] not in registry ` +
      `(cited=${audit.cited.length}, registry=${registry.size})`,
    );
  }
  const stripped = text.replace(/\[(\d{1,3})\]/g, (full, d: string) => {
    return registry.has(Number(d)) ? full : "";
  });
  return { text: stripped, audit: { ...audit, ok: true } };
}

/** 引用列表渲染(markdown 尾注格式,Perplexica[12] 零解析器约定的服务端版) */
export function renderCitations(registry: CitationRegistry): string {
  const lines: string[] = [];
  for (const [id, r] of [...registry.entries()].sort((a, b) => a[0] - b[0])) {
    lines.push(`[${id}] ${r.title} — ${r.url}`);
  }
  return lines.join("\n");
}
