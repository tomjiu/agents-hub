import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { MemoryNet } from '../src/store.js'
import { makeTempWs, cleanupDir } from './helpers.js'

test('promoted inference is recalled until explicit subject evidence changes', () => {
  const ws = makeTempWs('mn-p0-promoted-')
  const net = MemoryNet.open(ws,{agentId:'fixture-host',role:'host'})
  try {
    const evidence = net.add('observation',{key:'subject:A',text:'A before',source:'tool'})
    const decision = net.add('inference',{text:'decision about A',confidence:.8,based_on:[evidence.id]})
    net.promote(decision.id,{evidence:[evidence.id]})
    assert.ok(net.activate('decision about A').nodes.some(r=>r.node.id===decision.id))
    net.add('observation',{key:'subject:A',text:'A after',source:'tool'})
    assert.equal(net.get(decision.id)!.status,'contradicted')
    assert.ok(!net.activate('decision about A').nodes.some(r=>r.node.id===decision.id))
  } finally {net.close();cleanupDir(ws)}
})

test('GC keeps transitive based-on and promotion evidence for live conclusions', () => {
  const ws=makeTempWs('mn-p0-gc-')
  const net=MemoryNet.open(ws,{agentId:'fixture-host',role:'host'})
  try {
    const a=net.add('observation',{text:'underlying A',source:'tool'})
    const b=net.add('inference',{text:'derived B',confidence:.7,based_on:[a.id]})
    const c=net.add('inference',{text:'reviewed C',confidence:.8,based_on:[b.id]})
    const extra=net.add('observation',{text:'review evidence',source:'tool'})
    const unused=net.add('tip',{text:'unreferenced obsolete tip'})
    net.promote(c.id,{evidence:[extra.id]})
    net.demote(a.id);net.demote(b.id);net.demote(extra.id);net.demote(unused.id)
    net.gc({purge:true})
    for(const n of [a,b,c,extra])assert.ok(net.get(n.id),n.id)
    assert.equal(net.get(unused.id),null)
    net.link(b.id,c.id) // cycle is tolerated by visited set, not traversed forever
    net.gc({purge:true})
    for(const n of [a,b,c,extra])assert.ok(net.get(n.id))
  } finally {net.close();cleanupDir(ws)}
})

test('GC failure rolls back prior trail compression and node changes', () => {
  const ws=makeTempWs('mn-p0-gc-atomic-')
  const net=MemoryNet.open(ws,{agentId:'fixture-host',role:'host'})
  const db=new DatabaseSync(join(ws,'memory.db'))
  try {
    const obsolete=net.add('tip',{text:'obsolete'})
    net.demote(obsolete.id)
    for(let i=1;i<=8;i++)net.appendTrail('run',{action:'step-'+i})
    const before=net.exportPkg()
    db.exec("CREATE TRIGGER fail_gc_delete BEFORE DELETE ON nodes BEGIN SELECT RAISE(ABORT,'fixture gc failure'); END;")
    assert.throws(()=>net.gc({trail_keep:4,purge:true}),/fixture gc failure/)
    const after=net.exportPkg()
    assert.deepEqual(after.trail,before.trail)
    assert.deepEqual(after.nodes,before.nodes)
  } finally {db.exec('DROP TRIGGER IF EXISTS fail_gc_delete');db.close();net.close();cleanupDir(ws)}
})

test('protected evidence survives package roundtrip', () => {
  const source=makeTempWs('mn-p0-export-'),target=makeTempWs('mn-p0-import-')
  const net=MemoryNet.open(source,{agentId:'fixture-host',role:'host'})
  let reopened: MemoryNet | undefined
  try {
    const a=net.add('observation',{text:'A',source:'tool'})
    const d=net.add('inference',{text:'decision',confidence:.9,based_on:[a.id]})
    net.promote(d.id,{evidence:[a.id]});net.demote(a.id);net.gc({purge:true})
    reopened=MemoryNet.importPkg(net.exportPkg(),target,{agentId:'fixture-reader',role:'host'})
    assert.equal(reopened.get(d.id)!.based_on[0],a.id)
    assert.equal(reopened.get(a.id)!.text,'A')
    assert.ok(reopened.activate('decision').nodes.some(r=>r.node.id===d.id))
  } finally {reopened?.close();net.close();cleanupDir(source);cleanupDir(target)}
})

test('GC cannot partially change a workspace while another writer owns the lock', () => {
  const ws = makeTempWs('mn-p0-lock-')
  const net = MemoryNet.open(ws, {agentId:'fixture-host',role:'host'})
  const blocker = new DatabaseSync(join(ws,'memory.db'))
  try {
    const obsolete = net.add('tip',{text:'obsolete'})
    net.demote(obsolete.id)
    for (let i=1;i<=8;i++) net.appendTrail('run',{action:'step-'+i})
    const before = net.exportPkg()
    blocker.exec('BEGIN IMMEDIATE')
    assert.throws(() => net.gc({trail_keep:4,purge:true}), /locked|busy/i)
    const failed = net.exportPkg()
    assert.deepEqual(failed.nodes,before.nodes)
    assert.deepEqual(failed.trail,before.trail)
    blocker.exec('ROLLBACK')
    assert.equal(net.gc({trail_keep:4,purge:true}).purged,1)
    assert.equal(net.replayTrail('run').length,4)
  } finally {
    try {blocker.exec('ROLLBACK')} catch {}
    blocker.close();net.close();cleanupDir(ws)
  }
})
