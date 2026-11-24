#!/usr/bin/env node
/**
 * S0 可复现基线 —— issue #3 第一阶段。
 *
 * 固定题集 × 确定性本地 fixture：测量现实现的
 *   成功率 / 相关首位排名 / 响应延迟 / provider 请求数 / 冷暖缓存差异。
 * 公开网络可用性单独探测并如实记录（fixture 结果不得冒充公网可用）。
 *
 * 运行（仓库根）：node mcp/servers/search-core/typescript/scripts/s0-baseline.mjs
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { SearchCore } from '../dist/engine.js';

const REPO = new URL('../../../../..', import.meta.url).pathname;

/** 固定题集（版本化：内容变化需重建基线）。 */
const QUESTION_SET = {
  version: 's0-v1',
  categories: [
    { id: 'Q1-official-doc', query: 'SQLite WAL concurrency', expect: 'https://sqlite.org/wal.html', note: '官方技术文档/明确版本' },
    { id: 'Q2-general-research', query: 'Node.js DatabaseSync SQLite API', expect: 'https://nodejs.org/api/sqlite.html', note: '通用研究' },
    { id: 'Q3-chinese-community', query: 'Zed 编辑器 DeltaDB 中文', expect: 'https://zh.example.club/zed-deltadb', note: '中文社区' },
    { id: 'Q4-sparse-nonexistent', query: 'qzwxecrv12345 不存在主题 xyzzy42', expect: null, note: '少结果/不存在——期望空或降级且透明' },
    { id: 'Q5-partial-failure', query: 'github actions cache docker layers', expect: 'https://docs.example.dev/gh-cache', note: '部分引擎失败（一路429+一路超时），其余路须仍可用' },
    { id: 'Q6-lexical-overlap-irrelevant', query: 'python list comprehension recipes cooking', expect: null, note: '无关但词重合——偏题结果须被拒或标空/降级' },
    { id: 'Q7-cache-repeat', query: 'SQLite WAL concurrency', expect: 'https://sqlite.org/wal.html', note: '缓存重复——与Q1同题，暖缓存须0新增provider请求' },
  ],
};

/** 确定性 fixture：按题返回脚本化响应（含 429、超时挂起、伪200、偏题结果）。 */
async function createS0Fixture() {
  const requests = [];
  const slow = (ms) => new Promise((r) => setTimeout(r, ms));
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const q = url.searchParams.get('q') ?? '';
    requests.push({ at: Date.now(), path: url.pathname, query: q });
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/search') {
      // 子串匹配：planner 会改写/拆分子查询（S0 基线本身要记录这一行为）。
      await slow(30);
      if (q.includes('DatabaseSync') || q.includes('Node.js')) {
        return json(200, { results: [
          { url: 'https://nodejs.org/api/sqlite.html', title: 'SQLite | Node.js v26 documentation', content: 'DatabaseSync node sqlite synchronous API documentation', engines: ['fixture'] },
        ] });
      }
      if (q.includes('WAL') || q.toLowerCase().includes('sqlite')) {
        return json(200, { results: [
          { url: 'https://sqlite.org/wal.html', title: 'Write-Ahead Logging - SQLite', content: 'SQLite WAL concurrency write-ahead logging checkpoint official documentation', engines: ['fixture'] },
          { url: 'https://sqlite.org/wal.html#ckpt', title: 'Checkpointing - WAL', content: 'wal checkpoint starvation concurrency', engines: ['fixture'] },
        ] });
      }
      if (q.includes('DeltaDB') || q.includes('Zed')) {
        return json(200, { results: [
          { url: 'https://zh.example.club/zed-deltadb', title: 'Zed 编辑器 DeltaDB 中文讨论', content: 'zed 编辑器 deltadb 中文 社区 讨论', engines: ['fixture'] },
        ] });
      }
      if (q.includes('qzwxecrv12345')) return json(200, { results: [] });
      if (q.includes('comprehension') || q.includes('cooking')) {
        return json(200, { results: [
          { url: 'https://cooking.example.tv/pasta', title: 'python 沙拉烹饪食谱', content: 'cooking recipes pasta list of ingredients comprehension', engines: ['fixture'] },
        ] });
      }
      if (q.includes('github actions cache') || q.includes('docker layers')) {
        return json(200, { results: [
          { url: 'https://docs.example.dev/gh-cache', title: 'GitHub Actions cache docs', content: 'github actions cache docker layers documentation', engines: ['fixture'] },
        ] });
      }
      return json(200, { results: [] });
    }
    if (url.pathname === '/failing429/search') { await slow(10); return json(429, { error: 'rate limited' }); }
    if (url.pathname === '/hanging/search') { await slow(5000); return json(200, { results: [] }); }
    if (url.pathname === '/partial/search') {
      await slow(40);
      if (!/github|actions|cache|docker/i.test(q)) return json(200, { results: [] });
      return json(200, { results: [
        { url: 'https://docs.example.dev/gh-cache', title: 'GitHub Actions cache docs', content: 'github actions cache docker layers documentation', engines: ['fixture'] },
      ] });
    }
    if (url.pathname === '/fake200/search') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>login required</html>'); }
    return json(404, {});
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    requests,
    close: async () => { server.closeAllConnections(); await new Promise((r) => server.close(() => r())); },
  };
}

function pct(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

const fixture = await createS0Fixture();
const dir = mkdtempSync(join(tmpdir(), 'sc-s0-'));
const core = new SearchCore({
  config: {
    dataDir: dir,
    // 只用 searxng（base+实例全部指向 fixture）；duckduckgo 硬编码真实 URL，公网行为由下方 public probe 单独实测。
    engines: ['searxng'],
    keySlots: 'off',
    searxng: { baseUrl: fixture.url, instances: [fixture.url + '/partial', fixture.url + '/failing429', fixture.url + '/hanging', fixture.url + '/fake200'] },
    timeoutMs: 1500, softDeadlineMs: 800, earlyHarvestMs: 0,
  },
});

const rows = [];
try {
  for (const cat of QUESTION_SET.categories) {
    const before = fixture.requests.length;
    const started = Date.now();
    const subQueries = () => fixture.requests.slice(before).map((r) => r.path + ':' + r.query);
    let result;
    let error = null;
    try { result = await core.search(cat.query); } catch (e) { error = String(e); }
    const latency = Date.now() - started;
    const providerRequests = fixture.requests.length - before;
    const refs = result?.refs ?? [];
    const relevantIndex = cat.expect ? refs.findIndex((r) => r.url === cat.expect) : -1;
    const quality = result?.meta?.quality?.status ?? null;
    const success = cat.expect === null
      ? (refs.length === 0 || quality === 'no_relevant_results')
      : relevantIndex >= 0;
    rows.push({
      id: cat.id, note: cat.note, query: cat.query, expect: cat.expect,
      success, error,
      refs_returned: refs.length, relevant_rank: relevantIndex >= 0 ? relevantIndex + 1 : null,
      quality_status: quality, degraded: Boolean(result?.meta?.degraded), failed_providers: result?.meta?.failed?.length ?? 0,
      provider_requests: providerRequests, latency_ms: latency,
      fixture_subqueries: subQueries(),
      top_ref_urls: refs.slice(0, 8).map((r) => r.url),
    });
  }
} finally {
  core.close();
  await fixture.close();
  rmSync(dir, { recursive: true, force: true });
}

const latencies = rows.filter((r) => r.success).map((r) => r.latency_ms);
const summary = {
  total: rows.length,
  success: rows.filter((r) => r.success).length,
  first_useful_rank_distribution: rows.filter((r) => r.relevant_rank).reduce((acc, r) => { acc[r.relevant_rank] = (acc[r.relevant_rank] ?? 0) + 1; return acc; }, {}),
  latency_p50: pct(latencies, 50),
  latency_p95: pct(latencies, 95),
  cache_repeat_zero_requests: rows.find((r) => r.id === 'Q7-cache-repeat')?.provider_requests === 0,
};

/** 公开网络可用性单独探测（如实记录，不冒充）。 */
let publicProbe = { attempted: true };
try {
  const pubDir = mkdtempSync(join(tmpdir(), 'sc-s0-pub-'));
  const pubCore = new SearchCore({ config: { dataDir: pubDir, engines: ['duckduckgo'], keySlots: 'off', timeoutMs: 4000, softDeadlineMs: 3000 } });
  const t0 = Date.now();
  try {
    const r = await pubCore.search('SQLite WAL concurrency');
    publicProbe = { attempted: true, ok: true, refs: r.refs.length, quality: r.meta?.quality?.status ?? null, degraded: Boolean(r.meta?.degraded), latency_ms: Date.now() - t0, note: 'real public network single sample' };
  } finally { pubCore.close(); rmSync(pubDir, { recursive: true, force: true }); }
} catch (e) {
  publicProbe = { attempted: true, ok: false, error: String(e).slice(0, 300), note: 'public network unavailable or blocked in this environment — recorded honestly, fixture results do not claim public availability' };
}

const report = {
  schema: 1,
  status: 'S0_BASELINE_RECORDED',
  at: new Date().toISOString(),
  question_set: QUESTION_SET.version,
  environment: { platform: 'linux sandbox', source: 'deterministic local SearXNG-compatible fixture; not public web' },
  rows,
  summary,
  public_network_probe: publicProbe,
  limits: [
    'Fixture latency is scripted (30-40ms) — p50/p95 measure scheduling behavior, not real network latency',
    'First-useful-candidate latency approximated by batch response latency; per-reference streaming not measured',
    'Single run per question; A/B against a modified implementation must run same-time pairs (issue S0 requirement) before claiming improvement',
    'Fixture success measures the current implementation on controlled inputs; it is not a semantic relevance certification',
  ],
};
const out = join(REPO, 'catalog/audit/search-s0-baseline.json');
writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary, public_network_probe: publicProbe, output: out }, null, 2));
