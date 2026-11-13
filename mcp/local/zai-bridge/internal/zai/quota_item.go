package zai

import "encoding/json"

// Missing used is not silently a zero used-count.
func (q *QuotaItem) UnmarshalJSON(raw []byte) error {
	type item QuotaItem
	var decoded item
	if e := json.Unmarshal(raw, &decoded); e != nil {
		return e
	}
	var fields map[string]json.RawMessage
	if e := json.Unmarshal(raw, &fields); e != nil {
		return e
	}
	value, ok := fields["used"]
	decoded.UsedPresent = ok && string(value) != "null"
	*q = QuotaItem(decoded)
	return nil
}
