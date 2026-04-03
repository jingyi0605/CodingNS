import type Database from "better-sqlite3";

import type { ProjectMemory, ProjectMemoryStatus, ProjectMemoryType } from "../../types/domain.js";

export class ProjectMemoryRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: ProjectMemory): ProjectMemory {
    this.db
      .prepare(
        `INSERT INTO project_memories (
           id,
           project_id,
           source_butler_session_id,
           source_checkpoint_id,
           memory_type,
           title,
           scope_path,
           content,
           tags_json,
           confidence,
           status,
           evidence_json,
           superseded_by,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.projectId,
        record.sourceButlerSessionId,
        record.sourceCheckpointId,
        record.memoryType,
        record.title,
        record.scopePath,
        record.content,
        JSON.stringify(record.tags),
        record.confidence,
        record.status,
        JSON.stringify(record.evidence),
        record.supersededBy,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  listByProject(
    projectId: string,
    filters?: {
      status?: ProjectMemoryStatus;
      memoryType?: ProjectMemoryType;
      scopePath?: string;
      query?: string;
    }
  ): ProjectMemory[] {
    const conditions: string[] = ["project_id = ?"];
    const values: unknown[] = [projectId];

    if (filters?.status) {
      conditions.push("status = ?");
      values.push(filters.status);
    }

    if (filters?.memoryType) {
      conditions.push("memory_type = ?");
      values.push(filters.memoryType);
    }

    if (filters?.scopePath) {
      conditions.push("scope_path LIKE ?");
      values.push(`${filters.scopePath}%`);
    }

    if (filters?.query) {
      const pattern = `%${filters.query.replace(/%/g, "\\%")}%`;
      conditions.push("(title LIKE ? OR content LIKE ?)");
      values.push(pattern, pattern);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    return this.db
      .prepare(
        `SELECT
           id,
           project_id,
           source_butler_session_id,
           source_checkpoint_id,
           memory_type,
           title,
           scope_path,
           content,
           tags_json,
           confidence,
           status,
           evidence_json,
           superseded_by,
           created_at,
           updated_at
         FROM project_memories
         ${whereClause}
         ORDER BY updated_at DESC, created_at DESC`
      )
      .all(...values)
      .map((row) => mapProjectMemoryRow(row as ProjectMemoryRow));
  }

  findById(id: string): ProjectMemory | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           project_id,
           source_butler_session_id,
           source_checkpoint_id,
           memory_type,
           title,
           scope_path,
           content,
           tags_json,
           confidence,
           status,
           evidence_json,
           superseded_by,
           created_at,
           updated_at
         FROM project_memories
         WHERE id = ?`
      )
      .get(id) as ProjectMemoryRow | undefined;

    return row ? mapProjectMemoryRow(row) : null;
  }

  update(record: ProjectMemory): ProjectMemory {
    this.db
      .prepare(
        `UPDATE project_memories
         SET
           title = ?,
           scope_path = ?,
           content = ?,
           tags_json = ?,
           confidence = ?,
           status = ?,
           evidence_json = ?,
           superseded_by = ?,
           updated_at = ?
         WHERE id = ?`
      )
      .run(
        record.title,
        record.scopePath,
        record.content,
        JSON.stringify(record.tags),
        record.confidence,
        record.status,
        JSON.stringify(record.evidence),
        record.supersededBy,
        record.updatedAt,
        record.id
      );

    return record;
  }
}

interface ProjectMemoryRow {
  id: string;
  project_id: string;
  source_butler_session_id: string | null;
  source_checkpoint_id: string | null;
  memory_type: ProjectMemoryType;
  title: string;
  scope_path: string | null;
  content: string;
  tags_json: string;
  confidence: number;
  status: ProjectMemoryStatus;
  evidence_json: string;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}

function mapProjectMemoryRow(row: ProjectMemoryRow): ProjectMemory {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceButlerSessionId: row.source_butler_session_id,
    sourceCheckpointId: row.source_checkpoint_id,
    memoryType: row.memory_type,
    title: row.title,
    scopePath: row.scope_path,
    content: row.content,
    tags: parseJsonArray(row.tags_json),
    confidence: row.confidence,
    status: row.status,
    evidence: parseJsonObject(row.evidence_json),
    supersededBy: row.superseded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
