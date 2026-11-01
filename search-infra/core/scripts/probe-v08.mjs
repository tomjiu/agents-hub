// v0.8 探针: 真网络端到端 — STORM-lite 角度选择(信号命中)/preset 预算(summary)/outline 大纲/连接器注册面
// (mcp-connector 的外部 server 接线已有离线全链路测试覆盖;真连外部 MCP 需要用户自己的 server+key,不在沙箱范围)
import { SearchCore } from "../dist/index.js";
import { selectAngles } from "../dist/research.js";

// 1) 角度信号选择(无网络)
const howto = selectAngles("rust 入门教程 怎么安装配置");
const cmp = selectAngles("postgres vs mysql 哪个好");
console.log("ANGLES how-to:", howto.join("/"));
console.log("ANGLES compare:", cmp.join("/"));

// 2) preset=summary 真网络迷你研究(1 轮/4 fetch,应比默认快且带 outline)
const core = new SearchCore();
const t0 = Date.now();
const r = await core.deepResearch("search core mcp server design", {
  preset: "summary",
  noCache: true,
});
console.log(`RESEARCH summary: stop=${r.stop.reason} loops=${r.loops.length} facts=${r.facts.length} refs=${r.refs.length} in ${Date.now() - t0}ms`);
console.log("ANGLES used:", r.angles.join("/"));
console.log("OUTLINE:", JSON.stringify(r.outline));
console.log("REPORT head:", (r.report.split("\n").find(Boolean) ?? "").slice(0, 60));

// 3) providers 注册面(默认无连接器,29 个)
const provs = core.providers();
console.log("PROVIDERS:", provs.length, "registered (0 connectors by default)");
process.exit(0);
