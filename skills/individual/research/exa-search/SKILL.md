---
name: exa-search
description: Use when doing AI-native web search or finding similar pages via Exa API (EXA_API_KEY). Prefer for research/code-oriented retrieval; use Tavily Hikari or Keenable for general agent search MCP.
---

# Exa Search

## Auth

Env: `EXA_API_KEY` (local user env + Codex shell_environment_policy).

Docs: https://docs.exa.ai  
Site: https://exa.ai

## Usage

HTTP:

```bash
# PowerShell example
$headers = @{ "x-api-key" = $env:EXA_API_KEY; "Content-Type" = "application/json" }
$body = @{ query = "your query"; numResults = 5; type = "auto" } | ConvertTo-Json
Invoke-RestMethod -Uri https://api.exa.ai/search -Method Post -Headers $headers -Body $body
```

## Prefer order (local)

1. Keenable MCP / CLI (agent-oriented search + fetch)
2. Tavily Hikari MCP (pool, search/extract/crawl/research)
3. Exa API when you need Exa-style neural search / similar links

Do not hardcode keys in chat.