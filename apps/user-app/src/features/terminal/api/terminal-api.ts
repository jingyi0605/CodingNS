import { httpClient } from "../../../network/http-client";

interface TerminalRequestOptions {
  targetHostId?: string | null;
}

export interface TerminalDto {
  id: string;
  workspaceId: string;
  name: string;
  cwd: string;
  shell: string;
  runtimeType?: string;
  runtimeSessionId?: string;
  attachTarget?: string;
  status: "creating" | "running" | "closed" | "error";
  processId?: number | null;
  createdByUserId: string;
  createdAt: string;
  lastActiveAt: string;
  closedAt: string | null;
  exitCode: number | null;
  statusDetail: string | null;
}

export interface TerminalTemplateDto {
  id: string;
  workspaceId: string;
  name: string;
  cwd: string;
  shell?: string | null;
  command: string;
  args: string[];
  env: Record<string, string>;
  port: number | null;
  proxyEnabled: boolean;
  proxySlug: string | null;
  runtimeType?: string | null;
  sourceType?: "manual" | "debug_service" | null;
  debugTargetId?: string | null;
  debugServiceId?: string | null;
  frameworkAnalysisId?: string | null;
  adapterKind?: "cli" | "env" | "override" | "ai_fallback" | null;
  injectionMode?: "cli" | "env" | "override" | "ai_fallback" | "none" | null;
  serviceDiscoveryMode?: "same_origin" | "api_base_url" | "none" | null;
  managedBySystem?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TerminalShellOptionDto {
  id: string;
  label: string;
  shell: string;
  available: boolean;
  unavailableReason: string | null;
}

export interface TerminalTemplateRuntimeStatusDto {
  templateId: string;
  port: number;
  occupied: boolean;
  processId: number | null;
  parentProcessId?: number | null;
  processGroupId?: number | null;
  processName: string | null;
  processCommandLine: string | null;
  parentProcessName?: string | null;
  parentProcessCommandLine?: string | null;
  terminationScope?: "process" | "process_group" | null;
}

export interface TerminalHistoryPageDto {
  terminalId: string;
  content: string;
  lineCount: number;
  anchorLine: number;
  replaceContent?: boolean;
  hasMore: boolean;
  nextBeforeSeq: number | null;
}

export function listTerminalShellOptions(options?: TerminalRequestOptions) {
  return httpClient.request<{ items: TerminalShellOptionDto[] }>("/api/terminals/shells", {
    targetHostId: options?.targetHostId ?? undefined
  });
}

export function listWorkspaceTerminals(workspaceId: string, options?: TerminalRequestOptions) {
  return httpClient.request<{ items: TerminalDto[] }>(
    `/api/terminals?workspaceId=${encodeURIComponent(workspaceId)}`,
    { targetHostId: options?.targetHostId ?? undefined }
  );
}

export function listWorkspaceTemplateRuntimeStatuses(workspaceId: string, options?: TerminalRequestOptions) {
  return httpClient.request<{ items: TerminalTemplateRuntimeStatusDto[] }>(
    `/api/terminals/templates/runtime-status?workspaceId=${encodeURIComponent(workspaceId)}`,
    { targetHostId: options?.targetHostId ?? undefined }
  );
}

export function stopTerminalTemplateProcess(templateId: string, options?: TerminalRequestOptions) {
  return httpClient.request<{
    success: true;
    processId: number | null;
    alreadyStopped: boolean;
  }>(`/api/terminals/templates/${encodeURIComponent(templateId)}/stop`, {
    method: "POST",
    targetHostId: options?.targetHostId ?? undefined
  });
}

export function createTerminal(payload: {
  workspaceId: string;
  name?: string;
  cwd?: string;
  shell?: string;
  runtimeType?: string;
}, options?: TerminalRequestOptions) {
  return httpClient.request<TerminalDto>("/api/terminals", {
    method: "POST",
    targetHostId: options?.targetHostId ?? undefined,
    body: JSON.stringify(payload)
  });
}

export function closeTerminal(terminalId: string, options?: TerminalRequestOptions) {
  return httpClient.request<{ success: true }>(`/api/terminals/${encodeURIComponent(terminalId)}`, {
    method: "DELETE",
    targetHostId: options?.targetHostId ?? undefined
  });
}

export function deleteTerminalRecord(terminalId: string, options?: TerminalRequestOptions) {
  return httpClient.request<{ success: true }>(
    `/api/terminals/${encodeURIComponent(terminalId)}/record`,
    {
      method: "DELETE",
      targetHostId: options?.targetHostId ?? undefined
    }
  );
}

export function sendTerminalInput(terminalId: string, content: string, options?: TerminalRequestOptions) {
  return httpClient.request<{ accepted: true }>(
    `/api/terminals/${encodeURIComponent(terminalId)}/input`,
    {
      method: "POST",
      targetHostId: options?.targetHostId ?? undefined,
      body: JSON.stringify({ content })
    }
  );
}

export function readTerminalHistory(
  terminalId: string,
  options: { beforeSeq?: number | null; limit?: number; targetHostId?: string | null } = {}
) {
  const searchParams = new URLSearchParams();

  if (typeof options.beforeSeq === "number") {
    searchParams.set("beforeSeq", String(options.beforeSeq));
  }

  if (typeof options.limit === "number") {
    searchParams.set("limit", String(options.limit));
  }

  const suffix = searchParams.toString();

  return httpClient.request<TerminalHistoryPageDto>(
    `/api/terminals/${encodeURIComponent(terminalId)}/history${suffix ? `?${suffix}` : ""}`,
    { targetHostId: options.targetHostId ?? undefined }
  );
}

export function listWorkspaceTemplates(workspaceId: string, options?: TerminalRequestOptions) {
  return httpClient.request<{ items: TerminalTemplateDto[] }>(
    `/api/terminals/templates?workspaceId=${encodeURIComponent(workspaceId)}`,
    { targetHostId: options?.targetHostId ?? undefined }
  );
}

export function createTerminalTemplate(payload: {
  workspaceId: string;
  name: string;
  cwd?: string;
  shell?: string | null;
  command: string;
  args: string[];
  port?: number | null;
  proxyEnabled?: boolean;
  runtimeType?: string | null;
}, options?: TerminalRequestOptions) {
  return httpClient.request<TerminalTemplateDto>("/api/terminals/templates", {
    method: "POST",
    targetHostId: options?.targetHostId ?? undefined,
    body: JSON.stringify(payload)
  });
}

export function updateTerminalTemplate(
  templateId: string,
  payload: {
    workspaceId?: string;
    name?: string;
    cwd?: string;
    shell?: string | null;
    command?: string;
    args?: string[];
    port?: number | null;
    proxyEnabled?: boolean;
    runtimeType?: string | null;
  },
  options?: TerminalRequestOptions
) {
  return httpClient.request<TerminalTemplateDto>(
    `/api/terminals/templates/${encodeURIComponent(templateId)}`,
    {
      method: "PUT",
      targetHostId: options?.targetHostId ?? undefined,
      body: JSON.stringify(payload)
    }
  );
}

export function deleteTerminalTemplate(templateId: string, options?: TerminalRequestOptions) {
  return httpClient.request<{ success: true }>(
    `/api/terminals/templates/${encodeURIComponent(templateId)}`,
    {
      method: "DELETE",
      targetHostId: options?.targetHostId ?? undefined
    }
  );
}

export function runTerminalTemplate(
  templateId: string,
  payload: {
    terminalId?: string;
    shell?: string;
    runtimeType?: string;
    argsOverride?: string[];
    envPatch?: Record<string, string>;
    portOverride?: number | null;
  },
  options?: TerminalRequestOptions
) {
  return httpClient.request<{
    terminalId: string;
    templateId: string;
    createdTerminal: boolean;
  }>(`/api/terminals/templates/${encodeURIComponent(templateId)}/run`, {
    method: "POST",
    targetHostId: options?.targetHostId ?? undefined,
    body: JSON.stringify(payload)
  });
}
