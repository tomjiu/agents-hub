---
name: web-search-hikari
description: Use when the agent needs web search, extract, crawl, map, or research via Tavily Hikari pool (tvly-hikari CLI or tavily_hikari MCP). Prefer this over inventing search APIs.
---

# Web Search (Tavily Hikari)

## What it is

**Tavily Hikari is both MCP and HTTP/CLI**, not CLI-only:

| Mode | Endpoint / command |
|------|---------------------|
| MCP | `https://tavily.ivanli.cc/mcp` + Bearer `TAVILY_HIKARI_TOKEN` |
| HTTP | `https://tavily.ivanli.cc/api/tavily/...` |
| CLI | `tvly-hikari search|extract|crawl|map|research ... --json` |

Token form: `th-<id>-<secret>` (Hikari access token, **not** raw Tavily key).

## Local config

- Env: `TAVILY_HIKARI_TOKEN`
- Codex: `[mcp_servers.tavily_hikari]` remote MCP
- OpenCode: `mcp.tavily-hikari` remote
- Detailed skills (optional): `tavily-hikari-search`, `tavily-hikari-extract`, `tavily-hikari-research`, `tavily-hikari-cli`, `tavily-hikari-best-practices`

## Prefer order

1. Use **MCP tools** from `tavily_hikari` if available in the session.
2. Else shell: `tvly-hikari search "..." --json` (if installed).
3. Else HTTP POST to `/api/tavily/search` with Bearer token.

## Do not

- Put official Tavily keys into clients; always use Hikari token.
- Use browser MCP for simple web search when Hikari works.
