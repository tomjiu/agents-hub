package zai

import "context"

// RunState checks upstream run metadata; stream EOF is not remote completion.
func (c *Client) RunState(ctx context.Context, chatID, messageID string) (string, error) {
	return c.remoteState(ctx, chatID, messageID)
}
