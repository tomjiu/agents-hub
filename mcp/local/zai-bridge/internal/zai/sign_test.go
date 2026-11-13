package zai

import (
	"github.com/local/zai-bridge/internal/config"
	"net/url"
	"strings"
	"testing"
)

func TestSignatureOriginalFrontendVectors(t *testing.T) {
	c := New(config.Default())
	defer c.Close()
	tests := []struct {
		ts           int64
		prompt, want string
	}{
		{1794467000000, "你好", "47c9f993157f06733a6ec93e0c13842c2a0027bac1d1246c9b818b1c6be6eace"},
		{1794467099999, "first", "b8b6d00aae1bc87c94913cbf0a61720874f8a235755564f1feea8621ffd9368a"},
		{1794467100000, strings.Repeat("long ", 14000) + "🐧", "302792a2761a8bf90a985ea922529b55a39a3d6707ab54d01e959ccda7877d78"},
	}
	for _, v := range tests {
		s, e := c.signAt(v.prompt, "chat", v.ts, "00000000-0000-4000-8000-000000000001", "test-user")
		if e != nil {
			t.Fatal(e)
		}
		if s.Signature != v.want {
			t.Fatalf("timestamp %d: got %s want %s", v.ts, s.Signature, v.want)
		}
		q, e := url.ParseQuery(s.URLParams)
		if e != nil {
			t.Fatal(e)
		}
		if q.Get("timestamp") != s.Timestamp || q.Get("requestId") == "" || q.Get("user_id") != "test-user" {
			t.Fatal("signature identity/query mismatch")
		}
	}
}
