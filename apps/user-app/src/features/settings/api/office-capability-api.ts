import { httpClient } from "../../../network/http-client";

export type DocumentTemplateStatus = "active" | "deprecated";
export type OfficeTaskType = "browser" | "document" | "ops" | "workflow";
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
export type OpsTargetKind = "ssh_host" | "web_console";
export type OpsTargetStatus = "active" | "disabled" | "error";

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

export interface OpsTargetDto {
  id: string;
  userId: string;
  workspaceId: string | null;
  kind: OpsTargetKind;
  displayName: string;
  environment: string | null;
  configJson: string;
  credentialRef: string | null;
  status: OpsTargetStatus;
  createdAt: string;
  updatedAt: string;
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

export async function fetchOpsTargets(input: {
  workspaceId?: string | null;
  kind?: OpsTargetKind;
  status?: OpsTargetStatus;
}): Promise<OpsTargetDto[]> {
  const query = new URLSearchParams();

  if (input.workspaceId?.trim()) {
    query.set("workspaceId", input.workspaceId.trim());
  }
  if (input.kind) {
    query.set("kind", input.kind);
  }
  if (input.status) {
    query.set("status", input.status);
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await httpClient.request<{ items: OpsTargetDto[] }>(`/api/office/ops/targets${suffix}`);
  return response.items;
}

export async function createOpsTarget(input: {
  workspaceId?: string | null;
  kind: OpsTargetKind;
  displayName: string;
  environment?: string | null;
  config: unknown;
  credentialRef?: string | null;
}): Promise<OpsTargetDto> {
  return await httpClient.request<OpsTargetDto>("/api/office/ops/targets", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateOpsTarget(
  targetId: string,
  input: {
    workspaceId?: string | null;
    kind?: OpsTargetKind;
    displayName?: string;
    environment?: string | null;
    config?: unknown;
    credentialRef?: string | null;
    status?: OpsTargetStatus;
  }
): Promise<OpsTargetDto> {
  return await httpClient.request<OpsTargetDto>(`/api/office/ops/targets/${encodeURIComponent(targetId)}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}
