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

export interface PluginRuntimeSessionDto {
  id: string;
  pluginId: string;
  workspaceId: string;
  openedByUserId: string;
  source: "frontend" | "assistant" | "cli";
  status: "active" | "closed";
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface PluginRunDto {
  id: string;
  pluginId: string;
  workspaceId: string;
  runtimeSessionId: string | null;
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

export interface PluginRuntimeContextDto {
  pluginId: string;
  workspaceId: string;
  runtimeSessionId: string;
  pluginName: string;
  pluginVersion: string;
  frontendEntryUrl: string | null;
  hostOrigin: string | null;
}

export interface CreatePluginRuntimeSessionDto {
  runtimeSessionId: string;
  session: PluginRuntimeSessionDto;
  frontend: {
    basePath: string;
    entryUrl: string;
  } | null;
  context: PluginRuntimeContextDto;
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

export interface PluginPermissionGrantDto {
  id: string;
  pluginId: string;
  workspaceId: string;
  permissionKey:
    | "workspace.read_file"
    | "workspace.list_dir"
    | "workspace.write_file"
    | "desktop.open_file"
    | "desktop.reveal_in_file_manager";
  scopeType: "workspace" | "directory" | "file";
  scopePath: string | null;
  grantMode: "once" | "session" | "persistent";
  grantedByUserId: string;
  runtimeSessionId: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface PluginFileNodeDto {
  path: string;
  name: string;
  kind: "file" | "directory";
  size: number | null;
  updatedAt: string | null;
}

export interface PluginFileSnapshotDto {
  workspaceId: string;
  path: string;
  content: string;
  encoding: "utf-8";
  version: string;
  size: number;
  updatedAt: string;
}

export interface PluginFileWriteResultDto {
  path: string;
  size: number;
  updatedAt: string;
}

export interface CreatePluginPermissionGrantInput {
  runtimeSessionId: string;
  permissionKey: PluginPermissionGrantDto["permissionKey"];
  scopeType: PluginPermissionGrantDto["scopeType"];
  scopePath: string | null;
  grantMode: PluginPermissionGrantDto["grantMode"];
}

export function listPlugins() {
  return httpClient.request<{ items: PluginSummaryDto[] }>("/api/plugins");
}

export function getPlugin(pluginId: string) {
  return httpClient.request<PluginDetailDto>(`/api/plugins/${encodeURIComponent(pluginId)}`);
}

export function createPluginRuntimeSession(pluginId: string, workspaceId: string) {
  return httpClient.request<CreatePluginRuntimeSessionDto>(
    `/api/plugins/${encodeURIComponent(pluginId)}/runtime-sessions`,
    {
      method: "POST",
      body: JSON.stringify({
        workspaceId
      })
    }
  );
}

export function closePluginRuntimeSession(pluginId: string, runtimeSessionId: string) {
  return httpClient.request<PluginRuntimeSessionDto>(
    `/api/plugins/${encodeURIComponent(pluginId)}/runtime-sessions/${encodeURIComponent(runtimeSessionId)}/close`,
    {
      method: "POST"
    }
  );
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

export function callPluginAction(pluginId: string, actionId: string, runtimeSessionId: string, input?: unknown) {
  return httpClient.request<PluginActionResultDto>(
    `/api/plugins/${encodeURIComponent(pluginId)}/actions/${encodeURIComponent(actionId)}`,
    {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId,
        input: input === undefined ? null : input
      })
    }
  );
}

export function listPluginRuns(pluginId: string) {
  return httpClient.request<{ items: PluginRunDto[] }>(`/api/plugins/${encodeURIComponent(pluginId)}/runs`);
}

export function openPluginFile(pluginId: string, runtimeSessionId: string, path: string) {
  return httpClient.request<PluginDesktopActionDto>(`/api/plugins/${encodeURIComponent(pluginId)}/desktop/open-file`, {
    method: "POST",
    body: JSON.stringify({
      runtimeSessionId,
      path
    })
  });
}

export function revealPluginFile(pluginId: string, runtimeSessionId: string, path: string) {
  return httpClient.request<PluginDesktopActionDto>(`/api/plugins/${encodeURIComponent(pluginId)}/desktop/reveal-in-file-manager`, {
    method: "POST",
    body: JSON.stringify({
      runtimeSessionId,
      path
    })
  });
}

export function readPluginFile(pluginId: string, runtimeSessionId: string, path: string) {
  return httpClient.request<PluginFileSnapshotDto>(`/api/plugins/${encodeURIComponent(pluginId)}/files/read`, {
    method: "POST",
    body: JSON.stringify({
      runtimeSessionId,
      path
    })
  });
}

export function writePluginFile(
  pluginId: string,
  runtimeSessionId: string,
  path: string,
  content: string
) {
  return httpClient.request<PluginFileWriteResultDto>(`/api/plugins/${encodeURIComponent(pluginId)}/files/write`, {
    method: "POST",
    body: JSON.stringify({
      runtimeSessionId,
      path,
      content
    })
  });
}

export function listPluginDirectory(pluginId: string, runtimeSessionId: string, path?: string) {
  return httpClient.request<{ items: PluginFileNodeDto[] }>(
    `/api/plugins/${encodeURIComponent(pluginId)}/files/list`,
    {
      method: "POST",
      body: JSON.stringify({
        runtimeSessionId,
        path: path?.trim() || undefined
      })
    }
  );
}

export function listPluginPermissionGrants(pluginId: string, workspaceId: string) {
  const search = new URLSearchParams({
    workspaceId
  });

  return httpClient.request<{ items: PluginPermissionGrantDto[] }>(
    `/api/plugins/${encodeURIComponent(pluginId)}/permissions/grants?${search.toString()}`
  );
}

export function createPluginPermissionGrant(pluginId: string, input: CreatePluginPermissionGrantInput) {
  return httpClient.request<PluginPermissionGrantDto>(
    `/api/plugins/${encodeURIComponent(pluginId)}/permissions/grants`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function revokePluginPermissionGrant(pluginId: string, grantId: string, workspaceId: string) {
  return httpClient.request<PluginPermissionGrantDto>(
    `/api/plugins/${encodeURIComponent(pluginId)}/permissions/grants/${encodeURIComponent(grantId)}/revoke`,
    {
      method: "POST",
      body: JSON.stringify({
        workspaceId
      })
    }
  );
}
