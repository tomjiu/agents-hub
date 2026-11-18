# Z.ai MCP

Source: [../../local/zai-bridge](../../local/zai-bridge/README.md), repaired version **0.3.1**. DSH stdio server, not a native UI plugin.

- Local collection source: `E:/Code/skills/mcp/local/zai-bridge`
- Existing DSH global runtime currently uses the original built executable; copying here does not change a running MCP connection.
- Runtime credentials: private `~/.zai-bridge/accounts.json`, never copied into this repository.
- DSH tools: `mcp__zai__...` (19 single-token tools, 20 configured-account tools).
- Offline tests cover signature, quota, multi-account routing, FIFO, cancellation and file/resource bounds. No new live sending or SDK tests for this copy.
- Full [DSH setup](../../local/zai-bridge/DSH-MCP.md), [copy provenance](../../local/zai-bridge/COPY-NOTES.md), [license notices](../../local/zai-bridge/THIRD-PARTY-NOTICES.md).

Do not send test messages without the user's permission. Quota unknown/exhausted fails closed. IM chats are retained.
