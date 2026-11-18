# tavily-hikari — ENABLED

Tavily key-pool proxy (MCP + HTTP + CLI).

- MCP URL: `https://tavily.ivanli.cc/mcp`
- Auth: **Bearer token in OpenCode headers** (not OAuth)
- Codex: `bearer_token_env_var = TAVILY_HIKARI_TOKEN`
- OpenCode: `oauth: false` + `Authorization: Bearer <th-...>` in opencode.json
- Do **not** run `opencode mcp auth tavily-hikari` (that is OAuth flow; Hikari uses access token)

Token form: `th-<id>-<secret>` from Hikari console.
