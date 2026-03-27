import { httpClient } from "../../../network/http-client";
import { ApiError } from "../../../shared/network/api-error";

export type BuiltinProviderId = "claude-code" | "codex" | "opencode";
export type ProviderId = BuiltinProviderId | (string & {});
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
export type InRunInputMode = "none" | "streaming_guidance" | "queued_guidance";
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

export interface WorkspaceGitRemoteDto {
  name: string;
  url: string;
}

export interface WorkspaceManagementGitDto {
  isRepository: boolean;
  repoRoot: string | null;
  currentBranch: string | null;
  commitCount: number | null;
  remotes: WorkspaceGitRemoteDto[];
  error: string | null;
}

export interface WorkspaceCodeCompositionItemDto {
  type: string;
  count: number;
  ratio: number;
}

export interface WorkspaceCodeCompositionDto {
  scannedFileCount: number;
  truncated: boolean;
  items: WorkspaceCodeCompositionItemDto[];
  error: string | null;
}

export interface WorkspaceManagementSummaryDto {
  workspaceId: string;
  name: string;
  path: string;
  git: WorkspaceManagementGitDto;
  codeComposition: WorkspaceCodeCompositionDto;
}

export interface ProviderModelOptionDto {
  id: string;
  name: string;
  usesProviderDefault?: boolean;
  supportedReasoningEfforts?: string[];
}

export interface ImportWorkspacePayload {
  path: string;
  name?: string;
}

export type CloneWorkspaceAuthMode = "none" | "basic" | "token";

export interface CloneWorkspacePayload {
  repositoryUrl: string;
  parentPath: string;
  directoryName?: string;
  name?: string;
  auth?:
    | {
        mode?: "none";
      }
    | {
        mode: "basic";
        username?: string;
        password?: string;
      }
    | {
        mode: "token";
        username?: string;
        token?: string;
      };
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

export interface CreateWorkspaceDirectoryPayload {
  parentPath: string;
  directoryName: string;
}

export interface WorkspaceCreatedDirectoryDto {
  path: string;
  name: string;
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
  isFavorite?: boolean;
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
  inRunInputMode: InRunInputMode;
  supportsSubagents: boolean;
  supportsInterrupt: boolean;
  supportsStructuredToolCalls: boolean;
  supportsTokenUsage: boolean;
  supportsAttachments: boolean;
  supportsPermissionPrompt: boolean;
  supportsCheckpoint: boolean;
  supportsTodo?: boolean;
  supportsSessionDiff?: boolean;
  supportsPermissionRequests?: boolean;
  supportsSessionFork?: boolean;
  supportsSessionShare?: boolean;
  supportsAsyncPrompt?: boolean;
  supportsNativeAgents?: boolean;
  modelOptions?: ProviderModelOptionDto[];
  defaultReasoningLevel?: string | null;
  limitations: string[];
  // 新增补充字段，方便前端收口 provider 行为判定
  supportsSlashMenu?: boolean;
  supportsReasoningSelector?: boolean;
  supportsRunSteering?: boolean;
  supportsQueueWhileRunning?: boolean;
  supportsRulesMessageFolding?: boolean;
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
  permissionMode?: string | null;
  attachments?: ImageAttachmentPayload[];
}

export interface SendLiveMessagePayload {
  content: string;
  clientRequestId: string;
  model?: string | null;
  reasoningLevel?: string | null;
  permissionMode?: string | null;
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
  inRunInputMode: InRunInputMode;
  provider: ProviderId;
  providerSessionId: string;
  detail: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  updatedAt: string;
  contextUsage: ContextUsageDto | null;
}

export interface SessionQueueItemDto {
  id: string;
  sessionId: string;
  content: string;
  clientRequestId: string | null;
  model: string | null;
  reasoningLevel: string | null;
  permissionMode: string | null;
  status: "queued" | "dispatching" | "failed";
  orderIndex: number;
  errorDetail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContextUsageDto {
  provider: ProviderId;
  promptTokens: number;
  uncachedInputTokens: number;
  cachedInputTokens: number;
  contextWindow: number;
  usageRatio: number;
  source: "provider-log" | "provider-runtime" | "provider-config" | "model-map";
  contextWindowSource: "provider-log" | "provider-runtime" | "provider-config" | "model-map";
  modelId: string | null;
  capturedAt: string | null;
  isEstimated: boolean;
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

export function cloneWorkspace(payload: CloneWorkspacePayload) {
  return httpClient.request<WorkspaceDto>("/api/workspaces/clone", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getWorkspaceManagementSummary(workspaceId: string) {
  return httpClient.request<WorkspaceManagementSummaryDto>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/management`
  );
}

export function removeWorkspace(workspaceId: string) {
  return httpClient.request<WorkspaceDto>(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: "DELETE"
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

export function createWorkspaceDirectory(payload: CreateWorkspaceDirectoryPayload) {
  return httpClient.request<WorkspaceCreatedDirectoryDto>("/api/workspaces/directories", {
    method: "POST",
    body: JSON.stringify(payload)
  });
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

export function updateSessionFavoriteState(sessionId: string, favorite: boolean) {
  return httpClient.request<SessionSummaryDto>(`/api/sessions/${encodeURIComponent(sessionId)}/favorite`, {
    method: "PATCH",
    body: JSON.stringify({ favorite })
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

export function getSessionQueue(sessionId: string) {
  return httpClient.request<{ items: SessionQueueItemDto[] }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/queue`
  );
}

export function enqueueSessionMessage(
  sessionId: string,
  payload: SendLiveMessagePayload
) {
  return httpClient.request<SessionQueueItemDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/queue`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function deleteSessionQueueItem(sessionId: string, queueItemId: string) {
  return httpClient.request<void>(
    `/api/sessions/${encodeURIComponent(sessionId)}/queue/${encodeURIComponent(queueItemId)}`,
    {
      method: "DELETE"
    }
  );
}

export function steerSessionQueueItem(sessionId: string, queueItemId: string) {
  return httpClient.request<StartLiveResponseDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/queue/${encodeURIComponent(queueItemId)}/steer`,
    {
      method: "POST"
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
