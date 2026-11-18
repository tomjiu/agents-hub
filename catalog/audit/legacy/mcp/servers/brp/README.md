# brp — ENABLED (local)

Browser Runtime Protocol — control real Firefox/Zen via Bridge + extension.

## Paths
- Repo: `E:\Code\ai\brp-mvp`
- Adapter: `E:\Code\ai\brp-mvp\adapter\brp_mcp_adapter.py`
- Bridge: `E:\Code\ai\brp-mvp\bridge\target\release\brp-bridge.exe`
- Native messaging: installed via `install.ps1` (Firefox + Zen)

## MCP command
```
C:\Users\yezi6\AppData\Local\Programs\Python\Python313\python.exe -X utf8 E:\Code\ai\brp-mvp\adapter\brp_mcp_adapter.py
```
Env: `BRP_WS_ADDR=127.0.0.1:9817`

## Prerequisites
1. Firefox extension BRP installed (AMO or .xpi)
2. Bridge binary built; `install.ps1` already run
3. Open Firefox with extension enabled (adapter can auto-discover/spawn bridge)

## Clients
- OpenCode + Codex configured to use this adapter
