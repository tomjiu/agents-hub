/**
 * Embedding (v0.2) — Perplexica[12] 双阈值方案的底座
 * 证据: reports/12-perplexica.md — "speed 模式下用 embedding 余弦相似度做 snippet 过滤(>0.5)
 *       + 跨源去重(>0.75),不需要 rerank 模型";失败降级 similarity=1 原样放行(baseSearch.ts:73-86)。
 *
 * 两个实现:
 *  - TfEmbedder (默认): 纯 TS hash trick TF 向量(词 + CJK 字符 bigram),零依赖零网络零 key。
 *    对"同故事不同 URL 的转载/改写"类去重足够;语义理解弱于真模型,但失败模式安全。
 *  - OpenAIEmbedder (可选): OpenAI 兼容 /v1/embeddings(SC_EMBEDDING_BASE_URL/MODEL/API_KEY),
 *    配了就用,失败自动回落 TfEmbedder(绝不阻塞主链路)。
 */

export interface Embedder {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

const DIM = 512;

/** FNV-1a 32bit → 桶下标 */
function bucket(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % DIM;
}

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/;

/** 词级 token;CJK 连续段额外拆 bigram(词表无关的中文近似分词) */
export function embedTokens(s: string): string[] {
  const out: string[] = [];
  const runs = s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const run of runs) {
    if (CJK.test(run)) {
      const chars = [...run];
      out.push(run); // 整词保底
      for (let i = 0; i < chars.length - 1; i++) out.push(chars[i] + chars[i + 1]);
    } else {
      out.push(run);
    }
  }
  return out;
}

/** hash-TF 向量,L2 归一化 */
export function tfVector(s: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  const toks = embedTokens(s);
  if (toks.length === 0) return v;
  for (const t of toks) v[bucket(t)] += 1;
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return Math.max(-1, Math.min(1, dot));
}

export class TfEmbedder implements Embedder {
  readonly name = "tf-hash";
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(tfVector);
  }
}

export class OpenAIEmbedder implements Embedder {
  readonly name: string;
  #baseUrl: string;
  #apiKey: string;
  #model: string;
  #timeoutMs: number;
  #fetchImpl: typeof fetch;

  constructor(opts: { baseUrl: string; apiKey?: string; model: string; timeoutMs?: number; fetchImpl?: typeof fetch }) {
    this.#baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.#apiKey = opts.apiKey ?? "";
    this.#model = opts.model;
    this.#timeoutMs = opts.timeoutMs ?? 15000;
    this.#fetchImpl = opts.fetchImpl ?? fetch;
    this.name = `openai:${opts.model}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await this.#fetchImpl(`${this.#baseUrl}/embeddings`, {
      method: "POST",
      signal: AbortSignal.timeout(this.#timeoutMs),
      headers: {
        "Content-Type": "application/json",
        ...(this.#apiKey ? { Authorization: `Bearer ${this.#apiKey}` } : {}),
      },
      body: JSON.stringify({ model: this.#model, input: texts }),
    });
    if (!res.ok) throw new Error(`embedding api http ${res.status}`);
    const json = (await res.json()) as { data?: { embedding: number[]; index: number }[] };
    const data = json.data ?? [];
    if (data.length !== texts.length) throw new Error(`embedding api returned ${data.length}/${texts.length}`);
    return data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

/**
 * 带回落的选择器: 配了 OpenAI 兼容端点就用它,首次调用失败永久回落 TF
 * (Perplexica[12]: embedding 失败 → similarity=1 放行;我们回落到本地 TF,语义更强)。
 */
export class FallbackEmbedder implements Embedder {
  readonly name: string;
  #primary?: Embedder;
  #fallback = new TfEmbedder();
  #dead = false;
  #init: () => Embedder | undefined;

  constructor(primaryFactory?: () => Embedder | undefined) {
    this.#init = primaryFactory ?? (() => undefined);
    this.name = "auto";
  }

  private pick(): Embedder {
    if (this.#dead || !this.#primary) {
      if (!this.#dead && !this.#primary) this.#primary = this.#init();
      if (!this.#primary || this.#dead) return this.#fallback;
    }
    return this.#primary;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const p = this.pick();
    if (p === this.#fallback) return this.#fallback.embed(texts);
    try {
      return await p.embed(texts);
    } catch {
      this.#dead = true; // 主 embedder 不可用 → 本次进程内不再重试
      return this.#fallback.embed(texts);
    }
  }
}

export const TF_EMBEDDER = new TfEmbedder();
