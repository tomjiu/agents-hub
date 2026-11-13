package zai

func (c *Client) draft(chatID string) *userMsg {
	c.trackerMu.Lock()
	defer c.trackerMu.Unlock()
	d := c.drafts[chatID]
	if d == nil {
		return nil
	}
	copy := *d
	return &copy
}
func (c *Client) setDraft(chatID string, d *userMsg) {
	c.trackerMu.Lock()
	defer c.trackerMu.Unlock()
	if d == nil {
		delete(c.drafts, chatID)
	} else {
		c.drafts[chatID] = d
	}
}
