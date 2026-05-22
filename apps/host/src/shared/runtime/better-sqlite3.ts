import { createRequire } from "node:module";

import type BetterSqlite from "better-sqlite3";

const runtimeRequire = createRequire(import.meta.url);

type BetterSqliteConstructor = typeof BetterSqlite;

const runtimeModule = runtimeRequire("better-sqlite3") as BetterSqliteConstructor | {
  default?: BetterSqliteConstructor;
};

const Database = (("default" in runtimeModule && runtimeModule.default) || runtimeModule) as BetterSqliteConstructor;

export type BetterSqliteDatabase = InstanceType<BetterSqliteConstructor>;
export default Database;
