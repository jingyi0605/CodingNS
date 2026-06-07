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
