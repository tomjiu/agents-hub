import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryNet } from '../../../src/store.js'
import { buildObservation, installAutoObserve } from '../src/bridge.js'
import { resolveConfig } from '../src/config.js'

test('different and identical repeated calls retain independent evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'mn-p0-observe-'))
  const cfg = resolveConfig({context:{mode:'shared'},workspaces_root: root, default_workspace: 'main'})
  const net = MemoryNet.open(join(root, 'main'), {agentId: 'fixture-host', role: 'host'})
  let listener: ((...args: unknown[]) => void) | undefined
  try {
    installAutoObserve({on: (_event, fn) => {listener = fn}}, cfg, () => net,
      {warn: message => {throw new Error(message)}})
    listener!({name:'read',callId:'call-A',arguments:{file_path:'A.ts'}}, {value:'evidence A'})
    const a = net.exportPkg().nodes.find(n => n.payload.call_id === 'call-A')!
    const decision = net.add('inference', {text:'decision about A',confidence:.9,based_on:[a.id]})
    listener!({name:'read',callId:'call-B',arguments:{file_path:'B.ts'}}, {value:'unrelated B'})
    listener!({name:'read',callId:'call-A-again',arguments:{file_path:'A.ts'}}, {value:'evidence A'})
    const observations = net.exportPkg().nodes.filter(n => n.kind === 'observation')
    assert.equal(observations.length,3)
    assert.ok(observations.every(n => n.key === null && n.status === 'active'))
    assert.equal(net.get(decision.id)!.status,'active')
    assert.equal(net.get(a.id)!.text,a.text)
    assert.equal(buildObservation(cfg.auto_observe,{name:'memory_net_write'},{}),null)
  } finally {net.close();rmSync(root,{recursive:true,force:true})}
})
