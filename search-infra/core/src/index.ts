/**
 * search-core — 客户端搜索编排器 v0.2
 * 设计文档: design/v0-spec.md;逆向依据: reports/01-13
 * v0.2 新增: Research Loop(5角度并行+双预算池+6问反思+三保险+断点恢复) /
 *            embedding 双阈值融合 / X 四层降级链 / 引用出口校验 / REST+SSE / tool_search 渐进披露
 */
export * from "./types.js";
export { loadConfig, type CoreConfig } from "./config.js";
export { Budget, BudgetExceededError, checkDomain, validateUrl, safeFetchUrl } from "./governor.js";
export { Cache } from "./cache.js";
export { Journal } from "./journal.js";
export { SearchCore, type CoreDeps } from "./engine.js";
export { Router, buildProviders } from "./router.js";
export { Fetcher } from "./fetcher.js";
export { plan, splitComparison } from "./planner.js";
export { DOMAIN_TABLE, lookupDomains, type DomainTopic, type DomainRoute } from "./domains.js";
export { AUTHORITY_DOMAINS, matchAuthority } from "./authority.js";
export {
  SPAM_BLOCKED_DOMAINS, SPAM_DOWNWEIGHT_DOMAINS, SPAM_DOWNWEIGHT_PENALTY,
  matchSpamBlocked, matchSpamDownweight,
} from "./credibility.js";
export { fuse, fuseSemantic, normalizeUrl, lexicalScore, tokenize } from "./fusion.js";
export { extractHtml, splitSegments, extractFocus } from "./focus.js";
export { HealthTracker, type Provider } from "./providers/base.js";
export {
  TfEmbedder, OpenAIEmbedder, FallbackEmbedder, TF_EMBEDDER,
  cosine, tfVector, embedTokens, type Embedder,
} from "./embed.js";
export {
  buildCitationRegistry, auditCitations, enforceCitations, renderCitations,
  type CitationRegistry, type CitationAudit,
} from "./citations.js";
export {
  ResearchLoop, ResearchState, reflect, decide, DEFAULT_ANGLES,
  type ResearchOptions, type ResearchResult, type ResearchEvent,
  type ResearchStats, type ResearchStopReason, type Fact, type LoopRecord, type ReflectScores,
  type SynthesisInput,
} from "./research.js";
export { xSearchChain, extractSearchQueryId, type XChainDeps, type XChainResult } from "./xchain.js";
