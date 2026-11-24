/**
 * SQLite 存储层（node:sqlite 写死，零 npm 运行时依赖）。
 *
 * 隔离模型：一个 workspace = 一个 <dir>/memory.db 文件 —— 物理隔离，
 * 随 workspace 打开/关闭挂载/卸载，关闭即不串读。
 */
import { DatabaseSync } from 'node:sqlite';
export declare const SCHEMA_VERSION = 1;
export interface OpenedDb {
    db: DatabaseSync;
    workspaceId: string;
    isNew: boolean;
}
/** 打开（或创建）workspace 数据库。dir 即 workspace 根。 */
export declare function openWorkspaceDb(dir: string, opts?: {
    workspaceId?: string;
}): OpenedDb;
export declare function metaGet(db: DatabaseSync, k: string): string | null;
export declare function metaSet(db: DatabaseSync, k: string, v: string): void;
