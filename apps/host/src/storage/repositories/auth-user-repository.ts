import type Database from "better-sqlite3";

import type { AuthUser } from "../../types/domain.js";

export class AuthUserRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: AuthUser): void {
    this.db
      .prepare(
        `INSERT INTO auth_users (id, username, password_hash, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.username,
        record.passwordHash,
        record.role,
        record.status,
        record.createdAt,
        record.updatedAt
      );
  }

  list(): AuthUser[] {
    return this.db
      .prepare(
        `SELECT id, username, password_hash, role, status, created_at, updated_at
         FROM auth_users
         ORDER BY created_at ASC, username ASC`
      )
      .all()
      .map((row) => mapAuthUserRow(row as AuthUserRow));
  }

  findByUsername(username: string): AuthUser | null {
    const row = this.db
      .prepare(
        `SELECT id, username, password_hash, role, status, created_at, updated_at
         FROM auth_users
         WHERE username = ?`
      )
      .get(username) as AuthUserRow | undefined;

    return row ? mapAuthUserRow(row) : null;
  }

  findById(id: string): AuthUser | null {
    const row = this.db
      .prepare(
        `SELECT id, username, password_hash, role, status, created_at, updated_at
         FROM auth_users
         WHERE id = ?`
      )
      .get(id) as AuthUserRow | undefined;

    return row ? mapAuthUserRow(row) : null;
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(1) AS count FROM auth_users").get() as { count: number };
    return row.count;
  }

  listIds(): string[] {
    return this.db
      .prepare(
        `SELECT id
         FROM auth_users
         ORDER BY created_at ASC`
      )
      .all()
      .map((row) => (row as { id: string }).id);
  }

  updateStatus(id: string, status: AuthUser["status"], updatedAt: string): AuthUser | null {
    this.db
      .prepare(
        `UPDATE auth_users
         SET status = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(status, updatedAt, id);

    return this.findById(id);
  }

  updateProfile(input: {
    id: string;
    username: string;
    passwordHash: string | null;
    updatedAt: string;
  }): AuthUser | null {
    if (input.passwordHash) {
      this.db
        .prepare(
          `UPDATE auth_users
           SET username = ?,
               password_hash = ?,
               updated_at = ?
           WHERE id = ?`
        )
        .run(input.username, input.passwordHash, input.updatedAt, input.id);
    } else {
      this.db
        .prepare(
          `UPDATE auth_users
           SET username = ?,
               updated_at = ?
           WHERE id = ?`
        )
        .run(input.username, input.updatedAt, input.id);
    }

    return this.findById(input.id);
  }

  deleteById(id: string): boolean {
    const result = this.db.prepare("DELETE FROM auth_users WHERE id = ?").run(id);
    return result.changes > 0;
  }

  hasBlockingDataForDelete(userId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT
           (SELECT COUNT(1) FROM workspaces WHERE owner_user_id = ?) +
           (SELECT COUNT(1) FROM session_bindings WHERE user_id = ?) +
           (SELECT COUNT(1) FROM auth_tokens WHERE user_id = ?) +
           (SELECT COUNT(1) FROM auth_devices WHERE user_id = ?) +
           (SELECT COUNT(1) FROM auth_device_sessions WHERE user_id = ?) +
           (SELECT COUNT(1) FROM auth_login_events WHERE user_id = ?) +
           (SELECT COUNT(1) FROM butler_profiles WHERE user_id = ?) +
           (SELECT COUNT(1) FROM butler_projects WHERE user_id = ?) +
           (SELECT COUNT(1) FROM butler_sessions WHERE user_id = ?) +
           (SELECT COUNT(1) FROM butler_control_sessions WHERE user_id = ?) AS count`
      )
      .get(
        userId,
        userId,
        userId,
        userId,
        userId,
        userId,
        userId,
        userId,
        userId,
        userId
      ) as { count: number };

    return row.count > 0;
  }

  getUsageSnapshot(period: AuthUserUsagePeriod): AuthUserUsageSnapshot {
    const bucketSql = getUsageBucketSql(period);
    const users = this.list().map((user) => ({
      user: toAuthUserUsageUser(user),
      sessionCount: 0,
      tokenTotals: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      },
      tokenUsageAvailable: false,
      timeline: [] as AuthUserUsageBucket[],
      modelUsage: [] as AuthUserUsageItem[],
      cliProviderUsage: [] as AuthUserUsageItem[],
      modelProviderUsage: [] as AuthUserUsageItem[]
    }));
    const byUserId = new Map(users.map((item) => [item.user.userId, item]));

    for (const row of this.db
      .prepare(
        `SELECT user_id, COUNT(1) AS count
         FROM session_bindings
         WHERE user_id IS NOT NULL
         GROUP BY user_id`
      )
      .all() as Array<{ user_id: string; count: number }>) {
      const item = byUserId.get(row.user_id);
      if (item) {
        item.sessionCount = row.count;
      }
    }

    for (const row of this.db
      .prepare(
        `SELECT user_id, ${bucketSql} AS bucket, COUNT(1) AS session_count
         FROM session_bindings
         WHERE user_id IS NOT NULL
         GROUP BY user_id, bucket
         ORDER BY bucket ASC`
      )
      .all() as Array<{ user_id: string; bucket: string | null; session_count: number }>) {
      const item = byUserId.get(row.user_id);
      if (item && row.bucket) {
        item.timeline.push({
          bucket: row.bucket,
          sessionCount: row.session_count,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0
        });
      }
    }

    for (const row of this.listGroupedUsageRows(
      `SELECT user_id, provider AS label, COUNT(1) AS count
       FROM session_bindings
       WHERE user_id IS NOT NULL
       GROUP BY user_id, provider`
    )) {
      byUserId.get(row.userId)?.cliProviderUsage.push(toUsageItem(row));
    }

    for (const row of this.listGroupedUsageRows(
      `SELECT user_id, model AS label, COUNT(1) AS count
       FROM butler_control_sessions
       WHERE user_id IS NOT NULL AND model IS NOT NULL AND TRIM(model) <> ''
       GROUP BY user_id, model`
    )) {
      byUserId.get(row.userId)?.modelUsage.push(toUsageItem(row));
    }

    for (const row of this.listGroupedUsageRows(
      `SELECT sb.user_id AS user_id, psm.model AS label, COUNT(1) AS count
       FROM parallel_session_members psm
       INNER JOIN session_bindings sb ON sb.session_id = psm.session_id
       WHERE sb.user_id IS NOT NULL AND psm.model IS NOT NULL AND TRIM(psm.model) <> ''
       GROUP BY sb.user_id, psm.model`
    )) {
      appendUsageItem(byUserId.get(row.userId)?.modelUsage, row);
    }

    for (const item of users) {
      item.modelUsage.sort(sortUsageItem);
      item.cliProviderUsage.sort(sortUsageItem);
      item.modelProviderUsage.sort(sortUsageItem);
    }

    return {
      period,
      tokenUsageAvailable: false,
      users
    };
  }

  private listGroupedUsageRows(sql: string): GroupedUsageRow[] {
    return (this.db.prepare(sql).all() as Array<{ user_id: string; label: string | null; count: number }>)
      .map((row) => ({
        userId: row.user_id,
        label: row.label?.trim() || "unknown",
        count: row.count
      }));
  }
}

export type AuthUserUsagePeriod = "day" | "week" | "month";

export interface AuthUserUsageSnapshot {
  period: AuthUserUsagePeriod;
  tokenUsageAvailable: boolean;
  users: AuthUserUsageUserSnapshot[];
}

export interface AuthUserUsageUserSnapshot {
  user: {
    userId: string;
    username: string;
    status: AuthUser["status"];
  };
  sessionCount: number;
  tokenTotals: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  tokenUsageAvailable: boolean;
  timeline: AuthUserUsageBucket[];
  modelUsage: AuthUserUsageItem[];
  cliProviderUsage: AuthUserUsageItem[];
  modelProviderUsage: AuthUserUsageItem[];
}

export interface AuthUserUsageBucket {
  bucket: string;
  sessionCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AuthUserUsageItem {
  label: string;
  count: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface GroupedUsageRow {
  userId: string;
  label: string;
  count: number;
}

function getUsageBucketSql(period: AuthUserUsagePeriod): string {
  if (period === "week") {
    return "strftime('%Y-W%W', created_at)";
  }

  if (period === "month") {
    return "substr(created_at, 1, 7)";
  }

  return "substr(created_at, 1, 10)";
}

function toAuthUserUsageUser(user: AuthUser): AuthUserUsageUserSnapshot["user"] {
  return {
    userId: user.id,
    username: user.username,
    status: user.status
  };
}

function toUsageItem(row: GroupedUsageRow): AuthUserUsageItem {
  return {
    label: row.label,
    count: row.count,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };
}

function appendUsageItem(target: AuthUserUsageItem[] | undefined, row: GroupedUsageRow): void {
  if (!target) {
    return;
  }

  const existing = target.find((item) => item.label === row.label);
  if (existing) {
    existing.count += row.count;
    return;
  }

  target.push(toUsageItem(row));
}

function sortUsageItem(left: AuthUserUsageItem, right: AuthUserUsageItem): number {
  return right.count - left.count || left.label.localeCompare(right.label);
}

interface AuthUserRow {
  id: string;
  username: string;
  password_hash: string;
  role: "admin";
  status: "active" | "disabled" | null;
  created_at: string;
  updated_at: string;
}

function mapAuthUserRow(row: AuthUserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status === "disabled" ? "disabled" : "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
