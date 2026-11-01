#!/usr/bin/env bash
# 环境重建:重新下载闭源 installer (后台执行)
set -uo pipefail
ROOT="/home/z/my-project/search-tool-rnd"
cd "$ROOT"
mkdir -p raw-downloads

dl() {
  local name=$1; local url=$2
  local out_dir="raw-downloads/$name"
  mkdir -p "$out_dir"
  local out="$out_dir/$(basename "$url")"
  if [ -f "$out" ] && [ -s "$out" ]; then
    echo "[$name] exists, skip"
  fi
  echo "[$(date +%T)] [$name] start"
  curl -sSL -C - --retry 5 --retry-delay 5 -o "$out" "$url" && \
    echo "[$(date +%T)] [$name] OK $(du -h "$out" | awk '{print $1}')" || \
    echo "[$(date +%T)] [$name] FAILED"
}

dl trae-work-cn "https://lf-cdn.trae.com.cn/obj/trae-com-cn/pkg/app/releases/stable/2.3.79533/win32/TraeWork_CN-Setup-x64.exe" &
dl trae-code-cn "https://lf-cdn.trae.com.cn/obj/trae-com-cn/pkg/app/releases/stable/2.3.78542/win32/TraeCode_CN-Setup-x64.exe" &
dl workbuddy    "https://codebuddy-1328495429.cos.accelerate.myqcloud.com/workbuddy/saas/win32-x64-user/WorkBuddy-win32-x64-user-5.4.2.36857725-d74591c4.exe" &
dl claude-code  "https://downloads.claude.ai/releases/win32/x64/1.40609.1/ClaudeSetup-69aac03faa72b798ca63e9eb96057c1b2ade979e.exe" &
wait
echo "ALL DONE $(date +%T)"
