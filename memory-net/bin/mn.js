#!/usr/bin/env node
/** mn — memory-net CLI 入口。 */
import { runCli } from '../dist/src/cli.js'

runCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code
}).catch((e) => {
  console.error('✗ 未预期异常:', e?.message ?? e)
  process.exitCode = 1
})
