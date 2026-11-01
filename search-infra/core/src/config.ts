/**
 * 配置加载: 文件(~/.search-core/config.json) < 环境变量(覆盖同名项)
 * v0-spec §5: 任何引擎失败不阻塞;免费层默认可用(G1)。
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CoreConfig {
  /** 数据目录: cache.db + journal/ */
  dataDir: string;
  /** 引擎优先级(在配置齐全时);免费引擎无需 key */
  engines: string[];
  /** 单引擎超时 ms */
  timeoutMs: number;
  /** v0.4: 软截止 ms —— 到点先收割已完成的引擎返回,慢腿剔除不再等满 timeout(0=关);默认 6000 */
  softDeadlineMs: number;
  /** phase AG-2: 早收割 ms —— 到点后若(60% 腿已结算 且 refs≥15)则立即断慢腿交付,不再干等满软截止(0=关);默认 1200 */
  earlyHarvestMs: number;
  /** v0.4: key 引擎插槽自动并联: auto=已配 key 且额度未尽的引擎自动加入默认池(用完自动回落免 key 池); off=只走显式 engines */
  keySlots: "auto" | "off";
  /** run 级输出预算(chars) */
  budgetChars: number;
  /** HTTP User-Agent */
  userAgent: string;
  /** 联系邮箱(Crossref polite pool mailto / 政策类接口备案) */
  contactEmail?: string;
  /** 各引擎配置 */
  searxng?: {
    /** 自建实例(永远最优先; 不配则直接用内置兑底链) */
    baseUrl?: string;
    engines?: string;
    /** phase AB: 公共兑底实例链(默认内置探针存活名单, SC_SEARXNG_INSTANCES 可覆盖) */
    instances?: string[];
  };
  brave?: { apiKey: string; monthlyQuota?: number };
  /** Tavily: 1000 credit/月免卡(10-b 官方确认); monthlyQuota 本地计数用完自动回落免 key 池;
   *  baseUrl 可指兼容网关(如 tavily-hikari 自建: SC_TAVILY_BASE_URL=https://tavily.ivanli.cc/api/tavily, 同款 Tavily 协议) */
  tavily?: { apiKey: string; monthlyQuota?: number; baseUrl?: string };
  exa?: { apiKey: string; monthlyQuota?: number };
  /** phase AB: Firecrawl keyless 搜索(无 key 也可用); 配 key 升级付费车道 */
  firecrawl?: { apiKey?: string };
  /** v0.2: X 降级链配置 */
  x?: {
    /** 官方 API Bearer(可选;不配则跳过官方层) */
    bearerToken?: string;
    /** Guest GraphQL 匿名层开关(默认开;失败自动熔断) */
    guestEnabled: boolean;
  };
  /** v0.2: embedding(Perplexica[12] 双阈值底座);不配用本地 TF */
  embedding?: { baseUrl?: string; apiKey?: string; model?: string };
  /** v0.2: Research Loop 默认预算(WorkBuddy[07] max_loops + Trae[06] 双预算池) */
  research: {
    maxLoops: number;
    minFacts: number;
    referenceBudget: number;
    fetchBudget: number;
    fetchPerLoop: number;
    strict: boolean;
  };
  /** v0.8: 外部 MCP 搜索连接器(gpt-researcher RETRIEVER=mcp 思想): 配了才注册(keySlot 语义同 tavily) */
  mcpConnectors?: McpConnectorConfig[];
  /** phase AD: 权威表外挂覆盖 JSON(SC_AUTHORITY_JSON 或 file.authorityOverride); 形状见 authority.ts ExternalAuthorityConfig */
  authorityOverride?: string;
  /** 域名治理 (v0-spec §4.6) */
  blockedDomains: string[];
  /** Clash TUN fake-ip 网段豁免 (dsh[10] 教训),CIDR 列表 */
  fakeIpCidrs: string[];
  /** 抓取页大小上限 */
  maxPageBytes: number;
  /** v0.2: SSRF 模式 — strict(默认,全检) / allowPrivate(跳过私网判定,不跳 DNS) / off(仅协议/端口/域名校验,测试/离线用) */
  ssrf: "strict" | "allowPrivate" | "off";
}

/** v0.8: 外部 MCP 搜索连接器配置(stdio 或 streamable HTTP 二选一;tool 缺省启发式选) */
export interface McpConnectorConfig {
  /** 引擎名后缀: 注册为 mcp:<name> */
  name: string;
  /** stdio 传输: 可执行命令(如 npx) */
  command?: string;
  args?: string[];
  /** 传给子进程的额外环境变量(如 TAVILY_API_KEY) */
  env?: Record<string, string>;
  /** 或远程传输: http(s):// streamable HTTP 端点 */
  url?: string;
  /** 指定工具名;缺省按 名称/描述 启发式选(search/query/web 优先) */
  tool?: string;
  /** 每次 search 返回条数上限(传给工具的 count 类参数),默认 8 */
  maxResults?: number;
  /** streamable HTTP 传输的自定义请求头(如 Hikari 网关: {"Authorization":"Bearer th-..."}) */
  headers?: Record<string, string>;
  /** phase AB: 自定义参数模板(字符串值里的 ${query} 被替换为查询词)。
   *  非标准参数形状的工具必配——如 Parallel web_search:
   *  {"objective":"${query}","search_queries":["${query}"]}
   *  配了则跳过 query/count 键启发式探测。 */
  argsTemplate?: Record<string, unknown>;
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function csv(v?: string): string[] | undefined {
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
}

/** SC_MCP_CONNECTORS=JSON 数组 或 文件配置 mcpConnectors;坏配置跳过不阻塞(主链路不裸奔) */
function parseMcpConnectors(rawEnv?: string, fileVal?: unknown): McpConnectorConfig[] | undefined {
  const raw = rawEnv ?? (fileVal !== undefined ? JSON.stringify(fileVal) : undefined);
  if (!raw) return undefined;
  try {
    const arr = JSON.parse(raw) as McpConnectorConfig[];
    if (!Array.isArray(arr)) return undefined;
    const ok = arr.filter((c) => c && typeof c.name === "string" && (typeof c.command === "string" || typeof c.url === "string"));
    return ok.length > 0 ? ok : undefined;
  } catch {
    return undefined;
  }
}

// 规范 UA: 带项目 URL(Wikimedia 官方 UA 政策: 空/泛/伪装浏览器 UA 一律 403, Phab T400119;
// 10-a 实测矩阵: 伪装 Chrome 的 UA 对 Wikimedia 403, 规范 UA 下 h1.1/h2 全通)
const DEFAULT_UA = "search-core/0.5 (+https://github.com/mmqz/search-tool-rnd)";

export function loadConfig(overrides?: Partial<CoreConfig>): CoreConfig {
  const dataDir = env("SC_DATA_DIR") ?? join(homedir(), ".search-core");

  // 文件配置(可不存在)
  let file: Record<string, unknown> = {};
  const cfgPath = join(dataDir, "config.json");
  if (existsSync(cfgPath)) {
    try {
      file = JSON.parse(readFileSync(cfgPath, "utf8"));
    } catch {
      file = {}; // 配置坏了不阻塞 (Perplexica[12] 教训: 主链路不裸奔)
    }
  }

  const cfg: CoreConfig = {
    dataDir,
    engines: csv(env("SC_ENGINES")) ??
      (file.engines as string[] | undefined) ?? [
        // v0.3 扩池(10-a 官方文档巡检后): +marginalia/hn/bingrss/wikipedia/arxiv/crossref = 10 引擎默认池
        // phase Y: +keenable(独立索引通用搜索, 免 key 公共路 1000 次/时/IP, 有 key 升 10 万 credit/月) = 12 引擎默认池
        // phase AB: +anysearch(托管聚合免 key 车道, 探针连打 6 发全 200) = 13; tavily keyless 车道经 keySlots=auto 并入
        // openverse(图片)/mwmbl(备胎)/googlenews(版权限个人渲染)/firecrawl(phase AB, 描述噪音待观察) 显式 engines:[...] 启用
        // phase AH(vs-zai 第 11 采样, 24 题): arxiv/crossref 移出默认池 — 实测非学术题乱入 6+ 题
        //   (design 题 top5×3/helm×3/khan×2/vim×2/finance×1; "vs" multi 拆分子查询全中招),
        //   学术源只在 academic 专线出勤(关键词路由: 论文/ paper/arxiv/survey…), 专线 7 学术腿不变
        "searxng", "duckduckgo", "mojeek", "yahoo", "marginalia", "hn", "bingrss", "wikipedia", "wiby", "keenable", "anysearch",
      ],
    timeoutMs: Number(env("SC_TIMEOUT_MS") ?? file.timeoutMs ?? 12000),
    // 软截止: wigolo[09] 思路,到点先交付;0 关闭。默认 6s(12s 超时的一半,慢腿不值得等)
    softDeadlineMs: Number(env("SC_SOFT_DEADLINE_MS") ?? file.softDeadlineMs ?? 6000),
    // 早收割(AG-2): 实测 7/9 真实查询在 refs≥12-20 时仍干等满 6s 软截止(慢腿拖尾,vs-zai 延迟差距的结构性根因);
    // 到点 1.2s 后若证据已足够(60% 腿结算+refs≥15)立即交付,质量由 bench 守(0=关)
    earlyHarvestMs: Number(env("SC_EARLY_HARVEST_MS") ?? file.earlyHarvestMs ?? 1200),
    keySlots: ((env("SC_KEY_SLOTS") ?? (file.keySlots as string | undefined) ?? "auto") === "off" ? "off" : "auto"),
    budgetChars: Number(env("SC_BUDGET_CHARS") ?? file.budgetChars ?? 60000),
    userAgent: env("SC_UA") ?? (file.userAgent as string | undefined) ?? DEFAULT_UA,
    // 联系方式: Crossref polite pool 的 mailto 参数(10-a: 进优待池更快更稳); 也是规范 UA 政策的配套项
    contactEmail: env("SC_CONTACT_EMAIL") ?? (file.contactEmail as string | undefined),
    searxng: (env("SC_SEARXNG_BASE_URL") || env("SC_SEARXNG_INSTANCES"))
      ? {
          baseUrl: env("SC_SEARXNG_BASE_URL"),
          engines: env("SC_SEARXNG_ENGINES"),
          instances: csv(env("SC_SEARXNG_INSTANCES")),
        }
      : (file.searxng as CoreConfig["searxng"] | undefined),
    brave: env("BRAVE_API_KEY") ? { apiKey: env("BRAVE_API_KEY")!, monthlyQuota: Number(env("SC_BRAVE_MONTHLY_QUOTA") ?? (file.brave as { monthlyQuota?: number } | undefined)?.monthlyQuota ?? 1000) } : (file.brave as CoreConfig["brave"] | undefined),
    tavily: (env("TAVILY_API_KEY") || env("SC_TAVILY_BASE_URL"))
      ? {
          apiKey: env("TAVILY_API_KEY") ?? (file.tavily as { apiKey?: string } | undefined)?.apiKey ?? "",
          baseUrl: env("SC_TAVILY_BASE_URL") ?? (file.tavily as { baseUrl?: string } | undefined)?.baseUrl,
          monthlyQuota: Number(env("SC_TAVILY_MONTHLY_QUOTA") ?? (file.tavily as { monthlyQuota?: number } | undefined)?.monthlyQuota ?? 1000),
        }
      : (file.tavily as CoreConfig["tavily"] | undefined),
    exa: env("EXA_API_KEY") ? { apiKey: env("EXA_API_KEY")!, monthlyQuota: Number(env("SC_EXA_MONTHLY_QUOTA") ?? (file.exa as { monthlyQuota?: number } | undefined)?.monthlyQuota ?? 1400) } : (file.exa as CoreConfig["exa"] | undefined),
    firecrawl: (env("FIRECRAWL_API_KEY") || env("SC_FIRECRAWL_API_KEY") || file.firecrawl)
      ? { apiKey: env("FIRECRAWL_API_KEY") ?? env("SC_FIRECRAWL_API_KEY") ?? (file.firecrawl as { apiKey?: string } | undefined)?.apiKey }
      : undefined,
    x: {
      bearerToken: env("X_BEARER_TOKEN") ?? (file.x as { bearerToken?: string } | undefined)?.bearerToken,
      guestEnabled: (env("SC_X_GUEST") ?? String((file.x as { guestEnabled?: boolean } | undefined)?.guestEnabled ?? true)) !== "0",
    },
    embedding: (env("SC_EMBEDDING_BASE_URL") || file.embedding) ? {
      baseUrl: env("SC_EMBEDDING_BASE_URL") ?? (file.embedding as { baseUrl?: string } | undefined)?.baseUrl,
      apiKey: env("SC_EMBEDDING_API_KEY") ?? (file.embedding as { apiKey?: string } | undefined)?.apiKey,
      model: env("SC_EMBEDDING_MODEL") ?? (file.embedding as { model?: string } | undefined)?.model ?? "text-embedding-3-small",
    } : undefined,
    blockedDomains: csv(env("SC_BLOCKED_DOMAINS")) ??
      (file.blockedDomains as string[] | undefined) ?? [
        // 默认黑名单: 常见 SEO 农场/垃圾域可由用户追加
      ],
    fakeIpCidrs: csv(env("SC_FAKE_IP_CIDRS")) ?? (file.fakeIpCidrs as string[] | undefined) ?? [],
    maxPageBytes: Number(env("SC_MAX_PAGE_BYTES") ?? file.maxPageBytes ?? 2_000_000),
    ssrf: (env("SC_SSRF") ?? (file.ssrf as string | undefined) ?? "strict") as CoreConfig["ssrf"],
    research: {
      maxLoops: Number(env("SC_RESEARCH_MAX_LOOPS") ?? (file.research as { maxLoops?: number } | undefined)?.maxLoops ?? 3),
      minFacts: Number(env("SC_RESEARCH_MIN_FACTS") ?? (file.research as { minFacts?: number } | undefined)?.minFacts ?? 6),
      referenceBudget: Number(env("SC_RESEARCH_REF_BUDGET") ?? (file.research as { referenceBudget?: number } | undefined)?.referenceBudget ?? 120),
      fetchBudget: Number(env("SC_RESEARCH_FETCH_BUDGET") ?? (file.research as { fetchBudget?: number } | undefined)?.fetchBudget ?? 12),
      fetchPerLoop: Number(env("SC_RESEARCH_FETCH_PER_LOOP") ?? (file.research as { fetchPerLoop?: number } | undefined)?.fetchPerLoop ?? 4),
      strict: (env("SC_RESEARCH_STRICT") ?? String((file.research as { strict?: boolean } | undefined)?.strict ?? false)) === "true" ||
        env("SC_RESEARCH_STRICT") === "1",
    },
    mcpConnectors: parseMcpConnectors(env("SC_MCP_CONNECTORS"), file.mcpConnectors),
    // phase AD: 权威表外挂覆盖(坏 JSON 由 mergeExternalAuthority 内部跳过, 不阻塞主链路)
    authorityOverride: env("SC_AUTHORITY_JSON") ?? (file.authorityOverride as string | undefined),
  };

  return { ...cfg, ...stripUndefined(overrides) };
}

function stripUndefined<T extends object>(o?: T): Partial<T> {
  if (!o) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}
