package config

import (
	"encoding/base64"
	"encoding/json"
	"strings"
)

// Identity is only used to avoid duplicate local budgets, never to authorize.
func accountIdentity(token string) string {
	parts := strings.Split(token, ".")
	if len(parts) == 3 {
		if raw, e := base64.RawURLEncoding.DecodeString(parts[1]); e == nil {
			var claims struct {
				ID string `json:"id"`
			}
			if json.Unmarshal(raw, &claims) == nil && claims.ID != "" {
				return "id:" + claims.ID
			}
		}
	}
	return "token:" + token
}
