/**
 * probe-niche-sources.mjs — 冷门专业源探针 (Phase W, 用户"冷门的专业的需要自己做,
 * 各种冷门的论坛网站")。探针结论抄入文档, 原始 JSON 不入仓。
 * 1. lobste.rs(此前沙箱 TCP 不可达, 重测) 2. reddit .json(UA 敏感) 3. crates sort=downloads 修复验证
 */
const UA = "search-core-probe/0.8 (contact: repo issue)";
const out = {};

async function hit(name, url, headers = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(12000),
    });
    const body = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(body); } catch { /* HTML 响应 */ }
    return { name, ok: res.ok, status: res.status, ms: Date.now() - t0, json: !!parsed, len: body.length, sample: parsed ?? body.slice(0, 120) };
  } catch (e) {
    return { name, ok: false, error: String(e.cause?.code ?? e.message ?? e).slice(0, 90), ms: Date.now() - t0 };
  }
}

// 1. lobste.rs(冷门技术社区, 版图里 HN 之外最值得补的论坛)
out.lobsters = await hit("lobsters", "https://lobste.rs/search.json?q=rust%20async&what=stories&order=newest");

// 2. reddit(冷门专业讨论 r/rust r/LocalLLaMA 等; .json 后缀免 key)
out.reddit = await hit("reddit", "https://www.reddit.com/search.json?q=rust%20async%20runtime&limit=3");

// 3. crates sort=downloads 验证(case-4 修复: 头部包应进前列)
const crates = await hit("crates-sorted", "https://crates.io/api/v1/crates?q=rust%20crate%20async%20runtime%20tokio&sort=downloads&per_page=5");
if (crates.json && crates.sample?.crates) {
  crates.sample = crates.sample.crates.map((c) => `${c.name}(${c.downloads})`);
}
out.cratesSorted = crates;

// 4. packagist/rubygems 失败原因复核(第二轮 bench 两腿 error, 看是真不可达还是解析问题)
out.packagist = await hit("packagist", "https://packagist.org/search.json?q=http%20client&per_page=3");
out.rubygems = await hit("rubygems", "https://rubygems.org/api/v1/search.json?query=http%20client");

console.log(JSON.stringify(out, null, 2));
const fs = await import("node:fs");
fs.writeFileSync(`/tmp/niche-probe-${Date.now()}.json`, JSON.stringify(out, null, 2));
console.error("\nraw saved to /tmp (NOT committed)");
