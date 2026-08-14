import { httpClient } from "../../../network/http-client";

export type DocumentTemplateStatus = "active" | "deprecated";
export type OfficeTaskType = "document" | "workflow";
export type OfficeTaskStatus =
  | "draft"
  | "pending_approval"
  | "ready"
  | "running"
  | "paused"
  | "waiting_external"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "rolled_back";
export type OfficeRiskLevel = "low" | "medium" | "high";
export type OfficeApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled";

export interface DocumentTemplateDto {
  id: string;
  templateKey: string;
  displayName: string;
  engine: "doct";
  templateVersion: string;
  templateSourcePath: string | null;
  schemaJson: string;
  mappingJson: string;
  outputFormatsJson: string;
  status: DocumentTemplateStatus;
  createdAt: string;
  updatedAt: string;
}

export interface OfficeTaskDto {
  id: string;
  userId: string;
  workspaceId: string | null;
  taskType: OfficeTaskType;
  title: string;
  description: string | null;
  connectorId: string;
  targetRefKind: string | null;
  targetRefId: string | null;
  inputJson: string;
  status: OfficeTaskStatus;
  riskLevel: OfficeRiskLevel;
  approvalPolicyId: string | null;
  currentStepId: string | null;
  idempotencyKey: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OfficeTaskStepDto {
  id: string;
  taskId: string;
  stepSeq: number;
  stepType: string;
  title: string;
  inputJson: string | null;
  outputJson: string | null;
  status: string;
  retryCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OfficeApprovalDto {
  id: string;
  taskId: string;
  stepId: string | null;
  policyId: string;
  status: OfficeApprovalStatus;
  approverUserId: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OfficeTaskDetailDto {
  task: OfficeTaskDto;
  steps: OfficeTaskStepDto[];
  approvals: OfficeApprovalDto[];
  receipts: Array<{
    id: string;
    taskId: string;
    stepId: string | null;
    receiptType: string;
    summary: string;
    payloadJson: string;
    createdAt: string;
  }>;
  artifacts: Array<{
    id: string;
    taskId: string;
    stepId: string | null;
    kind: string;
    name: string;
    storagePath: string | null;
    previewPath?: string | null;
    previewUrl?: string | null;
    contentType: string | null;
    metadataJson: string | null;
    createdAt: string;
  }>;
}

export interface OnlyOfficeSettingsDto {
  enabled: boolean;
  serverUrl: string | null;
  publicBaseUrl: string | null;
  callbackBaseUrl: string | null;
  userDisplayName: string | null;
  userAvatarUrl: string | null;
  jwtSecretConfigured: boolean;
  updatedAt: string | null;
}

export interface OnlyOfficeStatusDto {
  state: "disabled" | "misconfigured" | "ready" | "warning" | "error";
  summary: string;
  checkedAt: string;
  checks: Array<{
    key: string;
    label: string;
    status: "pass" | "warn" | "fail" | "skip";
    detail: string;
  }>;
}

export async function fetchDocumentTemplates(status: DocumentTemplateStatus = "active"): Promise<DocumentTemplateDto[]> {
  const query = new URLSearchParams({ status });
  const response = await httpClient.request<{ items: DocumentTemplateDto[] }>(
    `/api/office/document-templates?${query.toString()}`
  );
  return response.items;
}

export async function createDocumentTemplate(input: {
  templateKey: string;
  displayName: string;
  templateVersion: string;
  templateSourcePath?: string | null;
  schema: unknown;
  mapping: unknown;
  outputFormats: Array<"docx" | "pdf" | "md">;
  status?: DocumentTemplateStatus;
}): Promise<DocumentTemplateDto> {
  return await httpClient.request<DocumentTemplateDto>("/api/office/document-templates", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function importDocumentTemplateFile(input: {
  fileName: string;
  fileContentBase64: string;
}): Promise<DocumentTemplateDto> {
  return await httpClient.request<DocumentTemplateDto>("/api/office/document-templates/import-file", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateDocumentTemplate(
  templateId: string,
  input: {
    displayName?: string;
    templateSourcePath?: string | null;
    schema?: unknown;
    mapping?: unknown;
    outputFormats?: Array<"docx" | "pdf" | "md">;
    status?: DocumentTemplateStatus;
  }
): Promise<DocumentTemplateDto> {
  return await httpClient.request<DocumentTemplateDto>(
    `/api/office/document-templates/${encodeURIComponent(templateId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input)
    }
  );
}

export async function fetchOfficeTasks(input: {
  workspaceId?: string | null;
  taskType?: OfficeTaskType;
  status?: OfficeTaskStatus;
  riskLevel?: OfficeRiskLevel;
  limit?: number;
}): Promise<OfficeTaskDto[]> {
  const query = new URLSearchParams();

  if (input.workspaceId?.trim()) {
    query.set("workspaceId", input.workspaceId.trim());
  }
  if (input.taskType) {
    query.set("taskType", input.taskType);
  }
  if (input.status) {
    query.set("status", input.status);
  }
  if (input.riskLevel) {
    query.set("riskLevel", input.riskLevel);
  }
  if (typeof input.limit === "number" && Number.isFinite(input.limit)) {
    query.set("limit", String(Math.trunc(input.limit)));
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await httpClient.request<{ items: OfficeTaskDto[] }>(`/api/office/tasks${suffix}`);
  return response.items;
}

export async function fetchOfficeTaskDetail(taskId: string): Promise<OfficeTaskDetailDto> {
  return await httpClient.request<OfficeTaskDetailDto>(`/api/office/tasks/${encodeURIComponent(taskId)}`);
}

export async function fetchOnlyOfficeSettings(): Promise<OnlyOfficeSettingsDto> {
  return await httpClient.request<OnlyOfficeSettingsDto>("/api/office/onlyoffice/settings");
}

export async function updateOnlyOfficeSettings(input: {
  enabled: boolean;
  serverUrl?: string | null;
  publicBaseUrl?: string | null;
  callbackBaseUrl?: string | null;
  userDisplayName?: string | null;
  userAvatarUrl?: string | null;
  jwtSecret?: string | null;
  clearJwtSecret?: boolean;
}): Promise<OnlyOfficeSettingsDto> {
  return await httpClient.request<OnlyOfficeSettingsDto>("/api/office/onlyoffice/settings", {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function fetchOnlyOfficeStatus(): Promise<OnlyOfficeStatusDto> {
  return await httpClient.request<OnlyOfficeStatusDto>("/api/office/onlyoffice/status");
}

export async function replyOfficeApproval(
  approvalId: string,
  input: {
    status: "approved" | "rejected";
    decisionNote?: string | null;
  }
): Promise<void> {
  await httpClient.request(`/api/office/approvals/${encodeURIComponent(approvalId)}/reply`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}
