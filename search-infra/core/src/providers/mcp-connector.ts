/**
 * v0.8: 外部 MCP 搜索连接器 (gpt-researcher RETRIEVER=mcp 思想的无 LLM 版)
 *
 * 证据来源: analysis/gpt-researcher/source/gpt_researcher/mcp/ —
 *  - client.py:68-81 传输按 URL scheme 自动判定(wss→websocket/http→streamable_http/否则 stdio) — 本实现同构双传输
 *  - tool_selector.py:37 gpt-researcher 用 LLM 从全部工具挑 ≤3 个 — 本实现无 LLM,
 *    改用 显式配置 tool 名 > 名称/描述启发式(/search|query|web|find/) 的确定性选法
 *  - research.py:158-200 结果归一化(structured_content.results→{title,href,body}) — 本实现接受
 *    Tavily/Exa/博查等常见 MCP 返回形状 {results:[{title,url,content|snippet|description}]}
 *
 * 设计口径:
 *  - 配了才注册(buildMcpConnectors 返回空数组=零开销);keySlot 语义与 tavily 相同(自动并联/额度尽回落,
 *    连接器自身无月度额度计数,quota.allow 对未注册名恒 true)
 *  - 连接懒建+复用: 首次 search 才 connect,之后缓存 client 与选中工具
 *  - 空结果抛错(与其他 provider 语义一致,由 router 统一记健康/熔断)
 *  - 连接目标是运营者自己配置的 stdio 命令/URL(可信输入,不走 SSRF 门)
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { McpConnectorConfig } from "../config.js";
import type { Provider, SearchCtx } from "./base.js";
import type { Reference } from "../types.js";

/** MCP SDK 懒加载(v0.8.1 内存优化): 零连接器配置=零 SDK 内存(实测省 ~36MB); 首次真实连接才动态 import */
interface McpSdk {
  Client: typeof import("@modelcontextprotocol/sdk/client/index.js").Client;
  StdioClientTransport: typeof import("@modelcontextprotocol/sdk/client/stdio.js").StdioClientTransport;
  StreamableHTTPClientTransport: typeof import("@modelcontextprotocol/sdk/client/streamableHttp.js").StreamableHTTPClientTransport;
}
let sdkP: Promise<McpSdk> | undefined;
function loadSdk(): Promise<McpSdk> {
  sdkP ??= Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js"),
    import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
  ]).then(([idx, stdio, http]) => ({
    Client: idx.Client,
    StdioClientTransport: stdio.StdioClientTransport,
    StreamableHTTPClientTransport: http.StreamableHTTPClientTransport,
  }));
  return sdkP;
}

/** MCP 工具(只取我们关心的字段,避免依赖 SDK 内部类型) */
interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
}

interface ConnState {
  client: Client;
  tool: string;
  countKey?: string;
  countKey2?: string;
}

const COUNT_KEYS = ["max_results", "maxResults", "count", "num", "limit", "n", "top_k"];
const QUERY_KEYS = ["query", "q", "search", "keywords"];

export class McpConnectorProvider implements Provider {
  name: string;
  needsKey = false;
  keySlot = true;
  config?: { apiKey?: string };

  #cfg: McpConnectorConfig;
  #conn?: Promise<ConnState>;

  constructor(cfg: McpConnectorConfig) {
    this.#cfg = cfg;
    this.name = `mcp:${cfg.name}`;
  }

  isConfigured(): boolean {
    return Boolean(this.#cfg.command || this.#cfg.url);
  }

  /** 连接 + 选工具(懒建;promise 缓存避免并发重复连接) */
  #ensureConn(): Promise<ConnState> {
    if (!this.#conn) this.#conn = this.#connect();
    return this.#conn;
  }

  async #connect(): Promise<ConnState> {
    const cfg = this.#cfg;
    const { Client, StdioClientTransport, StreamableHTTPClientTransport } = await loadSdk();
    const clientInfo = { name: "search-core", version: "0.8.0" };
    const client = new Client(clientInfo);

    // 连接成功后的任何失败(工具不存在/无工具)都必须关掉 client,否则 stdio 子进程泄漏钉死事件循环
    try {
      if (cfg.url) {
        // 传输判定同构 gpt-researcher client.py:68-76(http(s)→streamable_http)
        // phase Y: headers 支持 → 带鉴权的远程 MCP(如 Hikari 网关 tavily.ivanli.cc/mcp + Bearer th-...)
        const transport = new StreamableHTTPClientTransport(
          new URL(cfg.url),
          cfg.headers ? { requestInit: { headers: cfg.headers } } : undefined,
        );
        await client.connect(transport);
      } else {
        const transport = new StdioClientTransport({
          command: cfg.command!,
          args: cfg.args ?? [],
          env: cfg.env ? { ...cfg.env } as Record<string, string> : undefined,
        });
        await client.connect(transport);
      }

      const resp = await client.listTools();
      const tools = (resp.tools ?? []) as McpToolInfo[];
      if (tools.length === 0) throw new Error(`mcp:${cfg.name} server exposes no tools`);

      const tool = cfg.tool
        ? tools.find((t) => t.name === cfg.tool)
        : pickToolByHeuristic(tools);
      if (!tool) {
        throw new Error(
          `mcp:${cfg.name} tool "${cfg.tool}" not found; available: ${tools.map((t) => t.name).join(", ")}`,
        );
      }

      // count 类参数探测: 把用户条数上限映射到工具 schema 里真实存在的键
      const props = tool.inputSchema?.properties ?? {};
      const countKey = COUNT_KEYS.find((k) => k in props);
      const queryKey = QUERY_KEYS.find((k) => k in props) ?? Object.keys(props)[0] ?? "query";
      return { client, tool: tool.name, countKey, countKey2: queryKey };
    } catch (e) {
      try { await client.close(); } catch { /* 尽力而为 */ }
      throw e;
    }
  }

  async search(query: string, ctx: SearchCtx): Promise<Reference[]> {
    const conn = await this.#ensureConn();
    const maxResults = this.#cfg.maxResults ?? ctx.opts.maxResults ?? 8;

    // phase AB: 配了 argsTemplate → 模板替换("${query}"→查询词), 兼容任意非标准参数形状
    // (Parallel web_search 需要 {objective, search_queries[]}, 启发式探测的 query/count 键拼法接不上)
    const args = this.#cfg.argsTemplate
      ? buildToolArgsFromTemplate(this.#cfg.argsTemplate, query)
      : buildToolArgsHeuristic(conn, query, maxResults);

    const res = await conn.client.callTool(
      { name: conn.tool, arguments: args },
      undefined,
      { signal: ctx.signal, timeout: 20_000 },
    );

    const refs = normalizeToolResult(this.name, res);
    if (refs.length === 0) {
      throw new Error(`mcp:${this.#cfg.name} returned 0 results for "${query}" (tool=${conn.tool})`);
    }
    return refs;
  }

  /** 断开连接并终止 stdio 子进程(长驻 server 不应关闭;测试/优雅退出用) */
  async close(): Promise<void> {
    if (!this.#conn) return;
    const conn = await this.#conn.catch(() => undefined); // 失败的连接也要走清理(#connect 内已关 client)
    this.#conn = undefined;
    if (conn) {
      try { await conn.client.close(); } catch { /* 子进程可能已退 */ }
    }
  }
}

/** 无模板时的启发式参数拼法(原逻辑抽出,黄金测试用) */
export function buildToolArgsHeuristic(conn: { countKey?: string; countKey2?: string }, query: string, maxResults: number): Record<string, unknown> {
  const args: Record<string, unknown> = { [conn.countKey2 ?? "query"]: query };
  if (conn.countKey) args[conn.countKey] = maxResults;
  return args;
}

/** phase AB: argsTemplate 深拷贝替换——字符串值里 ${query} 全量替换;嵌套对象/数组递归(黄金测试用) */
export function buildToolArgsFromTemplate(tpl: Record<string, unknown>, query: string): Record<string, unknown> {
  const sub = (v: unknown): unknown => {
    if (typeof v === "string") return v.replaceAll("${query}", query);
    if (Array.isArray(v)) return v.map(sub);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sub(x)]));
    }
    return v;
  };
  return Object.fromEntries(Object.entries(tpl).map(([k, v]) => [k, sub(v)])) as Record<string, unknown>;
}

/** 无 LLM 工具选择: 名称权重(/search|query|web|find/ 命中)优先,平手取最短名(最像"裸搜索");零命中=不乱选 */
export function pickToolByHeuristic(tools: McpToolInfo[]): McpToolInfo | undefined {
  let best: McpToolInfo | undefined;
  let bestScore = 0; // 阈值 1: 至少要像搜索工具才选,否则宁可报"没有可用工具"
  for (const t of tools) {
    let score = 0;
    if (/\bsearch|query|web|find\b/i.test(t.name)) score += 3;
    if (/\bsearch|results|web page/i.test(t.description ?? "")) score += 1;
    if (score > bestScore || (score === bestScore && best && t.name.length < best.name.length)) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

/**
 * 结果归一化(接受常见 MCP 搜索工具返回形状,gpt-researcher research.py:158-200 同思路):
 *  - { results: [{title,url,content|snippet|description|body|text,...}] }  ← Tavily/Exa/博查 MCP 常见
 *  - [{...}] 直接数组
 *  - { content: [{type:"text", text:"<json|纯文本>"}] } → 先取 text 再按上述解析
 */
export function normalizeToolResult(engineName: string, res: unknown): Reference[] {
  const items = extractItems(res);
  const refs: Reference[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const url = pickStr(o, ["url", "href", "link"]);
    const title = pickStr(o, ["title", "name"]) ?? url ?? "(untitled)";
    const snippet = pickStr(o, ["content", "snippet", "description", "body", "text", "summary", "excerpts"]) ?? "";
    if (!url && !snippet) continue;
    refs.push({
      url: url ?? "",
      title,
      snippet,
      engines: [engineName],
      rank: typeof o.rank === "number" ? o.rank : undefined,
      published: pickStr(o, ["published_date", "published", "date"]),
    });
  }
  return refs;
}

function extractItems(res: unknown): unknown[] {
  if (Array.isArray(res)) return res;
  if (!res || typeof res !== "object") return [];
  const o = res as Record<string, unknown>;
  // MCP callTool 信封: content:[{type:"text",text:...}]
  if (Array.isArray(o.content)) {
    const textPart = o.content.find(
      (c) => c && typeof c === "object" && (c as { type?: string }).type === "text",
    ) as { text?: string } | undefined;
    if (textPart?.text) {
      try {
        return extractItems(JSON.parse(textPart.text));
      } catch {
        return [{ content: textPart.text }]; // 纯文本结果当单条无 URL 记录
      }
    }
  }
  if (Array.isArray(o.results)) return o.results;
  if (Array.isArray(o.data)) return o.data;
  if (o.structuredContent) return extractItems(o.structuredContent);
  return [];
}

function pickStr(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    // phase AB: Parallel web_search 的片段是 excerpts: string[] —— 数组连接当片段用,
    // 否则 extractItems 能拿到条目但 snippet 全空 → 只剩 url 的"哑条目"
    if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")) {
      return (v as string[]).join(" / ").trim();
    }
  }
  return undefined;
}

/** v0.8: 配了才注册;坏条目跳过(config 层已滤,这里双保险) */
export function buildMcpConnectors(cfgs?: McpConnectorConfig[]): Provider[] {
  if (!cfgs || cfgs.length === 0) return [];
  return cfgs
    .filter((c) => c && typeof c.name === "string" && (c.command || c.url))
    .map((c) => new McpConnectorProvider(c));
}
