package config

import (
	"os"
	"path/filepath"
	"testing"
)

func cleanEnvironment(t *testing.T) {
	t.Helper()
	for _, key := range []string{"ZAI_CONFIG", "ZAI_ACCOUNTS_FILE", "ZAI_ACCOUNT", "ZAI_TOKEN", "ZAI_COOKIE", "ZAI_BASE_URL", "ZAI_MODEL", "ZAI_REGION", "ZAI_SEND_INTERVAL", "ZAI_MAX_CONCURRENCY", "ZAI_CAPTCHA_ENABLED", "ZAI_CAPTCHA_WORKERS", "ZAI_CAPTCHA_ROUNDS", "ZAI_SKIP_QUOTA_CHECK", "ZAI_NODE", "ZAI_CAPTCHA_SCRIPT", "ZAI_CAPTCHA_SCENE", "ZAI_DEBUG"} {
		t.Setenv(key, "")
	}
}
func testFile(t *testing.T, name, contents string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}
func TestCookieIsolation(t *testing.T) {
	cfg := Default()
	cfg.Token = "single"
	cfg.Cookie = "global-cookie"
	if got := cfg.ResolvedAccounts()[0].Cookie; got != "global-cookie" {
		t.Fatal(got)
	}
	cfg.Accounts = []AccountConfig{{Name: "a", Token: "a"}, {Name: "b", Token: "b", Cookie: "b-cookie"}}
	accounts := cfg.ResolvedAccounts()
	if accounts[0].Cookie != "" || cfg.ForAccount(accounts[0]).Cookie != "" || accounts[1].Cookie != "b-cookie" {
		t.Fatalf("cookie inheritance: %+v", accounts)
	}
	if cfg.Accounts[0].Model != "" {
		t.Fatal("ResolvedAccounts mutated source")
	}
}
func TestDefaultOverridePrecedesValidation(t *testing.T) {
	cleanEnvironment(t)
	t.Setenv("ZAI_ACCOUNT", "b")
	accounts, def, err := parseAccounts([]byte(`{"default":"missing","accounts":[{"name":"a","token":"a"},{"name":"b","token":"b"}]}`), "fixture")
	if err != nil || def != "b" || len(accounts) != 2 {
		t.Fatalf("%v %s %v", accounts, def, err)
	}
	t.Setenv("ZAI_ACCOUNT", "absent")
	if _, _, err := parseAccounts([]byte(`{"accounts":[{"name":"a","token":"a"}]}`), "fixture"); err == nil {
		t.Fatal("unknown override accepted")
	}
}
func TestExplicitMissingPathsAreStrict(t *testing.T) {
	cleanEnvironment(t)
	t.Setenv("ZAI_TOKEN", "fake")
	t.Setenv("ZAI_CONFIG", filepath.Join(t.TempDir(), "missing-config"))
	if _, err := Load(); err == nil {
		t.Fatal("missing explicit config accepted")
	}
	t.Setenv("ZAI_ACCOUNTS_FILE", filepath.Join(t.TempDir(), "missing-accounts"))
	if _, _, err := LoadAccounts(); err == nil {
		t.Fatal("missing explicit accounts accepted")
	}
}
func TestLoadEnvAndNumericValidation(t *testing.T) {
	cleanEnvironment(t)
	t.Setenv("ZAI_CONFIG", testFile(t, "config.json", `{"token":"fake","max_concurrency":-1,"send_interval_seconds":0,"cookie":"global"}`))
	t.Setenv("ZAI_ACCOUNTS_FILE", testFile(t, "accounts.json", `{"default":"wrong","accounts":[{"name":"a","token":"a"},{"name":"b","token":"b"}]}`))
	t.Setenv("ZAI_ACCOUNT", "b")
	t.Setenv("ZAI_MAX_CONCURRENCY", "2")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DefaultAccountName() != "b" || cfg.SendIntervalSeconds != 0 || cfg.Captcha.Workers != 2 || cfg.Captcha.Rounds != 3 {
		t.Fatalf("defaults/override: %+v", cfg)
	}
	if cfg.ResolvedAccounts()[0].Cookie != "" {
		t.Fatal("top cookie inherited")
	}
	for _, value := range []string{"invalid", "-1", "0"} {
		t.Setenv("ZAI_MAX_CONCURRENCY", value)
		if _, err := Load(); err == nil {
			t.Fatalf("accepted concurrency %q", value)
		}
	}
	t.Setenv("ZAI_MAX_CONCURRENCY", "2")
	t.Setenv("ZAI_SKIP_QUOTA_CHECK", "true")
	if _, err := Load(); err == nil {
		t.Fatal("quota skip accepted")
	}
}
