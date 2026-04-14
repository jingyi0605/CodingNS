import type Database from "better-sqlite3";

import type { SkillTargetBindingRecord, SkillTargetCli } from "../../types/domain.js";

export class SkillTargetBindingRepository {
  constructor(private readonly db: Database.Database) {}

  findBySkillAndTarget(skillId: string, targetCli: SkillTargetCli): SkillTargetBindingRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           skill_id,
           target_cli,
           enabled,
           sync_status,
           last_synced_at,
           last_error_code,
           last_error_detail
         FROM skill_target_bindings
         WHERE skill_id = ?
           AND target_cli = ?`
      )
      .get(skillId, targetCli) as SkillTargetBindingRow | undefined;

    return row ? mapSkillTargetBindingRow(row) : null;
  }

  listBySkillId(skillId: string): SkillTargetBindingRecord[] {
    return this.db
      .prepare(
        `SELECT
           skill_id,
           target_cli,
           enabled,
           sync_status,
           last_synced_at,
           last_error_code,
           last_error_detail
         FROM skill_target_bindings
         WHERE skill_id = ?
         ORDER BY target_cli ASC`
      )
      .all(skillId)
      .map((row) => mapSkillTargetBindingRow(row as SkillTargetBindingRow));
  }

  upsert(record: SkillTargetBindingRecord): SkillTargetBindingRecord {
    this.db
      .prepare(
        `INSERT INTO skill_target_bindings (
           skill_id,
           target_cli,
           enabled,
           sync_status,
           last_synced_at,
           last_error_code,
           last_error_detail
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(skill_id, target_cli) DO UPDATE SET
           enabled = excluded.enabled,
           sync_status = excluded.sync_status,
           last_synced_at = excluded.last_synced_at,
           last_error_code = excluded.last_error_code,
           last_error_detail = excluded.last_error_detail`
      )
      .run(
        record.skillId,
        record.targetCli,
        record.enabled ? 1 : 0,
        record.syncStatus,
        record.lastSyncedAt,
        record.lastErrorCode,
        record.lastErrorDetail
      );

    return record;
  }

  deleteBySkillId(skillId: string): number {
    const result = this.db
      .prepare(
        `DELETE FROM skill_target_bindings
         WHERE skill_id = ?`
      )
      .run(skillId);

    return result.changes;
  }
}

interface SkillTargetBindingRow {
  skill_id: string;
  target_cli: SkillTargetBindingRecord["targetCli"];
  enabled: number;
  sync_status: SkillTargetBindingRecord["syncStatus"];
  last_synced_at: string | null;
  last_error_code: string | null;
  last_error_detail: string | null;
}

function mapSkillTargetBindingRow(row: SkillTargetBindingRow): SkillTargetBindingRecord {
  return {
    skillId: row.skill_id,
    targetCli: row.target_cli,
    enabled: row.enabled === 1,
    syncStatus: row.sync_status,
    lastSyncedAt: row.last_synced_at,
    lastErrorCode: row.last_error_code,
    lastErrorDetail: row.last_error_detail
  };
}
