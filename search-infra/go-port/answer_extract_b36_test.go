package main

// b36: D 桶召回层上游腿探针 (nogold@20 案集, b35 交接候选① "上游腿质量" 第一锹)。
//
// 背景: b31 定界 D 桶(真召回缺失 ~57% 可判) + b35 pool20 定案(D 桶主体不受池深影响,
// 修复方向在召回/正文层不在排序层参数)。本探针回答: top-20 零证据的案例里, gold
// 证据页在上游链路的哪一层丢失:
//
//      ENGINE-MISS           全引擎全深度原始结果均无 title+snippet 证据(引擎覆盖/查询词形问题)
//      FUSION-LOSS           ≥1 条原始证据页存在, 但融合交付里零证据 → 产品侧可修
//        丢失点五级血脉追踪: fuse-text-superseded(URL 首现吞并, 先到引擎的贫瘠文本顶掉证据文本)
//                            spam-block(硬屏蔽) / dedup-text-superseded(TF 去重吸收, 长 snippet 覆盖)
//                            domain-cap(单域 3 条上限) / topN-truncation(宽池排名 21+)
//      PROBE-HIT1/RANKED     探针理想融合已有证据(churn/时点漂移, 退出归因)
//
// 镜像纪律(与生产 searchFlow 逐参一致):
//      plan() 路由分支(web/domain/github) + domainCap(topic packages/devops→0 否则 3)
//      引擎池 = laneRegistry 全池去 searxng(SC_ENABLE_SEARXNG 未设), 每引擎独立 runLanes
//      client 三层快超时(dial 5s/TLS 5s/响应头 10s) + Timeout 20s; MaxResults=10/TopN=20
//      判定语义 = eval matchEvidence 逐字镜像(b32AnsIn, verbatim len>1 / tokenAND 停用词表)
//      融合 = fuseSemantic 原函数 + 分步分解自检(分解终态必须与单体输出逐位一致, 违者 abort)
//
// 方法注记: 探针全结算不等早收割(理想召回上限); 慢腿(>1200ms 早收割阈值)上的证据
// 记 slow-leg 注记(收割风险观察, 不定性)。stage1(二进制复核)与 stage2(探针)为两次
// 独立活窗, PROBE-HIT1/RANKED 含 churn 翻案。
//
// 门禁: 缺省 t.Skip — SC_B36_PROBE=1 才发网络请求(常规 go test 零外呼)。
// 输入: SC_B36_PROBE_CASES (缺省 scripts/b36-legprobe-still.json, 由 b36-restage.mjs 产出)
// 输出: SC_B36_PROBE_OUT   (缺省 scripts/b36-legprobe.json)

import (
        "encoding/json"
        "fmt"
        "net"
        "net/http"
        "os"
        "sort"
        "strings"
        "testing"
        "time"
)

type b36Case struct {
        Dataset string   `json:"dataset"`
        Q       string   `json:"q"`
        Answers []string `json:"answers"`
}

type b36LaneOut struct {
        Engine       string `json:"engine"`
        Err          string `json:"err,omitempty"`
        Skipped      bool   `json:"skipped,omitempty"`
        Count        int    `json:"count"`
        ElapsedMs    int64  `json:"elapsedMs"`
        EvidenceRank []int  `json:"evidenceRank,omitempty"` // 该腿 1-based 序位上含证据的 ref
}

type b36RawEv struct {
        Engine     string `json:"engine"`
        Rank       int    `json:"rank"`
        URL        string `json:"url"`
        Title      string `json:"title"`
        Snippet    string `json:"snippet"`
        MatchedBy  string `json:"matchedBy"`
        MatchedAns string `json:"matchedAns"`
}

type b36Track struct {
        RawURL  string `json:"rawUrl"`
        Holder  string `json:"holder"` // 血脉当前载体 urlNorm
        LostAt  string `json:"lostAt"` // ""=存活到交付(与 fused 零证据矛盾→INVARIANT 桶)
        Domain  string `json:"domain,omitempty"`
        Detail  string `json:"detail,omitempty"` // 吸收者/排名等补充
        AliveEv bool   `json:"aliveEv"`          // 终态载体文本是否仍带证据
}

type b36CaseOut struct {
        Dataset string   `json:"dataset"`
        Q       string   `json:"q"`
        Answers []string `json:"answers"`
        Route   string   `json:"route"`
        Lang    string   `json:"lang"`
        // 引擎层
        Lanes    []b36LaneOut `json:"lanes"`
        RawTotal int          `json:"rawTotal"`
        Distinct int          `json:"distinct"` // 宽池去重 URL 数
        // 证据层
        RawEvidence []b36RawEv `json:"rawEvidence"`
        Lineages    []b36Track `json:"lineages,omitempty"`
        // 融合层
        FusedEvidenceRank int `json:"fusedEvidenceRank"` // 0=无
        Bucket            string `json:"bucket"`
        Meta              struct {
                DedupMerged      int    `json:"dedupMerged"`
                SpamBlocked      int    `json:"spamBlocked"`
                AuthorityGuarded int    `json:"authorityGuarded"`
                Embedder         string `json:"embedder"`
        } `json:"meta"`
        StepCheck string `json:"stepCheck"` // 分步分解 vs 单体 fuseSemantic 自检结论
}

// b36Evidence: dump 脚本同款 hay 拼法(title\nsnippet), b32AnsIn 判定
func b36Evidence(title, snippet, probeAns string, answers []string) (bool, string, string) {
        hay := strings.ToLower(title + "\n" + snippet)
        // b32AnsIn 返回 (probeAns 命中, 任一 gold 命中) — probeAns 传空即跳过探针侧命中
        if ok := func() bool { _, any := b32AnsIn(hay, probeAns, answers); return any }(); ok {
                // 复刻 matchedBy/matchedAns(与 dump 同序: verbatim 优先)
                for _, a := range answers {
                        al := strings.ToLower(a)
                        if len([]rune(al)) > 1 && strings.Contains(hay, al) {
                                return true, "verbatim", a
                        }
                }
                for _, a := range answers {
                        al := strings.ToLower(a)
                        toks := splitRe.Split(al, -1)
                        ft := []string{}
                        for _, t := range toks {
                                if t == "" {
                                        continue
                                }
                                if (len([]rune(t)) >= 4 && !b32Stop[t]) || isAllDigits(t) {
                                        ft = append(ft, t)
                                }
                        }
                        if len(ft) == 0 {
                                continue
                        }
                        allHit := true
                        for _, t := range ft {
                                if !strings.Contains(hay, t) {
                                        allHit = false
                                        break
                                }
                        }
                        if allHit {
                                return true, "tokenAND", strings.Join(ft, "+")
                        }
                }
        }
        return false, "", ""
}

// b36BuildLegSets: searchFlow 腿编排镜像(domain/github/web 三分支逐条对齐)
func b36BuildLegSets(q string) (legSets []legSet, topic string, domainCap int) {
        domainCap = 3
        decision := plan(q)
        if decision.route == "domain" && decision.domainPlan != nil {
                dp := decision.domainPlan
                leg0 := laneLegProviders(dp.topic, q, dp.apiProviders)
                legSets = append(legSets, legSet{query: decision.queries[0], engines: leg0})
                for i, sq := range dp.siteQueries {
                        eng := dp.siteEngines[i%len(dp.siteEngines)]
                        legSets = append(legSets, legSet{query: sq, engines: []string{eng}})
                }
                topic = dp.topic
                if topic == "packages" || topic == "devops" {
                        domainCap = 0
                }
                return legSets, topic, domainCap
        }
        if decision.route == "github" {
                legSets = append(legSets, legSet{query: q, engines: []string{"github", "duckduckgo", "mojeek"}})
                return legSets, "", domainCap
        }
        // web 全池(镜像 main.go: searxng 缺省摘出)
        engines := []string{}
        for name := range laneRegistry {
                if name == "searxng" && os.Getenv("SC_ENABLE_SEARXNG") == "" {
                        continue
                }
                engines = append(engines, name)
        }
        sortStrings(engines)
        legSets = append(legSets, legSet{query: q, engines: engines})
        return legSets, "", domainCap
}

func TestB36LegProbe(t *testing.T) {
        if os.Getenv("SC_B36_PROBE") != "1" {
                t.Skip("SC_B36_PROBE=1 才发网络请求(门禁)")
        }
        // ---- 匹配器金样本自检(与 eval 口径对齐的红线样本) ----
        if ok, _, _ := b36Evidence("Bureau of Land Management", "manages over 247.3 million acres", "", []string{"247.3 million"}); !ok {
                t.Fatalf("金样本失败: verbatim 命中")
        }
        if ok, by, _ := b36Evidence("48 Hrs. (1982)", "First Movie", "", []string{"48 Hours"}); ok {
                t.Fatalf("金样本失败: 48 Hours 不应 verbatim 命中 48 Hrs., got %v", by)
        }
        if ok3, by, ans := b36Evidence("48 Hrs. soundtrack", "running time 2 hours", "", []string{"48 Hours"}); !ok3 || by != "tokenAND" {
                t.Fatalf("金样本失败: tokenAND 48+hours, got ok=%v by=%s ans=%s", ok3, by, ans)
        }

        casesPath := os.Getenv("SC_B36_PROBE_CASES")
        if casesPath == "" {
                casesPath = "scripts/b36-legprobe-still.json"
        }
        raw, err := os.ReadFile(casesPath)
        if err != nil {
                t.Fatalf("读案集失败: %v", err)
        }
        var cases []b36Case
        if err := json.Unmarshal(raw, &cases); err != nil {
                t.Fatalf("案集解析失败: %v", err)
        }

        outPath := os.Getenv("SC_B36_PROBE_OUT")
        if outPath == "" {
                outPath = "scripts/b36-legprobe.json"
        }

        tally := map[string]int{}
        for ci, c := range cases {
                out := b36RunCase(t, c)
                tally[out.Bucket]++
                blob, _ := json.Marshal(out)
                // 追加写(逐案落盘, 中断可续析)
                f, err := os.OpenFile(outPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
                if err != nil {
                        t.Fatalf("写输出失败: %v", err)
                }
                _, _ = f.Write(append(blob, '\n'))
                _ = f.Close()
                t.Logf("[%2d/%2d] %-14s %s", ci+1, len(cases), out.Bucket, c.Q[:min(len(c.Q), 56)])
        }
        keys := make([]string, 0, len(tally))
        for k := range tally {
                keys = append(keys, k)
        }
        sort.Strings(keys)
        parts := []string{}
        for _, k := range keys {
                parts = append(parts, fmt.Sprintf("%s=%d", k, tally[k]))
        }
        t.Logf("TALLY %s", strings.Join(parts, " "))
}

func b36RunCase(t *testing.T, c b36Case) b36CaseOut {
        out := b36CaseOut{Dataset: c.Dataset, Q: c.Q, Answers: c.Answers}
        legSets, topic, domainCap := b36BuildLegSets(c.Q)

        // 生产同款 client(三层快超时 + 20s 总超时)
        client := &http.Client{
                Timeout: 20 * time.Second,
                Transport: &http.Transport{
                        DialContext:           (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
                        TLSHandshakeTimeout:   5 * time.Second,
                        ResponseHeaderTimeout: 10 * time.Second,
                },
        }

        // 逐腿独立 runLanes(镜像生产 per-engine goroutine), 全结算不等早收割
        type slot struct {
                lr    laneResult
                ems   int64
                query string
        }
        nEngines := 0
        for _, ls := range legSets {
                nEngines += len(ls.engines)
        }
        slots := make([]slot, nEngines)
        done := make(chan int, nEngines)
        idx := 0
        t0 := time.Now()
        for _, ls := range legSets {
                for _, e := range ls.engines {
                        go func(i int, q, e string) {
                                lo := SearchOpts{
                                        Query: q, Lang: "", TopN: 20, MaxResults: 10,
                                        Engines: []string{e}, TimeoutMs: 20000,
                                }
                                lt0 := time.Now()
                                rs := runLanes(lo, client)
                                slots[i].ems = time.Since(lt0).Milliseconds()
                                if len(rs) > 0 {
                                        slots[i].lr = rs[0]
                                } else {
                                        slots[i].lr = laneResult{Name: e, Err: fmt.Errorf("no result")}
                                }
                                slots[i].query = q
                                done <- i
                        }(idx, ls.query, e)
                        idx++
                }
        }
        for i := 0; i < nEngines; i++ {
                <-done
        }

        // 腿级输出 + 原始证据收集
        var lanes []laneResult
        rawEvByKey := map[string]b36RawEv{} // urlNorm → 证据(同 URL 多引擎只记首条, 血脉合一)
        rawEvOrder := []string{}
        for i := 0; i < nEngines; i++ {
                lr := slots[i].lr
                lo := b36LaneOut{Engine: lr.Name, Count: len(lr.Refs), ElapsedMs: slots[i].ems}
                if lr.Err != nil {
                        lo.Err = lr.Err.Error()
                }
                if lr.Skipped {
                        lo.Skipped = true
                }
                for ri, r := range lr.Refs {
                        has, by, ans := b36Evidence(r.Title, r.Snippet, "", c.Answers)
                        if has {
                                lo.EvidenceRank = append(lo.EvidenceRank, ri+1)
                                key := urlNorm(r.URL)
                                if _, dup := rawEvByKey[key]; !dup {
                                        rawEvByKey[key] = b36RawEv{
                                                Engine: lr.Name, Rank: ri + 1, URL: r.URL,
                                                Title: clampText(r.Title, 120), Snippet: clampText(r.Snippet, 200),
                                                MatchedBy: by, MatchedAns: ans,
                                        }
                                        rawEvOrder = append(rawEvOrder, key)
                                }
                        }
                }
                out.Lanes = append(out.Lanes, lo)
                if lr.Err == nil && !lr.Skipped {
                        lanes = append(lanes, lr)
                        out.RawTotal += len(lr.Refs)
                }
        }
        _ = t0
        // 慢腿注记: 证据只出现在 >早收割阈值(1200ms) 的腿上 → harvest-risk
        for _, key := range rawEvOrder {
                ev := rawEvByKey[key]
                for _, lo := range out.Lanes {
                        if lo.Engine == ev.Engine && lo.ElapsedMs > 1200 {
                                ev.MatchedAns = ev.MatchedAns + " [slow-leg " + fmt.Sprintf("%dms", lo.ElapsedMs) + "]"
                        }
                }
                rawEvByKey[key] = ev
        }
        for _, key := range rawEvOrder {
                out.RawEvidence = append(out.RawEvidence, rawEvByKey[key])
        }

        if len(lanes) == 0 {
                out.Bucket = "ENGINE-MISS(全腿失败)"
                return out
        }

        // ---- 融合: 单体 fuseSemantic(生产原函数) ----
        fuseO := fuseOpts{
                query: c.Q, topN: 20,
                category:        detectCategory(c.Q),
                communityIntent: detectCommunityIntent(c.Q),
                lang:            "",
                authorityBoost:  0.75, topic: topic, domainCap: domainCap,
        }
        fused, meta := fuseSemantic(lanes, fuseO, 20)
        out.Meta.DedupMerged = meta.DedupMerged
        out.Meta.SpamBlocked = meta.SpamBlocked
        out.Meta.AuthorityGuarded = meta.AuthorityGuarded
        out.Meta.Embedder = meta.Embedder

        // ---- 分步分解(镜像 fuseSemantic 内部链) + 自检 ----
        wide, spamKept, dedupKept, capped, step := b36Stepwise(lanes, fuseO)
        check := "OK"
        if len(step) != len(fused) {
                check = "MISMATCH(len)"
        } else {
                for i := range step {
                        if step[i].URL != fused[i].URL {
                                check = fmt.Sprintf("MISMATCH(rank%d)", i+1)
                                break
                        }
                }
        }
        if meta.DedupMerged != dedupMetaCheck || meta.SpamBlocked != spamMetaCheck {
                check += "/META"
        }
        out.StepCheck = check
        out.Distinct = len(wide)

        // 交付侧证据位次
        for i, r := range fused {
                has, _, _ := b36Evidence(r.Title, r.Snippet, "", c.Answers)
                if has {
                        out.FusedEvidenceRank = i + 1
                        break
                }
        }

        // ---- 血脉追踪(五级丢失点) ----
        if out.FusedEvidenceRank == 0 && len(out.RawEvidence) > 0 {
                for _, key := range rawEvOrder {
                        tr := b36TrackLineage(key, rawEvByKey[key], wide, spamKept, dedupKept, capped, c.Answers, dedupAbsorbed)
                        out.Lineages = append(out.Lineages, tr)
                }
        }

        // ---- 分桶 ----
        switch {
        case out.FusedEvidenceRank == 1:
                out.Bucket = "PROBE-HIT1"
        case out.FusedEvidenceRank >= 2:
                out.Bucket = fmt.Sprintf("PROBE-RANKED@%d", out.FusedEvidenceRank)
        case len(out.RawEvidence) == 0:
                out.Bucket = "ENGINE-MISS"
        default:
                lost := map[string]int{}
                for _, tr := range out.Lineages {
                        if tr.LostAt == "" {
                                lost["INVARIANT-ALIVE"]++ // 存活但交付无证据 = 分解/判定矛盾, 必须为 0
                        } else {
                                lost[tr.LostAt]++
                        }
                }
                if lost["INVARIANT-ALIVE"] > 0 {
                        out.Bucket = "INVARIANT-VIOLATION"
                } else {
                        // 主丢失点(多血脉取最早丢失级: fuse>spam>dedup>cap>topN)
                        order := []string{"fuse-text-superseded", "spam-block", "dedup-text-superseded", "domain-cap", "topN-truncation"}
                        for _, o := range order {
                                if lost[o] > 0 {
                                        out.Bucket = "FUSION-LOSS:" + o
                                        return out
                                }
                        }
                        out.Bucket = "FUSION-LOSS:mixed"
                }
        }
        return out
}

// b36Stepwise: fuseSemantic 内部链镜像(fuseV3 宽池 → spam 双档 → TF 去重 → domainCap → topN)。
// 返回各阶段快照供血脉追踪; dedupAbsorbed 记录 吸收者→被吸收 key 集。
var dedupMetaCheck, spamMetaCheck int
var dedupAbsorbed = map[string][]string{}

func b36Stepwise(lanes []laneResult, o fuseOpts) (wide, spamKept, dedupKept, capped []Reference, final []Reference) {
        dedupAbsorbed = map[string][]string{}
        dedupMetaCheck, spamMetaCheck = 0, 0

        wide = fuseV3(lanes, fuseOpts{
                query: o.query, topN: 100,
                topic: o.topic, category: o.category, lang: o.lang, communityIntent: o.communityIntent,
                authorityBoost: 0.75,
        })
        // spam 双档(镜像)
        spamKept = make([]Reference, 0, len(wide))
        for _, r := range wide {
                if d := matchSpamList(r.URL, spamBlockedDomains); d != "" {
                        spamMetaCheck++
                        continue
                }
                if d := matchSpamList(r.URL, spamDownweightDomains); d != "" {
                        r.Spam = d
                        r.Score += spamDownweightPenalty
                }
                spamKept = append(spamKept, r)
        }
        if spamMetaCheck > 0 {
                sortByScore(spamKept)
        } else {
                for _, r := range spamKept {
                        if r.Spam != "" {
                                sortByScore(spamKept)
                                break
                        }
                }
        }
        // TF 去重(镜像 fuseSemantic 语义去重循环, 记吸收关系)
        dedupKept = []Reference{}
        if len(spamKept) > 1 {
                vecs := make([][]float64, len(spamKept))
                for i, r := range spamKept {
                        vecs[i] = tfVector(r.Title + " " + r.Snippet)
                }
                type keptPair struct {
                        ref Reference
                        vec []float64
                }
                var kept []keptPair
                for i, r := range spamKept {
                        twin := -1
                        for j, k := range kept {
                                if cosine(k.vec, vecs[i]) > 0.75 {
                                        twin = j
                                        break
                                }
                        }
                        if twin >= 0 {
                                dedupMetaCheck++
                                t := &kept[twin].ref
                                kURL := t.URL
                                dedupAbsorbed[kURL] = append(dedupAbsorbed[kURL], r.URL)
                                for _, e := range r.Engines {
                                        if !containsStr(t.Engines, e) {
                                                t.Engines = append(t.Engines, e)
                                        }
                                }
                                if len(r.Snippet) > len(t.Snippet) {
                                        t.Snippet = r.Snippet
                                }
                                if t.Title == "" && r.Title != "" {
                                        t.Title = r.Title
                                }
                                if r.Published > t.Published {
                                        t.Published = r.Published
                                }
                        } else {
                                kept = append(kept, keptPair{ref: r, vec: vecs[i]})
                        }
                }
                for _, k := range kept {
                        dedupKept = append(dedupKept, k.ref)
                }
        } else {
                dedupKept = spamKept
        }
        // domainCap 贪心(镜像)
        capped = dedupKept
        if o.domainCap > 0 {
                seen := map[string]int{}
                capped = make([]Reference, 0, o.topN)
                for _, r := range dedupKept {
                        h := "?"
                        if host := hostOf(r.URL); host != "" {
                                h = registrableDomain(host)
                        }
                        n := seen[h]
                        if n >= o.domainCap {
                                continue
                        }
                        seen[h] = n + 1
                        capped = append(capped, r)
                        if len(capped) >= o.topN {
                                break
                        }
                }
        }
        final = capped
        if len(final) > o.topN {
                final = final[:o.topN]
        }
        return wide, spamKept, dedupKept, capped, final
}

// b36TrackLineage: 单条证据血脉五级追踪。
// wide(fuse 首现吞并文本) → spam(硬屏蔽) → dedup(吸收者接力) → domainCap → topN。
func b36TrackLineage(rawKey string, ev b36RawEv, wide, spamKept, dedupKept, capped []Reference, answers []string, absorbed map[string][]string) b36Track {
        tr := b36Track{RawURL: ev.URL, Holder: rawKey}
        findIdx := func(rs []Reference, key string) int {
                for i := range rs {
                        if rs[i].URL == key {
                                return i
                        }
                }
                return -1
        }
        // 追到血脉载体(吸收链): raw key → (dedup 吸收链终点)
        resolveHolder := func(stage []Reference, key string) (string, int) {
                for hop := 0; hop < 8; hop++ {
                        i := findIdx(stage, key)
                        if i >= 0 {
                                return key, i
                        }
                        // key 被谁吸收
                        next := ""
                        for absorber, victims := range absorbed {
                                for _, v := range victims {
                                        if v == key {
                                                next = absorber
                                                break
                                        }
                                }
                                if next != "" {
                                        break
                                }
                        }
                        if next == "" {
                                return key, -1
                        }
                        key = next
                }
                return key, -1
        }

        // 阶段1: fuse 宽池 — 首现文本是否带证据
        _, wi := resolveHolder(wide, rawKey)
        if wi < 0 {
                tr.LostAt = "fuse-vanished" // 理论不可能(宽池=全部 urlNorm), 防御性记档
                return tr
        }
        tr.Holder = wide[wi].URL
        has, _, _ := b36Evidence(wide[wi].Title, wide[wi].Snippet, "", answers)
        if !has {
                tr.LostAt = "fuse-text-superseded"
                tr.Detail = "URL合并长snippet覆盖: 宽池条目文本=fuseV3 更长snippet胜出规则, 证据文本被同页重复腿的长样板 snippet 顶掉"
                tr.AliveEv = false
                return tr
        }
        // 阶段2: spam 硬屏蔽
        _, si := resolveHolder(spamKept, tr.Holder)
        if si < 0 {
                tr.LostAt = "spam-block"
                if d := matchSpamList(tr.Holder, spamBlockedDomains); d != "" {
                        tr.Domain = d
                }
                return tr
        }
        // 阶段3: TF 去重 — 吸收后长 snippet 覆盖是否丢证据
        _, di := resolveHolder(dedupKept, tr.Holder)
        if di < 0 {
                tr.LostAt = "dedup-vanished"
                return tr
        }
        tr.Holder = dedupKept[di].URL
        has, _, _ = b36Evidence(dedupKept[di].Title, dedupKept[di].Snippet, "", answers)
        if !has {
                tr.LostAt = "dedup-text-superseded"
                tr.Detail = "吸收者 " + dedupKept[di].URL
                return tr
        }
        // 阶段4: domainCap
        _, ci := resolveHolder(capped, tr.Holder)
        if ci < 0 {
                tr.LostAt = "domain-cap"
                if host := hostOf(tr.Holder); host != "" {
                        tr.Domain = registrableDomain(host)
                }
                return tr
        }
        // 阶段5: topN 截断(final=capped 已含截断)
        if ci >= 20 {
                tr.LostAt = "topN-truncation"
                tr.Detail = fmt.Sprintf("宽池终位 %d", ci+1)
                return tr
        }
        tr.AliveEv = true // 存活到交付但整体 fused 无证据 → 上层 INVARIANT-VIOLATION
        return tr
}
