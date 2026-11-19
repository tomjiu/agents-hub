# DSH stdio MCP setup

This is a standalone MCP server, not a DSH UI plugin. Add a home-level DSH patch if the server should be available across profiles. Paths below are examples; edit them for your installation. **Do not put tokens into the patch.**

```yaml
- insert:
    - id: mcp-zai
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: zai
        transport: stdio
        command: /absolute/path/to/zai-bridge
        cwd: /absolute/path/to/zai-bridge-source
        env:
          ZAI_ACCOUNTS_FILE: /absolute/path/to/private/accounts.json
          ZAI_NODE: /absolute/path/to/node
          CAPTCHA_STALL_MS: "10000"
          NODE_OPTIONS: --max-old-space-size=256
        toolCallTimeoutMs: 900000
        failOnStartupError: true
```

Use `zai-bridge.exe` on Windows. Build the Go executable and prepare the sidecar with `cd captcha && npm ci && npm run build`. Read the [third-party notice](THIRD-PARTY-NOTICES.md). Account file format is shown in [accounts.example.json](accounts.example.json); real account credentials stay outside the source repository.

Tools appear under `mcp__zai__...`; `list_accounts` reads only local metadata. Other tools may request upstream APIs; sending/creating/deleting and `smoke.mjs --write` must be explicitly authorized.

For the recorded 0.3.1 build, DSH-installed MCP SDK verification found 20 tools in configured-account mode and 19 in single-token mode. This was handshake/discovery only, not proof that a token is valid online.

One running DSH host owns its own stdio server. Multiple DSH processes do not automatically share queue/quota/rate state.
