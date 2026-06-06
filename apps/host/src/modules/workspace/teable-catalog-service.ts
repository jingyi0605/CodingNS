import { AppError } from "../../shared/errors/app-error.js";
import type { TeableCredentialService } from "./teable-credential-service.js";
import type { TeableGlobalBindingService } from "./teable-global-binding-service.js";
import { TeableApiClient, type TeableCreateTableFieldInput, type TeableFieldType } from "./teable-api-client.js";

export interface TeableTableCatalogItemDto {
  tableId: string;
  tableName: string;
}

export interface TeableFieldSummaryDto {
  fieldId: string;
  fieldName: string;
  fieldType: string;
  isPrimary: boolean;
}

export interface TeableCreateFieldInputDto {
  sourceField: string;
  fieldName: string;
  fieldType: TeableFieldType;
  required?: boolean;
}

export interface TeableCreatedFieldMappingDto {
  sourceField: string;
  targetFieldId: string;
  targetFieldName: string;
  required: boolean;
  fieldType: string;
}

export class TeableCatalogService {
  constructor(
    private readonly teableGlobalBindingService: TeableGlobalBindingService,
    private readonly teableCredentialService: TeableCredentialService,
    _previewSigningSecret: string = "teable-preview",
    private readonly createClient: (baseUrl: string, token: string) => TeableApiClient = (baseUrl, token) =>
      new TeableApiClient(baseUrl, token)
  ) {}

  async listTables(userId: string): Promise<TeableTableCatalogItemDto[]> {
    const { client, baseId } = this.createBoundClient(userId);
    const tables = await client.listTables(baseId);
    return tables.map((item) => ({
      tableId: item.id,
      tableName: item.name
    }));
  }

  async listFields(userId: string, tableId: string): Promise<TeableFieldSummaryDto[]> {
    const normalizedTableId = tableId.trim();
    if (!normalizedTableId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        field: "tableId",
        detail: "tableId 不能为空"
      });
    }
    const { client } = this.createBoundClient(userId);
    const fields = await client.listFields(normalizedTableId);
    return fields.map((item) => ({
      fieldId: item.id,
      fieldName: item.name,
      fieldType: item.type,
      isPrimary: item.isPrimary === true
    }));
  }

  async createFields(
    userId: string,
    tableId: string,
    fields: TeableCreateFieldInputDto[]
  ): Promise<TeableCreatedFieldMappingDto[]> {
    const normalizedTableId = tableId.trim();
    if (!normalizedTableId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        field: "tableId",
        detail: "tableId 不能为空"
      });
    }
    if (!Array.isArray(fields) || fields.length === 0) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        field: "fields",
        detail: "至少要选择一个要添加的字段"
      });
    }

    const { client } = this.createBoundClient(userId);
    const existingFields = await client.listFields(normalizedTableId);
    const existingByName = new Map(existingFields.map((item) => [item.name.trim(), item] as const));
    const result: TeableCreatedFieldMappingDto[] = [];

    for (const field of fields) {
      const sourceField = field.sourceField.trim();
      const fieldName = field.fieldName.trim();
      if (!sourceField || !fieldName) {
        throw new AppError({
          statusCode: 400,
          errorCode: "INVALID_INPUT",
          field: "fields",
          detail: "字段名称不能为空"
        });
      }

      const existing = existingByName.get(fieldName);
      const target = existing ?? await client.createField(normalizedTableId, buildCreateFieldInput(fieldName, field.fieldType));
      existingByName.set(target.name, target);
      result.push({
        sourceField,
        targetFieldId: target.id,
        targetFieldName: target.name,
        required: field.required === true,
        fieldType: target.type
      });
    }

    return result;
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

function buildCreateFieldInput(name: string, type: TeableFieldType): TeableCreateTableFieldInput {
  return {
    name,
    type: normalizeCreateFieldType(type)
  };
}

function normalizeCreateFieldType(type: TeableFieldType): TeableFieldType {
  switch (type) {
    case "singleLineText":
    case "longText":
    case "date":
      return type;
    default:
      return "singleLineText";
  }
}
