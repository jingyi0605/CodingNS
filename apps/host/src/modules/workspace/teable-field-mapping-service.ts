import { randomUUID } from "node:crypto";

import { AppError } from "../../shared/errors/app-error.js";
import { nowIso } from "../../shared/utils/time.js";
import type { UserTeableFieldMappingRepository } from "../../storage/repositories/user-teable-field-mapping-repository.js";
import type { UserTeableWorkbenchSyncConfigRepository } from "../../storage/repositories/user-teable-workbench-sync-config-repository.js";
import type { TeableFieldMappingItem, TeableSyncSourceType, UserTeableFieldMappingRecord } from "../../types/domain.js";

export interface TeableSourceFieldDefinitionDto {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "datetime";
  required: boolean;
}

export interface TeableFieldMappingDto {
  mappingId: string;
  configId: string;
  sourceType: TeableSyncSourceType;
  targetTableId: string;
  items: TeableFieldMappingItem[];
  updatedAt: string;
}

export interface SaveTeableFieldMappingInput {
  configId: string;
  sourceType: TeableSyncSourceType;
  targetTableId: string;
  items: Array<{
    sourceField: string;
    targetFieldId: string;
    targetFieldName: string;
    required?: boolean;
  }>;
}

const SOURCE_FIELDS: Record<TeableSyncSourceType, TeableSourceFieldDefinitionDto[]> = {
  tags: [
    { key: "tag_id", label: "标签 ID", type: "text", required: true },
    { key: "path", label: "标签路径", type: "text", required: true },
    { key: "name", label: "标签名称", type: "text", required: true },
    { key: "parent_id", label: "父标签 ID", type: "text", required: false },
    { key: "parent_path", label: "父标签路径", type: "text", required: false },
    { key: "root_type", label: "根类型", type: "text", required: false },
    { key: "status", label: "状态", type: "text", required: true },
    { key: "description", label: "说明", type: "text", required: false },
    { key: "document_count", label: "文档数量", type: "number", required: false },
    { key: "updated_at", label: "更新时间", type: "datetime", required: true }
  ],
  sessions: [
    { key: "workspace_id", label: "工作区 ID", type: "text", required: true },
    { key: "workspace_name", label: "工作区名称", type: "text", required: true },
    { key: "session_id", label: "会话 ID", type: "text", required: true },
    { key: "title", label: "会话标题", type: "text", required: true },
    { key: "provider", label: "提供方", type: "text", required: false },
    { key: "message_count", label: "消息数量", type: "number", required: false },
    { key: "last_message_at", label: "最后消息时间", type: "datetime", required: false },
    { key: "running_state", label: "运行状态", type: "text", required: false },
    { key: "activity_state", label: "活动状态", type: "text", required: false },
    { key: "updated_at", label: "更新时间", type: "datetime", required: true }
  ],
  todos: [
    { key: "workspace_id", label: "工作区 ID", type: "text", required: false },
    { key: "workspace_name", label: "工作区名称", type: "text", required: false },
    { key: "todo_id", label: "代办 ID", type: "text", required: true },
    { key: "title", label: "标题", type: "text", required: true },
    { key: "content", label: "内容", type: "text", required: false },
    { key: "source_type", label: "来源类型", type: "text", required: true },
    { key: "item_type", label: "条目类型", type: "text", required: false },
    { key: "priority", label: "优先级", type: "text", required: false },
    { key: "status", label: "状态", type: "text", required: false },
    { key: "project_id", label: "项目 ID", type: "text", required: false },
    { key: "updated_at", label: "更新时间", type: "datetime", required: true }
  ]
};

export class TeableFieldMappingService {
  constructor(
    private readonly repository: UserTeableFieldMappingRepository,
    private readonly syncConfigRepository: UserTeableWorkbenchSyncConfigRepository
  ) {}

  listSourceFields(sourceType: TeableSyncSourceType): TeableSourceFieldDefinitionDto[] {
    return SOURCE_FIELDS[sourceType] ?? [];
  }

  listMappings(userId: string): TeableFieldMappingDto[] {
    return this.repository.listByUserId(userId).map(mapRecordToDto);
  }

  saveMappings(userId: string, items: SaveTeableFieldMappingInput[]): TeableFieldMappingDto[] {
    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        field: "items",
        detail: "至少要提交一条字段映射"
      });
    }

    const configs = this.syncConfigRepository.listByUserId(userId);
    const configById = new Map(configs.map((item) => [item.configId, item] as const));
    const results: TeableFieldMappingDto[] = [];

    for (const item of items) {
      const config = configById.get(item.configId.trim());
      if (!config) {
        throw new AppError({
          statusCode: 400,
          errorCode: "TEABLE_SYNC_CONFIG_NOT_FOUND",
          field: "configId",
          detail: `找不到 configId=${item.configId}`
        });
      }
      if (config.sourceType !== item.sourceType) {
        throw new AppError({
          statusCode: 400,
          errorCode: "INVALID_INPUT",
          field: "sourceType",
          detail: `configId=${item.configId} 的 sourceType 不匹配`
        });
      }
      const normalizedItems = normalizeItems(item.sourceType, item.items);
      const current = this.repository.findByUserIdAndConfigId(userId, item.configId.trim());
      const updatedAt = nowIso();
      const record: UserTeableFieldMappingRecord = {
        mappingId: current?.mappingId ?? `teable-field-mapping-${randomUUID()}`,
        userId,
        configId: item.configId.trim(),
        sourceType: item.sourceType,
        targetTableId: normalizeRequiredText(item.targetTableId, "targetTableId", "目标表不能为空"),
        itemsJson: JSON.stringify(normalizedItems),
        createdAt: current?.createdAt ?? updatedAt,
        updatedAt
      };
      results.push(mapRecordToDto(this.repository.upsert(record)));
    }

    return results;
  }

  resolveMapping(userId: string, configId: string): TeableFieldMappingDto | null {
    const record = this.repository.findByUserIdAndConfigId(userId, configId.trim());
    return record ? mapRecordToDto(record) : null;
  }

  applyMapping(
    mapping: TeableFieldMappingDto | null,
    sourcePayload: Record<string, unknown>
  ): Record<string, unknown> {
    if (!mapping) {
      return {};
    }
    const result: Record<string, unknown> = {};
    for (const item of mapping.items) {
      const value = sourcePayload[item.sourceField];
      if ((value === undefined || value === null || value === "") && item.required) {
        continue;
      }
      result[item.targetFieldName] = value ?? null;
    }
    return result;
  }
}

function mapRecordToDto(record: UserTeableFieldMappingRecord): TeableFieldMappingDto {
  return {
    mappingId: record.mappingId,
    configId: record.configId,
    sourceType: record.sourceType,
    targetTableId: record.targetTableId,
    items: parseItems(record.itemsJson),
    updatedAt: record.updatedAt
  };
}

function parseItems(raw: string): TeableFieldMappingItem[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        sourceField: typeof item.sourceField === "string" ? item.sourceField : "",
        targetFieldId: typeof item.targetFieldId === "string" ? item.targetFieldId : "",
        targetFieldName: typeof item.targetFieldName === "string" ? item.targetFieldName : "",
        required: item.required === true
      }))
      .filter((item) => item.sourceField && item.targetFieldId && item.targetFieldName);
  } catch {
    return [];
  }
}

function normalizeItems(
  sourceType: TeableSyncSourceType,
  items: SaveTeableFieldMappingInput["items"]
): TeableFieldMappingItem[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      field: "items",
      detail: "字段映射不能为空"
    });
  }
  const allowedFields = new Set((SOURCE_FIELDS[sourceType] ?? []).map((item) => item.key));
  const seenSourceFields = new Set<string>();
  const seenTargetFields = new Set<string>();
  return items.map((item, index) => {
    const sourceField = normalizeRequiredText(item.sourceField, `items[${index}].sourceField`, "源字段不能为空");
    const targetFieldId = normalizeRequiredText(item.targetFieldId, `items[${index}].targetFieldId`, "目标字段不能为空");
    const targetFieldName = normalizeRequiredText(item.targetFieldName, `items[${index}].targetFieldName`, "目标字段名称不能为空");
    if (!allowedFields.has(sourceField)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        field: `items[${index}].sourceField`,
        detail: `不支持的源字段：${sourceField}`
      });
    }
    if (seenSourceFields.has(sourceField)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        field: `items[${index}].sourceField`,
        detail: `源字段重复：${sourceField}`
      });
    }
    if (seenTargetFields.has(targetFieldId)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        field: `items[${index}].targetFieldId`,
        detail: `目标字段重复：${targetFieldName}`
      });
    }
    seenSourceFields.add(sourceField);
    seenTargetFields.add(targetFieldId);
    return {
      sourceField,
      targetFieldId,
      targetFieldName,
      required: item.required === true
    };
  });
}

function normalizeRequiredText(value: string, field: string, detail: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      field,
      detail
    });
  }
  return normalized;
}
