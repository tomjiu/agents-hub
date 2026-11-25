import type { Reference } from './types.js';
import {embedTokens} from './embed.js';

// A conservative lexical evidence floor, not semantic relevance or fact verification.
const GENERIC = new Set(['the','a','an','of','in','on','for','to','and','or','is','are','was','were','what','how','why','when','which','who','with','at','by','from','about','official','documentation','docs','guide','tutorial','overview','latest','best','的','了','是','在','和','与','怎么','如何','什么','官方','文档','教程']);
// lexical-evidence-v2 (与 Go relevance.go 对齐): 轻量复数折叠(len>3 且非 ss/us/is 结尾才剥尾 s),
// recipes→recipe / comprehensions→comprehension / lists→list。无词干化野心, 只为消除单复数漏配;
// 泛词过滤在折叠前做(docs 仍被滤)。CJK 整词/bigram 不以 ASCII 's' 结尾, 天然不受影响。
function foldPlural(token: string): string {
  if (token.length>3&&token.endsWith('s')&&!token.endsWith('ss')&&!token.endsWith('us')&&!token.endsWith('is')) return token.slice(0,-1);
  return token;
}
function terms(text: string): string[] {
  return [...new Set(embedTokens(text.normalize('NFKC')).filter(t=>t.length>1&&!GENERIC.has(t)).map(foldPlural))];
}
export function relevanceEvidence(query: string, ref: Reference): { accepted: boolean; matched: string[]; required: number; terms: number } {
  // Operators and hostnames are retrieval constraints, not evidence of page relevance.
  const queryText=query.replace(/(?:site|filetype|intitle|inurl):[^\s]+/gi,'').replace(/https?:\/\/[^\s]+/gi,'');
  const wanted=terms(queryText);
  let path='';try{path=decodeURIComponent(new URL(ref.url).pathname);}catch{/* malformed path provides no evidence */}
  const snippet=(ref.snippet??'').replace(/^\[[^\]]+\]\s*/,'');
  const hay=new Set(terms((ref.title??'')+' '+snippet+' '+path));
  const matched=wanted.filter(t=>hay.has(t));
  // lexical-evidence-v2: 40%→50% 证据下限(S0-F2 实测: "python list comprehension recipes cooking"
  // 5 词查询下 40%(2词)放行纯烹饪页; 50%(3词)拒绝之, python 页仍入池)。与 Go 侧 ceil(n/2)、下限 2 一致。
  const required=wanted.length===0?0:wanted.length===1?1:Math.max(2,Math.ceil(wanted.length*.5));
  return {accepted:required>0&&matched.length>=required,matched,required,terms:wanted.length};
}
// ---------- S3 (issue #3) 版本适用性标注 (Go versionSignals 对等; 只标注不剔除) ----------
const versionTokenRe = /\bv?(\d+(?:\.\d+)+(?:-[0-9A-Za-z.]+)?|\d+)\b/g;
function majorOf(version: string): string {
  return version.split(".")[0];
}
/** 首个版本 token; 单数字(如 "top 10")不算 — 至少两位或多段 (Go firstVersionToken 对等) */
export function firstVersionToken(text: string): string {
  for (const m of text.matchAll(versionTokenRe)) {
    if (m[1].length >= 2 || m[1].includes(".")) return m[1];
  }
  return "";
}
export interface VersionFlag { refId: number; queryVersion: string; refVersion: string; reason: string; }
export interface VersionCheck { queryVersion?: string; flagged?: VersionFlag[]; }
/** 查询版本 vs ref 版本主段不一致 → 标注(旧版本/实验分支不当默认答案的透明线索); 查询无版本 → undefined */
export function versionSignals(query: string, refs: { refId?: number; title?: string; url: string }[]): VersionCheck | undefined {
  const qv = firstVersionToken(query.replace(/(?:site|filetype|intitle|inurl):[^\s]+/gi, ""));
  if (!qv) return undefined;
  const vc: VersionCheck = { queryVersion: qv };
  for (const r of refs) {
    const rv = firstVersionToken(`${r.title ?? ""} ${r.url}`);
    if (!rv) continue;
    if (majorOf(rv) !== majorOf(qv)) {
      (vc.flagged ??= []).push({ refId: r.refId ?? 0, queryVersion: qv, refVersion: rv, reason: "different_major_version" });
    }
  }
  return vc;
}

/** S3 (issue #3) 来源构成 (Go sourceMix 对等): sourceKind 计数(official/community/...), 空→unknown */
export function sourceMix(refs: { sourceKind?: string }[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of refs) {
    const k = (r.sourceKind ?? "").trim().toLowerCase() || "unknown";
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
}

export function filterEvidence(query: string, refs: Reference[]): { refs: Reference[]; rejected: number; evaluated: number; reasons: Record<string, number> } {
  const accepted: Reference[]=[],reasons:Record<string,number>={};
  for(const ref of refs){const evidence=relevanceEvidence(query,ref);if(evidence.accepted)accepted.push(ref);else{const reason=evidence.terms===0?'no_query_terms':'insufficient_query_evidence';reasons[reason]=(reasons[reason]??0)+1;}}
  return {refs:accepted,rejected:refs.length-accepted.length,evaluated:refs.length,reasons};
}
