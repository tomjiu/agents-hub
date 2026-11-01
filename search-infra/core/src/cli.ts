/**
 * CLI: search-core <command>
 *   search "query" [--engines a,b] [--freshness month] [--json]
 *   fetch URL [--focus "..."] [--max-chars 8000] [--json]
 *   x "query" [--json]
 *   research "query" [--loops 3] [--strict] [--resume runId] [--json]
 *   serve-http [--port 8787]
 *   providers / stats [--clear] / serve(MCP stdio)
 */
import { SearchCore } from "./engine.js";
import { VERSION } from "./version.js";

function parseFlags(argv: string[]): { _: string[]; flags: Record<string, string | boolean> } {
  const _: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      _.push(a);
    }
  }
  return { _, flags };
}

function fmtPct(n?: number): string {
  return n === undefined ? "-" : `${Math.round(n * 100)}%`;
}

async function main(): Promise<number> {
  const { _, flags } = parseFlags(process.argv.slice(2));
  const cmd = _[0] ?? "help";
  const json = !!flags.json;

  if (cmd === "serve") {
    const { serveMcp } = await import("./mcp.js");
    await serveMcp();
    // MCP stdio server 常驻,直到 stdin 关闭(SDK 负责退出);这里绝不能 return/exit
    await new Promise<never>(() => {});
    return 0; // unreachable
  }

  if (cmd === "serve-http") {
    const { serveHttp } = await import("./http.js");
    const core = new SearchCore();
    const port = Number(flags.port ?? process.env.SC_HTTP_PORT ?? 8787);
    serveHttp(core, port, process.env.SC_HTTP_TOKEN);
    await new Promise<never>(() => {}); // 常驻
    return 0; // unreachable
  }

  const core = new SearchCore();

  try {
    switch (cmd) {
      case "search": {
        const query = _.slice(1).join(" ");
        if (!query) throw new Error('usage: search-core search "query"');
        const r = await core.search(query, {
          freshness: flags.freshness as never,
          engines: flags.engines ? String(flags.engines).split(",") : undefined,
          lang: flags.lang as string | undefined,
        });
        if (json) {
          console.log(JSON.stringify(r, null, 2));
        } else {
          console.log(`# ${r.query}`);
          console.log(
            `planner: ${r.planner.complexity}/${r.planner.route} (${r.planner.reasons.join(", ") || "-"})  engines: ${r.meta.enginesUsed.join("+") || "none"}  failed: ${r.meta.enginesFailed.map((f) => `${f.name}(${f.status})`).join(",") || "-"}  ${r.meta.degraded ? "DEGRADED " : ""}${r.meta.elapsedMs}ms${r.meta.fromCache ? " [cache]" : ""}`,
          );
          for (const ref of r.refs) {
            console.log(`\n[${ref.refId}] ${ref.title}  (${ref.engines.join(",")})`);
            console.log(`    ${ref.url}`);
            if (ref.snippet) console.log(`    ${ref.snippet.slice(0, 160)}`);
          }
        }
        break;
      }
      case "fetch": {
        const url = _[1];
        if (!url) throw new Error("usage: search-core fetch <url> [--focus text]");
        const r = await core.fetch(url, {
          focus: flags.focus as string | undefined,
          maxChars: flags["max-chars"] ? Number(flags["max-chars"]) : undefined,
        });
        if (json) {
          console.log(JSON.stringify(r, null, 2));
        } else {
          console.log(`# ${r.title ?? r.url}`);
          console.log(
            `cache=${r.fromCache} text=${r.textLength}ch returned=${r.returnedChars}ch saved=${fmtPct(r.savedPct)} ${r.elapsedMs}ms`,
          );
          console.log("---");
          if (r.segments?.length) console.log(r.segments.join("\n…\n"));
          else if (r.text) console.log(r.text);
        }
        break;
      }
      case "x": {
        const query = _.slice(1).join(" ");
        if (!query) throw new Error('usage: search-core x "query"');
        const r = await core.xSearch(query);
        if (json) console.log(JSON.stringify(r, null, 2));
        else {
          for (const ref of r.refs) {
            console.log(`[${ref.refId}] ${ref.title}  (${ref.engines.join(",")})`);
            console.log(`    ${ref.url}`);
          }
        }
        break;
      }
      case "research": {
        const query = _.slice(1).join(" ");
        if (!query && !flags.resume) throw new Error('usage: search-core research "query" [--loops 3] [--resume runId]');
        const opts = {
          preset: flags.preset as ("summary" | "report" | "deep") | undefined,
          maxLoops: flags.loops ? Number(flags.loops) : undefined,
          strict: flags.strict === true,
          minFacts: flags["min-facts"] ? Number(flags["min-facts"]) : undefined,
          fetchBudget: flags["fetch-budget"] ? Number(flags["fetch-budget"]) : undefined,
          referenceBudget: flags["ref-budget"] ? Number(flags["ref-budget"]) : undefined,
        };
        const onEvent = (e: Record<string, unknown>): void => {
          if (json) return;
          const t = e.type;
          if (t === "loop_start") console.error(`[loop ${e.loop}] angles: ${(e.angles as { angle: string }[])?.map((a) => a.angle).join(" | ")}`);
          else if (t === "angle_done") console.error(`  [${e.angle}] found=${e.found} new=${e.added} pool=${e.poolSize}`);
          else if (t === "angle_error") console.error(`  [${e.angle}] ERROR: ${e.error}`);
          else if (t === "fetch_done") console.error(`  [fetch] ${String(e.url).slice(0, 70)} refId=${e.refId}`);
          else if (t === "reflect") console.error(`  [reflect] facts=${e.facts} Q1=${(e.scores as Record<string, number>).q1Facts.toFixed(2)} Q2=${(e.scores as Record<string, number>).q2Coverage.toFixed(2)} Q3=${(e.scores as Record<string, number>).q3Authority} Q4=${(e.scores as Record<string, number>).q4Freshness}`);
          else if (t === "decide") console.error(`  [decide] ${e.decision}`);
          else if (t === "stop") console.error(`[stop] ${e.reason}: ${e.detail}`);
        };
        const r = flags.resume
          ? await core.resumeResearch(String(flags.resume), opts, onEvent)
          : await core.deepResearch(query, opts, onEvent);
        if (json) {
          console.log(JSON.stringify(r, null, 2));
        } else {
          console.log(r.report);
          console.error(`\n[run] ${r.runId} | stop=${r.stop.reason} | loops=${r.loops.length} | facts=${r.facts.length} | refs=${r.refs.length} | ${r.stats.elapsedMs}ms | journal=${r.journalPath}`);
        }
        break;
      }
      case "cache": {
        const query = _.slice(1).join(" ");
        if (!query) throw new Error('usage: search-core cache "query" [--limit 10]');
        const hits = core.searchCache(query, flags.limit ? Number(flags.limit) : 10);
        if (json) console.log(JSON.stringify(hits, null, 2));
        else {
          console.log(`# cache: ${query} — ${hits.length} hit(s)`);
          for (const h of hits) {
            console.log(`\n${h.title ?? "(untitled)"}  [${h.via}]`);
            console.log(`    ${h.url}`);
            if (h.snippet) console.log(`    ${h.snippet.slice(0, 160)}`);
          }
        }
        break;
      }
      case "providers": {
        const ps = core.providers();
        if (json) console.log(JSON.stringify(ps, null, 2));
        else {
          console.log("engine        configured  key  ok/fail   avg-ms  last-error");
          for (const p of ps) {
            console.log(
              `${p.name.padEnd(14)}${String(p.configured).padEnd(12)}${String(p.needsKey).padEnd(5)}${`${p.ok}/${p.fail}`.padEnd(10)}${String(p.avgLatencyMs).padEnd(8)}${p.lastError?.slice(0, 50) ?? ""}`,
            );
          }
        }
        break;
      }
      case "stats": {
        if (flags.clear) core.clearSearchCache();
        const s = core.stats();
        console.log(json ? JSON.stringify(s, null, 2) : JSON.stringify(s, null, 2));
        break;
      }
      default:
        console.log(`search-core v${VERSION} — client-side search orchestrator
usage:
  search-core serve                       start MCP stdio server
  search-core serve-http [--port 8787]    REST + SSE gateway (POST /research = SSE stream)
  search-core search "query" [--json]     multi-engine search (semantic dedup)
  search-core fetch <url> [--focus t]     focused page fetch (token-saving)
  search-core x "query"                   X/Twitter search (4-layer degrade chain)
  search-core cache "query"               full-text search over fetched pages (offline, instant)
  search-core research "query"            deep research loop (5 angles + 6-question reflection,
                                          [--loops 3] [--strict] [--resume runId]  dual budgets, resumable)
  search-core providers                   engine health
  search-core stats [--clear]             cache/counters
config: ~/.search-core/config.json or env (SC_SEARXNG_BASE_URL, BRAVE_API_KEY, TAVILY_API_KEY, EXA_API_KEY,
        X_BEARER_TOKEN, SC_EMBEDDING_BASE_URL/MODEL, SC_HTTP_TOKEN, ...)`);
        break;
    }
  } finally {
    core.close();
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("error:", err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
