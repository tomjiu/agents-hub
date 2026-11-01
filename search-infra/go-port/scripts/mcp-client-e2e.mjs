#!/usr/bin/env node
// MCP stdio E2E client for the go-port search-core binary.
// Speaks line-delimited JSON-RPC 2.0 exactly like a real MCP host:
//   initialize -> notifications/initialized -> tools/list -> tools/call
// Usage: node mcp-client-e2e.mjs [path-to-binary]
import { spawn } from 'node:child_process';

const BIN = process.argv[2] || '/home/z/my-project/search-tool-rnd/go-port/search-core-go';
const p = spawn(BIN, ['serve'], { stdio: ['pipe', 'pipe', 'pipe'] });

let buf = '';
const pending = new Map();
const serverNotifications = [];
let nextId = 1;

p.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; } // non-protocol noise: skip
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const res = pending.get(msg.id);
      if (res) { pending.delete(msg.id); res(msg); }
    } else if (msg.method) {
      serverNotifications.push(msg.method); // e.g. notifications from server
    }
  }
});
p.stderr.on('data', (d) => process.stderr.write('[server-stderr] ' + d));

function request(method, params, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`timeout waiting for ${method} (#${id})`)); }, timeoutMs);
    pending.set(id, (msg) => { clearTimeout(t); resolve(msg); });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function notify(method, params) {
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}
const ms = (() => { const t0 = Date.now(); return () => Date.now() - t0; })();

function die(msg) { console.error('E2E FAIL:', msg); p.kill(); process.exit(1); }

// ---- 1. MCP handshake ----
const initRes = await request('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'superz-mcp-e2e', version: '1.0.0' },
});
if (initRes.error) die('initialize rejected: ' + JSON.stringify(initRes.error));
console.log(`[${ms()}ms] initialize OK  server=${JSON.stringify(initRes.result?.serverInfo)}  protocol=${initRes.result?.protocolVersion}`);
notify('notifications/initialized', {});

// ---- 2. tools/list ----
const listRes = await request('tools/list', {});
const tools = listRes.result?.tools || [];
console.log(`[${ms()}ms] tools/list OK  count=${tools.length}  names=${tools.map(t => t.name).join(', ')}`);
if (tools.length < 7) die(`expected >=7 tools, got ${tools.length}`);

function textOf(callRes) {
  if (callRes.error) return null;
  const c = callRes.result?.content || [];
  return c.filter(x => x.type === 'text').map(x => x.text).join('\n');
}

// ---- 3. tools/call #2: fetch (wikipedia, with focus passage extraction) ----
const t2 = Date.now();
const fetchRes = await request('tools/call', {
  name: 'fetch',
  arguments: { url: 'https://en.wikipedia.org/wiki/Go_(programming_language)', focus: 'concurrency goroutines', max_chars: 3000 },
}, 45000);
const fetchText = textOf(fetchRes);
if (fetchRes.error || fetchText === null) die('fetch failed: ' + JSON.stringify(fetchRes.error || callRes));
console.log(`[${ms()}ms] tools/call fetch OK  ${(Date.now() - t2)}ms  chars=${fetchText.length}  isError=${fetchRes.result?.isError ?? false}`);
console.log('  fetch excerpt: ' + fetchText.slice(0, 220).replace(/\n+/g, ' | '));

// ---- 4. tools/call #3: search_providers (lane health census) ----
const t3 = Date.now();
const provRes = await request('tools/call', { name: 'search_providers', arguments: {} }, 15000);
const provText = textOf(provRes);
if (provRes.error || provText === null) die('search_providers failed: ' + JSON.stringify(provRes.error));
let providers = {};
try { providers = JSON.parse(provText); } catch { providers = {}; }
const provArr = Array.isArray(providers) ? providers : (providers.enginesHealth || providers.providers || []);
const circuitOpen = provArr.filter(e => (e.lastStatus || '') === 'circuit_open').length;
console.log(`[${ms()}ms] tools/call search_providers OK  ${(Date.now() - t3)}ms  lanes=${provArr.length}  circuit_open=${circuitOpen}`);
console.log('  sample: ' + JSON.stringify(provArr.slice(0, 3)));

// ---- 5. tools/call flagship: search (full plan->fanout->fuse pipeline) ----
const t5 = Date.now();
const searchRes = await request('tools/call', {
  name: 'search',
  arguments: { query: 'go goroutine scheduler GMP model', top_n: 8 },
}, 45000);
const searchText = textOf(searchRes);
if (searchRes.error || searchText === null) die('search failed: ' + JSON.stringify(searchRes.error));
let searchOut = {};
try { searchOut = JSON.parse(searchText); } catch { die('search output not JSON'); }
const refs = searchOut.refs || [];
const uniqEngines = new Set(refs.flatMap(r => r.engines || []));
console.log(`[${ms()}ms] tools/call search OK  ${(Date.now() - t5)}ms  refs=${refs.length}  uniqEngines=${uniqEngines.size} (${[...uniqEngines].slice(0, 8).join(',')})`);
for (const r of refs.slice(0, 3)) console.log(`  - [${(r.engines || []).join(',')}] ${r.title}  ${r.url}`);

// ---- 6. tools/call cache_stats (counters snapshot) ----
const csRes = await request('tools/call', { name: 'cache_stats', arguments: {} }, 15000);
const csText = textOf(csRes);
if (csRes.error || csText === null) die('cache_stats failed: ' + JSON.stringify(csRes.error));
console.log(`[${ms()}ms] tools/call cache_stats OK  ${csText.slice(0, 160)}`);

const allOk = fetchText.length > 0 && provArr.length > 0 && refs.length > 0;
p.kill();
console.log(`\nE2E ${allOk ? 'PASS' : 'FAIL'}: MCP stdio handshake + 4 tool calls against go-port binary`);
process.exit(allOk ? 0 : 1);
