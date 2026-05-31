import type { RuntimeConfig } from "../../../contracts/src/index.js";
import { runCatalogMigrations } from "./migration-runner.js";

export interface InitCatalogResult {
  dbPath: string;
  indexDir: string;
  schemaVersion: number;
  createdAt: string;
  appliedMigrations: string[];
}

/**
 * 初始化最小 catalog schema。
 * 第二阶段改为通过 migration runner 执行，避免后续 schema 升级继续硬编码在 init 里。
 */
export function initCatalog(config: RuntimeConfig): InitCatalogResult {
  const result = runCatalogMigrations(config);
  return {
    dbPath: result.dbPath,
    indexDir: config.indexDir,
    schemaVersion: result.schemaVersion,
    createdAt: result.executedAt,
    appliedMigrations: result.appliedMigrations,
  };
}
