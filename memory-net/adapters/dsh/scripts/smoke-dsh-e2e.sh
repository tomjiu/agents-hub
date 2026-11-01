#!/usr/bin/env bash
# memory-net dsh 适配包——真实 dsh headless 端到端冒烟（不进 npm test / CI：依赖 npx 下载真实 dsh）。
#
# 链路：mock 模型(:8401) + 钉扎 dsh --profile headless + memory-net-dsh-adapter + mn-e2e-echo-tool
#       （均 symlink 进 profile node_modules，cordis.patch 形态 insert 注册）。
# 验证五件事：
#   A. 插件真实加载——boot 不因插件崩溃；memory_net_* 与 mn_e2e_echo 出现在模型请求 tools 列表
#   B. systemPrompt 区段真实注入——宿主预置约束/进度进 system prompt；工具写后重组装含新推断
#   C. 模型工具调用闭环——模型发起 mn_e2e_echo + memory_net_write → dsh 执行 → canonical 结果回给模型
#   D. SQLite 落盘——模型写入的 inference 真实持久化在 workspace memory.db
#   E. auto-observe——宿主工具 mn_e2e_echo 的执行结果经 ctx.on('tools/result') 自动写为观测
#      （key=tool:mn_e2e_echo）；且 memory_net_* 未被递归观测（自指过滤真实生效）
#
# 用法：bash adapters/dsh/scripts/smoke-dsh-e2e.sh
# 可覆盖：DSH_VERSION（默认 0.1.2-rc.1）、PORT_MOCK（默认 8401）
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."   # → adapters/dsh

DSH_VERSION="${DSH_VERSION:-0.1.2-rc.1}"
PORT_MOCK="${PORT_MOCK:-8401}"
MN_ROOT="$(cd ../.. && pwd)"
WORK="$(mktemp -d /tmp/mn-dsh-e2e.XXXXXX)"
export DSH_HOME="$WORK/dsh-home"
export KOKOA_STATE_DIR="$WORK/state"

cleanup() {
  [ -n "${MOCK_PID:-}" ] && kill "$MOCK_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "[smoke] 1/6 构建（根 + 适配包）"
npm --prefix "$MN_ROOT" run -s build
npm run -s build

echo "[smoke] 2/6 预置 workspace（host 写约束 + 进度，验证区段注入面）"
WS="$KOKOA_STATE_DIR/memory-net/main"
node "$MN_ROOT/bin/mn.js" init "$WS" >/dev/null
node "$MN_ROOT/bin/mn.js" add "$WS" constraint --key no-force-push --text '永不 force push main' --payload '{"mode":"forbid"}' >/dev/null
node "$MN_ROOT/bin/mn.js" progress "$WS" --task e2e --status doing --summary '登录页 60%' --agent alice >/dev/null

echo "[smoke] 3/6 起 mock 模型 + symlink 适配包进 headless profile node_modules"
node tests/fixtures/mock-model.mjs "$PORT_MOCK" "$WORK/requests.jsonl" > "$WORK/mock.log" 2>&1 &
MOCK_PID=$!
sleep 0.8

PROFILE_DIR="$DSH_HOME/profiles/headless"
mkdir -p "$PROFILE_DIR/node_modules"
ln -sfn "$(pwd)" "$PROFILE_DIR/node_modules/memory-net-dsh-adapter"
ln -sfn "$(pwd)/tests/fixtures/echo-tool" "$PROFILE_DIR/node_modules/mn-e2e-echo-tool"

echo "[smoke] 4/6 写 patch（模型路由 → mock + 插件 insert）"
cat > "$WORK/all-patch.yaml" <<YAML
- id: llm-pi-ai
  config:
    providers:
      mock:
        displayName: mn-e2e-mock
        apiKeyEnv: MN_E2E_MODEL_KEY
        api: openai-completions
        baseURL: "http://127.0.0.1:${PORT_MOCK}/v1"
        models:
          - id: deepseek-v4-flash
            name: Mock Flash
            contextWindow: 131072
            maxTokens: 8192
- id: agent-default-model
  config:
    provider: mock
    model: deepseek-v4-flash
- insert:
    - id: kokoa-memory-net
      name: memory-net-dsh-adapter
      config:
        enabled: true
        workspaces_root: "${KOKOA_STATE_DIR}/memory-net"
        default_workspace: main
        agent_id: dsh-e2e
        budgets:
          max_nodes: 24
          max_tokens: 2048
        inject:
          section_order: 90
        tools:
          recall: true
          write: true
    - id: mn-e2e-echo
      name: mn-e2e-echo-tool
      config: {}
YAML

echo "[smoke] 5/6 运行真实 dsh headless（npx 钉扎 @$DSH_VERSION）"
export MN_E2E_MODEL_KEY="mn-e2e-key"   # llm-pi-ai provider 的 apiKeyEnv 指向它
set +e
npx -y "@deepseek-ai/dsh@$DSH_VERSION" --profile headless --patch "$WORK/all-patch.yaml" \
  "先调用 mn_e2e_echo 工具（say=hello auto-observe），再调用 memory_net_write 工具写一条推断（confidence 0.7），然后结束" \
  > "$WORK/dsh.out" 2> "$WORK/dsh.err"
DSH_RC=$?
set -e
echo "[smoke]    dsh exit=$DSH_RC（stdout 尾部：$(tail -c 200 "$WORK/dsh.out" | tr '\n' ' ')）"
if [ $DSH_RC -ne 0 ]; then
  echo "[smoke] FAIL: dsh 非零退出——stderr 尾部："; tail -40 "$WORK/dsh.err"; exit 1
fi

echo "[smoke] 6/6 断言（工具注册 / 区段注入 / 闭环 / 落盘 / auto-observe）"
node tests/fixtures/verify-e2e.mjs "$WORK/requests.jsonl" "$WS/memory.db" "$WORK/dsh.out"
echo "[smoke] PASS：真实 dsh@$DSH_VERSION × memory-net-dsh-adapter 端到端闭环（含 auto-observe）"
