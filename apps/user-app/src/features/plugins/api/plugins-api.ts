import { httpClient } from "../../../network/http-client";

export interface PluginSummaryDto {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  installRoot: string;
  hasFrontend: boolean;
  hasBackend: boolean;
  updatedAt: string;
}

export interface PluginManifestActionDto {
  id: string;
  title: string;
  entry: string;
  timeoutMs?: number;
}

export interface PluginManifestFrontendDto {
  entry: string;
  mode?: "static_html";
}

export interface PluginManifestDto {
  id: string;
  name: string;
  version: string;
  description?: string;
  frontend?: PluginManifestFrontendDto;
  backend?: {
    runtime: "node";
    mode?: "on_demand" | "daemon";
    actions: PluginManifestActionDto[];
  };
  permissions: {
    workspaceRead?: boolean;
    workspaceWrite?: boolean;
    network?: boolean;
    desktop?: Array<"open_file" | "reveal_in_file_manager">;
    hostApis?: string[];
  };
  schedules?: Array<{
    id: string;
    cron?: string;
    everySeconds?: number;
    actionId: string;
  }>;
}

export interface PluginEnablementDto {
  pluginId: string;
  enabled: boolean;
  enabledByUserId: string | null;
  enabledAt: string | null;
  disabledByUserId: string | null;
  disabledAt: string | null;
  reason: string | null;
  updatedAt: string;
}

export interface PluginRunDto {
  id: string;
  pluginId: string;
  workspaceId: string;
  triggerKind: "frontend" | "cli" | "schedule" | "assistant";
  actionId: string | null;
  status: "queued" | "running" | "succeeded" | "failed" | "rejected" | "cancelled";
  inputSummaryJson: string | null;
  outputSummaryJson: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface PluginAuditEventDto {
  id: string;
  pluginId: string;
  workspaceId: string | null;
  eventType: string;
  actorUserId: string | null;
  payloadJson: string;
  createdAt: string;
}

export interface PluginDetailDto {
  definition: {
    id: string;
    version: string;
    name: string;
    installRoot: string;
    manifestJson: string;
    hasFrontend: boolean;
    hasBackend: boolean;
    createdAt: string;
    updatedAt: string;
  };
  manifest: PluginManifestDto;
  enablement: PluginEnablementDto;
  auditEvents: PluginAuditEventDto[];
  frontend: {
    basePath: string;
    entryUrl: string;
  } | null;
}

export interface PluginActionResultDto {
  run: PluginRunDto;
  output: unknown;
}

export interface PluginDesktopActionDto {
  workspaceId: string;
  relativePath: string;
  absolutePath: string;
}

export function listPlugins() {
  return httpClient.request<{ items: PluginSummaryDto[] }>("/api/plugins");
}

export function getPlugin(pluginId: string) {
  return httpClient.request<PluginDetailDto>(`/api/plugins/${encodeURIComponent(pluginId)}`);
}

export function enablePlugin(pluginId: string) {
  return httpClient.request<PluginEnablementDto>(`/api/plugins/${encodeURIComponent(pluginId)}/enable`, {
    method: "POST"
  });
}

export function disablePlugin(pluginId: string, reason?: string | null) {
  return httpClient.request<PluginEnablementDto>(`/api/plugins/${encodeURIComponent(pluginId)}/disable`, {
    method: "POST",
    body: JSON.stringify({
      reason: reason?.trim() || undefined
    })
  });
}

export function callPluginAction(pluginId: string, actionId: string, workspaceId: string, input?: unknown) {
  return httpClient.request<PluginActionResultDto>(
    `/api/plugins/${encodeURIComponent(pluginId)}/actions/${encodeURIComponent(actionId)}`,
    {
      method: "POST",
      body: JSON.stringify({
        workspaceId,
        input: input === undefined ? null : input
      })
    }
  );
}

export function listPluginRuns(pluginId: string) {
  return httpClient.request<{ items: PluginRunDto[] }>(`/api/plugins/${encodeURIComponent(pluginId)}/runs`);
}

export function openPluginFile(pluginId: string, workspaceId: string, path: string) {
  return httpClient.request<PluginDesktopActionDto>(`/api/plugins/${encodeURIComponent(pluginId)}/desktop/open-file`, {
    method: "POST",
    body: JSON.stringify({
      workspaceId,
      path
    })
  });
}

export function revealPluginFile(pluginId: string, workspaceId: string, path: string) {
  return httpClient.request<PluginDesktopActionDto>(`/api/plugins/${encodeURIComponent(pluginId)}/desktop/reveal-in-file-manager`, {
    method: "POST",
    body: JSON.stringify({
      workspaceId,
      path
    })
  });
}
