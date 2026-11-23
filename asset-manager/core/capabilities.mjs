import fs from 'node:fs/promises';
import path from 'node:path';
import {loadCatalog} from './catalog.mjs';
import {confined,assetId,sha256} from './files.mjs';
import {effectivePath} from './lifecycle.mjs';
import {describeAssetUsability} from './usability.mjs';

const domains = ['workflow','document','engineering','design','research','security'];
const stages = ['plan','design','execute','test','accept','research'];
const normalize = s => s.normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim();
function shape(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new Error('Invalid capability '+label);
}
function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw new Error('Invalid capability '+label);
}
function strings(value, label, allowed) {
  if (!Array.isArray(value) || !value.length || value.length > 50) throw new Error('Invalid capability '+label);
  for (const s of value) { text(s,label); if (allowed && !allowed.includes(s)) throw new Error('Unknown capability '+label+': '+s); }
  if (new Set(value.map(normalize)).size !== value.length) throw new Error('Duplicate capability '+label);
}
async function load(root) {
  const file = await confined(root,'catalog/capabilities.json');
  if ((await fs.stat(file)).size > 1024*1024) throw new Error('Capability registry exceeds 1 MiB');
  const data = JSON.parse(await fs.readFile(file,'utf8'));
  shape(data,['schema','groups','routes'],'registry');
  if (data.schema !== 1 || !Array.isArray(data.groups) || !data.groups.length || data.groups.length > 20 || !Array.isArray(data.routes) || !data.routes.length || data.routes.length > 200) throw new Error('Invalid capability registry schema/lists');
  const catalog = await loadCatalog(root), groupIds = new Set(), routeIds = new Set();
  for (const g of data.groups) {
    shape(g,['id','title'],'group'); assetId(g.id); text(g.title,'group title');
    if (groupIds.has(g.id)) throw new Error('Duplicate capability group'); groupIds.add(g.id);
  }
  for (const r of data.routes) {
    shape(r,['id','title','group','domains','stages','aliases','coverage','limitations','providers'],'route');
    assetId(r.id); text(r.title,'route title');
    if (routeIds.has(r.id)) throw new Error('Duplicate capability route'); routeIds.add(r.id);
    if (!groupIds.has(r.group)) throw new Error('Unknown capability group');
    strings(r.domains,'domain',domains); strings(r.stages,'stage',stages); strings(r.aliases,'alias'); strings(r.limitations,'limitations');
    if (r.aliases.some(a => normalize(a).length > 500)) throw new Error('Capability alias exceeds query limit');
    if (!['scoped','partial','none'].includes(r.coverage) || !Array.isArray(r.providers) || r.providers.length > 20 || (r.coverage !== 'none' && !r.providers.length) || (r.coverage === 'none' && r.providers.length)) throw new Error('Invalid capability coverage/providers');
    const ids = new Set();
    for (const p of r.providers) {
      shape(p,['id','reviewed_skill_sha256','fit','reason','limitations'],'provider'); assetId(p.id);
      if (catalog.get(p.id)?.kind !== 'skills') throw new Error('Unknown/non-Skill capability provider '+p.id);
      if (ids.has(p.id)) throw new Error('Duplicate capability provider'); ids.add(p.id);
      if (typeof p.reviewed_skill_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(p.reviewed_skill_sha256)) throw new Error('Invalid capability reviewed digest');
      if (!['primary','supporting','alternative'].includes(p.fit)) throw new Error('Invalid capability fit');
      text(p.reason,'reason'); strings(p.limitations,'provider limitations');
    }
  }
  return {data,catalog};
}
function options(data, opts, find = false) {
  shape(opts,find ? ['group','client','limit'] : ['group','client'],'options');
  const client = opts.client ?? 'dsh', limit = opts.limit ?? 10;
  if (!['dsh','codex','opencode','generic'].includes(client)) throw new Error('Unknown capability client');
  if (opts.group !== undefined && !data.groups.some(g => g.id === opts.group)) throw new Error('Unknown capability group');
  if (find && (!Number.isInteger(limit) || limit < 1 || limit > 20)) throw new Error('Capability limit must be 1..20');
  return {client,limit,group:opts.group};
}
async function enrich(root, catalog, routes, client) {
  const ids = [...new Set(routes.flatMap(r => r.providers.map(p => p.id)))];
  const usability = new Map((await describeAssetUsability(root,ids,{client})).map(r => [r.id,r]));
  const joined = new Map();
  for (const id of ids) {
    const a = catalog.get(id), u = usability.get(id);
    let digest = null, error = null, effective = null;
    try { effective = await effectivePath(root,a); digest = sha256(await fs.readFile(await confined(effective,'SKILL.md'))); } catch (e) { error = e.message; }
    const {status,...actual} = u;
    joined.set(id,{...actual,usability:status,source:{...a.source},upstream:a.version.upstream || 'unknown',current_skill_sha256:digest,canonical_path:a.path,effective_path:effective ? path.relative(root,effective).split(path.sep).join('/') : null,error});
  }
  return routes.map(r => {
    const providers = r.providers.map(p => {
      const {error,...actual} = joined.get(p.id);
      const mapping_status = actual.current_skill_sha256 === p.reviewed_skill_sha256 ? 'CURRENT' : 'REVIEW_NEEDED';
      const blockers = [...actual.blockers];
      if (mapping_status !== 'CURRENT') blockers.push({code:'capability-mapping-review',reason:error || 'Effective Skill body changed since scope review; re-review mapping, do not repin blindly'});
      return {...actual,...p,mapping_status,blockers,usability:blockers.length ? 'BLOCKED' : actual.usability,selectable_candidate:mapping_status === 'CURRENT' && blockers.length === 0};
    });
    const available = providers.some(p => p.selectable_candidate);
    return {...r,providers,status:!available ? 'UNAVAILABLE' : r.coverage === 'partial' ? 'PARTIAL_CANDIDATE' : 'CANDIDATES'};
  });
}
function summary(data,catalog) {
  const ids = new Set(data.routes.flatMap(r => r.providers.map(p => p.id)));
  return {schema:1,classification_scope:'curated_subset',groups:data.groups,total_catalog_assets:catalog.size,mapped_asset_count:ids.size,unmapped_asset_ids:[...catalog.keys()].filter(id => !ids.has(id)),activated:false,scope:'Curated literal task aliases and reviewed Skill-body mappings only; not semantic interpretation, legal approval, installed tool status or task execution.'};
}
export async function listCapabilities(root,opts = {}) {
  const {data,catalog} = await load(root), {group,client} = options(data,opts);
  const routes = await enrich(root,catalog,data.routes.filter(r => !group || r.group === group),client);
  return {...summary(data,catalog),client,total_routes:data.routes.length,routes};
}
function matches(query,alias) {
  let offset = 0;
  for (;;) {
    const i = query.indexOf(alias,offset); if (i < 0) return false;
    const before = query[i-1] || '', after = query[i+alias.length] || '';
    if (!(/[a-z0-9]/i.test(alias[0]) && /[a-z0-9_.-]/i.test(before)) && !(/[a-z0-9]/i.test(alias.at(-1)) && /[a-z0-9_.-]/i.test(after))) return true;
    offset = i+1;
  }
}
export async function findCapabilities(root,query,opts = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 500) throw new Error('Provide capability query 1..500 characters');
  const q = normalize(query), {data,catalog} = await load(root), {client,group,limit} = options(data,opts,true);
  const selected = data.routes.flatMap(r => {
    if (group && r.group !== group) return [];
    const matched_aliases = r.aliases.filter(a => matches(q,normalize(a)));
    if (q !== r.id && !matched_aliases.length) return [];
    return [{...r,matched_aliases,match_basis:q === r.id ? 'route_id' : 'literal_alias'}];
  });
  selected.sort((a,b) => Number(b.id === q)-Number(a.id === q) || Math.max(0,...b.matched_aliases.map(s => s.length))-Math.max(0,...a.matched_aliases.map(s => s.length)) || a.id.localeCompare(b.id));
  const routes = await enrich(root,catalog,selected.slice(0,limit),client);
  return {...summary(data,catalog),query,client,status:selected.length ? 'TASK_CANDIDATES' : 'NO_MATCH',total_matches:selected.length,routes,uncovered_notice:selected.length ? 'Matched labels do not imply the entire request is covered; inspect route/provider limitations.' : 'No curated alias matched; use inventory search or request scope review, not automatic installation.'};
}
export async function renderCapabilityDirectory(root) {
  const {data,catalog} = await load(root);
  const escape = s => [...s].map(c => ['[',']','*','_','<','>','|',String.fromCharCode(92)].includes(c) ? '&#'+c.charCodeAt(0)+';' : c).join('').split(String.fromCharCode(10)).join(' ');
  const link = (label,destination) => '['+escape(label)+'](<'+destination+'>)';
  const lines = ['# 按任务找能力','','本页由 '+link('任务目录元数据','capabilities.json')+' 生成。它是精选任务目录，不是全部资产分类，也不是已安装工具列表。','','## 怎样选择','','先看任务范围，再用CLI读取当前正文匹配、来源、许可和宿主障碍。主选/辅助/备选不是共同安装配方。','','~~~sh','node asset-manager/cli.mjs find-capability "需求分析与规划"','node asset-manager/cli.mjs find-capability "办公质量验收"','node asset-manager/cli.mjs capabilities --group office','~~~','','scoped表示限定任务范围，partial表示部分覆盖，none表示缺口。CURRENT仅表示已审阅正文哈希一致，不是专业效果、许可或运行验收；CONTENT_READY也只表示内容可读。未知查询返回NO_MATCH，可另用search-assets查库存，不自动回退碎片匹配。'];
  for (const group of data.groups) {
    lines.push('', '## '+escape(group.title));
    for (const route of data.routes.filter(r => r.group === group.id)) {
      lines.push('', '### '+escape(route.title)+'（'+route.id+'）', '', '范围：'+route.coverage+'；领域：'+route.domains.join(' / ')+'；阶段：'+route.stages.join(' / ')+'.', '', '任务用语：'+route.aliases.map(escape).join('、')+'.');
      for (const limit of route.limitations) lines.push('- '+escape(limit));
      if (!route.providers.length) lines.push('- **未建立经审阅的专用能力，不自动推荐相似资产。**');
      for (const provider of route.providers) {
        const asset = catalog.get(provider.id);
        lines.push('', '- '+link(provider.id,'assets/'+provider.id+'.toml')+'（'+provider.fit+'）；'+link('维护正文','../'+asset.path+'/SKILL.md')+'。来源类型：'+escape(asset.source.kind)+'；许可声明：'+escape(asset.source.license || 'unknown')+'.', '  - 适用理由：'+escape(provider.reason));
        for (const limit of provider.limitations) lines.push('  - 限制：'+escape(limit));
      }
    }
  }
  const mapped = new Set(data.routes.flatMap(r => r.providers.map(p => p.id)));
  lines.push('', '## 覆盖边界', '', '当前 '+data.routes.length+' 条任务路线，映射 '+mapped.size+' 个不同Skill资产；'+(catalog.size-mapped.size)+' 项登记资产尚未进入此精选目录（含MCP/插件/规范）。不新增重复Skill，不改变资产ID、原始目录、Experts、许可或运行配置。', '', '原Skill正文或有效版本变化需要重新审阅任务映射，不能盲目重算哈希。正文之外的脚本/参考材料仍需原资产完整性与使用前预检；本目录不是内容快照锁或自动部署许可。', '');
  return lines.join(String.fromCharCode(10));
}
export async function validateCapabilitiesIfPresent(root) {
  try { await fs.lstat(path.join(root,'catalog/capabilities.json')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  return validateCapabilities(root);
}
export async function validateCapabilities(root) {
  const dir = await listCapabilities(root);
  const review = dir.routes.flatMap(r => r.providers.filter(p => p.mapping_status !== 'CURRENT').map(p => ({route:r.id,id:p.id,reason:p.blockers.filter(b => b.code === 'capability-mapping-review')})));
  return {status:review.length ? 'REVIEW_NEEDED' : 'PASS',routes:dir.total_routes,mapped_assets:dir.mapped_asset_count,unmapped_assets:dir.unmapped_asset_ids.length,mapping_reviews:review,activated:false,scope:'Registry structure, reference identities and reviewed Skill-body digests; not runtime acceptance.'};
}
