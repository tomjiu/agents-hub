package zai

import (
	"context"
	"fmt"
)

// Validate a held reservation without double-decrementing local budget.
func (r *quotaReservation) validate(ctx context.Context, c *Client) error {
	q, e := c.FeatureQuota(ctx)
	if e != nil {
		return fmt.Errorf("%w：出队后的额度查询失败", ErrQuotaUnknown)
	}
	_, e = budgetFromQuota(q)
	return e
}
