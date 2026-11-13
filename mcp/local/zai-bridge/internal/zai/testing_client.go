package zai

import (
	"github.com/local/zai-bridge/internal/config"
	"net/http"
)

// NewWithHTTPClient injects a transport without making network calls.
func NewWithHTTPClient(cfg config.Config, h *http.Client) *Client {
	c := New(cfg)
	if h != nil {
		c.http = h
	}
	return c
}
