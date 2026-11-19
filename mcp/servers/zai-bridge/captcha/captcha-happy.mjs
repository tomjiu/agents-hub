import { GlobalWindow as Window, PropertySymbol } from "happy-dom";
import WindowBrowserContext from "happy-dom/lib/window/WindowBrowserContext.js";
import { ProxyAgent, setGlobalDispatcher, Agent as UndiciAgent, fetch as undiciFetch } from "undici";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
const SYNC_FETCH_BUF_BYTES = 8 * 1024 * 1024;
const SYNC_FETCH_HEADER_BYTES = 64;
const SYNC_FETCH_TIMEOUT_MS = Number(process.env.CAPTCHA_SYNC_FETCH_TIMEOUT_MS || 12e3);
let _syncFetchWorker = null;
const SYNC_WORKER_SRC = `
  const { parentPort } = require("node:worker_threads");
  const https = require("node:https");
  const http = require("node:http");
  const enc = new TextEncoder();
  // node:http(s) with Happy Eyeballs + manual redirect following (plain
  // fetch here wedges on IPv6-blackholed CDN answers \u2014 see the dispatcher
  // note in captcha-happy.ts; the eval worker must stay builtin-only).
  function requestOnce(url, init, timeoutMs) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const mod = u.protocol === "http:" ? http : https;
      const headers = Object.assign({}, init.headers || {});
      delete headers["accept-encoding"]; // no transparent decompression here
      const req = mod.request(u, {
        method: init.method || "GET",
        headers,
        autoSelectFamily: true,
        autoSelectFamilyAttemptTimeout: 300,
      }, resolve);
      // Idle-socket timer (resets on activity) + a TOTAL deadline: a
      // slow-drip response must not outlive the host's Atomics cap and
      // wedge the single-flight sync worker behind a zombie request.
      req.setTimeout(timeoutMs, () => req.destroy(new Error("socket idle timeout")));
      const total = setTimeout(() => req.destroy(new Error("headers timeout (total)")), timeoutMs);
      req.on("error", (err) => { clearTimeout(total); reject(err); });
      req.on("close", () => clearTimeout(total));
      if (init.body) req.end(Buffer.from(init.body));
      else req.end();
    });
  }
  async function robustFetch(url, init, timeoutMs) {
    let cur = url, method = init.method || "GET", body = init.body;
    for (let hop = 0; hop < 6; hop++) {
      const res = await requestOnce(cur, { method, headers: init.headers, body }, timeoutMs);
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        if (code === 301 || code === 302 || code === 303) { method = "GET"; body = undefined; }
        res.resume();
        cur = new URL(res.headers.location, cur).href;
        continue;
      }
      const chunks = [];
      for await (const c of res) chunks.push(c);
      return { res, body: Buffer.concat(chunks) };
    }
    throw new Error("too many redirects");
  }
  parentPort.on("message", (m) => {
    (async () => {
      const i32 = new Int32Array(m.sab);
      const u8 = new Uint8Array(m.sab);
      // Fixed-size header (bytes), NOT i32.length * 4 -- that is the whole SAB.
      const payloadAt = 64;
      const fail = (msg) => {
        const b = enc.encode(msg);
        u8.set(b, payloadAt);
        i32[5] = b.length; i32[1] = 0; i32[2] = 0; i32[3] = 0; i32[4] = 0;
        i32[0] = 2; Atomics.notify(i32, 0);
      };
      try {
        const { res, body } = await robustFetch(m.url, m.init, m.timeoutMs || 12000);
        const statusText = enc.encode(res.statusMessage || "");
        const headersJson = enc.encode(JSON.stringify(res.headers || {}));
        const setCookieJson = enc.encode(JSON.stringify(res.headers["set-cookie"] || []));
        let off = payloadAt;
        u8.set(statusText, off); i32[2] = statusText.length; off += statusText.length;
        u8.set(headersJson, off); i32[3] = headersJson.length; off += headersJson.length;
        u8.set(setCookieJson, off); i32[4] = setCookieJson.length; off += setCookieJson.length;
        u8.set(body, off); i32[5] = body.length;
        i32[1] = res.statusCode || 0;
        i32[0] = 1; Atomics.notify(i32, 0);
      } catch (err) {
        fail(String((err && err.message) || err));
      }
    })();
  });
`;
function ensureSyncFetchWorker() {
  if (_syncFetchWorker) return _syncFetchWorker;
  _syncFetchWorker = new Worker(SYNC_WORKER_SRC, { eval: true });
  return _syncFetchWorker;
}
function syncFetchBlocking(url, init, timeoutMs = SYNC_FETCH_TIMEOUT_MS) {
  try {
    const worker = ensureSyncFetchWorker();
    const sab = new SharedArrayBuffer(SYNC_FETCH_HEADER_BYTES + SYNC_FETCH_BUF_BYTES);
    const i32 = new Int32Array(sab);
    const u8 = new Uint8Array(sab);
    worker.postMessage({ sab, url, init, timeoutMs });
    const waitResult = Atomics.wait(i32, 0, 0, timeoutMs);
    if (waitResult === "timed-out") return { error: "sync fetch timeout" };
    const dec = new TextDecoder();
    const payloadAt = SYNC_FETCH_HEADER_BYTES;
    let off = payloadAt;
    const readSlice = (len) => {
      const slice = u8.subarray(off, off + len);
      off += len;
      return slice;
    };
    const statusText = dec.decode(readSlice(i32[2]));
    const headers = i32[3] ? JSON.parse(dec.decode(readSlice(i32[3]))) : {};
    const setCookie = i32[4] ? JSON.parse(dec.decode(readSlice(i32[4]))) : [];
    const body = Buffer.from(readSlice(i32[5]));
    if (i32[0] === 2) return { error: dec.decode(u8.subarray(payloadAt, payloadAt + i32[5])) || "sync fetch failed" };
    return { status: i32[1], statusText, headers, setCookie, body };
  } catch (err) {
    try {
      _syncFetchWorker?.terminate();
    } catch {
    }
    _syncFetchWorker = null;
    return { error: `sync fetch error: ${err?.message ?? err}` };
  }
}
function shutdownSyncFetchWorker() {
  try {
    _syncFetchWorker?.terminate();
  } catch {
  }
  _syncFetchWorker = null;
}
const CDN_CACHE_DIR = path.join(os.homedir(), ".zcode-captcha-cdn-cache");
const _memCdnCache = /* @__PURE__ */ new Map();
const MEM_CDN_CACHE_CAP = 16;
const SDK_XHR_TIMEOUT_PATTERN = "arguments[4]?arguments[4]:5e3";
const SDK_XHR_TIMEOUT_REPLACEMENT = "arguments[4]?arguments[4]:30e3";
const CAPTCHA_SCRIPT_PATCH_RE = /^https?:\/\/[^/]*alicdn\.com\/captcha-frontend\/(aliyunCaptcha\/AliyunCaptcha\.js|dynamicJS\/[^?]*\/pe\.\d+\.[^?]*\.js)(\?|$)/i;
let _sdkTimeoutPatchWarned = false;
function __patchSdkXhrTimeout(body) {
  try {
    const src = typeof body === "string" ? body : body.toString("utf8");
    if (src.includes(SDK_XHR_TIMEOUT_REPLACEMENT)) return body;
    if (!src.includes(SDK_XHR_TIMEOUT_PATTERN)) {
      if (!_sdkTimeoutPatchWarned) {
        _sdkTimeoutPatchWarned = true;
        process.stderr.write(
          "[captcha] captcha-frontend js xhr-timeout pattern not found (SDK updated?) -- serving unpatched\n"
        );
      }
      return body;
    }
    return Buffer.from(
      src.split(SDK_XHR_TIMEOUT_PATTERN).join(SDK_XHR_TIMEOUT_REPLACEMENT),
      "utf8"
    );
  } catch (_) {
    return body;
  }
}
function rememberCdnBody(url, body) {
  if (CAPTCHA_SCRIPT_PATCH_RE.test(String(url))) body = __patchSdkXhrTimeout(body);
  _memCdnCache.set(url, body);
  if (_memCdnCache.size > MEM_CDN_CACHE_CAP) {
    for (const key of _memCdnCache.keys()) {
      _memCdnCache.delete(key);
      if (_memCdnCache.size <= MEM_CDN_CACHE_CAP) break;
    }
  }
}
let _cookieCache = { cookies: [], ts: 0 };
const COOKIE_CACHE_TTL_MS = 5 * 60 * 1e3;
const _DEBUG = /^(1|true|yes)$/i.test(
  process.env.CAPTCHA_DEBUG || process.env.CAPTCHA_DEBUG_BODIES || ""
);
const proxyUrl = process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
if (proxyUrl) {
  try {
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
  } catch (_) {
  }
}
const happyEyeballsDispatcher = new UndiciAgent({
  connect: { autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 250 }
});
try {
  const net = require("node:net");
  if (typeof net.setDefaultAutoSelectFamily === "function") {
    net.setDefaultAutoSelectFamily(true);
    if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout === "function") {
      net.setDefaultAutoSelectFamilyAttemptTimeout(250);
    }
  }
} catch (_) {
}
async function solveFetch(url, init, timeoutMs = Number(process.env.CAPTCHA_SOLVE_FETCH_TIMEOUT_MS || 15e3)) {
  const signal = AbortSignal.timeout(timeoutMs);
  const merged = { ...init, signal };
  return proxyUrl ? fetch(url, merged) : undiciFetch(url, { ...merged, dispatcher: happyEyeballsDispatcher });
}
const REQUEST_LOG_CAP = 256;
const _requestLog = [];
function noteRequest(entry) {
  _requestLog.push(entry);
  if (_requestLog.length > REQUEST_LOG_CAP) {
    _requestLog.splice(0, _requestLog.length - REQUEST_LOG_CAP);
  }
}
const _stallCounts = /* @__PURE__ */ new Map();
let _bypassPeCacheOnce = false;
function noteStallAndMaybeEvict(peUrl) {
  try {
    if (!peUrl || !/dynamicJS\//.test(peUrl)) return;
    _bypassPeCacheOnce = true;
    const n = (_stallCounts.get(peUrl) || 0) + 1;
    _stallCounts.set(peUrl, n);
    if (n >= 2 && !_DEBUG) {
      process.stderr.write(`[pe-cache-evict] ${peUrl.split("/").pop()} stalled ${n}x -- evicting cache
`);
    }
    if (n >= 2) {
      _memCdnCache.delete(peUrl);
      try {
        fs.unlinkSync(diskPathFor(peUrl));
      } catch (_) {
      }
      _stallCounts.delete(peUrl);
    }
  } catch (_) {
  }
}
function generateFingerprint() {
  const userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
  const uaMajor = "127";
  const uaFull = "127.0.0.0";
  const platform = "Linux x86_64";
  const screen = { w: 1280, h: 720, aw: 1280, ah: 720 };
  const webglUnmaskedVendor = "Google Inc. (Google)";
  const webglUnmaskedRenderer = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";
  const canvasImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return { userAgent, uaMajor, uaFull, platform, screen, webglUnmaskedVendor, webglUnmaskedRenderer, canvasImage };
}
const fp = generateFingerprint();
const HTML = `<!DOCTYPE html><html><head></head><body>
<div id="cap"></div><button id="btn"></button>
<script src="https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js"></script>
</body></html>`;
function diskPathFor(url) {
  return path.join(CDN_CACHE_DIR, crypto.createHash("sha1").update(String(url)).digest("hex"));
}
function sniffMime(url) {
  if (/\.js(\?|$)/i.test(url)) return "application/javascript";
  if (/\.css(\?|$)/i.test(url)) return "text/css";
  if (/\.png(\?|$)/i.test(url)) return "image/png";
  if (/\.(jpg|jpeg)(\?|$)/i.test(url)) return "image/jpeg";
  if (/\.json(\?|$)/i.test(url)) return "application/json";
  return "application/octet-stream";
}
const peVmCallRegex = /55==A\?\(f=r\[n\+\+\],l=e\.pop\(\),h=e\.pop\(\),o=\[\],\w+\(f\)\.forEach\(function\(\)\{o\.unshift\(e\.pop\(\)\)\}\),p=null===h\?l\.apply\((\w+),o\):h\[l\]\.apply\(h,o\),r\[n\+\+\]&&e\.push\(p\)\):/;
function patchPeBundle(buf, url) {
  if (process.env.PE_PATCH === "off") return buf;
  if (!/dynamicJS\/[^/]*\/pe\.\d+\./.test(url)) return buf;
  let src = buf.toString("utf8");
  if (src.includes("__DBT")) return buf;
  const m = src.match(peVmCallRegex);
  if (!m) return buf;
  const locals = m[1];
  const hook = `55==A?(f=r[n++],l=e.pop(),h=e.pop(),o=[],v(f).forEach(function(){o.unshift(e.pop())}),p=null===h?l.apply(${locals},o):h[l].apply(h,o),r[n++]&&e.push(p),function(){try{if(l===window.btoa||l===window.atob){window.__DBT=window.__DBT||[];var __sav=[];for(var __i=0;__i<e.length;__i++){var __vv=e[__i];if(typeof __vv==="string"){__sav.push("s:"+__vv)}else if(typeof __vv==="number"){__sav.push("n:"+__vv)}else if(typeof __vv==="boolean"){__sav.push("b:"+__vv)}else if(__vv&&typeof __vv.length==="number"){__sav.push("a:"+__vv.length)}else{__sav.push("t:"+typeof __vv)}}var __ls={};for(var __k2 in ${locals}){if(__k2!=="_"&&__k2!=="*"&&__k2!=="arguments"){try{var __lv=${locals}[__k2];if(typeof __lv==="string"){__ls[__k2]="s:"+__lv}else if(typeof __lv==="number"){__ls[__k2]="n:"+__lv}else if(__lv&&typeof __lv.length==="number"){__ls[__k2]="a:"+__lv.length}else{__ls[__k2]="t:"+typeof __lv}}catch(_e){}}}window.__DBT.push({call:"btoa",ip:n,args:o.map(function(__a){return typeof __a==="string"?"s:"+__a:typeof __a==="number"?"n:"+__a:typeof __a==="function"?"fn:"+(__a.name||"?"):typeof __a==="object"&&__a?"obj":typeof __a}),stack:__sav,locals:__ls,rlen:r.length,r:r})}}catch(_e){}}()):`;
  src = src.replace(m[0], hook);
  if (_DEBUG) process.stderr.write(`[loader-patch] ${url} (VM hook applied, locals=${locals})
`);
  return Buffer.from(src, "utf8");
}
function getCachedBody(url) {
  const mem = _memCdnCache.get(url);
  if (mem) return mem;
  try {
    const p = diskPathFor(url);
    if (fs.existsSync(p)) {
      const body = fs.readFileSync(p);
      rememberCdnBody(url, body);
      return body;
    }
  } catch (_) {
  }
  return null;
}
function injectRequestHeaders(request) {
  const h = request.headers;
  try {
    h.set("sec-ch-ua", '"Chromium";v="' + fp.uaMajor + '", "Not)A;Brand";v="24"');
    h.set("sec-ch-ua-mobile", "?0");
    h.set("sec-ch-ua-platform", '"Linux"');
    h.set("user-agent", fp.userAgent);
    h.set("accept-language", "en-US,en;q=0.9");
    h.set("referer", "https://zcode.z.ai/");
    let origin = null;
    try {
      const u = new URL(request.url);
      const method = String(request.method || "GET").toUpperCase();
      const crossOrigin = u.origin !== "https://zcode.z.ai";
      if (crossOrigin || method !== "GET" && method !== "HEAD") {
        origin = "https://zcode.z.ai";
      }
    } catch (_) {
    }
    if (origin) h.set("origin", origin);
  } catch (_) {
  }
}
function cookieHeader(request, window, browserFrame) {
  try {
    const ctx = browserFrame.page.context;
    const u = new URL(request.url);
    if (request.credentials === "omit") return null;
    const cookies = ctx.cookieContainer.getCookies(u, false);
    if (cookies.length > 0) {
      return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    }
  } catch (_) {
  }
  return null;
}
function storeSetCookies(res, url) {
  try {
    const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    if (list.length) {
      const cookieContainer = global.__cookieContainer;
      if (cookieContainer) {
        for (const raw of list) {
          const u = new URL(url);
          const parts = raw.split(";");
          const pair = parts[0].split("=");
          const cookie = {
            name: pair[0].trim(),
            value: pair.slice(1).join("=").trim(),
            url: u.origin,
            domain: u.hostname,
            path: "/"
          };
          for (const p of parts.slice(1)) {
            const kv = p.trim().split(/=(.*)/s);
            const k = (kv[0] || "").toLowerCase();
            if (k === "domain" && kv[1]) cookie.domain = kv[1];
            if (k === "path" && kv[1]) cookie.path = kv[1];
            if (k === "expires") cookie.expires = new Date(kv[1]).getTime();
            if (k === "max-age") cookie.maxAge = parseInt(kv[1], 10);
            if (k === "httponly") cookie.httpOnly = true;
            if (k === "secure") cookie.secure = true;
            if (k === "samesite") cookie.sameSite = kv[1];
          }
          try {
            cookieContainer.addCookies([cookie]);
          } catch (_) {
          }
        }
      }
    }
  } catch (_) {
  }
}
let _asyncRequestsInFlight = 0;
function makeInterceptor(bypassPeCache = false) {
  const skipPeCache = (url) => bypassPeCache && /dynamicJS\/.*\/pe\.\d+\./.test(url);
  return {
    async beforeAsyncRequest({ request, window: w }) {
      _asyncRequestsInFlight += 1;
      try {
        return await handleAsyncRequest({ request, window: w, skipPeCache });
      } finally {
        _asyncRequestsInFlight -= 1;
      }
    },
    beforeSyncRequest(opts) {
      return handleSyncRequest({ ...opts, skipPeCache });
    }
  };
}
async function handleAsyncRequest({ request, window: w, skipPeCache }) {
  {
    const url = request.url;
    noteRequest({ at: Date.now(), method: request.method, url });
    injectRequestHeaders(request);
    if (/\balicdn\.com/i.test(url)) {
      let body = skipPeCache(url) ? null : getCachedBody(url);
      if (body && /\.js(\?|$)/i.test(url)) {
        try {
          new Function(body.toString("utf8"));
        } catch (parseErr) {
          process.stderr.write(`[cache-bad-js] ${url} len=${body.length} ${parseErr.message} -- refetch fresh
`);
          _memCdnCache.delete(url);
          try {
            fs.unlinkSync(diskPathFor(url));
          } catch (_) {
          }
          body = null;
        }
      }
      if (body) {
        if (/dynamicJS\/[^/]*\/pe\.\d+\./.test(url)) {
          try {
            w.__lastPeUrl = url;
          } catch (_) {
          }
        }
        return new w.Response(patchPeBundle(Buffer.from(body), url), {
          status: 200,
          statusText: "OK",
          headers: { "content-type": sniffMime(url) }
        });
      }
    }
    try {
      const init = { method: request.method, headers: {} };
      request.headers.forEach((value, key) => {
        init.headers[key] = value;
      });
      const bs = new URL(url);
      const cookie = cookieHeader(request, w, global.__browserFrame);
      if (cookie) init.headers.cookie = cookie;
      let hasBody = false;
      try {
        if (request.body) {
          const ab = await request.arrayBuffer();
          if (ab && ab.byteLength > 0) {
            init.body = ab;
            hasBody = true;
          }
        }
      } catch (_) {
      }
      const res = await solveFetch(url, init);
      let buf = Buffer.from(await res.arrayBuffer());
      if (CAPTCHA_SCRIPT_PATCH_RE.test(url)) buf = __patchSdkXhrTimeout(buf);
      storeSetCookies(res, url);
      if (_DEBUG && /captcha-open|verify\.|device\.saf|cloudauth-device|upload\./i.test(url) && buf.length && buf.length < 4096) {
        try {
          process.stderr.write(`[xhr-body] ${request.method} ${bs.hostname}${bs.pathname}-> ${res.status} ${buf.toString("utf8").slice(0, 1200)}
`);
        } catch (_) {
        }
      }
      const headers = {};
      const ct = res.headers.get("content-type");
      if (ct) headers["content-type"] = ct;
      const logHost = bs.hostname;
      if (_DEBUG)
        process.stderr.write(
          `[xhr] ${request.method} ${logHost}${bs.pathname} -> ${res.status} (${buf.length}b)
`
        );
      return new w.Response(buf, {
        status: res.status,
        statusText: res.statusText || "",
        headers
      });
    } catch (err) {
      if (_DEBUG) process.stderr.write(`[xhr-err] ${url}: ${err.message}
`);
      return new w.Response("", { status: 503, statusText: "passthrough failed" });
    }
  }
}
function handleSyncRequest({ request, window: w, skipPeCache }) {
  const url = request.url;
  noteRequest({ at: Date.now(), method: request.method, url, sync: true });
  injectRequestHeaders(request);
  let body = null;
  if (/\balicdn\.com/i.test(url)) {
    body = skipPeCache(url) ? null : getCachedBody(url);
    if (body && /\.js(\?|$)/i.test(url)) {
      try {
        new Function(body.toString("utf8"));
      } catch (parseErr) {
        process.stderr.write(`[cache-bad-js:sync] ${url} len=${body.length} ${parseErr.message} -- refetch fresh
`);
        _memCdnCache.delete(url);
        try {
          fs.unlinkSync(diskPathFor(url));
        } catch (_) {
        }
        body = null;
      }
    }
  }
  if (body) {
    if (/dynamicJS\/[^/]*\/pe\.\d+\./.test(url)) {
      try {
        w.__lastPeUrl = url;
      } catch (_) {
      }
    }
    return {
      status: 200,
      statusText: "OK",
      ok: true,
      url,
      redirected: false,
      headers: new w.Headers({ "content-type": sniffMime(url) }),
      body: patchPeBundle(Buffer.from(body), url),
      [PropertySymbol.virtualServerFile]: null
    };
  }
  const init = { method: request.method, headers: {} };
  request.headers.forEach((value, key) => {
    init.headers[key] = value;
  });
  const cookie = cookieHeader(request, w, global.__browserFrame);
  if (cookie) init.headers.cookie = cookie;
  try {
    if (request.body) {
      const ab = request.body;
      if (ab && ab.byteLength > 0) init.body = ab;
    }
  } catch (_) {
  }
  const res = syncFetchBlocking(url, init);
  if (res.error) {
    process.stderr.write(`[sync-xhr-err] ${url}: ${res.error}
`);
    return new w.Response("", { status: 503, statusText: "sync fetch failed" });
  }
  try {
    for (const raw of res.setCookie || []) {
      const cookieContainer = global.__cookieContainer;
      if (!cookieContainer) break;
      const u = new URL(url);
      const parts = raw.split(";");
      const pair = parts[0].split("=");
      const cookie2 = {
        name: pair[0].trim(),
        value: pair.slice(1).join("=").trim(),
        url: u.origin,
        domain: u.hostname,
        path: "/"
      };
      for (const p of parts.slice(1)) {
        const kv = p.trim().split(/=(.*)/s);
        const k = (kv[0] || "").toLowerCase();
        if (k === "domain" && kv[1]) cookie2.domain = kv[1];
        if (k === "path" && kv[1]) cookie2.path = kv[1];
        if (k === "expires") cookie2.expires = new Date(kv[1]).getTime();
        if (k === "max-age") cookie2.maxAge = parseInt(kv[1], 10);
        if (k === "httponly") cookie2.httpOnly = true;
        if (k === "secure") cookie2.secure = true;
        if (k === "samesite") cookie2.sameSite = kv[1];
      }
      try {
        cookieContainer.addCookies([cookie2]);
      } catch (_) {
      }
    }
  } catch (_) {
  }
  const hdrs = {};
  for (const [k, v] of Object.entries(res.headers || {})) hdrs[k] = String(v);
  return {
    status: res.status,
    statusText: res.statusText || "",
    ok: res.status >= 200 && res.status < 300,
    url,
    redirected: false,
    headers: new w.Headers(hdrs),
    body: CAPTCHA_SCRIPT_PATCH_RE.test(url) ? __patchSdkXhrTimeout(Buffer.from(res.body)) : Buffer.from(res.body),
    [PropertySymbol.virtualServerFile]: null
  };
}
const GUEST_TIMER_PROPS = ["setTimeout", "setInterval", "clearTimeout", "clearInterval"];
const GUEST_SCOPE_ROOT = "__capGuestScopes";
let _guestScopeSeq = 0;
function installGuestScope(w) {
  const root = globalThis[GUEST_SCOPE_ROOT] ??= /* @__PURE__ */ Object.create(null);
  const id = `w${++_guestScopeSeq}`;
  const scope = /* @__PURE__ */ Object.create(null);
  for (const name of GUEST_TIMER_PROPS) {
    const fn = w[name];
    scope[name] = typeof fn === "function" ? fn.bind(w) : fn;
  }
  scope.Function = makeScopedFunction(w);
  if (!_DEBUG && w.console) scope.console = w.console;
  root[id] = scope;
  w.__capScopeId = id;
  return id;
}
function removeGuestScope(w) {
  try {
    const id = w && w.__capScopeId;
    const root = globalThis[GUEST_SCOPE_ROOT];
    if (id && root) delete root[id];
  } catch {
  }
}
function makeScopedFunction(w) {
  const Scoped = function(...args) {
    const body = args.length ? String(args[args.length - 1]) : "";
    const params = args.slice(0, -1).map(String).join(",");
    const id = w.__capScopeId;
    const source = `return function(${params}){with(globalThis.${GUEST_SCOPE_ROOT}[${JSON.stringify(id)}]){
${body}
}}`;
    return Function(source)();
  };
  Scoped.prototype = Function.prototype;
  try {
    Object.defineProperty(Scoped, "name", { value: "Function", configurable: true });
    Object.defineProperty(Scoped, "toString", {
      value: () => "function Function() { [native code] }",
      configurable: true,
      writable: true
    });
  } catch {
  }
  return Scoped;
}
function wrapGuestSource(code, filename, scopeId) {
  const sourceUrl = filename && /^https?:/.test(String(filename)) ? `
//# sourceURL=${filename}` : "";
  const scopeRef = `globalThis.${GUEST_SCOPE_ROOT}[${JSON.stringify(scopeId)}]`;
  return `with(${scopeRef}){
${code}
}${sourceUrl}`;
}
function installEvalInstrumentation(w) {
  const sym = PropertySymbol && PropertySymbol.evaluateScript;
  if (!sym || typeof w[sym] !== "function") {
    process.stderr.write("[instr] no evaluateScript symbol, host hook skipped\n");
    return;
  }
  const orig = w[sym];
  w[sym] = function(code, options) {
    const scopeId = w.__capScopeId;
    try {
      if (scopeId) {
        try {
          return orig.call(this, wrapGuestSource(String(code ?? ""), options && options.filename, scopeId), options);
        } catch (scopeErr) {
          if (!(scopeErr instanceof SyntaxError)) throw scopeErr;
          process.stderr.write(
            `[instr] guest scope rejected (${scopeErr.message.slice(0, 80)}), evaluating unwrapped
`
          );
        }
      }
      return orig.call(this, code, options);
    } catch (err) {
      try {
        const src = String(code || "");
        const filename = options && options.filename || "?";
        const sha1 = crypto.createHash("sha1").update(src).digest("hex");
        process.stderr.write(
          `
[EVAL-PARSE-FAIL] file=${filename} len=${src.length} sha1=${sha1}
  head300: ${JSON.stringify(src.slice(0, 300))}
  tail100: ${JSON.stringify(src.slice(-100))}
  err: ${err && err.message}
`
        );
        if (/^https?:/.test(filename)) {
          (async () => {
            try {
              const res = await fetch(filename, { headers: { "user-agent": fp.userAgent } });
              const fresh = Buffer.from(await res.arrayBuffer());
              process.stderr.write(
                `[EVAL-CACHE-COMPARE] cachedLen=${src.length} freshLen=${fresh.length} freshSha1=${crypto.createHash("sha1").update(fresh).digest("hex")} http=${res.status}
`
              );
              if (fresh.length > 0 && fresh.length !== src.length) {
                process.stderr.write(`[EVAL-CACHE-MISMATCH] deleting ${diskPathFor(filename)} (stale/truncated cache)
`);
                try {
                  fs.unlinkSync(diskPathFor(filename));
                } catch (_) {
                }
                _memCdnCache.delete(filename);
              }
            } catch (fetchErr) {
              process.stderr.write(`[EVAL-CACHE-COMPARE-ERR] ${fetchErr.message}
`);
            }
          })();
        }
      } catch (e2) {
      }
      throw err;
    }
  };
}
function installNativeToString(w) {
  const realToString = Function.prototype.toString;
  const nativeRe = /\[native code\]/;
  const mask = (fn) => {
    if (typeof fn !== "function") return;
    try {
      if (nativeRe.test(realToString.call(fn))) return;
      const name = fn.name || "";
      const nativeStr = `function ${name}() { [native code] }`;
      Object.defineProperty(fn, "toString", {
        value: () => nativeStr,
        configurable: true,
        writable: true
      });
    } catch (_) {
    }
  };
  const seen = new w.Set();
  const maskObj = (obj, depth) => {
    if (!obj || typeof obj !== "object" && typeof obj !== "function" || depth > 5)
      return;
    try {
      if (obj.constructor && obj.constructor.prototype !== Object.prototype) {
        const ctorName = obj.constructor.name;
        if (/^(WriteStream|ReadStream|Socket|Process|Timeout|Immediate)$/.test(ctorName)) return;
      }
    } catch (_) {
    }
    if (seen.has(obj)) return;
    try {
      seen.add(obj);
    } catch (_) {
      return;
    }
    let names = [];
    try {
      names = Object.getOwnPropertyNames(obj);
    } catch (_) {
      return;
    }
    for (const name of names) {
      if (name === "toString" || name === "constructor") continue;
      let desc;
      try {
        desc = Object.getOwnPropertyDescriptor(obj, name);
      } catch (_) {
        continue;
      }
      if (!desc) continue;
      if (typeof desc.value === "function") {
        mask(desc.value);
      } else if (typeof desc.get === "function") {
        mask(desc.get);
        try {
          const v = desc.get.call(obj);
          if (typeof v === "function") mask(v);
          else if (v && typeof v.then === "function") v.catch(() => {
          });
        } catch {
        }
      }
      if (depth < 3) {
        try {
          const v = desc.value;
          if (v && (typeof v === "function" || typeof v === "object"))
            maskObj(v, depth + 1);
        } catch (_) {
        }
      }
    }
  };
  const targets = [
    w,
    w.navigator,
    w.document,
    w.Document && w.Document.prototype,
    w.Element && w.Element.prototype,
    w.HTMLElement && w.HTMLElement.prototype,
    w.Node && w.Node.prototype,
    w.EventTarget && w.EventTarget.prototype,
    w.HTMLCanvasElement && w.HTMLCanvasElement.prototype,
    w.XMLHttpRequest && w.XMLHttpRequest.prototype,
    w.Event && w.Event.prototype,
    w.Window && w.Window.prototype
  ].filter(Boolean);
  for (const t of targets) {
    try {
      maskObj(t, 0);
    } catch (_) {
    }
  }
}
const GUEST_EVAL_PATCH = `
(function() {
  try {
    Object.defineProperty(Event.prototype, "isTrusted", {
      get() { return true; },
      configurable: true
    });
  } catch (e) {}
  try {
    if (window.HTMLDocument) {
      Object.defineProperty(window.HTMLDocument, "name", { value: "HTMLDocument", configurable: true });
      Object.defineProperty(window.HTMLDocument.prototype, Symbol.toStringTag, { value: "HTMLDocument", configurable: true });
    }
  } catch (e) {}
  try {
    Object.defineProperty(window.Document.prototype, Symbol.toStringTag, { value: "HTMLDocument", configurable: true });
  } catch (e) {}
  // Guest errors are RECORDED, not printed: the Aliyun/FeiLin SDKs throw
  // benign uncaught TypeErrors inside happy-dom on every solve (imperfect DOM
  // emulation) while the solve still succeeds -- printing them flooded the
  // console with [WINDOW-ERROR] spam. They land in window.__capErrs (capped,
  // deduped) which solveTraceless surfaces only when a solve FAILS.
  // CAPTCHA_DEBUG=1 streams them live again.
  var __capDebug = ${_DEBUG ? "true" : "false"};
  function __capRecord(kind, msg, stack) {
    try {
      var m = String(msg || "?");
      var s = String(stack || "").split("\\n").slice(0, 2).join(" | ");
      if (!window.__capErrs) window.__capErrs = [];
      var last = window.__capErrs[window.__capErrs.length - 1];
      if (last && last.k === kind && last.m === m) {
        last.n = (last.n || 1) + 1;
      } else {
        window.__capErrs.push({ k: kind, m: m, s: s, n: 1 });
        if (window.__capErrs.length > 8) window.__capErrs.shift();
      }
      if (__capDebug) console.error("[" + kind + "]", m, s);
    } catch (e2) {}
  }
  try {
    window.addEventListener("unhandledrejection", function(e) {
      var r = e && e.reason;
      __capRecord("UH-REASON", (r && r.message) || typeof r, r && r.stack);
    });
  } catch (e) {}
  try {
    window.addEventListener("error", function(e) {
      __capRecord("WINDOW-ERROR", e && e.message, e && e.error && e.error.stack);
    });
  } catch (e) {}
  // ---- eval/Function parse-fail instrumentation (installed before pe chain) ----
  // Catches SyntaxError from guest-side eval()/new Function() (the dynamic pe.*
  // chunk is evaluated this way in some SDK paths). Host-side twin: the
  // PropertySymbol.evaluateScript wrapper in installEvalInstrumentation().
  function __capFailDump(kind, code) {
    try {
      var src = String(code || "");
      if (typeof window.__capDebugDump === "function") {
        window.__capDebugDump(window.__lastPeUrl || "?", src, kind);
      } else {
        console.error("[" + kind + "] url=" + (window.__lastPeUrl || "?") + " len=" + src.length + " head=" + JSON.stringify(src.slice(0, 300)) + " tail=" + JSON.stringify(src.slice(-100)));
      }
    } catch (e2) {}
  }
  try {
    var _origEval2 = window.eval;
    if (_origEval2) {
      window.eval = function(code) {
        try { return _origEval2.call(window, code); }
        catch (e) {
          if (e && (/unexpected|invalid|parse|syntax/i.test(String((e && e.message) || e)))) {
            __capFailDump("REALM-EVAL-FAIL", code);
          }
          throw e;
        }
      };
    }
  } catch (e) {}
  try {
    var _of = window.Function;
    if (_of) {
      var _WF = function() {
        var args = Array.prototype.slice.call(arguments);
        var body = args.length ? String(args[args.length - 1]) : "";
        try { return _of.apply(this, args); }
        catch (e) {
          if (e && (/unexpected|invalid|parse|syntax/i.test(String((e && e.message) || e)))) {
            __capFailDump("REALM-FN-FAIL", body);
          }
          throw e;
        }
      };
      _WF.prototype = _of.prototype;
      try { Object.defineProperty(_WF, "name", { value: "Function", configurable: true }); } catch (e) {}
      window.Function = _WF;
    }
  } catch (e) {}
})();
`;
function applyPolyfills(w) {
  if (process.env.CAPTCHA_DEBUG_BODIES === "1") {
    installTrafficLogger(w);
  }
  if (typeof w.Option !== "function") {
    w.Option = class Option extends w.HTMLOptionElement {
      constructor(text, value, defaultSelected, selected) {
        super();
        if (text !== void 0) {
          const el = w.document.createElement("option");
          el.text = text;
          if (value !== void 0) el.value = value;
          if (defaultSelected) el.defaultSelected = true;
          if (selected) el.selected = true;
          return el;
        }
      }
    };
  }
  if (typeof w.Video !== "function" && w.HTMLVideoElement) {
    w.Video = class Video extends w.HTMLVideoElement {
      constructor() {
        return w.document.createElement("video");
      }
    };
  }
  if (typeof w.alert !== "function") w.alert = () => {
  };
  if (typeof w.prompt !== "function") w.prompt = () => null;
  if (typeof w.confirm !== "function") w.confirm = () => false;
  if (typeof w.open !== "function") w.open = () => null;
  if (typeof w.close !== "function") w.close = () => {
  };
  try {
    Object.defineProperty(w, "alert", { value: w.alert, configurable: true, writable: true });
  } catch (_) {
  }
  try {
    Object.defineProperty(w, "prompt", { value: w.prompt, configurable: true, writable: true });
  } catch (_) {
  }
  try {
    Object.defineProperty(w, "confirm", { value: w.confirm, configurable: true, writable: true });
  } catch (_) {
  }
  try {
    Object.defineProperty(w, "open", { value: w.open, configurable: true, writable: true });
  } catch (_) {
  }
  try {
    Object.defineProperty(w, "close", { value: w.close, configurable: true, writable: true });
  } catch (_) {
  }
  const extraGlobals = {
    print: () => {
    },
    stop: () => {
    },
    moveTo: () => {
    },
    moveBy: () => {
    },
    showModalDialog: () => null,
    find: () => false
  };
  for (const [k, v] of Object.entries(extraGlobals)) {
    try {
      Object.defineProperty(w, k, { value: v, configurable: true, writable: true });
    } catch (_) {
    }
  }
  try {
    Object.defineProperty(w, "open", { value: () => null, configurable: true, writable: true });
  } catch (_) {
  }
  try {
    Object.defineProperty(w, "close", { value: () => {
    }, configurable: true, writable: true });
  } catch (_) {
  }
  if (!w.Option) {
    w.Option = class {
      constructor(text, value, defaultSelected, selected) {
        this.text = text ?? "";
        this.value = value ?? "";
        this.selected = selected ?? defaultSelected ?? false;
        this.defaultSelected = !!defaultSelected;
        this.disabled = false;
        this.label = this.text;
        this.index = 0;
      }
    };
  }
  if (!w.EventSource) {
    w.EventSource = class {
      constructor() {
        this.readyState = 2;
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
      }
      close() {
        this.readyState = 2;
      }
      addEventListener() {
      }
      removeEventListener() {
      }
    };
  }
  if (!w.Beacon) w.Beacon = class {
  };
  if (!w.RTCPeerConnection) {
    w.RTCPeerConnection = class {
      constructor() {
      }
      createDataChannel() {
        return {};
      }
      close() {
      }
      createOffer() {
        return Promise.resolve({});
      }
      setLocalDescription() {
        return Promise.resolve();
      }
      addEventListener() {
      }
      removeEventListener() {
      }
    };
  }
  if (!w.MessageChannel) {
    w.MessageChannel = class {
      constructor() {
        this.port1 = { onmessage: null, postMessage() {
        }, start() {
        }, close() {
        }, addEventListener() {
        }, removeEventListener() {
        } };
        this.port2 = { onmessage: null, postMessage() {
        }, start() {
        }, close() {
        }, addEventListener() {
        }, removeEventListener() {
        } };
      }
    };
  }
  w.IntersectionObserver = w.IntersectionObserver || class {
    constructor(cb) {
      this.cb = cb;
    }
    observe() {
    }
    unobserve() {
    }
    disconnect() {
    }
    takeRecords() {
      return [];
    }
  };
  w.ResizeObserver = w.ResizeObserver || class {
    observe() {
    }
    unobserve() {
    }
    disconnect() {
    }
  };
  w.DeviceOrientationEvent = w.DeviceOrientationEvent || class extends w.Event {
    constructor(type, opts) {
      super(type, opts);
    }
    alpha = null;
    beta = null;
    gamma = null;
    absolute = false;
  };
  w.DeviceMotionEvent = w.DeviceMotionEvent || class extends w.Event {
    constructor(type, opts) {
      super(type, opts);
    }
    acceleration = null;
    accelerationIncludingGravity = null;
    rotationRate = null;
    interval = 16;
  };
  w.requestIdleCallback = w.requestIdleCallback || ((cb) => w.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 10 }), 1));
  w.cancelIdleCallback = w.cancelIdleCallback || ((id) => w.clearTimeout(id));
  w.matchMedia = w.matchMedia || (() => ({
    matches: false,
    media: "",
    onchange: null,
    addListener() {
    },
    removeListener() {
    },
    addEventListener() {
    },
    removeEventListener() {
    },
    dispatchEvent() {
      return false;
    }
  }));
  if (!w.visualViewport) {
    const VisualViewport = function() {
    };
    VisualViewport.prototype = {
      width: fp.screen.w - 16,
      height: fp.screen.h - 120,
      scale: 1,
      offsetLeft: 0,
      offsetTop: 0,
      pageLeft: 0,
      pageTop: 0,
      onresize: null,
      onscroll: null,
      onscrollend: null
    };
    w.VisualViewport = VisualViewport;
    w.visualViewport = Object.create(w.VisualViewport.prototype);
  }
  if (!w.indexedDB) {
    const IDBFactory = function() {
    };
    IDBFactory.prototype = {
      open: () => ({ onupgradeneeded: null, onsuccess: null, onerror: null }),
      deleteDatabase: () => ({}),
      databases: () => Promise.resolve([])
    };
    w.IDBFactory = IDBFactory;
    w.indexedDB = Object.create(w.IDBFactory.prototype);
  }
  if (!w.speechSynthesis) {
    const SpeechSynthesis = function() {
    };
    SpeechSynthesis.prototype = {
      speak() {
      },
      cancel() {
      },
      pause() {
      },
      resume() {
      },
      getVoices: () => []
    };
    w.SpeechSynthesis = SpeechSynthesis;
    w.speechSynthesis = Object.create(w.SpeechSynthesis.prototype);
    w.SpeechSynthesisUtterance = function() {
    };
  }
  w.Worker = w.Worker || class {
    postMessage() {
    }
    terminate() {
    }
    addEventListener() {
    }
    removeEventListener() {
    }
  };
  w.Notification = w.Notification || class {
    static permission = "default";
    static requestPermission() {
      return Promise.resolve("default");
    }
    close() {
    }
  };
  const proto = w.HTMLCanvasElement.prototype;
  const nativeGetContext = typeof proto.getContext === "function" ? proto.getContext : null;
  proto.getContext = function(type, ...rest) {
    if (/webgl/i.test(type)) {
      return makeWebGLMock(this);
    }
    if (nativeGetContext) {
      try {
        const ctx = nativeGetContext.call(this, type, ...rest);
        if (ctx) return ctx;
      } catch (_) {
      }
    }
    return make2DStub(this);
  };
  function makeWebGLMock(canvas) {
    return {
      canvas,
      getParameter(p) {
        if (p === 7936) return "WebKit";
        if (p === 7937) return "WebKit WebGL";
        if (p === 7938) return "WebGL 1.0 (OpenGL ES 2.0 Chromium)";
        if (p === 35724) return "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)";
        if (p === 37445) return fp.webglUnmaskedVendor;
        if (p === 37446) return fp.webglUnmaskedRenderer;
        return "Intel Inc.";
      },
      getExtension(name) {
        if (name === "WEBGL_debug_renderer_info") {
          return { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 };
        }
        return null;
      },
      getSupportedExtensions() {
        return [
          "ANGLE_instanced_arrays",
          "EXT_blend_minmax",
          "EXT_color_buffer_half_float",
          "EXT_disjoint_timer_query",
          "EXT_float_blend",
          "EXT_frag_depth",
          "EXT_shader_texture_lod",
          "EXT_texture_compression_bptc",
          "EXT_texture_compression_rgtc",
          "EXT_texture_filter_anisotropic",
          "EXT_sRGB",
          "KHR_parallel_shader_compile",
          "OES_element_index_uint",
          "OES_fbo_render_mipmap",
          "OES_standard_derivatives",
          "OES_texture_float",
          "OES_texture_float_linear",
          "OES_texture_half_float",
          "OES_texture_half_float_linear",
          "OES_vertex_array_object",
          "WEBGL_color_buffer_float",
          "WEBGL_compressed_texture_astc",
          "WEBGL_compressed_texture_etc",
          "WEBGL_compressed_texture_etc1",
          "WEBGL_compressed_texture_s3tc",
          "WEBGL_compressed_texture_s3tc_srgb",
          "WEBGL_debug_renderer_info",
          "WEBGL_debug_shaders",
          "WEBGL_depth_texture",
          "WEBGL_draw_buffers",
          "WEBGL_lose_context",
          "WEBGL_multi_draw"
        ];
      },
      getContextAttributes() {
        return {
          alpha: true,
          antialias: true,
          depth: true,
          failIfMajorPerformanceCaveat: false,
          powerPreference: "default",
          premultipliedAlpha: true,
          preserveDrawingBuffer: false,
          stencil: false,
          desynchronized: false
        };
      },
      getShaderPrecisionFormat() {
        return { precision: 23, rangeMin: 127, rangeMax: 127 };
      }
    };
  }
  function make2DStub(canvas) {
    return {
      canvas,
      fillRect() {
      },
      clearRect() {
      },
      getImageData: (_x, _y, w2 = 1, h2 = 1) => new w.ImageData(w2, h2),
      putImageData() {
      },
      createImageData: (w2 = 1, h2 = 1) => new w.ImageData(w2, h2),
      setTransform() {
      },
      transform() {
      },
      drawImage() {
      },
      save() {
      },
      restore() {
      },
      beginPath() {
      },
      moveTo() {
      },
      lineTo() {
      },
      bezierCurveTo() {
      },
      quadraticCurveTo() {
      },
      closePath() {
      },
      clip() {
      },
      stroke() {
      },
      fill() {
      },
      arc() {
      },
      rect() {
      },
      ellipse() {
      },
      translate() {
      },
      scale() {
      },
      rotate() {
      },
      fillText() {
      },
      strokeText() {
      },
      measureText: (t) => ({ width: String(t).length * 8 }),
      createLinearGradient: () => ({ addColorStop() {
      } }),
      createRadialGradient: () => ({ addColorStop() {
      } }),
      createPattern: () => ({}),
      isPointInPath: () => false,
      font: "10px sans-serif",
      textBaseline: "alphabetic",
      textAlign: "start",
      fillStyle: "#000",
      strokeStyle: "#000",
      globalAlpha: 1,
      lineWidth: 1,
      shadowBlur: 0,
      shadowColor: ""
    };
  }
  const nativeToDataURL = typeof proto.toDataURL === "function" ? proto.toDataURL : null;
  proto.toDataURL = function(...a) {
    try {
      if (nativeToDataURL) return nativeToDataURL.apply(this, a);
    } catch (_) {
    }
    return fp.canvasImage;
  };
  if (typeof proto.toBlob !== "function") {
    proto.toBlob = (cb) => cb && cb(new w.Blob());
  }
  w.OffscreenCanvas = w.OffscreenCanvas || class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return proto.getContext.call(this);
    }
  };
  const audioMock = class {
    constructor() {
      this.sampleRate = 44100;
      this.currentTime = 0;
      this.state = "suspended";
    }
    createOscillator() {
      return {
        type: "sine",
        frequency: { value: 440, setValueAtTime() {
        } },
        connect() {
        },
        start() {
        },
        stop() {
        }
      };
    }
    createDynamicsCompressor() {
      return {
        threshold: { value: -24, setValueAtTime() {
        } },
        knee: { value: 30, setValueAtTime() {
        } },
        ratio: { value: 12, setValueAtTime() {
        } },
        attack: { value: 3e-3, setValueAtTime() {
        } },
        release: { value: 0.25, setValueAtTime() {
        } },
        connect() {
        }
      };
    }
    createAnalyser() {
      return {
        fftSize: 2048,
        frequencyBinCount: 1024,
        getByteFrequencyData() {
        },
        getByteTimeDomainData() {
        },
        connect() {
        }
      };
    }
    createGain() {
      return { gain: { value: 1 }, connect() {
      } };
    }
    destination = {};
    resume() {
      this.state = "running";
      return Promise.resolve();
    }
    close() {
      this.state = "closed";
      return Promise.resolve();
    }
  };
  w.AudioContext = w.AudioContext || audioMock;
  w.OfflineAudioContext = w.OfflineAudioContext || class extends audioMock {
    constructor(_channels, length, sampleRate) {
      super();
      this.length = length;
      this.sampleRate = sampleRate;
    }
    startRendering() {
      const len = this.length || 44100;
      const sr = this.sampleRate || 44100;
      const buf = new Float32Array(len);
      for (let i = 0; i < len; i += 1) {
        const t = i / sr;
        buf[i] = Math.sin(2 * Math.PI * 1e3 * t) * Math.exp(-t * 1.2) * 0.6 + Math.sin(2 * Math.PI * 3e3 * t) * Math.exp(-t * 1.5) * 0.25 + Math.sin(2 * Math.PI * 5e3 * t) * Math.exp(-t * 2) * 0.12;
      }
      return Promise.resolve({
        numberOfChannels: 1,
        length: len,
        sampleRate: sr,
        getChannelData: () => buf
      });
    }
  };
  w.requestAnimationFrame = w.requestAnimationFrame || ((cb) => w.setTimeout(() => cb(Date.now()), 16));
  w.cancelAnimationFrame = w.cancelAnimationFrame || ((id) => w.clearTimeout(id));
  try {
    Object.defineProperty(w.document, "hidden", { value: false, configurable: true });
    Object.defineProperty(w.document, "visibilityState", {
      value: "visible",
      configurable: true
    });
  } catch (_) {
  }
  if (!w.document.fonts) {
    w.document.fonts = {
      ready: Promise.resolve(),
      check: () => true,
      addEventListener() {
      },
      removeEventListener() {
      }
    };
  }
  if (!w.chrome) {
    w.chrome = {
      app: {
        isInstalled: false,
        InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" },
        RunningState: { CANNOT_RUN: "cannot_run", CAN_RUN: "can_run", RUNNING: "running" },
        getDetails() {
          return null;
        },
        getIsInstalled() {
          return false;
        },
        installState(cb) {
          if (cb) cb("not_installed");
        },
        runningState(cb) {
          if (cb) cb("cannot_run");
        }
      },
      csi() {
        const now = Date.now();
        return { startE: now - 100, onloadT: now, pageT: 100, tran: 15 };
      },
      loadTimes() {
        const now = Date.now() / 1e3;
        return {
          requestTime: now - 0.1,
          startLoadTime: now - 0.1,
          commitLoadTime: now - 0.05,
          finishDocumentLoadTime: now,
          finishLoadTime: now,
          firstPaintTime: now - 0.02,
          firstPaintAfterLoadTime: 0,
          navigationType: "Other",
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
          npnNegotiatedProtocol: "h2",
          wasAlternateProtocolAvailable: false,
          connectionInfo: "h2"
        };
      }
    };
  }
  const nav = w.navigator;
  const plugins = createNavigatorPlugins(w);
  const navPatch = {
    userAgent: fp.userAgent,
    platform: fp.platform,
    language: "en-US",
    languages: ["en-US", "en"],
    vendor: "Google Inc.",
    webdriver: false,
    hardwareConcurrency: 12,
    deviceMemory: 8,
    maxTouchPoints: 0,
    cookieEnabled: true,
    plugins: plugins.plugins,
    mimeTypes: plugins.mimeTypes,
    appVersion: fp.userAgent.replace(/^Mozilla\//, ""),
    appName: "Netscape",
    appCodeName: "Mozilla",
    product: "Gecko",
    productSub: "20030107",
    vendorSub: "",
    oscpu: void 0,
    doNotTrack: null,
    sendBeacon: (url, data) => {
      try {
        const xhr = new w.XMLHttpRequest();
        xhr.open("POST", url, true);
        xhr.send(data);
        return true;
      } catch (_) {
        return false;
      }
    }
  };
  for (const [k, v] of Object.entries(navPatch)) {
    try {
      Object.defineProperty(nav, k, { value: v, configurable: true });
    } catch (_) {
    }
  }
  const makeNS = (protoObj) => {
    const C = new w.Function();
    C.prototype = protoObj;
    return new C();
  };
  if (!nav.connection) {
    const NetInfo = () => {
    };
    NetInfo.prototype = { onchange: null, effectiveType: "4g", rtt: 50, downlink: 10, saveData: false };
    w.NetworkInformation = NetInfo;
    try {
      Object.defineProperty(nav, "connection", { value: makeNS(NetInfo.prototype), configurable: true });
    } catch (_) {
    }
  }
  if (!nav.userAgentData) {
    const UAData = function() {
    };
    UAData.prototype = {
      brands: [
        { brand: "Chromium", version: fp.uaMajor },
        { brand: "Not)A;Brand", version: "24" }
      ],
      mobile: false,
      platform: "Linux",
      getHighEntropyValues: () => Promise.resolve({
        brands: [
          { brand: "Chromium", version: fp.uaMajor },
          { brand: "Not)A;Brand", version: "24" }
        ],
        mobile: false,
        platform: "Linux",
        platformVersion: "6.5.0",
        architecture: "x86",
        model: "",
        uaFullVersion: fp.uaFull,
        fullVersionList: [
          { brand: "Chromium", version: fp.uaFull },
          { brand: "Not)A;Brand", version: "24.0.0.0" }
        ]
      })
    };
    try {
      Object.defineProperty(nav, "userAgentData", { value: makeNS(UAData.prototype), configurable: true });
    } catch (_) {
    }
  }
  if (!w.Permissions) {
    const Perms = () => {
    };
    Perms.prototype = {
      query: (param) => Promise.resolve({ state: param.name === "notifications" ? "prompt" : "granted", onchange: null })
    };
    w.Permissions = Perms;
  }
  try {
    if (!nav.permissions) Object.defineProperty(nav, "permissions", { value: makeNS(w.Permissions.prototype), configurable: true });
  } catch (_) {
  }
  try {
    if (!nav.clipboard)
      Object.defineProperty(nav, "clipboard", {
        value: makeNS({ readText: () => Promise.resolve(""), writeText: () => Promise.resolve() }),
        configurable: true
      });
  } catch (_) {
  }
  try {
    if (!nav.geolocation)
      Object.defineProperty(nav, "geolocation", {
        value: makeNS({
          getCurrentPosition: (s) => s && s({ coords: { latitude: 0, longitude: 0, accuracy: 1 } }),
          watchPosition: () => 1,
          clearWatch: () => {
          }
        }),
        configurable: true
      });
  } catch (_) {
  }
  try {
    if (!nav.credentials)
      Object.defineProperty(nav, "credentials", {
        value: makeNS({ get: () => Promise.resolve(null), create: () => Promise.resolve(null), store: () => Promise.resolve(), preventSilentAccess: () => Promise.resolve() }),
        configurable: true
      });
  } catch (_) {
  }
  try {
    if (!nav.storage)
      Object.defineProperty(nav, "storage", {
        value: makeNS({ estimate: () => Promise.resolve({ quota: 1e8, usage: 0 }), persisted: () => Promise.resolve(false), persist: () => Promise.resolve(false) }),
        configurable: true
      });
  } catch (_) {
  }
  try {
    if (!nav.usb)
      Object.defineProperty(nav, "usb", {
        value: makeNS({ getDevices: () => Promise.resolve([]), requestDevice: () => Promise.reject(new Error("no devices")) }),
        configurable: true
      });
  } catch (_) {
  }
  try {
    if (!nav.mediaDevices)
      Object.defineProperty(nav, "mediaDevices", {
        value: makeNS({ enumerateDevices: () => Promise.resolve([]), getUserMedia: () => Promise.reject(new Error("NotAllowedError")) }),
        configurable: true
      });
  } catch (_) {
  }
  const screenPatch = {
    width: fp.screen.w,
    height: fp.screen.h,
    availWidth: fp.screen.w,
    availHeight: fp.screen.ah,
    availLeft: 0,
    availTop: 0,
    colorDepth: 24,
    pixelDepth: 24,
    orientation: { angle: 0, type: "landscape-primary", onchange: null }
  };
  for (const [k, v] of Object.entries(screenPatch)) {
    try {
      Object.defineProperty(w.screen, k, { get: () => v, configurable: true });
    } catch (_) {
    }
  }
  w.outerWidth = fp.screen.w;
  w.outerHeight = fp.screen.h - 40;
  w.innerWidth = fp.screen.w - 16;
  w.innerHeight = fp.screen.h - 120;
  w.devicePixelRatio = 1;
}
function createNavigatorPlugins(w) {
  const indexed = [
    { name: "PDF Viewer", filename: "internal-pdf-viewer", description: "Portable Document Format" },
    { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
    { name: "Chromium PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" }
  ];
  const plugins = w.PluginArray ? Object.create(w.PluginArray.prototype) : {};
  const mockIndexed = [];
  for (let i = 0; i < indexed.length; i++) {
    const p = Object.create(w.Plugin && w.Plugin.prototype || Object.prototype);
    Object.defineProperty(p, "name", { value: indexed[i].name, configurable: true, enumerable: true });
    Object.defineProperty(p, "filename", { value: indexed[i].filename, configurable: true, enumerable: true });
    Object.defineProperty(p, "description", { value: indexed[i].description, configurable: true, enumerable: true });
    Object.defineProperty(p, "length", { value: 1, configurable: true, enumerable: true });
    Object.defineProperty(p, "0", { value: p, configurable: true, enumerable: true });
    p.item = () => p;
    p.namedItem = () => p;
    plugins[i] = p;
    mockIndexed.push(p);
  }
  Object.defineProperty(plugins, "length", { value: indexed.length, configurable: true, enumerable: true });
  plugins.item = (i) => plugins[i] ?? null;
  plugins.namedItem = (name) => mockIndexed.find((p) => p.name === name) ?? null;
  plugins.refresh = () => {
  };
  const mimeTypes = w.MimeTypeArray ? Object.create(w.MimeTypeArray.prototype) : {};
  Object.defineProperty(mimeTypes, "length", { value: 0, configurable: true, enumerable: true });
  mimeTypes.item = () => null;
  mimeTypes.namedItem = () => null;
  return { plugins, mimeTypes };
}
function installTrafficLogger(w) {
  const origOpen = w.XMLHttpRequest.prototype.open;
  const origSend = w.XMLHttpRequest.prototype.send;
  w.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__capMethod = method;
    this.__capUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };
  w.XMLHttpRequest.prototype.send = function(body) {
    const url = String(this.__capUrl || "");
    const DEBUG_HOSTS = /(cloudauth-device|captcha-open|verify|upload|nocaptcha|aliyuncs)/i;
    if (DEBUG_HOSTS.test(url)) {
      this.addEventListener("load", () => {
        let respPreview = "";
        try {
          respPreview = String(this.responseText || "").slice(0, 3e3);
        } catch (_) {
        }
        try {
          process.stderr.write(
            `
===== XHR ${String(this.__capMethod || "?")} ${url}
--- RESP (${respPreview.length}b) ---
${respPreview}
=====
`
          );
        } catch (_) {
        }
      });
    }
    return origSend.call(this, body);
  };
}
function safeJson(x) {
  try {
    if (x instanceof Error) return `Error: ${x.message}
${(x.stack || "").slice(0, 1500)}`;
    const s = JSON.stringify(x);
    return s !== void 0 && s.length < 3e3 ? s : String(x);
  } catch (_) {
    return String(x);
  }
}
function simulateBehavior(w, durationMs = 600) {
  const { document, MouseEvent, KeyboardEvent, UIEvent } = w;
  if (!document || !MouseEvent) return;
  const fire = (type, ctor, opts) => {
    try {
      const Ctor = ctor || UIEvent;
      const ev = new Ctor(type, { bubbles: true, cancelable: true, view: w, ...opts });
      document.dispatchEvent(ev);
      if (document.body) document.body.dispatchEvent(ev);
    } catch (_) {
    }
  };
  let x = 140 + Math.random() * 30;
  let y = 110 + Math.random() * 20;
  const targetX = 540 + Math.random() * 40;
  const targetY = 380 + Math.random() * 30;
  const steps = 22;
  let i = 0;
  const start = Date.now();
  const moveStep = () => {
    if (i > steps) return;
    x += (targetX - x) * 0.16 + (Math.random() - 0.5) * 5;
    y += (targetY - y) * 0.16 + (Math.random() - 0.5) * 4;
    fire("mousemove", MouseEvent, {
      screenX: Math.round(x),
      screenY: Math.round(y),
      clientX: Math.round(x),
      clientY: Math.round(y),
      button: 0,
      buttons: 1
    });
    i += 1;
    const done = Date.now() - start >= durationMs;
    if (i <= steps && !done) {
      w.setTimeout(moveStep, 26 + Math.floor(Math.random() * 32));
    } else {
      fire("mousedown", MouseEvent, { clientX: Math.round(x), clientY: Math.round(y), button: 0, buttons: 1 });
      fire("mouseup", MouseEvent, { clientX: Math.round(x), clientY: Math.round(y), button: 0, buttons: 0 });
      fire("click", MouseEvent, { clientX: Math.round(x), clientY: Math.round(y), button: 0 });
      try {
        fire("keyup", KeyboardEvent, { key: "a", code: "KeyA", keyCode: 65, which: 65 });
      } catch (_) {
      }
    }
  };
  moveStep();
}
function waitFor(cond, timeoutMs = 15e3, intervalMs = 40) {
  return new Promise((res, rej) => {
    const started = Date.now();
    const timer = setInterval(() => {
      let ok = false;
      try {
        ok = cond();
      } catch (_) {
      }
      if (ok) {
        clearInterval(timer);
        res();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        rej(new Error("timeout"));
      }
    }, intervalMs);
  });
}
const GUEST_REALM_DENY = /* @__PURE__ */ new Set([
  "process",
  "Buffer",
  "require",
  "module",
  "exports",
  "global",
  "globalThis",
  "fetch",
  "console",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
  "queueMicrotask",
  "structuredClone",
  "crypto",
  "performance",
  "TextEncoder",
  "TextDecoder",
  "URL",
  "URLSearchParams",
  "AbortController",
  "AbortSignal",
  "atob",
  "btoa",
  "eval",
  "Function",
  "Worker",
  "SharedArrayBuffer",
  "Atomics"
]);
let _realmGlobalsOwner = null;
let _realmGlobalsRestore = null;
function installGuestRealmGlobals(w) {
  const saved = /* @__PURE__ */ Object.create(null);
  let names;
  try {
    names = Object.getOwnPropertyNames(w);
  } catch (_) {
    names = [];
  }
  for (const name of names) {
    try {
      if (GUEST_REALM_DENY.has(name) || HOST_CRITICAL_GLOBALS.has(name)) continue;
      const value = w[name];
      const kind = typeof value;
      if (kind !== "function" && (kind !== "object" || value === null)) continue;
      if (name in saved) continue;
      saved[name] = Object.getOwnPropertyDescriptor(globalThis, name) ?? null;
      Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: false });
    } catch (_) {
    }
  }
  return () => {
    for (const name of Object.keys(saved)) {
      try {
        const d = saved[name];
        if (d) Object.defineProperty(globalThis, name, d);
        else delete globalThis[name];
      } catch (_) {
      }
    }
  };
}
function ensureGuestRealmGlobals(w) {
  if (typeof Bun !== "undefined") return;
  if (_realmGlobalsOwner === w) return;
  if (_realmGlobalsRestore) _realmGlobalsRestore();
  _realmGlobalsRestore = installGuestRealmGlobals(w);
  _realmGlobalsOwner = w;
}
function releaseGuestRealmGlobals(w) {
  if (_realmGlobalsOwner !== w) return;
  if (_realmGlobalsRestore) _realmGlobalsRestore();
  _realmGlobalsRestore = null;
  _realmGlobalsOwner = null;
}
function __realmGlobalsLifecycle(w) {
  const restore = installGuestRealmGlobals(w);
  return restore;
}
const ALIYUN_CAPTCHA_JS = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
async function prewarmCaptchaScript() {
  if (getCachedBody(ALIYUN_CAPTCHA_JS)) return;
  try {
    const res = await solveFetch(ALIYUN_CAPTCHA_JS, { method: "GET" });
    if (res.ok) {
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length > 0) {
        try {
          new Function(body.toString("utf8"));
        } catch (_) {
          return;
        }
        rememberCdnBody(ALIYUN_CAPTCHA_JS, body);
        try {
          fs.mkdirSync(CDN_CACHE_DIR, { recursive: true });
          fs.writeFileSync(diskPathFor(ALIYUN_CAPTCHA_JS), body);
        } catch (_) {
        }
      }
    }
  } catch (_) {
  }
}
async function createDom(region, prefix) {
  await prewarmCaptchaScript();
  let cookies = [];
  const now = Date.now();
  if (_cookieCache.ts > 0 && now - _cookieCache.ts < COOKIE_CACHE_TTL_MS) {
    cookies = _cookieCache.cookies;
  } else {
    try {
      const res = await solveFetch("https://zcode.z.ai/", {
        headers: {
          "User-Agent": fp.userAgent,
          "sec-ch-ua": '"Chromium";v="' + fp.uaMajor + '", "Not)A;Brand";v="24"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Linux"',
          "Accept-Language": "en-US,en;q=0.9"
        }
      });
      cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      _cookieCache = { cookies, ts: Date.now() };
    } catch (_) {
    }
  }
  const interceptor = makeInterceptor(_bypassPeCacheOnce);
  _bypassPeCacheOnce = false;
  if (!process.__capUnhandledRejectionHooked) {
    process.__capUnhandledRejectionHooked = true;
    process.on("unhandledRejection", (reason) => {
      if (!_DEBUG) return;
      try {
        const r = reason && reason.stack ? reason.stack : String(reason);
        process.stderr.write(`[host-unhandledRejection] ${typeof reason} ${JSON.stringify(reason).slice(0, 200)} ${r}
`);
      } catch (_) {
      }
    });
    process.on("uncaughtException", (err) => {
      try {
        const msg = err && err.message ? err.message : String(err);
        process.stderr.write(`[captcha-guest-uncaught] ${msg}
`);
      } catch (_) {
      }
    });
  }
  const noop = () => {
  };
  const guestConsole = _DEBUG ? {
    log: (...a) => process.stderr.write(`[guest-log] ${a.map((x) => typeof x === "object" ? safeJson(x) : String(x)).join(" ")}
`),
    warn: (...a) => process.stderr.write(`[guest-warn] ${a.map((x) => typeof x === "object" ? safeJson(x) : String(x)).join(" ")}
`),
    error: (...a) => process.stderr.write(`[guest-err] ${a.map((x) => typeof x === "object" ? safeJson(x) : String(x)).join(" ")}
`),
    info: (...a) => process.stderr.write(`[guest-info] ${a.map((x) => typeof x === "object" ? safeJson(x) : String(x)).join(" ")}
`),
    debug: (...a) => process.stderr.write(`[guest-debug] ${a.map((x) => typeof x === "object" ? safeJson(x) : String(x)).join(" ")}
`),
    trace: (...a) => process.stderr.write(`[guest-trace] ${a.map((x) => typeof x === "object" ? safeJson(x) : String(x)).join(" ")}
`)
  } : { log: noop, warn: noop, error: noop, info: noop, debug: noop, trace: noop };
  const w = new Window({
    url: "https://zcode.z.ai/",
    console: guestConsole,
    settings: {
      enableJavaScriptEvaluation: true,
      enableImageFileLoading: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
      navigator: { userAgent: fp.userAgent },
      viewport: { width: fp.screen.w, height: fp.screen.h, devicePixelRatio: 1 },
      fetch: {
        disableSameOriginPolicy: true,
        interceptor
      }
    }
  });
  const browserFrame = new WindowBrowserContext(w).getBrowserFrame();
  global.__browserFrame = browserFrame;
  global.__cookieContainer = browserFrame.page.context.cookieContainer;
  for (const raw of cookies) {
    try {
      const u = new URL("https://zcode.z.ai/");
      const parts = raw.split(";");
      const pair = parts[0].split("=");
      const cookie = {
        name: pair[0].trim(),
        value: pair.slice(1).join("=").trim(),
        url: u.origin,
        domain: u.hostname,
        path: "/"
      };
      for (const p of parts.slice(1)) {
        const kv = p.trim().split(/=(.*)/s);
        const k = (kv[0] || "").toLowerCase();
        if (k === "domain" && kv[1]) cookie.domain = kv[1];
        if (k === "path" && kv[1]) cookie.path = kv[1];
        if (k === "expires") cookie.expires = new Date(kv[1]).getTime();
        if (k === "max-age") cookie.maxAge = parseInt(kv[1], 10);
        if (k === "httponly") cookie.httpOnly = true;
        if (k === "secure") cookie.secure = true;
        if (k === "samesite") cookie.sameSite = kv[1];
      }
      browserFrame.page.context.cookieContainer.addCookies([cookie]);
    } catch (_) {
    }
  }
  const visitorId = crypto.randomUUID();
  const deviceMid = crypto.randomUUID();
  const pre = [
    { name: "zcode_visitor_id", value: visitorId, domain: "zcode.z.ai" },
    { name: "zcode_device_mid", value: deviceMid, domain: "zcode.z.ai" },
    { name: "visitor_id", value: visitorId, domain: "zcode.z.ai", httpOnly: true }
  ];
  for (const c of pre) {
    try {
      browserFrame.page.context.cookieContainer.addCookies([{ ...c, url: "https://zcode.z.ai", path: "/" }]);
    } catch (_) {
    }
  }
  applyPolyfills(w);
  installNativeToString(w);
  installGuestScope(w);
  installEvalInstrumentation(w);
  const needsGlobalAlias = typeof Bun !== "undefined";
  if (needsGlobalAlias) {
    const g = globalThis;
    installGlobalWindowAlias(g, w);
  }
  if (w.Error) {
    w.Error.prepareStackTrace = Error.prepareStackTrace;
  }
  w.__capDebugDump = (url, src, kind) => {
    try {
      const s = String(src || "");
      const sha1 = crypto.createHash("sha1").update(s).digest("hex");
      process.stderr.write(
        `
[${kind}] url=${url} len=${s.length} sha1=${sha1}
  head300: ${JSON.stringify(s.slice(0, 300))}
  tail100: ${JSON.stringify(s.slice(-100))}
`
      );
      if (/^https?:/.test(String(url))) {
        (async () => {
          try {
            const res = await fetch(url, { headers: { "user-agent": fp.userAgent } });
            const fresh = Buffer.from(await res.arrayBuffer());
            process.stderr.write(
              `[${kind}-CACHE-COMPARE] cachedLen=${s.length} freshLen=${fresh.length} freshSha1=${crypto.createHash("sha1").update(fresh).digest("hex")} http=${res.status}
`
            );
            if (fresh.length > 0 && fresh.length !== s.length) {
              process.stderr.write(`[${kind}-MISMATCH] deleting ${diskPathFor(url)} (stale/truncated cache)
`);
              try {
                fs.unlinkSync(diskPathFor(url));
              } catch (_) {
              }
              _memCdnCache.delete(url);
            }
          } catch (fetchErr) {
            process.stderr.write(`[${kind}-CACHE-COMPARE-ERR] ${fetchErr.message}
`);
          }
        })();
      }
    } catch (_) {
    }
  };
  w.eval(GUEST_EVAL_PATCH);
  ensureGuestRealmGlobals(w);
  w.document.write(HTML);
  w.AliyunCaptchaConfig = { region, prefix };
  return { window: w, browserFrame };
}
const HOST_CRITICAL_GLOBALS = /* @__PURE__ */ new Set([
  "process",
  "Bun",
  "console",
  "performance",
  "crypto",
  "fetch",
  "queueMicrotask",
  "structuredClone",
  "TextEncoder",
  "TextDecoder",
  // Timers stay pristine on globalThis so Bun internals keep real Node timer
  // objects (`.unref()`); guest code gets the window's registry lexically.
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  // NOTE: requestAnimationFrame/cancelAnimationFrame were removed from this
  // list (2026-09-06). Bun has no native rAF, so skipping the alias left a
  // bare `requestAnimationFrame` in the FeiLin bundle unresolvable (9 call
  // sites, only one `typeof`-guarded) -- the same silent fingerprint
  // degradation that `print` caused. Aliasing the window's implementation
  // shadows nothing on the host.
  // NOTE: `print` was removed from this list (2026-08-29). The polyfill
  // defines a harmless no-op on the window, but the alias pass skipped it,
  // so under Bun (guest scripts run in the HOST realm) the Aliyun pe risk
  // engine hit a bare `print` reference -> ReferenceError -> broken
  // fingerprint chain -> degraded solve success rate (711 WINDOW-ERRORs in
  // one day). Bun's host global has no native `print`, so aliasing the
  // stub shadows nothing critical.
  "URL",
  "URLSearchParams",
  "AbortController",
  "AbortSignal",
  "ReadableStream",
  "WritableStream",
  "TransformStream",
  "Blob",
  "File",
  "FormData",
  "Headers",
  "Request",
  "Response",
  "Event",
  "EventTarget",
  "MessageChannel",
  "MessagePort",
  "Buffer",
  "global",
  "globalThis",
  // JS intrinsics -- GlobalWindow re-exposes them as class fields; the host
  // versions are fine, so never shadow them.
  "Array",
  "ArrayBuffer",
  "Boolean",
  "DataView",
  "Date",
  "Error",
  "EvalError",
  "Float32Array",
  "Float64Array",
  "Function",
  "Infinity",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "Intl",
  "JSON",
  "Map",
  "Math",
  "NaN",
  "Number",
  "Object",
  "Promise",
  "RangeError",
  "ReferenceError",
  "RegExp",
  "Reflect",
  "Set",
  "String",
  "Symbol",
  "SyntaxError",
  "TypeError",
  "URIError",
  "Uint8Array",
  "Uint8ClampedArray",
  "Uint16Array",
  "Uint32Array",
  "WeakMap",
  "WeakSet",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "escape",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
  "unescape",
  "eval"
]);
const EXTRA_WINDOW_PROPS = [
  "moveBy",
  "moveTo",
  "resizeBy",
  "resizeTo",
  "scrollTo",
  "scrollBy",
  "scroll",
  "open",
  "close",
  "stop",
  "focus",
  "blur",
  "print",
  "alert",
  "confirm",
  "prompt",
  "getSelection",
  "find"
];
const INERT_WINDOW_METHODS = new Set(EXTRA_WINDOW_PROPS);
let _aliasRefCount = 0;
const ALIAS_TOMBSTONE_MS = 3e4;
let _aliasGeneration = 0;
let _tombstoneMs = ALIAS_TOMBSTONE_MS;
const _hostSetTimeout = globalThis.setTimeout;
const _aliasGetters = /* @__PURE__ */ new WeakSet();
let _savedHostGlobalDescriptors;
function installGlobalWindowAlias(g, w, tombstoneMs) {
  if (_aliasRefCount < 0) _aliasRefCount = 0;
  _aliasRefCount += 1;
  _aliasGeneration += 1;
  _tombstoneMs = typeof tombstoneMs === "number" ? tombstoneMs : ALIAS_TOMBSTONE_MS;
  const props = new Set(Object.getOwnPropertyNames(w));
  for (const name of EXTRA_WINDOW_PROPS) props.add(name);
  for (const proto = Object.getPrototypeOf(w); proto && proto !== Object.prototype; ) {
    for (const name of Object.getOwnPropertyNames(proto)) props.add(name);
    break;
  }
  if (_aliasRefCount === 1 && !_savedHostGlobalDescriptors) {
    const saved = {};
    for (const prop of props) {
      if (prop === "constructor" || HOST_CRITICAL_GLOBALS.has(prop)) continue;
      try {
        const d = Object.getOwnPropertyDescriptor(g, prop);
        if (d && d.get && _aliasGetters.has(d.get)) continue;
        if (d) saved[prop] = d;
      } catch (_) {
      }
    }
    for (const prop of ["window", "self", "top", "parent", "__capWindowFor"]) {
      try {
        const d = Object.getOwnPropertyDescriptor(g, prop);
        if (d && d.get && _aliasGetters.has(d.get)) continue;
        if (d && !saved[prop]) saved[prop] = d;
      } catch (_) {
      }
    }
    _savedHostGlobalDescriptors = saved;
  }
  for (const prop of props) {
    if (HOST_CRITICAL_GLOBALS.has(prop)) continue;
    try {
      const getter = function() {
        return w[prop];
      };
      _aliasGetters.add(getter);
      Object.defineProperty(g, prop, {
        get: getter,
        set(v) {
          try {
            w[prop] = v;
          } catch (_) {
          }
        },
        configurable: true
      });
    } catch (_) {
    }
  }
  for (const prop of ["window", "self", "top", "parent"]) {
    try {
      const getter = function() {
        return w;
      };
      _aliasGetters.add(getter);
      Object.defineProperty(g, prop, { get: getter, configurable: true });
    } catch (_) {
    }
  }
  try {
    const capGetter = function() {
      return w;
    };
    _aliasGetters.add(capGetter);
    Object.defineProperty(g, "__capWindowFor", {
      get: capGetter,
      configurable: true
    });
  } catch (_) {
  }
}
function removeGlobalWindowAlias(g, w) {
  _aliasRefCount -= 1;
  if (_aliasRefCount > 0) return;
  const restored = /* @__PURE__ */ new Set();
  if (_savedHostGlobalDescriptors) {
    for (const [name, desc] of Object.entries(_savedHostGlobalDescriptors)) {
      try {
        Object.defineProperty(g, name, desc);
      } catch (_) {
      }
      restored.add(name);
    }
    _savedHostGlobalDescriptors = void 0;
  }
  const generation = _aliasGeneration;
  const names = [];
  try {
    for (const name of Object.getOwnPropertyNames(w)) {
      if (restored.has(name)) continue;
      try {
        if (Object.getOwnPropertyDescriptor(g, name)?.get) names.push(name);
      } catch (_) {
      }
    }
    for (const prop of ["window", "self", "top", "parent", "__capWindowFor"]) {
      if (restored.has(prop)) continue;
      try {
        if (Object.getOwnPropertyDescriptor(g, prop)?.get) names.push(prop);
      } catch (_) {
      }
    }
  } catch (_) {
  }
  try {
    const t = _hostSetTimeout(() => {
      if (generation !== _aliasGeneration || _aliasRefCount > 0) return;
      for (const name of names) {
        try {
          if (!Object.getOwnPropertyDescriptor(g, name)?.get) continue;
          const stub = INERT_WINDOW_METHODS.has(name) ? () => {
          } : void 0;
          Object.defineProperty(g, name, {
            value: stub,
            configurable: true,
            writable: true
          });
        } catch (_) {
        }
      }
    }, _tombstoneMs);
    try {
      if (t && typeof t.unref === "function") t.unref();
    } catch (_) {
    }
  } catch (_) {
  }
}
const _gcStats = { calls: 0, lastAt: 0 };
function reclaimCaptchaHeap() {
  try {
    const gc = typeof Bun !== "undefined" && typeof Bun.gc === "function" && Bun.gc || typeof globalThis.gc === "function" && globalThis.gc;
    if (!gc) return;
    const raw = Number(process.env.CAPTCHA_GC_MIN_INTERVAL_MS);
    const minMs = Number.isFinite(raw) && raw >= 0 ? raw : 5e3;
    const now = Date.now();
    if (now - _gcStats.lastAt < minMs) return;
    _gcStats.lastAt = now;
    _gcStats.calls += 1;
    gc(true);
  } catch (_) {
  }
}
function destroyDom(win) {
  releaseGuestRealmGlobals(win);
  try {
    const cap = win.document.getElementById("cap");
    if (cap) cap.replaceChildren();
    win.happyDOM.close();
  } catch (_) {
  }
  try {
    global.__cookieContainer = null;
    global.__browserFrame = null;
  } catch (_) {
  }
  try {
    if (typeof Bun !== "undefined") removeGlobalWindowAlias(globalThis, win);
  } catch (_) {
  }
  removeGuestScope(win);
  try {
    shutdownSyncFetchWorker();
  } catch (_) {
  }
  reclaimCaptchaHeap();
}
function extractVerifyParam(param) {
  let verifyParam = param;
  if (param && typeof param === "object") {
    verifyParam = param.verifyParam || param.data || param.param;
  }
  if (!verifyParam || String(verifyParam).length < 20) {
    throw new Error("solver returned empty param: " + JSON.stringify(param));
  }
  const str = String(verifyParam);
  if (str.length < 200) {
    throw new Error(
      "verify param too short (" + str.length + " chars) -- degraded result, refusing: " + str.slice(0, 80)
    );
  }
  try {
    const decoded = JSON.parse(Buffer.from(str, "base64").toString("utf8"));
    const secTok = decoded && (decoded.securityToken || decoded.SecurityToken);
    if (!secTok || String(secTok).length < 50) {
      throw new Error(
        "verify param missing securityToken -- refusing degraded result: " + str.slice(0, 80)
      );
    }
  } catch (err) {
    if (err instanceof SyntaxError || /securityToken/.test(String(err.message))) {
      throw err instanceof SyntaxError ? new Error("verify param not base64-JSON: " + str.slice(0, 80)) : err;
    }
    throw err;
  }
  return str;
}
function handleCaptchaResult(result) {
  if (result && typeof result === "object" && result.verifyResult === false) {
    throw new Error(
      "verify rejected: " + JSON.stringify({ verifyCode: result.verifyCode, certifyId: result.certifyId })
    );
  }
  return result;
}
const _reusePool = { window: null, browserFrame: null, solves: 0, lastUsedAt: 0 };
const REUSE_MAX_SOLVES = Number(process.env.CAPTCHA_REUSE_MAX_SOLVES || 8);
const REUSE_MAX_IDLE_MS = Number(process.env.CAPTCHA_REUSE_MAX_IDLE_MS || 12e4);
function takeReusableWindow() {
  const p = _reusePool;
  if (!p.window) return null;
  if (p.solves >= REUSE_MAX_SOLVES) {
    discardReusableWindow();
    return null;
  }
  if (Date.now() - p.lastUsedAt > REUSE_MAX_IDLE_MS) {
    discardReusableWindow();
    return null;
  }
  return { window: p.window, browserFrame: p.browserFrame, reused: true };
}
function stageReusableWindow(window, browserFrame) {
  _reusePool.window = window;
  _reusePool.browserFrame = browserFrame;
  _reusePool.solves = 0;
  _reusePool.lastUsedAt = Date.now();
}
function discardReusableWindow() {
  const p = _reusePool;
  if (p.window) {
    try {
      destroyDom(p.window);
    } catch (_) {
    }
  }
  p.window = null;
  p.browserFrame = null;
  p.solves = 0;
}
function noteWindowSolved() {
  _reusePool.solves += 1;
  _reusePool.lastUsedAt = Date.now();
}
function guestErrorSummary(w, max = 4) {
  try {
    const errs = w && w.__capErrs;
    if (!errs || !errs.length) return "";
    const total = errs.reduce((a, e) => a + (e && e.n || 1), 0);
    const parts = errs.slice(0, max).map((e) => {
      const n = e && e.n && e.n > 1 ? `x${e.n}` : "";
      return `${e && e.k || "?"}${n}: ${String(e && e.m || "?").slice(0, 120)}`;
    });
    return ` guestErrors(${total}): ${parts.join(" || ")}`;
  } catch (_) {
    return "";
  }
}
async function solveTraceless(opts) {
  const scene = opts.scene || "11xygtvd";
  const region = opts.region || "sgp";
  const prefix = opts.prefix || "no8xfe";
  const timeoutMs = opts.timeoutMs ?? Number(process.env.CAPTCHA_SOLVE_TIMEOUT_MS || 3e4);
  const wantReuse = opts.reuseWindow ?? process.env.CAPTCHA_WINDOW_REUSE !== "0";
  let dom;
  let reused = false;
  if (wantReuse) {
    dom = takeReusableWindow();
    if (dom) reused = true;
  }
  if (!dom) {
    dom = await createDom(region, prefix);
  }
  const { window: w, browserFrame } = dom;
  const solveStart = Date.now();
  let solveSucceeded = false;
  let keepWindow = false;
  try {
    await waitFor(() => typeof w.initAliyunCaptcha === "function", timeoutMs, 50);
    simulateBehavior(w, 600);
    const param = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const peUrl = (() => {
          try {
            return w.__lastPeUrl || "?";
          } catch (_) {
            return "?";
          }
        })();
        const reqs = _requestLog.filter((r) => r.at >= solveStart).map((r) => `${r.at - solveStart}ms ${r.method} ${String(r.url).replace(/^https?:\/\//, "").slice(0, 60)}`).slice(-12);
        reject(new Error(`captcha solve timeout pe=${peUrl.split("/").pop() || peUrl} reqs=${JSON.stringify(reqs)}`));
      }, timeoutMs);
      const stallMs = opts.stallMs ?? Number(process.env.CAPTCHA_STALL_MS || 12e3);
      const stallTimer = setInterval(() => {
        const last = _requestLog[_requestLog.length - 1];
        if (last && Date.now() - last.at > stallMs && _asyncRequestsInFlight === 0) {
          const peUrl = (() => {
            try {
              return w.__lastPeUrl || "?";
            } catch (_) {
              return "?";
            }
          })();
          noteStallAndMaybeEvict(peUrl);
          const reqs = _requestLog.filter((r) => r.at >= solveStart).map((r) => `${r.at - solveStart}ms ${r.method} ${String(r.url).replace(/^https?:\/\//, "").slice(0, 60)}`).slice(-12);
          clearTimeout(timer);
          clearInterval(stallTimer);
          reject(new Error(`captcha solve stall pe=${peUrl.split("/").pop() || peUrl} lastXhr=${last.at - solveStart}ms reqs=${JSON.stringify(reqs)}`));
        }
      }, 500);
      const finish = (fn) => (value) => {
        clearTimeout(timer);
        clearInterval(stallTimer);
        fn(value);
      };
      try {
        w.initAliyunCaptcha({
          SceneId: scene,
          mode: "popup",
          region,
          prefix,
          language: "en",
          element: "#cap",
          button: "#btn",
          captchaLogoImg: "",
          showErrorTip: false,
          getInstance: (inst) => {
            try {
              (inst.startTracelessVerification || inst.show).call(inst);
            } catch (e) {
              finish(reject)(new Error(`start: ${e.message}`));
            }
          },
          success: (result) => {
            try {
              finish(resolve)(handleCaptchaResult(result));
            } catch (err) {
              finish(reject)(err);
            }
          },
          fail: (err) => finish(reject)(new Error(`fail: ${JSON.stringify(err)}`)),
          onError: (err) => finish(reject)(new Error(`onError: ${JSON.stringify(err)}`))
        });
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
    try {
      const okPe = w.__lastPeUrl;
      if (okPe) _stallCounts.delete(okPe);
      w.__capErrs = [];
    } catch (_) {
    }
    if (process.env.CAPTCHA_DUMP_DBT === "1") {
      try {
        const dbt = w.__DBT || [];
        fs.writeFileSync(
          process.env.CAPTCHA_DBT_FILE || "/tmp/pe-dbt.json",
          JSON.stringify({ count: dbt.length, last: dbt.slice(-8), all: dbt }, null, 1)
        );
      } catch (_) {
      }
    }
    solveSucceeded = true;
    const out = extractVerifyParam(param);
    if (wantReuse) {
      if (reused) noteWindowSolved();
      else stageReusableWindow(w, browserFrame);
      keepWindow = true;
    }
    return out;
  } catch (err) {
    const summary = guestErrorSummary(w);
    if (summary) {
      try {
        err.message = `${err && err.message ? err.message : String(err)} |${summary}`;
      } catch (_) {
      }
    }
    throw err;
  } finally {
    if (!keepWindow) {
      if (_reusePool.window === w) _reusePool.window = null;
      destroyDom(w);
    }
  }
}
function __captchaMemStats() {
  return {
    requestLogLength: _requestLog.length,
    requestLogCap: REQUEST_LOG_CAP,
    cdnCacheSize: _memCdnCache.size,
    cdnCacheCap: MEM_CDN_CACHE_CAP,
    reuseMaxSolves: REUSE_MAX_SOLVES,
    gcCalls: _gcStats.calls,
    gcLastAt: _gcStats.lastAt
  };
}
function __cdnCacheGet(url) {
  return _memCdnCache.get(url);
}
export {
  __captchaMemStats,
  __cdnCacheGet,
  __patchSdkXhrTimeout,
  __realmGlobalsLifecycle,
  createDom,
  destroyDom,
  installGlobalWindowAlias,
  noteRequest,
  reclaimCaptchaHeap,
  rememberCdnBody,
  removeGlobalWindowAlias,
  solveTraceless
};
