// junk-gold.mjs — 批 29: 垃圾 gold 页分类器(归因层专用, 不进 eval 命中口径)
//
// 背景: b22 人工裁决 17 条 miss@1 时发现 2 条 "gold 页本身是垃圾"(匹配器假阳性) — 答案 token
//       恰好出现在垃圾页(社媒 reel/题库农场/聚合板)上, 使归因把"无真 gold"误判为"gold 被压顶"。
//       b23 排队候选②: 把这条口径工程化。
//
// 口径边界(重要):
//   1. 只用于 miss 归因(analyze-suppression 等)的 gold 侧校验 — eval hit@N 口径不变(跨窗可比性红线)。
//      理由: 垃圾页含答案 token 时, "系统确实把答案文本带到了用户面前"仍然成立, hit 语义不动;
//      但"排序把更好的页压下去了"的归因不成立(垃圾页不是更好的页), gold 侧必须剔除。
//   2. drift 工具(goldAt)不用本分类器 — 双窗 diff 必须 eval 口径逐字等价, 任何附加判断都破坏可比性。
//   3. 保守 v1: 只收确定性信号(域名 + 标题样板), 不做内容启发式; 每类信号附理由可审计。
//      误伤可接受方向: 把真 gold 剔出 gold 侧 → 该题落入 E 桶接受人工复核, 不静默丢弃。

// 域名信号: 社媒 UGC 的图片/视频页 + 题库/作业农场 — QA 证据价值趋零, 标题样板词占满 title
const JUNK_DOMAINS = [
  // 社媒 UGC reel/帖子页(b22 实锤样本: Instagram reel 页当 gold)
  "instagram.com", "tiktok.com", "pin.it", "pinterest.com", "facebook.com",
  "threads.net", "x.com", "twitter.com",
  // 题库/作业农场(答案 token 高密度堆叠, 匹配器假阳性重灾区)
  "quizlet.com", "brainly.com", "brainly.in", "brainly.ph", "coursehero.com",
  "chegg.com", "studocu.com", "numerade.com", "sweetstudy.com",
];

// 标题样板信号: 域名变体/镜像站抓不到时兜底
const JUNK_TITLE_RE = [
  /•\s*(instagram|tiktok|threads)/i,          // "... (@handle) • Instagram" 站外镜像标题
  /^pin\d*\s*[·|]|pin on pinterest/i,          // Pinterest 镜像
  /flashcards?\b/i,                            // 卡片背诵站
  /\bquiz\s*(answers?|let)\b/i,                // 题库
  /\b(exam|homework|assignment)\s+answers?\b/i,
];

function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

// 返回 null=非垃圾, 否则返回命中理由字符串(供证据渲染)
export function junkReason(ref) {
  const host = hostOf(ref && ref.url);
  for (const d of JUNK_DOMAINS) {
    if (host === d || host.endsWith("." + d)) return `domain:${d}`;
  }
  const title = (ref && ref.title) || "";
  for (const re of JUNK_TITLE_RE) {
    if (re.test(title)) return `title:${re.source}`;
  }
  return null;
}

export function isJunkPage(ref) {
  return junkReason(ref) !== null;
}
