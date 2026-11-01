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

function isPrivateIp(ip: string, extraCidrs: string[]): boolean {
  if (isIP(ip) === 6) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true;
    if (low.startsWith("fe80") || low.startsWith("fc") || low.startsWith("fd")) return true;
    if (low.startsWith("::ffff:")) return isPrivateIp(low.slice(7), extraCidrs); // v4-mapped
    return false;
  }
  if (isIP(ip) !== 4) return true; // 无法解析的一律拒绝
  for (const c of PRIVATE_V4) if (inCidr4(ip, c)) return true;
  for (const c of extraCidrs) {
    if (c.includes(".") && c.includes("/")) {
      // 用户声明的 fake-ip 豁免网段不应落入私网判定之外的拦截,仅记录
      continue;
    }
  }
  return false;
}

export interface SsrfOptions {
  fakeIpCidrs?: string[]; // 豁免网段(Clash TUN fake-ip, dsh[10]): 判定私网时忽略这些
  allowPrivate?: boolean; // 测试用
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

/** DNS 解析 + 私网判定。fakeIpCidrs 中的地址视为豁免(代理 TUN 场景)。 */
export async function assertResolvableSafe(
  u: URL,
  opts: SsrfOptions = {},
): Promise<{ ip: string } | { error: string }> {
  let addrs;
  try {
    addrs = await lookup(u.hostname, { all: true, verbatim: true });
  } catch (e) {
    return { error: `dns fail: ${u.hostname} (${(e as Error).message})` };
  }
  const fake = opts.fakeIpCidrs ?? [];
  for (const a of addrs) {
    const isFake = fake.some((cidr) => {
      if (isIP(a.address) === 4 && cidr.includes("/")) {
        return inCidr4(a.address, cidr) || v4ToInt(a.address) >>> 16 === 0xc06a || v4ToInt(a.address) >>> 16 === 0xc06b;
      }
      return false;
    });
    if (isFake) continue;
    if (!opts.allowPrivate && isPrivateIp(a.address, fake)) {
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
