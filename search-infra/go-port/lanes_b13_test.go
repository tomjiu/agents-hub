package main

// 批 13 (修复批)测试: 8 车道意图词剥离 — 题面取自全领域评测 8 真空洞域 16 题
// (scripts/eval-domain-cases.mjs), 断言剥后词面而非上游响应(实弹由 eval-b13-verify.mjs 承担)。

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"
)

// TestB13StripIntent 16 验收题剥后词面锁定(0/16→≥10/16 的前置: 词面必须正确)
func TestB13StripIntent(t *testing.T) {
	cases := []struct {
		name string
		re   func(string) string
		in   string
		want string
	}{
		// tv (tvmaze)
		{"tv-en", func(q string) string { return b13StripIntent(q, b13TVIntentRe) }, "breaking bad tv series seasons how many", "breaking bad"},
		{"tv-zh", func(q string) string { return b13StripIntent(q, b13TVIntentRe) }, "权力的游戏 剧集 第几季", "权力的游戏"},
		// games (steam)
		{"games-en", func(q string) string { return b13StripIntent(q, b13GamesIntentRe) }, "best pc game deal on steam", "steam"},
		{"games-zh", func(q string) string { return b13StripIntent(q, b13GamesIntentRe) }, "steam 游戏 打折 买游戏", "steam"},
		// manga (mangadex)
		{"manga-en", func(q string) string { return b13StripIntent(q, b13MangaIntentRe) }, "one piece manga latest chapter", "one piece"},
		{"manga-zh", func(q string) string { return b13StripIntent(q, b13MangaIntentRe) }, "葬送的芙莉莲 漫画 连载", "葬送的芙莉莲"},
		// sport (thesportsdb)
		{"sport-en", func(q string) string { return b13StripIntent(q, b13SportIntentRe) }, "NBA team lakers roster profile", "NBA lakers"},
		// drinks (thecocktaildb)
		{"drinks-en", func(q string) string { return b13StripIntent(q, b13DrinksIntentRe) }, "mojito cocktail recipe ingredients", "mojito"},
		{"drinks-zh", func(q string) string { return b13StripIntent(q, b13DrinksIntentRe) }, "玛格丽特 调酒配方 基酒", "玛格丽特"},
		// space (thespacedevs)
		{"space-en", b13SpaceQuery, "SpaceX falcon 9 next rocket launch", "SpaceX falcon 9"},
		{"space-zh-alias", b13SpaceQuery, "长征五号 火箭 发射任务 计划", "Long March 5"},
		// books (standardebooks)
		{"books-en", func(q string) string { return b13StripIntent(q, b13BooksIntentRe) }, "pride and prejudice public domain ebook", "pride and prejudice"},
		// geo (nominatim)
		{"geo-en", func(q string) string { return b13StripIntent(q, b13GeoIntentRe) }, "where is Eiffel Tower coordinates", "Eiffel Tower"},
		{"geo-zh", func(q string) string { return b13StripIntent(q, b13GeoIntentRe) }, "西湖 在哪 位置 坐标", "西湖"},
	}
	for _, c := range cases {
		if got := c.re(c.in); got != c.want {
			t.Errorf("%s: b13Strip(%q) = %q, want %q", c.name, c.in, got, c.want)
		}
	}
}

// TestB13StripAllGone 防呆: 纯意图词查询在其所属域正则下剥光=空串, 调用方不重查
func TestB13StripAllGone(t *testing.T) {
	cases := []struct {
		re *regexp.Regexp
		in string
	}{
		{b13GamesIntentRe, "游戏"},                      // 纯意图词
		{b13GamesIntentRe, "打折 推荐"},                   // 纯意图词
		{b13SpaceIntentRe, "launch"},                  // 纯意图词
		{b13DrinksIntentRe, "recipe ingredients"},     // 纯意图词
		{b13TVIntentRe, "tv series seasons how many"}, // 纯意图词
	}
	for _, c := range cases {
		if s := b13StripIntent(c.in, c.re); s != "" {
			t.Errorf("b13Strip(%q) = %q, want 空串(纯意图词应剥光)", c.in, s)
		}
	}
	// 纯实体词不应被误剥
	if s := b13StripIntent("breaking bad", b13TVIntentRe); s != "breaking bad" {
		t.Errorf("实体词被误剥: %q", s)
	}
}

// TestB13RocketAlias 中文火箭别名表
func TestB13RocketAlias(t *testing.T) {
	for zh, en := range map[string]string{
		"长征五号": "Long March 5", "猎鹰九号": "Falcon 9", "星舰": "Starship", "联盟号": "Soyuz",
	} {
		if got := b13RocketAlias[zh]; got != en {
			t.Errorf("b13RocketAlias[%s] = %s, want %s", zh, got, en)
		}
	}
	if s := b13SpaceQuery("星舰 发射计划"); s != "Starship" {
		t.Errorf("b13SpaceQuery(星舰 发射计划) = %q, want Starship", s)
	}
	if s := b13SpaceQuery("发射 计划"); s != "" {
		t.Errorf("全意图词查询应返回空串防呆, got %q", s)
	}
}

// TestB13StripIntentNoCrossContamination 词面互不污染: 各域实体词在异域正则下不误剥
func TestB13StripIntentNoCrossContamination(t *testing.T) {
	// "权力的游戏" 含"游戏"但 tv 正则不剥它; "长征五号" 不含 space 英文意图词
	if s := b13StripIntent("权力的游戏", b13TVIntentRe); s != "权力的游戏" {
		t.Errorf("tv 正则误剥实体词: %q", s)
	}
	// books 实体 "pride and prejudice" 无 books 意图词残留
	if s := b13StripIntent("pride and prejudice", b13BooksIntentRe); s != "pride and prejudice" {
		t.Errorf("books 正则误剥实体词: %q", s)
	}
}

// TestB13P1Strips P1/P2 域剥词面锁定(评测 §2 偏科/§5 P2 原题)
func TestB13P1Strips(t *testing.T) {
	cases := []struct {
		name string
		re   *regexp.Regexp
		in   string
		want string
	}{
		{"music-zh", b13MusicIntentRe, "周杰伦 晴天 专辑 这首歌", "周杰伦 晴天"},
		{"browserext-zh", b13BrowserExtIntentRe, "firefox 扩展 广告拦截 推荐", "广告拦截"},
		{"browserext-en", b13BrowserExtIntentRe, "firefox extension ad blocker addon", "ad blocker"},
		{"drug-en", b13DrugIntentRe, "ibuprofen drug label dosage", "ibuprofen"},
		{"drug-zh", b13DrugIntentRe, "阿司匹林 适应症 剂量 药品说明书", "阿司匹林"},
		{"anime-en", b13AnimeIntentRe, "best anime 2024 recommendations", ""},
		{"anime-zh", b13AnimeIntentRe, "进击的巨人 动漫 追番 推荐", "进击的巨人"},
	}
	for _, c := range cases {
		if got := b13StripIntent(c.in, c.re); got != c.want {
			t.Errorf("%s: b13Strip(%q) = %q, want %q", c.name, c.in, got, c.want)
		}
	}
}

// TestB13SpeciesQuery 中文明星物种别名(实弹取证: taxa 索引不含中文, q=大熊猫 返回蕨类兜底)
func TestB13SpeciesQuery(t *testing.T) {
	if got := b13SpeciesQuery("大熊猫 学名 分类学"); got != "Giant Panda" {
		t.Errorf("b13SpeciesQuery(大熊猫 学名 分类学) = %q, want Giant Panda", got)
	}
	if got := b13SpeciesQuery("falcon taxonomy scientific name"); got != "falcon" {
		t.Errorf("英文词面不应受别名表影响: %q", got)
	}
	if got := b13SpeciesQuery("学名 分类学"); got != "" {
		t.Errorf("纯意图词应剥光防呆: %q", got)
	}
}

// TestB13MusicReorder 原唱优先重排(title 含 "标题 — 歌手" 形, 歌手词面匹配者提前)
func TestB13MusicReorder(t *testing.T) {
	mk := func(title string) Reference {
		return Reference{Title: title, Engines: []string{"musicbrainz"}}
	}
	in := []Reference{mk("晴天 — 翻唱歌手X"), mk("晴天 — 周杰伦"), mk("晴天 — 翻唱歌手Y")}
	out := b13MusicReorder(in, "周杰伦 晴天")
	if out[0].Title != "晴天 — 周杰伦" {
		t.Errorf("原唱未提前: %s", out[0].Title)
	}
	if len(out) != 3 {
		t.Errorf("重排丢条目: %d", len(out))
	}
	if out := b13MusicReorder(in, "Jay Chou bohemian"); !strings.HasPrefix(out[0].Title, "晴天 — 翻唱歌手X") {
		t.Errorf("无 CJK 歌手词面时应保持原序: %s", out[0].Title)
	}
}

// TestB13WbClaimValue claims 值解析: 实体型→QID, 时间型→日期
func TestB13WbClaimValue(t *testing.T) {
	if qid, _ := b13WbClaimValue(json.RawMessage(`{"entity-type":"item","id":"Q7279805"}`)); qid != "Q7279805" {
		t.Errorf("实体型 QID 解析: %q", qid)
	}
	if _, tv := b13WbClaimValue(json.RawMessage(`{"time":"+1944-10-25T00:00:00Z","precision":11}`)); tv != "1944-10-25" {
		t.Errorf("时间型解析: %q", tv)
	}
	if q, v := b13WbClaimValue(json.RawMessage(`{"bad":1}`)); q != "" || v != "" {
		t.Errorf("未知类型应双空: %q/%q", q, v)
	}
}

// TestB13QIDExtract wikidata title 尾部 QID 提取
func TestB13QIDExtract(t *testing.T) {
	if m := b13QIDRe.FindStringSubmatch("Huawei (Q160120)"); m == nil || m[1] != "Q160120" {
		t.Errorf("QID 提取失败: %v", m)
	}
	if m := b13QIDRe.FindStringSubmatch("Huawei (Q160120) something"); m != nil {
		t.Errorf("非尾部 QID 不应命中: %v", m)
	}
}

// ---------- b16 泛化探针: 实体直答意图感知化 + quantity + 年份剥词 ----------

// TestB13QueryIntentPID 意图词→PID 映射(通用规则, 8 条答案意图)
func TestB13QueryIntentPID(t *testing.T) {
	cases := []struct {
		q, pid string
	}{
		{"特斯拉 创始人 是谁", "P112"},
		{"founder of linux", "P112"},
		{"capital of Australia population", "P36"}, // 表序 capital 先于 population
		{"日本 人口", "P1082"},
		{"population of Japan 2024", "P1082"},
		{"公司 总部在哪里", "P159"},
		{"linus torvalds", ""}, // 无意图词 → top-1 原路径
		{"华为 公司 怎么样", ""},      // 无答案意图词
	}
	for _, c := range cases {
		if got := b13QueryIntentPID(c.q); got != c.pid {
			t.Errorf("b13QueryIntentPID(%q)=%q want %q", c.q, got, c.pid)
		}
	}
}

// TestB13WbClaimValueQuantity b16 补 P1082 quantity 值解析(此前静默丢弃)
func TestB13WbClaimValueQuantity(t *testing.T) {
	if _, tv := b13WbClaimValue(json.RawMessage(`{"amount":"+125800000","unit":"1"}`)); tv != "125,800,000" {
		t.Errorf("quantity 千分位解析: %q", tv)
	}
	if _, tv := b13WbClaimValue(json.RawMessage(`{"amount":"-42","unit":"1"}`)); tv != "-42" {
		t.Errorf("负数解析: %q", tv)
	}
	if _, tv := b13WbClaimValue(json.RawMessage(`{"amount":"+3.9","unit":"1"}`)); tv != "3.9" {
		t.Errorf("小数原样: %q", tv)
	}
}

// TestB13FormatInt 千分位格式化
func TestB13FormatInt(t *testing.T) {
	cases := map[int64]string{125800000: "125,800,000", 1234: "1,234", 999: "999", -1234567: "-1,234,567", 0: "0"}
	for n, want := range cases {
		if got := b13FormatInt(n); got != want {
			t.Errorf("b13FormatInt(%d)=%q want %q", n, got, want)
		}
	}
}
