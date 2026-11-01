/**
 * v0.2 测试: embed(TF 向量) + fuseSemantic 双阈值(Perplexica[12] 口径)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tfVector, cosine, embedTokens, TF_EMBEDDER, OpenAIEmbedder } from "../embed.js";
import { fuseSemantic, lexicalScore, keyTermPresent, registrableDomain } from "../fusion.js";
import type { Reference } from "../types.js";

const mkRef = (url: string, title: string, snippet: string, engine = "e1"): Reference => ({
  url, title, snippet, engines: [engine],
});

test("embed: identical texts → cosine 1; different → lower", () => {
  const a = tfVector("quantum computing architecture");
  const b = tfVector("quantum computing architecture");
  const c = tfVector("cooking pasta recipes tomato");
  assert.ok(Math.abs(cosine(a, b) - 1) < 1e-9);
  assert.ok(cosine(a, c) < 0.1);
});

test("embed: CJK bigrams make Chinese similarity meaningful", () => {
  const a = tfVector("量子计算的最新进展");
  const b = tfVector("量子计算 现状 进展");
  const c = tfVector("红烧肉的做法教程");
  assert.ok(embedTokens("量子计算").length >= 3); // 整词 + bigrams
  assert.ok(cosine(a, b) > 0.3);
  assert.ok(cosine(a, c) < 0.05);
});

test("embed: TfEmbedder async interface", async () => {
  const vecs = await TF_EMBEDDER.embed(["hello world", "hello world", "x"]);
  assert.equal(vecs.length, 3);
  assert.ok(Math.abs(cosine(vecs[0], vecs[1]) - 1) < 1e-9);
});

test("fuseSemantic: dedup >0.75 merges syndicated copies (different URLs)", async () => {
  const refs = [
    mkRef("https://a.com/news/1", "Grok Build 发布,代理式搜索全面升级", "Grok Build 发布全新代理式搜索,支持多引擎并行与引用.", "duckduckgo"),
    mkRef("https://b.com/mirror/9", "Grok Build 发布,代理式搜索全面升级", "Grok Build 发布全新代理式搜索,支持多引擎并行与引用.", "yahoo"),
    mkRef("https://c.com/other", "红烧肉做法大全", "五花肉焯水后煸炒,加入酱油糖料酒炖煮四十分钟.", "mojeek"),
  ];
  const { refs: fused, meta } = await fuseSemantic(refs, { query: "grok build", topN: 10 });
  assert.equal(meta.embedderFailed, false);
  assert.equal(meta.dedupMerged, 1);
  assert.equal(fused.length, 2);
  // 佐证合并: 幸存者的 engines 应包含两个来源
  const survivor = fused.find((r) => r.engines.length >= 2);
  assert.ok(survivor, "merged ref should carry both engines");
  // refId 重排连续
  assert.deepEqual(fused.map((r) => r.refId), [1, 2]);
});

test("fuseSemantic: relevance filter drops off-topic (threshold 0.5, TF 语义近似)", async () => {
  const refs = [
    mkRef("https://a.com/1", "vector database benchmark 2026", "we benchmark vector databases with recall and latency metrics"),
    mkRef("https://b.com/2", "best pasta carbonara recipe", "guanciale egg yolk pecorino romano spaghetti carbonara recipe"),
  ];
  const { refs: fused, meta } = await fuseSemantic(refs, {
    query: "vector database benchmark", topN: 10, relevanceThreshold: 0.05,
  });
  assert.equal(meta.relevanceDropped, 1);
  assert.equal(fused.length, 1);
  assert.match(fused[0].url, /a\.com/);
});

test("fuseSemantic: embedder failure → passthrough (Perplexica[12] similarity=1 语义)", async () => {
  const broken: never[] = [];
  const failing = {
    name: "broken",
    embed: async () => {
      throw new Error("api down");
    },
    [Symbol.iterator]: undefined,
  } as unknown as typeof broken;
  const refs = [
    mkRef("https://a.com/1", "title one", "snippet one"),
    mkRef("https://b.com/2", "title two", "snippet two"),
  ];
  const { refs: fused, meta } = await fuseSemantic(refs, {
    query: "anything", topN: 10,
    embedder: failing as never,
    relevanceThreshold: 0.9, // 若失败被吞,两条都会被过滤 → 用 passthrough 断言
  });
  assert.equal(meta.embedderFailed, true);
  assert.equal(fused.length, 2, "failure must NOT filter/drop anything");
});

test("fuseSemantic: OpenAIEmbedder parses sorted embeddings (mocked fetch)", async () => {
  const calls: string[] = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(url));
    const body = JSON.parse(String(init?.body)) as { input: string[] };
    return new Response(
      JSON.stringify({
        // 故意逆序返回但 index 正确 — 验证 SDK 消费方按 index 重排
        data: body.input.map((t, i) => ({ index: i, embedding: tfVector(t) })).reverse(),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  const emb = new OpenAIEmbedder({ baseUrl: "https://emb.test/v1", model: "m1", fetchImpl: fakeFetch });
  const vecs = await emb.embed(["alpha beta", "gamma delta"]);
  assert.equal(calls[0], "https://emb.test/v1/embeddings");
  assert.equal(vecs.length, 2);
  // index 乱序返回后应按 index 重排: 与 TF 直接算的一致
  const local = await TF_EMBEDDER.embed(["alpha beta", "gamma delta"]);
  assert.ok(Math.abs(cosine(vecs[0], local[0]) - 1) < 1e-9);
});

test("engine.search integrates fuseSemantic (dedup meta in journal path)", async () => {
  const { SearchCore } = await import("../engine.js");
  const dir = mkdtempSync(join(tmpdir(), "sc-eng-"));
  try {
    const core = new SearchCore({
      // keySlots:"off" 隔离网络: auto 下 tavily keyless 车道联网时会并入返回真结果(环境 flake 在案 2026-09-03)
      config: { dataDir: dir, engines: [], timeoutMs: 1000, keySlots: "off" } as never,
    });
    // engines=[] → 无腿可跑,refs 空,但 fusion 链路要活着
    const r = await core.search("anything at all");
    assert.equal(r.refs.length, 0);
    core.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- phase AC: 三层权威融合(主题/意图/zh 守卫/社区翻转) ----------

test("fuseSemantic: 主题分档 — zh 题里 runoob(b 档)压过同 RRF 的无名站", async () => {
  const refs = [
    mkRef("https://random-blog-seo.example.com/python-asyncio-jiaocheng", "python asyncio 教程详解", "asyncio python 教程", "searxng"),
    mkRef("https://www.runoob.com/python/python-asyncio.html", "Python asyncio 教程", "python asyncio 教程 runoob", "keenable"),
  ];
  const { refs: fused } = await fuseSemantic(refs, {
    query: "python asyncio 教程", topic: "programming", lang: "zh",
  });
  assert.equal(fused[0].url.includes("runoob"), true, "zh 主题分档应让菜鸟教程反超 SEO 站");
  assert.equal(fused[0].authority, "runoob.com");
});

test("fuseSemantic: zh 守卫 — 同表英文题不提权(零误伤)", async () => {
  const refs = [
    mkRef("https://random-blog-seo.example.com/asyncio-tutorial", "python asyncio tutorial guide", "asyncio tutorial", "searxng"),
    mkRef("https://www.runoob.com/python/python-asyncio.html", "Python asyncio tutorial", "runoob asyncio", "keenable"),
  ];
  const { refs: fused } = await fuseSemantic(refs, {
    query: "python asyncio tutorial", topic: "programming", lang: "en",
  });
  assert.equal(fused[0].url.includes("runoob"), false, "英文题里 zh 条目必须零影响");
});

test("fuseSemantic: 三层取最强不叠加 — arxiv 在 academic 主题下 s 档(1.2)而非 0.75+1.2", async () => {
  const refs = [mkRef("https://arxiv.org/abs/1706.03762", "Attention Is All You Need", "transformer attention", "arxiv")];
  const { refs: fused } = await fuseSemantic(refs, {
    query: "transformer attention paper", topic: "academic", authorityBoost: 0.75,
  });
  // score = rrf*10 + lex*1.5 + bonus; 权威项只应贡献 1.2(非 0.75+1.2=1.95)
  const s = fused[0].score ?? 0;
  const lex = lexicalScore("transformer attention paper", "Attention Is All You Need", "transformer attention");
  const expected = (1 / 61) * 10 + lex * 1.5 + 1.2;
  assert.ok(Math.abs(s - expected) < 1e-6, `score=${s} 应=${expected}(单层 1.2, 非叠加)`);
});

test("fuseSemantic: 意图类别 — 无域路由(通用面)也能按类提权", async () => {
  const refs = [
    mkRef("https://aggregator-news.example.com/openai-news", "OpenAI 最新消息", "openai 最新消息 新闻", "searxng"),
    mkRef("https://www.reuters.com/technology/openai-2026", "Reuters: OpenAI 最新消息", "openai 新闻", "bingrss"),
  ];
  const { refs: fused } = await fuseSemantic(refs, {
    query: "OpenAI 最新新闻", category: "news",
  });
  assert.equal(fused[0].url.includes("reuters"), true, "news 意图下通讯社应反超聚合站");
});

test("fuseSemantic: 社区意图翻转 — rank 微差被翻转改写(确定性判定)", async () => {
  // 构造: community 排名 1(1/61), doc 排名 2(1/62), lex 全命中同 1.0。
  // 不翻转: doc 1.2 vs community 0.75 → doc 反超(rank 差仅 0.0026);
  // 翻转: community 升 1.2 → community 以 0.0026 险胜。两个方向都数值可断言。
  const community = { url: "https://stackoverflow.com/q/4x/asyncio-experience", title: "asyncio 使用体验与讨论", snippet: "asyncio 使用体验 讨论", engines: ["searxng"] };
  const doc = { url: "https://docs.python.org/3/library/asyncio.html", title: "asyncio 官方文档", snippet: "asyncio 使用体验 讨论", engines: ["searxng"] };
  const q = "asyncio 使用体验 讨论";
  const base = { query: q, topic: "programming", topN: 10 };
  // 插入序 [community, doc]: community=searxng rank1(1/61), doc=rank2(1/62)
  const noFlip = await fuseSemantic([community, doc], { ...base, communityIntent: false });
  const flip = await fuseSemantic([community, doc], { ...base, communityIntent: true });
  assert.equal(noFlip.refs[0].url.includes("docs.python.org"), true, "无翻转: 官方 s 档应压过社区 a 档");
  assert.equal(flip.refs[0].url.includes("stackoverflow"), true, "翻转后社区源反超(rank 微差<0.45 档差)");
});

test("fuseSemantic: 混源主题 s 档同域刷屏 — MDN×5 在 domainCap=3 下让位正主(docker 题回归锁)", async () => {
  const mdn = (i: number) => mkRef(`https://developer.mozilla.org/en-US/docs/Web/API/Page_${i}`, `docker compose page ${i}`, "docker compose configuration error", "mdn");
  const refs = [
    mdn(1), mdn(2), mdn(3), mdn(4), mdn(5),
    mkRef("https://cloud.tencent.com/developer/article/docker-compose-fix", "docker compose 配置报错解决", "docker compose 配置 报错 修复", "keenable"),
    mkRef("https://forums.docker.com/t/compose-error-12345", "docker compose error discussion", "docker compose 报错", "searxng"),
  ];
  // 模拟 engine.search 的混源主题参数(programming → cap 3)
  const { refs: fused } = await fuseSemantic(refs, {
    query: "docker compose 配置 报错", topic: "programming", lang: "zh", domainCap: 3,
  });
  const mdnCount = fused.slice(0, 5).filter((r) => r.url.includes("developer.mozilla.org")).length;
  assert.ok(mdnCount <= 3, `MDN 进 top5 应 ≤3 条, 实际 ${mdnCount}(s 档霸屏回归锁)`);
  assert.ok(fused.slice(0, 5).some((r) => r.url.includes("cloud.tencent.com") || r.url.includes("forums.docker.com")),
    "正主(腾讯云/docker 官方论坛)应进 top5");
});

// ---------- phase AF: 页面级相关性守卫(keyTermPresent) ----------

test("keyTermPresent: ASCII 关键词锚优先/纯 zh 取最长 run/子串 fail-open/无词放行", () => {
  // ASCII 池取最长: asyncio(7) > python(6) — URL 路径命中即可
  assert.equal(keyTermPresent("python asyncio 教程", "https://docs.python.org/3/library/asyncio.html", "官方文档", ""), true);
  // MDN zh JS 异步教程页(域名对页面对错): title/snippet/url 均无 asyncio → false
  assert.equal(keyTermPresent("python asyncio 教程", "https://developer.mozilla.org/zh-CN/docs/Learn/JavaScript/Asynchronous", "异步编程概述", "JavaScript 异步编程入门"), false);
  // 纯 zh 查询取最长 run 子串命中派生词
  assert.equal(keyTermPresent("向量数据库 推荐", "https://zilliz.com/x", "向量数据库选型指南", ""), true);
  // zh 长词噪音保护: npm(ASCII) 为锚而非中文长 run
  assert.equal(keyTermPresent("npm 使用教程", "https://docs.npmjs.com/", "npm 中文文档", ""), true);
  // 子串 fail-open: js 在 json 里也算命中(误报方向=保留提权, 安全侧)
  assert.equal(keyTermPresent("js 数组去重", "https://example.com/json-array", "JSON 数组操作", ""), true);
  // 查询全是停用词 → 无可判定放行
  assert.equal(keyTermPresent("how what", "https://x.com/", "任何标题", ""), true);
});

test("fuseSemantic: 页面守卫 — MDN zh 异步教程页(s 档)被清零, asyncio 官方面反超(第 7 采样根因回归锁)", async () => {
  // MDN 排引擎第 1(s 档 1.2 本应霸榜), 但页面与 asyncio 无关 → 守卫清零; python.org 页面真相关
  const refs = [
    mkRef("https://developer.mozilla.org/zh-CN/docs/Learn/JavaScript/Asynchronous", "异步编程概述", "JavaScript 异步编程入门 教程", "mdn"),
    mkRef("https://docs.python.org/3/library/asyncio.html", "asyncio — Asynchronous I/O", "python asyncio 官方文档", "keenable"),
  ];
  const { refs: fused, meta } = await fuseSemantic(refs, {
    query: "python asyncio 教程", topic: "programming", lang: "zh",
  });
  assert.equal(fused[0].url.includes("docs.python.org"), true, "守卫应让 MDN 错页让位 asyncio 官方文档");
  const mdnRef = fused.find((r) => r.url.includes("developer.mozilla.org"));
  assert.equal(mdnRef?.authorityGuarded, true, "MDN 错页应带守卫触发标注");
  assert.equal(mdnRef?.authority, "developer.mozilla.org", "域名命中标注保留(透明可审计)");
  assert.equal(meta.authorityGuarded, 1, "meta 计数=被清零条数");
});

test("fuseSemantic: 页面守卫 fail-open — 页面含关键 token 时 s 档照常生效", async () => {
  // MDN 页面真的讲 asyncio(标题含) → 守卫不触发, s 档 1.2 照常提权
  const refs = [
    mkRef("https://developer.mozilla.org/en-US/docs/Web/API/asyncio", "MDN asyncio 指南", "asyncio web api", "mdn"),
    mkRef("https://random-blog.example.com/asyncio", "asyncio 教程", "asyncio tutorial", "searxng"),
  ];
  const { refs: fused, meta } = await fuseSemantic(refs, {
    query: "python asyncio 教程", topic: "programming", lang: "zh",
  });
  assert.equal(fused[0].url.includes("developer.mozilla.org"), true, "页面相关时 s 档提权不应被打压");
  assert.equal(fused[0].authorityGuarded, undefined);
  assert.equal(meta.authorityGuarded, 0);
  assert.equal(fused[0].sourceKind, "official", "sourceKind 元数据标注: MDN s 档官方域");
});

// ---------- phase AK: domainCap 计数粒度修复(注册域近似, 第 14 采样 yahoo 集群实证) ----------

test("registrableDomain: 两级 TLD 白名单取三段/普通取两段/www 剥离", () => {
  assert.equal(registrableDomain("sports.yahoo.co.jp"), "yahoo.co.jp");
  assert.equal(registrableDomain("baseball.yahoo.co.jp"), "yahoo.co.jp");
  assert.equal(registrableDomain("developer.mozilla.org"), "mozilla.org");
  assert.equal(registrableDomain("en.wikipedia.org"), "wikipedia.org");
  assert.equal(registrableDomain("www.example.com"), "example.com");
  assert.equal(registrableDomain("example.com"), "example.com");
  assert.equal(registrableDomain("datahelpdesk.worldbank.org"), "worldbank.org");
  assert.equal(registrableDomain("localhost"), "localhost");
});

test("fuseSemantic: 子域集群共享 cap — yahoo.co.jp×4(sports/baseball/weather/www)在 cap=3 下最多进 3 条(AK 回归锁)", async () => {
  const y = (sub: string) => mkRef(`https://${sub}.yahoo.co.jp/article/${sub}`, "log4j cve news item", "log4j CVE-2021-44228 mitigation", "searxng");
  const refs = [
    y("sports"), y("baseball"), y("weather"), y("www"),
    mkRef("https://logging.apache.org/log4j/2.x/security.html", "Log4j security vulnerabilities", "log4j cve mitigation apache", "tavily"),
  ];
  const { refs: fused } = await fuseSemantic(refs, {
    query: "log4j CVE-2021-44228 mitigation", topic: "security", lang: "en", domainCap: 3,
  });
  const yCount = fused.filter((r) => r.url.includes("yahoo.co.jp")).length;
  assert.ok(yCount <= 3, `yahoo.co.jp 集群进结果应 ≤3 条, 实际 ${yCount}(子域集群绕过 cap 回归锁)`);
  assert.ok(fused.some((r) => r.url.includes("logging.apache.org")), "cap 腾出的位置应轮到其他来源");
});
