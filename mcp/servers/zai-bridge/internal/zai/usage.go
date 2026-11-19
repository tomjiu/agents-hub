package zai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// 用量相关接口，全部是只读 GET，不触发风控。
// 这里的响应同样是 {code,message,data} 包装，但成功码有两套（0 / 200），
// 所以复用一个宽松的拆包函数。

// TokenUsage 是 /dashboard/token-usage/summary 的返回（只取关心的字段）。
type TokenUsage struct {
	Timezone string `json:"timezone"`
	Today    struct {
		Date        string `json:"date"`
		TotalTokens int64  `json:"total_tokens"`
	} `json:"today"`
	Yesterday struct {
		Date        string `json:"date"`
		TotalTokens int64  `json:"total_tokens"`
	} `json:"yesterday"`
	Month struct {
		Month       string `json:"month"`
		TotalTokens int64  `json:"total_tokens"`
	} `json:"month"`
}

// QuotaItem 是一条功能额度。
type QuotaItem struct {
	UsedPresent bool   `json:"-"`
	Feature     string `json:"feature"`
	Label       string `json:"label"`
	Category    string `json:"category"`
	Unit        string `json:"unit"`
	Status      string `json:"status"`
	Limit       *int64 `json:"limit"`
	Used        int64  `json:"used"`
	Remaining   *int64 `json:"remaining"`
	ResetAt     string `json:"reset_at"`
}

// FeatureQuota 是 /dashboard/feature-quota/summary 的返回。
type FeatureQuota struct {
	ResetAt string      `json:"reset_at"`
	Items   []QuotaItem `json:"items"`
}

// Subscription 是当前套餐。
type Subscription struct {
	Level      string `json:"level"`
	PlanID     string `json:"planId"`
	PlanType   string `json:"planType"`
	IsFallback bool   `json:"isFallback"`
	ExpiresAt  any    `json:"expiresAt"`
}

// usageData 拆 {code,message,data} 包装。
func (c *Client) usageData(ctx context.Context, path string, out any) error {
	var env struct {
		Code    *int            `json:"code"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	if err := c.doJSON(ctx, http.MethodGet, path, nil, &env); err != nil {
		return err
	}
	if env.Code == nil {
		return fmt.Errorf("用量接口缺少code")
	}
	if *env.Code != 0 && *env.Code != 200 {
		return fmt.Errorf("用量接口返回 %d: %s", *env.Code, env.Message)
	}
	if out == nil {
		return nil
	}
	if len(env.Data) == 0 || string(env.Data) == "null" {
		return fmt.Errorf("用量接口返回空数据")
	}
	return json.Unmarshal(env.Data, out)
}

// TokenUsage 取 token 消耗。
func (c *Client) TokenUsage(ctx context.Context) (*TokenUsage, error) {
	var out TokenUsage
	if err := c.usageData(ctx, "/api/v1/dashboard/token-usage/summary", &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// FeatureQuota 取功能额度（agent 模式次数等）。
func (c *Client) FeatureQuota(ctx context.Context) (*FeatureQuota, error) {
	var out FeatureQuota
	if err := c.usageData(ctx, "/api/v1/dashboard/feature-quota/summary", &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Subscription 取当前套餐。
func (c *Client) Subscription(ctx context.Context) (*Subscription, error) {
	var envelope struct {
		SelectedPlan Subscription `json:"selectedPlan"`
	}
	if err := c.usageData(ctx, "/api/v1/users/user/subscription", &envelope); err != nil {
		return nil, err
	}
	s := envelope.SelectedPlan
	return &s, nil
}
