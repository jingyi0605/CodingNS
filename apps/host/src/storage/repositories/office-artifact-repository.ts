import type Database from "better-sqlite3";

import type { OfficeArtifact, OfficeArtifactKind } from "../../types/domain.js";

export class OfficeArtifactRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: OfficeArtifact): OfficeArtifact {
    this.db
      .prepare(
        `INSERT INTO office_artifacts (
           id,
           task_id,
           step_id,
           kind,
           name,
           storage_path,
           content_type,
           metadata_json,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.taskId,
        record.stepId,
        record.kind,
        record.name,
        record.storagePath,
        record.contentType,
        record.metadataJson,
        record.createdAt
      );

    return record;
  }

  listByTaskId(taskId: string): OfficeArtifact[] {
    return this.db
      .prepare(
        `SELECT
           id,
           task_id,
           step_id,
           kind,
           name,
           storage_path,
           content_type,
           metadata_json,
           created_at
         FROM office_artifacts
         WHERE task_id = ?
         ORDER BY created_at ASC`
      )
      .all(taskId)
      .map((row) => mapOfficeArtifactRow(row as OfficeArtifactRow));
  }

  listByStepId(stepId: string): OfficeArtifact[] {
    return this.db
      .prepare(
        `SELECT
           id,
           task_id,
           step_id,
           kind,
           name,
           storage_path,
           content_type,
           metadata_json,
           created_at
         FROM office_artifacts
         WHERE step_id = ?
         ORDER BY created_at ASC`
      )
      .all(stepId)
      .map((row) => mapOfficeArtifactRow(row as OfficeArtifactRow));
  }
}

interface OfficeArtifactRow {
  id: string;
  task_id: string;
  step_id: string | null;
  kind: OfficeArtifactKind;
  name: string;
  storage_path: string | null;
  content_type: string | null;
  metadata_json: string | null;
  created_at: string;
}

function mapOfficeArtifactRow(row: OfficeArtifactRow): OfficeArtifact {
  return {
    id: row.id,
    taskId: row.task_id,
    stepId: row.step_id,
    kind: row.kind,
    name: row.name,
    storagePath: row.storage_path,
    contentType: row.content_type,
    metadataJson: row.metadata_json,
    createdAt: row.created_at
  };
}
