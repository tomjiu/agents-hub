package zai

import (
	"context"
	"github.com/google/uuid"
	"strings"
)

func (c *Client) completionBody(ctx context.Context, chatID, prompt string, um *userMsg, captchaParam string) map[string]any {
	body := map[string]any{
		"id":                             um.AssistantID,
		"chat_id":                        chatID,
		"model":                          c.cfg.Model,
		"stream":                         true,
		"messages":                       []map[string]any{{"role": "user", "content": prompt}},
		"signature_prompt":               strings.TrimSpace(prompt),
		"params":                         map[string]any{},
		"variables":                      map[string]any{},
		"session_id":                     "web-" + uuid.NewString(),
		"current_user_message_id":        um.UserID,
		"current_user_message_parent_id": nullable(um.ParentID),
		// features 前端必带；缺了服务端会在生成前空指针，回 INTERNAL_ERROR
		"features": map[string]any{
			"image_generation":      false,
			"web_search":            false,
			"preview_mode":          false,
			"flags":                 []string{"general_agent"},
			"auto_web_search":       false,
			"vlm_tools_enable":      false,
			"vlm_web_search_enable": false,
			"vlm_website_mode":      false,
			"enable_thinking":       true,
			"reasoning_effort":      "high",
		},
	}
	if item, ierr := c.GetModelItem(ctx, c.cfg.Model); ierr == nil {
		body["model_item"] = item
	}
	if captchaParam != "" {
		body["captcha_verify_param"] = captchaParam
	}

	return body
}
