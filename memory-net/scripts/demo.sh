#!/usr/bin/env bash
# memory-net 三条演示命令：双 agent 共享 progress / trail / activate。
# 用法: npm run demo   或   bash scripts/demo.sh
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MN="node $DIR/bin/mn.js"
WS="$(mktemp -d /tmp/memory-net-demo-XXXXXX)"
echo "== 演示 workspace: $WS =="

# ── ① 初始化共享 workspace（alice / bob 都挂载它）──
$MN init "$WS" --workspace-id demo

# ── ② agent alice 写 progress + trail（同 run 协作序列）──
$MN progress "$WS" --task build-login --agent alice --status doing \
  --summary "登录页完成 60%，卡在 OAuth 回调" 
$MN trail "$WS" --run r1 --agent alice --action "完成登录页表单 60%"
$MN trail "$WS" --run r1 --agent alice --action "发现 OAuth 回调阻塞，等待修复"

# ── ③ agent bob activate：读到 alice 的进度与步骤，接手继续 ──
echo ""
echo "== bob 激活结果（constraint 置顶 + alice 的 progress + trail 摘要）=="
$MN activate "$WS" --query "登录 OAuth 进度" --agent bob --run r1

echo ""
$MN trail "$WS" --run r1 --agent bob --action "bob 接手：回调超时重试已加"
echo ""
echo "== 共享 trail 回放（alice + bob 同一序列）=="
$MN replay "$WS" --run r1

echo ""
echo "✓ 演示完成：同目标多 Agent 分工 —— progress 单行共享、trail 有序共享、activate 预算化注入"
rm -rf "$WS"
