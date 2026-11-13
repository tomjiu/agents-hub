package zai

import "testing"

func TestFilenameFromDisposition(t *testing.T) {
	cases := []struct {
		cd   string
		want string
	}{
		{"attachment; filename*=UTF-8''schema-probe.txt", "schema-probe.txt"},
		{"attachment; filename=plain.txt", "plain.txt"},
		{"attachment; filename=with space.txt; size=12", "with space.txt"},
		{"attachment; filename*=UTF-8''%E6%B5%8B%E8%AF%95%20%2B.txt", "测试 +.txt"},
		{`attachment; filename="semi;colon.txt"`, "semi;colon.txt"},
		{"attachment; filename*=UTF-8''%2E%2E%2Fsecret.txt", "secret.txt"},
		{`attachment; filename="..\\secret.txt"`, "secret.txt"},
		{`attachment; filename=".."`, ""},
		{"", ""},
		{"inline", ""},
	}
	for _, c := range cases {
		if got := filenameFromDisposition(c.cd); got != c.want {
			t.Errorf("filenameFromDisposition(%q) = %q, want %q", c.cd, got, c.want)
		}
	}
}
