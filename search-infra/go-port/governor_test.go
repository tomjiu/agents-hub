package main

import "testing"

// SSRF/域名治理/预算/失败分类 单测(对齐 TS governor.test 语义)

func TestValidateUrlProtocolPort(t *testing.T) {
	if _, err := validateUrl("ftp://example.com/x", nil); err == nil {
		t.Fatal("ftp 应被拒")
	}
	if _, err := validateUrl("http://example.com:22/x", nil); err == nil {
		t.Fatal("port 22 应被拒")
	}
	for _, p := range []string{"", "80", "443", "8080", "8443"} {
		u := "http://example.com"
		if p != "" {
			u += ":" + p
		}
		if _, err := validateUrl(u+"/x", nil); err != nil {
			t.Fatalf("port %q 应放行: %v", p, err)
		}
	}
	// 默认端口补齐: https 缺省 443
	if _, err := validateUrl("https://example.com/x", nil); err != nil {
		t.Fatalf("https 缺省端口应放行: %v", err)
	}
}

func TestCheckDomain(t *testing.T) {
	pol := DomainPolicy{
		GlobalBlocked: []string{"malware.example"},
		Block:         []string{"*.evil.com"},
		Allow:         []string{"wikipedia.org", "*.mozilla.org"},
	}
	if err := checkDomain("https://malware.example/a", pol); err == "" {
		t.Fatal("global 黑名单应拦")
	}
	if err := checkDomain("https://sub.evil.com/a", pol); err == "" {
		t.Fatal("run 级通配黑名单应拦")
	}
	if err := checkDomain("https://evil.com/a", pol); err == "" {
		t.Fatal("根域也该被 *.evil.com 拦(domainMatch 后缀语义)")
	}
	if err := checkDomain("https://en.wikipedia.org/wiki/A", pol); err != "" {
		t.Fatalf("allow 通配根域应放行: %v", err)
	}
	if err := checkDomain("https://developer.mozilla.org/x", pol); err != "" {
		t.Fatalf("allow 通配子域应放行: %v", err)
	}
	if err := checkDomain("https://example.com/x", pol); err == "" {
		t.Fatal("不在 allow 白名单应拦")
	}
}

func TestIsPrivateIp(t *testing.T) {
	cases := map[string]bool{
		"127.0.0.1": true, "10.1.2.3": true, "192.168.1.1": true,
		"172.16.0.9": true, "169.254.1.1": true, "100.64.0.2": true,
		"0.0.0.0": true, "198.18.0.1": true, "224.0.0.1": true,
		"::1": true, "::": true, "fe80::1": true, "fc00::1": true, "fd12::1": true,
		"::ffff:127.0.0.1": true, // v4-mapped 回环
		"8.8.8.8":          false, "1.1.1.1": false, "2606:4700::1111": false,
		"garbage": true, // 无法解析的一律拒绝
	}
	for ip, want := range cases {
		if got := isPrivateIp(ip, nil); got != want {
			t.Errorf("isPrivateIp(%q)=%v want %v", ip, got, want)
		}
	}
}

func TestAssertResolvableSafeFakeIp(t *testing.T) {
	// fake-ip 豁免: 192.106.x/192.107.x(TS 特判 0xc06a/0xc06b) 视为代理 TUN fake-ip 不拦
	opts := SsrfOptions{FakeIpCidrs: []string{"198.18.0.0/15"}}
	// 本地 hosts 无该域, DNS 应失败而非私网拦截; 这里只验证函数不 panic 且错误带 dns fail
	_, err := assertResolvableSafe("http://nonexistent.invalid/", opts)
	if err == nil {
		t.Skip("环境 DNS 解析了 .invalid, 跳过")
	}
	if got := err.Error(); !contains(got, "dns fail") {
		t.Fatalf("期望 dns fail, 得到: %v", err)
	}
}

func TestBudgetCharge(t *testing.T) {
	b := NewBudget(100)
	if !b.TryCharge(60, "a") {
		t.Fatal("60/100 应成功")
	}
	if b.TryCharge(60, "b") {
		t.Fatal("60+60>100 应失败")
	}
	if err := b.Charge(60, "b"); err == nil {
		t.Fatal("Charge 超额应报错")
	} else if be, ok := err.(*BudgetExceededError); !ok || !contains(be.Msg, "budget exceeded") {
		t.Fatalf("错误信息形状不对: %v", err)
	}
	if b.Spent() != 60 {
		t.Fatalf("失败核销不应入账: spent=%d", b.Spent())
	}
	if b.Remaining() != 40 {
		t.Fatalf("remaining=%d want 40", b.Remaining())
	}
}

func TestClassifyFailure(t *testing.T) {
	cases := []struct {
		msg   string
		want  string
		retry bool
	}{
		{"http 429 for x", "rate_limited", true},
		{"rate limit hit, slow down", "rate_limited", true},
		{"http 202 soft block", "rate_limited", true},
		{"quota exceeded", "quota", false},
		{"http 402 payment required", "quota", false},
		{"unauthorized http 401", "auth", false},
		{"http 403 forbidden captcha", "blocked", false},
		{"anubis challenge page", "blocked", false},
		{"context deadline exceeded (timeout)", "timeout", true},
		{"something else", "error", true},
	}
	for _, c := range cases {
		st, retry := classifyFailure(c.msg)
		if st != c.want || retry != c.retry {
			t.Errorf("classifyFailure(%q)=(%s,%v) want (%s,%v)", c.msg, st, retry, c.want, c.retry)
		}
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})()
}
