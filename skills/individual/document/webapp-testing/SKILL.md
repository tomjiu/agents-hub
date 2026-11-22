---
name: webapp-testing
description: Toolkit for interacting with and testing local web applications using Playwright. Supports verifying frontend functionality, debugging UI behavior, capturing browser screenshots, and viewing browser logs.
license: Complete terms in LICENSE.txt
---

# Web Application Testing

To test local web applications, write native Python Playwright scripts.

**Helper Scripts Available**:
- `scripts/with_server.py` - Manages server lifecycle (supports multiple servers)

**Always run scripts with `--help` first** to see usage. DO NOT read the source until you try running the script first and find that a customized solution is abslutely necessary. These scripts can be very large and thus pollute your context window. They exist to be called directly as black-box scripts rather than ingested into your context window.

## Decision Tree: Choosing Your Approach

```
User task → Is it static HTML?
    ├─ Yes → Read HTML file directly to identify selectors
    │         ├─ Success → Write Playwright script using selectors
    │         └─ Fails/Incomplete → Treat as dynamic (below)
    │
    └─ No (dynamic webapp) → Is the server already running?
        ├─ No → Run: python scripts/with_server.py --help
        │        Then use the helper + write simplified Playwright script
        │
        └─ Yes → Reconnaissance-then-action:
            1. Navigate and wait for a task-specific ready selector/response
            2. Take screenshot or inspect DOM
            3. Identify selectors from rendered state
            4. Execute actions with discovered selectors
```

## Example: Using with_server.py

Run `--help` first. The helper refuses every preoccupied port before spawning; it never adopts or kills an existing listener. Readiness means TCP reachability plus process survival, not authenticated ownership or application health. Verify the expected page/API in automation before clicking.

Prefer --server-argv with a JSON string array (no shell). Legacy --server accepts trusted shell commands like cd backend && npm run dev; never interpolate untrusted input. --cwd applies to all server and test processes. Commands below assume this Skill directory; from the repository root use the full canonical script path.

~~~sh
python scripts/with_server.py --server-argv '["python", "server.py"]' --port 5173 --timeout 30 --command-timeout 120 -- python your_automation.py
~~~

All ports must be unique IPv4 loopback ports. Startup failure, service death, test failure, timeout and interruption clean up owned server/test process trees. Windows uses kill-on-close Job Objects assigned while suspended; POSIX uses process groups. Daemonized/detached services are not supported. Output inherits the caller, which must drain or redirect its own pipes. Startup timeout defaults to 30s per server; command timeout defaults to 300s and returns 124. Normal test failure preserves its exit code.

An existing server is tested directly after identity review, not managed by this helper. The helper needs only Python standard library; actual browser automation still needs installed Playwright/browser. No dependencies or services are installed automatically.

Legacy trusted-shell examples:

**Single server:**
```bash
python scripts/with_server.py --server "npm run dev" --port 5173 -- python your_automation.py
```

**Multiple servers (e.g., backend + frontend):**
```bash
python scripts/with_server.py \
  --server "cd backend && python server.py" --port 3000 \
  --server "cd frontend && npm run dev" --port 5173 \
  -- python your_automation.py
```

To create an automation script, include only Playwright logic (servers are managed automatically):
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True) # Always launch chromium in headless mode
    page = browser.new_page()
    page.goto('http://localhost:5173') # Server already running and ready
    page.wait_for_load_state('domcontentloaded')
    # Then await a task-specific visible UI or API state; long-polling apps may never be idle.
    # ... your automation logic
    browser.close()
```

## Reconnaissance-Then-Action Pattern

1. **Inspect rendered DOM**:
   ```python
   page.screenshot(path='/tmp/inspect.png', full_page=True)
   content = page.content()
   page.locator('button').all()
   ```

2. **Identify selectors** from inspection results

3. **Execute actions** using discovered selectors

## Common Pitfall

❌ Do not treat a listening TCP port or an elapsed sleep as application readiness.
✅ Use a bounded task-specific selector, response or state before inspection. Network-idle is only appropriate for apps that actually become idle.

## Best Practices

- **Use bundled scripts as black boxes** - To accomplish a task, consider whether one of the scripts available in `scripts/` can help. These scripts handle common, complex workflows reliably without cluttering the context window. Use `--help` to see usage, then invoke directly. 
- Use `sync_playwright()` for synchronous scripts
- Always close the browser when done
- Use descriptive selectors: `text=`, `role=`, CSS selectors, or IDs
- Use bounded observable waits such as `page.wait_for_selector()` or expected API/UI state; fixed sleeps are not readiness evidence.

## Reference Files

- **examples/** - Examples showing common patterns:
  - `element_discovery.py` - Discovering buttons, links, and inputs on a page
  - `static_html_automation.py` - Using file:// URLs for local HTML
  - `console_logging.py` - Capturing console logs during automation