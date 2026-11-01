#!/usr/bin/env bash
# 构建脚本：缺依赖时自动安装，然后 tsc 编译 src → dist（同根包 scripts/build.sh 约定；
# kokoa bootstrap 5.5 对 vendor 钉扎检出的适配包直接 npm run build，无手工装依赖机会）。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [ ! -x node_modules/.bin/tsc ]; then
  npm install --no-audit --no-fund --loglevel=error
fi
exec node_modules/.bin/tsc -p tsconfig.json "$@"
