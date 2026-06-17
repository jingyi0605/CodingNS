import { httpClient } from "../../../network/http-client";

export type PeerHostStatus =
  | "unknown"
  | "reachable"
  | "unreachable"
  | "version_mismatch"
  | "unauthorized";

export interface PeerHostDto {
  id: string;
  ownerUserId: string;
  name: string;
  alias: string | null;
  tagColor: string | null;
  baseUrl: string;
  normalizedBaseUrl: string;
  status: PeerHostStatus;
  remoteVersion: string | null;
  remoteApiCompatibility: string | null;
  remoteHostFingerprint: string | null;
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
  createdAt: string;
  updatedAt: string;
  removedAt: string | null;
}

export interface PeerHostSessionDto {
  exists: true;
  username: string;
  remoteUserId: string;
  remoteUsername: string;
  expiresAt: string | null;
  savedAt: string;
  updatedAt: string;
}

export interface PeerHostCreatePayload {
  name?: string;
  alias?: string | null;
  tagColor?: string | null;
  baseUrl: string;
}

export interface PeerHostUpdatePayload {
  name?: string;
  alias?: string | null;
  tagColor?: string | null;
  baseUrl?: string;
}

export interface PeerHostLoginPayload {
  username: string;
  password: string;
}

export interface WorkspaceHostBindingDto {
  activeHostId: string;
  workspaceKey: string;
  selectedHostId: string;
  remoteWorkspaceId: string | null;
  remoteWorkspacePath: string | null;
  remoteWorkspaceName: string | null;
  updatedAt: string;
}

export interface WorkspaceHostBindingSavePayload {
  activeHostId: string;
  selectedHostId: string;
  remoteWorkspaceId?: string | null;
  remoteWorkspacePath?: string | null;
  remoteWorkspaceName?: string | null;
}

export interface PeerWorkspaceSummaryDto {
  workspaceId: string;
  runningSessionCount: number;
  unreadSessionCount: number;
  totalSessionCount: number;
  archivedSessionCount: number;
  latestSessionTitle: string | null;
  lastActivityAt: string | null;
  updatedAt: string;
}

export function listPeerHosts(): Promise<{ items: PeerHostDto[] }> {
  return httpClient.request<{ items: PeerHostDto[] }>("/api/peer-hosts");
}

export function createPeerHost(payload: PeerHostCreatePayload): Promise<PeerHostDto> {
  return httpClient.request<PeerHostDto>("/api/peer-hosts", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updatePeerHost(peerHostId: string, payload: PeerHostUpdatePayload): Promise<PeerHostDto> {
  return httpClient.request<PeerHostDto>(`/api/peer-hosts/${encodeURIComponent(peerHostId)}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deletePeerHost(peerHostId: string): Promise<{ success: true; peerHostId: string }> {
  return httpClient.request<{ success: true; peerHostId: string }>(
    `/api/peer-hosts/${encodeURIComponent(peerHostId)}`,
    { method: "DELETE" }
  );
}

export function checkPeerHost(peerHostId: string): Promise<PeerHostDto> {
  return httpClient.request<PeerHostDto>(`/api/peer-hosts/${encodeURIComponent(peerHostId)}/check`, {
    method: "POST"
  });
}

export function reconnectPeerHost(peerHostId: string): Promise<PeerHostDto> {
  return httpClient.request<PeerHostDto>(`/api/peer-hosts/${encodeURIComponent(peerHostId)}/reconnect`, {
    method: "POST"
  });
}

export function loginPeerHost(
  peerHostId: string,
  payload: PeerHostLoginPayload
): Promise<PeerHostSessionDto> {
  return httpClient.request<PeerHostSessionDto>(
    `/api/peer-hosts/${encodeURIComponent(peerHostId)}/login`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function deletePeerHostSession(peerHostId: string): Promise<{ success: true; peerHostId: string }> {
  return httpClient.request<{ success: true; peerHostId: string }>(
    `/api/peer-hosts/${encodeURIComponent(peerHostId)}/session`,
    { method: "DELETE" }
  );
}

export function listWorkspaceHostBindings(): Promise<{ items: WorkspaceHostBindingDto[] }> {
  return httpClient.request<{ items: WorkspaceHostBindingDto[] }>("/api/peer-hosts/workspace-bindings");
}

export function saveWorkspaceHostBinding(
  workspaceKey: string,
  payload: WorkspaceHostBindingSavePayload
): Promise<WorkspaceHostBindingDto> {
  return httpClient.request<WorkspaceHostBindingDto>(
    `/api/peer-hosts/workspace-bindings/${encodeURIComponent(workspaceKey)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload)
    }
  );
}

export function listPeerWorkspaceSummaries(
  targetHostId: string,
  workspaceIds: string[]
): Promise<{ items: Array<{ workspaceId: string; summary: PeerWorkspaceSummaryDto }> }> {
  const search = new URLSearchParams();
  workspaceIds.forEach((workspaceId) => {
    const normalized = workspaceId.trim();
    if (normalized) {
      search.append("workspaceId", normalized);
    }
  });

  return httpClient.request<{ items: Array<{ workspaceId: string; summary: PeerWorkspaceSummaryDto }> }>(
    `/api/workbench/peer-workspace-summaries?${search.toString()}`,
    {
      targetHostId
    }
  );
}
