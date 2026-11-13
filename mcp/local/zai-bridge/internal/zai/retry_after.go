package zai

import (
	"strconv"
	"strings"
	"time"
)

func retryAfter(v string) time.Duration {
	if n, e := strconv.Atoi(strings.TrimSpace(v)); e == nil && n >= 0 {
		if n > 86400 {
			n = 86400
		}
		return time.Duration(n) * time.Second
	}
	if t, e := time.Parse(time.RFC1123, v); e == nil && time.Until(t) > 0 {
		return time.Until(t)
	}
	return 0
}
func (g *DispatchGate) Pause(d time.Duration) {
	if d < 0 {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	next := time.Now().Add(d)
	if next.After(g.next) {
		g.next = next
	}
}
