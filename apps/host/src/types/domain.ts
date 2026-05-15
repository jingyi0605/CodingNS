import type {
  ForkMethod,
  ForkSourceType,
  ProviderId,
  SyncStatus
} from "@codingns/session-sync-core";

export type SessionRunningState =
  | "idle"
  | "starting"
  | "running"
  | "completed"
  | "interrupted"
  | "failed";
export type SessionResolvedRunningState =
  | SessionRunningState
  | "stale"
  | "unknown";
export type SessionActivityState = "idle" | "running" | "completed_unread";
export type SessionActivitySource = "none" | "runtime" | "inferred";
export type SessionActivityResolutionSource =
  | "authoritative_runtime"
  | "authoritative_provider_event"
  | "inferred_log"
  | "unknown";
export type SessionActivityConfidence = "authoritative" | "strong" | "weak";
export type SessionInterruptSource = "user" | "runtime";
export type SessionProviderConfigMode = "global-default" | "cc-switch-preset";

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
  deviceSessionId: string | null;
  callerKind: "interactive_user" | "assistant_runtime" | "workspace_session" | null;
  capabilityProfile: string | null;
  workspaceId: string | null;
  projectId: string | null;
  sessionId: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export type AuthClientType = "desktop" | "web" | "ios" | "android" | "unknown";

export interface AuthDeviceRecord {
  id: string;
  userId: string;
  clientType: AuthClientType;
  clientInstanceId: string | null;
  displayName: string | null;
  userAgent: string | null;
  isPrimary: boolean;
  lastSourceAddress: string | null;
  lastSeenAt: string;
  primarySetAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthDeviceSessionRecord {
  id: string;
  userId: string;
  deviceId: string | null;
  accessTokenId: string | null;
  refreshTokenId: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthLoginEventRecord {
  id: string;
  userId: string;
  deviceId: string | null;
  clientType: AuthClientType;
  sourceAddress: string | null;
  occurredAt: string;
}

export interface AuthLoginAttemptRecord {
  username: string;
  failedAttemptCount: number;
  captchaId: string | null;
  captchaCodeHash: string | null;
  captchaExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ProviderInstallState = "ready" | "missing" | "unknown";

export interface ProviderRuntimeStateRecord {
  providerId: string;
  installState: ProviderInstallState;
  version: string | null;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  repoRoot: string | null;
  backgroundColor?: string | null;
  favorite: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  removedAt?: string | null;
}

export type WorkspaceWorktreeLifecycleStatus =
  | "active"
  | "merged"
  | "abandoned"
  | "removing"
  | "removed";

export type ParallelSessionGroupSourceType = "fork" | "new";
export type ParallelSessionGroupStatus = "active" | "deleting" | "deleted";
export type ParallelSessionMemberRole = "anchor" | "member";
export type ParallelSessionWorkspaceIsolationMode = "none" | "temporary_worktree";
export type SessionIsolatedWorkspaceLifecycleStatus =
  | "active"
  | "promoted"
  | "removing"
  | "removed";

export interface WorkspaceWorktreeRecord {
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
  lifecycleStatus: WorkspaceWorktreeLifecycleStatus;
  mergedAt: string | null;
  removedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ParallelSessionGroupRecord {
  id: string;
  workspaceId: string;
  sourceType: ParallelSessionGroupSourceType;
  sourceSessionId: string | null;
  sourceMessageId: string | null;
  sharedPrompt: string | null;
  requestedCount: number;
  anchorSessionId: string | null;
  status: ParallelSessionGroupStatus;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ParallelSessionMemberRecord {
  groupId: string;
  sessionId: string;
  ordinal: number;
  role: ParallelSessionMemberRole;
  provider: ProviderId;
  model: string | null;
  memberPrompt: string | null;
  workspaceIsolationMode: ParallelSessionWorkspaceIsolationMode;
  temporaryWorkspaceId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SessionIsolatedWorkspaceRecord {
  id: string;
  groupId: string;
  ownerSessionId: string;
  workspaceId: string;
  sourceWorkspaceId: string;
  branchName: string;
  baseRef: string;
  baseCommit: string;
  headCommit: string | null;
  lifecycleStatus: SessionIsolatedWorkspaceLifecycleStatus;
  promotedAt: string | null;
  removedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ParallelSessionGroupSummary {
  groupId: string;
  role: ParallelSessionMemberRole;
  memberCount: number;
  sourceType: ParallelSessionGroupSourceType;
  sourceSessionId: string | null;
  anchorSessionId: string | null;
  colorToken: string;
}

export interface SessionIsolatedWorkspaceSummary {
  id: string;
  workspaceId: string;
  sourceWorkspaceId: string;
  branchName: string;
  lifecycleStatus: SessionIsolatedWorkspaceLifecycleStatus;
  promotedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceNavigationStateRecord {
  workspaceId: string;
  userId: string;
  collapsed: boolean;
  backgroundColor: string | null;
  updatedAt: string;
}

export type OfficeTaskType = "browser" | "document" | "ops" | "workflow";
export type OfficeTaskStatus =
  | "draft"
  | "pending_approval"
  | "ready"
  | "running"
  | "paused"
  | "waiting_external"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "rolled_back";
export type OfficeRiskLevel = "low" | "medium" | "high";
export type OfficeTaskStepStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "waiting_external"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";
export type OfficeArtifactKind =
  | "screenshot"
  | "ocr_result"
  | "document_export"
  | "command_log"
  | "downloaded_file"
  | "dom_snapshot"
  | "approval_record"
  | "custom";
export type OfficeApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";
export type OfficeConnectorKind = "browser" | "document" | "ops" | "external";
export type OfficeAuditEventKind =
  | "task_created"
  | "task_updated"
  | "task_started"
  | "task_finished"
  | "task_cancelled"
  | "task_approved"
  | "task_rejected"
  | "task_rolled_back"
  | "artifact_created"
  | "external_action"
  | "permission_denied";
export type OfficeRollbackStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";
export type BrowserEngine = "chrome" | "edge";
export type BrowserProfileMode = "persistent" | "cdp_attached";
export type BrowserProfileOwnershipScope = "user" | "workspace" | "target";
export type BrowserProfileStatus = "active" | "locked" | "archived" | "error";
export type DocumentTemplateEngine = "doct";
export type DocumentTemplateStatus = "active" | "deprecated";
export type OfficeDocumentStatus = "draft" | "reviewing" | "published" | "archived";
export type OfficeDocumentCommentStatus = "open" | "resolved" | "archived";
export type OfficeDocumentExportFormat = "docx" | "pdf" | "md";
export type OpsTargetKind = "ssh_host" | "web_console";
export type OpsTargetStatus = "active" | "disabled" | "error";

export interface OfficeTask {
  id: string;
  userId: string;
  workspaceId: string | null;
  taskType: OfficeTaskType;
  title: string;
  description: string | null;
  connectorId: string;
  targetRefKind: string | null;
  targetRefId: string | null;
  inputJson: string;
  status: OfficeTaskStatus;
  riskLevel: OfficeRiskLevel;
  approvalPolicyId: string | null;
  currentStepId: string | null;
  idempotencyKey: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OfficeTaskStep {
  id: string;
  taskId: string;
  stepSeq: number;
  stepType: string;
  title: string;
  inputJson: string | null;
  outputJson: string | null;
  status: OfficeTaskStepStatus;
  retryCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OfficeArtifact {
  id: string;
  taskId: string;
  stepId: string | null;
  kind: OfficeArtifactKind;
  name: string;
  storagePath: string | null;
  contentType: string | null;
  metadataJson: string | null;
  createdAt: string;
}

export interface OfficeApproval {
  id: string;
  taskId: string;
  stepId: string | null;
  policyId: string;
  status: OfficeApprovalStatus;
  approverUserId: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OfficeReceipt {
  id: string;
  taskId: string;
  stepId: string | null;
  receiptType: string;
  summary: string;
  payloadJson: string;
  createdAt: string;
}

export interface OfficeConnector {
  id: string;
  connectorKey: string;
  kind: OfficeConnectorKind;
  displayName: string;
  capabilityJson: string;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export interface OfficeAuditEvent {
  id: string;
  taskId: string | null;
  stepId: string | null;
  eventKind: OfficeAuditEventKind;
  actorKind: "user" | "system" | "assistant" | "connector";
  actorId: string | null;
  summary: string;
  payloadJson: string | null;
  createdAt: string;
}

export interface OfficeRollbackRecord {
  id: string;
  taskId: string;
  stepId: string | null;
  status: OfficeRollbackStatus;
  reason: string;
  compensationJson: string | null;
  summary: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserProfile {
  id: string;
  userId: string;
  workspaceId: string | null;
  engine: BrowserEngine;
  mode: BrowserProfileMode;
  displayName: string;
  userDataDir: string | null;
  cdpEndpoint: string | null;
  ownershipScope: BrowserProfileOwnershipScope;
  status: BrowserProfileStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentTemplate {
  id: string;
  templateKey: string;
  displayName: string;
  engine: DocumentTemplateEngine;
  templateVersion: string;
  templateSourcePath: string | null;
  schemaJson: string;
  mappingJson: string;
  outputFormatsJson: string;
  status: DocumentTemplateStatus;
  createdAt: string;
  updatedAt: string;
}

export interface OfficeDocument {
  id: string;
  userId: string;
  workspaceId: string | null;
  title: string;
  templateId: string;
  currentRevisionId: string | null;
  status: OfficeDocumentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface OfficeDocumentRevision {
  id: string;
  documentId: string;
  revisionSeq: number;
  baseRevisionId: string | null;
  contentJson: string;
  outlineJson: string | null;
  summary: string | null;
  createdBy: string;
  createdAt: string;
}

export interface OfficeDocumentComment {
  id: string;
  documentId: string;
  revisionId: string | null;
  anchorType: string;
  anchorKey: string;
  body: string;
  status: OfficeDocumentCommentStatus;
  createdBy: string;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface OpsTarget {
  id: string;
  userId: string;
  kind: OpsTargetKind;
  displayName: string;
  environment: string | null;
  configJson: string;
  credentialRef: string | null;
  status: OpsTargetStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SessionBinding {
  sessionId: string;
  workspaceId: string;
  provider: ProviderId;
  providerSessionId: string;
  rawStoreRef: string;
  providerConfigMode: SessionProviderConfigMode;
  providerPresetId: string | null;
  runtimeHomeDir: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionIndexRecord {
  sessionId: string;
  workspaceId: string;
  provider: ProviderId;
  parentSessionId?: string | null;
  sessionKind?: "default" | "annotation";
  annotationSourceMessageId?: string | null;
  annotationSourceText?: string | null;
  isSubagent?: boolean;
  subagentLabel?: string | null;
  title: string;
  messageCount: number;
  isArchived: boolean;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionForkRecord {
  sessionId: string;
  parentSessionId: string;
  provider: ProviderId;
  forkSourceType: ForkSourceType;
  forkSourceSessionId: string;
  forkSourceMessageId: string | null;
  inheritedPrefixMessageCount: number;
  providerParentSessionId: string | null;
  providerSourceMessageId: string | null;
  forkMethod: ForkMethod;
  createdAt: string;
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
  favorite: boolean;
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
  kind: "image" | "file";
  fileName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  createdAt: string;
}

export type SessionMessageOrigin = "butler_proxy" | "system";

export interface SessionMessageOriginRecord {
  sessionId: string;
  clientRequestId: string;
  messageId: string | null;
  origin: SessionMessageOrigin;
  originRef: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
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
  providerConfigMode?: SessionProviderConfigMode;
  providerPresetId?: string | null;
  parentSessionId?: string | null;
  sessionKind?: "default" | "annotation";
  annotationSourceMessageId?: string | null;
  annotationSourceText?: string | null;
  forkMethod?: ForkMethod | null;
  forkSourceType?: ForkSourceType | null;
  forkSourceSessionId?: string | null;
  forkSourceMessageId?: string | null;
  inheritedPrefixMessageCount?: number | null;
  isSubagent?: boolean;
  subagentLabel?: string | null;
  isArchived: boolean;
  isFavorite: boolean;
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
  runningState: SessionResolvedRunningState | null;
  activitySource: SessionActivitySource;
  activityResolutionSource?: SessionActivityResolutionSource;
  activityConfidence?: SessionActivityConfidence;
  runId?: string | null;
  lastEventAt: string | null;
  completedAt: string | null;
  lastSeenAt: string | null;
  watchdogTriggeredAt?: string | null;
  activityState: SessionActivityState;
  parallelGroup?: ParallelSessionGroupSummary | null;
  displayParentSessionId?: string | null;
  sessionIsolatedWorkspace?: SessionIsolatedWorkspaceSummary | null;
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

export interface UserQuickPhraseRecord {
  id: string;
  text: string;
}

export interface UserQuickPhrasePreferenceRecord {
  userId: string;
  phrases: UserQuickPhraseRecord[];
  createdAt: string;
  updatedAt: string;
}

export type PreferenceProviderId =
  | "claude-code"
  | "codex"
  | "opencode"
  | "gemini"
  | "kimi";
export type UserPreferenceLanguage = "zh-CN" | "en-US";
export type UserPreferenceTheme = "light" | "dark" | "sky-blue" | "eye-green";
export type UserPreferencePermissionMode = "default" | "acceptEdits" | "bypassPermissions";
export type DebugPortPoolRole = "frontend" | "backend" | "worker" | "mock" | "custom";

export interface DebugPortPoolRange {
  start: number;
  end: number;
}

export type DebugPortPoolConfig = DebugPortPoolRange;

export interface UserPreferenceProviderProfile {
  defaultModel: string | null;
  defaultReasoningLevel: string | null;
}

export type UserPreferenceProviders = Record<PreferenceProviderId, UserPreferenceProviderProfile>;

export interface UserPreferenceProfile {
  language: UserPreferenceLanguage;
  theme: UserPreferenceTheme;
  autoTheme: boolean;
  defaultPermissionMode: UserPreferencePermissionMode;
  providers: UserPreferenceProviders;
  debugPortPools: DebugPortPoolConfig;
}

export interface UserPreferenceProfileRecord extends UserPreferenceProfile {
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderControlRecord {
  providerId: ProviderId;
  enabled: boolean;
  updatedAt: string;
}

export interface GitRemoteCredentialRecord {
  userId: string;
  remoteUrl: string;
  authMode: "basic" | "token";
  usernameCiphertext: string;
  secretCiphertext: string;
  createdAt: string;
  updatedAt: string;
}

export type ButlerProfileProviderId = "codex" | "claude-code";
export type ChannelPlatformCode =
  | "wechat-claw"
  | "telegram";
export type ChannelConnectionMode = "webhook" | "polling" | "bridge";
export type ChannelAccountStatus = "active" | "disabled" | "degraded";
export type ChannelMultiSessionSupportLevel = "supported" | "limited";
export type ChannelThreadStatus = "active" | "closed" | "failed";
export type ChannelInboundEventStatus = "received" | "dispatched" | "replied" | "failed" | "ignored";
export type ChannelDeliveryStatus = "sent" | "failed" | "skipped";
export type ButlerAgentsMode = "inline" | "file";
export type ButlerControlSessionStatus = "idle" | "running" | "failed" | "closed";
export type ButlerControlTimerStatus = "active" | "completed" | "cancelled" | "failed";
export type AssistantAutomationStatus = "active" | "paused" | "completed" | "cancelled" | "failed";
export type AssistantAutomationTriggerType = "once" | "interval" | "cron" | "condition";
export type AssistantAutomationActionType = "send_control_message";
export type AssistantAutomationRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";
export type AssistantSandboxStatus = "active" | "archived" | "expired" | "orphaned" | "deleted";
export type AssistantSandboxSourceKind = "blank" | "clone";
export type AssistantSandboxVisibility = "assistant_only" | "pinned";
export type ButlerControlEventKind = "action";
export type ButlerControlActionType =
  | "open-project"
  | "resume-session"
  | "start-patrol"
  | "start-verification";
export type ButlerControlEventStatus = "succeeded" | "failed";
export interface ButlerPersonaProfile {
  tone: string;
  language: string;
  summaryStyle: string;
  [key: string]: unknown;
}
export interface ButlerFocusProfile {
  projectIds: string[];
  riskPreference: string;
  reportPriority: string[];
  summaryDebounceSeconds: number;
  [key: string]: unknown;
}
export type ButlerApprovalMode = "readonly" | "controlled" | "auto";
export type ButlerLifecycleStatus = "active" | "paused" | "archived";
export type ButlerRiskLevel = "low" | "medium" | "high";
export type ButlerSessionRole = "patrol" | "execution" | "verification" | "adhoc";
export type ButlerSessionOwnershipMode = "managed" | "observed";
export type ButlerSessionStatus = "idle" | "running" | "blocked" | "failed" | "closed";
export type ButlerSessionSummaryStatus = "idle" | "scheduled" | "running" | "failed";
export type ButlerControlSessionPurpose = "chat" | "todo_analysis";
export type ButlerCheckpointSourceKind = "snapshot" | "summary" | "verification" | "manual";
export type ButlerCheckpointProgressState = "unknown" | "working" | "blocked" | "done";
export type ButlerInboxItemType = "bug" | "feature" | "change" | "task";
export type ButlerInboxItemStatus = "pending" | "in_progress" | "closed";
export type ButlerInboxItemPriority = "low" | "medium" | "high";
export type ButlerInboxItemLifecycleStage =
  | "pending"
  | "analyzing"
  | "analyzed"
  | "session_created"
  | "follow_up_active"
  | "completed"
  | "failed";
export type ButlerFollowUpTaskStatus =
  | "active"
  | "waiting_user"
  | "completed"
  | "failed"
  | "cancelled";
export type ProjectMemoryType = "arch" | "rule" | "decision" | "incident" | "verify" | "note";
export type ProjectMemoryStatus = "candidate" | "active" | "superseded" | "archived";
export type PatrolTriggerType = "manual" | "interval" | "cron";
export type PatrolExecutionMode = "readonly" | "controlled";
export type PatrolRunTriggeredBy = "scheduler" | "user" | "system";
export type PatrolRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type VerificationType = "test" | "health" | "browser" | "visual" | "metric";
export type VerificationRunStatus = "queued" | "running" | "passed" | "failed" | "skipped" | "cancelled";

export interface ButlerProfile {
  id: "default";
  displayName: string;
  providerId: ButlerProfileProviderId;
  workspacePath: string;
  agentsMode: ButlerAgentsMode;
  agentsFilePath: string | null;
  agentsContent: string;
  persona: ButlerPersonaProfile;
  focus: ButlerFocusProfile;
  initializedAt: string;
  updatedAt: string;
}

export interface ChannelPlatformCapability {
  code: ChannelPlatformCode;
  displayName: string;
  supportedConnectionModes: ChannelConnectionMode[];
  multiSessionSupportLevel: ChannelMultiSessionSupportLevel;
  stageOneLimitations: string[];
}

export interface ChannelAccount {
  id: string;
  userId: string;
  platformCode: ChannelPlatformCode;
  displayName: string;
  providerId: ButlerProfileProviderId;
  connectionMode: ChannelConnectionMode;
  status: ChannelAccountStatus;
  config: Record<string, unknown>;
  runtimeState: Record<string, unknown>;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelThread {
  id: string;
  channelAccountId: string;
  externalConversationKey: string;
  externalUserId: string | null;
  externalThreadKey: string | null;
  controlSessionId: string | null;
  sessionId: string | null;
  title: string | null;
  status: ChannelThreadStatus;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastTransportContext: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelInboundEvent {
  id: string;
  channelAccountId: string;
  externalEventId: string;
  externalConversationKey: string;
  externalUserId: string | null;
  controlSessionId: string | null;
  sessionId: string | null;
  textContent: string;
  payload: Record<string, unknown>;
  status: ChannelInboundEventStatus;
  errorMessage: string | null;
  receivedAt: string;
  processedAt: string | null;
}

export interface ChannelDelivery {
  id: string;
  channelAccountId: string;
  threadId: string | null;
  inboundEventId: string | null;
  controlSessionId: string | null;
  sessionId: string | null;
  textContent: string;
  providerMessageRef: string | null;
  status: ChannelDeliveryStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ButlerControlSession {
  id: string;
  providerId: ButlerProfileProviderId;
  sessionId: string;
  purpose: ButlerControlSessionPurpose;
  title: string | null;
  sourceItemId: string | null;
  model: string | null;
  reasoningLevel: string | null;
  permissionMode: string | null;
  status: ButlerControlSessionStatus;
  lastContextVersion: string | null;
  lastSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ButlerControlTimer {
  id: string;
  controlSessionId: string;
  sessionId: string;
  userId: string;
  projectId: string | null;
  targetSessionId: string | null;
  title: string | null;
  content: string;
  dueAt: string;
  status: ButlerControlTimerStatus;
  triggeredAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
}

export interface AssistantAutomationTask {
  id: string;
  userId: string;
  controlSessionId: string;
  projectId: string | null;
  title: string | null;
  triggerType: AssistantAutomationTriggerType;
  triggerConfigJson: string;
  actionType: AssistantAutomationActionType;
  actionConfigJson: string;
  status: AssistantAutomationStatus;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunSummary: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
}

export interface AssistantAutomationRun {
  id: string;
  automationId: string;
  runSeq: number;
  triggerType: AssistantAutomationTriggerType;
  triggerSnapshotJson: string;
  actionType: AssistantAutomationActionType;
  actionSnapshotJson: string;
  status: AssistantAutomationRunStatus;
  summary: string | null;
  error: string | null;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface AssistantSandboxWorkspace {
  id: string;
  userId: string;
  workspaceId: string;
  controlSessionId: string | null;
  title: string;
  description: string | null;
  sourceKind: AssistantSandboxSourceKind;
  sourceRef: string | null;
  visibility: AssistantSandboxVisibility;
  status: AssistantSandboxStatus;
  purpose: string | null;
  expiresAt: string | null;
  promotedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ButlerControlRelatedRef {
  kind: "project" | "butler-session" | "session" | "patrol-run" | "verification-run" | "workspace";
  id: string;
  label: string;
  routePath: string | null;
  workspaceId: string | null;
  projectId: string | null;
}

export interface ButlerControlEvent {
  id: string;
  controlSessionId: string;
  kind: ButlerControlEventKind;
  actionType: ButlerControlActionType;
  status: ButlerControlEventStatus;
  title: string;
  content: string;
  relatedRefs: ButlerControlRelatedRef[];
  createdAt: string;
}

export interface ButlerProject {
  id: string;
  workspaceId: string;
  name: string;
  repoRoot: string;
  defaultProvider: ProviderId | null;
  instructionProfileId: string | null;
  approvalMode: ButlerApprovalMode;
  lifecycleStatus: ButlerLifecycleStatus;
  riskLevel: ButlerRiskLevel;
  config: Record<string, unknown>;
  lastPatrolAt: string | null;
  lastVerificationAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface ButlerSession {
  id: string;
  projectId: string;
  sessionId: string;
  role: ButlerSessionRole;
  ownershipMode: ButlerSessionOwnershipMode;
  status: ButlerSessionStatus;
  lastSummary: string | null;
  lastCheckpointAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ButlerInboxItem {
  id: string;
  projectId: string;
  itemType: ButlerInboxItemType;
  title: string;
  content: string;
  priority: ButlerInboxItemPriority;
  status: ButlerInboxItemStatus;
  assistantState: ButlerInboxAssistantState;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface ButlerInboxAssistantState {
  lifecycleStage: ButlerInboxItemLifecycleStage;
  analysisSummary: string | null;
  generatedPrompt: string | null;
  analysisControlSessionId: string | null;
  analysisSessionId: string | null;
  linkedButlerSessionId: string | null;
  linkedSessionId: string | null;
  linkedFollowUpTaskId: string | null;
  lastError: string | null;
  lastAnalyzedAt: string | null;
  lastSessionCreatedAt: string | null;
  lastFollowUpAt: string | null;
}

export interface ButlerNotificationArchiveRecord {
  userId: string;
  notificationId: string;
  archivedAt: string;
  updatedAt: string;
}

export interface ButlerFollowUpTask {
  id: string;
  projectId: string;
  butlerSessionId: string;
  sessionId: string;
  providerId: ButlerProfileProviderId;
  assistantButlerSessionId: string;
  assistantSessionId: string;
  createdByUserId: string;
  objective: string;
  completionCriteria: string;
  maxAutoContinueCount: number;
  status: ButlerFollowUpTaskStatus;
  checkIntervalSeconds: number;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  lastObservedRunningState: SessionRunningState | null;
  lastObservedMessageAt: string | null;
  lastObservedMessageCount: number;
  lastAutomationSummary: string | null;
  lastAutomationAt: string | null;
  autoContinueCount: number;
  waitingReason: string | null;
  rounds: ButlerFollowUpRound[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type ButlerFollowUpRoundKind =
  | "started"
  | "continue"
  | "queued"
  | "waiting_user"
  | "completed"
  | "failed"
  | "cancelled"
  | "limit_reached";

export interface ButlerFollowUpRound {
  roundNumber: number;
  kind: ButlerFollowUpRoundKind;
  status: ButlerFollowUpTaskStatus;
  summary: string;
  waitingReason: string | null;
  continuePrompt: string | null;
  observedRunningState: SessionRunningState | null;
  autoContinueCount: number;
  createdAt: string;
}

export interface ButlerSessionSummaryState {
  butlerSessionId: string;
  sourceMessageCount: number;
  sourceLastMessageAt: string | null;
  lastSummarizedAt: string | null;
  lastSummarizedSequence: number | null;
  debounceUntil: string | null;
  status: ButlerSessionSummaryStatus;
  errorDetail: string | null;
  updatedAt: string;
}

export interface SessionCheckpoint {
  id: string;
  butlerSessionId: string;
  checkpointSeq: number;
  sourceKind: ButlerCheckpointSourceKind;
  progressState: ButlerCheckpointProgressState;
  summary: string;
  riskFlags: string[];
  nextActions: string[];
  capturedAt: string;
}

export interface ProjectMemory {
  id: string;
  projectId: string;
  sourceButlerSessionId: string | null;
  sourceCheckpointId: string | null;
  memoryType: ProjectMemoryType;
  title: string;
  scopePath: string | null;
  content: string;
  tags: string[];
  confidence: number;
  status: ProjectMemoryStatus;
  evidence: Record<string, unknown>;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PatrolPlan {
  id: string;
  projectId: string;
  name: string;
  triggerType: PatrolTriggerType;
  triggerConfig: Record<string, unknown>;
  executionMode: PatrolExecutionMode;
  patrolScope: Record<string, unknown>;
  enabled: boolean;
  lastScheduledAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PatrolRun {
  id: string;
  projectId: string;
  planId: string | null;
  triggeredBy: PatrolRunTriggeredBy;
  triggerRef: string | null;
  butlerSessionId: string | null;
  status: PatrolRunStatus;
  summary: string | null;
  riskLevel: ButlerRiskLevel | null;
  suggestions: string[];
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface VerificationRun {
  id: string;
  projectId: string;
  butlerSessionId: string | null;
  sourcePatrolRunId: string | null;
  verificationType: VerificationType;
  status: VerificationRunStatus;
  targetRef: string | null;
  summary: string | null;
  artifactRefs: Array<Record<string, unknown>>;
  result: Record<string, unknown>;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
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

export type DebugTargetSourceType = "repo" | "worktree";
export type DebugServiceRole = DebugPortPoolRole;
export type DebugServiceProtocol = "http" | "ws" | "tcp";
export type FrameworkAnalysisConfidence = "high" | "medium" | "low";
export type FrameworkCompatibilityLevel = "supported" | "conditional" | "unsupported" | "unknown";
export type DebugInjectionMode = "cli" | "env" | "override" | "ai_fallback" | "none";
export type DebugAdapterKind = "cli" | "env" | "override" | "ai_fallback";
export type DebugAiFallbackPolicy = "never" | "conditional" | "allowed";
export type DebugRuntimeSessionStatus = "PREPARING" | "RUNNING" | "FAILED" | "STOPPED";
export type RuntimeBindingStatus = "ALLOCATED" | "LISTENING" | "FAILED" | "RELEASED";
export type PortLeaseStatus = "LEASED" | "RELEASING" | "RELEASED" | "STALE";
export type AiFallbackEditStatus = "PENDING" | "APPLIED" | "ROLLED_BACK" | "REJECTED";
export type DebugLaunchAdapterAttemptStatus = "selected" | "skipped" | "blocked" | "fallback_required";
export type LauncherSourceType = "manual" | "debug_service";
export type ServiceDiscoveryMode = "same_origin" | "api_base_url" | "none";

export interface DebugTargetProfile {
  id: string;
  workspaceId: string;
  rootPath: string;
  displayName: string;
  stackHint?: string | null;
  sourceType: DebugTargetSourceType;
  rootWorkspaceId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DebugServiceSpec {
  id: string;
  targetId: string;
  role: DebugServiceRole;
  name: string;
  cwd: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  defaultPortHint?: number | null;
  protocol?: DebugServiceProtocol | null;
  healthPath?: string | null;
  adapterKind?: DebugAdapterKind | null;
  frameworkAnalysisId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FrameworkAnalysisResult {
  id: string;
  targetId: string;
  serviceId?: string | null;
  primaryFramework?: string | null;
  confidence: FrameworkAnalysisConfidence;
  compatibilityLevel: FrameworkCompatibilityLevel;
  recommendedInjectionMode?: DebugInjectionMode | null;
  requiresServiceDiscoveryHandling: boolean;
  requiresHmrHandling: boolean;
  requiresCallbackHandling: boolean;
  aiFallbackPolicy: DebugAiFallbackPolicy;
  reasons: string[];
  detectedFiles: string[];
  rawEvidence?: Record<string, unknown>;
  createdAt: string;
}

export interface DebugRuntimeSession {
  id: string;
  targetId: string;
  status: DebugRuntimeSessionStatus;
  failureStage?: string | null;
  startedAt?: string | null;
  stoppedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeBinding {
  id: string;
  runtimeId: string;
  serviceId: string;
  processInstanceId?: string | null;
  expectedPort?: number | null;
  leasedPort?: number | null;
  observedPort?: number | null;
  proxyPath?: string | null;
  status: RuntimeBindingStatus;
  updatedAt: string;
}

export interface PortLeaseRecord {
  id: string;
  runtimeId: string;
  serviceId: string;
  port: number;
  protocol: "tcp" | "udp";
  status: PortLeaseStatus;
  leasedAt: string;
  expiresAt?: string | null;
  releasedAt?: string | null;
}

export interface AiFallbackEditRecord {
  id: string;
  runtimeId: string;
  serviceId: string;
  reason: string;
  allowedFiles: string[];
  targetPort: number;
  patchRef?: string | null;
  rollbackRef?: string | null;
  status: AiFallbackEditStatus;
  createdAt: string;
}

export interface FrameworkCompatibilityMatrixItem {
  framework: string;
  compatibilityLevel: FrameworkCompatibilityLevel;
  recommendedInjectionMode: DebugInjectionMode;
  requiresServiceDiscoveryHandling: boolean;
  requiresHmrHandling: boolean;
  requiresCallbackHandling: boolean;
  aiFallbackPolicy: DebugAiFallbackPolicy;
  notes: string;
}

export interface DebugLaunchAdapterAttempt {
  kind: DebugAdapterKind;
  status: DebugLaunchAdapterAttemptStatus;
  reason: string;
}

export interface DebugAiFallbackSummary {
  eligible: boolean;
  editId: string | null;
  status: AiFallbackEditStatus | null;
  reason: string;
  allowedFiles: string[];
}

export interface DebugLaunchPlanServiceItem {
  serviceId: string;
  role: DebugServiceRole;
  frameworkAnalysisId: string | null;
  primaryFramework: string | null;
  compatibilityLevel: FrameworkCompatibilityLevel;
  adapterKind: DebugAdapterKind | null;
  injectionMode: DebugInjectionMode | null;
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
  adapterAttempts: DebugLaunchAdapterAttempt[];
  aiFallback: DebugAiFallbackSummary | null;
  missingRequirements: string[];
  autoStartAllowed: boolean;
}

export interface DebugLaunchPlan {
  runtimeSession: DebugRuntimeSession;
  targetId: string;
  autoStartAllowed: boolean;
  services: DebugLaunchPlanServiceItem[];
}

export interface DebugRuntimeDetailServiceItem {
  service: DebugServiceSpec;
  analysis: FrameworkAnalysisResult | null;
  binding: RuntimeBinding | null;
  portLease: PortLeaseRecord | null;
  processInstance: TerminalInstance | null;
  aiFallbackEdits: AiFallbackEditRecord[];
}

export interface DebugRuntimeDetail {
  runtimeSession: DebugRuntimeSession;
  target: DebugTargetProfile;
  services: DebugRuntimeDetailServiceItem[];
}

export interface DebugRuntimeHistoryEnvelope {
  targetId: string;
  items: DebugRuntimeDetail[];
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
  debugRuntimeSessionId?: string | null;
  debugTargetId?: string | null;
  debugServiceId?: string | null;
  frameworkAnalysisId?: string | null;
  launcherSourceType?: LauncherSourceType | null;
  launchStage?: string | null;
  failureStage?: string | null;
  adapterKind?: DebugAdapterKind | null;
  envPatchSummary?: Record<string, unknown>;
  artifactRef?: string | null;
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

export type TerminalLogFileStatus = "active" | "sealed" | "deleting";

export interface TerminalLogFile {
  id: string;
  terminalId: string;
  relativePath: string;
  status: TerminalLogFileStatus;
  startSeq: number;
  endSeq: number | null;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface TerminalLogSegment {
  id: string;
  terminalId: string;
  fileId: string;
  startSeq: number;
  endSeq: number;
  startOffset: number;
  endOffset: number;
  byteLength: number;
  createdAt: string;
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
  proxyEnabled: boolean;
  proxySlug: string | null;
  runtimeType: TerminalRuntimeType | null;
  createdAt: string;
  updatedAt: string;
  sourceType?: LauncherSourceType | null;
  debugTargetId?: string | null;
  debugServiceId?: string | null;
  frameworkAnalysisId?: string | null;
  adapterKind?: DebugAdapterKind | null;
  injectionMode?: DebugInjectionMode | null;
  generatedArtifactRef?: string | null;
  serviceDiscoveryMode?: ServiceDiscoveryMode | null;
  managedBySystem?: boolean;
}

export interface TerminalTemplateRuntimeStatus {
  templateId: string;
  port: number;
  occupied: boolean;
  processId: number | null;
  parentProcessId?: number | null;
  processGroupId?: number | null;
  processName: string | null;
  processCommandLine: string | null;
  parentProcessName?: string | null;
  parentProcessCommandLine?: string | null;
  terminationScope?: "process" | "process_group" | null;
}

export type SkillSourceType = "builtin" | "local-import" | "managed-copy";
export type SkillScope = "workspace" | "assistant";
export type ManagedSkillState = "active" | "conflicted" | "missing";
export type SkillTargetCli = "codex" | "claude-code" | "gemini" | "opencode";
export type SkillTargetSyncStatus = "synced" | "pending" | "failed" | "conflicted";
export type OpenCliProviderId = "opencli";
export type OpenCliInstallState = "not_installed" | "installed" | "broken";
export type OpenCliHealthState =
  | "unknown"
  | "binary_ready"
  | "bridge_missing"
  | "ready"
  | "runtime_build_failed";
export type OpenCliCatalogSource = "manifest" | "cli_list" | "local_manifest" | "cache";
export type OpenCliRuntimeProfileStatus = "pending" | "ready" | "failed" | "stale";

export interface ManagedSkillRecord {
  id: string;
  name: string;
  scope: SkillScope;
  directoryName: string;
  sourceType: SkillSourceType;
  sourcePath: string | null;
  contentHash: string;
  managedState: ManagedSkillState;
  createdAt: string;
  updatedAt: string;
}

export interface SkillTargetBindingRecord {
  skillId: string;
  targetCli: SkillTargetCli;
  enabled: boolean;
  syncStatus: SkillTargetSyncStatus;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
}

export interface OpenCliProviderRecord {
  providerId: OpenCliProviderId;
  enabled: boolean;
  installState: OpenCliInstallState;
  healthState: OpenCliHealthState;
  version: string | null;
  installPath: string | null;
  lastCheckedAt: string | null;
  activeRuntimeId: string | null;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
  catalogRefreshedAt: string | null;
  catalogSource: OpenCliCatalogSource | null;
}

export interface OpenCliCatalogEntryRecord {
  providerId: OpenCliProviderId;
  commandId: string;
  site: string;
  name: string;
  description: string;
  strategy: string;
  browser: boolean;
  modulePath: string | null;
  sourceFile: string | null;
  enabled: boolean;
  sortOrder: number;
}

export interface OpenCliRuntimeProfileRecord {
  id: string;
  version: string;
  sourceInstallPath: string;
  enabledCommandIdsJson: string;
  runtimeRootPath: string;
  status: OpenCliRuntimeProfileStatus;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
}

export type SkillScanManagementState = "managed" | "unmanaged" | "conflicted";

export interface SkillScanEntry {
  targetCli: SkillTargetCli;
  directoryPath: string;
  directoryName: string;
  name: string;
  contentHash: string;
  managementState: SkillScanManagementState;
  managedSkillId: string | null;
}

export interface SkillScanDiagnostic {
  targetCli: SkillTargetCli;
  rootDir: string;
  code: string;
  detail: string;
  directoryName: string | null;
  directoryPath: string | null;
  managedSkillId: string | null;
}

export interface SkillScanResult {
  managed: SkillScanEntry[];
  unmanaged: SkillScanEntry[];
  conflicted: SkillScanEntry[];
  diagnostics: SkillScanDiagnostic[];
  scannedAt: string;
}

export type TailscalePhase =
  | "disabled"
  | "blocked_uninitialized"
  | "starting"
  | "needs_login"
  | "running"
  | "stopping"
  | "error";

export interface InstanceTailscaleConfig {
  activated: boolean;
  enabled: boolean;
  controlServerUrl: string | null;
  hostname: string | null;
  stateDir: string;
  updatedAt: string;
}

export interface InstanceTailscaleStatus {
  phase: TailscalePhase;
  connected: boolean;
  loginUrl: string | null;
  controlServerUrl: string | null;
  hostname: string | null;
  accountName: string | null;
  tailnetFqdn: string | null;
  tailnetIpv4: string | null;
  tailnetIpv6: string | null;
  reachableBaseUrl: string | null;
  lastError: string | null;
  observedAt: string | null;
}

export type RelayTunnelProvider = "codingns_relay";
export type HostCandidateEndpointKind = "relay" | "lan" | "loopback" | "tailscale" | "custom";

export interface HostCandidateEndpoint {
  endpointId: string;
  kind: HostCandidateEndpointKind;
  url: string;
  priority: number;
  expiresAt: string | null;
  source: "host_reported" | "desktop_scan" | "user_saved";
}

export type RelayTunnelPhase =
  | "disabled"
  | "blocked_uninitialized"
  | "unbound"
  | "binding"
  | "connecting"
  | "running"
  | "quota_exhausted"
  | "error";

export interface InstanceRelayTunnelConfig {
  activated: boolean;
  enabled: boolean;
  provider: RelayTunnelProvider;
  relayBaseUrl: string | null;
  controlBaseUrl: string | null;
  controlAccessTokenCiphertext: string | null;
  controlAccountEmail: string | null;
  controlSessionExpiresAt: string | null;
  accountId: string | null;
  tunnelDomain: string | null;
  bindingId: string | null;
  hostPublicKey: string | null;
  hostKeyFingerprint: string | null;
  localTargetBaseUrl: string;
  localTargetBaseUrlSource?: "default" | "custom";
  updatedAt: string;
}

export interface InstanceRelayTunnelIdentity {
  keyAlgorithm: "x25519";
  privateKeyPem: string;
  publicKeyPem: string;
  keyFingerprint: string;
  createdAt: string;
  updatedAt: string;
}

export interface InstanceRelayTunnelStatus {
  phase: RelayTunnelPhase;
  connected: boolean;
  bindingId: string | null;
  tunnelDomain: string | null;
  hostFingerprint: string | null;
  trafficUsedBytes: string | null;
  trafficRemainingBytes: string | null;
  quotaResetAt: string | null;
  lastError: string | null;
  observedAt: string | null;
}
