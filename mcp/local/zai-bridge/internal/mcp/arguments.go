package mcp

import (
	"encoding/json"
	"fmt"
)

// defaultInt distinguishes an omitted value from an explicit zero.
func defaultInt(raw json.RawMessage, name string, fallback int) int {
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return fallback
	}
	value, present := fields[name]
	if !present {
		return fallback
	}
	var n int
	_ = json.Unmarshal(value, &n)
	return n
}
func validateArguments(raw json.RawMessage) *RPCError {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return &RPCError{Code: CodeInvalidParams, Message: "arguments must be an object"}
	}
	for _, key := range []string{"limit", "max_chars", "max_keys", "page", "page_size", "timeout_seconds", "poll_ms", "attempts"} {
		value, exists := fields[key]
		if !exists {
			continue
		}
		var n int
		if string(value) == "null" || json.Unmarshal(value, &n) != nil || n < 0 {
			return &RPCError{Code: CodeInvalidParams, Message: fmt.Sprintf("%s must be a non-negative integer", key)}
		}
		if (key == "timeout_seconds" && (n == 0 || n > 86400)) || (key == "poll_ms" && (n == 0 || n > 3600000)) || ((key == "page" || key == "page_size" || key == "max_keys" || key == "attempts") && n == 0) {
			return &RPCError{Code: CodeInvalidParams, Message: fmt.Sprintf("%s is outside the allowed range", key)}
		}
	}
	if value, exists := fields["account"]; exists {
		var name string
		if string(value) == "null" || json.Unmarshal(value, &name) != nil {
			return &RPCError{Code: CodeInvalidParams, Message: "account must be a string"}
		}
	}
	return nil
}
