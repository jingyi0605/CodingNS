import type Database from "better-sqlite3";

import type { AuthUser } from "../../types/domain.js";

export class AuthUserRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: AuthUser): void {
    this.db
      .prepare(
        `INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.username,
        record.passwordHash,
        record.role,
        record.createdAt,
        record.updatedAt
      );
  }

  findByUsername(username: string): AuthUser | null {
    const row = this.db
      .prepare(
        `SELECT id, username, password_hash, role, created_at, updated_at
         FROM auth_users
         WHERE username = ?`
      )
      .get(username) as
      | {
          id: string;
          username: string;
          password_hash: string;
          role: "admin";
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  findById(id: string): AuthUser | null {
    const row = this.db
      .prepare(
        `SELECT id, username, password_hash, role, created_at, updated_at
         FROM auth_users
         WHERE id = ?`
      )
      .get(id) as
      | {
          id: string;
          username: string;
          password_hash: string;
          role: "admin";
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(1) AS count FROM auth_users").get() as { count: number };
    return row.count;
  }
}
