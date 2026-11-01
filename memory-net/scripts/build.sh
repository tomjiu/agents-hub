#!/usr/bin/env bash
# 构建脚本：缺依赖时自动安装，然后 tsc 编译 src → dist（或 --noEmit 仅类型检查）。
# 与 kokoa 仓 message-gateway / dsh-plugin-memory 同一约定（ADR-012：运行时入口全部
# 指向 dist/；dist 不入库 → 全新 clone（如 kokoa bootstrap 步骤 5.5 的 vendor 钉扎
# 检出）必须能零手工自装 devDeps 构建——裸 tsc 在无 node_modules 时 command not found）。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [ ! -x node_modules/.bin/tsc ]; then
  npm install --no-audit --no-fund --loglevel=error
fi
exec node_modules/.bin/tsc -p tsconfig.json "$@"
