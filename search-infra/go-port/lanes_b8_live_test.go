package main

// 临时实弹验证(不入门禁链): 直接调车道函数打真网络, 输出原始响应与解析结果
import (
	"context"
	"fmt"
	"net/http"
	"os"
	"testing"
	"time"
)

func TestLiveB8Lanes(t *testing.T) {
	if os.Getenv("LIVE_B8") == "" {
		t.Skip("set LIVE_B8=1 to run live probes")
	}
	client := &http.Client{Timeout: 8 * time.Second}
	opts := SearchOpts{Query: "breaking bad", MaxResults: 5, Lang: "zh"}
	ctx := context.Background()

	// tvmaze 原始响应体
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.tvmaze.com/search/shows?q=breaking+bad", nil)
	req.Header.Set("User-Agent", laneUA)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("tvmaze raw: %v", err)
	}
	body := readAllString(resp.Body)
	resp.Body.Close()
	fmt.Printf("tvmaze raw: status=%d len=%d head=%.200s\n", resp.StatusCode, len(body), body)

	refs, err := laneTvmaze(ctx, opts, client)
	fmt.Printf("tvmaze lane: refs=%d err=%v\n", len(refs), err)
	for _, r := range refs {
		fmt.Printf("  - %s | %s\n", r.Title, r.URL)
	}

	refs2, err := laneSteam(ctx, SearchOpts{Query: "portal", MaxResults: 5}, client)
	fmt.Printf("steam lane: refs=%d err=%v\n", len(refs2), err)
	for _, r := range refs2 {
		fmt.Printf("  - %s | %s\n", r.Title, r.URL)
	}

	refs3, err := laneGbif(ctx, SearchOpts{Query: "ginkgo biloba", MaxResults: 5}, client)
	fmt.Printf("gbif lane: refs=%d err=%v\n", len(refs3), err)
	for _, r := range refs3 {
		fmt.Printf("  - %s | %s\n", r.Title, r.URL)
	}
}
