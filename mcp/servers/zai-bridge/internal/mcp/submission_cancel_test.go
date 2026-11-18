package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/local/zai-bridge/internal/zai"
	"strings"
	"testing"
)

func TestCancellationAfterSubmissionKeepsSuccessfulMessageID(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var out bytes.Buffer
	s := NewServer(&out)
	s.RegisterContext("send", func(context.Context, json.RawMessage) (any, *RPCError) {
		r := submissionResult("message_id: stable-id\npartial output", &zai.SendResult{MessageID: "stable-id", State: "running"})
		cancel()
		return r, nil
	})
	_ = s.ServeContext(ctx, strings.NewReader("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"send\"}\n"))
	if !strings.Contains(out.String(), "stable-id") || !strings.Contains(out.String(), "\"isError\":true") {
		t.Fatalf("accepted id lost on cancellation: %s", out.String())
	}
}
