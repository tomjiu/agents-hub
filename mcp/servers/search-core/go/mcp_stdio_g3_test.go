package main

// G3 (issue #3 评论): stdio MCP 协议实测 — initialize / tools/list / tools/call /
// notifications/cancelled 通过真实 serveMcpStdio 循环 (stdin/stdout 管道替换, 非子进程、非 mock)。

import (
	"bufio"
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// mcpPipeSession: 把 serveMcpStdio 跑在 goroutine, 用管道对话
type mcpPipeSession struct {
	t       *testing.T
	stdinW  *os.File
	stdoutR *os.File
	restore func()
	reads   chan string
}

func startMcpSession(t *testing.T) *mcpPipeSession {
	t.Helper()
	oldIn, oldOut := os.Stdin, os.Stdout
	rIn, wIn, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	rOut, wOut, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdin, os.Stdout = rIn, wOut
	s := &mcpPipeSession{t: t, stdinW: wIn, stdoutR: rOut,
		restore: func() { os.Stdin, os.Stdout = oldIn, oldOut },
		reads:   make(chan string, 64)}
	go serveMcpStdio()
	go func() {
		sc := bufio.NewScanner(rOut)
		sc.Buffer(make([]byte, 1024*1024), 1024*1024)
		for sc.Scan() {
			s.reads <- sc.Text()
		}
		close(s.reads)
	}()
	t.Cleanup(func() {
		s.stdinW.Close() // EOF 终止 serveMcpStdio goroutine
		s.restore()
	})
	return s
}

func (s *mcpPipeSession) send(line string) {
	s.t.Helper()
	if _, err := s.stdinW.WriteString(line + "\n"); err != nil {
		s.t.Fatalf("send: %v", err)
	}
}

func (s *mcpPipeSession) recv(timeout time.Duration) map[string]any {
	s.t.Helper()
	select {
	case line, ok := <-s.reads:
		if !ok {
			s.t.Fatal("stdout closed")
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			s.t.Fatalf("bad json %q: %v", line, err)
		}
		return m
	case <-time.After(timeout):
		s.t.Fatal("timeout waiting for response")
		return nil
	}
}

func (s *mcpPipeSession) recvID(id string, timeout time.Duration) map[string]any {
	s.t.Helper()
	deadline := time.After(timeout)
	for {
		select {
		case line, ok := <-s.reads:
			if !ok {
				s.t.Fatal("stdout closed")
			}
			var m map[string]any
			if err := json.Unmarshal([]byte(line), &m); err != nil {
				continue
			}
			if fmtID(m["id"]) == id {
				return m
			}
		case <-deadline:
			s.t.Fatal("timeout waiting for id " + id)
			return nil
		}
	}
}

func fmtID(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func TestMcpStdioFullProtocol(t *testing.T) {
	s := startMcpSession(t)

	// 1) initialize
	s.send(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"g3test","version":"0"}}}`)
	m := s.recvID("1", 5*time.Second)
	res, _ := m["result"].(map[string]any)
	if res == nil || res["protocolVersion"] != "2024-11-05" {
		t.Fatalf("initialize result: %v", m)
	}
	si, _ := res["serverInfo"].(map[string]any)
	if si == nil || si["name"] != "search-core-go" {
		t.Fatalf("serverInfo: %v", si)
	}

	// 2) initialized notification (无响应)
	s.send(`{"jsonrpc":"2.0","method":"notifications/initialized"}`)

	// 3) tools/list — schema 稳定 (DSH 依赖)
	s.send(`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	m = s.recvID("2", 5*time.Second)
	res, _ = m["result"].(map[string]any)
	tools, _ := res["tools"].([]any)
	names := map[string]bool{}
	for _, tv := range tools {
		tt, _ := tv.(map[string]any)
		names[tt["name"].(string)] = true
	}
	for _, want := range []string{"search", "fetch", "search_providers", "search_cache"} {
		if !names[want] {
			t.Fatalf("tool %q missing from tools/list: %v", want, names)
		}
	}

	// 4) tools/call search — 未注册引擎名 (hermetic: 零网络, skipped 报账)
	s.send(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search","arguments":{"query":"test query","engines":["g3-no-such-engine"]}}}`)
	m = s.recvID("3", 15*time.Second)
	res, _ = m["result"].(map[string]any)
	if isErr, _ := res["isError"].(bool); isErr {
		t.Fatalf("unregistered engine should be skipped not error: %v", m)
	}
	content, _ := res["content"].([]any)
	if len(content) == 0 {
		t.Fatal("empty content")
	}
	// 返回的 Output JSON: 空 refs + enginesFailed 报账 skipped
	txt := content[0].(map[string]any)["text"].(string)
	var out Output
	if err := json.Unmarshal([]byte(txt), &out); err != nil {
		t.Fatalf("search output not valid Output json: %v", err)
	}
	if len(out.Refs) != 0 {
		t.Fatalf("unregistered engine must yield zero refs, got %d", len(out.Refs))
	}

	// 5) unknown method → -32601
	s.send(`{"jsonrpc":"2.0","id":4,"method":"no/such/method"}`)
	m = s.recvID("4", 5*time.Second)
	if m["error"] == nil {
		t.Fatalf("unknown method must error: %v", m)
	}
}

func TestMcpStdioCancellationDoesNotBlockLoop(t *testing.T) {
	// 取消语义: 长调用在飞时, 后续请求仍被处理 (异步派发);
	// notifications/cancelled 不崩、已结算请求的迟到取消被忽略。
	s := startMcpSession(t)
	s.send(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"g3test","version":"0"}}}`)
	s.recvID("1", 5*time.Second)

	// 发一个会慢的搜索 (软截止内阻塞: 未注册引擎 + 长超时 → 立即返回; 改用 wikipedia 触发网络等待不可靠。
	// 用缓存命中的慢路径不可控 — 改为并发 tools/list 验证非阻塞派发本身)
	s.send(`{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"search","arguments":{"query":"g3 cancel probe","engines":[]}}}`)
	s.send(`{"jsonrpc":"2.0","id":11,"method":"tools/list"}`)

	// id=11 的响应必须能先于/独立于 id=10 到达 (异步派发证明)
	m := s.recvID("11", 5*time.Second)
	if m["result"] == nil {
		t.Fatalf("tools/list blocked behind in-flight call: %v", m)
	}
	m10 := s.recvID("10", 15*time.Second)
	res, _ := m10["result"].(map[string]any)
	content, _ := res["content"].([]any)
	txt := content[0].(map[string]any)["text"].(string)
	var out Output
	if err := json.Unmarshal([]byte(txt), &out); err != nil {
		t.Fatalf("engines:[] output: %v", err)
	}
	if len(out.Refs) != 0 {
		t.Fatalf("explicit empty engines through MCP must be zero refs, got %d", len(out.Refs))
	}

	// 迟到取消 (id=10 已结算) — 必须被忽略且不崩
	s.send(`{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":10,"reason":"late"}}`)
	// 循环仍存活
	s.send(`{"jsonrpc":"2.0","id":12,"method":"ping"}`)
	m = s.recvID("12", 5*time.Second)
	if m["result"] == nil {
		t.Fatal("loop dead after cancelled notification")
	}
}

func TestMcpStdioConcurrentCalls(t *testing.T) {
	s := startMcpSession(t)
	s.send(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"g3test","version":"0"}}}`)
	s.recvID("1", 5*time.Second)

	// 8 个并发 search 调用 (未注册引擎, hermetic) — 全部独立回流
	var wg sync.WaitGroup
	for i := 100; i < 108; i++ {
		s.send(`{"jsonrpc":"2.0","id":` + strconv.Itoa(i) + `,"method":"tools/call","params":{"name":"search","arguments":{"query":"concurrent ` + strconv.Itoa(i) + `","engines":["none-` + strconv.Itoa(i) + `"]}}}`)
		wg.Add(1)
	}
	got := 0
	deadline := time.After(20 * time.Second)
	for got < 8 {
		select {
		case line, ok := <-s.reads:
			if !ok {
				t.Fatal("stdout closed early")
			}
			var m map[string]any
			if json.Unmarshal([]byte(line), &m) == nil && strings.HasPrefix(fmtID(m["id"]), "1") && m["result"] != nil {
				got++
				wg.Done()
			}
		case <-deadline:
			t.Fatalf("only %d/8 responses", got)
		}
	}
	wg.Wait()
}
