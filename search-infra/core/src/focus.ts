/**
 * Focus Fetcher (v0-spec §4.4) — 省 token 主战场
 * - HTML→正文: cheerio 剪枝(script/style/nav/...) + main/article 优先 + 块级换行
 * - 分段: 段落边界 + 句子感知打包 ~300 chars/段
 * - Focus 提取: 命中段 + 邻接段(dsh[10] 方案),idf-lite 词权重
 * - 指标: savedPct (dsh 实测口径 ~90%)
 */
import * as cheerio from "cheerio";
import { tokenize } from "./fusion.js";

const STRIP = "script,style,noscript,svg,iframe,form,template,link,meta,head,footer,nav,aside,header,figure figcaption";
const BLOCK = new Set(["p","div","h1","h2","h3","h4","h5","h6","li","tr","section","article","blockquote","pre","ul","ol","table","figcaption","dl","dt","dd"]);

export interface Extracted {
  title: string;
  text: string;
}

export function extractHtml(html: string): Extracted {
  const $ = cheerio.load(html);
  const title = ($("title").first().text() || "").trim();
  $(STRIP).remove();
  const main = $("article").first().length
    ? $("article").first()
    : $("main").first().length
      ? $("main").first()
      : $("body");
  // 块级元素结尾补换行 — cheerio .text() 会把块级元素粘连成一行
  main.find("*").each((_, el) => {
    if (el.type === "tag" && BLOCK.has((el.tagName ?? "").toLowerCase())) {
      $(el).append("\n");
    }
  });
  $("br").replaceWith("\n");
  const raw = main.text().replace(/\r/g, "");
  const lines = raw.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim());
  const text: string[] = [];
  for (const l of lines) {
    if (l === "") {
      if (text.length && text[text.length - 1] !== "") text.push("");
    } else {
      text.push(l);
    }
  }
  return { title, text: text.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}

/** 把纯文本切成 ~segmentSize 的段(句号/换行优先切) */
export function splitSegments(text: string, segmentSize = 300): string[] {
  const paras = text.split(/\n{2,}/);
  const segments: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf.trim()) segments.push(buf.trim());
    buf = "";
  };
  for (const para of paras) {
    if (para.length <= segmentSize) {
      if ((buf + "\n\n" + para).length > segmentSize) flush();
      buf = buf ? buf + "\n\n" + para : para;
      continue;
    }
    // 长段落: 按句子切
    const sentences = para.split(/(?<=[.!?。！？])\s+/);
    for (const s of sentences) {
      if ((buf + " " + s).length > segmentSize) flush();
      buf = buf ? buf + " " + s : s;
    }
    flush();
  }
  flush();
  return segments;
}

/**
 * Focus 提取: 返回命中段+邻接段,总长受 maxChars 约束
 * @returns segments 数组;无命中时返回 null(调用方降级为头部截断)
 */
export function extractFocus(
  text: string,
  focus: string,
  maxChars = 8000,
  adjacent = 1,
): string[] | null {
  const segments = splitSegments(text);
  if (segments.length === 0) return null;
  const terms = [...new Set(tokenize(focus))];
  if (terms.length === 0) return null;

  // idf-lite: 全局 df 越低的词权重越高
  const df = new Map<string, number>();
  for (const t of terms) {
    let dfc = 0;
    for (const seg of segments) if (seg.toLowerCase().includes(t)) dfc++;
    df.set(t, dfc);
  }
  const weight = (t: string) => 1 + Math.log2(segments.length / Math.max(1, df.get(t)!));

  // 每段得分 = Σ 命中词权重 × 次数
  const scores = segments.map((seg) => {
    const low = seg.toLowerCase();
    let s = 0;
    for (const t of terms) {
      let idx = 0, count = 0;
      while ((idx = low.indexOf(t, idx)) !== -1) {
        count++;
        idx += t.length;
      }
      if (count > 0) s += weight(t) * Math.min(count, 3); // 单词计数封顶,防堆砌
    }
    return s;
  });

  const maxScore = Math.max(...scores);
  if (maxScore <= 0) return null; // 无命中

  // 种子段: 得分最高的前 3 段(去重相邻)
  const order = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
  const picked = new Set<number>();
  for (const { i, s } of order) {
    if (s <= 0) break;
    let covered = false;
    for (const p of picked) if (Math.abs(p - i) <= adjacent) covered = true;
    if (covered && picked.size > 0) continue;
    for (let j = Math.max(0, i - adjacent); j <= Math.min(segments.length - 1, i + adjacent); j++) {
      picked.add(j);
    }
    const total = [...picked].reduce((acc, idx) => acc + segments[idx].length, 0);
    if (total >= maxChars) break;
    if (picked.size >= 24) break;
  }

  const out = [...picked].sort((a, b) => a - b).map((i) => segments[i]);
  // 预算裁剪: 从后往前丢段直到达标(保最相关的种子段在前的组合)
  let total = out.join("\n…\n").length;
  while (total > maxChars && out.length > 1) {
    // 丢分数最低的段
    let minIdx = 0;
    let minScore = Infinity;
    out.forEach((seg, i) => {
      const sc = scores[segments.indexOf(seg)] ?? 0;
      if (sc < minScore) {
        minScore = sc;
        minIdx = i;
      }
    });
    total -= out[minIdx].length;
    out.splice(minIdx, 1);
  }
  return out;
}
