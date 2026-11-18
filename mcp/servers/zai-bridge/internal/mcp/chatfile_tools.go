package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"
	"unicode/utf8"
)

// 会话产物相关工具：列出 agent 在某个会话里产出的文件，并取回内容。

func chatFileTools() []ToolDef {
	return []ToolDef{
		{
			Name: "list_chat_files",
			Description: "列出某个会话里 agent 产出的文件（不是云盘，是会话产物）。" +
				"返回文件相对路径、大小、修改时间；拿 path 交给 download_chat_file 下载。",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"chat_id":  map[string]any{"type": "string", "description": "会话 id"},
					"prefix":   map[string]any{"type": "string", "description": "只看某个目录/前缀，如 download/"},
					"max_keys": map[string]any{"type": "integer", "description": "最多返回多少个，默认 200"},
				},
				"required": []string{"chat_id"},
			},
		},
		{
			Name: "download_chat_file",
			Description: "下载会话里的单个产物文件。默认返回文本内容；" +
				"给 save_to 就写到本地路径（适合二进制）。" +
				"也可以给 all=true 把该会话的产物整包下载成 zip。",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"chat_id":   map[string]any{"type": "string", "description": "会话 id"},
					"path":      map[string]any{"type": "string", "description": "文件相对路径（list_chat_files 返回的 path）"},
					"all":       map[string]any{"type": "boolean", "description": "设为 true 时整包下载 zip"},
					"save_to":   map[string]any{"type": "string", "description": "保存到本地该路径"},
					"max_chars": map[string]any{"type": "integer", "description": "直接返回时的最大字符数，默认 20000"},
				},
				"required": []string{"chat_id"},
			},
		},
	}
}

func (d Deps) listChatFilesContext(parent context.Context, raw json.RawMessage) (any, *RPCError) {
	if rerr := validateArguments(raw); rerr != nil {
		return nil, rerr
	}
	var a struct {
		ChatID  string `json:"chat_id"`
		Prefix  string `json:"prefix"`
		MaxKeys int    `json:"max_keys"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, &RPCError{Code: CodeInvalidParams, Message: err.Error()}
	}
	if a.ChatID == "" {
		return nil, &RPCError{Code: CodeInvalidParams, Message: "缺少 chat_id"}
	}
	if a.MaxKeys <= 0 {
		a.MaxKeys = 200
	}

	ctx, cancel := context.WithTimeout(parent, 60*time.Second)
	defer cancel()

	cf, err := d.Client.ListChatFiles(ctx, a.ChatID, a.Prefix, a.MaxKeys)
	if err != nil && cf == nil {
		return errResult(err), nil
	}

	var sb strings.Builder
	if len(cf.Files) == 0 {
		fmt.Fprintf(&sb, "该会话没有 legacy 产物文件。\n")
	} else {
		fmt.Fprintf(&sb, "会话产物：%d 个文件\n\n", len(cf.Files))
		for _, f := range cf.Files {
			fmt.Fprintf(&sb, "- %s  %s  %s\n", f.Key, humanBytes(f.Size), f.LastModified)
		}
		if cf.HasMore {
			sb.WriteString("\n（还有更多，可用 prefix 或调大 max_keys）\n")
		}
	}
	if cf.PFSTotal > 0 {
		fmt.Fprintf(&sb, "\n另有 PFS 产物 %d 个，共 %s；用 download_chat_file(all=true) 打包下载。\n",
			cf.PFSTotal, humanBytes(cf.PFSSize))
	}
	result := textResult(sb.String())
	if err != nil {
		result.Content[0].Text += fmt.Sprintf("\n列表不完整: %v\n", err)
		result.IsError = true
	}
	return result, nil
}

func (d Deps) downloadChatFileContext(parent context.Context, raw json.RawMessage) (any, *RPCError) {
	if rerr := validateArguments(raw); rerr != nil {
		return nil, rerr
	}
	var a struct {
		ChatID   string `json:"chat_id"`
		Path     string `json:"path"`
		All      bool   `json:"all"`
		SaveTo   string `json:"save_to"`
		MaxChars int    `json:"max_chars"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, &RPCError{Code: CodeInvalidParams, Message: err.Error()}
	}
	if a.ChatID == "" {
		return nil, &RPCError{Code: CodeInvalidParams, Message: "缺少 chat_id"}
	}
	if !a.All && a.Path == "" {
		return nil, &RPCError{Code: CodeInvalidParams, Message: "需要 path，或设 all=true 打包下载"}
	}
	a.MaxChars = defaultInt(raw, "max_chars", 20000)

	ctx, cancel := context.WithTimeout(parent, 180*time.Second)
	defer cancel()

	// 整包下载必须有输出路径，避免生成整包后丢弃。
	if a.All {
		if a.SaveTo == "" {
			return nil, &RPCError{Code: CodeInvalidParams, Message: "all=true requires save_to"}
		}
		var name string
		size, err := saveStream(a.SaveTo, func(w io.Writer) error {
			var err error
			name, err = d.Client.DownloadChatFilesZipTo(ctx, a.ChatID, w)
			return err
		})
		if err != nil {
			// 103007 = 该会话没有 PFS 产物。这种情况通常意味着产物在 legacy 存储里，
			// 应该逐个下载，而不是报一个看不懂的错误码。
			if strings.Contains(err.Error(), "103007") {
				cf, lerr := d.Client.ListChatFiles(ctx, a.ChatID, "", 0)
				if lerr != nil {
					return errResult(lerr), nil
				}
				if len(cf.Files) > 0 {
					var names []string
					for _, f := range cf.Files {
						names = append(names, f.Key)
					}
					return textResult(fmt.Sprintf(
						"该会话没有 PFS 产物，无法打包下载。\n"+
							"但它有 %d 个 legacy 产物，请用 path 参数逐个下载：\n- %s",
						len(cf.Files), strings.Join(names, "\n- "))), nil
				}
				return textResult("该会话没有任何产物文件。"), nil
			}
			return errResult(err), nil
		}
		return textResult(fmt.Sprintf("已打包保存 %s 到 %s（%s）", name, a.SaveTo, humanBytes(size))), nil
	}

	// 单文件下载：需要先拿到该会话的 message_id
	cf, err := d.Client.ListChatFiles(ctx, a.ChatID, "", 0)
	if err != nil {
		return errResult(err), nil
	}
	if cf.MessageID == "" {
		return errResult(fmt.Errorf("该会话没有可下载的 legacy 产物（PFS 产物请用 all=true 打包下载）")), nil
	}

	name := filepathBase(a.Path)
	if a.SaveTo != "" {
		var ct string
		size, err := saveStream(a.SaveTo, func(w io.Writer) error {
			var err error
			name, ct, err = d.Client.DownloadChatFileTo(ctx, cf.MessageID, a.Path, w)
			return err
		})
		if err != nil {
			return errResult(err), nil
		}
		return textResult(fmt.Sprintf("已保存 %s\n大小: %s\n类型: %s\n路径: %s", name, humanBytes(size), ct, a.SaveTo)), nil
	}
	data, cd, ct, err := d.Client.DownloadChatFile(ctx, cf.MessageID, a.Path)
	if err != nil {
		return errResult(err), nil
	}

	if !isProbablyText(data) {
		return textResult(fmt.Sprintf(
			"这是二进制文件（%s，%s），没有直接返回内容。\n请指定 save_to 参数保存到本地路径。",
			humanBytes(int64(len(data))), ct)), nil
	}

	s := string(data)
	if a.MaxChars > 0 && utf8.RuneCountInString(s) > a.MaxChars {
		r := []rune(s)
		s = string(r[:a.MaxChars]) + fmt.Sprintf("\n...（已截断，原文 %d 字符）", len(r))
	}
	_ = cd
	return textResult(fmt.Sprintf("文件: %s\n大小: %s\n类型: %s\n\n%s",
		name, humanBytes(int64(len(data))), ct, s)), nil
}

func filepathBase(path string) string {
	if i := strings.LastIndex(path, "/"); i >= 0 {
		return path[i+1:]
	}
	return path
}
