package mcp

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// saveStream publishes only a complete download; failures leave an existing
// destination untouched and remove the temporary partial file.
func saveStream(path string, download func(io.Writer) error) (int64, error) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return 0, err
	}
	f, err := os.CreateTemp(dir, ".zai-download-*")
	if err != nil {
		return 0, err
	}
	temporary := f.Name()
	defer os.Remove(temporary)
	if err = download(f); err != nil {
		_ = f.Close()
		return 0, err
	}
	st, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return 0, err
	}
	if err = f.Close(); err != nil {
		return 0, err
	}
	if err = os.Rename(temporary, path); err != nil {
		return 0, fmt.Errorf("publish download: %w", err)
	}
	return st.Size(), nil
}
