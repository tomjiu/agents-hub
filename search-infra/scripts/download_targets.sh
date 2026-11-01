#!/usr/bin/env bash
# 下载所有目标 installer / 源码到本地
# 用法: bash scripts/download_targets.sh
#
# 输出:
#   raw-downloads/<target>/         闭源 installer
#   analysis/<target>/source/       开源源码(git clone)

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p raw-downloads
mkdir -p analysis

dl() {
  local name=$1
  local url=$2
  local out_dir="raw-downloads/$name"
  mkdir -p "$out_dir"
  echo "[$name] downloading from $url ..."
  # 跟随重定向、断点续传、失败重试 3 次
  curl -L -C - --retry 3 --retry-delay 5 -o "$out_dir/$(basename "$url")" "$url"
  echo "[$name] done. sha256: $(sha256sum "$out_dir/$(basename "$url")" | awk '{print $1}')"
}

clone() {
  local name=$1
  local url=$2
  local target="analysis/$name/source"
  if [ -d "$target/.git" ]; then
    echo "[$name] already cloned, pulling..."
    git -C "$target" pull --rebase --quiet || true
  else
    mkdir -p "analysis/$name"
    git clone --depth 1 "$url" "$target"
  fi
}

echo "=== Phase A.1: 下载闭源 installer ==="

# 这些是 win32 .exe,体积大但必须下
dl trae-work-cn "https://lf-cdn.trae.com.cn/obj/trae-com-cn/pkg/app/releases/stable/2.3.79533/win32/TraeWork_CN-Setup-x64.exe"
dl trae-code-cn "https://lf-cdn.trae.com.cn/obj/trae-com-cn/pkg/app/releases/stable/2.3.78542/win32/TraeCode_CN-Setup-x64.exe"
dl qoder-cn    "https://qoder-app.oss-cn-beijing.aliyuncs.com/qoder-app/releases/latest/Qoder-CN-linux-amd64.deb"
dl workbuddy   "https://codebuddy-1328495429.cos.accelerate.myqcloud.com/workbuddy/saas/win32-x64-user/WorkBuddy-win32-x64-user-5.4.2.36857725-d74591c4.exe"
dl claude-code "https://downloads.claude.ai/releases/win32/x64/1.40609.1/ClaudeSetup-69aac03faa72b798ca63e9eb96057c1b2ade979e.exe"
dl antigravity "https://storage.googleapis.com/antigravity-public/antigravity-hub/2.11.0-6376446768316416/linux-x64/Antigravity.tar.gz"
dl teleagent   "https://cdn01.teleai.com.cn/packages/2.4.1/TeleAgent-2.4.1-arm64.deb"

# Grok CLI install.ps1 (小文件)
dl grok-cli-ps1 "https://x.ai/cli/install.ps1"

echo ""
echo "=== Phase A.2: clone 开源源码 ==="

clone grok-build         "https://github.com/xai-org/grok-build.git"
clone codex              "https://github.com/openai/codex.git"
clone pi-search-boost    "https://github.com/Mr-remon219/pi-search-boost.git"
clone dsh-search-boost   "https://github.com/Mr-remon219/dsh-search-boost.git"
clone open-deep-research "https://github.com/langchain-ai/open_deep_research.git"
clone perplexica         "https://github.com/ItzCrazyKns/Perplexica.git"
clone open-grok          "https://github.com/mweinbach/open-grok.git"

echo ""
echo "=== done. local artifacts at: ==="
echo "  raw-downloads/  ($(du -sh raw-downloads 2>/dev/null | awk '{print $1}'))"
echo "  analysis/       ($(du -sh analysis 2>/dev/null | awk '{print $1}'))"
