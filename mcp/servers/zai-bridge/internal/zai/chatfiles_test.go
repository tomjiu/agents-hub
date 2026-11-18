package zai

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestChatFilesEmptyPartialAndFailedSources(t *testing.T) {
	tests := []struct {
		name, legacy, pfs string
		wantErr           bool
		wantFiles         int
		wantPFS           int
	}{
		{"both empty", `{"success":true,"data":{"files":[]}}`, `{"code":0,"data":{"total":0}}`, false, 0, 0},
		{"legacy failed pfs empty", `{"success":false}`, `{"code":0,"data":{"total":0}}`, true, 0, 0},
		{"legacy partial", `{"success":true,"data":{"message_id":"v","files":[{"key":"f"}]}}`, `{"code":500,"data":{}}`, true, 1, 0},
		{"pfs partial", "broken", `{"code":200,"data":{"total":3,"total_size":200}}`, true, 0, 3},
		{"both fail", `{"success":false}`, `{"code":500,"data":{}}`, true, 0, 0},
		{"missing legacy data", `{"success":true}`, `{"code":0,"data":{}}`, true, 0, 0},
		{"missing pfs code", `{"success":true,"data":{}}`, `{"data":{}}`, true, 0, 0},
		{"missing pfs data", `{"success":true,"data":{}}`, `{"code":0}`, true, 0, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			calls := 0
			c := resourceTestClient(func(r *http.Request) (*http.Response, error) {
				calls++
				raw := tt.legacy
				if strings.Contains(r.URL.Path, "/pfs/") {
					raw = tt.pfs
				}
				return resourceResponse(200, strings.NewReader(raw), "application/json", -1), nil
			})
			out, err := c.ListChatFiles(context.Background(), "chat", "", 0)
			if (err != nil) != tt.wantErr || out == nil || len(out.Files) != tt.wantFiles || out.PFSTotal != tt.wantPFS {
				t.Fatalf("out=%+v err=%v", out, err)
			}
			if calls != 2 {
				t.Fatalf("both sources not queried: %d", calls)
			}
			if len(out.Files) > 0 && out.Files[0].Source != "legacy" {
				t.Fatal("source lost")
			}
		})
	}
	c := resourceTestClient(func(*http.Request) (*http.Response, error) {
		return resourceResponse(404, strings.NewReader("missing"), "application/json", -1), nil
	})
	out, err := c.ListChatFiles(context.Background(), "chat", "", 0)
	if out == nil || !errors.Is(err, ErrResourceNotFound) || errors.Is(err, ErrChatNotFound) {
		t.Fatalf("resource 404: %v", err)
	}
	if !strings.Contains(err.Error(), "legacy") || !strings.Contains(err.Error(), "PFS") {
		t.Fatalf("lost one error: %v", err)
	}
}
func TestChatFileToAndZipTo(t *testing.T) {
	c := resourceTestClient(func(r *http.Request) (*http.Response, error) {
		switch {
		case strings.Contains(r.URL.Path, "/versions/"):
			if r.URL.Query().Get("path") != "dir/a & b.txt" || r.URL.EscapedPath() != "/api/v1/storage/versions/v%2F1/file" {
				t.Fatalf("wrong path: %s", r.URL)
			}
		case strings.Contains(r.URL.Path, "/pfs/chats/"):
			if r.URL.EscapedPath() != "/api/v1/storage/pfs/chats/c%2F1/files/download" {
				t.Fatalf("wrong ZIP path: %s", r.URL)
			}
		default:
			t.Fatalf("unexpected request: %s", r.URL)
		}
		resp := resourceResponse(200, strings.NewReader("payload"), "application/octet-stream", 7)
		resp.Header.Set("Content-Disposition", "attachment; filename*=UTF-8''%E6%96%87%E4%BB%B6.txt")
		return resp, nil
	})
	var dst bytes.Buffer
	name, _, err := c.DownloadChatFileTo(context.Background(), "v/1", "dir/a & b.txt", &dst)
	if err != nil || name != "文件.txt" || dst.String() != "payload" {
		t.Fatalf("file=%s %s %v", name, dst.String(), err)
	}
	dst.Reset()
	name, err = c.DownloadChatFilesZipTo(context.Background(), "c/1", &dst)
	if err != nil || name != "文件.txt" || dst.String() != "payload" {
		t.Fatalf("ZIP=%s %s %v", name, dst.String(), err)
	}
	if _, err := c.DownloadChatFilesZipTo(context.Background(), "c/1", nil); err == nil {
		t.Fatal("nil destination should be rejected without network")
	}
	c = resourceTestClient(func(*http.Request) (*http.Response, error) {
		return resourceResponse(200, &repeatedResourceReader{MaxInlineFileBytes + 1}, "application/zip", -1), nil
	})
	if raw, _, err := c.DownloadChatFilesZip(context.Background(), "chat"); raw != nil || !errors.Is(err, ErrFileTooLarge) {
		t.Fatalf("ZIP inline unbounded: %d %v", len(raw), err)
	}
	if _, err := c.DownloadChatFilesZipTo(context.Background(), "chat", io.Discard); err != nil {
		t.Fatal(err)
	}
}
