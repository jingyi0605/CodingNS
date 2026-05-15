import type Database from "better-sqlite3";

import type { OfficeAuditEvent, OfficeAuditEventKind } from "../../types/domain.js";

export class OfficeAuditEventRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: OfficeAuditEvent): OfficeAuditEvent {
    this.db
      .prepare(
        `INSERT INTO office_audit_events (
           id,
           task_id,
           step_id,
           event_kind,
           actor_kind,
           actor_id,
           summary,
           payload_json,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.taskId,
        record.stepId,
        record.eventKind,
        record.actorKind,
        record.actorId,
        record.summary,
        record.payloadJson,
        record.createdAt
      );

    return record;
  }

  listByTaskId(taskId: string): OfficeAuditEvent[] {
    return this.db
      .prepare(
        `SELECT
           id,
           task_id,
           step_id,
           event_kind,
           actor_kind,
           actor_id,
           summary,
           payload_json,
           created_at
         FROM office_audit_events
         WHERE task_id = ?
         ORDER BY created_at ASC`
      )
      .all(taskId)
      .map((row) => mapOfficeAuditEventRow(row as OfficeAuditEventRow));
  }
}

interface OfficeAuditEventRow {
  id: string;
  task_id: string | null;
  step_id: string | null;
  event_kind: OfficeAuditEventKind;
  actor_kind: OfficeAuditEvent["actorKind"];
  actor_id: string | null;
  summary: string;
  payload_json: string | null;
  created_at: string;
}

function mapOfficeAuditEventRow(row: OfficeAuditEventRow): OfficeAuditEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    stepId: row.step_id,
    eventKind: row.event_kind,
    actorKind: row.actor_kind,
    actorId: row.actor_id,
    summary: row.summary,
    payloadJson: row.payload_json,
    createdAt: row.created_at
  };
}
