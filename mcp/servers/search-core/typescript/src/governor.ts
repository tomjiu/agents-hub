/**
 * Governor (v0-spec §4.6): 预算 + SSRF 守卫 + 域名治理
 * - 预算: run 级申请-核销 (修 ODR[11] 无全局预算的洞)
 * - SSRF: 协议/端口/DNS 解析全查 + 手动逐跳跟随重定向 (dsh[10] 182 行守卫的收敛版)
 * - 域名: 全局黑名单 + run 级 allow/block (Trae[05] + WorkBuddy[07])
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class BudgetExceededError extends Error {}

/** run 级字符预算 (token ≈ chars/4, 保守口径) */
export class Budget {
  readonly maxChars: number;
  #spent = 0;
  #ledger: { label: string; chars: number }[] = [];

  constructor(maxChars: number) {
    this.maxChars = maxChars;
  }
  get spent(): number {
    return this.#spent;
  }
  get remaining(): number {
    return Math.max(0, this.maxChars - this.#spent);
  }
  get ledger(): readonly { label: string; chars: number }[] {
    return this.#ledger;
  }
  /** 申请 chars 字符;超额抛错(调用方应先 tryAfford) */
  charge(chars: number, label: string): void {
    if (this.#spent + chars > this.maxChars) {
      throw new BudgetExceededError(
        `budget exceeded: need ${chars}, spent ${this.#spent}, max ${this.maxChars} (${label})`,
      );
    }
    this.#spent += chars;
    this.#ledger.push({ label, chars });
  }
  tryCharge(chars: number, label: string): boolean {
    if (this.#spent + chars > this.maxChars) return false;
    this.charge(chars, label);
    return true;
  }
}

// ---------- 域名治理 ----------

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** host 是否匹配域规则(支持 *.example.com 与 example.com 两种写法) */
export function domainMatch(host: string, rule: string): boolean {
  const r = rule.toLowerCase().replace(/^\*\./, "");
  return host === r || host.endsWith("." + r);
}

export interface DomainPolicy {
  globalBlocked: string[];
  allow?: string[];
  block?: string[];
}

export function checkDomain(url: string, policy: DomainPolicy): string | null {
  const host = hostOf(url);
  if (!host) return `bad url: ${url}`;
  for (const rule of policy.globalBlocked) if (domainMatch(host, rule)) return `blocked(global): ${host}`;
  if (policy.block) for (const rule of policy.block) if (domainMatch(host, rule)) return `blocked(run): ${host}`;
  if (policy.allow && policy.allow.length > 0) {
    const ok = policy.allow.some((rule) => domainMatch(host, rule));
    if (!ok) return `not-in-allowlist: ${host}`;
  }
  return null;
}

// ---------- SSRF 守卫 ----------

const PRIVATE_V4 = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8",
  "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.168.0.0/16",
  "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4",
];

function v4ToInt(ip: string): number {
  const p = ip.split(".").map(Number);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

function inCidr4(ip: string, cidr: string): boolean {
  const [net, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(net) & mask);
}

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true;
    if (/^fe[89ab]/.test(low) || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("ff") || low.startsWith("2001:db8:")) return true;
    if (low.startsWith("::ffff:")) {
      const tail = low.slice(7);
      if (isIP(tail) === 4) return isPrivateIp(tail);
      const parts = tail.split(":");
      if (parts.length === 2 && parts.every(p => /^[a-f0-9]{1,4}$/.test(p))) {const n = parseInt(parts[0],16)*65536+parseInt(parts[1],16);return isPrivateIp([n>>>24,(n>>>16)&255,(n>>>8)&255,n&255].join("."));}
      return true;
    }
    return false;
  }
  if (isIP(ip) !== 4) return true; // 无法解析的一律拒绝
  for (const c of PRIVATE_V4) if (inCidr4(ip, c)) return true;
  return false;
}

export type FetchNetworkMode = "strict" | "trusted-tun";
export type DnsLookup = (host: string) => Promise<{ address: string; family: number }[]>;
export function validateFetchNetwork(mode: unknown, cidrs: unknown): string[] {
  if (mode !== "strict" && mode !== "trusted-tun") throw new Error("Invalid fetch network mode; use strict or trusted-tun");
  if (!Array.isArray(cidrs) || cidrs.length > 16) throw new Error("Invalid fake-IP CIDR list");
  for (const cidr of cidrs) {
    if (typeof cidr !== "string" || !/^198[.](?:18|19)[.]\d{1,3}[.]\d{1,3}\/(?:1[5-9]|2[0-9]|3[0-2])$/.test(cidr)) throw new Error("TUN CIDRs must be subnets of 198.18.0.0/15");
    const [ip, bitsRaw] = cidr.split("/"), bits = Number(bitsRaw);
    const parts = ip.split(".").map(Number), mask = (0xffffffff << (32-bits)) >>> 0;
    if (parts.some(p => p > 255) || ip !== parts.join(".") || ((v4ToInt(ip)&mask)>>>0)!==v4ToInt(ip)) throw new Error("Invalid or noncanonical TUN CIDR");
  }
  if (mode === "trusted-tun" && cidrs.length === 0) throw new Error("Trusted TUN requires an explicit fake-IP CIDR list");
  return [...new Set(cidrs)];
}
export function validateNetworkTarget(u: URL, mode: FetchNetworkMode): string | null {
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/[.]$/, "");
  if (u.username || u.password) return "URL credentials are not allowed";
  const literal = isIP(host) !== 0;
  if (mode === "trusted-tun" && literal) return "IP literal target forbidden in trusted TUN mode";
  if (!literal && (!host.includes(".") || !/^[a-z0-9.-]+$/.test(host) || host.split(".").some(label=>!label || label.startsWith("-") || label.endsWith("-")) || /(?:^|[.])(?:localhost|local|internal|lan|home|home[.]arpa|test|invalid|example|onion)$/.test(host))) return "Local or nonpublic hostname target forbidden";
  return null;
}
export interface SsrfOptions {
  networkMode?: FetchNetworkMode;
  fakeIpCidrs?: string[]; // Only trusted-tun domain DNS answers, never a general private-IP exemption.
  allowPrivate?: boolean; // Existing isolated test-only mode.
  lookup?: DnsLookup; // Test injection; not configurable via JSON/env/MCP.
}

/** 校验 URL 本身(协议/端口/域名治理),不涉及 DNS */
export function validateUrl(
  rawUrl: string,
  policy?: DomainPolicy,
): { url: URL } | { error: string } {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { error: `invalid url: ${rawUrl}` };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { error: `bad protocol: ${u.protocol}` };
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  if (![80, 443, 8080, 8443].includes(port)) return { error: `bad port: ${port}` };
  if (policy) {
    const derr = checkDomain(u.href, policy);
    if (derr) return { error: derr };
  }
  return { url: u };
}

/** DNS precheck: strict rejects reserved IPs; trusted-tun only trusts domain fake-IP mappings. Not connection-IP pinning. */
export async function assertResolvableSafe(
  u: URL,
  opts: SsrfOptions = {},
): Promise<{ ip: string } | { error: string }> {
  const mode = opts.networkMode ?? "strict";
  let fake: string[];
  try {fake = validateFetchNetwork(mode, opts.fakeIpCidrs ?? []);}catch(e){return {error:(e as Error).message};}
  if (mode === "trusted-tun" && opts.allowPrivate) return {error:"Trusted TUN requires strict SSRF checks"};
  if (!opts.allowPrivate) {const error=validateNetworkTarget(u,mode);if(error)return {error};}
  let addrs;
  try {
    addrs = await (opts.lookup ?? (host=>lookup(host,{all:true,verbatim:true})))(u.hostname.replace(/^\[|\]$/g,""));
  } catch (e) {
    return { error: `dns fail: ${u.hostname} (${(e as Error).message})` };
  }
  if (!addrs.length) return {error:"DNS returned no addresses"};
  for (const a of addrs) {
    const isFake = mode === "trusted-tun" && isIP(a.address) === 4 && fake.some(cidr=>inCidr4(a.address,cidr));
    if (isFake) continue;
    if (!opts.allowPrivate && isPrivateIp(a.address)) {
      return { error: `private address blocked: ${u.hostname} -> ${a.address}` };
    }
  }
  return { ip: addrs[0]?.address ?? "" };
}

/** 抓取用: 校验 + 解析安全后返回 URL;调用方需用 redirect:"manual" 逐跳调用本函数 */
export async function safeFetchUrl(
  rawUrl: string,
  policy: DomainPolicy | undefined,
  opts: SsrfOptions = {},
): Promise<{ url: URL } | { error: string }> {
  const v = validateUrl(rawUrl, policy);
  if ("error" in v) return v;
  const r = await assertResolvableSafe(v.url, opts);
  if ("error" in r) return r;
  return { url: v.url };
}
