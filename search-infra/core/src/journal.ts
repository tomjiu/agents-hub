/**
 * journal.jsonl 运行日志 (v0-spec §4.5, Trae[06] journal 断点恢复思想的 v0.1 观测版)
 * 每个 run 一个文件: data/journal/<ts>-<runid>.jsonl
 * 事件: run_start / planner / engine_result / engine_error / fusion / fetch / run_end
 * 保留最近 50 个 run,超出滚动清理。
 */
import { mkdirSync, appendFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const KEEP_RUNS = 50;

export class Journal {
  readonly path: string | null;
  #dir: string;

  constructor(dataDir: string, enabled = true) {
    this.#dir = join(dataDir, "journal");
    if (!enabled) {
      this.path = null;
      return;
    }
    try {
      mkdirSync(this.#dir, { recursive: true });
      this.path = join(this.#dir, `${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`);
      this.write("run_start", {});
    } catch {
      this.path = null; // 日志失败不影响主链路
    }
    this.#gc();
  }

  write(event: string, data: Record<string, unknown>): void {
    if (!this.path) return;
    try {
      appendFileSync(this.path, JSON.stringify({ ts: Date.now(), event, ...data }) + "\n");
    } catch {
      /* ignore */
    }
  }

  #gc(): void {
    try {
      const files = readdirSync(this.#dir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => join(this.#dir, f))
        .sort();
      while (files.length > KEEP_RUNS) {
        const victim = files.shift()!;
        try {
          if (statSync(victim).isFile()) unlinkSync(victim);
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
}
