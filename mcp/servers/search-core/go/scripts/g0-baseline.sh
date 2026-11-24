#!/usr/bin/env bash
# G0 基线编排 (issue #3 评论 G0): Go/TS 两侧同输入、同环境、相邻时间对照。
# 产出: catalog/audit/search-go-g0-baseline.json
# 纪律: 本地合成资源基线, 不冒充公网 SERP 质量; 未测项如实标注。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"        # mcp/servers/search-core
GO_DIR="$ROOT/go"
TS_DIR="$ROOT/typescript"
REPO="$(cd "$ROOT/../../.." && pwd)"              # agents-hub 仓根
AUDIT="$REPO/catalog/audit"
OUT="$AUDIT/search-go-g0-baseline.json"
GO_OUT=/tmp/g0-go.json
TS_OUT=/tmp/g0-ts.json

export PATH=/home/z/go/bin:$PATH GOROOT=/home/z/go GOPATH=/home/z/gopath

echo "[1/6] 生成共用密集 HTML 输入 (1MB/2MB)"
node "$TS_DIR/scripts/g0-gen-fixture.mjs"

echo "[2/6] 构建 Go 默认变体 (纯 Go)"
( cd "$GO_DIR" && go build -o /tmp/searchcore-g0 . )

echo "[3/6] 运行 Go 侧探针"
( cd "$GO_DIR" && SC_G0=1 SC_G0_BIN=/tmp/searchcore-g0 SC_G0_OUT="$GO_OUT" go test -run TestG0Baseline -count=1 . > /dev/null 2>&1 ) || { echo "go probe FAILED"; exit 1; }
head -c 200 "$GO_OUT"; echo " ..."

echo "[4/6] 运行 TS 侧探针"
( cd "$TS_DIR" && node --expose-gc scripts/g0-baseline-ts.mjs > "$TS_OUT" ) || { echo "ts probe FAILED"; exit 1; }
head -c 200 "$TS_OUT"; echo " ..."

echo "[5/6] TS 侧同输入复测一次 (方差入档)"
( cd "$TS_DIR" && node --expose-gc scripts/g0-baseline-ts.mjs > /tmp/g0-ts-run2.json ) || true

echo "[6/6] 合并写入 $OUT"
node -e '
const fs = require("fs");
const go = JSON.parse(fs.readFileSync("/tmp/g0-go.json", "utf8"));
const ts = JSON.parse(fs.readFileSync("/tmp/g0-ts.json", "utf8"));
const ts2 = JSON.parse(fs.readFileSync("/tmp/g0-ts-run2.json", "utf8"));
const doc = {
  task: "issue #3 评论 G0 — Go 基线 (Go-first 技术裁决前置测量)",
  discipline: [
    "本地合成输入的资源/延迟基线, 不冒充公网 SERP 质量或真实推理开销",
    "Go/TS 同输入文件、同机、相邻时间运行; 进程指标不混用 (各自子进程口径)",
    "未测项在 notMeasured 如实列出, 不以 fixture 冒充公网通过",
  ],
  environment: {
    goVersion: go.goVer, nodeVersion: ts.node, numCPU: go.numCPU,
    os: require("os").type() + " " + require("os").release(),
    note: "容器环境; 与用户本机 (Windows/Node26) 数值不可直接比较, 只做本环境内 Go/TS 对照",
  },
  go, ts, tsRun2: ts2,
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(process.argv[1], JSON.stringify(doc, null, 2));
console.log("written:", process.argv[1]);
' "$OUT"
echo "DONE"
