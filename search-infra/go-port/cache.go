package main

// Cache (对齐 TS cache.ts v0.5): SQLite 持久化缓存 — 页面缓存 + 搜索结果缓存 + kv + FTS5 trigram 全文索引
// v0.5 缓存即搜索面(wigolo[09] Top3 思路): pages 表上挂 FTS5 trigram 倒排索引,
// trigram tokenizer: 中文按子串命中(≥3 字); <3 字用 LIKE 兜底(searchPages 内部两脚走路)。
// 引擎: modernc.org/sqlite(纯 Go 零 CGO, 保单静态二进制特性)。

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// CacheSearchHit 对齐 TS CacheSearchHit(via: fts=倒排索引 / like=子串兜底)
type CacheSearchHit struct {
	URL     string  `json:"url"`
	Title   *string `json:"title,omitempty"`
	Snippet string  `json:"snippet"`
	Via     string  `json:"via"`
}

type Cache struct {
	db *sql.DB
}

// OpenCache 打开(或创建)dataDir/cache.db; 建表 + FTS 落后重建
func OpenCache(dataDir string) (*Cache, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", filepath.Join(dataDir, "cache.db"))
	if err != nil {
		return nil, err
	}
	// 单文件本地缓存: 单写连接防 WAL 争用, busy 兜底
	db.SetMaxOpenConns(1)
	c := &Cache{db: db}
	if _, err := db.Exec(`
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
        `); err != nil {
		db.Close()
		return nil, err
	}
	c.rebuildFtsIfLagging()
	return c, nil
}

// rebuildFtsIfLagging 老库升级同步: pages 有行而 FTS 空时全量重建(TS 同款)
func (c *Cache) rebuildFtsIfLagging() {
	var p, f int
	_ = c.db.QueryRow("SELECT COUNT(*) FROM pages").Scan(&p)
	_ = c.db.QueryRow("SELECT COUNT(*) FROM pages_fts").Scan(&f)
	if p > 0 && f == 0 {
		_, _ = c.db.Exec("INSERT INTO pages_fts (title, text, url) SELECT COALESCE(title,''), text, url FROM pages")
	}
}

// CacheHash 对齐 TS Cache.hash: sha256 hex 前 24 位
func CacheHash(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])[:24]
}

// ---------- 页面缓存 ----------

type pageRow struct {
	Title     string
	Text      string
	FetchedAt int64
}

func (c *Cache) GetPage(url string, ttlSeconds int64) *pageRow {
	var row pageRow
	var title sql.NullString
	err := c.db.QueryRow("SELECT fetched_at, title, text FROM pages WHERE url = ?", url).
		Scan(&row.FetchedAt, &title, &row.Text)
	if err != nil {
		return nil
	}
	if time.Now().UnixMilli()-row.FetchedAt > ttlSeconds*1000 {
		return nil
	}
	row.Title = title.String
	return &row
}

func (c *Cache) PutPage(url string, status int, contentType, title, text string) {
	_, _ = c.db.Exec(
		"INSERT OR REPLACE INTO pages (url, fetched_at, status, content_type, title, text) VALUES (?, ?, ?, ?, ?, ?)",
		url, time.Now().UnixMilli(), status, nullStr(contentType), nullStr(title), text)
	// v0.5: 同步 FTS(REPLACE = 旧行消失; url 是 UNINDEXED 列, WHERE 全扫对本地页量无感)
	_, _ = c.db.Exec("DELETE FROM pages_fts WHERE url = ?", url)
	_, _ = c.db.Exec("INSERT INTO pages_fts (title, text, url) VALUES (?, ?, ?)", title, text, url)
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// SearchPages v0.5 缓存即搜索面: 全文搜已抓页面。
// 主路 FTS5 trigram(MATCH 短语, rank 排序, snippet 高亮); 兜底 LIKE(短 query/FTS 语法炸)。
// 空结果不是错误 — 语料里没有就是没有(调用方该走网络引擎)。
func (c *Cache) SearchPages(query string, limit int) []CacheSearchHit {
	q := strings.TrimSpace(query)
	if q == "" {
		return []CacheSearchHit{}
	}
	if limit <= 0 {
		limit = 10
	}
	// 主路: trigram 短语匹配(双引号包裹防注入/保留多词短语; 语法错静默落到 LIKE)
	rows, err := c.db.Query(
		`SELECT url, title, snippet(pages_fts, 1, '[', ']', '…', 16) AS snip
                 FROM pages_fts WHERE pages_fts MATCH ? ORDER BY rank LIMIT ?`,
		`"`+strings.ReplaceAll(q, `"`, `""`)+`"`, limit)
	if err == nil {
		var hits []CacheSearchHit
		for rows.Next() {
			var h CacheSearchHit
			var title sql.NullString
			if rows.Scan(&h.URL, &title, &h.Snippet) == nil {
				h.Title = &title.String
				if !title.Valid {
					h.Title = nil
				}
				h.Via = "fts"
				hits = append(hits, h)
			}
		}
		rows.Close()
		if len(hits) > 0 {
			return hits
		}
	}
	// 兜底: LIKE 子串(trigram 需要 ≥3 字, 2 字中文/符号串走这里); ESCAPE 防通配符注入
	like := "%" + escapeLike(q) + "%"
	rows, err = c.db.Query(
		`SELECT url, title, substr(text, 1, 240) AS snip
                 FROM pages WHERE text LIKE ? ESCAPE '\' OR title LIKE ? ESCAPE '\' LIMIT ?`,
		like, like, limit)
	if err != nil {
		return []CacheSearchHit{}
	}
	defer rows.Close()
	hits := []CacheSearchHit{}
	for rows.Next() {
		var h CacheSearchHit
		var title sql.NullString
		if rows.Scan(&h.URL, &title, &h.Snippet) == nil {
			if title.Valid {
				t := title.String
				h.Title = &t
			}
			h.Via = "like"
			hits = append(hits, h)
		}
	}
	return hits
}

func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

// ---------- 搜索结果缓存 ----------

func (c *Cache) GetSearch(key string, ttlSeconds int64) []byte {
	var payload string
	var fetchedAt int64
	err := c.db.QueryRow("SELECT fetched_at, payload FROM search_cache WHERE key = ?", key).
		Scan(&fetchedAt, &payload)
	if err != nil {
		return nil
	}
	if time.Now().UnixMilli()-fetchedAt > ttlSeconds*1000 {
		return nil
	}
	return []byte(payload)
}

func (c *Cache) PutSearch(key string, payload []byte) {
	_, _ = c.db.Exec("INSERT OR REPLACE INTO search_cache (key, fetched_at, payload) VALUES (?, ?, ?)",
		key, time.Now().UnixMilli(), string(payload))
}

// ---------- kv(健康统计/计数器) ----------

func (c *Cache) KvGet(key string) (string, bool) {
	var v string
	err := c.db.QueryRow("SELECT value FROM kv WHERE key = ?", key).Scan(&v)
	if err != nil {
		return "", false
	}
	return v, true
}

func (c *Cache) KvSet(key, value string) {
	_, _ = c.db.Exec("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", key, value)
}

func (c *Cache) KvIncr(key string, by int) int {
	cur := 0
	if v, ok := c.KvGet(key); ok {
		if n, err := strconv.Atoi(v); err == nil {
			cur = n
		}
	}
	cur += by
	c.KvSet(key, strconv.Itoa(cur))
	return cur
}

// ---------- 统计 ----------

type CacheStats struct {
	Pages     int   `json:"pages"`
	PageChars int64 `json:"pageChars"`
	Searches  int   `json:"searches"`
	DbBytes   int64 `json:"dbBytes"`
}

func (c *Cache) Stats() CacheStats {
	var s CacheStats
	_ = c.db.QueryRow("SELECT COUNT(*), COALESCE(SUM(LENGTH(text)),0) FROM pages").Scan(&s.Pages, &s.PageChars)
	var sc, kv int
	_ = c.db.QueryRow("SELECT COUNT(*) FROM search_cache").Scan(&sc)
	_ = c.db.QueryRow("SELECT COUNT(*) FROM kv").Scan(&kv)
	s.Searches = sc + kv
	if st, err := os.Stat(filepath.Join(c.dataDirHint(), "cache.db")); err == nil {
		s.DbBytes = st.Size()
	}
	return s
}

func (c *Cache) dataDirHint() string {
	// db path 由 OpenCache 固定, 这里从 PRAGMA 反查不可行 — 简化: 由调用方配置
	return dataDir()
}

// cacheStatsSnapshot 三出口共用的缓存语料快照(CLI stats / MCP cache_stats / REST /stats)。
// OpenCache 失败时降级为 error 字段, 不阻塞健康面输出 — stats 面永远可用。
func cacheStatsSnapshot() map[string]any {
	c, err := OpenCache(dataDir())
	if err != nil {
		return map[string]any{"error": err.Error()}
	}
	defer c.Close()
	s := c.Stats()
	return map[string]any{
		"pages":     s.Pages,
		"pageChars": s.PageChars,
		"searches":  s.Searches,
		"dbBytes":   s.DbBytes,
	}
}

func (c *Cache) ClearSearchCache() {
	_, _ = c.db.Exec("DELETE FROM search_cache")
}

func (c *Cache) Close() {
	_ = c.db.Close()
}

var _ = fmt.Sprintf
var _ = json.Marshal
