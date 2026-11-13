package zai

import (
	"bytes"
	"context"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"

	"github.com/local/zai-bridge/internal/config"
)

type resourceFakeTransport func(*http.Request) (*http.Response, error)

func (f resourceFakeTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func resourceTestClient(f resourceFakeTransport) *Client {
	return &Client{cfg: config.Config{BaseURL: "https://offline.invalid", Token: "fake"}, http: &http.Client{Transport: f}}
}
func resourceResponse(status int, body io.Reader, ct string, length int64) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(body), Header: http.Header{"Content-Type": {ct}}, ContentLength: length}
}

type repeatedResourceReader struct{ left int64 }

func (r *repeatedResourceReader) Read(p []byte) (int, error) {
	if r.left <= 0 {
		return 0, io.EOF
	}
	if int64(len(p)) > r.left {
		p = p[:r.left]
	}
	for i := range p {
		p[i] = 'x'
	}
	r.left -= int64(len(p))
	return len(p), nil
}

type resourceFailReader struct{ err error }

func (r resourceFailReader) Read([]byte) (int, error) { return 0, r.err }

type resourceFailWriter struct{ err error }

func (w resourceFailWriter) Write([]byte) (int, error) { return 0, w.err }

func TestResourceDownloadStreamingAndInlineLimit(t *testing.T) {
	const size = 2 << 20
	var calls int
	c := resourceTestClient(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.EscapedPath() != "/api/v1/storage/pfs/files/a%2Fb/download" {
			t.Fatalf("escaped fileID: %s", r.URL.EscapedPath())
		}
		resp := resourceResponse(200, &repeatedResourceReader{size}, "application/octet-stream", size)
		resp.Header.Set("Content-Disposition", "attachment; filename*=UTF-8''%E6%B5%8B%E8%AF%95.bin")
		return resp, nil
	})
	raw, _, _, err := c.DriveDownload(context.Background(), "a/b")
	if !errors.Is(err, ErrFileTooLarge) || raw != nil {
		t.Fatalf("inline should be bounded: %d %v", len(raw), err)
	}
	var dst bytes.Buffer
	name, ct, err := c.DriveDownloadTo(context.Background(), "a/b", &dst)
	if err != nil || name != "测试.bin" || ct != "application/octet-stream" || dst.Len() != size {
		t.Fatalf("stream: %s %s %d %v", name, ct, dst.Len(), err)
	}
	if calls != 2 {
		t.Fatalf("calls=%d", calls)
	}
}
func TestResourceDownloadBoundsAndErrors(t *testing.T) {
	sentinel := errors.New("local IO failure")
	tests := []struct {
		name   string
		status int
		length int64
		body   io.Reader
		writer io.Writer
		want   error
	}{
		{"length", 200, MaxFileTransferBytes + 1, strings.NewReader(""), io.Discard, ErrFileTooLarge},
		{"chunked", 200, -1, &repeatedResourceReader{MaxFileTransferBytes + 1}, io.Discard, ErrFileTooLarge},
		{"read", 200, -1, resourceFailReader{sentinel}, io.Discard, sentinel},
		{"write", 200, 3, strings.NewReader("abc"), resourceFailWriter{sentinel}, sentinel},
		{"404", 404, -1, strings.NewReader("no file"), io.Discard, ErrResourceNotFound},
		{"404-read", 404, -1, resourceFailReader{sentinel}, io.Discard, sentinel},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := resourceTestClient(func(*http.Request) (*http.Response, error) {
				return resourceResponse(tt.status, tt.body, "application/octet-stream", tt.length), nil
			})
			_, _, err := c.DriveDownloadTo(context.Background(), "file", tt.writer)
			if !errors.Is(err, tt.want) {
				t.Fatalf("error=%v want %v", err, tt.want)
			}
			if errors.Is(err, ErrChatNotFound) {
				t.Fatal("file error misclassified as chat")
			}
			if tt.status == 404 {
				var status *ResourceHTTPError
				if !errors.As(err, &status) || status.StatusCode != 404 {
					t.Fatalf("lost status: %v", err)
				}
			}
		})
	}
	c := resourceTestClient(func(r *http.Request) (*http.Response, error) { return nil, r.Context().Err() })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := c.DriveDownloadTo(ctx, "file", io.Discard); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel=%v", err)
	}
}
func TestResourceDownloadJSONErrorsAndJSONFiles(t *testing.T) {
	for _, raw := range []string{`{"code":103007,"message":"no artifacts"}`, `{"detail":"missing"}`, `{"success":false}`} {
		c := resourceTestClient(func(*http.Request) (*http.Response, error) {
			resp := resourceResponse(200, strings.NewReader(raw), "application/json", int64(len(raw)))
			resp.Header.Set("Content-Disposition", "attachment; filename=error.json")
			return resp, nil
		})
		var dst bytes.Buffer
		if _, _, err := c.DriveDownloadTo(context.Background(), "file", &dst); err == nil || dst.Len() != 0 {
			t.Fatalf("JSON error written: %v %s", err, dst.String())
		}
	}
	c := resourceTestClient(func(*http.Request) (*http.Response, error) {
		resp := resourceResponse(200, &repeatedResourceReader{2 << 20}, "application/json", 2<<20)
		resp.Header.Set("Content-Disposition", "attachment; filename=large.json")
		return resp, nil
	})
	if _, _, err := c.DriveDownloadTo(context.Background(), "file", io.Discard); err != nil {
		t.Fatalf("large JSON streams: %v", err)
	}
}
func TestResourceUploadStreamsAndPreservesErrors(t *testing.T) {
	const size = 4 << 20
	source := &repeatedResourceReader{size}
	c := resourceTestClient(func(r *http.Request) (*http.Response, error) {
		if source.left != size {
			t.Fatal("source buffered before request dispatch")
		}
		_, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil {
			t.Fatal(err)
		}
		mr := multipart.NewReader(r.Body, params["boundary"])
		folder, err := mr.NextPart()
		if err != nil {
			t.Fatal(err)
		}
		raw, err := io.ReadAll(folder)
		if err != nil || string(raw) != "folder" {
			t.Fatalf("folder=%s %v", raw, err)
		}
		part, err := mr.NextPart()
		if err != nil {
			t.Fatal(err)
		}
		if part.FileName() != "source.bin" {
			t.Fatalf("filename=%s", part.FileName())
		}
		n, err := io.Copy(io.Discard, part)
		if err != nil || n != size {
			t.Fatalf("streamed=%d %v", n, err)
		}
		if _, err := mr.NextPart(); err != io.EOF {
			t.Fatalf("multipart ending=%v", err)
		}
		return resourceResponse(200, strings.NewReader(`{"code":0,"data":{"file":{"id":"id"}}}`), "application/json", -1), nil
	})
	file, err := c.DriveUploadFrom(context.Background(), "../source.bin", "folder", source)
	if err != nil || file.ID != "id" {
		t.Fatalf("upload=%v %v", file, err)
	}
	sentinel := errors.New("reader broke")
	c = resourceTestClient(func(r *http.Request) (*http.Response, error) { _, err := io.Copy(io.Discard, r.Body); return nil, err })
	if _, err := c.DriveUploadFrom(context.Background(), "f", "", resourceFailReader{sentinel}); !errors.Is(err, sentinel) {
		t.Fatalf("reader error lost: %v", err)
	}
	if _, err := c.DriveUploadFrom(context.Background(), "f", "", &repeatedResourceReader{MaxFileTransferBytes + 1}); !errors.Is(err, ErrFileTooLarge) {
		t.Fatalf("upload bound=%v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := c.DriveUploadFrom(ctx, "f", "", strings.NewReader("x")); !errors.Is(err, context.Canceled) {
		t.Fatalf("upload cancel=%v", err)
	}
}
func TestResourceUploadResponseErrors(t *testing.T) {
	sentinel := errors.New("response IO error")
	for _, tt := range []struct {
		name   string
		status int
		body   io.Reader
		want   error
	}{
		{"status and read", 403, resourceFailReader{sentinel}, sentinel},
		{"success read", 200, resourceFailReader{sentinel}, sentinel},
		{"oversized response", 200, &repeatedResourceReader{MaxInlineFileBytes + 1}, ErrFileTooLarge},
	} {
		t.Run(tt.name, func(t *testing.T) {
			c := resourceTestClient(func(r *http.Request) (*http.Response, error) {
				io.Copy(io.Discard, r.Body)
				return resourceResponse(tt.status, tt.body, "application/json", -1), nil
			})
			_, err := c.DriveUploadFrom(context.Background(), "file", "", strings.NewReader("content"))
			if !errors.Is(err, tt.want) {
				t.Fatalf("response error lost: %v", err)
			}
			if tt.status == 403 {
				var status *ResourceHTTPError
				if !errors.As(err, &status) || status.StatusCode != 403 {
					t.Fatalf("status lost: %v", err)
				}
			}
		})
	}
	for _, raw := range []string{`{"data":{"file":{"id":"id"}}}`, `{"code":500,"message":"failed"}`, `{"code":0,"data":{}}`, "invalid"} {
		c := resourceTestClient(func(r *http.Request) (*http.Response, error) {
			io.Copy(io.Discard, r.Body)
			return resourceResponse(200, strings.NewReader(raw), "application/json", -1), nil
		})
		if _, err := c.DriveUploadFrom(context.Background(), "f", "", strings.NewReader("x")); err == nil {
			t.Fatalf("accepted failed/malformed response %s", raw)
		}
	}
}
func TestResourceHTTPErrorDetailIsBoundedAndRedacted(t *testing.T) {
	c := resourceTestClient(func(*http.Request) (*http.Response, error) {
		return resourceResponse(403, strings.NewReader("fake token"+strings.Repeat("x", 500)), "application/json", -1), nil
	})
	c.cfg.Cookie = "cookie-secret"
	_, _, err := c.DriveDownloadTo(context.Background(), "file", io.Discard)
	var status *ResourceHTTPError
	if !errors.As(err, &status) || status.StatusCode != 403 {
		t.Fatalf("typed HTTP error missing: %v", err)
	}
	if strings.Contains(status.Detail, "fake") || len(status.Detail) > 320 {
		t.Fatalf("unsafe/unbounded detail: %q", status.Detail)
	}
}
func TestResourceJSONNotFoundAndMalformedEnvelope(t *testing.T) {
	c := resourceTestClient(func(*http.Request) (*http.Response, error) {
		return resourceResponse(404, strings.NewReader("missing"), "application/json", -1), nil
	})
	if _, err := c.DriveList(context.Background(), 1, 20, ""); !errors.Is(err, ErrResourceNotFound) || errors.Is(err, ErrChatNotFound) {
		t.Fatalf("wrong 404: %v", err)
	}
	for _, raw := range []string{"{}", `{"code":0,"data":null}`} {
		c = resourceTestClient(func(*http.Request) (*http.Response, error) {
			return resourceResponse(200, strings.NewReader(raw), "application/json", -1), nil
		})
		if _, err := c.DriveList(context.Background(), 1, 20, ""); err == nil {
			t.Fatalf("accepted malformed envelope: %s", raw)
		}
	}
}
