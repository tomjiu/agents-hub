package main

// 批 13 (修复批): 全领域评测(36 域 77 题)裁决 P0 — 8 条静默零输出车道接意图词剥离。
// 病灶: 自然语言多词查询整串发给窄域专源 API → 0 命中, 车道 ran-OK-无报错-0refs
// (上游全部存活, curl 抽查 7/7)。b11(lrclib 歌词意图词)/b12(wikidata 实体意图词/
// inaturalist 物种意图词/pubdev asciiFace)已修过同款病, 本批推广到 8 车道:
// tv(tvmaze)/games(steam)/manga(mangadex)/sport(thesportsdb)/drinks(thecocktaildb)/
// space(thespacedevs)/books(standardebooks)/geo(nominatim)。
// 模式: 原词空结果 → 剥域意图词重查一次 → 已有 asciiFace/longestASCIIToken 链兜底。
// 验收: 评测 8 域 16 题 0/16 → ≥10/16 (scripts/eval-b13-verify.mjs)。

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// b13StripIntent 用给定意图词正则剥离查询, 返回剥离后词面(空串=无可留词面, 调用方防呆不重查)。
// b12StripEntityIntent 同款逻辑抽通用(b12 原函数保留不动, 防动已验收路径)。
func b13StripIntent(q string, re *regexp.Regexp) string {
	return strings.TrimSpace(strings.Join(strings.Fields(re.ReplaceAllString(q, " ")), " "))
}

// ---------- 8 域意图词正则 (长形态在前防截胡; 只放该域语义噪声词, 不放实体词) ----------

// tv: "breaking bad tv series seasons how many"→"breaking bad"; "权力的游戏 剧集 第几季"→"权力的游戏"
var b13TVIntentRe = regexp.MustCompile(`(?i)(tv\s+series|tv\s+shows?|how\s+many|episode\s+count|seasons?\b|episodes?\b|series\b|shows?\b|电视剧|连续剧|美剧|剧集|第几季|多少季|几季|季数)`)

// games: "best pc game deal on steam"→"steam"; "steam 游戏 打折 买游戏"→"steam"
var b13GamesIntentRe = regexp.MustCompile(`(?i)(video\s+games?|pc\s+games?|game\s+deals?|deals?\b|deal\b|games?\b|best\b|on\b|游戏|打折|折扣|特惠|促销|买游戏|便宜|好玩|推荐)`)

// manga: "one piece manga latest chapter"→"one piece"; "葬送的芙莉莲 漫画 连载"→"葬送的芙莉莲"
// 注意不可含 "动画/番" — mangadex 只管漫画, anime 域由 kitsu 承担, 剥掉防污染
var b13MangaIntentRe = regexp.MustCompile(`(?i)(latest\s+chapters?|chapters?\b|manga\b|comics?\b|manhwa\b|latest\b|漫画|连载|最新话|第几话)`)

// sport: "NBA team lakers roster profile"→"NBA lakers"(再由 longestASCIIToken→"lakers")
var b13SportIntentRe = regexp.MustCompile(`(?i)(team\s+roster|roster\b|profile\b|squad\b|players?\b|teams?\b|球队资料|球队阵容|球队|阵容|资料|比分)`)

// drinks: "mojito cocktail recipe ingredients"→"mojito"
var b13DrinksIntentRe = regexp.MustCompile(`(?i)(cocktail\s+recipes?|cocktails?\b|recipes?\b|ingredients?\b|how\s+to\s+make|drink\b|鸡尾酒|调酒配方|配方|基酒|做法|怎么调)`)

// space: "SpaceX falcon 9 next rocket launch"→"SpaceX falcon 9"; "长征五号 火箭 发射任务 计划"→"长征五号"
var b13SpaceIntentRe = regexp.MustCompile(`(?i)(next\s+rocket\s+launch|rocket\s+launch|next\s+launch|launch\s+schedule|launch(?:es)?\b|rockets?\b|upcoming|schedule|发射任务|发射计划|火箭发射|发射|火箭|任务|计划)`)

// books: "pride and prejudice public domain ebook"→"pride and prejudice"
var b13BooksIntentRe = regexp.MustCompile(`(?i)(public\s+domain|e-?books?\b|books?\b|download|公版书|电子书|名著|古典小说|免费|下载)`)

// geo: "where is Eiffel Tower coordinates"→"Eiffel Tower"; "西湖 在哪 位置 坐标"→"西湖"
var b13GeoIntentRe = regexp.MustCompile(`(?i)(where\s+is|where\s+are|location\s+of|coordinates?\b|latitude\b|longitude\b|在哪|在哪里|位置|坐标|地址|经纬度|位于)`)

// b14: huggingface 模型库 — "huggingface bert 模型权重 下载"→"bert"; "open weights llm model
// download 2025"→"llm 2025" (curl 实测: 多词中文串 0 结果, 裸 bert/llm 2025 各 5 中)。
// 注意 "llm"/"bert" 是实体词不剥; "open llm 2025" HF 索引 0 结果, 剥 "open" 防整短语残留不可行
// (open 是普通词), 靠 "open weights" 整短语进表解决。
var b13HFIntentRe = regexp.MustCompile(`(?i)(open\s+weights?|model\s+weights?|model\s+downloads?|huggingface\b|\bhf\b|weights?\b|downloads?\b|models?\b|模型权重|模型|权重|下载)`)

// b14: coingecko 币价 — "bitcoin coin price today"→"bitcoin" (curl 实测: 全串 /search 0 结果,
// 裸 bitcoin 直中)。币名( bitcoin/doge/eth )是实体词不剥; frankfurter 汇率题(b12 别名表)不经过此正则。
var b13FinanceIntentRe = regexp.MustCompile(`(?i)(coin\s+price|current\s+price|price\s+today|prices?\b|today\b|now\b|coin\b|token\b|价格|现价|今天|今日|行情|多少钱)`)

// b15 质量抽检: wiktionary 词条直查 — "ubiquitous meaning etymology"→"ubiquitous",
// "鲲 什么意思 释义 词源"→"鲲" (整串 srsearch 返回 dopeness 等随机词条, 先剥后查+原词兜底)
var b13DictionaryIntentRe = regexp.MustCompile(`(?i)(what\s+does\s+\S+\s+mean|meaning|etymology|definition|origin\s+of|什么意思|释义|词源|意思|含义|出处)`)

// ---------- 中文火箭名→LL2 英文 rocket config 词面 (b12 frankfurter 币码别名表先例) ----------
// thespacedevs search= 只匹配英欧语料 rocket config/mission/pad 名, 中文 0 命中。
var b13RocketAlias = map[string]string{
	"长征二号":  "Long March 2",
	"长征三号":  "Long March 3",
	"长征五号":  "Long March 5",
	"长征五号乙": "Long March 5B",
	"长征六号":  "Long March 6",
	"长征七号":  "Long March 7",
	"长征八号":  "Long March 8",
	"长征九号":  "Long March 9",
	"猎鹰九号":  "Falcon 9",
	"猎鹰重型":  "Falcon Heavy",
	"星舰":    "Starship",
	"联盟号":   "Soyuz",
	"阿丽亚娜":  "Ariane",
	"神舟":    "Shenzhou",
	"天舟":    "Tianzhou",
}

// b13SpaceQuery 剥意图词 + 火箭别名翻译, 返回空串=整串被剥光(调用方防呆)
func b13SpaceQuery(q string) string {
	s := b13StripIntent(q, b13SpaceIntentRe)
	if s == "" {
		return ""
	}
	if en, ok := b13RocketAlias[s]; ok {
		return en
	}
	return s
}

// ======================= 批 13 P1/P2 (评测报告 §5 第 2-5 条) =======================

// ---------- P1-a entities claims 直答("对而不答"→"对且答") ----------
// 病灶(评测 §2): wbsearchentities description 不含答案字段 — "华为 创始人 是谁"命中
// Huawei Q160120 但 description 是公司简介, 用户看不到"任正非"; "capital of Australia"
// 命中 Australia Q408 却看不到"Canberra"。修法: 命中后对 top-1 实体 wbgetentities
// 取 claims(答案型属性), 实体型值第二跳批量取 label, 追加进 snippet。
var b13AnswerProps = []struct {
	PID string
	ZH  string // 中文语境属性标签
	EN  string // 英文语境属性标签
}{
	{"P112", "创始人", "founder"},
	{"P36", "首都", "capital"},
	{"P569", "出生", "born"},
	{"P571", "成立", "inception"},
	{"P577", "发布于", "published"},
	{"P17", "国家", "country"},
	{"P159", "总部", "headquarters"},
	// b16 泛化探针补人口: population/人口 是最典型实体问句(entities 域 keyword 收了
	// "人口"), P1082 quantity 值此前被 b13WbClaimValue 静默丢弃
	{"P1082", "人口", "population"},
}

type b13WbEntities struct {
	Entities map[string]struct {
		Claims map[string][]struct {
			Rank     string `json:"rank"`
			Mainsnak struct {
				Snaktype  string `json:"snaktype"`
				Datavalue *struct {
					Value json.RawMessage `json:"value"`
				} `json:"datavalue"`
			} `json:"mainsnak"`
		} `json:"claims"`
		Labels map[string]struct {
			Value string `json:"value"`
		} `json:"labels"`
	} `json:"entities"`
}

// b13WbClaimValue 解析 claim 值: 实体型→QID, 时间型→"1944-10-25"; 其余类型返回空
func b13WbClaimValue(raw json.RawMessage) (qid, text string) {
	if len(raw) == 0 {
		return "", ""
	}
	var ent struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &ent); err == nil && ent.ID != "" {
		return ent.ID, ""
	}
	var tm struct {
		Time string `json:"time"`
	}
	if err := json.Unmarshal(raw, &tm); err == nil && tm.Time != "" {
		t := strings.TrimPrefix(tm.Time, "+")
		// b16: BC 负年份带符号, "-0660-02-11T.."[:10] 会断在 "-0660-02-1"; 符号感知截 11 位
		if len(t) >= 10 {
			if strings.HasPrefix(t, "-") && len(t) >= 11 {
				return "", t[:11]
			}
			return "", t[:10]
		}
	}
	// b16: quantity 值(P1082 人口等) — {"amount":"+125800000","unit":"1"}
	var qty struct {
		Amount string `json:"amount"`
	}
	if err := json.Unmarshal(raw, &qty); err == nil && qty.Amount != "" {
		a := strings.TrimPrefix(qty.Amount, "+")
		if n, err := strconv.ParseInt(a, 10, 64); err == nil {
			return "", b13FormatInt(n)
		}
		return "", a // 非整数量(小数/科学计数)原样给词面
	}
	return "", ""
}

// b13FormatInt 千分位: 125800000 → "125,800,000"
func b13FormatInt(n int64) string {
	s := strconv.FormatInt(n, 10)
	neg := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")
	var sb []byte
	for i, c := range []byte(s) {
		if i > 0 && (len(s)-i)%3 == 0 {
			sb = append(sb, ',')
		}
		sb = append(sb, c)
	}
	if neg {
		return "-" + string(sb)
	}
	return string(sb)
}

// ---------- b16 泛化探针: 实体 claims 直答意图感知化 ----------
// 病灶(探针实弹): "特斯拉 创始人 是谁" 原词非空但 top-1 实体错位 — 模糊匹配返回
// Nikola Tesla(人 Q9036), Tesla 公司(Q478214, 携带 P112 founder)在第 2 位, 而 enrich
// 只看 top-1 → founder 直答丢失。修法: 意图词→PID 映射, 批量取 top-3 claims,
// 找携带意图属性的实体直答(通用规则, 不特判任何实体)。无意图词保持 top-1 原路径。
var b13IntentProps = []struct {
	re  *regexp.Regexp
	pid string
}{
	{regexp.MustCompile(`(?i)创始人|创办人|founder`), "P112"},
	{regexp.MustCompile(`(?i)首都|capital`), "P36"},
	{regexp.MustCompile(`(?i)人口|population`), "P1082"},
	{regexp.MustCompile(`(?i)总部|headquarters`), "P159"},
	{regexp.MustCompile(`(?i)成立|创办于|inception|founded`), "P571"},
	{regexp.MustCompile(`(?i)发布于|发行日期|published|release`), "P577"},
	{regexp.MustCompile(`(?i)出生|born`), "P569"},
	{regexp.MustCompile(`(?i)国家|country`), "P17"},
}

func b13QueryIntentPID(q string) string {
	for _, ip := range b13IntentProps {
		if ip.re.MatchString(q) {
			return ip.pid
		}
	}
	return ""
}

// b13EnrichEntityClaims 取 qid 实体的答案型 claims, 返回可追加的 snippet 片段
// (空串=无答案 claims 或上游失败, 静默降级不影响原结果)。腿内最多 2 请求。
func b13EnrichEntityClaims(ctx context.Context, client *http.Client, qid, lang string) string {
	get := func(params map[string]string) (b13WbEntities, error) {
		var out b13WbEntities
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://www.wikidata.org/w/api.php", nil)
		p := req.URL.Query()
		p.Set("action", "wbgetentities")
		p.Set("format", "json")
		p.Set("languages", "zh|en")
		p.Set("origin", "*")
		for k, v := range params {
			p.Set(k, v)
		}
		req.URL.RawQuery = p.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return out, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return out, fmt.Errorf("wikidata enrich http %d", resp.StatusCode)
		}
		if err := json.Unmarshal([]byte(readAllString(resp.Body)), &out); err != nil {
			return out, err
		}
		return out, nil
	}
	first, err := get(map[string]string{"ids": qid, "props": "claims"})
	if err != nil {
		return ""
	}
	e, ok := first.Entities[qid]
	if !ok {
		return ""
	}
	zhCtx := strings.HasPrefix(lang, "zh")
	type kv struct{ label, val string }
	var parts []kv
	var qids []string // 实体型待取 label
	for _, ap := range b13AnswerProps {
		snaks, ok := e.Claims[ap.PID]
		if !ok || len(snaks) == 0 {
			continue
		}
		// b16: wikidata statement rank 优先 — 多值属性(P36 首都可能含 historic 值)
		// 盲取 snaks[0] 会拿到历史值(Japan P36 首值为公元 740 年紫香樂宮),
		// preferred rank 存在时只看 preferred 子集(canonical 答案), 否则维持原序。
		var preferred []struct {
			Rank     string `json:"rank"`
			Mainsnak struct {
				Snaktype  string `json:"snaktype"`
				Datavalue *struct {
					Value json.RawMessage `json:"value"`
				} `json:"datavalue"`
			} `json:"mainsnak"`
		}
		for _, sn := range snaks {
			if sn.Rank == "preferred" {
				preferred = append(preferred, sn)
			}
		}
		if len(preferred) > 0 {
			snaks = preferred
		}
		sn := snaks[0].Mainsnak
		if sn.Snaktype != "value" || sn.Datavalue == nil {
			continue
		}
		qv, tv := b13WbClaimValue(sn.Datavalue.Value)
		if qv != "" {
			qids = append(qids, qv)
			label := ap.EN
			if zhCtx {
				label = ap.ZH
			}
			parts = append(parts, kv{label, "\x00" + qv}) // 占位, 跳2 后回填
		} else if tv != "" {
			label := ap.EN
			if zhCtx {
				label = ap.ZH
			}
			parts = append(parts, kv{label, tv})
		}
	}
	if len(parts) == 0 {
		return ""
	}
	if len(qids) > 0 {
		second, err := get(map[string]string{"ids": strings.Join(qids, "|"), "props": "labels"})
		if err == nil {
			for i := range parts {
				if !strings.HasPrefix(parts[i].val, "\x00") {
					continue
				}
				q := strings.TrimPrefix(parts[i].val, "\x00")
				if le, ok := second.Entities[q]; ok {
					zv := le.Labels["zh"].Value
					ev := le.Labels["en"].Value
					// 双语输出(评测口径=标题+摘要子串, 中英 expect 都要能命中):
					// "任正非 (Ren Zhengfei)" / "堪培拉 (Canberra)"; 单语缺失时取另一语
					v := zv
					if v == "" {
						v = ev
					} else if ev != "" && ev != v {
						v += " (" + ev + ")"
					}
					parts[i].val = v
				}
			}
		} else {
			return "" // label 拿不到就整体不追加(QID 裸串对用户无意义)
		}
	}
	var sb strings.Builder
	for _, p := range parts {
		if p.val == "" || strings.HasPrefix(p.val, "\x00") {
			continue
		}
		sb.WriteString(" · ")
		sb.WriteString(p.label)
		sb.WriteString(" ")
		sb.WriteString(p.val)
	}
	return sb.String()
}

// b13EnrichEntityClaimsIntent 意图感知版: 一次 wbgetentities 批量取 top-N claims,
// 按结果序找第一个携带意图 PID 的实体, 返回 (qid, 该实体全部答案属性片段);
// 无实体带意图属性时退化为第一个带任意答案属性的实体(与 top-1 原路径同款输出);
// 都没有则返回 ("", "")。请求数与原路径相同(≤2: claims 批量 + labels 回填)。
func b13EnrichEntityClaimsIntent(ctx context.Context, client *http.Client, qids []string, lang, intentPID string) (string, string) {
	if len(qids) == 0 {
		return "", ""
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://www.wikidata.org/w/api.php", nil)
	p := req.URL.Query()
	p.Set("action", "wbgetentities")
	p.Set("format", "json")
	p.Set("languages", "zh|en")
	p.Set("origin", "*")
	p.Set("ids", strings.Join(qids, "|"))
	p.Set("props", "claims")
	req.URL.RawQuery = p.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return "", ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", ""
	}
	var d b13WbEntities
	if err := json.Unmarshal([]byte(readAllString(resp.Body)), &d); err != nil {
		return "", ""
	}
	pick, fallback := "", ""
	for _, qid := range qids {
		e, ok := d.Entities[qid]
		if !ok {
			continue
		}
		hasAny := false
		for _, ap := range b13AnswerProps {
			if len(e.Claims[ap.PID]) > 0 {
				hasAny = true
				break
			}
		}
		if !hasAny {
			continue
		}
		if fallback == "" {
			fallback = qid
		}
		if len(e.Claims[intentPID]) > 0 {
			pick = qid
			break
		}
	}
	if pick == "" {
		pick = fallback
	}
	if pick == "" {
		return "", ""
	}
	return pick, b13EnrichEntityClaims(ctx, client, pick, lang)
}

// ---------- P1-b 三处中文词面偏科 ----------

// music: "周杰伦 晴天 专辑 这首歌"剥意图词→"周杰伦 晴天"; 原唱重排(artist 含歌手词面提前)
var b13MusicIntentRe = regexp.MustCompile(`(?i)(这首歌|的歌曲|专辑|哪张|哪首|原唱|歌手|track|album|song)`)

// b13CJKSinger 最长 CJK token(≥2 汉字)作为歌手词面
func b13CJKSinger(q string) string {
	best := ""
	for _, p := range strings.Fields(q) {
		rs := []rune(p)
		if len(rs) < 2 {
			continue
		}
		cjk := false
		for _, r := range rs {
			if r >= 0x4e00 && r <= 0x9fff {
				cjk = true
				break
			}
		}
		if cjk && len(rs) > len([]rune(best)) {
			best = p
		}
	}
	return best
}

// b13MusicReorder 原唱优先: title 含歌手词面("晴天 — 周杰伦")的条目提前, 稳定分区保 score 序
func b13MusicReorder(refs []Reference, q string) []Reference {
	singer := b13CJKSinger(q)
	if singer == "" {
		return refs
	}
	var hit, rest []Reference
	for _, r := range refs {
		if strings.Contains(r.Title, singer) {
			hit = append(hit, r)
		} else {
			rest = append(rest, r)
		}
	}
	return append(hit, rest...)
}

// browser-ext: "firefox 扩展 广告拦截 推荐"→"广告拦截"(AMO 中文索引直中, 实弹取证)
var b13BrowserExtIntentRe = regexp.MustCompile(`(?i)(firefox|chrome|edge|addons?|extensions?|plugins?|浏览器|扩展|插件|推荐|安装|好用)`)

// drug: "ibuprofen drug label dosage"→"ibuprofen"(openFDA 全文搜索整串会带回 SILICEA 类噪声)
var b13DrugIntentRe = regexp.MustCompile(`(?i)(drug\s+labels?|labels?|dosage|indications?|side\s+effects?|药品说明书|说明书|剂量|适应症|副作用|药品|药)`)

// anime: "best anime 2024 recommendations"剥噪声; "进击的巨人 动漫 追番 推荐"→"进击的巨人"
var b13AnimeIntentRe = regexp.MustCompile(`(?i)(anime|recommendations?|best\b|\b20\d{2}\b|动[漫画]|追番|番剧|推荐|好看的|人气)`)

// species: 中文明星物种别名表(inaturalist taxa 索引不含中文俗名, 实弹取证 q=大熊猫
// 返回蕨类/熊蜂等人气兜底列表而非 Ailuropoda) — b12 火箭别名表同款窄映射
var b13SpeciesAlias = map[string]string{
	"大熊猫": "Giant Panda",
	"熊猫":  "Giant Panda",
	"小熊猫": "Red Panda",
	"丹顶鹤": "Red-crowned Crane",
	"金丝猴": "Golden Snub-nosed Monkey",
	"藏羚羊": "Tibetan Antelope",
	"扬子鳄": "Chinese Alligator",
	"朱鹮":  "Crested Ibis",
	"华南虎": "South China Tiger",
	"东北虎": "Siberian Tiger",
}

// b13SpeciesQuery 剥物种意图词后命中中文俗名 key 则替换为英文俗名(空串=剥光防呆)
func b13SpeciesQuery(q string) string {
	s := b12StripTaxonIntent(q)
	if s == "" {
		return ""
	}
	if en, ok := b13SpeciesAlias[s]; ok {
		return en
	}
	return s
}

// ---------- P2 慢腿短截止(评测 §3: zenodo/hfpapers 冷跑 11-20s, 软截止杀慢腿烧 fallback 扩腿) ----------
func b13SlowLegCtx(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, 8*time.Second)
}

// b13QIDRe 从 wikidata 车道 title "Label (Q34253)" 尾部提取 QID
var b13QIDRe = regexp.MustCompile(`\((Q\d+)\)$`)
