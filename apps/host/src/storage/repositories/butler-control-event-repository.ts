import type Database from "better-sqlite3";

import type { ButlerControlEvent, ButlerControlRelatedRef } from "../../types/domain.js";

export class ButlerControlEventRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: ButlerControlEvent): ButlerControlEvent {
    this.db
      .prepare(
        `INSERT INTO butler_control_events (
           id,
           control_session_id,
           kind,
           action_type,
           status,
           title,
           content,
           related_refs_json,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.controlSessionId,
        record.kind,
        record.actionType,
        record.status,
        record.title,
        record.content,
        JSON.stringify(record.relatedRefs),
        record.createdAt
      );

    return record;
  }

  listByControlSessionId(controlSessionId: string): ButlerControlEvent[] {
    return this.db
      .prepare(
        `SELECT
           id,
           control_session_id,
           kind,
           action_type,
           status,
           title,
           content,
           related_refs_json,
           created_at
         FROM butler_control_events
         WHERE control_session_id = ?
         ORDER BY created_at ASC`
      )
      .all(controlSessionId)
      .map((row) => mapEventRow(row as ButlerControlEventRow));
  }
}

interface ButlerControlEventRow {
  id: string;
  control_session_id: string;
  kind: ButlerControlEvent["kind"];
  action_type: ButlerControlEvent["actionType"];
  status: ButlerControlEvent["status"];
  title: string;
  content: string;
  related_refs_json: string;
  created_at: string;
}

function mapEventRow(row: ButlerControlEventRow): ButlerControlEvent {
  return {
    id: row.id,
    controlSessionId: row.control_session_id,
    kind: row.kind,
    actionType: row.action_type,
    status: row.status,
    title: row.title,
    content: row.content,
    relatedRefs: parseRelatedRefs(row.related_refs_json),
    createdAt: row.created_at
  };
}

function parseRelatedRefs(raw: string): ButlerControlRelatedRef[] {
  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isRelatedRef);
  } catch {
    return [];
  }
}

function isRelatedRef(value: unknown): value is ButlerControlRelatedRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ButlerControlRelatedRef>;
  return (
    typeof candidate.kind === "string"
    && typeof candidate.id === "string"
    && typeof candidate.label === "string"
    && (typeof candidate.routePath === "string" || candidate.routePath === null)
    && (typeof candidate.workspaceId === "string" || candidate.workspaceId === null)
    && (typeof candidate.projectId === "string" || candidate.projectId === null)
  );
}
