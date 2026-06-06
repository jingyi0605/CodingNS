import { AppError } from "../../shared/errors/app-error.js";
import type { TeableCredentialService } from "./teable-credential-service.js";
import type { TeableGlobalBindingService } from "./teable-global-binding-service.js";
import { TeableApiClient, type TeableFieldSummary, type TeableRecordSummary, type TeableViewSummary } from "./teable-api-client.js";

export interface TeableRuntimeTableDto {
  tableId: string;
  tableName: string;
}

export interface TeableRuntimeViewDto {
  viewId: string;
  viewName: string;
  viewType: string;
  options: Record<string, unknown>;
  columnMeta?: unknown;
  filter?: unknown;
  orderBy?: unknown;
  group?: unknown;
}

export interface TeableRuntimeLinkOptionsDto {
  foreignTableId: string;
  multiple: boolean;
  displayFieldId?: string;
}

export interface TeableRuntimeFieldDto {
  fieldId: string;
  fieldName: string;
  fieldType: string;
  isPrimary: boolean;
  isComputed: boolean;
  isLookup: boolean;
  isMultipleCellValue: boolean;
  recordRead: boolean;
  recordCreate: boolean;
  recordUpdate: boolean;
  options: Record<string, unknown>;
  lookupOptions?: Record<string, unknown>;
  linkOptions: TeableRuntimeLinkOptionsDto | null;
}

export interface TeableRuntimeRecordDto {
  recordId: string;
  fields: Record<string, unknown>;
}

export interface TeableRuntimeRecordsPageDto {
  records: TeableRuntimeRecordDto[];
  total?: number;
  skip: number;
  take: number;
}

export interface TeableLinkedRecordOptionDto {
  recordId: string;
  title: string;
  subtitle?: string;
}

export interface TeableLinkedRecordOptionsPageDto {
  options: TeableLinkedRecordOptionDto[];
  skip: number;
  take: number;
  hasMore: boolean;
}

export interface TeableRuntimeRecordWriteInput {
  fields?: Record<string, unknown>;
}

export interface TeableRuntimeRecordListInput {
  viewId?: string;
  take?: number;
  skip?: number;
  search?: string;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const COMPUTED_FIELD_TYPES = new Set([
  "formula",
  "lookup",
  "rollup",
  "conditionalLookup",
  "conditionalRollup",
  "createdTime",
  "lastModifiedTime",
  "createdBy",
  "lastModifiedBy",
  "autoNumber"
]);

export class TeableRuntimeService {
  constructor(
    private readonly teableGlobalBindingService: TeableGlobalBindingService,
    private readonly teableCredentialService: TeableCredentialService,
    private readonly createClient: (baseUrl: string, token: string) => TeableApiClient = (baseUrl, token) =>
      new TeableApiClient(baseUrl, token)
  ) {}

  async listTables(userId: string): Promise<{ tables: TeableRuntimeTableDto[] }> {
    const { client, baseId } = this.createBoundClient(userId);
    const tables = await client.listTables(baseId);
    return {
      tables: tables.map((item) => ({
        tableId: item.id,
        tableName: item.name
      }))
    };
  }

  async listViews(userId: string, tableId: string): Promise<{ views: TeableRuntimeViewDto[] }> {
    const normalizedTableId = requireNonEmpty(tableId, "tableId");
    const { client } = this.createBoundClient(userId);
    const views = await client.listViews(normalizedTableId);
    return {
      views: views.map(mapViewToDto)
    };
  }

  async listFields(userId: string, tableId: string): Promise<{ fields: TeableRuntimeFieldDto[] }> {
    const fields = await this.readRuntimeFields(userId, tableId);
    return { fields };
  }

  async listRecords(
    userId: string,
    tableId: string,
    input: TeableRuntimeRecordListInput = {}
  ): Promise<TeableRuntimeRecordsPageDto> {
    const normalizedTableId = requireNonEmpty(tableId, "tableId");
    const take = normalizeTake(input.take);
    const skip = normalizeSkip(input.skip);
    const { client } = this.createBoundClient(userId);
    const result = await client.listRecords(normalizedTableId, {
      fieldKeyType: "id",
      cellFormat: "json",
      viewId: input.viewId,
      take,
      skip,
      search: input.search
    });
    return {
      records: result.records.map(mapRecordToDto),
      total: result.total,
      skip,
      take
    };
  }

  async createRecord(
    userId: string,
    tableId: string,
    input: TeableRuntimeRecordWriteInput
  ): Promise<{ record: TeableRuntimeRecordDto | null }> {
    const normalizedTableId = requireNonEmpty(tableId, "tableId");
    const fields = await this.filterWritableFields(userId, normalizedTableId, input.fields ?? {}, "create");
    const { client } = this.createBoundClient(userId);
    const result = await client.createRecords(normalizedTableId, {
      fieldKeyType: "id",
      records: [{ fields }]
    });
    return { record: result.records[0] ? mapRecordToDto(result.records[0]) : null };
  }

  async updateRecord(
    userId: string,
    tableId: string,
    recordId: string,
    input: TeableRuntimeRecordWriteInput
  ): Promise<{ record: TeableRuntimeRecordDto | null }> {
    const normalizedTableId = requireNonEmpty(tableId, "tableId");
    const normalizedRecordId = requireNonEmpty(recordId, "recordId");
    const fields = await this.filterWritableFields(userId, normalizedTableId, input.fields ?? {}, "update");
    const { client } = this.createBoundClient(userId);
    const result = await client.updateRecords(normalizedTableId, {
      fieldKeyType: "id",
      records: [{ id: normalizedRecordId, fields }]
    });
    return { record: result[0] ? mapRecordToDto(result[0]) : null };
  }

  async deleteRecords(userId: string, tableId: string, recordIds: string[]): Promise<{ deletedRecordIds: string[] }> {
    const normalizedTableId = requireNonEmpty(tableId, "tableId");
    const normalizedRecordIds = recordIds.map((item) => item.trim()).filter(Boolean);
    if (normalizedRecordIds.length === 0) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        field: "recordIds",
        detail: "至少要选择一条要删除的记录"
      });
    }
    const { client } = this.createBoundClient(userId);
    await client.deleteRecords(normalizedTableId, normalizedRecordIds);
    return { deletedRecordIds: normalizedRecordIds };
  }

  async listLinkedRecordOptions(
    userId: string,
    tableId: string,
    fieldId: string,
    input: TeableRuntimeRecordListInput = {}
  ): Promise<TeableLinkedRecordOptionsPageDto> {
    const normalizedTableId = requireNonEmpty(tableId, "tableId");
    const normalizedFieldId = requireNonEmpty(fieldId, "fieldId");
    const take = normalizeTake(input.take ?? 50);
    const skip = normalizeSkip(input.skip);
    const fields = await this.readRuntimeFields(userId, normalizedTableId);
    const linkField = fields.find((item) => item.fieldId === normalizedFieldId);
    if (!linkField) {
      throw new AppError({
        statusCode: 404,
        errorCode: "TEABLE_FIELD_NOT_FOUND",
        field: "fieldId",
        detail: "找不到指定的 Teable 字段"
      });
    }
    if (!linkField.linkOptions?.foreignTableId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "TEABLE_LINK_FIELD_REQUIRED",
        field: "fieldId",
        detail: "这个字段没有可用的关联表配置"
      });
    }

    const foreignTableId = linkField.linkOptions.foreignTableId;
    const foreignFields = await this.readRuntimeFields(userId, foreignTableId);
    const primaryField = foreignFields.find((item) => item.isPrimary) ?? foreignFields[0];
    const { client } = this.createBoundClient(userId);
    const result = await client.listRecords(foreignTableId, {
      fieldKeyType: "id",
      cellFormat: "json",
      take,
      skip,
      search: input.search
    });
    const options = result.records.map((record) => ({
      recordId: record.id,
      title: stringifyCellValue(primaryField ? record.fields[primaryField.fieldId] : undefined) || record.id,
      subtitle: primaryField ? undefined : record.id
    }));
    return {
      options,
      skip,
      take,
      hasMore: typeof result.total === "number" ? skip + options.length < result.total : options.length === take
    };
  }

  private async readRuntimeFields(userId: string, tableId: string): Promise<TeableRuntimeFieldDto[]> {
    const normalizedTableId = requireNonEmpty(tableId, "tableId");
    const { client } = this.createBoundClient(userId);
    const fields = await client.listFields(normalizedTableId);
    return fields.map(mapFieldToDto);
  }

  private async filterWritableFields(
    userId: string,
    tableId: string,
    fields: Record<string, unknown>,
    mode: "create" | "update"
  ): Promise<Record<string, unknown>> {
    if (!isPlainObject(fields)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        field: "fields",
        detail: "fields 必须是对象"
      });
    }
    const runtimeFields = await this.readRuntimeFields(userId, tableId);
    const runtimeFieldById = new Map(runtimeFields.map((field) => [field.fieldId, field]));
    const next: Record<string, unknown> = {};

    for (const [fieldId, value] of Object.entries(fields)) {
      const field = runtimeFieldById.get(fieldId);
      if (!field) {
        throw new AppError({
          statusCode: 400,
          errorCode: "TEABLE_FIELD_NOT_FOUND",
          field: fieldId,
          detail: `字段 ${fieldId} 不存在`
        });
      }
      const canWrite = mode === "create" ? field.recordCreate : field.recordUpdate;
      if (!canWrite || isComputedField(field)) {
        throw new AppError({
          statusCode: 400,
          errorCode: "TEABLE_FIELD_NOT_WRITABLE",
          field: fieldId,
          detail: `字段「${field.fieldName}」不可写`
        });
      }
      next[fieldId] = value;
    }

    return next;
  }

  private createBoundClient(userId: string): { client: TeableApiClient; baseId: string } {
    const binding = this.teableGlobalBindingService.getGlobalBinding(userId);
    if (!binding || !binding.baseUrl || !binding.baseId || !binding.authRef) {
      throw new AppError({
        statusCode: 400,
        errorCode: "TEABLE_BINDING_REQUIRED",
        detail: "当前还没有可用的 Teable 连接配置"
      });
    }
    const token = this.teableCredentialService.loadToken(userId, binding.authRef);
    if (!token) {
      throw new AppError({
        statusCode: 400,
        errorCode: "TEABLE_AUTH_REQUIRED",
        detail: "当前 Teable 认证引用没有可用 token"
      });
    }
    return {
      client: this.createClient(binding.baseUrl, token),
      baseId: binding.baseId
    };
  }
}

function mapViewToDto(view: TeableViewSummary): TeableRuntimeViewDto {
  return {
    viewId: view.id,
    viewName: view.name,
    viewType: view.type,
    options: asRecord(view.options),
    columnMeta: view.columnMeta,
    filter: view.filter,
    orderBy: view.orderBy,
    group: view.group
  };
}

function mapFieldToDto(field: TeableFieldSummary): TeableRuntimeFieldDto {
  const options = asRecord(field.options);
  const lookupOptions = field.lookupOptions === undefined ? undefined : asRecord(field.lookupOptions);
  const isLookup = field.type === "lookup" || Boolean(readBoolean(field, "isLookup"));
  const isComputed = Boolean(readBoolean(field, "isComputed")) || COMPUTED_FIELD_TYPES.has(field.type) || isLookup;
  const isMultipleCellValue = Boolean(readBoolean(field, "isMultipleCellValue")) || readMultipleFromOptions(options, lookupOptions);
  return {
    fieldId: field.id,
    fieldName: field.name,
    fieldType: field.type,
    isPrimary: field.isPrimary === true,
    isComputed,
    isLookup,
    isMultipleCellValue,
    recordRead: readPermission(field, "recordRead", true),
    recordCreate: !isComputed && readPermission(field, "recordCreate", true),
    recordUpdate: !isComputed && readPermission(field, "recordUpdate", true),
    options,
    lookupOptions,
    linkOptions: field.type === "link" ? parseLinkOptions(options, lookupOptions, isMultipleCellValue) : null
  };
}

function mapRecordToDto(record: TeableRecordSummary): TeableRuntimeRecordDto {
  return {
    recordId: record.id,
    fields: record.fields
  };
}

function parseLinkOptions(
  options: Record<string, unknown>,
  lookupOptions: Record<string, unknown> | undefined,
  fallbackMultiple: boolean
): TeableRuntimeLinkOptionsDto | null {
  const foreignTableId = readFirstString(options, ["foreignTableId", "foreignTableID", "tableId", "tableID", "linkedTableId"])
    ?? readFirstString(lookupOptions ?? {}, ["foreignTableId", "foreignTableID", "tableId", "tableID", "linkedTableId"]);
  if (!foreignTableId) {
    return null;
  }
  const displayFieldId = readFirstString(options, ["displayFieldId", "displayFieldID", "foreignFieldId", "lookupFieldId"])
    ?? readFirstString(lookupOptions ?? {}, ["displayFieldId", "displayFieldID", "foreignFieldId", "lookupFieldId"]);
  return {
    foreignTableId,
    multiple: readMultipleFromOptions(options, lookupOptions) || fallbackMultiple,
    ...(displayFieldId ? { displayFieldId } : {})
  };
}

function readMultipleFromOptions(
  options: Record<string, unknown>,
  lookupOptions?: Record<string, unknown>
): boolean {
  return Boolean(
    readBoolean(options, "multiple")
    ?? readBoolean(options, "isMultiple")
    ?? readBoolean(options, "isMultipleCellValue")
    ?? readBoolean(lookupOptions ?? {}, "multiple")
    ?? readBoolean(lookupOptions ?? {}, "isMultiple")
    ?? false
  );
}

function readPermission(field: TeableFieldSummary, key: "recordRead" | "recordCreate" | "recordUpdate", fallback: boolean): boolean {
  const direct = readBoolean(field, key);
  if (direct !== undefined) {
    return direct;
  }
  const permissions = readObject(field, "permissions") ?? readObject(field, "permission");
  const nested = permissions ? readBoolean(permissions, key) : undefined;
  return nested ?? fallback;
}

function readFirstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function readBoolean(source: unknown, key: string): boolean | undefined {
  if (!isPlainObject(source)) {
    return undefined;
  }
  const value = source[key];
  return typeof value === "boolean" ? value : undefined;
}

function readObject(source: unknown, key: string): Record<string, unknown> | undefined {
  if (!isPlainObject(source)) {
    return undefined;
  }
  return asOptionalRecord(source[key]);
}

function asRecord(value: unknown): Record<string, unknown> {
  return asOptionalRecord(value) ?? {};
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isComputedField(field: TeableRuntimeFieldDto): boolean {
  return field.isComputed || field.isLookup || COMPUTED_FIELD_TYPES.has(field.fieldType);
}

function normalizeTake(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(value)));
}

function normalizeSkip(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      field,
      detail: `${field} 不能为空`
    });
  }
  return normalized;
}

function stringifyCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(stringifyCellValue).filter(Boolean).join("、");
  }
  if (isPlainObject(value)) {
    const title = readFirstString(value, ["title", "name", "text", "label"]);
    return title ?? JSON.stringify(value);
  }
  return String(value);
}
