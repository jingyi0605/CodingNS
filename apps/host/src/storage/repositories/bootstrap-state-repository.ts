import type Database from "better-sqlite3";

import type { BootstrapState } from "../../types/domain.js";

export class BootstrapStateRepository {
  constructor(private readonly db: Database.Database) {}

  getState(): BootstrapState {
    const row = this.db
      .prepare(
        `SELECT id, initialized, initialized_at, initialized_by_user_id
         FROM bootstrap_state
         WHERE id = 'default'`
      )
      .get() as
      | {
          id: "default";
          initialized: number;
          initialized_at: string | null;
          initialized_by_user_id: string | null;
        }
      | undefined;

    return {
      id: "default",
      initialized: Boolean(row?.initialized),
      initializedAt: row?.initialized_at ?? null,
      initializedByUserId: row?.initialized_by_user_id ?? null
    };
  }

  markInitialized(initializedAt: string, initializedByUserId: string): void {
    this.db
      .prepare(
        `UPDATE bootstrap_state
         SET initialized = 1,
             initialized_at = ?,
             initialized_by_user_id = ?
         WHERE id = 'default'`
      )
      .run(initializedAt, initializedByUserId);
  }
}
