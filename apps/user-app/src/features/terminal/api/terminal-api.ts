import { httpClient } from "../../../network/http-client";

export interface TerminalDto {
  id: string;
  workspaceId: string;
  name: string;
  cwd: string;
  shell: string;
  status: "creating" | "running" | "closed" | "error";
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

export function listTerminalShellOptions() {
  return httpClient.request<{ items: TerminalShellOptionDto[] }>("/api/terminals/shells");
}

export function listWorkspaceTerminals(workspaceId: string) {
  return httpClient.request<{ items: TerminalDto[] }>(
    `/api/terminals?workspaceId=${encodeURIComponent(workspaceId)}`
  );
}

export function createTerminal(payload: {
  workspaceId: string;
  name?: string;
  cwd?: string;
  shell?: string;
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

export function sendTerminalInput(terminalId: string, content: string) {
  return httpClient.request<{ accepted: true }>(
    `/api/terminals/${encodeURIComponent(terminalId)}/input`,
    {
      method: "POST",
      body: JSON.stringify({ content })
    }
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
}) {
  return httpClient.request<TerminalTemplateDto>("/api/terminals/templates", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function runTerminalTemplate(templateId: string, payload: { terminalId?: string; shell?: string }) {
  return httpClient.request<{
    terminalId: string;
    templateId: string;
    createdTerminal: boolean;
  }>(`/api/terminals/templates/${encodeURIComponent(templateId)}/run`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
