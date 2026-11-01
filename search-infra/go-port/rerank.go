// rerank.go — 批 27: cross-encoder 语义重排 (SC_RERANK 开关, 增强模式)
//
// 背景: b20 零模型 embedding 实测吃不动 (TF-hash 词面模型无效); b25 结构归因发现
// "位次保持" (gold 稳定在 2-10 位) 占 miss@1 的 61.8%; b26 离线重放实测 ms-marco
// MiniLM cross-encoder 对该池救回 60.6%、全量 hit@1 +17.1pp 双集同向 → 挂账击发转正。
//
// 集成位置: fuseSemantic 之后 / b19AnswerPass 之前 — 打分对象 (title+snippet) 与
// 离线重放口径逐字一致 (b26 口径保真)。
//
// 融合变体: lin-λ 增量式 newKey = score*10 + λ·cs (λ 缺省 4, b26 裁决首选) —
// 保住融合分基底 (RRF+词面+共识+权威分), cross-encoder 只作增量信号, b20 方法论复用。
//
// 依赖 (全部可选, 缺省零依赖底盘不变):
//
//	SC_RERANK=1        启用 (缺省/"0" 关闭)
//	SC_RERANK_LIB      libonnxruntime.so 路径 (如 /opt/ort/libonnxruntime.so)
//	SC_RERANK_MODEL    model_quantized.onnx 路径 (ms-marco-MiniLM-L-6-v2 quantized, 22MB)
//	SC_RERANK_VOCAB    tokenizer.json 路径 (Xenova 格式, 取 model.vocab)
//	SC_RERANK_POOL     重排池深度 (缺省 10, 与外部评测 topn=10 同口径)
//	SC_RERANK_LAMBDA   增量系数 λ (缺省 4)
//
// 三个路径任一缺失或初始化失败 → 本进程优雅回退原序 (log 一次, 不重试), 查询永不失败。
//
// tokenizer: lowercase + NFD 剥重音 (strip_accents) + 标点切分 (含 Sk 类补齐) +
// WordPiece, 与 HF BertNormalizer/BertPreTokenizer 同序等价 — golden 对拍 12 组逐 id 一致。
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	ort "github.com/yalue/onnxruntime_go"
	"golang.org/x/text/unicode/norm"
)

// ---------- 全局会话 (lazy init, 一次) ----------

var (
	rerankMu       sync.Mutex
	rerankSession  *ort.DynamicAdvancedSession
	rerankVocab    map[string]int
	rerankUNK      int = 100
	rerankCLS      int = 101
	rerankSEP      int = 102
	rerankState        = rerankUninit
	rerankLastErr  string
	rerankInitOnce sync.Once
)

const (
	rerankUninit = iota
	rerankReady
	rerankFailed
)

const rerankMaxLen = 512 // BERT pair 联合截断上限

// rerankEnabled: SC_RERANK=1 且未失败。路径缺失在 init 时判失败。
func rerankEnabled() bool { return os.Getenv("SC_RERANK") == "1" && rerankState != rerankFailed }

// rerankInit lazy 加载 runtime+模型+vocab; 任一步失败 → rerankFailed (进程内不重试)。
func rerankInit() error {
	rerankInitOnce.Do(func() {
		lib := strings.TrimSpace(os.Getenv("SC_RERANK_LIB"))
		model := strings.TrimSpace(os.Getenv("SC_RERANK_MODEL"))
		vocabF := strings.TrimSpace(os.Getenv("SC_RERANK_VOCAB"))
		if lib == "" || model == "" || vocabF == "" {
			rerankState = rerankFailed
			rerankLastErr = "SC_RERANK_LIB/MODEL/VOCAB 未配置"
			return
		}
		data, err := os.ReadFile(vocabF)
		if err != nil {
			rerankState = rerankFailed
			rerankLastErr = fmt.Sprintf("vocab 读取失败: %v", err)
			return
		}
		var tj struct {
			Model struct {
				Vocab map[string]int `json:"vocab"`
			} `json:"model"`
		}
		if err := json.Unmarshal(data, &tj); err != nil || len(tj.Model.Vocab) == 0 {
			rerankState = rerankFailed
			rerankLastErr = fmt.Sprintf("vocab 解析失败: %v", err)
			return
		}
		rerankVocab = tj.Model.Vocab
		if id, ok := rerankVocab["[UNK]"]; ok {
			rerankUNK = id
		}
		if id, ok := rerankVocab["[CLS]"]; ok {
			rerankCLS = id
		}
		if id, ok := rerankVocab["[SEP]"]; ok {
			rerankSEP = id
		}
		ort.SetSharedLibraryPath(lib)
		if err := ort.InitializeEnvironment(); err != nil {
			rerankState = rerankFailed
			rerankLastErr = fmt.Sprintf("onnxruntime 初始化失败: %v", err)
			return
		}
		// intra-op 线程数: 缺省跟 CPU 核数 (b28: 单线程 batch 打分 ~140ms, 多线程压延迟)
		sOpts, err := ort.NewSessionOptions()
		if err != nil {
			rerankState = rerankFailed
			rerankLastErr = fmt.Sprintf("session options 创建失败: %v", err)
			return
		}
		defer sOpts.Destroy()
		threads := runtime.NumCPU()
		if v := strings.TrimSpace(os.Getenv("SC_RERANK_THREADS")); v != "" {
			if p, err := strconv.Atoi(v); err == nil && p >= 1 && p <= 16 {
				threads = p
			}
		}
		if err := sOpts.SetIntraOpNumThreads(threads); err != nil {
			rerankState = rerankFailed
			rerankLastErr = fmt.Sprintf("设置线程数失败: %v", err)
			return
		}
		s, err := ort.NewDynamicAdvancedSession(model,
			[]string{"input_ids", "attention_mask", "token_type_ids"},
			[]string{"logits"}, sOpts)
		if err != nil {
			rerankState = rerankFailed
			rerankLastErr = fmt.Sprintf("session 创建失败: %v", err)
			return
		}
		rerankSession = s
		rerankState = rerankReady
	})
	if rerankState != rerankReady {
		return fmt.Errorf("%s", rerankLastErr)
	}
	return nil
}

// ---------- BERT tokenizer (basic + WordPiece, pair 编码) ----------

func isCJKChar(r rune) bool {
	return (r >= 0x4E00 && r <= 0x9FFF) || (r >= 0x3400 && r <= 0x4DBF) ||
		(r >= 0x20000 && r <= 0x2A6DF) || (r >= 0x2A700 && r <= 0x2CEAF) ||
		(r >= 0xF900 && r <= 0xFAFF) || (r >= 0x2F800 && r <= 0x2FA1F)
}

func isPunctRune(r rune) bool {
	if unicode.IsPunct(r) {
		return true
	}
	// HF BertPreTokenizer 的 is_punct 含 ASCII punctuation 全集 — 其中 Sk 类符号
	// ($ + < = > ^ ` | ~) 不在 Go unicode.IsPunct (P 类) 内, 显式补齐。
	// 实锤案例: '^' (U+005E, Sk) 未切开导致 golden case 3 对拍失败。
	switch r {
	case '$', '+', '<', '>', '=', '|', '~', '^', '`':
		return true
	}
	return false
}

// stripAccents: NFD 分解后删除组合记号 (Mn), 与 HF BertNormalizer strip_accents 一致。
func stripAccents(s string) string {
	decomposed := norm.NFD.String(s)
	var b strings.Builder
	b.Grow(len(decomposed))
	for _, r := range decomposed {
		if !unicode.Is(unicode.Mn, r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// bertNormalize: clean_text (删控制字符) + handle_chinese_chars (CJK 两侧加空格)
// + 空白规整 + strip_accents (NFD 后删 Mn) + lowercase — HF BertNormalizer 同序等价。
func bertNormalize(s string) string {
	s = norm.NFD.String(s)
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch {
		case r == 0 || r == 0xFFFD || r == 0x7f || (r < 0x20 && r != '\t' && r != '\n' && r != '\r'):
			// clean_text: 删控制字符
		case isCJKChar(r):
			b.WriteRune(' ')
			b.WriteRune(unicode.ToLower(r))
			b.WriteRune(' ') // HF 每 char 独立加前后空格 → 相邻 CJK 间双空格 (pre-tokenize 等价)
		case r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == 0x0b || r == 0x0c:
			b.WriteRune(' ')
		case unicode.Is(unicode.Mn, r):
			// strip_accents: 删组合记号
		default:
			b.WriteRune(unicode.ToLower(r))
		}
	}
	return b.String()
}

// bertPreTokenize: 空白切分 + 标点独立切分 (BertPreTokenizer)。
func bertPreTokenize(s string) []string {
	var out []string
	for _, field := range strings.FieldsFunc(s, func(r rune) bool { return r == ' ' }) {
		runes := []rune(field)
		start := 0
		for i := 0; i < len(runes); i++ {
			if isPunctRune(runes[i]) {
				if i > start {
					out = append(out, string(runes[start:i]))
				}
				out = append(out, string(runes[i]))
				start = i + 1
			}
		}
		if start < len(runes) {
			out = append(out, string(runes[start:]))
		}
	}
	return out
}

// wordPiece: 贪心最长匹配, "##" 前缀, 超 100 rune 整词 [UNK]。
func wordPiece(token string, vocab map[string]int, unkID int) []int {
	if utf8.RuneCountInString(token) > 100 {
		return []int{unkID}
	}
	runes := []rune(token)
	var ids []int
	for start := 0; start < len(runes); {
		end := len(runes)
		cur := -1
		for end > start {
			sub := string(runes[start:end])
			if start > 0 {
				sub = "##" + sub
			}
			if id, ok := vocab[sub]; ok {
				cur = id
				break
			}
			end--
		}
		if cur == -1 {
			return []int{unkID}
		}
		ids = append(ids, cur)
		start = end
	}
	return ids
}

// encodePair: [CLS] q [SEP] d [SEP]; 总长超 512 从 d 尾部截 (q 短 d 长的
// longest_first 等价形态, golden case 12 对拍验证)。
func encodePair(q, d string, vocab map[string]int, unkID int) (ids, types []int) {
	qIds := []int{}
	for _, t := range bertPreTokenize(bertNormalize(q)) {
		qIds = append(qIds, wordPiece(t, vocab, unkID)...)
	}
	dIds := []int{}
	for _, t := range bertPreTokenize(bertNormalize(d)) {
		dIds = append(dIds, wordPiece(t, vocab, unkID)...)
	}
	budget := rerankMaxLen - 3 // [CLS] + 2×[SEP]
	if len(qIds) > budget {
		qIds = qIds[:budget]
	}
	if len(qIds)+len(dIds) > budget {
		dIds = dIds[:budget-len(qIds)]
	}
	ids = append(ids, rerankCLS)
	types = append(types, 0)
	ids = append(ids, qIds...)
	for range qIds {
		types = append(types, 0)
	}
	ids = append(ids, rerankSEP)
	types = append(types, 0)
	ids = append(ids, dIds...)
	for range dIds {
		types = append(types, 1)
	}
	ids = append(ids, rerankSEP)
	types = append(types, 1)
	return ids, types
}

// ---------- ONNX 打分 ----------

// rerankScores: 对 (query, docs) 批量打分, 返回 raw logits (越大越相关)。
// mutex 串行 (v1: 单查询一次 batch 调用, 并发查询排队; 挂账: 多 session 并行)。
func rerankScores(q string, docs []string) ([]float32, error) {
	if err := rerankInit(); err != nil {
		return nil, err
	}
	n := len(docs)
	if n == 0 {
		return nil, nil
	}
	// 先编码收集 (每 doc 长度可不同), 再摊平成 batch (统一 padding 到最长)
	pairs := make([][]int, 0, n)
	pairTypes := make([][]int, 0, n)
	maxLen := 0
	for _, d := range docs {
		ids, types := encodePair(q, d, rerankVocab, rerankUNK)
		pairs = append(pairs, ids)
		pairTypes = append(pairTypes, types)
		if len(ids) > maxLen {
			maxLen = len(ids)
		}
	}
	flatIds := make([]int64, n*maxLen)
	flatTypes := make([]int64, n*maxLen)
	flatMask := make([]int64, n*maxLen)
	for i := 0; i < n; i++ {
		L := len(pairs[i])
		for j := 0; j < L; j++ {
			flatIds[i*maxLen+j] = int64(pairs[i][j])
			flatTypes[i*maxLen+j] = int64(pairTypes[i][j])
			flatMask[i*maxLen+j] = 1
		}
		// padding 部分 (j>=L) 全 0: attention_mask=0 屏蔽
	}
	shape := ort.NewShape(int64(n), int64(maxLen))
	tIds, err := ort.NewTensor(shape, flatIds)
	if err != nil {
		return nil, err
	}
	defer tIds.Destroy()
	tTypes, err := ort.NewTensor(shape, flatTypes)
	if err != nil {
		return nil, err
	}
	defer tTypes.Destroy()
	tMask, err := ort.NewTensor(shape, flatMask)
	if err != nil {
		return nil, err
	}
	defer tMask.Destroy()

	rerankMu.Lock()
	defer rerankMu.Unlock()
	// v1.36 API: 输出需预分配 (logits shape: [n, 1])
	tOut, err := ort.NewTensor(ort.NewShape(int64(n), 1), make([]float32, n))
	if err != nil {
		return nil, err
	}
	defer tOut.Destroy()
	if err := rerankSession.Run([]ort.Value{tIds, tMask, tTypes}, []ort.Value{tOut}); err != nil {
		return nil, err
	}
	src := tOut.GetData()
	out := make([]float32, n)
	copy(out, src)
	return out, nil
}

// ---------- 融合重排 (lin-λ 增量式) ----------

// rerankOrderBy: lin-λ 融合序 (纯函数, 单测覆盖) — key = score*10 + λ·cs 稳定降序。
// 返回长度 = len(pool); pool 内部按新序, pool 尾部自然保持原序。
func rerankOrderBy(pool []Reference, cs []float32, lambda float64) []Reference {
	key := make([]float64, len(pool))
	for i := range pool {
		key[i] = pool[i].Score*10 + lambda*float64(cs[i])
	}
	idx := make([]int, len(pool))
	for i := range idx {
		idx[i] = i
	}
	// 稳定降序: 同 key 保持原相对序 (原 rank tie-break, 与离线重放一致)
	sort.SliceStable(idx, func(a, b int) bool { return key[idx[a]] > key[idx[b]] })
	out := make([]Reference, len(pool))
	for i, j := range idx {
		out[i] = pool[j]
	}
	return out
}

// rerankRefs: SC_RERANK=1 时对 refs 前 poolN 位做 cross-encoder 重排。
// newKey = score*10 + λ·cs (与 b26 离线重放 lin-λ 变体逐字一致); 失败/关闭 → 原序返回。
// 返回 (refs, 是否实际重排, 耗时)。
func rerankRefs(refs []Reference, query string, j *Journal) ([]Reference, bool, time.Duration) {
	if !rerankEnabled() || len(refs) < 2 {
		return refs, false, 0
	}
	poolN := 10
	if v := strings.TrimSpace(os.Getenv("SC_RERANK_POOL")); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p >= 1 && p <= len(refs) {
			poolN = p
		}
	}
	lambda := 4.0
	if v := strings.TrimSpace(os.Getenv("SC_RERANK_LAMBDA")); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil && f >= 0 && f <= 20 {
			lambda = f
		}
	}
	if len(refs) < poolN {
		poolN = len(refs)
	}
	pool := refs[:poolN]
	docs := make([]string, poolN)
	for i, r := range pool {
		docs[i] = r.Title + "\n" + r.Snippet
	}
	t0 := time.Now()
	cs, err := rerankScores(query, docs)
	wall := time.Since(t0)
	if err != nil || len(cs) != poolN {
		if rerankLastErr == "" {
			rerankLastErr = fmt.Sprintf("rerankScores: %v", err)
		}
		// 静默回退会掩盖初始化/推理故障 (b27 实弹曾因此把回退误判为重排生效), stderr 必打
		fmt.Fprintf(os.Stderr, "[rerank] 失败回退原序: %v\n", err)
		return refs, false, wall // 优雅回退原序
	}
	reordered := rerankOrderBy(pool, cs, lambda)
	out := append(reordered, refs[poolN:]...)
	if j != nil {
		j.Write("rerank", map[string]any{
			"pool": poolN, "lambda": lambda, "wallMs": wall.Milliseconds(),
		})
	}
	return out, true, wall
}
