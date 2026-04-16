import { httpClient } from "../../../network/http-client";
import { ApiError } from "../../../shared/network/api-error";

export type BuiltinProviderId =
  | "claude-code"
  | "codex"
  | "opencode"
  | "gemini"
  | "kimi";
export type ProviderId = BuiltinProviderId | (string & {});
export type SyncStatus = "idle" | "syncing" | "error";
export type DeliveryState = "sending" | "sent" | "failed";
export type MessageKind = "text" | "thinking" | "tool_call" | "tool_result";
export type SessionRunningState =
  | "idle"
  | "starting"
  | "running"
  | "reconnecting"
  | "stale"
  | "unknown"
  | "completed"
  | "interrupted"
  | "failed";
export type SessionActivityState = "idle" | "running" | "completed_unread";
export type InRunInputMode = "none" | "streaming_guidance" | "queued_guidance";
export type SessionActivitySource = "none" | "runtime" | "inferred";
export type SessionActivityResolutionSource =
  | "authoritative_runtime"
  | "authoritative_provider_event"
  | "inferred_log"
  | "unknown";
export type SessionActivityConfidence = "authoritative" | "strong" | "weak";
export type SessionInterruptSource = "user" | "runtime";
export type HistoryDirection = "forward" | "backward";
export type SessionKind = "default" | "annotation";
export type ForkSourceType = "session" | "message";
export type ForkMethod =
  | "native_session_fork"
  | "native_message_fork"
  | "reconstructed_session_fork"
  | "reconstructed_message_fork";
export type ForkStrategy = "auto" | "native-only" | "reconstruct-only";

export interface ForkSourceMessageSnapshotDto {
  role: "user" | "assistant" | "tool" | "system";
  kind: MessageKind;
  content: string;
}

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
  kind: "image" | "file";
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export interface AttachmentPayload {
  kind: "image" | "file";
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
  backgroundColor?: string | null;
  sortOrder?: number;
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

export type DebugServiceRoleDto = "frontend" | "backend" | "worker" | "mock" | "custom";
export type FrameworkAnalysisConfidenceDto = "high" | "medium" | "low";
export type FrameworkCompatibilityLevelDto = "supported" | "conditional" | "unsupported" | "unknown";
export type DebugInjectionModeDto = "cli" | "env" | "override" | "ai_fallback" | "none";
export type DebugAiFallbackPolicyDto = "never" | "conditional" | "allowed";
export type DebugRuntimeSessionStatusDto = "PREPARING" | "RUNNING" | "FAILED" | "STOPPED";

export interface DebugTargetProfileDto {
  id: string;
  workspaceId: string;
  rootPath: string;
  displayName: string;
  stackHint?: string | null;
  sourceType: "repo" | "worktree";
  rootWorkspaceId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DebugServiceSpecDto {
  id: string;
  targetId: string;
  role: DebugServiceRoleDto;
  name: string;
  cwd: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  defaultPortHint?: number | null;
  protocol?: "http" | "ws" | "tcp" | null;
  healthPath?: string | null;
  adapterKind?: "cli" | "env" | "override" | "ai_fallback" | null;
  frameworkAnalysisId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FrameworkAnalysisResultDto {
  id: string;
  targetId: string;
  serviceId?: string | null;
  primaryFramework?: string | null;
  confidence: FrameworkAnalysisConfidenceDto;
  compatibilityLevel: FrameworkCompatibilityLevelDto;
  recommendedInjectionMode?: DebugInjectionModeDto | null;
  requiresServiceDiscoveryHandling: boolean;
  requiresHmrHandling: boolean;
  requiresCallbackHandling: boolean;
  aiFallbackPolicy: DebugAiFallbackPolicyDto;
  reasons: string[];
  detectedFiles: string[];
  rawEvidence?: Record<string, unknown>;
  createdAt: string;
}

export interface DebugRuntimeSessionDto {
  id: string;
  targetId: string;
  status: DebugRuntimeSessionStatusDto;
  failureStage?: string | null;
  startedAt?: string | null;
  stoppedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PortLeaseRecordDto {
  id: string;
  runtimeId: string;
  serviceId: string;
  port: number;
  protocol: "tcp" | "udp";
  status: "LEASED" | "RELEASING" | "RELEASED" | "STALE";
  leasedAt: string;
  expiresAt?: string | null;
  releasedAt?: string | null;
}

export interface RuntimeBindingDto {
  id: string;
  runtimeId: string;
  serviceId: string;
  processInstanceId?: string | null;
  expectedPort?: number | null;
  leasedPort?: number | null;
  observedPort?: number | null;
  proxyPath?: string | null;
  status: "ALLOCATED" | "LISTENING" | "FAILED" | "RELEASED";
  updatedAt: string;
}

export interface AiFallbackEditRecordDto {
  id: string;
  runtimeId: string;
  serviceId: string;
  reason: string;
  allowedFiles: string[];
  targetPort: number;
  patchRef?: string | null;
  rollbackRef?: string | null;
  status: "PENDING" | "APPLIED" | "ROLLED_BACK" | "REJECTED";
  createdAt: string;
}

export interface TerminalInstanceDebugDto {
  id: string;
  workspaceId: string;
  name: string;
  cwd: string;
  shell: string;
  runtimeType: string;
  runtimeSessionId: string;
  attachTarget: string;
  status: "creating" | "running" | "closed" | "error";
  processId: number | null;
  createdByUserId: string;
  createdAt: string;
  lastActiveAt: string;
  closedAt: string | null;
  exitCode: number | null;
  statusDetail: string | null;
  debugRuntimeSessionId?: string | null;
  debugTargetId?: string | null;
  debugServiceId?: string | null;
  frameworkAnalysisId?: string | null;
  launcherSourceType?: "manual" | "debug_service" | null;
  launchStage?: string | null;
  failureStage?: string | null;
  adapterKind?: "cli" | "env" | "override" | "ai_fallback" | null;
  envPatchSummary?: Record<string, unknown>;
  artifactRef?: string | null;
}

export interface DebugRuntimeDetailServiceItemDto {
  service: DebugServiceSpecDto;
  analysis: FrameworkAnalysisResultDto | null;
  binding: RuntimeBindingDto | null;
  portLease: PortLeaseRecordDto | null;
  processInstance: TerminalInstanceDebugDto | null;
  aiFallbackEdits: AiFallbackEditRecordDto[];
}

export interface DebugRuntimeDetailDto {
  runtimeSession: DebugRuntimeSessionDto;
  target: DebugTargetProfileDto;
  services: DebugRuntimeDetailServiceItemDto[];
}

export interface DebugRuntimeHistoryEnvelopeDto {
  targetId: string;
  items: DebugRuntimeDetailDto[];
}

export interface DebugTargetAnalysisEnvelopeDto {
  target: DebugTargetProfileDto;
  services: DebugServiceSpecDto[];
  analyses: FrameworkAnalysisResultDto[];
  autoInjectionEligible: boolean;
}

export interface FrameworkAnalysisListEnvelopeDto {
  targetId: string;
  items: FrameworkAnalysisResultDto[];
}

export interface FrameworkCompatibilityMatrixItemDto {
  framework: string;
  compatibilityLevel: FrameworkCompatibilityLevelDto;
  recommendedInjectionMode: DebugInjectionModeDto;
  requiresServiceDiscoveryHandling: boolean;
  requiresHmrHandling: boolean;
  requiresCallbackHandling: boolean;
  aiFallbackPolicy: DebugAiFallbackPolicyDto;
  notes: string;
}

export interface FrameworkCompatibilityMatrixDto {
  version: string;
  items: FrameworkCompatibilityMatrixItemDto[];
}

export interface DebugLaunchAdapterAttemptDto {
  kind: "cli" | "env" | "override" | "ai_fallback";
  status: "selected" | "blocked" | "fallback_required" | "skipped";
  reason: string;
}

export interface DebugAiFallbackSummaryDto {
  eligible: boolean;
  editId: string | null;
  status: "PENDING" | "APPLIED" | "ROLLED_BACK" | "REJECTED" | null;
  reason: string;
  allowedFiles: string[];
}

export interface DebugLaunchPlanServiceItemDto {
  serviceId: string;
  role: DebugServiceRoleDto;
  frameworkAnalysisId: string | null;
  primaryFramework: string | null;
  compatibilityLevel: FrameworkCompatibilityLevelDto;
  adapterKind: "cli" | "env" | "override" | "ai_fallback" | null;
  injectionMode: DebugInjectionModeDto | null;
  command: string;
  args: string[];
  envPatch: Record<string, string>;
  expectedPort: number | null;
  leasedPort: number | null;
  artifactRef: string | null;
  runtimeBindingId: string;
  portLeaseId: string | null;
  requiresServiceDiscoveryHandling: boolean;
  requiresHmrHandling: boolean;
  requiresCallbackHandling: boolean;
  failureStage: string | null;
  adapterAttempts: DebugLaunchAdapterAttemptDto[];
  aiFallback: DebugAiFallbackSummaryDto | null;
  missingRequirements: string[];
  autoStartAllowed: boolean;
}

export interface DebugLaunchPlanDto {
  runtimeSession: DebugRuntimeSessionDto;
  targetId: string;
  autoStartAllowed: boolean;
  services: DebugLaunchPlanServiceItemDto[];
}

export interface DebugTargetPortRequestDto {
  serviceId?: string | null;
  role?: DebugServiceRoleDto | null;
  cwd?: string | null;
  name?: string | null;
  command?: string | null;
  port: number;
}

export interface RunDebugTargetPayload {
  shell?: string;
  runtimeType?: string | null;
  portRequests?: DebugTargetPortRequestDto[];
}

export interface RunDebugTargetResultDto {
  runtimeSession: DebugRuntimeSessionDto;
  services: Array<{
    serviceId: string;
    processInstanceId: string;
    terminalId: string;
    leasedPort: number | null;
    runtimeBindingId: string;
  }>;
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

export interface ReorderWorkspacesPayload {
  workspaceIds: string[];
}

export interface WorkspaceNavigationStateDto {
  workspaceId: string;
  userId: string;
  collapsed: boolean;
  backgroundColor: string | null;
  updatedAt: string;
}

export interface SessionSummaryDto {
  sessionId: string;
  workspaceId: string;
  provider: ProviderId;
  providerSessionId: string;
  rawStoreRef: string;
  parentSessionId?: string | null;
  sessionKind?: SessionKind;
  annotationSourceMessageId?: string | null;
  annotationSourceText?: string | null;
  forkMethod?: ForkMethod | null;
  forkSourceType?: ForkSourceType | null;
  forkSourceSessionId?: string | null;
  forkSourceMessageId?: string | null;
  inheritedPrefixMessageCount?: number | null;
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
  activityResolutionSource?: SessionActivityResolutionSource;
  activityConfidence?: SessionActivityConfidence;
  runId?: string | null;
  lastEventAt: string | null;
  completedAt: string | null;
  lastSeenAt: string | null;
  watchdogTriggeredAt?: string | null;
  activityState: SessionActivityState;
}

export type SessionPermissionRequestKind =
  | "tool_call"
  | "command"
  | "file_change"
  | "permissions"
  | "user_input";
export type SessionPermissionRequestStatus =
  | "pending"
  | "approved"
  | "declined"
  | "cancelled"
  | "expired";
export type SessionPermissionRequestActionTone = "primary" | "neutral" | "danger";

export interface SessionPermissionRequestActionDto {
  value: string;
  label: string;
  tone: SessionPermissionRequestActionTone;
  description: string | null;
}

export interface SessionPermissionRequestQuestionOptionDto {
  label: string;
  description: string | null;
}

export interface SessionPermissionRequestQuestionDto {
  id: string;
  header: string;
  question: string;
  allowOther: boolean;
  secret: boolean;
  options: SessionPermissionRequestQuestionOptionDto[];
}

export interface SessionPermissionProfileDto {
  readPaths: string[];
  writePaths: string[];
  networkEnabled: boolean | null;
}

export interface SessionPermissionRequestDto {
  id: string;
  sessionId: string;
  provider: ProviderId;
  providerSessionId: string;
  requestKey: string;
  kind: SessionPermissionRequestKind;
  status: SessionPermissionRequestStatus;
  title: string;
  summary: string;
  detail: string | null;
  reason: string | null;
  toolName: string | null;
  command: string | null;
  cwd: string | null;
  paths: string[];
  permissionProfile: SessionPermissionProfileDto | null;
  questions: SessionPermissionRequestQuestionDto[];
  actions: SessionPermissionRequestActionDto[];
  rawPayload: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface ReplyPermissionRequestPayload {
  action: string;
  answers?: Record<string, string[]>;
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
  origin?: "butler_proxy" | "system" | null;
  originRef?: string | null;
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
  childWorktrees?: WorkbenchWorktreeNodeDto[];
  collapsed?: boolean;
}

export interface WorkbenchSnapshotDto {
  items: WorkbenchSnapshotItemDto[];
}

export interface WorkbenchWorktreeNodeDto {
  workspace: WorkspaceDto;
  meta: {
    workspaceId: string;
    rootWorkspaceId: string;
    parentWorkspaceId: string;
    sourceWorkspaceId: string;
    mergeTargetWorkspaceId: string;
    branchName: string;
    baseRef: string;
    baseCommit: string;
    headCommit: string | null;
    displayName: string;
    depth: number;
    lifecycleStatus: "active" | "merged" | "abandoned" | "removing" | "removed";
    mergedAt: string | null;
    removedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  sessions: SessionSummaryDto[];
  children: WorkbenchWorktreeNodeDto[];
}

export interface CreateWorktreePayload {
  sourceWorkspaceId: string;
  branchName: string;
  displayName?: string;
  baseRef?: string;
}

export interface WorktreeMetaDto {
  workspaceId: string;
  rootWorkspaceId: string;
  parentWorkspaceId: string;
  sourceWorkspaceId: string;
  mergeTargetWorkspaceId: string;
  branchName: string;
  baseRef: string;
  baseCommit: string;
  headCommit: string | null;
  displayName: string;
  depth: number;
  lifecycleStatus: "active" | "merged" | "abandoned" | "removing" | "removed";
  mergedAt: string | null;
  removedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorktreeMergeBlockerDto {
  code:
    | "SOURCE_NOT_ACTIVE"
    | "SOURCE_DIRTY"
    | "TARGET_DIRTY"
    | "HAS_ACTIVE_CHILDREN"
    | "NO_COMMITS_TO_MERGE"
    | "HAS_CONFLICTS";
  detail: string;
}

export interface WorktreeMergePreviewDto {
  workspaceId: string;
  sourceWorkspace: WorkspaceDto;
  targetWorkspace: WorkspaceDto;
  meta: WorktreeMetaDto;
  sourceBranchName: string;
  targetBranchName: string;
  sourceHeadCommit: string | null;
  targetHeadCommit: string | null;
  mergeBaseCommit: string | null;
  ahead: number;
  behind: number;
  hasConflicts: boolean;
  conflictPaths: string[];
  alreadyMerged: boolean;
  canMerge: boolean;
  blockers: WorktreeMergeBlockerDto[];
}

export interface WorktreeMergeApplyResponseDto {
  preview: WorktreeMergePreviewDto;
  applied: boolean;
  mergeCommit: string | null;
  meta: WorktreeMetaDto;
}

export interface WorktreeCleanupResponseDto {
  workspaceId: string;
  removed: boolean;
  meta: WorktreeMetaDto;
  branchDeleteRequested: boolean;
  branchDeleted: boolean;
  deletedBranchName: string | null;
  branchDeleteError: string | null;
}

export interface CreateWorktreeResponseDto {
  workspace: WorkspaceDto;
  meta: WorktreeMetaDto;
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
  parentSessionId?: string | null;
  sessionKind?: SessionKind;
  annotationSourceMessageId?: string | null;
  annotationSourceText?: string | null;
}

export interface StartLivePayload {
  workspaceId: string;
  provider: ProviderId;
  content: string;
  clientRequestId?: string | null;
  model?: string | null;
  reasoningLevel?: string | null;
  permissionMode?: string | null;
  attachments?: AttachmentPayload[];
  parentSessionId?: string | null;
  sessionKind?: SessionKind;
  annotationSourceMessageId?: string | null;
  annotationSourceText?: string | null;
}

export interface SendLiveMessagePayload {
  content: string;
  clientRequestId: string;
  model?: string | null;
  reasoningLevel?: string | null;
  permissionMode?: string | null;
  attachments?: AttachmentPayload[];
}

export interface SendSessionMessagePayload {
  content: string;
  clientRequestId: string;
  permissionMode?: string | null;
}

export interface ForkSessionPayload {
  sourceType: ForkSourceType;
  sourceMessageId?: string | null;
  sourceMessageSnapshot?: ForkSourceMessageSnapshotDto | null;
  strategy?: ForkStrategy;
  targetProvider?: ProviderId | null;
  sessionKind?: SessionKind;
  annotationSourceMessageId?: string | null;
  annotationSourceText?: string | null;
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
  activityResolutionSource: SessionActivityResolutionSource;
  activityConfidence: SessionActivityConfidence;
  runId: string | null;
  detail: string | null;
  interruptSource: SessionInterruptSource | null;
  errorCode: string | null;
  errorDetail: string | null;
  updatedAt: string;
  watchdogTriggeredAt: string | null;
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

export interface SessionPermissionRequestListDto {
  items: SessionPermissionRequestDto[];
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

export interface QuickPhraseDto {
  id: string;
  text: string;
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

export function analyzeDebugTarget(payload: {
  workspaceId: string;
  rootPath: string;
  commandHints?: string[];
}) {
  return httpClient.request<DebugTargetAnalysisEnvelopeDto>("/api/debug-targets/analyze", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getFrameworkAnalysis(targetId: string) {
  return httpClient.request<FrameworkAnalysisListEnvelopeDto>(
    `/api/debug-targets/${encodeURIComponent(targetId)}/framework-analysis`
  );
}

export function createDebugLaunchPlan(
  targetId: string,
  payload?: { portRequests?: DebugTargetPortRequestDto[] }
) {
  return httpClient.request<DebugLaunchPlanDto>(
    `/api/debug-targets/${encodeURIComponent(targetId)}/launch-plan`,
    {
      method: "POST",
      body: JSON.stringify(payload ?? {})
    }
  );
}

export function getLatestDebugRuntime(targetId: string) {
  return httpClient.request<DebugRuntimeDetailDto | null>(
    `/api/debug-targets/${encodeURIComponent(targetId)}/runtime-latest`
  );
}

export function getRecentDebugRuntimes(targetId: string, limit = 5) {
  const search = new URLSearchParams();
  search.set("limit", String(limit));

  return httpClient.request<DebugRuntimeHistoryEnvelopeDto>(
    `/api/debug-targets/${encodeURIComponent(targetId)}/runtimes?${search.toString()}`
  );
}

export function getFrameworkCompatibilityMatrix() {
  return httpClient.request<FrameworkCompatibilityMatrixDto>("/api/framework-compatibility-matrix");
}

export function reorderWorkspaces(payload: ReorderWorkspacesPayload) {
  return httpClient.request<{ items: WorkspaceDto[] }>("/api/workspaces/reorder", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function updateWorkspaceNavigationState(
  workspaceId: string,
  payload: {
    collapsed?: boolean;
    backgroundColor?: string | null;
  }
) {
  return httpClient.request<WorkspaceNavigationStateDto>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/navigation-state`,
    {
      method: "PUT",
      body: JSON.stringify(payload)
    }
  );
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

export function createWorktree(payload: CreateWorktreePayload) {
  return httpClient.request<CreateWorktreeResponseDto>("/api/worktrees", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getWorktreeMergePreview(workspaceId: string) {
  return httpClient.request<WorktreeMergePreviewDto>(
    `/api/worktrees/${encodeURIComponent(workspaceId)}/merge-preview`,
    {
      method: "POST"
    }
  );
}

export function mergeWorktreeIntoParent(workspaceId: string) {
  return httpClient.request<WorktreeMergeApplyResponseDto>(
    `/api/worktrees/${encodeURIComponent(workspaceId)}/merge-into-parent`,
    {
      method: "POST"
    }
  );
}

export function cleanupWorktree(workspaceId: string, payload?: { deleteBranch?: boolean }) {
  return httpClient.request<WorktreeCleanupResponseDto>(
    `/api/worktrees/${encodeURIComponent(workspaceId)}/cleanup`,
    {
      method: "POST",
      body: JSON.stringify(payload ?? {})
    }
  );
}

export function getSessionCapabilities(sessionId: string) {
  return httpClient.request<ProviderCapabilitiesDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/capabilities`
  );
}

export function getSessionPermissionRequests(sessionId: string) {
  return httpClient.request<SessionPermissionRequestListDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/permission-requests`
  );
}

export function listQuickPhrases() {
  return httpClient.request<{ items: QuickPhraseDto[] }>("/api/preferences/quick-phrases");
}

export function replaceQuickPhrases(items: Array<{ id?: string; text: string }>) {
  return httpClient.request<{ items: QuickPhraseDto[] }>("/api/preferences/quick-phrases", {
    method: "PUT",
    body: JSON.stringify({ items })
  });
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

export async function listProviderCapabilities(
  providers: readonly ProviderId[],
  workspaceId?: string
): Promise<Partial<Record<ProviderId, ProviderCapabilitiesDto>>> {
  const results = await Promise.allSettled(
    providers.map(async (provider) => [provider, await getProviderCapabilities(provider, workspaceId)] as const)
  );
  const entries: Array<[ProviderId, ProviderCapabilitiesDto]> = [];

  for (const result of results) {
    if (result.status !== "fulfilled") {
      continue;
    }

    const [provider, capabilities] = result.value;
    entries.push([provider, capabilities]);
  }

  return Object.fromEntries(entries) as Partial<Record<ProviderId, ProviderCapabilitiesDto>>;
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
  payload: SendSessionMessagePayload
) {
  return httpClient.request<SendMessageResponseDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function forkSession(sessionId: string, payload: ForkSessionPayload) {
  return httpClient.request<SessionSummaryDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/forks`,
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

export function replySessionPermissionRequest(
  sessionId: string,
  requestId: string,
  payload: ReplyPermissionRequestPayload
) {
  return httpClient.request<SessionPermissionRequestDto>(
    `/api/sessions/${encodeURIComponent(sessionId)}/permission-requests/${encodeURIComponent(requestId)}/reply`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}
