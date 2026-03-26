import type { ProviderId, SyncStatus } from "@codingns/session-sync-core";

export type SessionRunningState =
  | "idle"
  | "starting"
  | "running"
  | "completed"
  | "interrupted"
  | "failed";
export type SessionActivityState = "idle" | "running" | "completed_unread";
export type SessionActivitySource = "none" | "runtime" | "inferred";

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
  removedAt?: string | null;
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
  isArchived: boolean;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionChangedFileRecord {
  sessionId: string;
  workspaceId: string;
  path: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  lastToolName: string | null;
}

export interface SessionChangedFileIndexState {
  sessionId: string;
  indexedAt: string;
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

export interface SessionStateRecord {
  sessionId: string;
  userId: string;
  runningState: SessionRunningState;
  activitySource: SessionActivitySource;
  lastEventAt: string | null;
  completedAt: string | null;
  lastSeenAt: string | null;
  updatedAt: string;
}

export interface SessionMessageAttachmentRecord {
  id: string;
  sessionId: string;
  clientRequestId: string;
  messageId: string | null;
  kind: "image";
  fileName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  createdAt: string;
}

export type SessionSendQueueStatus = "queued" | "dispatching" | "failed";

export interface SessionSendQueueItemRecord {
  id: string;
  sessionId: string;
  userId: string;
  content: string;
  clientRequestId: string | null;
  model: string | null;
  reasoningLevel: string | null;
  permissionMode: string | null;
  status: SessionSendQueueStatus;
  orderIndex: number;
  errorDetail: string | null;
  createdAt: string;
  updatedAt: string;
  dispatchedAt: string | null;
}

export interface SessionListItem {
  sessionId: string;
  workspaceId: string;
  provider: ProviderId;
  providerSessionId: string;
  rawStoreRef: string;
  parentSessionId?: string | null;
  isSubagent?: boolean;
  subagentLabel?: string | null;
  isArchived: boolean;
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
  runningState: SessionRunningState | null;
  activitySource: SessionActivitySource;
  lastEventAt: string | null;
  completedAt: string | null;
  lastSeenAt: string | null;
  activityState: SessionActivityState;
}

export interface FileNode {
  path: string;
  name: string;
  kind: "file" | "directory";
  size: number | null;
  updatedAt: string | null;
}

export interface FileSnapshot {
  workspaceId: string;
  path: string;
  content: string;
  encoding: "utf-8";
  version: string;
  size: number;
  updatedAt: string;
}

export interface FileSearchItem {
  path: string;
  name: string;
  kind: "file" | "directory";
  size: number | null;
  updatedAt: string | null;
}

export interface RecentFileRecord {
  id: string;
  workspaceId: string;
  userId: string;
  path: string;
  lastOpenedAt: string;
  pinned: boolean;
}

export interface FileContextBinding {
  id: string;
  sessionId: string;
  workspaceId: string;
  path: string;
  displayName: string;
  selected: boolean;
  pinned: boolean;
  rangeStart: number | null;
  rangeEnd: number | null;
  contentHash: string;
  fileVersion: string;
  attachedBy: string;
  attachedAt: string;
}

export type PersistentTerminalRuntimeType =
  | "tmux"
  | "conpty-powershell"
  | "conpty-cmd"
  | "conpty-git-bash";
export type TerminalRuntimeType = PersistentTerminalRuntimeType | "embedded-pty";
export type TerminalStatus = "creating" | "running" | "closed" | "error";
export type TerminalRuntimeSessionState =
  | "starting"
  | "running"
  | "lost"
  | "closed"
  | "error";

export interface TerminalInstance {
  id: string;
  workspaceId: string;
  name: string;
  cwd: string;
  shell: string;
  runtimeType: TerminalRuntimeType;
  runtimeSessionId: string;
  attachTarget: string;
  status: TerminalStatus;
  processId: number | null;
  createdByUserId: string;
  createdAt: string;
  lastActiveAt: string;
  closedAt: string | null;
  exitCode: number | null;
  statusDetail: string | null;
}

export interface TerminalRuntimeSession {
  id: string;
  terminalId: string;
  runtimeType: TerminalRuntimeType;
  sessionKey: string;
  attachTarget: string;
  hostInstanceId: string | null;
  agentPid: number | null;
  shellPid: number | null;
  state: TerminalRuntimeSessionState;
  lastHeartbeatAt: string | null;
  lastCheckedAt: string | null;
  lastErrorDetail: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TerminalConnectionState = "connected" | "disconnected" | "reconnecting";

export interface TerminalConnection {
  connectionId: string;
  terminalId: string;
  userId: string;
  lastCursor: string | null;
  state: TerminalConnectionState;
  connectedAt: string;
}

export interface TerminalOutputChunk {
  terminalId: string;
  cursor: string;
  stream: "stdout";
  content: string;
  timestamp: string;
}

export interface TerminalCommandTemplate {
  id: string;
  workspaceId: string;
  name: string;
  cwd: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  port: number | null;
  runtimeType: TerminalRuntimeType | null;
  createdAt: string;
  updatedAt: string;
}

export interface TerminalTemplateRuntimeStatus {
  templateId: string;
  port: number;
  occupied: boolean;
  processId: number | null;
  processName: string | null;
  processCommandLine: string | null;
}
