package mcp

import "github.com/local/zai-bridge/internal/zai"

func submissionResult(text string, res *zai.SendResult) *CallToolResult {
	out := textResult(text)
	if res != nil {
		out.SubmissionID = res.MessageID
	}
	return out
}
