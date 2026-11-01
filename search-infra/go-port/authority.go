package main

// 域名权威体系 v3 (对齐 TS core/src/authority.ts, phase AC 全量)
// 三层数据 + 分档权重 + 意图感知; 表数据外置(data/authority/*.json 与 TS 共用单一真源, go:embed 进单二进制)。
// 分档换算: s=+1.2 / a=+0.75 / b=+0.4; 三层取最强计一次分(max-not-sum); zh 条目 lang 守卫;
// 社区意图翻转: kind=community 条目升 1.2 档(官方档不动)。

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

//go:embed data/authority/global.json
var globalJSON []byte

//go:embed data/authority/topics.json
var topicsJSON []byte

//go:embed data/authority/categories.json
var categoriesJSON []byte

type AuthorityEntry struct {
	Domain string `json:"domain"`
	Tier   string `json:"tier"` // "s" | "a" | "b"
	Lang   string `json:"lang,omitempty"`
	Kind   string `json:"kind,omitempty"` // official/community/media/expert/reference
}

var domainShapeRe = regexp.MustCompile(`^[a-z0-9.-]+\.[a-z-]{2,}$`)

var tierBoost = map[string]float64{"s": 1.2, "a": 0.75, "b": 0.4}

const communityIntentBoost = 1.2 // 社区意图下 kind=community 的条目提到此档(=s)

// ---------- 加载与消毒(坏条目跳过; 宁弱勿错: 非法 tier 落 b) ----------
func sanitizeDomains(raw []any) []string {
	out := []string{}
	for _, d := range raw {
		s := strings.ToLower(strings.TrimSpace(fmt.Sprintf("%v", d)))
		if !domainShapeRe.MatchString(s) {
			continue
		}
		out = append(out, s)
	}
	return out
}

func sanitizeEntries(raw []any) []AuthorityEntry {
	out := []AuthorityEntry{}
	for _, r := range raw {
		m, ok := r.(map[string]any)
		if !ok {
			continue
		}
		domain := strings.ToLower(strings.TrimSpace(str(m["domain"])))
		if !domainShapeRe.MatchString(domain) {
			continue
		}
		tier := "b"
		if m["tier"] == "s" || m["tier"] == "a" {
			tier = str(m["tier"])
		}
		e := AuthorityEntry{Domain: domain, Tier: tier}
		if m["lang"] == "zh" {
			e.Lang = "zh"
		}
		switch m["kind"] {
		case "official", "community", "media", "expert", "reference":
			e.Kind = str(m["kind"])
		}
		out = append(out, e)
	}
	return out
}

func str(v any) string {
	if v == nil {
		return ""
	}
	return fmt.Sprintf("%v", v)
}

func loadEntryTable(data []byte, key string) map[string][]AuthorityEntry {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(data, &m); err != nil {
		return map[string][]AuthorityEntry{}
	}
	var raw map[string][]any
	if err := json.Unmarshal(m[key], &raw); err != nil {
		return map[string][]AuthorityEntry{}
	}
	out := map[string][]AuthorityEntry{}
	for k, list := range raw {
		out[k] = sanitizeEntries(list)
	}
	return out
}

// ---------- 第 0 层: 全局表(学术+wiki 兜底) ----------
var authorityDomains = func() []string {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(globalJSON, &m); err != nil {
		return []string{}
	}
	var domains []any
	if err := json.Unmarshal(m["domains"], &domains); err != nil {
		return []string{}
	}
	return sanitizeDomains(domains)
}()

func matchAuthority(u string) string {
	return matchAuthorityIn(u, authorityDomains)
}

func matchAuthorityIn(u string, table []string) string {
	host := hostOf(u)
	if host == "" {
		return ""
	}
	for _, d := range table {
		if host == d || strings.HasSuffix(host, "."+d) {
			return d
		}
	}
	return ""
}

// ---------- 第 1 层: 主题表(域路由命中 topic 时生效) ----------
var topicAuthority = loadEntryTable(topicsJSON, "topics")

// ---------- 第 2 层: 意图表(不改路由, 融合期按意图类别提权) ----------
var categoryAuthority = loadEntryTable(categoriesJSON, "categories")

// ---------- 意图检测(纯函数, 融合前对原查询跑一次; 关键词逐字对齐 TS) ----------
var categoryKeywords = map[string][]string{
	"news": {"最新消息", "最新新闻", "新闻", "发布会", "breaking", "latest news", "news", "外媒报道", "时事"},
	"security": {"漏洞", "cve", "exploit", "安全通告", "勒索", "渗透", "攻击样本", "vulnerability", "ransomware",
		"sql 注入", "xss"},
	"legal": {"法律", "法规", "条文", "判例", "司法解释", "合同条款", "劳动合同", "statute", "regulation", "case law",
		"规定", "条例", "个人信息保护"},
	"finance": {"股市", "央行", "利率", "财报", "ipo", "基金", "汇率", "通胀", "gdp", "货币政策", "stock market", "inflation", "monetary policy",
		"interest rate", "rate decision", "central bank"},
	"medical": {"症状", "药物", "治疗", "剂量", "副作用", "诊断", "处方", "symptoms", "dosage", "diagnosis", "treatment",
		"side effect", "medication", "肠溶", "缓释",
		"疫苗", "抗生素", "降压药", "胰岛素", "阿司匹林", "布洛芬", "二甲双胍", "过敏",
		"vaccine", "aspirin", "ibuprofen", "metformin", "insulin"},
	"databases": {"数据库", "向量库", "向量数据库", "sql 优化", "nosql", "database", "索引优化", "查询优化",
		"collation", "sql", "mysql", "postgres", "mongodb", "redis", "sqlite"},
	"design": {"组件库", "图标", "icon", "logo", "配色", "设计系统", "ui 库", "ui kit", "字体", "设计规范", "design system", "插画素材",
		"design token", "figma", "wireframe", "mockup"},
	"education":  {"公开课", "mooc", "网课", "课程推荐", "online course", "academy"},
	"dictionary": {"词典", "释义", "词源", "单词意思", "例句", "definition", "etymology"},
	"data":       {"统计数据", "开放数据", "数据集", "dataset", "统计年鉴", "open data", "statistics"},
}

// 意图检测顺序 = 表序(同长保表序, 严格 > 使首类胜出)
var categoryKeywordOrder = []string{
	"news", "security", "legal", "finance", "medical", "databases", "design", "education", "dictionary", "data",
}

var communityHints = []string{
	"讨论", "怎么看", "怎么看待", "大家怎么", "观点", "争议", "吐槽", "评价", "使用体验", "优缺点",
	"discussion", "opinions", "what do you think", "thoughts on", "experiences with", "hacker news", "reddit",
}

func detectCommunityIntent(query string) bool {
	low := " " + strings.ToLower(query) + " "
	for _, h := range communityHints {
		if strings.Contains(low, h) {
			return true
		}
	}
	return false
}

// detectCategory: 多类命中取【最长关键词】所属类; 同长保表序(严格 >); 未命中 ""
func detectCategory(query string) string {
	low := " " + strings.ToLower(query) + " "
	bestCat, bestLen := "", 0
	for _, cat := range categoryKeywordOrder {
		clsLen := 0
		for _, k := range categoryKeywords[cat] {
			if len(k) > clsLen && strings.Contains(low, strings.ToLower(k)) {
				clsLen = len(k)
			}
		}
		if clsLen > bestLen { // 严格 >: 同长首类胜出
			bestCat, bestLen = cat, clsLen
		}
	}
	return bestCat
}

// ---------- 匹配函数(lang 守卫 + 社区意图翻转) ----------
func matchEntry(e AuthorityEntry, host string) bool {
	d := strings.ToLower(e.Domain)
	return host == d || strings.HasSuffix(host, "."+d)
}

type authorityHit struct {
	Domain string
	Boost  float64
	Entry  AuthorityEntry
}

func matchTableAuthority(u, tableKey string, table map[string][]AuthorityEntry, lang string, communityIntent bool) *authorityHit {
	host := hostOf(u)
	if host == "" {
		return nil
	}
	for _, entry := range table[tableKey] {
		if entry.Lang == "zh" && lang != "zh" {
			continue
		}
		if !matchEntry(entry, host) {
			continue
		}
		base := tierBoost[entry.Tier]
		boost := base
		if communityIntent && entry.Kind == "community" {
			boost = maxF(base, communityIntentBoost)
		}
		return &authorityHit{Domain: entry.Domain, Boost: boost, Entry: entry}
	}
	return nil
}

func matchTopicAuthority(u, topic, lang string, communityIntent bool) *authorityHit {
	return matchTableAuthority(u, topic, topicAuthority, lang, communityIntent)
}

func matchCategoryAuthority(u, category, lang string, communityIntent bool) *authorityHit {
	return matchTableAuthority(u, category, categoryAuthority, lang, communityIntent)
}

func maxF(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func hostOf(u string) string {
	p, err := url.Parse(u)
	if err != nil {
		return ""
	}
	return strings.ToLower(p.Hostname())
}

// ---------- 外挂覆盖 (phase AD): SC_AUTHORITY_JSON(坏配置跳过不阻塞) ----------
func mergeExternalAuthority(raw string) (topics, categories, skipped int) {
	if strings.TrimSpace(raw) == "" {
		return 0, 0, 0
	}
	var parsed struct {
		Topics     map[string][]map[string]any `json:"topics"`
		Categories map[string][]map[string]any `json:"categories"`
	}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return 0, 0, 1 // 坏 JSON 不阻塞主链路
	}
	topics, skipped = mergeIntoTable(topicAuthority, parsed.Topics)
	categories, skipped2 := mergeIntoTable(categoryAuthority, parsed.Categories)
	return topics, categories, skipped + skipped2
}

func mergeIntoTable(table map[string][]AuthorityEntry, bucket map[string][]map[string]any) (merged, skipped int) {
	for key, entries := range bucket {
		list := table[key]
		for _, raw := range entries {
			domain := strings.ToLower(strings.TrimSpace(str(raw["domain"])))
			if !domainShapeRe.MatchString(domain) {
				skipped++
				continue
			}
			tier := "b"
			if raw["tier"] == "s" || raw["tier"] == "a" {
				tier = str(raw["tier"])
			}
			e := AuthorityEntry{Domain: domain, Tier: tier}
			if raw["lang"] == "zh" {
				e.Lang = "zh"
			}
			switch raw["kind"] {
			case "official", "community", "media", "expert", "reference":
				e.Kind = str(raw["kind"])
			}
			idx := -1
			for i, x := range list {
				if x.Domain == e.Domain {
					idx = i
					break
				}
			}
			if idx >= 0 {
				list[idx] = e
			} else {
				list = append(list, e)
			}
			merged++
		}
		table[key] = list
	}
	return merged, skipped
}

// ---------- 来源类型补密度 (phase AF): 纯元数据不改排序 ----------
var tableDefaultKind = map[string]string{"news": "media", "dictionary": "reference", "entities": "reference"}

var globalKindDefault = map[string]string{"wikipedia.org": "reference"}

var kindPatterns = []struct {
	kind     string
	suffix   []string
	contains []string
}{
	{
		kind: "community",
		suffix: []string{
			"github.com", "gitlab.com", "gitee.com", "codeberg.org",
			"reddit.com", "stackoverflow.com", "stackexchange.com", "superuser.com", "serverfault.com", "askubuntu.com",
			"news.ycombinator.com", "lobste.rs", "v2ex.com", "zhihu.com", "juejin.cn", "segmentfault.com",
			"cnblogs.com", "csdn.net", "jianshu.com", "oschina.net", "quora.com", "dev.to", "medium.com", "hashnode.dev",
		},
		contains: []string{"forum", "discuss.", "community.", "discourse"},
	},
	{kind: "media", suffix: []string{"forbes.com", "dw.com", "jiemian.com", "ifeng.com", "sina.com.cn", "sohu.com", "163.com"}},
	{kind: "reference", suffix: []string{"wikipedia.org", "wikimedia.org", "wiktionary.org", "wikiwand.com", "britannica.com", "scholarpedia.org"}},
}

// 预计算条目缺省 kind(加载一次)
var entryKindDefault = func() map[string]string {
	m := map[string]string{}
	for t, entries := range topicAuthority {
		def := tableDefaultKind[t]
		if def == "" {
			def = "official"
		}
		for _, en := range entries {
			if en.Kind == "" {
				m[en.Domain] = def
			}
		}
	}
	for t, entries := range categoryAuthority {
		def := tableDefaultKind[t]
		if def == "" {
			def = "official"
		}
		for _, en := range entries {
			if en.Kind == "" {
				m[en.Domain] = def
			}
		}
	}
	return m
}()

func classifySourceKind(u string, entry *AuthorityEntry) string {
	if entry != nil && entry.Kind != "" {
		return entry.Kind
	}
	domain := ""
	if entry != nil {
		domain = entry.Domain
	} else {
		domain = hostOf(u)
	}
	if domain == "" {
		return ""
	}
	for _, p := range kindPatterns {
		for _, d := range p.suffix {
			if domain == d || strings.HasSuffix(domain, "."+d) {
				return p.kind
			}
		}
		for _, c := range p.contains {
			if strings.Contains(domain, c) {
				return p.kind
			}
		}
	}
	if entry != nil {
		if k, ok := entryKindDefault[entry.Domain]; ok {
			return k
		}
		if k, ok := globalKindDefault[entry.Domain]; ok {
			return k
		}
		if matchAuthority(entry.Domain) != "" {
			return "official"
		}
		return ""
	}
	for d, k := range entryKindDefault {
		if domain == d || strings.HasSuffix(domain, "."+d) {
			return k
		}
	}
	return ""
}
