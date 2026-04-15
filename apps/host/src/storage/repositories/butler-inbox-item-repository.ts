import type Database from "better-sqlite3";

import type {
  ButlerInboxAssistantState,
  ButlerInboxItem,
  ButlerInboxItemPriority,
  ButlerInboxItemStatus,
  ButlerInboxItemType
} from "../../types/domain.js";

export class ButlerInboxItemRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: ButlerInboxItem): ButlerInboxItem {
    this.db
      .prepare(
        `INSERT INTO butler_inbox_items (
           id,
           project_id,
           item_type,
           title,
           content,
           priority,
           status,
           assistant_state_json,
           created_at,
           updated_at,
           closed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.projectId,
        record.itemType,
        record.title,
        record.content,
        record.priority,
        record.status,
        JSON.stringify(record.assistantState),
        record.createdAt,
        record.updatedAt,
        record.closedAt
      );

    return record;
  }

  list(filters?: {
    projectId?: string;
    status?: ButlerInboxItemStatus;
    itemType?: ButlerInboxItemType;
  }): ButlerInboxItem[] {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters?.projectId) {
      conditions.push("project_id = ?");
      values.push(filters.projectId);
    }

    if (filters?.status) {
      conditions.push("status = ?");
      values.push(filters.status);
    }

    if (filters?.itemType) {
      conditions.push("item_type = ?");
      values.push(filters.itemType);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    return this.db
      .prepare(
        `SELECT
           id,
           project_id,
           item_type,
           title,
           content,
           priority,
           status,
           assistant_state_json,
           created_at,
           updated_at,
           closed_at
         FROM butler_inbox_items
         ${whereClause}
         ORDER BY updated_at DESC, created_at DESC`
      )
      .all(...values)
      .map((row) => mapButlerInboxItemRow(row as ButlerInboxItemRow));
  }

  findById(id: string): ButlerInboxItem | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           project_id,
           item_type,
           title,
           content,
           priority,
           status,
           assistant_state_json,
           created_at,
           updated_at,
           closed_at
         FROM butler_inbox_items
         WHERE id = ?`
      )
      .get(id) as ButlerInboxItemRow | undefined;

    return row ? mapButlerInboxItemRow(row) : null;
  }

  update(record: ButlerInboxItem): ButlerInboxItem {
    this.db
      .prepare(
        `UPDATE butler_inbox_items
         SET
           project_id = ?,
           item_type = ?,
           title = ?,
           content = ?,
           priority = ?,
           status = ?,
           assistant_state_json = ?,
           updated_at = ?,
           closed_at = ?
         WHERE id = ?`
      )
      .run(
        record.projectId,
        record.itemType,
        record.title,
        record.content,
        record.priority,
        record.status,
        JSON.stringify(record.assistantState),
        record.updatedAt,
        record.closedAt,
        record.id
      );

    return record;
  }

  delete(id: string): void {
    this.db
      .prepare("DELETE FROM butler_inbox_items WHERE id = ?")
      .run(id);
  }
}

interface ButlerInboxItemRow {
  id: string;
  project_id: string;
  item_type: ButlerInboxItemType;
  title: string;
  content: string;
  priority: ButlerInboxItemPriority;
  status: ButlerInboxItemStatus;
  assistant_state_json: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

function mapButlerInboxItemRow(row: ButlerInboxItemRow): ButlerInboxItem {
  return {
    id: row.id,
    projectId: row.project_id,
    itemType: row.item_type,
    title: row.title,
    content: row.content,
    priority: row.priority,
    status: row.status,
    assistantState: parseAssistantState(row.assistant_state_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at
  };
}

function parseAssistantState(value: string | null | undefined): ButlerInboxAssistantState {
  if (!value?.trim()) {
    return createDefaultAssistantState();
  }

  try {
    const parsed = JSON.parse(value) as Partial<ButlerInboxAssistantState>;

    return {
      lifecycleStage: parsed.lifecycleStage ?? "pending",
      analysisSummary: normalizeNullableText(parsed.analysisSummary),
      generatedPrompt: normalizeNullableText(parsed.generatedPrompt),
      analysisControlSessionId: normalizeNullableText(parsed.analysisControlSessionId),
      analysisSessionId: normalizeNullableText(parsed.analysisSessionId),
      linkedButlerSessionId: normalizeNullableText(parsed.linkedButlerSessionId),
      linkedSessionId: normalizeNullableText(parsed.linkedSessionId),
      linkedFollowUpTaskId: normalizeNullableText(parsed.linkedFollowUpTaskId),
      lastError: normalizeNullableText(parsed.lastError),
      lastAnalyzedAt: normalizeNullableText(parsed.lastAnalyzedAt),
      lastSessionCreatedAt: normalizeNullableText(parsed.lastSessionCreatedAt),
      lastFollowUpAt: normalizeNullableText(parsed.lastFollowUpAt)
    };
  } catch {
    return createDefaultAssistantState();
  }
}

function createDefaultAssistantState(): ButlerInboxAssistantState {
  return {
    lifecycleStage: "pending",
    analysisSummary: null,
    generatedPrompt: null,
    analysisControlSessionId: null,
    analysisSessionId: null,
    linkedButlerSessionId: null,
    linkedSessionId: null,
    linkedFollowUpTaskId: null,
    lastError: null,
    lastAnalyzedAt: null,
    lastSessionCreatedAt: null,
    lastFollowUpAt: null
  };
}

function normalizeNullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
