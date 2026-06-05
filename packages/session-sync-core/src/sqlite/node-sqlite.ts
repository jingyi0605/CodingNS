import { createRequire } from "node:module";

const runtimeRequire = createRequire(import.meta.url);

interface BetterSqliteStatementLike {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): CompatibleRunResult;
}

interface BetterSqliteDatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): BetterSqliteStatementLike;
  close(): void;
}

type BetterSqliteConstructor = new (
  dbPath: string,
  options?: { readonly?: boolean }
) => BetterSqliteDatabaseLike;

interface CompatibleDatabaseOptions {
  open?: boolean;
  readOnly?: boolean;
}

interface CompatibleRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

interface CompatibleStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): CompatibleRunResult;
}

export interface DatabaseSyncType {
  exec(sql: string): void;
  prepare(sql: string): CompatibleStatement;
  close(): void;
}

export type DatabaseSyncConstructor = new (
  dbPath: string,
  options?: CompatibleDatabaseOptions
) => DatabaseSyncType;

/**
 * 返回一个兼容 node:sqlite DatabaseSync 调用形态的构造器。
 * 底层改用 better-sqlite3，避免 Host 和 helper 子进程加载实验性的 node:sqlite。
 */
export function loadDatabaseSync(): DatabaseSyncConstructor {
  const runtimeModule = runtimeRequire("better-sqlite3") as BetterSqliteConstructor | {
    default?: BetterSqliteConstructor;
  };
  const Database = (("default" in runtimeModule && runtimeModule.default) || runtimeModule) as BetterSqliteConstructor;

  return class BetterSqliteDatabaseSyncCompat implements DatabaseSyncType {
    private readonly db: BetterSqliteDatabaseLike;

    constructor(dbPath: string, options: CompatibleDatabaseOptions = {}) {
      if (options.open === false) {
        throw new Error("SESSION_SYNC_SQLITE_OPEN_FALSE_UNSUPPORTED");
      }

      this.db = new Database(dbPath, {
        readonly: Boolean(options.readOnly)
      });
    }

    exec(sql: string): void {
      this.db.exec(sql);
    }

    prepare(sql: string): CompatibleStatement {
      const statement = this.db.prepare(sql);
      return {
        all: (...params) => statement.all(...params),
        get: (...params) => statement.get(...params),
        run: (...params) => statement.run(...params)
      };
    }

    close(): void {
      this.db.close();
    }
  };
}
