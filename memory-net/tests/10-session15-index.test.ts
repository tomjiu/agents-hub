/**
 * 会话 15 修复锁定（console P3-5 上游半）：
 * - idx_nodes_updated 落库：读面默认序 ORDER BY updated_at DESC, seq DESC
 *   经反向索引扫描满足（旧实现全表 + 排序，成本随每次请求重复付）
 * - 老库升级路径：IF NOT EXISTS 幂等，旧 workspace 打开即补索引
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { MemoryNet } from '../src/store.js'
import { makeTempWs, cleanupDir } from './helpers.js'

test('P3-5u: idx_nodes_updated 存在且默认排序走索引（反向扫描）', () => {
  const ws = makeTempWs('mn-idx-')
  try {
    const mn = MemoryNet.open(ws, { agentId: 'a', role: 'host' })
    for (let i = 0; i < 5; i++) mn.add('observation', { key: `k${i}`, text: `观测 ${i}`, source: 'tool' })
    mn.close()

    const db = new DatabaseSync(join(ws, 'memory.db'), { readOnly: true })
    try {
      const idx = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_nodes_updated'")
        .get()
      assert.ok(idx, 'idx_nodes_updated 必须随 DDL 创建')
      const plan = db
        .prepare('EXPLAIN QUERY PLAN SELECT id FROM nodes ORDER BY updated_at DESC, seq DESC')
        .all() as Array<{ detail: string }>
      const detail = plan.map((p) => p.detail).join(' | ')
      assert.match(detail, /idx_nodes_updated/, `默认排序应命中索引，实际: ${detail}`)
    } finally {
      db.close()
    }
  } finally {
    cleanupDir(ws)
  }
})
