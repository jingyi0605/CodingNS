import type { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { openDatabase } from "../sqlite/open-database.js";

export interface ParserSkipRecordInput {
  adapter: string;
  reasonCode: string;
  extension: string;
  path: string;
  message: string;
  observedAt: string;
}

export interface ParserSkipCatalogRecord {
  skipKey: string;
  adapter: string;
  reasonCode: string;
  extension: string;
  samplePaths: string[];
  sampleCount: number;
  totalCount: number;
  lastMessage: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastRunAt: string;
}

function makeSkipKey(adapter: string, reasonCode: string, extension: string): string {
  const digest = crypto.createHash("sha1").update(`${adapter}:${reasonCode}:${extension}`).digest("hex").slice(0, 16);
  return `skip_${digest}`;
}

function normalizeSamplePaths(raw: string, candidatePath?: string, limit = 20): string[] {
  let values: string[] = [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      values = parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    }
  } catch {
    values = [];
  }

  if (candidatePath && !values.includes(candidatePath)) {
    values.push(candidatePath);
  }

  return values.slice(0, limit);
}

/**
 * 复杂文档 skip 聚合目录。
 * 只保存聚合信息，不为每个复杂文档重复生成重失败记录。
 */
export class ParserSkipRepository {
  private activeDb: DatabaseSync | null = null;
  private selectStatement: ReturnType<DatabaseSync["prepare"]> | null = null;
  private upsertStatement: ReturnType<DatabaseSync["prepare"]> | null = null;

  constructor(private readonly dbPath: string) {}

  beginSession(): void {
    if (this.activeDb) {
      return;
    }
    this.activeDb = openDatabase(this.dbPath);
    this.selectStatement = this.activeDb.prepare(`
      SELECT sample_paths_json, sample_count, total_count, first_seen_at
      FROM parser_skip_catalog
      WHERE skip_key = ?
    `);
    this.upsertStatement = this.activeDb.prepare(`
      INSERT INTO parser_skip_catalog(
        skip_key, adapter, reason_code, extension, sample_paths_json, sample_count, total_count, last_message, first_seen_at, last_seen_at, last_run_at
      )
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(skip_key) DO UPDATE SET
        sample_paths_json = excluded.sample_paths_json,
        sample_count = excluded.sample_count,
        total_count = excluded.total_count,
        last_message = excluded.last_message,
        last_seen_at = excluded.last_seen_at,
        last_run_at = excluded.last_run_at
    `);
  }

  endSession(): void {
    if (!this.activeDb) {
      return;
    }
    this.activeDb.close();
    this.activeDb = null;
    this.selectStatement = null;
    this.upsertStatement = null;
  }

  private withDatabase<T>(handler: (
    db: DatabaseSync,
    selectStatement: ReturnType<DatabaseSync["prepare"]>,
    upsertStatement: ReturnType<DatabaseSync["prepare"]>,
  ) => T): T {
    if (this.activeDb && this.selectStatement && this.upsertStatement) {
      return handler(this.activeDb, this.selectStatement, this.upsertStatement);
    }

    const db = openDatabase(this.dbPath);
    const selectStatement = db.prepare(`
      SELECT sample_paths_json, sample_count, total_count, first_seen_at
      FROM parser_skip_catalog
      WHERE skip_key = ?
    `);
    const upsertStatement = db.prepare(`
      INSERT INTO parser_skip_catalog(
        skip_key, adapter, reason_code, extension, sample_paths_json, sample_count, total_count, last_message, first_seen_at, last_seen_at, last_run_at
      )
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(skip_key) DO UPDATE SET
        sample_paths_json = excluded.sample_paths_json,
        sample_count = excluded.sample_count,
        total_count = excluded.total_count,
        last_message = excluded.last_message,
        last_seen_at = excluded.last_seen_at,
        last_run_at = excluded.last_run_at
    `);

    try {
      return handler(db, selectStatement, upsertStatement);
    } finally {
      db.close();
    }
  }

  record(input: ParserSkipRecordInput): ParserSkipCatalogRecord {
    const skipKey = makeSkipKey(input.adapter, input.reasonCode, input.extension);
    return this.withDatabase((db, selectStatement, upsertStatement) => {
      const ownsTransaction = !this.activeDb;
      try {
        if (ownsTransaction) {
          db.exec("BEGIN IMMEDIATE");
        }

        const existing = selectStatement.get(skipKey) as {
          sample_paths_json?: string;
          sample_count?: number;
          total_count?: number;
          first_seen_at?: string;
        } | undefined;

        const samplePaths = normalizeSamplePaths(existing?.sample_paths_json ?? "[]", input.path);
        const sampleCount = samplePaths.length;
        const totalCount = (existing?.total_count ?? 0) + 1;
        const firstSeenAt = existing?.first_seen_at ?? input.observedAt;

        upsertStatement.run(
          skipKey,
          input.adapter,
          input.reasonCode,
          input.extension,
          JSON.stringify(samplePaths),
          sampleCount,
          totalCount,
          input.message,
          firstSeenAt,
          input.observedAt,
          input.observedAt,
        );

        if (ownsTransaction) {
          db.exec("COMMIT");
        }
        return {
          skipKey,
          adapter: input.adapter,
          reasonCode: input.reasonCode,
          extension: input.extension,
          samplePaths,
          sampleCount,
          totalCount,
          lastMessage: input.message,
          firstSeenAt,
          lastSeenAt: input.observedAt,
          lastRunAt: input.observedAt,
        };
      } catch (error) {
        if (ownsTransaction) {
          db.exec("ROLLBACK");
        }
        throw error;
      }
    });
  }

  listRecent(limit = 100): ParserSkipCatalogRecord[] {
    const db = openDatabase(this.dbPath);
    try {
      const rows = db.prepare(`
        SELECT skip_key, adapter, reason_code, extension, sample_paths_json, sample_count, total_count, last_message, first_seen_at, last_seen_at, last_run_at
        FROM parser_skip_catalog
        ORDER BY last_seen_at DESC, extension ASC
        LIMIT ?
      `).all(limit) as Array<Record<string, unknown>>;

      return rows.map(row => ({
        skipKey: String(row.skip_key),
        adapter: String(row.adapter),
        reasonCode: String(row.reason_code),
        extension: String(row.extension),
        samplePaths: normalizeSamplePaths(String(row.sample_paths_json ?? "[]")),
        sampleCount: Number(row.sample_count ?? 0),
        totalCount: Number(row.total_count ?? 0),
        lastMessage: row.last_message ? String(row.last_message) : null,
        firstSeenAt: String(row.first_seen_at),
        lastSeenAt: String(row.last_seen_at),
        lastRunAt: String(row.last_run_at),
      }));
    } finally {
      db.close();
    }
  }

  summarize(): {
    totalKinds: number;
    totalSkipped: number;
    byReason: Array<{
      adapter: string;
      reasonCode: string;
      extension: string;
      totalCount: number;
      lastSeenAt: string;
    }>;
  } {
    const db = openDatabase(this.dbPath);
    try {
      const summary = db.prepare(`
        SELECT COUNT(*) AS total_kinds, COALESCE(SUM(total_count), 0) AS total_skipped
        FROM parser_skip_catalog
      `).get() as { total_kinds?: number; total_skipped?: number } | undefined;

      const rows = db.prepare(`
        SELECT adapter, reason_code, extension, total_count, last_seen_at
        FROM parser_skip_catalog
        ORDER BY total_count DESC, extension ASC
      `).all() as Array<Record<string, unknown>>;

      return {
        totalKinds: Number(summary?.total_kinds ?? 0),
        totalSkipped: Number(summary?.total_skipped ?? 0),
        byReason: rows.map(row => ({
          adapter: String(row.adapter),
          reasonCode: String(row.reason_code),
          extension: String(row.extension),
          totalCount: Number(row.total_count ?? 0),
          lastSeenAt: String(row.last_seen_at),
        })),
      };
    } finally {
      db.close();
    }
  }
}
