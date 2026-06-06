import { httpClient } from "../../../../network/http-client";

export type TeableRuntimeViewType = "grid" | "form" | "calendar" | "kanban" | "gallery" | "plugin" | string;

export interface TeableRuntimeTableDto {
  tableId: string;
  tableName: string;
}

export interface TeableRuntimeViewDto {
  viewId: string;
  viewName: string;
  viewType: TeableRuntimeViewType;
  options: Record<string, unknown>;
  columnMeta?: unknown;
  filter?: unknown;
  orderBy?: unknown;
  group?: unknown;
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
  linkOptions: {
    foreignTableId: string;
    multiple: boolean;
    displayFieldId?: string;
  } | null;
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

export interface TeableRuntimeBlockConfig {
  tableId: string;
  tableName: string;
  viewId: string | null;
  viewName: string | null;
  viewType: "grid" | "form" | "calendar" | "kanban";
  createFormViewId?: string | null;
  createFormViewName?: string | null;
  editFormViewId?: string | null;
  editFormViewName?: string | null;
  title: string;
  density: "compact" | "comfortable";
  readOnly: boolean;
  fieldOverrides?: {
    visibleFieldIds?: string[];
    primaryFieldId?: string;
    calendarStartFieldId?: string;
    calendarEndFieldId?: string;
    kanbanGroupFieldId?: string;
    viewFieldOrder?: string[];
    viewVisibleFieldIds?: string[];
    viewFieldWidths?: Record<string, number>;
    viewFieldDisplay?: Record<string, {
      label?: string;
      description?: string;
      placeholder?: string;
    }>;
    createFormFieldOrder?: string[];
    createFormVisibleFieldIds?: string[];
    createFormRequiredFieldIds?: string[];
    createFormFieldDisplay?: Record<string, {
      label?: string;
      description?: string;
      placeholder?: string;
    }>;
    editFormFieldOrder?: string[];
    editFormVisibleFieldIds?: string[];
    editFormRequiredFieldIds?: string[];
    editFormFieldDisplay?: Record<string, {
      label?: string;
      description?: string;
      placeholder?: string;
    }>;
    formFieldOrder?: string[];
    requiredFieldIds?: string[];
    fieldWidths?: Record<string, number>;
    formFieldDisplay?: Record<string, {
      label?: string;
      description?: string;
      placeholder?: string;
    }>;
  };
}

export interface TeableBlockSelection {
  table: TeableRuntimeTableDto;
  view: TeableRuntimeViewDto;
  config: TeableRuntimeBlockConfig;
}

export async function listTeableRuntimeTables() {
  return httpClient.request<{ tables: TeableRuntimeTableDto[] }>("/api/affairs/teable/runtime/tables");
}

export async function listTeableRuntimeViews(tableId: string) {
  return httpClient.request<{ views: TeableRuntimeViewDto[] }>(`/api/affairs/teable/runtime/tables/${encodeURIComponent(tableId)}/views`);
}

export async function listTeableRuntimeFields(tableId: string) {
  return httpClient.request<{ fields: TeableRuntimeFieldDto[] }>(`/api/affairs/teable/runtime/tables/${encodeURIComponent(tableId)}/fields`);
}

export async function listTeableRuntimeRecords(tableId: string, input: { viewId?: string | null; take?: number; skip?: number; search?: string } = {}) {
  const search = new URLSearchParams();
  if (input.viewId) search.set("viewId", input.viewId);
  if (typeof input.take === "number") search.set("take", String(input.take));
  if (typeof input.skip === "number") search.set("skip", String(input.skip));
  if (input.search?.trim()) search.set("search", input.search.trim());
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return httpClient.request<TeableRuntimeRecordsPageDto>(`/api/affairs/teable/runtime/tables/${encodeURIComponent(tableId)}/records${suffix}`);
}

export async function createTeableRuntimeRecord(tableId: string, fields: Record<string, unknown>) {
  return httpClient.request<{ record: TeableRuntimeRecordDto | null }>(`/api/affairs/teable/runtime/tables/${encodeURIComponent(tableId)}/records`, {
    method: "POST",
    body: JSON.stringify({ fields })
  });
}

export async function updateTeableRuntimeRecord(tableId: string, recordId: string, fields: Record<string, unknown>) {
  return httpClient.request<{ record: TeableRuntimeRecordDto | null }>(`/api/affairs/teable/runtime/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`, {
    method: "PATCH",
    body: JSON.stringify({ fields })
  });
}

export async function deleteTeableRuntimeRecords(tableId: string, recordIds: string[]) {
  const search = new URLSearchParams();
  recordIds.forEach((recordId) => search.append("recordIds", recordId));
  return httpClient.request<{ deletedRecordIds: string[] }>(`/api/affairs/teable/runtime/tables/${encodeURIComponent(tableId)}/records?${search.toString()}`, {
    method: "DELETE"
  });
}

export async function listTeableLinkedRecordOptions(tableId: string, fieldId: string, input: { search?: string; take?: number; skip?: number } = {}) {
  const search = new URLSearchParams();
  if (input.search?.trim()) search.set("search", input.search.trim());
  if (typeof input.take === "number") search.set("take", String(input.take));
  if (typeof input.skip === "number") search.set("skip", String(input.skip));
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return httpClient.request<TeableLinkedRecordOptionsPageDto>(`/api/affairs/teable/runtime/tables/${encodeURIComponent(tableId)}/fields/${encodeURIComponent(fieldId)}/link-options${suffix}`);
}
