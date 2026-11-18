package mcp

import "testing"

func TestHumanBytes(t *testing.T) {
	cases := []struct {
		n    int64
		want string
	}{
		{0, "0 B"},
		{512, "512 B"},
		{1024, "1.0 KB"},
		{1536, "1.5 KB"},
		{2147483648, "2.0 GB"},
	}
	for _, c := range cases {
		if got := humanBytes(c.n); got != c.want {
			t.Errorf("humanBytes(%d) = %q, want %q", c.n, got, c.want)
		}
	}
}

func TestIsProbablyText(t *testing.T) {
	if !isProbablyText([]byte("hello world")) {
		t.Error("纯文本被判成二进制")
	}
	if isProbablyText([]byte{0x89, 0x50, 0x00, 0x47}) {
		t.Error("含 NUL 的二进制被判成文本")
	}
}
