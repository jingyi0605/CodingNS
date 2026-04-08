import { createRequire } from "node:module";

const runtimeRequire = createRequire(import.meta.url);

export type DatabaseSyncType = import("node:sqlite").DatabaseSync;
export type DatabaseSyncConstructor = typeof import("node:sqlite").DatabaseSync;

/**
 * 延迟加载 node:sqlite，避免仅仅导入模块时就在进程启动阶段触发实验特性警告。
 */
export function loadDatabaseSync(): DatabaseSyncConstructor {
  return (runtimeRequire("node:sqlite") as typeof import("node:sqlite")).DatabaseSync;
}
