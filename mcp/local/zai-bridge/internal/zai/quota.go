package zai

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

var ErrQuotaUnknown = errors.New("无法可靠确认 agent 额度，本次不发送")
var ErrQuotaExhausted = errors.New("agent 消息额度已用完，本次不发送")

// This is a process-local conservative budget, not a server-wide guarantee.
type quotaState struct {
	mu          sync.Mutex
	refreshing  chan struct{}
	initialized bool
	unlimited   bool
	remaining   int64
	resetAt     string
	generation  uint64
}
type quotaBudget struct {
	unlimited bool
	remaining int64
	resetAt   string
}
type quotaReservation struct {
	state      *quotaState
	generation uint64
	finite     bool
	once       sync.Once
}

func budgetFromQuota(q *FeatureQuota) (quotaBudget, error) {
	if q == nil {
		return quotaBudget{}, ErrQuotaUnknown
	}
	for _, it := range q.Items {
		if it.Feature != "agent_mode" {
			continue
		}
		reset := it.ResetAt
		if reset == "" {
			reset = q.ResetAt
		}
		status := strings.ToLower(it.Status)
		if status == "locked" || status == "exhausted" || status == "unavailable" || status == "limit_reached" {
			return quotaBudget{}, ErrQuotaExhausted
		}
		if status == "unlimited" && it.Limit == nil && it.Remaining == nil {
			return quotaBudget{unlimited: true, resetAt: reset}, nil
		}
		if it.Limit == nil || it.Remaining == nil || !it.UsedPresent || *it.Limit < 0 || it.Used < 0 {
			return quotaBudget{}, ErrQuotaUnknown
		}
		if status != "available" {
			return quotaBudget{}, ErrQuotaUnknown
		}
		remaining := *it.Remaining
		if remaining <= 0 || it.Used >= *it.Limit {
			return quotaBudget{}, fmt.Errorf("%w（%d/%d，重置时间 %s）", ErrQuotaExhausted, it.Used, *it.Limit, reset)
		}
		if remaining > *it.Limit-it.Used {
			return quotaBudget{}, ErrQuotaUnknown
		}
		return quotaBudget{remaining: remaining, resetAt: reset}, nil
	}
	return quotaBudget{}, ErrQuotaUnknown
}

// Every dispatch admission refreshes server quota. Concurrent refresh is single-flight.
// A same-window server value cannot replenish already reserved/uncertain local sends.
func (c *Client) reserveQuota(ctx context.Context) (*quotaReservation, error) {
	if c.cfg.SkipQuotaCheck {
		return nil, fmt.Errorf("%w：严格保护模式不允许 skip_quota_check", ErrQuotaUnknown)
	}
	for {
		c.quota.mu.Lock()
		if pending := c.quota.refreshing; pending != nil {
			c.quota.mu.Unlock()
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-pending:
			}
			continue
		}
		ch := make(chan struct{})
		c.quota.refreshing = ch
		c.quota.mu.Unlock()
		q, err := c.FeatureQuota(ctx)
		var budget quotaBudget
		if err != nil {
			err = fmt.Errorf("%w：查询失败", ErrQuotaUnknown)
		} else {
			budget, err = budgetFromQuota(q)
		}
		c.quota.mu.Lock()
		if err == nil {
			resetChanged := false
			if c.quota.initialized && budget.resetAt != c.quota.resetAt && c.quota.resetAt != "" {
				if reset, e := time.Parse(time.RFC3339, c.quota.resetAt); e == nil && !time.Now().Before(reset) {
					resetChanged = true
				}
			}
			if !c.quota.initialized || resetChanged {
				c.quota.remaining = budget.remaining
				c.quota.unlimited = budget.unlimited
				c.quota.resetAt = budget.resetAt
				c.quota.generation++
				c.quota.initialized = true
			} else {
				if c.quota.unlimited && !budget.unlimited {
					c.quota.remaining = budget.remaining
				}
				if !budget.unlimited && (budget.remaining < c.quota.remaining) {
					c.quota.remaining = budget.remaining
				}
				if c.quota.unlimited != budget.unlimited {
					c.quota.generation++
				}
				c.quota.unlimited = budget.unlimited
			}
		}
		c.quota.refreshing = nil
		close(ch)
		if err != nil {
			c.quota.mu.Unlock()
			return nil, err
		}
		if !c.quota.unlimited && c.quota.remaining <= 0 {
			c.quota.mu.Unlock()
			return nil, ErrQuotaExhausted
		}
		reservation := &quotaReservation{state: &c.quota, generation: c.quota.generation, finite: !c.quota.unlimited}
		if reservation.finite {
			c.quota.remaining--
		}
		c.quota.mu.Unlock()
		return reservation, nil
	}
}

// Roll back only if no completion request was sent or it was provably rejected.
// Unknown/accepted outcomes intentionally keep the local deduction.
func (r *quotaReservation) settle(notAccepted bool) {
	if r == nil {
		return
	}
	r.once.Do(func() {
		if !notAccepted || !r.finite {
			return
		}
		r.state.mu.Lock()
		defer r.state.mu.Unlock()
		if r.state.generation == r.generation {
			r.state.remaining++
		}
	})
}
func (c *Client) ensureQuota(ctx context.Context) error {
	r, e := c.reserveQuota(ctx)
	if e == nil {
		r.settle(true)
	}
	return e
}
