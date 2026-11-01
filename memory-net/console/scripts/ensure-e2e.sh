#!/usr/bin/env bash
# e2e 冒烟 server 幂等 ensure：端口活着就复用，否则重启（沙箱会回收跨调用后台进程）。
set -euo pipefail
PORT=8792
HOME_DIR=/tmp/mnc-e2e
TOKEN=e2e-token-abc
STATIC=/home/z/my-project/repos/memory-net-console/apps/console/dist
BIN=/home/z/my-project/repos/memory-net-console/packages/server/bin/console.js

if curl -sf -o /dev/null "http://127.0.0.1:${PORT}/v1/health"; then
  echo "[ensure] console already up on :${PORT}"
else
  echo "[ensure] starting console on :${PORT} ..."
  CONSOLE_HOST=127.0.0.1 CONSOLE_PORT=${PORT} CONSOLE_HOME=${HOME_DIR} \
    CONSOLE_TOKEN=${TOKEN} CONSOLE_STATIC=${STATIC} \
    nohup node ${BIN} > /tmp/mnc-e2e.log 2>&1 &
  for i in $(seq 1 20); do
    if curl -sf -o /dev/null "http://127.0.0.1:${PORT}/v1/health"; then
      echo "[ensure] console ready"
      exit 0
    fi
    sleep 0.3
  done
  echo "[ensure] console failed to start"; tail -5 /tmp/mnc-e2e.log; exit 1
fi
