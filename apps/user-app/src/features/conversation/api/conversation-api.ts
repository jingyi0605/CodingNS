import { httpClient } from "../../../network/http-client";
import { ApiError } from "../../../shared/network/api-error";

export type ProviderId = "claude-code" | "codex";
export type SyncStatus = "idle" | "syncing" | "error";
export type DeliveryState = "sending" | "sent" | "failed";
export type MessageKind = "text" | "thinking" | "tool_call" | "tool_result";
export type SessionRunningState =
  | "idle"
  | "starting"
  | "running"
  | "reconnecting"
  | "completed"
  | "interrupted"
  | "failed";
export type SessionActivityState = "idle" | "running" | "completed_unread";
export type SessionActivitySource = "none" | "runtime" | "inferred";
export type HistoryDirection = "forward" | "backward";

export interface ToolCallDto {
  callId: string;
  name: string;
  input: string;
  output: string | null;
  error: string | null;
  status: "running" | "completed" | "failed";
}

export interface MessageAttachmentDto {
  id: string;
  kind: "image";
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export interface ImageAttachmentPayload {
  fileName: string;
  mimeType: string;
  fileSize: number;
  contentBase64: string;
}

export interface WorkspaceDto {
  id: string;
  name: string;
  path: string;
  repoRoot: string | null;
}

export interface ProviderModelOptionDto {
  id: string;
  name: string;
  usesProviderDefault?: boolean;
}

export interface ImportWorkspacePayload {
  path: string;
  name?: string;
}

export interface WorkspaceDirectoryOptionDto {
  path: string;
  name: string;
}

export interface WorkspaceDirectoryBrowseDto {
  currentPath: string;
  parentPath: string | null;
  roots: WorkspaceDirectoryOptionDto[];
  items: WorkspaceDirectoryOptionDto[];
}

export interface SessionSummaryDto {
  sessionId: string;
  workspaceId: string;
  provider: ProviderId;
  providerSessionId: string;
  rawStoreRef: string;
  parentSessionId?: string | null;
  isSubagent?: boolean;
  subagentLabel?: string | null;
  isArchived?: boolean;
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

export interface ProviderCapabilitiesDto {
  provider: ProviderId;
  canStartSession: boolean;
  canResumeSession: boolean;
  canSendMessage?: boolean;
  supportsSubagents: boolean;
  supportsInterrupt: boolean;
  supportsStructuredToolCalls: boolean;
  supportsTokenUsage: boolean;
  supportsAttachments: boolean;
  supportsPermissionPrompt: boolean;
  supportsCheckpoint: boolean;
  modelOptions?: ProviderModelOptionDto[];
  limitations: string[];
}

export interface HistoryMessageDto {
  messageId: string;
  provider: ProviderId;
  providerSessionId: string;
  role: "user" | "assistant" | "tool" | "system";
  kind?: MessageKind;
  content: string;
  toolCall?: ToolCallDto | null;
  attachments?: MessageAttachmentDto[];
  timestamp: string;
  sequence: number;
  rawRef: string;
}

export interface HistoryPageDto {
  messages: HistoryMessageDto[];
  cursor: string | null;
  nextCursor: string | null;
  total: number;
}

export interface WorkbenchSnapshotItemDto {
  workspace: WorkspaceDto;
  sessions: SessionSummaryDto[];
}

export interface WorkbenchSnapshotDto {
  items: WorkbenchSnapshotItemDto[];
}

export interface SendMessageResponseDto {
  sessionId: string;
  acceptedAt: string;
  clientRequestId: string | null;
  message: HistoryMessageDto;
}

export interface StartSessionPayload {
  workspaceId: string;
  provider: ProviderId;
  initialPrompt?: string;
}

export interface StartLivePayload {
  workspaceId: string;
  provider: ProviderId;
  content: string;
  clientRequestId?: string | null;
  model?: string | null;
  reasoningLevel?: string | null;
  attachments?: ImageAttachmentPayload[];
}

export interface SendLiveMessagePayload {
  content: string;
  clientRequestId: string;
  model?: string | null;
  reasoningLevel?: string | null;
  attachments?: ImageAttachmentPayload[];
}

export interface StartLiveResponseDto extends SendMessageResponseDto {
  provider: ProviderId;
  providerSessionId: string;
  session?: SessionSummaryDto;
}

export interface SessionRuntimeDto {
  sessionId: string;
  runningState: SessionRunningState;
  hasActiveRun: boolean;
  canAttach: boolean;
  canInterrupt: boolean;
  provider: ProviderId;
  providerSessionId: string;
  detail: string | null;
  updatedAt: string;
}

export interface InterruptSessionResponseDto {
  sessionId: string;
  interrupted: boolean;
  detail?: string | null;
}

export interface SessionChangedFileDto {
  sessionId: string;
  workspaceId: string;
  path: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  lastToolName: string | null;
}

export function listWorkspaces() {
  return httpClient.request<{ items: WorkspaceDto[] }>("/api/workspaces");
}

export async function getWorkbenchSnapshot() {
  try {
    return await httpClient.request<WorkbenchSnapshotDto>("/api/workbench");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) {
      throw error;
    }

    const workspaceResponse = await listWorkspaces();
    const sessionResponses = await Promise.all(
      workspaceResponse.items.map(async (workspace) => ({
        workspace,
        sessions: (await listWorkspaceSessions(workspace.id)).items
      }))
    );

    return {
      items: sessionResponses
    } satisfies WorkbenchSnapshotDto;
  }
}

export function importWorkspace(payload: ImportWorkspacePayload) {
  return httpClient.request<WorkspaceDto>("/api/workspaces/import", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function browseWorkspaceDirectories(targetPath?: string) {
  const search = new URLSearchParams();

  if (targetPath?.trim()) {
    search.set("path", targetPath.trim());
  }

  return httpClient.request<WorkspaceDirectoryBrowseDto>(
    `/api/workspaces/browse${search.size > 0 ? `?${search.toString()}` : ""}`
  );
}

export function listWorkspaceSessions(workspaceId: string) {
  return httpClient.request<{ items: SessionSummaryDto[] }>(
    `/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}`
  );
}

export function startSession(payload: StartSessionPayload) {
  return httpClient.request<SessionSummaryDto>("/api/sessions/start", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getSessionDetail(sessionId: string) {
  return httpClient.request<SessionSummaryDto>(`/api/sessions/${encodeURIComponent(sessionId)}`);
}

export function getSessionChangedFiles(sessionId: string) {
  return httpClient.request<{ items: SessionChangedFileDto[] }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/changed-files`
  );
}

export function markSessionSeen(sessionId: string) {
  return httpClient.request<void>(`/api/sessions/${encodeURIComponent(sessionId)}/seen`, {
    method: "POST"
  });
}

export function renameSessionTitle(sessionId: string, title: string) {
  return httpClient.request<SessionSummaryDto>(`/api/sessions/${encodeURIComponent(sessionId)}/title`, {
    method: "PATCH",
    body: JSON.stringify({ title })
  });
}

export function updateSessionArchiveState(sessionId: string, archived: boolean) {
  return httpClient.request<SessionSummaryDto>(`/api/sessions/${encodeURIComponent(sessionId)}/archive`, {
    method: "PATCH",
    body: JSON.stringify({ archived })
  });
}

export function getSessionCapabilities(sessionId: string) {
  return httpClient.request<ProviderCapabilitiesDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/capabilities`
  );
}

export function getProviderCapabilities(provider: ProviderId, workspaceId?: string) {
  const search = new URLSearchParams();

  if (workspaceId?.trim()) {
    search.set("workspaceId", workspaceId.trim());
  }

  return httpClient.request<ProviderCapabilitiesDto>(
    `/api/providers/${encodeURIComponent(provider)}/capabilities${
      search.size > 0 ? `?${search.toString()}` : ""
    }`
  );
}

export function getSessionMessages(
  sessionId: string,
  cursor: string | null,
  limit: number,
  direction: HistoryDirection = "forward"
) {
  const search = new URLSearchParams();

  if (cursor) {
    search.set("cursor", cursor);
  }

  search.set("limit", String(limit));
  search.set("direction", direction);

  return httpClient.request<HistoryPageDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages?${search.toString()}`
  );
}

export function getSessionAttachmentBlob(sessionId: string, attachmentId: string) {
  return httpClient.requestBlob(
    `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}/content`
  );
}

export function sendSessionMessage(
  sessionId: string,
  payload: { content: string; clientRequestId: string }
) {
  return httpClient.request<SendMessageResponseDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function startLiveSession(payload: StartLivePayload) {
  return httpClient.request<StartLiveResponseDto>("/api/sessions/start-live", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function sendLiveMessage(
  sessionId: string,
  payload: SendLiveMessagePayload
) {
  return httpClient.request<SendMessageResponseDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages/live`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function getSessionRuntime(sessionId: string) {
  return httpClient.request<SessionRuntimeDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/runtime`
  );
}

export function interruptSession(sessionId: string) {
  return httpClient.request<InterruptSessionResponseDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/interrupt`,
    {
      method: "POST"
    }
  );
}
