import { randomUUID } from "node:crypto";

import { AppError } from "../../shared/errors/app-error.js";
import { nowIso } from "../../shared/utils/time.js";
import type { UserTeableWorkbenchSyncConfigRepository } from "../../storage/repositories/user-teable-workbench-sync-config-repository.js";
import type {
  TeableSessionMirrorScope,
  TeableSyncSourceType,
  TeableTagMirrorScope,
  TeableTodoMirrorScope,
  UserTeableWorkbenchSyncConfigRecord
} from "../../types/domain.js";

export interface TeableWorkbenchSyncConfigDto {
  configId: string;
  sourceType: TeableSyncSourceType;
  enabled: boolean;
  scope: TeableTagMirrorScope | TeableSessionMirrorScope | TeableTodoMirrorScope;
  targetTableId: string | null;
  updatedAt: string;
}

export interface SaveTeableWorkbenchSyncConfigItemInput {
  sourceType: TeableSyncSourceType;
  enabled?: boolean;
  scope?: Record<string, unknown>;
  targetTableId?: string | null;
}

const SUPPORTED_SOURCE_TYPES: TeableSyncSourceType[] = ["tags", "sessions", "todos"];

export class TeableWorkbenchSyncConfigService {
  constructor(
    private readonly repository: UserTeableWorkbenchSyncConfigRepository
  ) {}

  getConfigs(userId: string): TeableWorkbenchSyncConfigDto[] {
    const current = this.repository.listByUserId(userId);
    if (current.length === 0) {
      return buildDefaultConfigRecords(userId, nowIso()).map(mapRecordToDto);
    }
    return mergeWithDefaults(userId, current).map(mapRecordToDto);
  }

  saveConfigs(userId: string, items: SaveTeableWorkbenchSyncConfigItemInput[]): TeableWorkbenchSyncConfigDto[] {
    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        field: "items",
        detail: "至少要提交一条 Teable 镜像配置"
      });
    }

    const current = mergeWithDefaults(userId, this.repository.listByUserId(userId));
    const currentBySourceType = new Map(current.map((item) => [item.sourceType, item]));
    const touched = new Set<TeableSyncSourceType>();
    const updatedAt = nowIso();

    for (const item of items) {
      const sourceType = normalizeSourceType(item.sourceType);
      if (touched.has(sourceType)) {
        throw new AppError({
          statusCode: 400,
          errorCode: "INVALID_INPUT",
          field: "sourceType",
          detail: `sourceType=${sourceType} 在同一次请求里重复提交了`
        });
      }
      touched.add(sourceType);

      const currentRecord = currentBySourceType.get(sourceType);
      if (!currentRecord) {
        continue;
      }

      currentBySourceType.set(sourceType, {
        ...currentRecord,
        enabled: item.enabled === true,
        scopeJson: JSON.stringify(normalizeScope(sourceType, item.scope)),
        targetTableId: normalizeOptionalText(item.targetTableId),
        updatedAt
      });
    }

    const next = SUPPORTED_SOURCE_TYPES
      .map((sourceType) => currentBySourceType.get(sourceType))
      .filter((item): item is UserTeableWorkbenchSyncConfigRecord => Boolean(item));

    return this.repository.replaceAllForUser(userId, next).map(mapRecordToDto);
  }
}

function mergeWithDefaults(
  userId: string,
  current: UserTeableWorkbenchSyncConfigRecord[]
): UserTeableWorkbenchSyncConfigRecord[] {
  const currentBySourceType = new Map(current.map((item) => [item.sourceType, item]));
  const fallbackUpdatedAt = nowIso();
  return SUPPORTED_SOURCE_TYPES.map((sourceType) => currentBySourceType.get(sourceType) ?? createDefaultRecord(userId, sourceType, fallbackUpdatedAt));
}

function buildDefaultConfigRecords(userId: string, updatedAt: string): UserTeableWorkbenchSyncConfigRecord[] {
  return SUPPORTED_SOURCE_TYPES.map((sourceType) => createDefaultRecord(userId, sourceType, updatedAt));
}

function createDefaultRecord(
  userId: string,
  sourceType: TeableSyncSourceType,
  updatedAt: string
): UserTeableWorkbenchSyncConfigRecord {
  return {
    configId: `teable-sync-${sourceType}-${randomUUID()}`,
    userId,
    sourceType,
    enabled: false,
    scopeJson: JSON.stringify(defaultScopeBySourceType(sourceType)),
    targetTableId: null,
    createdAt: updatedAt,
    updatedAt
  };
}

function mapRecordToDto(record: UserTeableWorkbenchSyncConfigRecord): TeableWorkbenchSyncConfigDto {
  return {
    configId: record.configId,
    sourceType: record.sourceType,
    enabled: record.enabled,
    scope: parseScope(record.sourceType, record.scopeJson),
    targetTableId: record.targetTableId,
    updatedAt: record.updatedAt
  };
}

function parseScope(
  sourceType: TeableSyncSourceType,
  raw: string
): TeableWorkbenchSyncConfigDto["scope"] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeScope(sourceType, parsed);
  } catch {
    return defaultScopeBySourceType(sourceType);
  }
}

function normalizeScope(
  sourceType: TeableSyncSourceType,
  value: unknown
): TeableWorkbenchSyncConfigDto["scope"] {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  if (sourceType === "tags") {
    return {
      rootTagIds: normalizeStringArray(record.rootTagIds)
    } satisfies TeableTagMirrorScope;
  }

  if (sourceType === "sessions") {
    const mode = record.mode === "selected_workspaces" ? "selected_workspaces" : "all_workspaces";
    return mode === "selected_workspaces"
      ? {
          mode,
          workspaceIds: normalizeStringArray(record.workspaceIds)
        }
      : { mode };
  }

  return {
    includeWorkspaceTodos: record.includeWorkspaceTodos !== false,
    includeAffairsTodos: record.includeAffairsTodos !== false,
    workspaceIds: normalizeOptionalStringArray(record.workspaceIds)
  } satisfies TeableTodoMirrorScope;
}

function defaultScopeBySourceType(sourceType: TeableSyncSourceType): TeableWorkbenchSyncConfigDto["scope"] {
  switch (sourceType) {
    case "tags":
      return { rootTagIds: [] };
    case "sessions":
      return { mode: "all_workspaces" };
    case "todos":
      return { includeWorkspaceTodos: true, includeAffairsTodos: true, workspaceIds: [] };
    default:
      return { rootTagIds: [] };
  }
}

function normalizeSourceType(value: string): TeableSyncSourceType {
  if ((SUPPORTED_SOURCE_TYPES as string[]).includes(value)) {
    return value as TeableSyncSourceType;
  }
  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    field: "sourceType",
    detail: "sourceType 只允许 tags、sessions、todos"
  });
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)));
}

function normalizeOptionalStringArray(value: unknown): string[] | undefined {
  const normalized = normalizeStringArray(value);
  return normalized.length > 0 ? normalized : [];
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
}
