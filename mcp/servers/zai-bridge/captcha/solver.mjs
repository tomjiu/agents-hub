#!/usr/bin/env node
/**
 * 验证码求解 sidecar。
 *
 * 常驻进程，stdin/stdout 各一行 JSON：
 *   请求 {"id":1,"scene":"didk33e0","region":"sgp","prefix":"no8xfe"}
 *   响应 {"id":1,"ok":true,"param":"<base64>"}
 *        或 {"id":1,"ok":false,"error":"..."}
 *
 * 原理：用 happy-dom 在 Node 里模拟浏览器 DOM，加载阿里云验证码 SDK，
 * 调用 startTracelessVerification() 拿到 certifyId + securityToken。
 * 全程不启动真实浏览器，不需要人工拖动滑块。
 *
 * 两个关键调参（实测得出）：
 *   CAPTCHA_STALL_MS   无 XHR 多久算卡死。默认 12s 在本机会误杀正常求解
 *                      （pe VM 纯计算可超过 12s），这里改为 30s。
 *   CAPTCHA_ATTEMPTS   每次重试都会换一个新的 pe.0xx 版本，个别版本会在
 *                      本地 VM 里真的卡死，重试是上游设计的应对方式。
 */
import { createInterface } from "node:readline";
// 引用 esbuild 预编译的纯 JS 产物，不依赖 Node 的 TypeScript 剥离实验特性，
// 因此 Node 20+ 都能直接运行（Docker 镜像里无需额外 flag）。
import { solveTraceless } from "./captcha-happy.mjs";

const MAX_ATTEMPTS = Number(process.env.CAPTCHA_ATTEMPTS || 5);
const ATTEMPT_TIMEOUT_MS = Number(process.env.CAPTCHA_ATTEMPT_TIMEOUT_MS || 45000);

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

let chain = Promise.resolve();

function respond(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function log(msg) {
  process.stderr.write("[captcha] " + msg + "\n");
}

/** 带重试的求解。每次重试都会拿到新的 pe 版本，避开卡死的那个。 */
async function solveWithRetry(scene, region, prefix) {
  let lastErr = null;
  const started = Date.now();
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const t0 = Date.now();
    try {
      const param = await solveTraceless({
        scene,
        region,
        prefix,
        // 首次用新窗口，后续复用（复用可省约一半 CPU）
        reuseWindow: attempt > 1,
        timeoutMs: ATTEMPT_TIMEOUT_MS,
      });
      log(`第 ${attempt} 次成功，耗时 ${Date.now() - t0}ms（累计 ${Date.now() - started}ms）`);
      return param;
    } catch (err) {
      lastErr = err;
      log(`第 ${attempt} 次失败（${Date.now() - t0}ms）: ${String(err?.message ?? err).slice(0, 160)}`);
    }
  }
  throw lastErr ?? new Error("求解失败");
}

rl.on("line", (line) => {
  const raw = line.trim();
  if (!raw) return;

  let req;
  try {
    req = JSON.parse(raw);
  } catch (err) {
    respond({ id: null, ok: false, error: "请求不是合法 JSON: " + String(err?.message ?? err) });
    return;
  }

  // 串行执行：solver 内部有全局窗口状态，不能并发
  chain = chain.then(async () => {
    const id = req.id ?? null;
    try {
      const param = await solveWithRetry(
        req.scene || "didk33e0",
        req.region || "sgp",
        req.prefix || "no8xfe",
      );
      respond({ id, ok: true, param });
    } catch (err) {
      respond({ id, ok: false, error: String(err?.message ?? err).slice(0, 800) });
    }
  });
});

rl.on("close", () => {
  chain.finally(() => process.exit(0));
});

log("sidecar 已启动");
