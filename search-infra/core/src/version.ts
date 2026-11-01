/**
 * 版本单一事实源 — 运行时从 package.json 读,消灭 mcp.ts/http.ts/cli.ts 三处手写版本号漂移
 * (v0.7 实测 bug: mcp.ts 写死 "0.5.0" 落后 package.json 两个 minor)。
 * dist/mcp.js → require("../package.json") = core/package.json;作为依赖安装时同理命中正确路径。
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version?: string };

export const VERSION: string = pkg.version ?? "0.0.0";
