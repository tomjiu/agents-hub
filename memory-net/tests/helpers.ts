/** 测试公共辅助：临时 workspace 目录。 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function makeTempWs(prefix = 'mn-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function cleanupDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}
