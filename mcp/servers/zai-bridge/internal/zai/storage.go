package zai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// 云盘（PFS）接口。响应统一是 {code,message,data} 包装，
// 且 code=0 与 code=200 都表示成功。

// DriveFile 是云盘里的一个文件。
type DriveFile struct {
	ID          string `json:"id"`
	Filename    string `json:"filename"`
	PfsPath     string `json:"pfs_path"`
	Size        int64  `json:"size"`
	ContentType string `json:"content_type"`
	Source      string `json:"source"`
	Category    string `json:"category"`
	CreatedAt   int64  `json:"created_at"`
	UpdatedAt   int64  `json:"updated_at"`
}

// DriveFolder 是云盘里的一个文件夹。
type DriveFolder struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
}

// DrivePage 是 /storage/pfs/drive 的返回。
type DrivePage struct {
	Files        []DriveFile   `json:"files"`
	Folders      []DriveFolder `json:"folders"`
	Page         int           `json:"page"`
	PageSize     int           `json:"page_size"`
	Total        int           `json:"total"`
	TotalFiles   int           `json:"total_files"`
	TotalFolders int           `json:"total_folders"`
}

// StorageQuota 是云盘容量。
type StorageQuota struct {
	BenefitLevel string `json:"benefit_level"`
	PlanLevel    string `json:"plan_level"`
	LimitBytes   int64  `json:"limit_bytes"`
	UsedBytes    int64  `json:"used_bytes"`
	OverQuota    bool   `json:"over_quota"`
	Unlimited    bool   `json:"unlimited"`
}

// StorageStats 是 /storage/pfs/stats 的返回。
type StorageStats struct {
	TotalFiles  int64        `json:"total_files"`
	TotalItems  int64        `json:"total_items"`
	TotalSize   int64        `json:"total_size"`
	ChatCount   int64        `json:"chat_count"`
	FolderCount int64        `json:"folder_count"`
	Quota       StorageQuota `json:"quota"`
}

// pfsData 统一拆 {code,message,data} 包装。
func (c *Client) pfsData(ctx context.Context, method, path string, body any, out any) error {
	var env struct {
		Code    *int            `json:"code"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	if err := c.resourceJSON(ctx, method, path, body, &env); err != nil {
		return err
	}
	if env.Code == nil {
		return errors.New("云盘接口缺少 code")
	}
	if *env.Code != 0 && *env.Code != 200 {
		return fmt.Errorf("云盘接口返回 %d: %s", *env.Code, env.Message)
	}
	if out == nil {
		return nil
	}
	if len(env.Data) == 0 || string(env.Data) == "null" {
		return fmt.Errorf("云盘接口返回空数据")
	}
	return json.Unmarshal(env.Data, out)
}

// DriveList 列出云盘文件。
func (c *Client) DriveList(ctx context.Context, page, pageSize int, filter string) (*DrivePage, error) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	q := fmt.Sprintf("?page=%d&page_size=%d", page, pageSize)
	if filter != "" {
		q += "&filter=" + url.QueryEscape(filter)
	}
	var out DrivePage
	if err := c.pfsData(ctx, http.MethodGet, "/api/v1/storage/pfs/drive"+q, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// DriveStats 取云盘用量与配额。
func (c *Client) DriveStats(ctx context.Context) (*StorageStats, error) {
	var out StorageStats
	if err := c.pfsData(ctx, http.MethodGet, "/api/v1/storage/pfs/stats", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Resource limits apply before inline allocation and throughout streaming copies.
const MaxInlineFileBytes int64 = 1 << 20
const MaxFileTransferBytes int64 = 256 << 20
const maxResourceJSONBytes int64 = 16 << 20

var ErrFileTooLarge = errors.New("文件超过大小上限")
var ErrResourceNotFound = errors.New("文件资源不存在")

// ResourceHTTPError preserves HTTP status without misclassifying a file 404 as a chat.
type ResourceHTTPError struct {
	StatusCode int
	Path       string
	Detail     string
}

func (e *ResourceHTTPError) Error() string {
	return fmt.Sprintf("文件接口 %s 返回 HTTP %d: %s", e.Path, e.StatusCode, e.Detail)
}
func (e *ResourceHTTPError) Is(target error) bool {
	return target == ErrResourceNotFound && e.StatusCode == http.StatusNotFound
}

func resourceReadBounded(r io.Reader, limit int64) ([]byte, error) {
	raw, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > limit {
		return nil, ErrFileTooLarge
	}
	return raw, nil
}
func (c *Client) resourceJSON(ctx context.Context, method, path string, body, out any) error {
	var src io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		src = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL()+path, src)
	if err != nil {
		return err
	}
	for k, v := range c.headers("") {
		req.Header.Set(k, v)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, readErr := resourceReadBounded(resp.Body, MaxInlineFileBytes)
		return errors.Join(&ResourceHTTPError{StatusCode: resp.StatusCode, Path: path, Detail: c.redact(truncate(string(raw), 300))}, readErr)
	}
	raw, err := resourceReadBounded(resp.Body, maxResourceJSONBytes)
	if err != nil {
		return err
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(raw, out)
}

// DriveUpload streams a regular local file; it never buffers the file body.
func (c *Client) DriveUpload(ctx context.Context, localPath, folderID string) (*DriveFile, error) {
	f, err := os.Open(localPath)
	if err != nil {
		return nil, fmt.Errorf("打开本地文件失败: %w", err)
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !stat.Mode().IsRegular() {
		return nil, errors.New("只允许上传普通文件")
	}
	if stat.Size() > MaxFileTransferBytes {
		return nil, ErrFileTooLarge
	}
	return c.DriveUploadFrom(ctx, filepath.Base(localPath), folderID, f)
}

// DriveUploadFrom uses a small multipart envelope and streams the source between
// its prefix and suffix. The caller owns src (and must make blocking custom
// readers cancellable); no detached pipe producer goroutine is created.
func (c *Client) DriveUploadFrom(ctx context.Context, filename, folderID string, src io.Reader) (*DriveFile, error) {
	if src == nil {
		return nil, errors.New("上传 reader 为空")
	}
	if len(filename) > 4096 || len(folderID) > 4096 {
		return nil, errors.New("上传名称过长")
	}
	filename = safeResourceFilename(filename)
	if filename == "" {
		return nil, errors.New("文件名为空")
	}
	var envelope bytes.Buffer
	mw := multipart.NewWriter(&envelope)
	if folderID != "" {
		if err := mw.WriteField("folder_id", folderID); err != nil {
			return nil, err
		}
	}
	if _, err := mw.CreateFormFile("file", filename); err != nil {
		return nil, err
	}
	prefixSize := envelope.Len()
	if err := mw.Close(); err != nil {
		return nil, err
	}
	raw := envelope.Bytes()
	limited := &resourceLimitReader{ctx: ctx, r: src, left: MaxFileTransferBytes}
	body := io.MultiReader(bytes.NewReader(raw[:prefixSize]), limited, bytes.NewReader(raw[prefixSize:]))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL()+"/api/v1/storage/pfs/files/upload", body)
	if err != nil {
		return nil, err
	}
	for k, v := range c.headers("") {
		req.Header.Set(k, v)
	}
	req.Header.Set("content-type", mw.FormDataContentType())
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("上传失败: %w", err)
	}
	defer resp.Body.Close()
	response, readErr := resourceReadBounded(resp.Body, MaxInlineFileBytes)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, errors.Join(&ResourceHTTPError{StatusCode: resp.StatusCode, Path: req.URL.Path, Detail: c.redact(truncate(string(response), 300))}, readErr)
	}
	if readErr != nil {
		return nil, readErr
	}
	var env struct {
		Code    *int   `json:"code"`
		Message string `json:"message"`
		Data    struct {
			File DriveFile `json:"file"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response, &env); err != nil {
		return nil, fmt.Errorf("解析上传响应失败: %w", err)
	}
	if env.Code == nil {
		return nil, errors.New("上传响应缺少 code")
	}
	if *env.Code != 0 && *env.Code != 200 {
		return nil, fmt.Errorf("上传返回 %d: %s", *env.Code, env.Message)
	}
	if env.Data.File.ID == "" {
		return nil, errors.New("上传成功但没返回文件 id")
	}
	return &env.Data.File, nil
}

type resourceLimitReader struct {
	ctx  context.Context
	r    io.Reader
	left int64
}

func (r *resourceLimitReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	if len(p) == 0 {
		return 0, nil
	}
	if r.left == 0 {
		var probe [1]byte
		n, err := r.r.Read(probe[:])
		if n > 0 {
			return 0, ErrFileTooLarge
		}
		return 0, err
	}
	if int64(len(p)) > r.left {
		p = p[:r.left]
	}
	n, err := r.r.Read(p)
	r.left -= int64(n)
	return n, err
}

// DriveDownload keeps a bounded inline result. Larger files require DownloadTo.
func (c *Client) DriveDownload(ctx context.Context, fileID string) ([]byte, string, string, error) {
	var buf bytes.Buffer
	name, ct, err := c.downloadResourceTo(ctx, "/api/v1/storage/pfs/files/"+url.PathEscape(fileID)+"/download", &buf, MaxInlineFileBytes)
	if err != nil {
		return nil, name, ct, err
	}
	return buf.Bytes(), name, ct, nil
}

// DriveDownloadTo streams up to MaxFileTransferBytes. On any error dst can contain
// a partial file; callers should write a temp file and only rename on success.
func (c *Client) DriveDownloadTo(ctx context.Context, fileID string, dst io.Writer) (string, string, error) {
	return c.downloadResourceTo(ctx, "/api/v1/storage/pfs/files/"+url.PathEscape(fileID)+"/download", dst, MaxFileTransferBytes)
}

func resourceEnvelopeError(raw []byte) error {
	var env struct {
		Code    *int            `json:"code"`
		Message string          `json:"message"`
		Detail  json.RawMessage `json:"detail"`
		Success *bool           `json:"success"`
	}
	if json.Unmarshal(raw, &env) != nil {
		return nil
	}
	if env.Code != nil && *env.Code != 0 && *env.Code != 200 {
		return fmt.Errorf("文件接口返回 %d: %s", *env.Code, env.Message)
	}
	if len(env.Detail) > 0 && string(env.Detail) != "null" && string(env.Detail) != "\"\"" {
		return fmt.Errorf("文件接口返回错误 detail: %s", truncate(string(env.Detail), 300))
	}
	if env.Success != nil && !*env.Success {
		return fmt.Errorf("文件接口 success=false: %s", env.Message)
	}
	return nil
}
func (c *Client) downloadResourceTo(ctx context.Context, path string, dst io.Writer, limit int64) (string, string, error) {
	if dst == nil {
		return "", "", errors.New("下载 writer 为空")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL()+path, nil)
	if err != nil {
		return "", "", err
	}
	for k, v := range c.headers("") {
		req.Header.Set(k, v)
	}
	req.Header.Set("accept", "*/*")
	resp, err := c.http.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("下载失败: %w", err)
	}
	defer resp.Body.Close()
	name := filenameFromDisposition(resp.Header.Get("content-disposition"))
	ct := resp.Header.Get("content-type")
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, readErr := resourceReadBounded(resp.Body, MaxInlineFileBytes)
		return name, ct, errors.Join(&ResourceHTTPError{StatusCode: resp.StatusCode, Path: path, Detail: c.redact(truncate(string(raw), 300))}, readErr)
	}
	if resp.ContentLength > limit {
		return name, ct, ErrFileTooLarge
	}
	// Inspect bounded JSON responses for API errors even with a disposition.
	// Large declared JSON attachments stream; a bare oversized JSON response is
	// ambiguous (file vs error envelope) and fails explicitly rather than hiding errors.
	var src io.Reader = resp.Body
	if strings.Contains(strings.ToLower(ct), "application/json") {
		raw, readErr := io.ReadAll(io.LimitReader(resp.Body, MaxInlineFileBytes+1))
		if readErr != nil {
			return name, ct, readErr
		}
		if int64(len(raw)) <= MaxInlineFileBytes {
			if err := resourceEnvelopeError(raw); err != nil {
				return name, ct, err
			}
		} else if name == "" {
			return name, ct, ErrFileTooLarge
		}
		src = io.MultiReader(bytes.NewReader(raw), resp.Body)
	}
	_, err = io.Copy(dst, &resourceLimitReader{ctx: ctx, r: src, left: limit})
	if err != nil {
		return name, ct, fmt.Errorf("写入下载内容失败: %w", err)
	}
	return name, ct, nil
}

// DriveDelete 删除云盘文件（注意：是 POST + ids，不是 DELETE）。
func (c *Client) DriveDelete(ctx context.Context, ids []string) (map[string]any, error) {
	var out map[string]any
	if err := c.pfsData(ctx, http.MethodPost, "/api/v1/storage/pfs/files/batch-delete",
		map[string]any{"ids": ids}, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// filenameFromDisposition uses RFC5987 decoding and returns a basename only.
func filenameFromDisposition(cd string) string {
	_, params, err := mime.ParseMediaType(cd)
	if err == nil {
		return safeResourceFilename(params["filename"])
	}
	// Some legacy servers emit unquoted filenames containing spaces. Accept a
	// simple filename= fallback only; extended values must pass MIME decoding.
	for _, part := range strings.Split(cd, ";")[1:] {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if ok && strings.EqualFold(key, "filename") {
			return safeResourceFilename(strings.Trim(strings.TrimSpace(value), "\""))
		}
	}
	return ""
}
func safeResourceFilename(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	name = name[strings.LastIndex(name, "/")+1:]
	name = strings.TrimSpace(name)
	if !utf8.ValidString(name) {
		return ""
	}
	name = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, name)
	if name == "." || name == ".." {
		return ""
	}
	return name
}
