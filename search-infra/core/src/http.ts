/**
 * REST + SSE 网关 (v0.2) — WorkBuddy[07] agentic_search SSE 思想的独立实现
 * 证据: reports/07-workbuddy.md — POST /agenttool/v1/agentic_search 返回 SSE 进度流
 *      (tool_call/tool_result/done 事件),中间检索不进调用方 context,只回 synthesis。
 *
 * 端点:
 *   GET  /health            存活探针(免鉴权)
 *   GET  /providers         引擎健康
 *   GET  /stats             计数器/缓存
 *   POST /search            多引擎搜索(JSON)
 *   POST /fetch             focus 抓取(JSON)
 *   POST /x_search          X 降级链(JSON)
 *   POST /search_cache      v0.5 缓存即搜索面(JSON) — 全文搜已抓页面语料
 *   POST /research          深度研究 — SSE 事件流(start/loop_start/angle_done/.../report/result)
 *   POST /research/resume   断点恢复 — 同上 SSE
 * 鉴权: 设了 SC_HTTP_TOKEN 时,除 /health 外都要 Authorization: Bearer <token>。
 * 运行: search-core serve-http [--port 8787]
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { SearchCore } from "./engine.js";
import type { ResearchEvent } from "./research.js";
import { VERSION } from "./version.js";

const MAX_BODY = 1024 * 1024;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body, null, 1);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        reject(new Error("invalid json body"));
      }
    });
    req.on("error", reject);
  });
}

/** SSE 写助手: event: <type>\ndata: <json>\n\n + 心跳 */
class SseStream {
  #res: ServerResponse;
  #hb: NodeJS.Timeout;
  closed = false;

  constructor(res: ServerResponse) {
    this.#res = res;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering": "no",
    });
    res.write(": search-core research stream\n\n");
    this.#hb = setInterval(() => {
      if (!this.closed) this.#res.write(": hb\n\n");
    }, 15000);
    res.on("close", () => {
      this.closed = true;
      clearInterval(this.#hb);
    });
  }

  event(type: string, data: unknown): void {
    if (this.closed) return;
    this.#res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  end(): void {
    if (this.closed) return;
    this.event("end", { ok: true });
    this.#res.end();
    this.closed = true;
    clearInterval(this.#hb);
  }
}

function authOk(req: IncomingMessage, token?: string): boolean {
  if (!token) return true;
  const h = req.headers.authorization ?? "";
  return h === `Bearer ${token}`;
}

function sseizeEvent(e: ResearchEvent): { type: string; [k: string]: unknown } {
  return e;
}

export function serveHttp(core: SearchCore, port: number, token?: string): void {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
      });
      res.end();
      return;
    }

    if (!authOk(req, token)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    try {
      // ---------- GET ----------
      if (req.method === "GET" && path === "/health") {
        sendJson(res, 200, { ok: true, version: VERSION, ts: Date.now() });
        return;
      }
      if (req.method === "GET" && path === "/providers") {
        sendJson(res, 200, { providers: core.providers() });
        return;
      }
      if (req.method === "GET" && path === "/stats") {
        sendJson(res, 200, core.stats());
        return;
      }

      // ---------- POST JSON ----------
      if (req.method === "POST" && (path === "/search" || path === "/fetch" || path === "/x_search" || path === "/search_cache")) {
        const body = await readBody(req);
        if (path === "/search") {
          const r = await core.search(String(body.query ?? ""), {
            freshness: body.freshness as never,
            lang: body.lang as string | undefined,
            maxResults: body.max_results as number | undefined,
            topN: body.top_n as number | undefined,
            engines: body.engines as string[] | undefined,
            noCache: body.no_cache as boolean | undefined,
          });
          sendJson(res, 200, r);
          return;
        }
        if (path === "/fetch") {
          const r = await core.fetch(String(body.url ?? ""), {
            focus: body.focus as string | undefined,
            maxChars: body.max_chars as number | undefined,
            adjacent: body.adjacent as number | undefined,
            noCache: body.no_cache as boolean | undefined,
          });
          sendJson(res, 200, r);
          return;
        }
        if (path === "/search_cache") {
          // v0.5: 离线全文搜已抓页面(重复查询/全网全灭时的兜底面)
          const hits = core.searchCache(String(body.query ?? ""), (body.limit as number | undefined) ?? 10);
          sendJson(res, 200, { hits, count: hits.length });
          return;
        }
        const r = await core.xSearch(String(body.query ?? ""), (body.kind as string) ?? "tweets", {
          topN: body.top_n as number | undefined,
        });
        sendJson(res, 200, r);
        return;
      }

      // ---------- POST SSE: research ----------
      if (req.method === "POST" && (path === "/research" || path === "/research/resume")) {
        const body = await readBody(req);
        const sse = new SseStream(res);
        const onEvent = (e: ResearchEvent): void => {
          const ev = sseizeEvent(e);
          sse.event(ev.type, ev);
        };
        const opts = {
          preset: body.preset as ("summary" | "report" | "deep") | undefined,
          maxLoops: body.max_loops as number | undefined,
          minFacts: body.min_facts as number | undefined,
          fetchBudget: body.fetch_budget as number | undefined,
          referenceBudget: body.reference_budget as number | undefined,
          strict: body.strict as boolean | undefined,
          angles: body.angles as string[] | undefined,
          freshness: body.freshness as never,
          domains: body.domains as { allow?: string[]; block?: string[] } | undefined,
        };
        try {
          const result = path === "/research/resume"
            ? await core.resumeResearch(String(body.run_id ?? ""), opts, onEvent)
            : await core.deepResearch(String(body.query ?? ""), opts, onEvent);
          sse.event("result", {
            runId: result.runId, report: result.report, facts: result.facts.length,
            refs: result.refs.length, loops: result.loops.length, stop: result.stop,
            stats: result.stats, registry: result.registry, journalPath: result.journalPath,
            angles: result.angles, outline: result.outline,
          });
          sse.end();
        } catch (e) {
          sse.event("error", { error: e instanceof Error ? e.message : String(e) });
          sse.end();
        }
        return;
      }

      sendJson(res, 404, { error: `no route: ${req.method} ${path}` });
    } catch (e) {
      sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  server.listen(port, () => {
    console.error(`search-core http gateway on :${port} (SSE: POST /research)`);
  });
  // 优雅退出
  const shutdown = (): void => {
    server.close();
    core.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
