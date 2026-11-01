package main

// REST 网关 (对齐 TS http.ts v0.2 — WorkBuddy[07] agentic_search SSE 思想的独立实现)
// 端点(P4):
//   GET  /health      存活探针(免鉴权)
//   GET  /providers   引擎健康(含熔断状态)
//   GET  /stats       计数器快照
//   POST /search      多引擎搜索(JSON)
//   POST /fetch       focus 抓取(JSON)
// P5 排队: POST /research(SSE) / /x_search / /search_cache(依赖持久化缓存)。
// 鉴权: 设了 SC_HTTP_TOKEN 时, 除 /health 外都要 Authorization: Bearer <token>。

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

const maxBody = 1024 * 1024

func sendJSON(w http.ResponseWriter, status int, body any) {
	data, _ := json.MarshalIndent(body, "", " ")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(status)
	_, _ = w.Write(data)
}

func readBody(r *http.Request) (map[string]any, error) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil {
		return nil, fmt.Errorf("read body failed")
	}
	if len(raw) > maxBody {
		return nil, fmt.Errorf("body too large")
	}
	if len(raw) == 0 {
		return map[string]any{}, nil
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("invalid json body")
	}
	return m, nil
}

func authOK(r *http.Request, token string) bool {
	if token == "" {
		return true
	}
	return r.Header.Get("Authorization") == "Bearer "+token
}

func bodyStr(b map[string]any, key string) string {
	if v, ok := b[key].(string); ok {
		return v
	}
	return ""
}

func bodyInt(b map[string]any, key string) int {
	switch v := b[key].(type) {
	case float64:
		return int(v)
	case string:
		n, _ := strconv.Atoi(v)
		return n
	}
	return 0
}

// sseWriter 对齐 TS SseStream: event: <type>\ndata: <json>\n\n + 心跳
type sseWriter struct {
	w       http.ResponseWriter
	flusher http.Flusher
	closed  bool
}

func newSseWriter(w http.ResponseWriter) *sseWriter {
	f, _ := w.(http.Flusher)
	sw := &sseWriter{w: w, flusher: f}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(200)
	_, _ = w.Write([]byte(": search-core-go research stream\n\n"))
	if f != nil {
		f.Flush()
	}
	return sw
}

func (s *sseWriter) event(typ string, data any) {
	if s.closed {
		return
	}
	b, _ := json.Marshal(data)
	_, _ = fmt.Fprintf(s.w, "event: %s\ndata: %s\n\n", typ, b)
	if s.flusher != nil {
		s.flusher.Flush()
	}
}

func (s *sseWriter) end() {
	if s.closed {
		return
	}
	s.event("end", map[string]any{"ok": true})
	s.closed = true
}

func serveHTTPHandler() http.Handler {
	token := os.Getenv("SC_HTTP_TOKEN")
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, req *http.Request) {
		path := req.URL.Path
		if req.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if !authOK(req, token) {
			sendJSON(w, 401, map[string]string{"error": "unauthorized"})
			return
		}
		switch {
		case req.Method == http.MethodGet && path == "/health":
			sendJSON(w, 200, map[string]any{"ok": true, "version": "0.8.1-go", "ts": time.Now().UnixMilli()})
		case req.Method == http.MethodGet && path == "/providers":
			health := NewHealthTracker(dataDir())
			names := make([]string, 0, len(laneRegistry))
			for name := range laneRegistry {
				names = append(names, name)
			}
			sendJSON(w, 200, map[string]any{"providers": health.All(names)})
		case req.Method == http.MethodGet && path == "/stats":
			health := NewHealthTracker(dataDir())
			names := make([]string, 0, len(laneRegistry))
			for name := range laneRegistry {
				names = append(names, name)
			}
			sendJSON(w, 200, map[string]any{
				"lanes":         len(laneRegistry),
				"enginesHealth": health.All(names),
				"cache":         cacheStatsSnapshot(),
			})
		case req.Method == http.MethodPost && path == "/search":
			b, err := readBody(req)
			if err != nil {
				sendJSON(w, 400, map[string]string{"error": err.Error()})
				return
			}
			query := bodyStr(b, "query")
			if query == "" {
				sendJSON(w, 400, map[string]string{"error": "query required"})
				return
			}
			timeout := 6000
			if v := bodyInt(b, "timeout"); v > 0 {
				timeout = v
			}
			opts := SearchOpts{
				Query: query, Lang: bodyStr(b, "lang"),
				TopN: 20, MaxResults: 10, TimeoutMs: timeout,
				Freshness: bodyStr(b, "freshness"),
			}
			if v := bodyInt(b, "top_n"); v > 0 {
				opts.TopN = v
			}
			if v := bodyInt(b, "max_results"); v > 0 {
				opts.MaxResults = v
			}
			if raw, ok := b["engines"].([]any); ok {
				for _, e := range raw {
					if s, ok := e.(string); ok {
						opts.Engines = append(opts.Engines, s)
					}
				}
			}
			sendJSON(w, 200, searchFlow(opts, timeout))
		case req.Method == http.MethodPost && path == "/fetch":
			b, err := readBody(req)
			if err != nil {
				sendJSON(w, 400, map[string]string{"error": err.Error()})
				return
			}
			rawURL := bodyStr(b, "url")
			if rawURL == "" {
				sendJSON(w, 400, map[string]string{"error": "url required"})
				return
			}
			opts := FetchOptions{Focus: bodyStr(b, "focus")}
			if v := bodyInt(b, "max_chars"); v > 0 {
				opts.MaxChars = v
			}
			if v := bodyInt(b, "adjacent"); v > 0 {
				opts.Adjacent = v
			}
			f := newPersistentFetcher(NewJournal(dataDir(), os.Getenv("SC_JOURNAL") != "0"))
			sendJSON(w, 200, f.Run(rawURL, opts, f.policyFor(nil, nil)))
		case req.Method == http.MethodPost && path == "/search_cache":
			b, err := readBody(req)
			if err != nil {
				sendJSON(w, 400, map[string]string{"error": err.Error()})
				return
			}
			hits := searchCacheQuery(bodyStr(b, "query"), func() int {
				if v := bodyInt(b, "limit"); v > 0 {
					return v
				}
				return 10
			}())
			sendJSON(w, 200, map[string]any{"hits": hits, "count": len(hits)})
		case req.Method == http.MethodPost && path == "/x_search":
			b, err := readBody(req)
			if err != nil {
				sendJSON(w, 400, map[string]string{"error": err.Error()})
				return
			}
			query := bodyStr(b, "query")
			if query == "" {
				sendJSON(w, 400, map[string]string{"error": "query required"})
				return
			}
			topN := 20
			if v := bodyInt(b, "top_n"); v > 0 {
				topN = v
			}
			sendJSON(w, 200, xSearchCore(query, topN))
		case req.Method == http.MethodPost && (path == "/research" || path == "/research/resume"):
			b, err := readBody(req)
			if err != nil {
				sendJSON(w, 400, map[string]string{"error": err.Error()})
				return
			}
			sse := newSseWriter(w)
			defer sse.end()
			// 心跳(15s, TS 同款)
			hbStop := make(chan struct{})
			defer close(hbStop)
			go func() {
				t := time.NewTicker(15 * time.Second)
				defer t.Stop()
				for {
					select {
					case <-t.C:
						if !sse.closed {
							_, _ = fmt.Fprint(sse.w, ": hb\n\n")
							if sse.flusher != nil {
								sse.flusher.Flush()
							}
						}
					case <-hbStop:
						return
					}
				}
			}()
			opts := ResearchOptions{Preset: bodyStr(b, "preset")}
			if v := bodyInt(b, "max_loops"); v > 0 {
				opts.MaxLoops = v
			}
			if v := bodyInt(b, "min_facts"); v > 0 {
				opts.MinFacts = v
			}
			if v := bodyInt(b, "fetch_budget"); v > 0 {
				opts.FetchBudget = v
			}
			if v := bodyInt(b, "reference_budget"); v > 0 {
				opts.ReferenceBudget = v
			}
			opts.Strict, _ = b["strict"].(bool)
			if raw, ok := b["angles"].([]any); ok {
				for _, a := range raw {
					if str, ok := a.(string); ok {
						opts.Angles = append(opts.Angles, str)
					}
				}
			}
			opts.Freshness = bodyStr(b, "freshness")
			onEvent := func(ev map[string]any) {
				typ, _ := ev["type"].(string)
				sse.event(typ, ev)
			}
			fetcher := newPersistentFetcher(nil)
			loop := NewResearchLoop(dataDir(), fetcher)
			var res *ResearchResult
			var err2 error
			if path == "/research/resume" {
				res, err2 = loop.Resume(bodyStr(b, "run_id"), opts, onEvent)
			} else {
				res, err2 = loop.Run(bodyStr(b, "query"), opts, onEvent)
			}
			if err2 != nil {
				sse.event("error", map[string]string{"error": err2.Error()})
				return
			}
			sse.event("result", map[string]any{
				"runId": res.RunID, "report": res.Report, "facts": len(res.Facts),
				"refs": len(res.Refs), "loops": len(res.Loops), "stop": res.Stop,
				"stats": res.Stats, "journalPath": res.JournalPath,
			})
		default:
			sendJSON(w, 404, map[string]string{"error": fmt.Sprintf("no route: %s %s", req.Method, path)})
		}
	})
	return mux
}

func cmdServeHTTP(rest []string) {
	_, flags := parseFlags(rest)
	port := 8787
	if v := os.Getenv("SC_HTTP_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			port = n
		}
	}
	if v, err := strconv.Atoi(flags["port"]); err == nil && v > 0 {
		port = v
	}
	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", port),
		Handler:           serveHTTPHandler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	fmt.Fprintf(os.Stderr, "search-core-go http gateway on :%d (P5: POST /research SSE)\n", port)
	if err := srv.ListenAndServe(); err != nil {
		fmt.Fprintln(os.Stderr, "http server:", err)
		os.Exit(1)
	}
}

var _ = strings.TrimSpace // 保留 import 对齐
