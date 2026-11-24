import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const modules=path.join(root,'plugins/memory-net/console');
const {MemoryNet}=await import(pathToFileURL(path.join(modules,'vendor/memory-net/dist/src/store.js')).href);
const {Catalog}=await import(pathToFileURL(path.join(modules,'packages/server/dist/src/catalog.js')).href);
const {createConsoleServer}=await import(pathToFileURL(path.join(modules,'packages/server/dist/src/server.js')).href);
const home=await fs.mkdtemp(path.join(os.tmpdir(),'hub-console-click-'));
const workspace=path.join(home,'review-test');const token=crypto.randomBytes(24).toString('hex');
let handle,browser;const steps=[];
const evidence=path.join(root,'.asset-state/evidence');await fs.mkdir(evidence,{recursive:true});
try {
 const seed=MemoryNet.open(workspace,{agentId:'ui-fixture',role:'host',workspaceId:'review-test'});
 seed.add('constraint',{key:'test-boundary',text:'仅测试隔离工作区，不删除用户数据',payload:{mode:'forbid'}});
 seed.add('observation',{key:'probe',text:'UI migration fixture',source:'tool'});
 // M3 候选审核 fixture：来源观测 + 独立核验观测 + pending 候选
 const src1=seed.add('observation',{text:'迁移脚本对 review-test 库执行了 schema 校验',source:'tool',run_id:'r-ui'});
 const src2=seed.add('observation',{text:'schema 校验两次重复执行结果一致',source:'tool',run_id:'r-ui'});
 const verA=seed.add('observation',{text:'独立复核：手工打开 SQLite 确认 schema 版本一致',source:'tool',run_id:'r-ui'});
 seed.proposeCandidate({text:'迁移脚本 schema 校验结果稳定，可推进到导出验证',confidence:.6,source_ids:[src1.id,src2.id],run_id:'r-ui'});
 void verA;seed.close();
 handle=createConsoleServer({host:'127.0.0.1',port:0,token,catalog:new Catalog(home),staticDir:path.join(modules,'apps/console/dist'),ssePollMs:100});
 await new Promise((resolve,reject)=>{handle.server.once('error',reject);handle.server.listen(0,'127.0.0.1',resolve);});
 const {port}=handle.server.address();const url='http://127.0.0.1:'+port;
 browser=await chromium.launch({executablePath:process.env.HUB_BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.getByRole('button',{name:'Token',exact:true}).click();
 await page.getByPlaceholder('粘贴 token…').fill('wrong-test-token');await page.getByRole('button',{name:'保存并连接',exact:true}).click();
 await page.locator('#conn-status').filter({hasText:'需要 Token'}).waitFor();steps.push('Invalid token rejected by actual UI/API');
 await page.getByRole('button',{name:'Token',exact:true}).click();await page.getByPlaceholder('粘贴 token…').fill(token);await page.getByRole('button',{name:'保存并连接',exact:true}).click();
 await page.locator('.ws-item').filter({hasText:'review-test'}).waitFor();assert.equal(await page.locator('#topbar .ws-title').textContent(),'review-test');await page.locator('.node-text').filter({hasText:'UI migration fixture'}).waitFor();steps.push('Authenticated workspace and stored nodes loaded');
 await page.getByRole('button',{name:'+ 记录',exact:true}).click();await page.getByPlaceholder('task_id（如 build-login）').fill('ui-click-task');await page.getByPlaceholder('摘要（如：回调修复 80%，待联调）').fill('UI点击写入闭环成功');
 await page.getByRole('button',{name:'写入进度',exact:true}).click();await page.locator('.node-text').filter({hasText:'UI点击写入闭环成功'}).waitFor();steps.push('Real click wrote progress and refreshed frontend');
 await page.getByRole('button',{name:'+ 记录',exact:true}).click();await page.getByPlaceholder('run_id（如 r1）').fill('ui-click-run');await page.getByPlaceholder('做了什么（如：远程复核日志，确认无异常）').fill('真实点击追加轨迹');await page.getByRole('button',{name:'追加轨迹',exact:true}).click();
 await page.getByRole('button',{name:'轨迹',exact:true}).click();await page.locator('.trail-action').filter({hasText:'真实点击追加轨迹'}).waitFor();steps.push('Trail click persisted and rendered');
 await page.getByRole('button',{name:'激活',exact:true}).first().click();await page.getByPlaceholder('激活查询词（如：登录 OAuth 进度）').fill('UI点击');await page.getByPlaceholder('激活查询词（如：登录 OAuth 进度）').press('Enter');await page.locator('.activate-result .act-head').waitFor();steps.push('Keyboard submit reached real activation service');
 await page.getByRole('button',{name:'统计',exact:true}).click();await page.locator('.stat-cards').waitFor();assert.ok((await page.locator('.stat-value').allTextContents()).some(x=>Number(x)>=3));
 await page.getByRole('button',{name:'节点',exact:true}).click();await page.getByPlaceholder('搜索 text / key / agent / task…').fill('UI点击写入');await page.locator('.node-card').filter({hasText:'UI点击写入闭环成功'}).waitFor();
 await page.reload();await page.locator('.node-text').filter({hasText:'UI点击写入闭环成功'}).waitFor();steps.push('Reload preserved progress through backend storage');
 const stored=MemoryNet.open(workspace,{agentId:'ui-verifier',role:'host',workspaceId:'review-test'});
 try{const pkg=stored.exportPkg();assert.ok(JSON.stringify(pkg).includes('UI点击写入闭环成功'));assert.ok(JSON.stringify(pkg).includes('真实点击追加轨迹'));}finally{stored.close();}
 // ---- M3 候选审核真实点击闭环：查看 → 核验证据 → accept → 落盘 → 刷新回读 ----
 await page.getByRole('button',{name:'候选',exact:true}).click();
 await page.locator('.node-card.cand-state-pending').filter({hasText:'schema 校验结果稳定'}).waitFor();
 steps.push('Candidates tab listed pending candidate');
 await page.locator('.node-card.cand-state-pending').filter({hasText:'schema 校验结果稳定'}).click();
 await page.locator('.candidate-detail h4').filter({hasText:'原依据'}).waitFor();
 await page.locator('.candidate-detail .diff-box').waitFor();
 const diffAddedCount=await page.locator('.candidate-detail .diff-added').count();
 assert.ok(diffAddedCount>0,'Diff increments rendered');
 const evidenceItems=await page.locator('.evidence-item').allTextContents();
 assert.ok(evidenceItems.some(x=>x.includes('独立复核')),'Independent verification evidence listed');
 steps.push('Candidate detail shows sources, diff and evidence pool');
 await page.getByPlaceholder('审核者（如 ops-alice）').fill('ui-reviewer');
 await page.getByPlaceholder('核验说明（必填）').fill('UI 点击核验：独立观测确认');
 await page.locator('.evidence-item input[type=checkbox]').first().check();
 await page.getByRole('button',{name:'接受 (accept)'}).click();
 await page.locator('.node-card.cand-state-accepted').filter({hasText:'schema 校验结果稳定'}).waitFor();
 steps.push('Real accept click persisted reviewed state and refreshed list');
 // CAS 失败回读：用过期指纹直接打 API（真实 HTTP，不经 UI 剧本）
 {
  const listResp=await fetch(url+'/v1/ws/review-test/candidates?status=accepted',{headers:{Authorization:'Bearer '+token}});
  const listJson=await listResp.json();
  const accepted=listJson.candidates.find(c=>c.text.includes('schema 校验结果稳定'));
  assert.ok(accepted&&accepted.state==='accepted','Accepted candidate visible via API');
  const conflictResp=await fetch(url+'/v1/ws/review-test/candidates/review',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({id:accepted.id,expected_fingerprint:'0'.repeat(64),decision:'reject',reviewer:'stale-attacker',note:'stale fingerprint must be refused',evidence:[]})});
  assert.equal(conflictResp.status,409,'Stale fingerprint review must 409');
  const conflictJson=await conflictResp.json();
  assert.ok(conflictJson.candidate&&conflictJson.candidate.fingerprint===accepted.fingerprint,'409 carries fresh candidate read-back');
  steps.push('CAS conflict returned 409 with fresh candidate read-back');
 }
 // 落盘验证：重新开库读候选元数据（审核收据 + 独立核验证据）
 {
  const stored=MemoryNet.open(workspace,{agentId:'ui-verifier',role:'host',workspaceId:'review-test'});
  try{
   const accepted=stored.candidates({status:'accepted',limit:10}).find(c=>c.text.includes('schema 校验结果稳定'));
   assert.ok(accepted,'Accepted candidate persisted');
   const meta=JSON.parse(JSON.stringify(accepted.payload)).memory_candidate;
   assert.equal(meta.state,'accepted');
   assert.equal(meta.review.request.reviewer,'ui-reviewer');
   assert.equal(meta.review.request.decision,'accept');
   assert.ok(meta.review.request.evidence.length>=1,'Independent review evidence persisted');
   assert.equal(accepted.status,'promoted');
  }finally{stored.close();}
  steps.push('Review receipt with independent evidence verified in SQLite');
 }
 await page.screenshot({path:path.join(evidence,'console-click.png'),fullPage:true});assert.deepEqual(errors,[]);
 const report={status:'PASS',browser:'Installed Edge, isolated headless context',steps,page_errors:errors,scope:'Actual UI clicks/keyboard -> HTTP service -> SQLite -> refreshed UI; not exhaustive UI accessibility or all-platform coverage.'};
 await fs.writeFile(path.join(evidence,'console-click.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
} finally {if(browser)await browser.close();if(handle)handle.close();await fs.rm(home,{recursive:true,force:true});}
