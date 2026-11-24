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
export function filterEvidence(query: string, refs: Reference[]): { refs: Reference[]; rejected: number; evaluated: number; reasons: Record<string, number> } {
  const accepted: Reference[]=[],reasons:Record<string,number>={};
  for(const ref of refs){const evidence=relevanceEvidence(query,ref);if(evidence.accepted)accepted.push(ref);else{const reason=evidence.terms===0?'no_query_terms':'insufficient_query_evidence';reasons[reason]=(reasons[reason]??0)+1;}}
  return {refs:accepted,rejected:refs.length-accepted.length,evaluated:refs.length,reasons};
}
