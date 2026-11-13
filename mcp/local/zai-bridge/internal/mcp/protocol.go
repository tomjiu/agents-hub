// Package mcp implements the bounded JSON-RPC stdio transport.
package mcp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sync"
)

const JSONRPCVersion = "2.0"

type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}
type Response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Result  any             `json:"result,omitempty"`
	Error   *RPCError       `json:"error,omitempty"`
}
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

func (e *RPCError) Error() string { return fmt.Sprintf("%s (code %d)", e.Message, e.Code) }

const (
	CodeParseError       = -32700
	CodeInvalidRequest   = -32600
	CodeMethodNotFound   = -32601
	CodeInvalidParams    = -32602
	CodeInternalError    = -32603
	CodeServerBusy       = -32000
	CodeRequestCancelled = -32800
)

// Handler is retained for callers that do not need cancellation.
type Handler func(json.RawMessage) (any, *RPCError)

// ContextHandler receives the request context, cancelled by MCP notifications
// or server shutdown. Register handlers before calling Serve.
type ContextHandler func(context.Context, json.RawMessage) (any, *RPCError)
type Server struct {
	handlers               map[string]ContextHandler
	hmu                    sync.RWMutex
	wmu                    sync.Mutex
	out                    io.Writer
	workers, queueCapacity int
}

func NewServer(out io.Writer) *Server {
	s, _ := NewServerWithLimits(out, 8, 64)
	return s
}

// NewServerWithLimits bounds both workers and queued requests. A zero queue is
// valid; negative values are rejected rather than passed to make(chan).
func NewServerWithLimits(out io.Writer, workers, queueCapacity int) (*Server, error) {
	if out == nil || workers < 1 || workers > 1024 || queueCapacity < 0 || queueCapacity > 65536 {
		return nil, fmt.Errorf("invalid MCP limits: workers >= 1, queue >= 0 and writer required")
	}
	return &Server{handlers: make(map[string]ContextHandler), out: out, workers: workers, queueCapacity: queueCapacity}, nil
}
func (s *Server) Register(method string, h Handler) {
	s.RegisterContext(method, func(_ context.Context, raw json.RawMessage) (any, *RPCError) { return h(raw) })
}
func (s *Server) RegisterContext(method string, h ContextHandler) {
	s.hmu.Lock()
	defer s.hmu.Unlock()
	s.handlers[method] = h
}
func (s *Server) handler(method string) ContextHandler {
	s.hmu.RLock()
	defer s.hmu.RUnlock()
	return s.handlers[method]
}
func (s *Server) Serve(in io.Reader) error { return s.ServeContext(context.Background(), in) }

// ServeContext drains accepted requests on EOF. Root cancellation cancels all
// accepted requests and closes a closable input (stdin in main) to unblock read.
// A non-closable Reader must itself be interruptible by its owner.
func (s *Server) ServeContext(root context.Context, in io.Reader) error {
	ctx, stop := context.WithCancel(root)
	defer stop()
	type incoming struct {
		raw []byte
		err error
		eof bool
	}
	lines := make(chan incoming, 1)
	go func() {
		rd := bufio.NewScanner(in)
		rd.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
		for rd.Scan() {
			line := append([]byte(nil), rd.Bytes()...)
			select {
			case lines <- incoming{raw: line}:
			case <-ctx.Done():
				return
			}
		}
		select {
		case lines <- incoming{err: rd.Err(), eof: true}:
		case <-ctx.Done():
		}
	}()
	type job struct {
		req    Request
		key    string
		ctx    context.Context
		cancel context.CancelFunc
	}
	jobs := make(chan job, s.queueCapacity)
	active := make(map[string]context.CancelFunc)
	var mu sync.Mutex
	var wg sync.WaitGroup
	finish := func(j job) {
		j.cancel()
		mu.Lock()
		delete(active, j.key)
		mu.Unlock()
	}
	invoke := func(j job) {
		defer finish(j)
		resp := Response{JSONRPC: JSONRPCVersion, ID: j.req.ID}
		func() {
			defer func() {
				if p := recover(); p != nil {
					resp.Error = &RPCError{Code: CodeInternalError, Message: "handler panic"}
				}
			}()
			if err := j.ctx.Err(); err != nil {
				resp.Error = &RPCError{Code: CodeRequestCancelled, Message: err.Error()}
				return
			}
			h := s.handler(j.req.Method)
			if h == nil {
				resp.Error = &RPCError{Code: CodeMethodNotFound, Message: "unknown method: " + j.req.Method}
				return
			}
			resp.Result, resp.Error = h(j.ctx, j.req.Params)
			if err := j.ctx.Err(); err != nil {
				// Tool errors may contain a stable submission id and partial output.
				tool, recoverable := resp.Result.(*CallToolResult)
				if recoverable && (tool.IsError || tool.SubmissionID != "") {
					tool.IsError = true
				} else {
					resp.Result = nil
					resp.Error = &RPCError{Code: CodeRequestCancelled, Message: err.Error()}
				}
			}
		}()
		s.write(resp)
	}
	for i := 0; i < s.workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				invoke(j)
			}
		}()
	}
	defer func() { close(jobs); wg.Wait() }()
	reject := func(id json.RawMessage, code int, message string) {
		if len(id) == 0 {
			id = json.RawMessage("null")
		}
		s.write(Response{JSONRPC: JSONRPCVersion, ID: id, Error: &RPCError{Code: code, Message: message}})
	}
	for {
		select {
		case <-ctx.Done():
			if closer, ok := in.(io.Closer); ok {
				_ = closer.Close()
			}
			return ctx.Err()
		case line := <-lines:
			if line.eof {
				return line.err
			}
			if len(bytes.TrimSpace(line.raw)) == 0 {
				continue
			}
			var req Request
			if err := json.Unmarshal(line.raw, &req); err != nil {
				reject(nil, CodeParseError, "invalid JSON: "+err.Error())
				continue
			}
			if req.JSONRPC != JSONRPCVersion || req.Method == "" {
				reject(req.ID, CodeInvalidRequest, "invalid JSON-RPC request")
				continue
			}
			if len(req.ID) == 0 {
				if req.Method == "notifications/cancelled" {
					var p struct {
						RequestID json.RawMessage `json:"requestId"`
					}
					if json.Unmarshal(req.Params, &p) == nil {
						if key, ok := requestKey(p.RequestID); ok {
							mu.Lock()
							cancel := active[key]
							mu.Unlock()
							if cancel != nil {
								cancel()
							}
						}
					}
				}
				continue
			}
			key, ok := requestKey(req.ID)
			if !ok {
				reject(req.ID, CodeInvalidRequest, "request id must be a string or integer")
				continue
			}
			requestCtx, cancel := context.WithCancel(ctx)
			j := job{req: req, key: key, ctx: requestCtx, cancel: cancel}
			mu.Lock()
			_, duplicate := active[key]
			if !duplicate {
				active[key] = cancel
			}
			mu.Unlock()
			if duplicate {
				cancel()
				reject(req.ID, CodeInvalidRequest, "duplicate in-flight request id")
				continue
			}
			// Handshake is a reader barrier: later requests cannot overtake initialize.
			// Ping stays responsive even when all long-running workers are occupied.
			if req.Method == "initialize" || req.Method == "ping" {
				invoke(j)
				continue
			}
			select {
			case jobs <- j:
			default:
				finish(j)
				reject(req.ID, CodeServerBusy, "MCP request queue is full; retry later")
			}
		}
	}
}
func requestKey(raw json.RawMessage) (string, bool) {
	var value any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if dec.Decode(&value) != nil {
		return "", false
	}
	switch v := value.(type) {
	case string:
		encoded, _ := json.Marshal(v)
		return "s:" + string(encoded), true
	case json.Number:
		if bytes.ContainsAny([]byte(v), ".eE") {
			return "", false
		}
		if v.String() == "-0" {
			return "n:0", true
		}
		return "n:" + v.String(), true
	default:
		return "", false
	}
}
func (s *Server) write(resp Response) {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	raw, err := json.Marshal(resp)
	if err != nil {
		raw, _ = json.Marshal(Response{JSONRPC: JSONRPCVersion, ID: resp.ID, Error: &RPCError{Code: CodeInternalError, Message: "cannot encode response"}})
	}
	_, _ = s.out.Write(append(raw, '\n'))
}

type ToolDef struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}
type TextContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}
type CallToolResult struct {
	SubmissionID string        `json:"-"`
	Content      []TextContent `json:"content"`
	IsError      bool          `json:"isError,omitempty"`
}
