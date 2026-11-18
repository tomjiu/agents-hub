package zai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

// 会话产物（chat files）。
//
// 这里有两套存储，同一个会话可能只有其中一套：
//   legacy: GET /api/v1/storage/chats/{id}/files
//           返回 {success,data:{message_id,total,has_more,files:[{key,size,last_modified}]}}
//           单文件下载走 /api/v1/storage/versions/{message_id}/file?path={key}
//   pfs:    GET /api/v1/storage/pfs/chats/{id}/files
//           返回 {code,message,data:{groups:[...],total,total_size}}
//           整包下载走 /api/v1/storage/pfs/chats/{id}/files/download
//
// 所以列文件时两边都要问一遍，再合并结果。

// ChatFile 是会话产出的一个文件。
type ChatFile struct {
	// Key 是文件在会话产物目录里的相对路径，下载时要原样传回去。
	Key          string `json:"key"`
	Size         int64  `json:"size"`
	LastModified string `json:"last_modified"`
	// Source 记录这份文件来自哪套存储：legacy / pfs
	Source string `json:"-"`
}

// ChatFiles 是列文件的结果。
type ChatFiles struct {
	MessageID string
	Files     []ChatFile
	HasMore   bool
	// PFSTotal 是另一套存储里的条目数，用于提示用户去打包下载
	PFSTotal int
	PFSSize  int64
}

// ListChatFiles 列出会话产物。
// prefix 为空表示列出全部；maxKeys 为 0 时用服务端默认。
func (c *Client) ListChatFiles(ctx context.Context, chatID, prefix string, maxKeys int) (*ChatFiles, error) {
	out := &ChatFiles{}

	// ---- legacy ----
	q := url.Values{}
	if prefix != "" {
		q.Set("prefix", prefix)
	}
	if maxKeys > 0 {
		q.Set("max_keys", fmt.Sprint(maxKeys))
	}
	path := "/api/v1/storage/chats/" + url.PathEscape(chatID) + "/files"
	if enc := q.Encode(); enc != "" {
		path += "?" + enc
	}

	var legacy struct {
		Success bool `json:"success"`
		Data    *struct {
			MessageID string     `json:"message_id"`
			Total     int        `json:"total"`
			HasMore   bool       `json:"has_more"`
			Files     []ChatFile `json:"files"`
		} `json:"data"`
	}
	legacyErr := c.resourceJSON(ctx, http.MethodGet, path, nil, &legacy)
	if legacyErr == nil && (!legacy.Success || legacy.Data == nil) {
		legacyErr = errors.New("legacy 文件接口 success=false 或缺少 data")
	}
	if legacyErr == nil && legacy.Success {
		out.MessageID = legacy.Data.MessageID
		out.HasMore = legacy.Data.HasMore
		for _, f := range legacy.Data.Files {
			f.Source = "legacy"
			out.Files = append(out.Files, f)
		}
	}

	// ---- pfs ----
	var pfs struct {
		Code    *int   `json:"code"`
		Message string `json:"message"`
		Data    *struct {
			Groups    []json.RawMessage `json:"groups"`
			Total     int               `json:"total"`
			TotalSize int64             `json:"total_size"`
		} `json:"data"`
	}
	pfsErr := c.resourceJSON(ctx, http.MethodGet, "/api/v1/storage/pfs/chats/"+url.PathEscape(chatID)+"/files", nil, &pfs)
	if pfsErr == nil && pfs.Code == nil {
		pfsErr = errors.New("PFS 文件接口缺少 code")
	}
	if pfsErr == nil && *pfs.Code != 0 && *pfs.Code != 200 {
		pfsErr = fmt.Errorf("PFS 文件接口返回 %d: %s", *pfs.Code, pfs.Message)
	}
	if pfsErr == nil && pfs.Data == nil {
		pfsErr = errors.New("PFS 文件接口缺少 data")
	}
	if pfsErr == nil {
		out.PFSTotal = pfs.Data.Total
		out.PFSSize = pfs.Data.TotalSize
	}
	// Empty successful data is distinct from failure. Return partial data with
	// joined errors, so callers cannot silently claim the list is complete.
	if legacyErr != nil {
		legacyErr = fmt.Errorf("legacy 文件列表: %w", legacyErr)
	}
	if pfsErr != nil {
		pfsErr = fmt.Errorf("PFS 文件列表: %w", pfsErr)
	}
	return out, errors.Join(legacyErr, pfsErr)
}

// DownloadChatFile is bounded to MaxInlineFileBytes; metadata is a decoded filename.
func (c *Client) DownloadChatFile(ctx context.Context, versionID, key string) ([]byte, string, string, error) {
	var buf bytes.Buffer
	name, ct, err := c.downloadResourceTo(ctx, chatFileDownloadPath(versionID, key), &buf, MaxInlineFileBytes)
	if err != nil {
		return nil, name, ct, err
	}
	return buf.Bytes(), name, ct, nil
}
func chatFileDownloadPath(versionID, key string) string {
	q := url.Values{}
	q.Set("path", key)
	return "/api/v1/storage/versions/" + url.PathEscape(versionID) + "/file?" + q.Encode()
}

// DownloadChatFileTo streams a legacy artifact to dst. Error may leave partial data.
func (c *Client) DownloadChatFileTo(ctx context.Context, versionID, key string, dst io.Writer) (string, string, error) {
	return c.downloadResourceTo(ctx, chatFileDownloadPath(versionID, key), dst, MaxFileTransferBytes)
}

// DownloadChatFilesZip retains a bounded compatibility API. Prefer ZipTo for files.
func (c *Client) DownloadChatFilesZip(ctx context.Context, chatID string) ([]byte, string, error) {
	var buf bytes.Buffer
	name, _, err := c.downloadResourceTo(ctx, "/api/v1/storage/pfs/chats/"+url.PathEscape(chatID)+"/files/download", &buf, MaxInlineFileBytes)
	if err != nil {
		return nil, name, err
	}
	return buf.Bytes(), name, nil
}

// DownloadChatFilesZipTo streams the archive. The caller must supply a save
// target, use a temporary file and only publish it after successful completion.
func (c *Client) DownloadChatFilesZipTo(ctx context.Context, chatID string, dst io.Writer) (string, error) {
	name, _, err := c.downloadResourceTo(ctx, "/api/v1/storage/pfs/chats/"+url.PathEscape(chatID)+"/files/download", dst, MaxFileTransferBytes)
	return name, err
}
