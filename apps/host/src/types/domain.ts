import type { ProviderId, SyncStatus } from "@codingns/session-sync-core";

export interface BootstrapState {
  id: "default";
  initialized: boolean;
  initializedAt: string | null;
  initializedByUserId: string | null;
}

export interface AuthUser {
  id: string;
  username: string;
  passwordHash: string;
  role: "admin";
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokenRecord {
  id: string;
  userId: string;
  tokenType: "access" | "refresh";
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  repoRoot: string | null;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionBinding {
  sessionId: string;
  workspaceId: string;
  provider: ProviderId;
  providerSessionId: string;
  rawStoreRef: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionIndexRecord {
  sessionId: string;
  workspaceId: string;
  provider: ProviderId;
  title: string;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionStatusSnapshot {
  sessionId: string;
  syncStatus: SyncStatus;
  syncCursor: string | null;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
  resumedAt: string | null;
  updatedAt: string;
}

export interface SessionListItem {
  sessionId: string;
  workspaceId: string;
  provider: ProviderId;
  providerSessionId: string;
  rawStoreRef: string;
  title: string;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus | null;
  syncCursor: string | null;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
  resumedAt: string | null;
}
