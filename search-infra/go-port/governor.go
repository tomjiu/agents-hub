package main

// Governor (对齐 TS core/src/governor.ts v0-spec §4.6): 预算 + SSRF 守卫 + 域名治理
// - Budget: run 级字符预算申请-核销(token ≈ chars/4 保守口径)
// - SSRF: 协议/端口/DNS 解析全查 + 调用方逐跳跟随重定向(防重定向进内网)
// - 域名: 全局黑名单 + run 级 allow/block
// 另含 classifyFailure(TS providers/base.ts 失败分类器, 6 类驱动差异化熔断)。

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strings"
	"sync"
)

// ---------- Budget ----------

// BudgetExceededError 对齐 TS BudgetExceededError(字符串前缀判定)
type BudgetExceededError struct{ Msg string }

func (e *BudgetExceededError) Error() string { return e.Msg }

// Budget run 级字符预算
type Budget struct {
	MaxChars int
	mu       sync.Mutex
	spent    int
	ledger   []BudgetEntry
}

type BudgetEntry struct {
	Label string `json:"label"`
	Chars int    `json:"chars"`
}

func NewBudget(maxChars int) *Budget { return &Budget{MaxChars: maxChars} }

func (b *Budget) Spent() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.spent
}

func (b *Budget) Remaining() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	r := b.MaxChars - b.spent
	if r < 0 {
		return 0
	}
	return r
}

// Charge 申请 chars 字符;超额抛 BudgetExceededError(调用方应先 TryCharge)
func (b *Budget) Charge(chars int, label string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.spent+chars > b.MaxChars {
		return &BudgetExceededError{Msg: fmt.Sprintf(
			"budget exceeded: need %d, spent %d, max %d (%s)", chars, b.spent, b.MaxChars, label)}
	}
	b.spent += chars
	b.ledger = append(b.ledger, BudgetEntry{Label: label, Chars: chars})
	return nil
}

// TryCharge 不抛错版
func (b *Budget) TryCharge(chars int, label string) bool {
	return b.Charge(chars, label) == nil
}

// ---------- 域名治理 ----------
// hostOf 已在 authority.go 定义(hostname 小写, 语义一致), 此处复用

// domainMatch 支持 *.example.com 与 example.com 两种写法
func domainMatch(host, rule string) bool {
	r := strings.TrimPrefix(strings.ToLower(rule), "*.")
	return host == r || strings.HasSuffix(host, "."+r)
}

type DomainPolicy struct {
	GlobalBlocked []string `json:"globalBlocked"`
	Block         []string `json:"block,omitempty"`
	Allow         []string `json:"allow,omitempty"`
}

// checkDomain 返回 null/空串 = 通过, 否则返回拒绝原因
func checkDomain(rawURL string, policy DomainPolicy) string {
	host := hostOf(rawURL)
	if host == "" {
		return fmt.Sprintf("bad url: %s", rawURL)
	}
	for _, rule := range policy.GlobalBlocked {
		if domainMatch(host, rule) {
			return fmt.Sprintf("blocked(global): %s", host)
		}
	}
	for _, rule := range policy.Block {
		if domainMatch(host, rule) {
			return fmt.Sprintf("blocked(run): %s", host)
		}
	}
	if len(policy.Allow) > 0 {
		ok := false
		for _, rule := range policy.Allow {
			if domainMatch(host, rule) {
				ok = true
				break
			}
		}
		if !ok {
			return fmt.Sprintf("not-in-allowlist: %s", host)
		}
	}
	return ""
}

// ---------- SSRF 守卫 ----------

var privateV4 = []string{
	"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8",
	"169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.168.0.0/16",
	"198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4",
}

func v4ToInt(ip string) uint32 {
	p := strings.Split(ip, ".")
	if len(p) != 4 {
		return 0
	}
	var a, b, c, d int
	fmt.Sscanf(p[0], "%d", &a)
	fmt.Sscanf(p[1], "%d", &b)
	fmt.Sscanf(p[2], "%d", &c)
	fmt.Sscanf(p[3], "%d", &d)
	return (uint32(a) << 24) | (uint32(b) << 16) | (uint32(c) << 8) | uint32(d)
}

func inCidr4(ip, cidr string) bool {
	parts := strings.SplitN(cidr, "/", 2)
	if len(parts) != 2 {
		return false
	}
	var bits int
	fmt.Sscanf(parts[1], "%d", &bits)
	var mask uint32
	if bits == 0 {
		mask = 0
	} else {
		mask = (0xffffffff << (32 - bits))
	}
	return (v4ToInt(ip) & mask) == (v4ToInt(parts[0]) & mask)
}

func isIP6(ip string) bool { return strings.Contains(ip, ":") }

func isIP4(ip string) bool {
	return net.ParseIP(ip) != nil && !isIP6(ip) && strings.Count(ip, ".") == 3
}

func isPrivateIp(ip string, extraCidrs []string) bool {
	if isIP6(ip) {
		low := strings.ToLower(ip)
		if low == "::1" || low == "::" {
			return true
		}
		if strings.HasPrefix(low, "fe80") || strings.HasPrefix(low, "fc") || strings.HasPrefix(low, "fd") {
			return true
		}
		if strings.HasPrefix(low, "::ffff:") { // v4-mapped
			return isPrivateIp(strings.TrimPrefix(low, "::ffff:"), extraCidrs)
		}
		return false
	}
	if !isIP4(ip) {
		return true // 无法解析的一律拒绝
	}
	for _, c := range privateV4 {
		if inCidr4(ip, c) {
			return true
		}
	}
	// 用户声明的 fake-ip 豁免网段不参与拦截判定(TS 同款: 仅记录, 逐字保留)
	for _, c := range extraCidrs {
		if strings.Contains(c, ".") && strings.Contains(c, "/") {
			continue
		}
	}
	return false
}

type SsrfOptions struct {
	FakeIpCidrs  []string // 豁免网段(Clash TUN fake-ip): 判定私网时忽略这些
	AllowPrivate bool     // 测试用
}

// validateUrl 校验 URL 本身(协议/端口/域名治理), 不涉及 DNS。
// 返回 ("", err) 或 (规范化 url, nil)。
func validateUrl(rawURL string, policy *DomainPolicy) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", fmt.Errorf("invalid url: %s", rawURL)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("bad protocol: %s:", u.Scheme)
	}
	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	switch port {
	case "80", "443", "8080", "8443":
	default:
		return "", fmt.Errorf("bad port: %s", port)
	}
	if policy != nil {
		if derr := checkDomain(u.String(), *policy); derr != "" {
			return "", fmt.Errorf("%s", derr)
		}
	}
	return u.String(), nil
}

// assertResolvableSafe DNS 解析 + 私网判定。FakeIpCidrs 中的地址视为豁免(代理 TUN 场景)。
func assertResolvableSafe(rawURL string, opts SsrfOptions) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("invalid url: %s", rawURL)
	}
	addrs, err := net.DefaultResolver.LookupIPAddr(context.Background(), u.Hostname())
	if err != nil {
		return "", fmt.Errorf("dns fail: %s (%v)", u.Hostname(), err)
	}
	fake := opts.FakeIpCidrs
	for _, a := range addrs {
		ip := a.IP.String()
		isFake := false
		for _, cidr := range fake {
			if !isIP6(ip) && strings.Contains(cidr, "/") {
				if inCidr4(ip, cidr) || v4ToInt(ip)>>16 == 0xc06a || v4ToInt(ip)>>16 == 0xc06b {
					isFake = true
					break
				}
			}
		}
		if isFake {
			continue
		}
		if !opts.AllowPrivate && isPrivateIp(ip, fake) {
			return "", fmt.Errorf("private address blocked: %s -> %s", u.Hostname(), ip)
		}
	}
	if len(addrs) == 0 {
		return "", nil
	}
	return addrs[0].IP.String(), nil
}

// safeFetchUrl 校验 + 解析安全后返回 URL;调用方需逐跳(redirect manual)调用本函数。
func safeFetchUrl(rawURL string, policy *DomainPolicy, opts SsrfOptions) (string, error) {
	v, err := validateUrl(rawURL, policy)
	if err != nil {
		return "", err
	}
	if _, err := assertResolvableSafe(v, opts); err != nil {
		return "", err
	}
	return v, nil
}

// ---------- 失败分类器 (TS providers/base.ts v0.4 逐字对齐) ----------

// classifyFailure 6 类: rate_limited(自愈快) / quota(月度没戏) / auth(修 key) /
// blocked(别硬碰) / timeout(可重试) / error(默认可重试)
var (
	rateRe  = regexp.MustCompile(`\b429\b|rate.?limit|too many|slow down|please reduce|\bhttp 202\b|soft.?block`)
	quotaRe = regexp.MustCompile(`\b402\b|\b432\b|\b433\b|quota|payment required|out of credit`)
	authRe  = regexp.MustCompile(`\b401\b|unauthorized|invalid api key|authentication|bad api key`)
	blockRe = regexp.MustCompile(`\b403\b|\b40x\b|forbidden|captcha|unusual|challenge|anubis|access denied|blocked|cloudflare`)
	timeRe  = regexp.MustCompile(`timeout|abort|etimedout|deadline|econnaborted`)
)

func classifyFailure(msg string) (status string, retryable bool) {
	s := strings.ToLower(msg)
	switch {
	case rateRe.MatchString(s):
		return "rate_limited", true
	case quotaRe.MatchString(s):
		return "quota", false
	case authRe.MatchString(s):
		return "auth", false
	case blockRe.MatchString(s):
		return "blocked", false
	case timeRe.MatchString(s):
		return "timeout", true
	}
	return "error", true
}
