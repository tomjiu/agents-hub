package main

// S6 (issue #3, 2026-11-25 A/B 实弹): bingweb 进编程专线 site: 腿 — Go 侧对等。
// 红灯先行: 修复前 programming siteEngines 不含 bingweb, 且 site 腿为轮询单引擎
// (1 个 siteTarget 时恒取 index 0 = duckduckgo, bingrss 从未出勤 — 与 TS 全列表语义分歧)。

import (
	"strings"
	"testing"
)

func TestProgrammingSiteEnginesIncludeBingweb(t *testing.T) {
	dp := lookupDomains("python sqlite wal tutorial")
	if dp == nil {
		t.Fatal("programming route expected")
	}
	found := false
	for _, e := range dp.siteEngines {
		if e == "bingweb" {
			found = true
		}
	}
	if !found {
		t.Errorf("programming siteEngines missing bingweb (got %v)", dp.siteEngines)
	}
}

// site 腿应携带全部 siteEngines (TS 语义对齐: site: 查询同时跑 ddg+bingrss+bingweb),
// 不再轮询单引擎 — ddg 出口限流时不再单点塌方 (2026-11-25 A/B: 编程题 ddg 拖到 recovery 10s)。
func TestSiteLegCarriesAllSiteEngines(t *testing.T) {
	dp := lookupDomains("python sqlite wal tutorial")
	if dp == nil {
		t.Fatal("programming route expected")
	}
	if len(dp.siteQueries) == 0 {
		t.Fatal("expected site queries for programming")
	}
	for _, sq := range dp.siteQueries {
		if !strings.Contains(sq, "site:docs.python.org") {
			t.Errorf("unexpected site query: %s", sq)
		}
	}
	if len(dp.siteEngines) < 3 {
		t.Errorf("expected >=3 site engines (ddg/bingrss/bingweb), got %v", dp.siteEngines)
	}
	// 车道注册名都存在 (拼写/注册表漂移守卫)
	for _, e := range dp.siteEngines {
		if _, ok := laneRegistry[e]; !ok {
			t.Errorf("site engine %q not registered in laneRegistry", e)
		}
	}
}
