import test from 'node:test'
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
