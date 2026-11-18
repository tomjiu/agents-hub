# Local pre-staged mirrors (offline-first)

These are **already cloned** so agents do not wait on network when choosing MCP/skills/tools.
Prefer local path first, then online URL for updates.

## MCP ecosystem

Root: `E:\Code\skills\sources\mcp-ecosystem\`

| Dir | Upstream |
|-----|----------|
| `mcp-servers-official` | https://github.com/modelcontextprotocol/servers |
| `mcp-registry` | https://github.com/modelcontextprotocol/registry |
| `mcp-specification` | https://github.com/modelcontextprotocol/specification |
| `awesome-mcp-servers-punkpeye` | https://github.com/punkpeye/awesome-mcp-servers |
| `awesome-mcp-servers-appcypher` | https://github.com/appcypher/awesome-mcp-servers |
| `awesome-mcp-servers-tensorblock` | https://github.com/TensorBlock/awesome-mcp-servers |
| `github-mcp-server` | https://github.com/github/github-mcp-server |
| `playwright-mcp` | https://github.com/microsoft/playwright-mcp |
| `context7` | https://github.com/upstash/context7 |
| `agentskills-spec` | https://github.com/agentskills/agentskills |
| `awesome-agent-skills-voltagent` | https://github.com/VoltAgent/awesome-agent-skills |
| `openai-plugins` | https://github.com/openai/plugins |
| `ghidra-mcp-bethington` | https://github.com/bethington/ghidra-mcp |
| `ghidra-headless-mcp` | https://github.com/mrphrazer/ghidra-headless-mcp |
| `chrome-devtools-mcp` | https://github.com/ChromeDevTools/chrome-devtools-mcp |
| `frida-mcp-dnakov` | https://github.com/dnakov/frida-mcp |
| `frida-mcp-kahlo` | https://github.com/FuzzySecurity/kahlo-mcp |

> Ghidra / Frida / Chrome DevTools MCP: **pre-cloned only, not enabled by default.** See `catalog/mcp.draft.toml`.  
> radare2: use system `r2pm -r r2mcp` when r2 installed (no full mirror required).

## Skill packs

Root: `E:\Code\skills\sources\packs\`

| Dir | Notes |
|-----|--------|
| `tavily-hikari` | MCP+HTTP+CLI search pool skills |
| `addy-agent-skills` | engineering lifecycle |
| `reverse-skills-p4nda0s` | RE skills (on-demand) |
| `android-re-skill-codex` | Android RE |
| `modelscope-skills` | ModelScope |
| `godot-skill-haxqer` | Codex-oriented Godot (haxqer/godot-skill) |
| `godot-prompter` | GodotPrompter multi-skill pack |
| `agent-skill-godot` | fernforestgames agent-skill-godot |

## RE / security awesome lists

Root: `E:\Code\skills\sources\re-security-mirrors\`

| Dir | Upstream |
|-----|----------|
| `awesome-reversing` | tylerha97/awesome-reversing |
| `awesome-malware-analysis` | rshipp/awesome-malware-analysis |
| `awesome-pentest` | enaqx/awesome-pentest |
| `awesome-frida` | dweinstein/awesome-frida |
| `awesome-mobile-security` | vaib25vicky/awesome-mobile-security |
| `awesome-ctf` | apsdehal/awesome-ctf |

## Runtime MCP (already configured, not “download later”)

| Name | Endpoint / notes |
|------|------------------|
| Tavily Hikari | `https://tavily.ivanli.cc/mcp` + `TAVILY_HIKARI_TOKEN` |
| Keenable | `https://api.keenable.ai/mcp` |
| Playwright / Firefox / GitHub | local npx or plugin |
| Exa | API key in env (`EXA_API_KEY`), not MCP |

## Update mirrors

```powershell
Get-ChildItem E:\Code\skills\sources\mcp-ecosystem -Directory | ForEach-Object {
  git -C $_.FullName pull --ff-only --depth 1
}
```

## Agent rule

When installing or recommending an MCP:

1. Check `LOCAL_MIRRORS.md` / this tree
2. Read local README / awesome list
3. Only then `npx`/`docker` install the chosen server
