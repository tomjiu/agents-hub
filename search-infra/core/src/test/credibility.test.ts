/**
 * credibility.test.ts — 置信度筛选 v0.8 (用户提案: 屏蔽 csdn/百家号/搜狐等灌水站)
 * 覆盖: 两档匹配规则(段精确/防伪命中) + 名单完整性 + fuseSemantic 集成(剔除计数/降权重排/标注)
 *       + 域名多样性 cap(治单一权威源霸屏)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SPAM_BLOCKED_DOMAINS, SPAM_DOWNWEIGHT_DOMAINS, SPAM_DOWNWEIGHT_PENALTY,
  matchSpamBlocked, matchSpamDownweight,
} from "../credibility.js";
import { fuseSemantic } from "../fusion.js";
import type { Reference } from "../types.js";

test("硬屏蔽: 用户点名站全命中", () => {
  assert.equal(matchSpamBlocked("https://blog.csdn.net/xx/article/1"), "csdn.net");
  assert.equal(matchSpamBlocked("https://baijiahao.baidu.com/s?id=1"), "baijiahao.baidu.com");
  assert.equal(matchSpamBlocked("https://www.sohu.com/a/123"), "sohu.com");
  assert.equal(matchSpamBlocked("https://wenku.baidu.com/view/1.html"), "wenku.baidu.com");
  assert.equal(matchSpamBlocked("https://www.docin.com/p-1.html"), "docin.com");
});

test("硬屏蔽: 伪装域不命中(段精确)", () => {
  assert.equal(matchSpamBlocked("https://fake-csdn.net/a"), null);
  assert.equal(matchSpamBlocked("https://csdn.net.evil.example/a"), null);
  assert.equal(matchSpamBlocked("https://notsohu.com/a"), null);
  assert.equal(matchSpamBlocked("garbage"), null);
});

test("硬屏蔽: 知乎/cnblogs 等未点名站不误伤", () => {
  assert.equal(matchSpamBlocked("https://www.zhihu.com/question/1"), null);
  assert.equal(matchSpamBlocked("https://www.cnblogs.com/xx/p/1.html"), null);
  assert.equal(matchSpamBlocked("https://arxiv.org/abs/1"), null);
});

test("降权档: ehow/wikihow/answers 命中", () => {
  assert.equal(matchSpamDownweight("https://www.ehow.com/how_1.html"), "ehow.com");
  assert.equal(matchSpamDownweight("https://www.wikihow.com/Do-Thing"), "wikihow.com");
  assert.equal(matchSpamDownweight("https://www.answers.com/Q/1"), "answers.com");
});

test("名单完整性: 无重复/全小写/纯域名, 与权威表零交集", async () => {
  const { AUTHORITY_DOMAINS } = await import("../authority.js");
  for (const table of [SPAM_BLOCKED_DOMAINS, SPAM_DOWNWEIGHT_DOMAINS]) {
    assert.equal(new Set(table).size, table.length, "不应重复");
    for (const d of table) {
      assert.equal(d, d.toLowerCase());
      assert.ok(!d.includes("/") && !d.includes(":"));
    }
  }
  for (const a of AUTHORITY_DOMAINS) {
    assert.ok(!SPAM_BLOCKED_DOMAINS.includes(a) && !SPAM_DOWNWEIGHT_DOMAINS.includes(a),
      `${a} 同时出现在权威表与垃圾表 = 矛盾配置`);
  }
});

function ref(url: string, title: string, engine = "duckduckgo"): Reference {
  return { url, title, snippet: title, engines: [engine] };
}

test("fuseSemantic 集成: 硬屏蔽剔除并计数, 正常条不受影响", async () => {
  const list: Reference[] = [
    ref("https://blog.csdn.net/xx/article/1", "rust async runtime 详解"),
    ref("https://wenku.baidu.com/view/1.html", "rust async runtime 文档"),
    ref("https://arxiv.org/abs/1706.03762", "rust async runtime paper"),
    ref("https://docs.rs/tokio", "tokio rust async runtime"),
  ];
  const { refs, meta } = await fuseSemantic(list, { query: "rust async runtime", topN: 10 });
  assert.equal(meta.spamBlocked, 2, "csdn+文库应剔除 2 条");
  assert.ok(!refs.some((r) => r.url.includes("csdn") || r.url.includes("wenku")));
  assert.ok(refs.some((r) => r.url.includes("docs.rs")));
});

test("fuseSemantic 集成: 降权档重排到强相关正常页之后并带 spam 标注", async () => {
  const list: Reference[] = [
    ref("https://www.ehow.com/how_1", "how to fix rust async runtime error"),
    ref("https://docs.rs/tokio", "tokio rust async runtime"),
  ];
  const { refs, meta } = await fuseSemantic(list, { query: "rust async runtime", topN: 10 });
  assert.equal(meta.spamBlocked, 0);
  const ehow = refs.find((r) => r.url.includes("ehow"));
  assert.ok(ehow?.spam === "ehow.com", "降权条应带 spam 标注");
  const ehowIdx = refs.findIndex((r) => r.url.includes("ehow"));
  const docsIdx = refs.findIndex((r) => r.url.includes("docs.rs"));
  assert.ok(docsIdx < ehowIdx, "正常页应排在降权农场前(-1.2 压过词法差)");
  assert.ok(Math.abs(SPAM_DOWNWEIGHT_PENALTY + 1.2) < 1e-9);
});

test("域名多样性 cap: 单域霸屏被裁到 3 条, 异域保留", async () => {
  const list: Reference[] = [
    ref("https://arxiv.org/abs/1", "vector database faiss milvus benchmark"),
    ref("https://arxiv.org/abs/2", "vector database faiss tutorial indexing"),
    ref("https://arxiv.org/abs/3", "vector database milvus deployment kubernetes"),
    ref("https://arxiv.org/abs/4", "faiss quantization product keys compression"),
    ref("https://arxiv.org/abs/5", "ann retrieval hybrid sparse dense ranking"),
    ref("https://zilliz.com/blog/vector-db", "vector database faiss milvus blog"),
    ref("https://milvus.io/docs", "vector database faiss milvus docs"),
  ];
  // dedupThreshold=2(cosine 上限 1)→ 恭用语义去重, 本测试专注 cap 行为
  const { refs } = await fuseSemantic(list, { query: "vector database faiss milvus", topN: 10, dedupThreshold: 2 });
  const arxivCount = refs.filter((r) => new URL(r.url).hostname.endsWith("arxiv.org")).length;
  assert.equal(arxivCount, 3, "单域应被 cap 到 3");
  assert.ok(refs.some((r) => r.url.includes("milvus.io")) && refs.some((r) => r.url.includes("zilliz.com")),
    "异域视角应保留在结果里");
});

test("domainCap=0 关闭多样性裁剪", async () => {
  const list: Reference[] = [
    ref("https://a.example.com/1", "kw alpha"), ref("https://a.example.com/2", "kw alpha"),
    ref("https://a.example.com/3", "kw alpha"), ref("https://a.example.com/4", "kw alpha"),
  ];
  const { refs } = await fuseSemantic(list, { query: "kw alpha", topN: 10, domainCap: 0, dedupThreshold: 2 });
  assert.equal(refs.length, 4, "cap=0 时单域 4 条全保留");
});
