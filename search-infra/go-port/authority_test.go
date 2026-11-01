package main

import (
	"strings"
	"testing"
)

// ---------- 权威三层 ----------
func TestDetectCategoryLongestWins(t *testing.T) {
	// phase AI 案例: "world bank open data gdp api" 应归 data(gdp 被 data 的更长锚压过)
	if c := detectCategory("world bank open data gdp api"); c != "data" {
		t.Fatalf("want data, got %s", c)
	}
	// 裸 sql → databases; "sql 注入" 更长 → security
	if c := detectCategory("sql 优化"); c != "databases" {
		t.Fatalf("sql 优化 want databases, got %s", c)
	}
	if c := detectCategory("sql 注入 payload"); c != "security" {
		t.Fatalf("sql 注入 want security, got %s", c)
	}
	if c := detectCategory("docker compose restart policy"); c != "" {
		t.Fatalf("non-category query want empty, got %s", c)
	}
}

func TestDetectCommunityIntent(t *testing.T) {
	if !detectCommunityIntent("rust 开发者怎么看") || !detectCommunityIntent("thoughts on this framework") {
		t.Fatal("community intent positives failed")
	}
	if detectCommunityIntent("rust 官方文档") {
		t.Fatal("factual query must not trip community intent")
	}
}

func TestMatchAuthoritySubdomainExact(t *testing.T) {
	if matchAuthority("https://en.wikipedia.org/wiki/X") != "wikipedia.org" {
		t.Fatal("subdomain must match")
	}
	if matchAuthority("https://notwikipedia.org/") != "" {
		t.Fatal("lookalike domain must not match (伪装域不命中)")
	}
}

func TestMatchTopicAuthorityLangGuardAndCommunityFlip(t *testing.T) {
	// zh 条目在 en 查询下不生效; en 查询零误伤
	// 社区意图: kind=community 条目升 1.2
	// TS 回归锁: matchTopicAuthority(github, communityIntent) 仍是 0.75 — 翻转只认【显式】kind=community
	hit := matchTopicAuthority("https://github.com/foo/bar", "programming", "en", true)
	if hit != nil && hit.Entry.Kind == "" && hit.Boost != 0.75 {
		t.Fatalf("non-community-kind entry must keep base boost 0.75, got %v", hit.Boost)
	}
	// 合成 community 条目验证翻转路径(经 SC_AUTHORITY_JSON 外挂)
	mergeExternalAuthority(`{"topics":{"programming":[{"domain":"synthetic.example","tier":"b","kind":"community"}]}}`)
	flipped := matchTopicAuthority("https://synthetic.example/post", "programming", "en", true)
	if flipped == nil || flipped.Boost < 1.2 {
		t.Fatalf("explicit community entry must flip to >=1.2, got %v", flipped)
	}
	notFlipped := matchTopicAuthority("https://synthetic.example/post", "programming", "en", false)
	if notFlipped == nil || notFlipped.Boost != 0.4 {
		t.Fatalf("without community intent must stay b=0.4, got %v", notFlipped)
	}
}

func TestKeyTermPresentGuard(t *testing.T) {
	// asyncio MDN 错页案例: 页面零查询 token → false(提权清零)
	if keyTermPresent("python asyncio 教程", "https://developer.mozilla.org/zh-CN/docs/Web/CSS", "CSS 教程", "样式") {
		t.Fatal("off-topic page must fail keyTermPresent")
	}
	// 正主页: 最长 ASCII 锚命中 → true
	if !keyTermPresent("docker compose restart policy", "https://docs.docker.com/compose/", "compose restart", "restart policy") {
		t.Fatal("on-topic page must pass")
	}
	// 多证据放行: 长锚缺席但 ≥2 token 命中
	if !keyTermPresent("rust async tokio runtime", "https://example.com/tokio-guide", "tokio runtime guide", "async runtime") {
		t.Fatal("multi-evidence pass failed")
	}
}

// ---------- spam 双档 ----------
func TestSpamBlockedRemoval(t *testing.T) {
	// credibility.json 的 blocked 表按数据驱动; 至少验证匹配逻辑本身
	if len(spamBlockedDomains) == 0 {
		t.Skip("blocked 表为空跳过(数据驱动)")
	}
	d := spamBlockedDomains[0]
	if matchSpamList("https://www."+d+"/x", spamBlockedDomains) == "" {
		t.Fatalf("subdomain of %s must match", d)
	}
}

// ---------- 语义去重 + domainCap ----------
func TestFuseSemanticDedupAndCap(t *testing.T) {
	lanes := []laneResult{
		{Name: "t1", Refs: []Reference{
			{URL: "https://a.example/1", Title: "tokio async runtime guide", Snippet: "how to use tokio runtime", Engines: []string{"t1"}},
			{URL: "https://a.example/2", Title: "tokio async runtime guide", Snippet: "how to use tokio runtime (copy)", Engines: []string{"t1"}},
			{URL: "https://a.example/3", Title: "third page", Snippet: "different content entirely", Engines: []string{"t1"}},
			{URL: "https://a.example/4", Title: "fourth page", Snippet: "more unique text here", Engines: []string{"t1"}},
			{URL: "https://a.example/5", Title: "fifth page", Snippet: "yet another page body", Engines: []string{"t1"}},
		}},
	}
	refs, meta := fuseSemantic(lanes, fuseOpts{query: "tokio async runtime", topN: 20, domainCap: 3}, 20)
	// 近重复对(t1/t2 TF 向量近似)应被合并
	if meta.DedupMerged == 0 {
		t.Fatalf("near-duplicate should merge: %d refs %v", len(refs), refs)
	}
	// domainCap=3: 同域 a.example 最多 3 条
	domCount := 0
	for _, r := range refs {
		if strings.HasPrefix(r.URL, "https://a.example/") {
			domCount++
		}
	}
	if domCount > 3 {
		t.Fatalf("domainCap 3 breached: %d", domCount)
	}
}

func TestFuseSemanticSpamBlock(t *testing.T) {
	if len(spamBlockedDomains) == 0 {
		t.Skip("blocked 表为空跳过")
	}
	d := spamBlockedDomains[0]
	lanes := []laneResult{
		{Name: "t1", Refs: []Reference{
			{URL: "https://" + d + "/spam", Title: "spam page tokio", Snippet: "tokio tokio tokio", Engines: []string{"t1"}},
			{URL: "https://ok.example/1", Title: "clean page tokio", Snippet: "tokio runtime", Engines: []string{"t1"}},
		}},
	}
	refs, meta := fuseSemantic(lanes, fuseOpts{query: "tokio", topN: 20, domainCap: 3}, 20)
	if meta.SpamBlocked != 1 {
		t.Fatalf("spam must be blocked: %d", meta.SpamBlocked)
	}
	for _, r := range refs {
		if strings.Contains(r.URL, d) {
			t.Fatal("blocked domain must not survive")
		}
	}
}

func TestRegistrableDomainTwoLevel(t *testing.T) {
	if registrableDomain("sports.yahoo.co.jp") != "yahoo.co.jp" {
		t.Fatal("two-level TLD must take 3 segments")
	}
	if registrableDomain("en.wikipedia.org") != "wikipedia.org" {
		t.Fatal("normal domain must take 2 segments")
	}
	if registrableDomain("www.example.com") != "example.com" {
		t.Fatal("www must be stripped")
	}
}

func TestRankIsOneBased(t *testing.T) {
	// P1 口径差修正: TS rankInEngine 从 1 起 → RRF=1/(60+1)
	lanes := []laneResult{
		{Name: "e1", Refs: []Reference{{URL: "https://x.example/1", Title: "t", Snippet: "s", Engines: []string{"e1"}}}},
	}
	lanes[0].Refs[0].Title = "tokio guide"
	lanes[0].Refs[0].Snippet = "async runtime"
	refs, _ := fuseSemantic(lanes, fuseOpts{query: "tokio", topN: 20}, 20)
	if len(refs) != 1 {
		t.Fatal("want 1 ref")
	}
	// score = 1/61*10(0.16393) + lex 1.5(tokio 命中) + titleBonus 0.25 = 1.91393
	if refs[0].Score < 1.91 || refs[0].Score > 1.92 {
		t.Fatalf("one-based RRF score mismatch: %v", refs[0].Score)
	}
}
