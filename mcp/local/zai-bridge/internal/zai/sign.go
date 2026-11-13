package zai

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// X-Signature 请求签名。
//
// 逆向自前端 $W() + VW() 两个函数（prod-fe-1.2.8）。要点：
//
//	sortedPayload = Object.entries({timestamp, requestId, user_id})
//	                  .sort((a,b)=>a[0].localeCompare(b[0])).join(",")
//	signature     = HMAC-SHA256( HMAC-SHA256(KEY, floor(ts/300000)), sortedPayload|base64(prompt)|ts )
//
// 注意两点容易搞错的地方：
//  1. 签名只覆盖 sortedPayload 这三个字段，**不覆盖**完整浏览器指纹。
//     指纹只出现在 URL 查询串里（urlParams），不参与签名。
//  2. 密钥是打包在 JS 里的常量，不是按用户下发。
const signKey = "key-@@@@)))()((9))-xxxx&&&%%%%%"

// SignResult 是签名结果。
type SignResult struct {
	Signature string
	// Timestamp 是毫秒时间戳字符串，要原样拼到 URL 上
	Timestamp string
	// URLParams 是浏览器指纹查询串（不含 signature_timestamp）
	URLParams string
}

// Sign 计算一次请求签名。
//
// prompt 是用户这次发送的正文，chatID 用于伪造当前页面地址。
func (c *Client) Sign(prompt, chatID string) (*SignResult, error) {
	return c.signAt(prompt, chatID, time.Now().UnixMilli(), uuid.NewString(), c.UserID())
}

// signAt 使用可注入参数，便于与原始前端函数逐字比较。
func (c *Client) signAt(prompt, chatID string, timestamp int64, reqID, userID string) (*SignResult, error) {
	ts := strconv.FormatInt(timestamp, 10)

	// sortedPayload：三个字段按键名 localeCompare 排序后 join(",")。
	// 每个 entry 是 [key, value]，数组 toString 得到 "key,value"。
	entries := [][2]string{
		{"timestamp", ts},
		{"requestId", reqID},
		{"user_id", userID},
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i][0] < entries[j][0]
	})
	parts := make([]string, 0, len(entries))
	for _, e := range entries {
		parts = append(parts, e[0]+","+e[1])
	}
	sortedPayload := strings.Join(parts, ",")

	// g = btoa(utf8(prompt))，即标准 base64
	b64Prompt := base64.StdEncoding.EncodeToString([]byte(prompt))

	b := sortedPayload + "|" + b64Prompt + "|" + ts

	// C = floor(ts / 300000)，即 5 分钟一个窗口
	ms, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return nil, err
	}
	window := strconv.FormatInt(ms/300000, 10)

	// T = HMAC-SHA256(KEY, C)  —— 作为下一层 HMAC 的密钥
	mac1 := hmac.New(sha256.New, []byte(signKey))
	mac1.Write([]byte(window))
	// js-sha256.hmac 默认返回 hex 字符串，第二层 key 是该字符串的 UTF-8。
	inner := hex.EncodeToString(mac1.Sum(nil))

	mac2 := hmac.New(sha256.New, []byte(inner))
	mac2.Write([]byte(b))
	sig := hex.EncodeToString(mac2.Sum(nil))

	return &SignResult{
		Signature: sig,
		Timestamp: ts,
		URLParams: c.fingerprint(ts, reqID, userID, chatID),
	}, nil
}

// fingerprint 构造浏览器指纹查询串。
//
// 这些值不参与签名，作用只是让请求看起来像真实浏览器发的。
// 顺序要和前端一致：先 timestamp/requestId/user_id，再其余字段。
func (c *Client) fingerprint(ts, reqID, userID, chatID string) string {
	base := c.baseURL()
	pageURL := base + "/c/" + chatID
	pathname := "/c/" + chatID
	parsed, _ := url.Parse(base)
	host, hostname, protocol := "chat.z.ai", "chat.z.ai", "https:"
	if parsed != nil {
		host = parsed.Host
		hostname = parsed.Hostname()
		protocol = parsed.Scheme + ":"
	}

	now := time.Now().In(time.FixedZone("Asia/Shanghai", 8*3600))
	_, offsetSec := now.Zone()

	// 用有序切片保证顺序稳定（前端是对象插入顺序）
	fields := [][2]string{
		{"timestamp", ts},
		{"requestId", reqID},
		{"user_id", userID},
		{"version", "0.0.1"},
		{"platform", "web"},
		{"token", c.cfg.Token},
		{"user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:160.0) Gecko/20100101 Firefox/160.0"},
		{"language", "zh-CN"},
		{"languages", "zh-CN,zh,en-US,en"},
		{"timezone", "Asia/Shanghai"},
		{"cookie_enabled", "true"},
		{"screen_width", "1920"},
		{"screen_height", "1080"},
		{"screen_resolution", "1920x1080"},
		{"viewport_height", "937"},
		{"viewport_width", "1920"},
		{"viewport_size", "1920x937"},
		{"color_depth", "24"},
		{"pixel_ratio", "1"},
		{"current_url", pageURL},
		{"pathname", pathname},
		{"search", ""},
		{"hash", ""},
		{"host", host},
		{"hostname", hostname},
		{"protocol", protocol},
		{"referrer", ""},
		{"title", "Z.ai"},
		// getTimezoneOffset 返回「本地时间 - UTC」的分钟数，东八区是 -480
		{"timezone_offset", strconv.Itoa(-offsetSec / 60)},
		{"local_time", now.Format("Mon Jan 02 2006 15:04:05 GMT-0700")},
		{"utc_time", now.UTC().Format("Mon, 02 Jan 2006 15:04:05 GMT")},
		{"is_mobile", "false"},
		{"is_touch", "false"},
		{"max_touch_points", "0"},
		{"browser_name", "Firefox"},
		{"os_name", "Windows"},
	}

	// 用 add 保持插入顺序：url.Values.Encode 会按 key 排序，所以手动拼
	var sb strings.Builder
	for _, f := range fields {
		if sb.Len() > 0 {
			sb.WriteByte('&')
		}
		sb.WriteString(url.QueryEscape(f[0]))
		sb.WriteByte('=')
		sb.WriteString(url.QueryEscape(f[1]))
	}
	return sb.String()
}

// UserID 从 token 里解出用户 id。
//
// token 是 JWT，payload 里有 id 字段。这里只做 base64 解码，不验签——
// 我们只需要 id 拼进指纹，服务端会自己校验 token 合法性。
func (c *Client) UserID() string { return c.userID }

// decodeJWTPayload 解出 JWT 的 payload（不验签）。
func decodeJWTPayload(token string) (map[string]any, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, false
	}
	var claims map[string]any
	if err := json.Unmarshal(raw, &claims); err != nil {
		return nil, false
	}
	return claims, true
}
