/**
 * phase AD fetcher 测试: 落地页改写链
 * - crates.io SPA → 官方 API 端点直取(待办 1: SPA 空文本老挂账)
 * - doi 403 → OpenAlex OA 直链回退(待办 2: 出版商反爬老挂账)
 * - 回退失败诚实抱原始错; OpenAlex 自身失败不掩盖
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cache } from "../cache.js";
import { Fetcher } from "../fetcher.js";
import { loadConfig } from "../config.js";

const doiOf = Fetcher.doiOf;

type AnyFetch = (url: string, init?: RequestInit) => Promise<Response>;

const CRATE_API_JSON = JSON.stringify({
  crate: {
    name: "tokio", description: "An event-driven, non-blocking I/O platform for writing asynchronous I/O backed applications.",
    max_stable_version: "1.47.1", repository: "https://github.com/tokio-rs/tokio",
    documentation: "https://docs.rs/tokio", downloads: 987654321, updated_at: "2026-08-01T00:00:00Z",
  },
  versions: [],
});

const PMC_HTML = "<html><head><title>Free full text</title></head><body><article>Aspirin inhibits cyclooxygenase irreversibly. This open-access full text explains the mechanism of action in detail for agents to extract.</article></body></html>";

function mkFetcher(calls: { url: string; status: number; body: string; contentType: string }[]) {
  const dir = mkdtempSync(join(tmpdir(), "sc-fetch-"));
  const cache = new Cache(dir);
  const cfg = loadConfig({ dataDir: dir, ssrf: "off", contactEmail: "test@example.com" });
  const seenUrls: string[] = [];
  const fetchImpl: AnyFetch = async (url) => {
    seenUrls.push(String(url));
    const hit = calls[seenUrls.length - 1];
    return new Response(hit.body, { status: hit.status, headers: { "Content-Type": hit.contentType } });
  };
  const fetcher = new Fetcher(cfg, cache, undefined, fetchImpl as unknown as typeof fetch);
  const cleanup = () => {
    cache.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { fetcher, seenUrls, cleanup };
}

test("cratesApiRewrite: 裸 crate 页改写 API, 其他路径/域不动", () => {
  assert.deepEqual(
    Fetcher.cratesApiRewrite("https://crates.io/crates/tokio"),
    { name: "tokio", apiUrl: "https://crates.io/api/v1/crates/tokio" },
  );
  assert.equal(Fetcher.cratesApiRewrite("https://crates.io/crates/tokio/versions"), null);
  assert.equal(Fetcher.cratesApiRewrite("https://lib.rs/crates/tokio"), null);
});

test("fetch crates.io/crates/x → 实际打 API 端点, JSON 转人读摘要(SPA 空文本修复)", async () => {
  const { fetcher, seenUrls, cleanup } = mkFetcher([
    { url: "", status: 200, body: CRATE_API_JSON, contentType: "application/json" },
  ]);
  try {
    const r = await fetcher.run("https://crates.io/crates/tokio");
    assert.ok(seenUrls[0].includes("crates.io/api/v1/crates/tokio"), "应请求 API 端点而非 SPA 页");
    assert.equal(r.title, "tokio");
    assert.ok(r.text!.includes("event-driven, non-blocking I/O"), "description 应进正文");
    assert.ok(r.text!.includes("1.47.1"), "latest 版本应进正文");
    assert.ok(r.text!.length < 2000, "摘要不应是原始大 JSON");
  } finally {
    cleanup();
  }
});

test("doiOf: doi.org 链接与错误信息里的落地 URL 都能提取", () => {
  assert.equal(doiOf("https://doi.org/10.1056/NEJMoa2034577"), "10.1056/NEJMoa2034577");
  assert.equal(doiOf("http 403 for https://www.sciencedirect.com/science/article/pii/S0040402097800467?via%3Dihub"), null);
  assert.equal(doiOf("http 403 for https://doi.org/10.1016/S0040-4020(97)80046-7"), "10.1016/S0040-4020(97)80046-7");
});

test("fetch doi 落地 403 → OpenAlex OA 直链回退成功", async () => {
  const { fetcher, seenUrls, cleanup } = mkFetcher([
    { url: "", status: 403, body: "access denied", contentType: "text/html" }, // wiley 落地
    { url: "", status: 200, body: JSON.stringify({
        best_oa_location: { landing_page_url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC123/" },
      }), contentType: "application/json" }, // OpenAlex
    { url: "", status: 200, body: PMC_HTML, contentType: "text/html" }, // OA 落地页
  ]);
  try {
    const r = await fetcher.run("https://doi.org/10.1002/example-fake");
    assert.ok(seenUrls[0].includes("doi.org"), "第一跳原始落地");
    assert.ok(seenUrls[1].includes("api.openalex.org/works/https://doi.org/10.1002/example-fake"), "第二跳 OpenAlex");
    assert.ok(seenUrls[2].includes("pmc.ncbi.nlm.nih.gov"), "第三跳 OA 落地页");
    assert.ok(r.text!.includes("cyclooxygenase"), "OA 正文应被提取");
  } finally {
    cleanup();
  }
});

test("fetch 非 403 错误不走 OA 回退(诚实抱原始错)", async () => {
  const { fetcher, seenUrls, cleanup } = mkFetcher([
    { url: "", status: 500, body: "boom", contentType: "text/html" },
  ]);
  try {
    await assert.rejects(
      () => fetcher.run("https://doi.org/10.1002/example-fake"),
      /http 500/,
      "500 不该触发 OA 回退",
    );
    assert.equal(seenUrls.length, 1, "只应有一跳");
  } finally {
    cleanup();
  }
});

test("fetch 403 但双通道都无 OA 链接 → 抱原始 403(不造空结果)", async () => {
  const { fetcher, seenUrls, cleanup } = mkFetcher([
    { url: "", status: 403, body: "access denied", contentType: "text/html" },                      // 出版商
    { url: "", status: 200, body: JSON.stringify({ best_oa_location: null }), contentType: "application/json" }, // OpenAlex 空手
    { url: "", status: 404, body: "not in unpaywall", contentType: "text/html" },                   // Unpaywall 也空手
  ]);
  try {
    await assert.rejects(() => fetcher.run("https://doi.org/10.1002/closed-access"), /http 403/);
    assert.equal(seenUrls.length, 3, "双通道(OpenAlex→Unpaywall)都空手才放弃");
    assert.ok(seenUrls[2].includes("api.unpaywall.org"), "email 已配应继续试 Unpaywall");
  } finally {
    cleanup();
  }
});

test("fetch SPA 假 200 空文本也触发 OA 回退(2026-09-03 实弹: sciencedirect 200 但 JS 空壳)", async () => {
  const { fetcher, seenUrls, cleanup } = mkFetcher([
    { url: "", status: 200, body: "<html><body><script>x=1</script></body></html>", contentType: "text/html" }, // SPA 空壳
    { url: "", status: 200, body: JSON.stringify({
        best_oa_location: { landing_page_url: "https://oro.open.ac.uk/id/eprint/123" },
      }), contentType: "application/json" }, // OpenAlex
    { url: "", status: 200, body: PMC_HTML, contentType: "text/html" }, // OA 机构库落地
  ]);
  try {
    const r = await fetcher.run("https://doi.org/10.1016/j.jesp.example");
    assert.ok(seenUrls[1].includes("api.openalex.org"), "空文本应触发 OA 回退");
    assert.ok(r.text!.includes("cyclooxygenase"));
  } finally {
    cleanup();
  }
});

test("fetch 403 → OpenAlex 挂 → Unpaywall 第二回退(email 已配)", async () => {
  const calls: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "sc-fetch-"));
  const cache = new Cache(dir);
  const cfg = loadConfig({ dataDir: dir, ssrf: "off", contactEmail: "test@example.com" });
  const script: { status: number; body: string; ct: string }[] = [
    { status: 403, body: "denied", ct: "text/html" },                                            // 出版商
    { status: 429, body: "rate limited", ct: "application/json" },                               // OpenAlex 429(实弹在案)
    { status: 200, body: JSON.stringify({ best_oa_location: { url_for_pdf: "https://repo.example/x.pdf", url: "https://repo.example/landing" } }), ct: "application/json" }, // Unpaywall
    { status: 200, body: PMC_HTML, ct: "text/html" },                                            // OA 落地
  ];
  const fetchImpl: AnyFetch = async (url) => {
    calls.push(String(url));
    const s = script[calls.length - 1];
    return new Response(s.body, { status: s.status, headers: { "Content-Type": s.ct } });
  };
  const fetcher = new Fetcher(cfg, cache, undefined, fetchImpl as unknown as typeof fetch);
  try {
    const r = await fetcher.run("https://doi.org/10.1002/fallback-chain");
    assert.ok(calls[1].includes("api.openalex.org"));
    assert.ok(calls[2].includes("api.unpaywall.org"), "OpenAlex 挂后应换 Unpaywall");
    assert.ok(calls[3].includes("repo.example/landing"), "优先落地页而非 pdf");
    assert.ok(r.text!.includes("cyclooxygenase"));
  } finally {
    cache.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
