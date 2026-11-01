/**
 * 缓存 (v0-spec §4.4): SQLite 原文缓存 + 搜索结果缓存
 * 关键设计(dsh[10]): **缓存存原文、focus 读时过滤** — 一页服务多角度查询。
 * node:sqlite 原生模块,零原生编译依赖。
 * v0.5 缓存即搜索面(wigolo[09] Top3 思路): pages 表上挂 FTS5 trigram 倒排索引,
 * 已抓页面变成可搜语料 — 重复查询/全网引擎全灭时秒回本地。
 * trigram tokenizer: 中文按子串命中(≥3 字); <3 字用 LIKE 兜底(searchPages 内部两脚走路)。
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export interface CacheSearchHit {
  url: string;
  title?: string;
  /** 命中段高亮(FTS)或文本开头截段(LIKE) */
  snippet: string;
  /** 命中方式: fts=倒排索引(trigram); like=子串兜底(短 query) */
  via: "fts" | "like";
}

export class Cache {
  #db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.#db = new DatabaseSync(join(dataDir, "cache.db"));
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS pages (
        url TEXT PRIMARY KEY,
        fetched_at INTEGER NOT NULL,
        status INTEGER NOT NULL,
        content_type TEXT,
        title TEXT,
        text TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS search_cache (
        key TEXT PRIMARY KEY,
        fetched_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(title, text, url UNINDEXED, tokenize='trigram');
    `);
    this.#rebuildFtsIfLagging();
  }

  /**
   * 老库升级同步: pages 有行而 FTS 空时全量重建(触发条件: pages>0 且 pages_fts=0)。
   * 手动同步方案(putPage 显式 DELETE+INSERT)不依赖触发器, 避免老库 REPLACE 半路同步的 FTS delete-坑。
   */
  #rebuildFtsIfLagging(): void {
    const p = this.#db.prepare("SELECT COUNT(*) c FROM pages").get() as { c: number };
    const f = this.#db.prepare("SELECT COUNT(*) c FROM pages_fts").get() as { c: number };
    if (p.c > 0 && f.c === 0) {
      this.#db.exec(
        "INSERT INTO pages_fts (title, text, url) SELECT COALESCE(title,''), text, url FROM pages",
      );
    }
  }

  static hash(s: string): string {
    return createHash("sha256").update(s).digest("hex").slice(0, 24);
  }

  // ---------- 页面缓存 ----------

  getPage(url: string, ttlSeconds: number):
    { title?: string; text: string; fetchedAt: number } | null {
    const row = this.#db.prepare("SELECT fetched_at, title, text FROM pages WHERE url = ?").get(url) as
      | { fetched_at: number; title: string | null; text: string } | undefined;
    if (!row) return null;
    if (Date.now() - row.fetched_at > ttlSeconds * 1000) return null;
    return { title: row.title ?? undefined, text: row.text, fetchedAt: row.fetched_at };
  }

  /** 不看 TTL,仅查存在性(用于命中统计) */
  peekPage(url: string): boolean {
    return !!this.#db.prepare("SELECT 1 FROM pages WHERE url = ?").get(url);
  }

  putPage(url: string, status: number, contentType: string | null, title: string | null, text: string): void {
    this.#db.prepare(
      "INSERT OR REPLACE INTO pages (url, fetched_at, status, content_type, title, text) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(url, Date.now(), status, contentType, title, text);
    // v0.5: 同步 FTS(REPLACE = 旧行消失; url 是 UNINDEXED 列, WHERE 全扫对本地页量无感)
    this.#db.prepare("DELETE FROM pages_fts WHERE url = ?").run(url);
    this.#db.prepare("INSERT INTO pages_fts (title, text, url) VALUES (?, ?, ?)").run(title ?? "", text, url);
  }

  /**
   * v0.5 缓存即搜索面: 全文搜已抓页面。
   * 主路 FTS5 trigram(MATCH 短语, rank 排序, snippet 高亮); 兜底 LIKE(短 query/FTS 语法炸)。
   * 空结果不是错误 — 语料里没有就是没有(调用方该走网络引擎)。
   */
  searchPages(query: string, limit = 10): CacheSearchHit[] {
    const q = query.trim();
    if (!q) return [];
    // 主路: trigram 短语匹配(双引号包裹防注入/保留多词短语; 语法错静默落到 LIKE)
    try {
      const rows = this.#db.prepare(
        `SELECT url, title, snippet(pages_fts, 1, '[', ']', '…', 16) AS snip
         FROM pages_fts WHERE pages_fts MATCH ? ORDER BY rank LIMIT ?`,
      ).all(`"${q.replace(/"/g, "\"\"")}"`, limit) as { url: string; title: string | null; snip: string }[];
      if (rows.length > 0) {
        return rows.map((r) => ({ url: r.url, title: r.title ?? undefined, snippet: r.snip, via: "fts" as const }));
      }
    } catch { /* FTS 语法/环境不支持 → LIKE 兜底 */ }
    // 兜底: LIKE 子串(trigram 需要 ≥3 字, 2 字中文/符号串走这里); ESCAPE 防通配符注入
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = this.#db.prepare(
      `SELECT url, title, substr(text, 1, 240) AS snip
       FROM pages WHERE text LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' LIMIT ?`,
    ).all(like, like, limit) as { url: string; title: string | null; snip: string }[];
    return rows.map((r) => ({ url: r.url, title: r.title ?? undefined, snippet: r.snip, via: "like" as const }));
  }

  // ---------- 搜索结果缓存 ----------

  getSearch(key: string, ttlSeconds = 900): unknown | null {
    const row = this.#db.prepare("SELECT fetched_at, payload FROM search_cache WHERE key = ?").get(key) as
      | { fetched_at: number; payload: string } | undefined;
    if (!row) return null;
    if (Date.now() - row.fetched_at > ttlSeconds * 1000) return null;
    try {
      return JSON.parse(row.payload);
    } catch {
      return null;
    }
  }

  putSearch(key: string, payload: unknown): void {
    this.#db.prepare("INSERT OR REPLACE INTO search_cache (key, fetched_at, payload) VALUES (?, ?, ?)")
      .run(key, Date.now(), JSON.stringify(payload));
  }

  // ---------- kv(健康统计/计数器) ----------

  kvGet(key: string): string | null {
    const row = this.#db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  kvSet(key: string, value: string): void {
    this.#db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)").run(key, value);
  }

  kvIncr(key: string, by = 1): number {
    const cur = Number(this.kvGet(key) ?? 0) + by;
    this.kvSet(key, String(cur));
    return cur;
  }

  // ---------- 统计 ----------

  stats(): { pages: number; pageChars: number; searches: number; dbBytes: number } {
    const p = this.#db.prepare("SELECT COUNT(*) c, COALESCE(SUM(LENGTH(text)),0) s FROM pages").get() as { c: number; s: number };
    const s = this.#db.prepare("SELECT COUNT(*) c FROM search_cache").get() as { c: number };
    const kv = this.#db.prepare("SELECT COUNT(*) c FROM kv").get() as { c: number };
    return {
      pages: p.c,
      pageChars: p.s,
      searches: s.c + kv.c, // search_cache + kv
      dbBytes: 0,
    };
  }

  clearSearchCache(): void {
    this.#db.exec("DELETE FROM search_cache");
  }

  close(): void {
    this.#db.close();
  }
}
