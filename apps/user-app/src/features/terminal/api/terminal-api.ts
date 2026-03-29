import { httpClient } from "../../../network/http-client";

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
  command: string;
  args: string[];
  env: Record<string, string>;
  port: number | null;
  runtimeType?: string | null;
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
  processName: string | null;
  processCommandLine: string | null;
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

export function listTerminalShellOptions() {
  return httpClient.request<{ items: TerminalShellOptionDto[] }>("/api/terminals/shells");
}

export function listWorkspaceTerminals(workspaceId: string) {
  return httpClient.request<{ items: TerminalDto[] }>(
    `/api/terminals?workspaceId=${encodeURIComponent(workspaceId)}`
  );
}

export function listWorkspaceTemplateRuntimeStatuses(workspaceId: string) {
  return httpClient.request<{ items: TerminalTemplateRuntimeStatusDto[] }>(
    `/api/terminals/templates/runtime-status?workspaceId=${encodeURIComponent(workspaceId)}`
  );
}

export function stopTerminalTemplateProcess(templateId: string) {
  return httpClient.request<{
    success: true;
    processId: number | null;
    alreadyStopped: boolean;
  }>(`/api/terminals/templates/${encodeURIComponent(templateId)}/stop`, {
    method: "POST"
  });
}

export function createTerminal(payload: {
  workspaceId: string;
  name?: string;
  cwd?: string;
  shell?: string;
  runtimeType?: string;
}) {
  return httpClient.request<TerminalDto>("/api/terminals", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function closeTerminal(terminalId: string) {
  return httpClient.request<{ success: true }>(`/api/terminals/${encodeURIComponent(terminalId)}`, {
    method: "DELETE"
  });
}

export function deleteTerminalRecord(terminalId: string) {
  return httpClient.request<{ success: true }>(
    `/api/terminals/${encodeURIComponent(terminalId)}/record`,
    {
      method: "DELETE"
    }
  );
}

export function sendTerminalInput(terminalId: string, content: string) {
  return httpClient.request<{ accepted: true }>(
    `/api/terminals/${encodeURIComponent(terminalId)}/input`,
    {
      method: "POST",
      body: JSON.stringify({ content })
    }
  );
}

export function readTerminalHistory(
  terminalId: string,
  options: { beforeSeq?: number | null; limit?: number } = {}
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
    `/api/terminals/${encodeURIComponent(terminalId)}/history${suffix ? `?${suffix}` : ""}`
  );
}

export function listWorkspaceTemplates(workspaceId: string) {
  return httpClient.request<{ items: TerminalTemplateDto[] }>(
    `/api/terminals/templates?workspaceId=${encodeURIComponent(workspaceId)}`
  );
}

export function createTerminalTemplate(payload: {
  workspaceId: string;
  name: string;
  cwd?: string;
  command: string;
  args: string[];
  port?: number | null;
  runtimeType?: string | null;
}) {
  return httpClient.request<TerminalTemplateDto>("/api/terminals/templates", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateTerminalTemplate(
  templateId: string,
  payload: {
    workspaceId?: string;
    name?: string;
    cwd?: string;
    command?: string;
    args?: string[];
    port?: number | null;
    runtimeType?: string | null;
  }
) {
  return httpClient.request<TerminalTemplateDto>(
    `/api/terminals/templates/${encodeURIComponent(templateId)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload)
    }
  );
}

export function deleteTerminalTemplate(templateId: string) {
  return httpClient.request<{ success: true }>(
    `/api/terminals/templates/${encodeURIComponent(templateId)}`,
    {
      method: "DELETE"
    }
  );
}

export function runTerminalTemplate(
  templateId: string,
  payload: { terminalId?: string; shell?: string; runtimeType?: string }
) {
  return httpClient.request<{
    terminalId: string;
    templateId: string;
    createdTerminal: boolean;
  }>(`/api/terminals/templates/${encodeURIComponent(templateId)}/run`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
