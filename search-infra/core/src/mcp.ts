/**
 * MCP Server (v0-spec §3.1/3.2) — v0.2 渐进披露
 * 证据: Codex[09] 工具四档披露(Direct/Deferred/CodeModeOnly/Hidden)+ tool_search BM25 动态加载
 *      (codex-rs toolspec;Deferred: 只登记元数据,找到后才动态加载 — 工具多时避免 schema 撑爆 context);
 *      CodeBuddy[07] ToolSearchService: MiniSearch 检索 top5 + name boost 2。
 *
 * 工具面:
 *   Direct(常驻):  search / fetch / tool_search
 *   Deferred(发现后激活): research / x_search / search_providers / cache_stats
 * 工具描述里写死委派约束(WorkBuddy[07] 思想): query 一句话意图、复杂研究走 research。
 * 运行: npx search-core serve  (stdio JSON-RPC)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { pathToFileURL } from "node:url";
import { SearchCore } from "./engine.js";
import { tokenize } from "./fusion.js";
import { VERSION } from "./version.js";

type ToolArgs = Record<string, unknown>;
type ToolHandler = (args: ToolArgs) => Promise<{ content: [{ type: "text"; text: string }] }>;
interface DeferredTool {
  name: string;
  description: string;
  schema: z.ZodRawShape;
  handler: ToolHandler;
  registered: boolean;
  activatedAt?: number;
}

export async function serveMcp(): Promise<void> {
  const core = new SearchCore();
  const server = new McpServer({ name: "search-core", version: VERSION });
  const deferred: DeferredTool[] = [];

  const registerDeferred = async (t: DeferredTool): Promise<void> => {
    if (t.registered) return;
    server.tool(t.name, t.description, t.schema, t.handler);
    t.registered = true;
    t.activatedAt = Date.now();
    try {
      // 通知客户端工具列表已变化(Codex[09] 动态加载语义)
      await (server.server as unknown as { sendToolListChanged?: () => Promise<void> }).sendToolListChanged?.();
    } catch { /* 客户端不支持 notification 也无碍 */ }
  };

  // ---------- Direct: search ----------
  server.tool(
    "search",
    `Multi-engine web search with client-side orchestration (parallel engines + RRF fusion + semantic dedup).
Delegate a ONE-SENTENCE intent as query. Do NOT pack checklists into one query — split into multiple calls.
For deep research tasks, activate the "research" tool first via tool_search (it runs a multi-angle loop with budgets, reflection and resumable journal).
Returns ranked references (refId, url, title, snippet) — use fetch(url, focus=...) to read a page cheaply.`,
    {
      query: z.string().min(1).describe("One-sentence search intent"),
      freshness: z.enum(["day", "week", "month", "year", "any"]).optional(),
      max_results: z.number().int().min(1).max(20).optional().describe("Per-engine result cap (default 10)"),
      top_n: z.number().int().min(1).max(50).optional().describe("Fused result cap (default 20)"),
      engines: z.array(z.string()).optional().describe("Explicit engines, e.g. [\"duckduckgo\",\"brave\"]"),
      lang: z.string().optional(),
      no_cache: z.boolean().optional(),
    },
    async (args) => {
      const r = await core.search(args.query, {
        freshness: args.freshness,
        lang: args.lang,
        maxResults: args.max_results,
        topN: args.top_n,
        engines: args.engines,
        noCache: args.no_cache,
      });
      const payload = {
        refs: r.refs.map((ref) => ({
          refId: ref.refId, title: ref.title, url: ref.url,
          snippet: ref.snippet, engines: ref.engines, published: ref.published,
        })),
        meta: {
          engines_used: r.meta.enginesUsed,
          engines_failed: r.meta.enginesFailed,
          engines_skipped: r.meta.enginesSkipped ?? [],
          degraded: r.meta.degraded ?? false,
          elapsed_ms: r.meta.elapsedMs,
          from_cache: r.meta.fromCache,
          complexity: r.planner.complexity,
          route: r.planner.route,
          domain: r.planner.domainPlan?.topic, // v0.7: 域名专线命中时告知消费方走的哪个主题(packages/academic/...)
        },
      };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 1) }] };
    },
  );

  // ---------- Direct: fetch ----------
  server.tool(
    "fetch",
    `Fetch a page and return ONLY the segments matching focus (+adjacent context) — typically saves ~90% tokens vs raw page.
Raw text is cached; re-fetch with a different focus reuses the cache. If focus misses, returns head-truncated text with a marker.
Do NOT fetch a full page when a focused read suffices.`,
    {
      url: z.string().url(),
      focus: z.string().optional().describe("What to look for in the page (hit+adjacent segments are returned)"),
      max_chars: z.number().int().min(500).max(30000).optional().describe("Output budget, default 8000"),
      adjacent: z.number().int().min(0).max(3).optional().describe("Adjacent segments around hits, default 1"),
      no_cache: z.boolean().optional(),
    },
    async (args) => {
      const r = await core.fetch(args.url, {
        focus: args.focus,
        maxChars: args.max_chars,
        adjacent: args.adjacent,
        noCache: args.no_cache,
      });
      const payload = {
        url: r.url, title: r.title, from_cache: r.fromCache,
        text_length: r.textLength, returned_chars: r.returnedChars,
        saved_pct: r.savedPct !== undefined ? Math.round(r.savedPct * 100) / 100 : undefined,
        segments: r.segments ?? undefined,
        text: r.text,
        note: r.segments === null ? "focus miss; head-truncated fallback" : undefined,
      };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 1) }] };
    },
  );

  // ---------- Deferred 工具注册表(元数据常驻,schema 发现后才进 context) ----------

  deferred.push({
    name: "research",
    registered: false,
    description: `Deep research loop: decomposes the query into 5 parallel angles, searches each loop with reference/fetch dual budgets, extracts quoted facts from focused fetches, scores 6 reflection questions (facts/coverage/authority/freshness/multi-source/usability), stops on strict-or-relaxed pass / max-loops (degraded, not blocked) / budget / convergence. Citations [n] are exit-validated 100% resolvable. Resumable via run_id journal replay. Slow (30-120s) — use ONLY when one-shot search is not enough.`,
    schema: {
      query: z.string().min(1).describe("Research question (one sentence)"),
      preset: z.enum(["summary", "report", "deep"]).optional().describe("Budget preset: summary(1 loop/4 fetch) < report(default) < deep(5 loops/24 fetch); explicit fields override it"),
      max_loops: z.number().int().min(1).max(8).optional().describe("Hard loop cap, default 3 (MAX_LOOPS_DEGRADED on hit)"),
      strict: z.boolean().optional().describe("Require all 6 reflection gates (incl. authority/tier-1 + freshness) before exit"),
      min_facts: z.number().int().min(3).max(50).optional().describe("Q1 threshold, default 6"),
      fetch_budget: z.number().int().min(2).max(60).optional().describe("Total full-text fetch slots, default 12"),
      reference_budget: z.number().int().min(10).max(500).optional().describe("Metadata ref pool cap, default 120"),
    },
    handler: async (args) => {
      const r = await core.deepResearch(String(args.query), {
        preset: args.preset as "summary" | "report" | "deep" | undefined,
        maxLoops: args.max_loops as number | undefined,
        strict: args.strict as boolean | undefined,
        minFacts: args.min_facts as number | undefined,
        fetchBudget: args.fetch_budget as number | undefined,
        referenceBudget: args.reference_budget as number | undefined,
      });
      const payload = {
        run_id: r.runId,
        stop: r.stop,
        angles: r.angles,
        outline: r.outline,
        loops: r.loops.map((l) => ({ loop: l.loop, new_urls: l.newUrls, fetched: l.fetched, decision: l.decision, reflect: l.reflect })),
        facts: r.facts.map((f) => ({ refId: f.refId, angle: f.angle, quote: f.quote, url: f.url, tier: f.tier })),
        stats: r.stats,
        report: r.report,
        resume_hint: `call research with {"run_id": "${r.runId}"} on /research/resume (HTTP) or re-run research tool with more budget to extend`,
      };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 1) }] };
    },
  });

  deferred.push({
    name: "x_search",
    registered: false,
    description: `Search X/Twitter posts via degraded chain: official API (if key) parallel Guest GraphQL (anonymous, queryId self-healing rotation) parallel keyless site:x.com engines, then oEmbed full-text enhancement of top statuses. Each layer fails independently without blocking others.`,
    schema: {
      query: z.string().min(1),
      kind: z.enum(["tweets", "users"]).optional(),
      top_n: z.number().int().min(1).max(30).optional(),
    },
    handler: async (args) => {
      const r = await core.xSearch(String(args.query), (args.kind as string) ?? "tweets", { topN: args.top_n as number | undefined });
      const payload = {
        refs: r.refs.map((ref) => ({
          refId: ref.refId, title: ref.title, url: ref.url,
          snippet: ref.snippet, engines: ref.engines, published: ref.published,
        })),
        meta: {
          engines_used: r.meta.enginesUsed, engines_failed: r.meta.enginesFailed,
          engines_skipped: r.meta.enginesSkipped ?? [], degraded: r.meta.degraded ?? false,
          elapsed_ms: r.meta.elapsedMs,
        },
      };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 1) }] };
    },
  });

  deferred.push({
    name: "search_cache",
    registered: false,
    description: `Full-text search over pages ALREADY FETCHED on this machine (cache-as-search-corpus, v0.5). Instant, offline, zero cost — trigram index (CJK needs >=3 chars; shorter falls back to substring). Use it to re-find something you fetched earlier, or as last resort when network engines are all failing. Hits return url/title/snippet; pair with fetch(url, focus=...) to re-read.`,
    schema: {
      query: z.string().min(1).describe("Text to search inside cached page corpus"),
      limit: z.number().int().min(1).max(50).optional().describe("Max hits, default 10"),
    },
    handler: async (args) => {
      const hits = core.searchCache(String(args.query), (args.limit as number | undefined) ?? 10);
      const payload = {
        hits,
        hint: hits.length === 0
          ? "no cached page matches; use search (network engines) instead"
          : "from local corpus; pair with fetch(url, focus=...) to re-read a hit",
      };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 1) }] };
    },
  });

  deferred.push({
    name: "search_providers",
    registered: false,
    description: "List search engines with health stats (ok/fail, avg latency, circuit state). Use it to diagnose quality degradation.",
    schema: {},
    handler: async () => {
      const payload = { providers: core.providers() };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 1) }] };
    },
  });

  deferred.push({
    name: "cache_stats",
    registered: false,
    description: "Cache/counters snapshot; optionally clear the search-result cache (page cache is kept).",
    schema: { clear_search_cache: z.boolean().optional() },
    handler: async (args) => {
      if (args.clear_search_cache) core.clearSearchCache();
      return { content: [{ type: "text", text: JSON.stringify(core.stats(), null, 1) }] };
    },
  });

  // ---------- Direct: tool_search(渐进披露入口) ----------
  server.tool(
    "tool_search",
    `Discover and activate deferred tools (progressive disclosure — keeps the base tool list small so schemas don't bloat your context).
Scores deferred tools by lexical match on name+description (name hits weight 2x). Matched tools are ACTIVATED and become callable immediately.`,
    {
      query: z.string().min(1).describe("What capability do you need, e.g. \"deep research loop\", \"twitter\", \"engine health\""),
      limit: z.number().int().min(1).max(8).optional().describe("Max tools to activate, default 4"),
    },
    async (args) => {
      const qTokens = new Set(tokenize(String(args.query)));
      const limit = args.limit ?? 4;
      const scored = deferred
        .map((t) => {
          const nameTokens = new Set(tokenize(t.name));
          let score = 0;
          for (const tok of qTokens) {
            if (nameTokens.has(tok)) score += 2; // name boost 2 (CodeBuddy[07] ToolSearchService 口径)
            if (tokenize(t.description).includes(tok)) score += 1;
          }
          return { t, score };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      const activated: string[] = [];
      for (const s of scored) {
        if (!s.t.registered) {
          await registerDeferred(s.t);
          activated.push(s.t.name);
        }
      }
      const payload = {
        matches: scored.map((s) => ({
          name: s.t.name, score: s.score,
          already_active: s.t.registered && !activated.includes(s.t.name),
          description: s.t.description,
        })),
        newly_activated: activated,
        hint: activated.length > 0
          ? `Tools [${activated.join(", ")}] are now callable (tool list updated).`
          : "No new tools matched; matched tools above are already active.",
      };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 1) }] };
    },
  );

  await server.connect(new StdioServerTransport());
  // stdio 模式下进程保持常驻;stdin 关闭时 SDK 会自行结束
}

/** 直接执行 `node dist/mcp.js` 时自启动(package.json 的 bin 指向 cli,这里给 MCP 场景) */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  serveMcp().catch((e) => {
    console.error("search-core mcp:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
