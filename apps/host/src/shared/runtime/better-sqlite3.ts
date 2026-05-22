import { createRequire } from "node:module";

import type BetterSqlite from "better-sqlite3";

const runtimeRequire = createRequire(import.meta.url);

const runtimePackageName = resolveBetterSqliteRuntimePackageName();
type BetterSqliteConstructor = typeof BetterSqlite;

const runtimeModule = runtimeRequire(runtimePackageName) as BetterSqliteConstructor | {
  default?: BetterSqliteConstructor;
};

const Database = (("default" in runtimeModule && runtimeModule.default) || runtimeModule) as BetterSqliteConstructor;

export type BetterSqliteDatabase = InstanceType<BetterSqliteConstructor>;
export default Database;

function resolveBetterSqliteRuntimePackageName(): string {
  if (
    process.platform === "win32"
    && process.arch === "x64"
    && Number((process.versions.node || "").split(".")[0]) === 22
  ) {
    return "@codingns/better-sqlite3-win32-x64-node22";
  }

  return "better-sqlite3";
}
