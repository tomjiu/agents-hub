package zai

import (
	"context"
	"time"
)

// Serialize request preparation through response headers, not the event body.
// This prevents delayed quota/signature preparation from collapsing POST intervals.
func (g *DispatchGate) begin(ctx context.Context) (func(), error) {
	release, e := g.prepare.acquire(ctx, "dispatch")
	if e != nil {
		return nil, e
	}
	if e = g.Wait(ctx); e != nil {
		release()
		return nil, e
	}
	return release, nil
}
func (g *DispatchGate) markSent() {
	g.mu.Lock()
	defer g.mu.Unlock()
	next := time.Now().Add(g.interval)
	if next.After(g.next) {
		g.next = next
	}
}
