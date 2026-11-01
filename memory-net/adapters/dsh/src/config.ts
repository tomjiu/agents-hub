/**
 * 适配包配置：默认值 + cordis.patch.yml 行 config 覆盖（与 kokoa 插件先例同构）。
 * 全部有默认值；未知子键透传保留（不静默吞配置）。
 */

export interface AdapterConfig {
  enabled: boolean
  /** 各 workspace 一个子目录（内含 memory.db）。 */
  workspaces_root: string
  /** 未显式指定时的 workspace 名。 */
  default_workspace: string
  /** 本实例写入者身份（agent_id）。 */
  agent_id: string
  budgets: { max_nodes: number; max_tokens: number }
  inject: { section_order: number }
  tools: { recall: boolean; write: boolean; max_obs_chars: number }
  /** 宿主工具结果自动 observe 入网（dsh-tools 'tools/result' 事件桥；写纪律不破——仅宿主路径）。 */
  auto_observe: {
    enabled: boolean
    /** 结果摘要截断上限（字符）。 */
    max_chars: number
    /** 参数摘要截断上限（字符）。 */
    args_chars: number
    /** 失败结果也入网（失败是同样有价值的协作事实）。 */
    include_error: boolean
    /** 嵌套 dispatch（exec.parent 存在）也入网；默认只观察根调用。 */
    include_nested: boolean
  }
}

type Dict = Record<string, unknown>
const obj = (v: unknown): Dict => (v && typeof v === 'object' ? (v as Dict) : {})
const merged = <T extends Dict>(base: T, raw: unknown): T => ({ ...base, ...obj(raw) }) as T
/** 严格布尔：仅 true/false 采纳，其余回退默认（防字符串/数字被 Boolean() 误展开为真）。 */
// 布尔防御：严格布尔之外，识别字符串/数字形态的 false/true 家族（YAML 引号、env 注入常见）；
// 其余非法值回落默认——顶层 enabled 与 auto_observe 五项同一哲学（会话 14 P3：Boolean() 强转会让 "false" 关不掉）
const boolOr = (v: unknown, def: boolean): boolean => {
  if (typeof v === 'boolean') return v
  if (v === 'false' || v === 0 || v === '0' || v === 'no' || v === 'off') return false
  if (v === 'true' || v === 1 || v === '1' || v === 'yes' || v === 'on') return true
  return def
}
/** 数字防御：非有限数或低于下限回退默认。 */
const numOr = (v: unknown, def: number, min: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min ? v : def

import os from 'node:os'
import path from 'node:path'

/** 默认配置（骨架建议值；dsh cordis.patch.yml 行 config 可覆盖）。 */
export function resolveConfig(raw: Dict = {}): AdapterConfig {
  const c: AdapterConfig = {
    enabled: raw.enabled === undefined ? true : boolOr(raw.enabled, true),
    workspaces_root: String(raw.workspaces_root ?? ''),
    default_workspace: String(raw.default_workspace ?? 'default'),
    agent_id: String(raw.agent_id ?? 'dsh-main'),
    budgets: merged({ max_nodes: 24, max_tokens: 2048 }, raw.budgets),
    inject: merged({ section_order: 90 }, raw.inject),
    tools: merged({ recall: true, write: true, max_obs_chars: 4000 }, raw.tools),
    auto_observe: {
      enabled: boolOr(obj(raw.auto_observe).enabled, true),
      max_chars: numOr(obj(raw.auto_observe).max_chars, 2000, 100),
      args_chars: numOr(obj(raw.auto_observe).args_chars, 200, 0),
      include_error: boolOr(obj(raw.auto_observe).include_error, true),
      include_nested: boolOr(obj(raw.auto_observe).include_nested, false),
    },
  }
  // workspaces_root 解析：'' → $KOKOA_STATE_DIR/memory-net → ~/.kokoa/memory-net
  // 函数形态 replacer：KOKOA_STATE_DIR/家目录值可能含 $&、$` 等 String.replace 特殊序列，
  // 字符串形态替换会展开为匹配文本导致路径腐化（kokoa 12-a 同族教训）。
  const state = process.env.KOKOA_STATE_DIR || path.join(os.homedir(), '.kokoa')
  const home = os.homedir()
  if (!c.workspaces_root) {
    c.workspaces_root = path.join(state, 'memory-net')
  } else {
    c.workspaces_root = c.workspaces_root
      .replace(/\$\{KOKOA_STATE_DIR\}/g, () => state)
      .replace(/^~(?=\/|$)/, () => home)
  }
  return c
}

/** workspace 名 → 目录（物理隔离一个名一个目录；名内禁路径分隔符，防越出 root）。 */
export function workspaceDir(cfg: AdapterConfig, name?: string): string {
  const n = String(name ?? cfg.default_workspace).trim()
  if (!n || /[/\\]/.test(n) || n === '.' || n === '..') {
    throw new Error(`非法 workspace 名: ${JSON.stringify(name ?? cfg.default_workspace)}（禁空名/路径分隔符/点）`)
  }
  return path.join(cfg.workspaces_root, n)
}
