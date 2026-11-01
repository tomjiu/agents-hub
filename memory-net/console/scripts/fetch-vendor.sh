#!/usr/bin/env bash
# vendor/memory-net 拉取脚本：从 GitHub 钉扎 sha 拉源码 → 构建 → 落 vendor 产物。
# 升级流程：改 MN_SHA → 跑本脚本 → 全仓测试 → review vendor diff → commit。
# 产物入库（dist 为零运行时依赖自包含 JS），部署机无需构建链。
#
# P3-14 加固：
# - codeload 截断（tar unexpected EOF）自动回退 git clone（与 verify-vendor.sh 对齐）
# - 产物哈希基线 .vendor-hashes（sha256）：verify-vendor.sh 复核可复现性
# - dist/tests 不入库（上游测试编译物，node:test 引用属无害膨胀，剔除）
set -euo pipefail

MN_SHA="e3dda9d56fac3598452ed0902898d693c4a6e5f2"   # memory-net main 钉扎（=kokoa pins.yaml 对齐）
MN_REPO="tomjiu/memory-net"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch_source() {
  local dest="$1"
  if curl -fsSL "https://codeload.github.com/$MN_REPO/tar.gz/$MN_SHA" | tar -xz -C "$dest" --strip-components=1 2>/dev/null; then
    return 0
  fi
  echo "[vendor] codeload 截断/不可达，回退 git clone ..."
  git clone --quiet "https://github.com/$MN_REPO.git" "$TMP/clone"
  git -C "$TMP/clone" checkout --quiet "$MN_SHA"
  rm -rf "$dest"
  mv "$TMP/clone" "$dest"
}

echo "[vendor] 拉取 $MN_REPO@$MN_SHA ..."
fetch_source "$TMP/src"

cd "$TMP/src"
echo "[vendor] npm install（devDeps，构建链）..."
npm install --no-audit --no-fund
echo "[vendor] tsc 构建（含 declaration）..."
npx tsc -p tsconfig.json --declaration --declarationMap false

DEST="$ROOT/vendor/memory-net"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -r dist "$DEST/dist"
rm -rf "$DEST/dist/tests"   # 上游测试编译物不入库（node:test 引用膨胀）
cp package.json LICENSE README.md "$DEST/"

# 锁定记录：产物来源可追溯
printf '%s\n' "repo=$MN_REPO" "sha=$MN_SHA" "fetched_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DEST/.vendor-lock"

# 哈希基线：重拉可复现 diff 基线（verify-vendor.sh 逐文件比对）
cd "$DEST"
find dist -type f -print0 | sort -z | xargs -0 sha256sum > .vendor-hashes

echo "[vendor] 已落 $DEST（memory-net@$MN_SHA，$(wc -l < .vendor-hashes) 个产物文件入哈希基线）"
