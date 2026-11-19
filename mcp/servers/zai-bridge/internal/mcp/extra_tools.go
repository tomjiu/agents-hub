package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
	"unicode/utf8"
)

// 额外工具：用量查询 + 云盘读写。
// 这些都不触发验证码，纯 HTTP 只读/直传。

func extraTools() []ToolDef {
	return []ToolDef{
		{
			Name: "get_usage",
			Description: "查询账户用量：今日/昨日/本月 token 消耗、" +
				"各功能额度（如 agent 模式剩余次数）以及当前套餐等级。",
			InputSchema: map[string]any{"type": "object", "properties": map[string]any{}},
		},
		{
			Name: "list_files",
			Description: "列出云盘（PFS）里的文件和文件夹。" +
				"云端 agent 产出的文件会自动保存到这里，可用 download_file 取回。",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"page":      map[string]any{"type": "integer", "description": "页码，默认 1"},
					"page_size": map[string]any{"type": "integer", "description": "每页条数，默认 20"},
					"filter":    map[string]any{"type": "string", "description": "过滤类型，如 all / image / document"},
				},
			},
		},
		{
			Name: "download_file",
			Description: "从云盘下载文件。默认把文本内容直接返回；" +
				"给了 save_to 就写到本地路径（适合二进制或大文件）。",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"file_id":   map[string]any{"type": "string", "description": "文件 id（从 list_files 获取）"},
					"save_to":   map[string]any{"type": "string", "description": "保存到本地该路径（可选）"},
					"max_chars": map[string]any{"type": "integer", "description": "直接返回时的最大字符数，默认 20000"},
				},
				"required": []string{"file_id"},
			},
		},
		{
			Name:        "upload_file",
			Description: "把本地文件上传到云盘，返回文件 id。上传后可在会话里引用。",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path":      map[string]any{"type": "string", "description": "本地文件路径"},
					"folder_id": map[string]any{"type": "string", "description": "目标文件夹 id（可选，默认根目录）"},
				},
				"required": []string{"path"},
			},
		},
		{
			Name:        "delete_file",
			Description: "从云盘删除文件（可批量）。删除后不可恢复，操作前建议先用 list_files 确认 id。",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"file_ids": map[string]any{
						"type":        "array",
						"items":       map[string]any{"type": "string"},
						"description": "要删除的文件 id 列表",
					},
				},
				"required": []string{"file_ids"},
			},
		},
	}
}

func (d Deps) getUsageContext(parent context.Context, raw json.RawMessage) (any, *RPCError) {
	if rerr := validateArguments(raw); rerr != nil {
		return nil, rerr
	}
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()

	var sb strings.Builder

	if u, err := d.Client.TokenUsage(ctx); err == nil {
		fmt.Fprintf(&sb, "=== token 消耗（%s）===\n", u.Timezone)
		fmt.Fprintf(&sb, "今日 %s: %d\n", u.Today.Date, u.Today.TotalTokens)
		fmt.Fprintf(&sb, "昨日 %s: %d\n", u.Yesterday.Date, u.Yesterday.TotalTokens)
		fmt.Fprintf(&sb, "本月 %s: %d\n", u.Month.Month, u.Month.TotalTokens)
	} else {
		fmt.Fprintf(&sb, "=== token 消耗 ===\n读取失败: %v\n", err)
	}

	sb.WriteString("\n")
	if q, err := d.Client.FeatureQuota(ctx); err == nil {
		fmt.Fprintf(&sb, "=== 功能额度（%s 重置）===\n", q.ResetAt)
		for _, it := range q.Items {
			limit, remaining := "未知", "未知"
			if it.Limit != nil {
				limit = fmt.Sprint(*it.Limit)
			} else if strings.EqualFold(it.Status, "unlimited") {
				limit = "明确不限量"
			}
			if it.Remaining != nil {
				remaining = fmt.Sprint(*it.Remaining)
			}
			fmt.Fprintf(&sb, "- %s: 已用 %d / 上限 %s，剩余 %s，状态 %s\n", it.Label, it.Used, limit, remaining, it.Status)
		}
	} else {
		fmt.Fprintf(&sb, "=== 功能额度 ===\n读取失败: %v\n", err)
	}

	sb.WriteString("\n")
	if s, err := d.Client.Subscription(ctx); err == nil {
		fmt.Fprintf(&sb, "=== 套餐 ===\n%s（%s）\n", s.Level, s.PlanType)
	} else {
		fmt.Fprintf(&sb, "=== 套餐 ===\n读取失败: %v\n", err)
	}

	if st, err := d.Client.DriveStats(ctx); err == nil {
		fmt.Fprintf(&sb, "\n=== 云盘 ===\n%d 个文件，占用 %s / %s\n",
			st.TotalFiles, humanBytes(st.Quota.UsedBytes), humanBytes(st.Quota.LimitBytes))
	}

	return textResult(sb.String()), nil
}

func (d Deps) listFilesContext(parent context.Context, raw json.RawMessage) (any, *RPCError) {
	if rerr := validateArguments(raw); rerr != nil {
		return nil, rerr
	}
	var a struct {
		Page     int    `json:"page"`
		PageSize int    `json:"page_size"`
		Filter   string `json:"filter"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, &RPCError{Code: CodeInvalidParams, Message: err.Error()}
	}

	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()

	pg, err := d.Client.DriveList(ctx, a.Page, a.PageSize, a.Filter)
	if err != nil {
		return errResult(err), nil
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "云盘：%d 个文件，%d 个文件夹（第 %d 页）\n",
		pg.TotalFiles, pg.TotalFolders, pg.Page)
	if len(pg.Folders) > 0 {
		sb.WriteString("\n[文件夹]\n")
		for _, f := range pg.Folders {
			fmt.Fprintf(&sb, "- %s  id=%s\n", f.Name, f.ID)
		}
	}
	if len(pg.Files) > 0 {
		sb.WriteString("\n[文件]\n")
		for _, f := range pg.Files {
			fmt.Fprintf(&sb, "- %s  %s  id=%s\n", f.Filename, humanBytes(f.Size), f.ID)
		}
	}
	if len(pg.Files) == 0 && len(pg.Folders) == 0 {
		sb.WriteString("\n(云盘为空)\n")
	}
	return textResult(sb.String()), nil
}

func (d Deps) downloadFileContext(parent context.Context, raw json.RawMessage) (any, *RPCError) {
	if rerr := validateArguments(raw); rerr != nil {
		return nil, rerr
	}
	var a struct {
		FileID   string `json:"file_id"`
		SaveTo   string `json:"save_to"`
		MaxChars int    `json:"max_chars"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, &RPCError{Code: CodeInvalidParams, Message: err.Error()}
	}
	if a.FileID == "" {
		return nil, &RPCError{Code: CodeInvalidParams, Message: "缺少 file_id"}
	}
	a.MaxChars = defaultInt(raw, "max_chars", 20000)

	ctx, cancel := context.WithTimeout(parent, 120*time.Second)
	defer cancel()

	if a.SaveTo != "" {
		var name, ct string
		size, err := saveStream(a.SaveTo, func(w io.Writer) error {
			var err error
			name, ct, err = d.Client.DriveDownloadTo(ctx, a.FileID, w)
			return err
		})
		if err != nil {
			return errResult(err), nil
		}
		return textResult(fmt.Sprintf("已保存 %s\n大小: %s\n类型: %s\n路径: %s", name, humanBytes(size), ct, a.SaveTo)), nil
	}
	data, name, contentType, err := d.Client.DriveDownload(ctx, a.FileID)
	if err != nil {
		return errResult(err), nil
	}

	if !isProbablyText(data) {
		return textResult(fmt.Sprintf(
			"这是二进制文件（%s，%s），没有直接返回内容。\n请指定 save_to 参数保存到本地路径。",
			humanBytes(int64(len(data))), contentType)), nil
	}

	s := string(data)
	if a.MaxChars > 0 && utf8.RuneCountInString(s) > a.MaxChars {
		r := []rune(s)
		s = string(r[:a.MaxChars]) + fmt.Sprintf("\n...（已截断，原文 %d 字符）", len(r))
	}
	return textResult(fmt.Sprintf("文件名: %s\n大小: %s\n类型: %s\n\n%s",
		name, humanBytes(int64(len(data))), contentType, s)), nil
}

func (d Deps) uploadFileContext(parent context.Context, raw json.RawMessage) (any, *RPCError) {
	if rerr := validateArguments(raw); rerr != nil {
		return nil, rerr
	}
	var a struct {
		Path     string `json:"path"`
		FolderID string `json:"folder_id"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, &RPCError{Code: CodeInvalidParams, Message: err.Error()}
	}
	if a.Path == "" {
		return nil, &RPCError{Code: CodeInvalidParams, Message: "缺少 path"}
	}
	if st, err := os.Stat(a.Path); err != nil || st.IsDir() {
		return errResult(fmt.Errorf("不是可读文件: %s", a.Path)), nil
	}

	ctx, cancel := context.WithTimeout(parent, 300*time.Second)
	defer cancel()

	f, err := d.Client.DriveUpload(ctx, a.Path, a.FolderID)
	if err != nil {
		return errResult(err), nil
	}
	return textResult(fmt.Sprintf("已上传\n文件名: %s\n大小: %s\nid: %s\n路径: %s",
		f.Filename, humanBytes(f.Size), f.ID, f.PfsPath)), nil
}

// humanBytes 把字节数格式化成可读大小。
func humanBytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	units := []string{"KB", "MB", "GB", "TB"}
	v := float64(n)
	for _, u := range units {
		v /= unit
		if v < unit {
			return fmt.Sprintf("%.1f %s", v, u)
		}
	}
	return fmt.Sprintf("%.1f PB", v)
}

// isProbablyText requires valid UTF-8 and no embedded NUL in the preview.
func isProbablyText(data []byte) bool {
	if !utf8.Valid(data) {
		return false
	}
	n := len(data)
	if n > 8192 {
		n = 8192
	}
	for i := 0; i < n; i++ {
		if data[i] == 0 {
			return false
		}
	}
	return true
}

func (d Deps) deleteFileContext(parent context.Context, raw json.RawMessage) (any, *RPCError) {
	if rerr := validateArguments(raw); rerr != nil {
		return nil, rerr
	}
	var a struct {
		FileIDs []string `json:"file_ids"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, &RPCError{Code: CodeInvalidParams, Message: err.Error()}
	}
	if len(a.FileIDs) == 0 {
		return nil, &RPCError{Code: CodeInvalidParams, Message: "缺少 file_ids"}
	}

	ctx, cancel := context.WithTimeout(parent, 60*time.Second)
	defer cancel()

	out, err := d.Client.DriveDelete(ctx, a.FileIDs)
	if err != nil {
		return errResult(err), nil
	}
	req, _ := out["requested"].(float64)
	del, _ := out["deleted"].(float64)
	return textResult(fmt.Sprintf("已删除 %d / %d 个文件", int64(del), int64(req))), nil
}
