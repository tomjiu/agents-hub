package config

import (
	"encoding/base64"
	"fmt"
	"testing"
)

func TestDuplicateAccountIdentityRejected(t *testing.T) {
	a := "x." + base64.RawURLEncoding.EncodeToString([]byte("{\"id\":\"same-account\",\"iat\":1}")) + ".a"
	b := "x." + base64.RawURLEncoding.EncodeToString([]byte("{\"id\":\"same-account\",\"iat\":2}")) + ".b"
	raw := fmt.Sprintf("{\"accounts\":[{\"name\":\"a\",\"token\":%q},{\"name\":\"b\",\"token\":%q}]}", a, b)
	if _, _, e := parseAccounts([]byte(raw), "fixture"); e == nil {
		t.Fatal("same JWT id got separate quota budgets")
	}
}
