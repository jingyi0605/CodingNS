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
  kind: "image";
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

export interface UserPreferenceProviderProfile {
  defaultModel: string | null;
  defaultReasoningLevel: string | null;
}

export type UserPreferenceProviders = Record<PreferenceProviderId, UserPreferenceProviderProfile>;

export interface UserPreferenceProfile {
  language: UserPreferenceLanguage;
  theme: UserPreferenceTheme;
  defaultPermissionMode: UserPreferencePermissionMode;
  providers: UserPreferenceProviders;
}

export interface UserPreferenceProfileRecord extends UserPreferenceProfile {
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export type ButlerProfileProviderId = "codex" | "claude-code";
export type ButlerAgentsMode = "inline" | "file";
export type ButlerControlSessionStatus = "idle" | "running" | "failed" | "closed";
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
export type ButlerCheckpointSourceKind = "snapshot" | "summary" | "verification" | "manual";
export type ButlerCheckpointProgressState = "unknown" | "working" | "blocked" | "done";
export type ButlerInboxItemType = "bug" | "feature" | "change" | "task";
export type ButlerInboxItemStatus = "pending" | "in_progress" | "closed";
export type ButlerInboxItemPriority = "low" | "medium" | "high";
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
export type VerificationRunStatus = "queued" | "running" | "passed" | "failed" | "skipped";

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

export interface ButlerControlSession {
  id: string;
  providerId: ButlerProfileProviderId;
  sessionId: string;
  status: ButlerControlSessionStatus;
  lastContextVersion: string | null;
  lastSummary: string | null;
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
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
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
}

export interface TerminalTemplateRuntimeStatus {
  templateId: string;
  port: number;
  occupied: boolean;
  processId: number | null;
  processName: string | null;
  processCommandLine: string | null;
}
