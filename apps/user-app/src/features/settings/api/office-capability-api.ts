import { httpClient } from "../../../network/http-client";

export type DocumentTemplateStatus = "active" | "deprecated";
export type OfficeTaskType = "browser" | "document" | "ops" | "workflow";
export type BrowserEngine = "chrome" | "edge";
export type BrowserProfileMode = "persistent" | "cdp_attached";
export type BrowserProfileOwnershipScope = "user" | "workspace" | "target";
export type BrowserProfileStatus = "active" | "locked" | "archived" | "error";
export type BrowserExecutionBackend = "playwright" | "opencli_bridge";
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
export type BrowserTaskExecutionStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timeout";

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

export interface BrowserProfileDto {
  id: string;
  userId: string;
  workspaceId: string | null;
  engine: BrowserEngine;
  mode: BrowserProfileMode;
  displayName: string;
  userDataDir: string | null;
  cdpEndpoint: string | null;
  ownershipScope: BrowserProfileOwnershipScope;
  status: BrowserProfileStatus;
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
  executionBackend?: BrowserExecutionBackend;
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

export function resolveBrowserTaskExecutionBackend(task: Pick<OfficeTaskDto, "executionBackend" | "inputJson">): BrowserExecutionBackend {
  if (task.executionBackend === "opencli_bridge" || task.executionBackend === "playwright") {
    return task.executionBackend;
  }

  try {
    const parsed = JSON.parse(task.inputJson) as { executionBackend?: unknown };
    return parsed.executionBackend === "opencli_bridge" ? "opencli_bridge" : "playwright";
  } catch {
    return "playwright";
  }
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

export interface BrowserTaskExecutionDto {
  taskId: string;
  taskType: string;
  key: string;
  executionLane: string;
  status: BrowserTaskExecutionStatus;
  source: string | null;
  attempt: number;
  enqueuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  timeoutMs: number | null;
  errorMessage?: string;
}

export interface BrowserBridgeStatusDto {
  provider: "opencli";
  availability: "ready" | "daemon_missing" | "extension_missing" | "unavailable";
  detail: string | null;
  checkedAt: string;
  installPath: string | null;
  version: string | null;
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

export async function fetchBrowserProfiles(input: {
  workspaceId?: string | null;
} = {}): Promise<BrowserProfileDto[]> {
  const query = new URLSearchParams();

  if (input.workspaceId?.trim()) {
    query.set("workspaceId", input.workspaceId.trim());
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await httpClient.request<{ items: BrowserProfileDto[] }>(`/api/office/browser/profiles${suffix}`);
  return response.items;
}

export async function createBrowserProfile(input: {
  workspaceId?: string | null;
  engine?: BrowserEngine;
  mode?: BrowserProfileMode;
  displayName?: string | null;
  ownershipScope?: BrowserProfileOwnershipScope;
  cdpEndpoint?: string | null;
}): Promise<BrowserProfileDto> {
  return await httpClient.request<BrowserProfileDto>("/api/office/browser/profiles", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateBrowserProfile(
  profileId: string,
  input: {
    ownershipScope?: BrowserProfileOwnershipScope;
  }
): Promise<BrowserProfileDto> {
  return await httpClient.request<BrowserProfileDto>(
    `/api/office/browser/profiles/${encodeURIComponent(profileId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input)
    }
  );
}

export async function deleteBrowserProfile(profileId: string): Promise<{
  profileId: string;
  deleted: boolean;
}> {
  return await httpClient.request(`/api/office/browser/profiles/${encodeURIComponent(profileId)}`, {
    method: "DELETE"
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

export async function createBrowserTask(input: {
  workspaceId?: string | null;
  title?: string;
  profileId: string;
  riskLevel?: OfficeRiskLevel;
  executionBackend?: BrowserExecutionBackend;
  sessionRequirement?: "none" | "reuse_current_logged_in_browser";
  input?: unknown;
}): Promise<OfficeTaskDto> {
  return await httpClient.request<OfficeTaskDto>("/api/office/browser/tasks", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function executeBrowserTask(taskId: string): Promise<{
  taskId: string;
  executionTaskId: string;
  deduped: boolean;
}> {
  return await httpClient.request(`/api/office/browser/tasks/${encodeURIComponent(taskId)}/execute`, {
    method: "POST"
  });
}

export async function fetchBrowserTaskExecution(taskId: string): Promise<BrowserTaskExecutionDto | null> {
  const response = await httpClient.request<{ task: BrowserTaskExecutionDto | null }>(
    `/api/office/browser/tasks/${encodeURIComponent(taskId)}/execution`
  );
  return response.task;
}

export async function fetchBrowserBridgeStatus(): Promise<BrowserBridgeStatusDto> {
  return await httpClient.request<BrowserBridgeStatusDto>("/api/office/browser/bridge-status");
}

export async function cancelBrowserTaskExecution(taskId: string): Promise<{
  taskId: string;
  cancelled: boolean;
}> {
  return await httpClient.request(`/api/office/browser/tasks/${encodeURIComponent(taskId)}/execution/cancel`, {
    method: "POST"
  });
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
