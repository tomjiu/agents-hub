#!/usr/bin/env bash
# vendor/memory-net 完整性校验：按 .vendor-lock 钉 sha 重新拉源码 → 构建 → 与 vendor 产物 diff
# + .vendor-hashes 哈希基线逐文件比对（P3-14：重拉可复现、单文件漂移即红灯）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCK="$ROOT/vendor/memory-net/.vendor-lock"
HASHES="$ROOT/vendor/memory-net/.vendor-hashes"
[ -f "$LOCK" ] || { echo "[vendor-verify] 缺 $LOCK"; exit 1; }
[ -f "$HASHES" ] || { echo "[vendor-verify] 缺 $HASHES（先跑 scripts/fetch-vendor.sh 生成哈希基线）"; exit 1; }
SHA="$(sed -n 's/^sha=//p' "$LOCK")"
REPO="$(sed -n 's/^repo=//p' "$LOCK")"
[ -n "$SHA" ] && [ -n "$REPO" ] || { echo "[vendor-verify] .vendor-lock 缺 sha/repo"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[vendor-verify] 拉取 $REPO@$SHA ..."
if ! curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$SHA" | tar -xz -C "$TMP/src" --strip-components=1 2>/dev/null; then
  echo "[vendor-verify] codeload 截断/不可达，回退 git clone ..."
  git clone --quiet "https://github.com/$REPO.git" "$TMP/clone"
  git -C "$TMP/clone" checkout --quiet "$SHA"
  rm -rf "$TMP/src"
  mv "$TMP/clone" "$TMP/src"
fi

cd "$TMP/src"
echo "[vendor-verify] npm install + tsc 构建 ..."
npm install --no-audit --no-fund >/dev/null 2>&1
npx tsc -p tsconfig.json --declaration --declarationMap false
rm -rf dist/tests   # 与 fetch-vendor.sh 对齐：测试编译物不入库

echo "[vendor-verify] diff 构建产物 vs vendor/ ..."
if diff -r "$TMP/src/dist" "$ROOT/vendor/memory-net/dist" >/tmp/vendor-diff.txt 2>&1; then
  echo "[vendor-verify] dist 一致 ✓"
else
  echo "[vendor-verify] dist 与钉 sha 构建产物不一致："
  head -40 /tmp/vendor-diff.txt
  exit 1
fi

echo "[vendor-verify] 哈希基线比对（.vendor-hashes）..."
cd "$ROOT/vendor/memory-net"
if sha256sum -c .vendor-hashes --quiet 2>/tmp/vendor-hash-err.txt; then
  echo "[vendor-verify] 哈希基线一致 ✓（$(wc -l < .vendor-hashes) 个文件）"
else
  echo "[vendor-verify] 哈希基线漂移："
  head -40 /tmp/vendor-hash-err.txt
  exit 1
fi

# package.json 溯源一致性（name/main/files 影响解析路径）
diff <(node -e "const p=require('$TMP/src/package.json'); delete p.version; console.log(JSON.stringify(p,null,2))") \
     <(node -e "const p=require('$ROOT/vendor/memory-net/package.json'); delete p.version; console.log(JSON.stringify(p,null,2))") \
  && echo "[vendor-verify] package.json 一致 ✓" \
  || { echo "[vendor-verify] package.json 漂移"; exit 1; }
echo "[vendor-verify] vendor 完整性通过（memory-net@$SHA）"
