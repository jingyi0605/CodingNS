import { httpClient } from "../../../network/http-client";
import { getHostBaseUrl } from "../../../config/env";
import { ApiError } from "../../../shared/network/api-error";
import type {
  HistoryMessageDto,
  SessionSummaryDto
} from "../../conversation/api/conversation-api";

export type ButlerProviderId = "codex" | "claude-code";
export type ButlerAgentsMode = "inline" | "file";
export type ButlerToneId = "direct" | "steady" | "friendly";
export type ButlerLanguageId = "zh-CN" | "en-US" | "bilingual";
export type ButlerSummaryStyleId = "brief" | "structured" | "thorough";
export type ButlerRiskPreferenceId = "conservative" | "balanced" | "proactive";
export type ButlerControlSessionPurpose = "chat" | "todo_analysis";
export type ButlerInboxItemType = "bug" | "feature" | "change" | "task";
export type ButlerInboxItemPriority = "low" | "medium" | "high";
export type ButlerInboxItemStatus = "pending" | "in_progress" | "closed";
export type ButlerInboxLifecycleStage =
  | "pending"
  | "analyzing"
  | "analyzed"
  | "session_created"
  | "follow_up_active"
  | "completed"
  | "failed";
export type ButlerFollowUpTaskStatus = "active" | "waiting_user" | "completed" | "failed" | "cancelled";
export type ButlerFollowUpRoundKind =
  | "started"
  | "continue"
  | "queued"
  | "waiting_user"
  | "completed"
  | "failed"
  | "cancelled"
  | "limit_reached";
export type ButlerControlTimerStatus = "active" | "completed" | "cancelled" | "failed";
export type AssistantAutomationStatus = "active" | "paused" | "completed" | "cancelled" | "failed";
export type AssistantAutomationTriggerType = "once" | "interval" | "cron" | "condition";
export type AssistantAutomationRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";
export type ButlerVerificationRunStatus = "queued" | "running" | "passed" | "failed" | "skipped" | "cancelled";

export type AssistantAutomationTriggerConfigDto =
  | {
      type: "once";
      dueAt: string;
    }
  | {
      type: "interval";
      seconds: number | null;
      minutes: number | null;
      hours: number | null;
      stopAt: string | null;
    }
  | {
      type: "cron";
      minute: number;
      hour: number | null;
      daysOfWeek: number[] | null;
      stopAt: string | null;
    }
  | {
      type: "condition";
      conditionKind: "git.remote_tag_changed" | "session.runtime_idle";
      pollIntervalSeconds: number;
      expiresAt: string | null;
      maxChecks: number | null;
      stateJson: string;
      triggerContext?: Record<string, unknown>;
    };

export interface AssistantAutomationActionConfigDto {
  content: string;
  includeTriggerContext: boolean;
  targetSessionId: string | null;
}

export interface ButlerProfileDto {
  id: "default";
  displayName: string;
  providerId: ButlerProviderId;
  workspacePath: string;
  agentsMode: ButlerAgentsMode;
  agentsFilePath: string | null;
  agentsContent: string;
  persona: {
    tone: ButlerToneId;
    language: ButlerLanguageId;
    summaryStyle: ButlerSummaryStyleId;
    [key: string]: unknown;
  };
  focus: {
    projectIds: string[];
    riskPreference: ButlerRiskPreferenceId;
    reportPriority: string[];
    summaryDebounceSeconds: number;
    [key: string]: unknown;
  };
  setupCompleted: boolean;
  initializedAt: string;
  updatedAt: string;
}

export interface ButlerProfilePayload {
  displayName?: string;
  providerId?: ButlerProviderId;
  workspacePath?: string;
  agentsMode?: ButlerAgentsMode;
  agentsFilePath?: string | null;
  agentsContent?: string;
  persona?: {
    tone: ButlerToneId;
    language: ButlerLanguageId;
    summaryStyle: ButlerSummaryStyleId;
    [key: string]: unknown;
  };
  focus?: {
    projectIds: string[];
    riskPreference: ButlerRiskPreferenceId;
    reportPriority: string[];
    summaryDebounceSeconds: number;
    [key: string]: unknown;
  };
}

export interface ButlerProfileResponseDto {
  initialized: boolean;
  affairsSetupCompleted?: boolean;
  profile: ButlerProfileDto | null;
}

export interface ButlerControlSessionDto {
  id: string;
  providerId: ButlerProviderId;
  sessionId: string;
  purpose: ButlerControlSessionPurpose;
  title: string | null;
  sourceItemId: string | null;
  status: "idle" | "running" | "failed" | "closed";
  lastContextVersion: string | null;
  lastSummary: string | null;
  createdAt: string;
  updatedAt: string;
  session: SessionSummaryDto;
}

export interface ButlerStartControlSessionPayload {
  content?: string;
  clientRequestId?: string | null;
  model?: string | null;
  reasoningLevel?: string | null;
  permissionMode?: string | null;
  purpose?: ButlerControlSessionPurpose;
  title?: string | null;
  sourceItemId?: string | null;
  workspaceId?: string | null;
}

export interface ButlerControlSessionResponseDto {
  controlSession: ButlerControlSessionDto | null;
}

export interface ButlerControlTimerDto {
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
  controlSession: ButlerControlSessionDto | null;
}

export interface AssistantAutomationTaskDto {
  id: string;
  userId: string;
  controlSessionId: string;
  projectId: string | null;
  title: string | null;
  triggerType: AssistantAutomationTriggerType;
  triggerConfigJson: string;
  triggerConfig: AssistantAutomationTriggerConfigDto;
  actionType: "send_control_message";
  actionConfigJson: string;
  actionConfig: AssistantAutomationActionConfigDto;
  status: AssistantAutomationStatus;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunSummary: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  controlSession: ButlerControlSessionDto | null;
}

export interface AssistantAutomationRunDto {
  id: string;
  automationId: string;
  runSeq: number;
  triggerType: AssistantAutomationTriggerType;
  triggerSnapshotJson: string;
  triggerSnapshot: AssistantAutomationTriggerConfigDto;
  actionType: "send_control_message";
  actionSnapshotJson: string;
  actionSnapshot: AssistantAutomationActionConfigDto;
  status: AssistantAutomationRunStatus;
  summary: string | null;
  error: string | null;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface ButlerResumeControlSessionResponseDto {
  id: string;
  providerId: ButlerProviderId;
  sessionId: string;
  status: "idle" | "running" | "failed" | "closed";
  lastContextVersion: string | null;
  lastSummary: string | null;
  createdAt: string;
  updatedAt: string;
  resumedAt: string;
  provider: ButlerProviderId;
  providerSessionId: string;
  session: SessionSummaryDto;
}

export interface ButlerSendMessagePayload extends ButlerStartControlSessionPayload {
  content: string;
  controlSessionId?: string | null;
}

export interface ButlerSendMessageResponseDto {
  controlSession: ButlerControlSessionDto;
  sessionId: string;
  provider: ButlerProviderId;
  providerSessionId: string;
  acceptedAt: string;
  clientRequestId: string | null;
  message: HistoryMessageDto;
}

export interface ButlerGlobalDigestDto {
  projectCount: number;
  activeProjectCount: number;
  blockedProjectCount: number;
  highRiskProjectCount: number;
  topRisks: string[];
  nextActions: string[];
}

export interface ButlerProjectDigestDto {
  id: string;
  workspaceId: string;
  name: string;
  repoRoot: string;
  lifecycleStatus: "active" | "paused" | "archived";
  riskLevel: "low" | "medium" | "high";
  activeSessionCount: number;
  sessionCount: number;
  memoryCount: number;
  failedPatrolCount: number;
  failedVerificationCount: number;
  latestSessionSummary: string | null;
  latestPatrolSummary: string | null;
  latestVerificationSummary: string | null;
  topRisks: string[];
  nextActions: string[];
  lastActivityAt: string;
  updatedAt: string;
}

export interface ButlerProjectDto {
  id: string;
  workspaceId: string;
  name: string;
  repoRoot: string;
  defaultProvider: string | null;
  instructionProfileId: string | null;
  approvalMode: "readonly" | "controlled" | "auto";
  lifecycleStatus: "active" | "paused" | "archived";
  riskLevel: "low" | "medium" | "high";
  config: Record<string, unknown>;
  lastPatrolAt: string | null;
  lastVerificationAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface ButlerSessionDigestDto {
  id: string;
  projectId: string;
  sessionId: string;
  provider: string | null;
  title: string | null;
  role: "patrol" | "execution" | "verification" | "adhoc";
  ownershipMode: "managed" | "observed";
  status: "idle" | "running" | "blocked" | "failed" | "closed";
  runningState: string | null;
  lastSummary: string | null;
  lastCheckpointAt: string | null;
  progressState: "unknown" | "working" | "blocked" | "done";
  riskFlags: string[];
  nextActions: string[];
  updatedAt: string;
  createdAt: string;
}

export interface ButlerPatrolDigestDto {
  id: string;
  projectId: string;
  planId: string | null;
  triggeredBy: string;
  status: string;
  riskLevel: string | null;
  summary: string | null;
  suggestions: string[];
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface ButlerVerificationDigestDto {
  id: string;
  projectId: string;
  verificationType: string;
  status: ButlerVerificationRunStatus;
  targetRef: string | null;
  summary: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface ButlerVerificationRunDto {
  id: string;
  projectId: string;
  butlerSessionId: string | null;
  sourcePatrolRunId: string | null;
  verificationType: string;
  status: ButlerVerificationRunStatus;
  targetRef: string | null;
  spec: Record<string, unknown>;
  artifactRefs: Array<Record<string, unknown>>;
  result: Record<string, unknown>;
  summary: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface ButlerInboxItemDto {
  id: string;
  projectId: string;
  workspaceId: string;
  projectName: string;
  projectLifecycleStatus: "active" | "paused" | "archived";
  itemType: ButlerInboxItemType;
  title: string;
  content: string;
  priority: ButlerInboxItemPriority;
  status: ButlerInboxItemStatus;
  assistantState: ButlerInboxAssistantStateDto;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface ButlerInboxAssistantStateDto {
  lifecycleStage: ButlerInboxLifecycleStage;
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

export interface ButlerManagedSessionDto {
  id: string;
  projectId: string;
  sessionId: string;
  provider: string | null;
  title: string | null;
  isArchived: boolean;
  isFavorite: boolean;
  role: "patrol" | "execution" | "verification" | "adhoc";
  ownershipMode: "managed" | "observed";
  status: "idle" | "running" | "blocked" | "failed" | "closed";
  runningState: string | null;
  lastSummary: string | null;
  lastCheckpointAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ButlerNotificationArchiveDto {
  notificationId: string;
  archivedAt: string;
  updatedAt: string;
}

export interface ButlerFollowUpTaskDto {
  id: string;
  projectId: string;
  projectName: string;
  workspaceId: string;
  butlerSessionId: string;
  sessionId: string;
  providerId?: "codex" | "claude-code";
  assistantButlerSessionId?: string;
  assistantSessionId?: string;
  sessionTitle: string | null;
  objective: string;
  completionCriteria?: string;
  maxAutoContinueCount?: number;
  status: ButlerFollowUpTaskStatus;
  checkIntervalSeconds: number;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  lastObservedRunningState: string | null;
  lastObservedMessageAt: string | null;
  lastObservedMessageCount: number;
  lastAutomationSummary: string | null;
  lastAutomationAt: string | null;
  autoContinueCount: number;
  waitingReason: string | null;
  rounds?: ButlerFollowUpTaskRoundDto[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ButlerFollowUpTaskRoundDto {
  roundNumber: number;
  kind: ButlerFollowUpRoundKind;
  status: ButlerFollowUpTaskStatus;
  summary: string;
  waitingReason: string | null;
  continuePrompt: string | null;
  observedRunningState: string | null;
  autoContinueCount: number;
  createdAt: string;
}

export interface ButlerPatrolPlanDto {
  id: string;
  projectId: string;
  name: string;
  triggerType: "manual" | "interval" | "cron";
  triggerConfig: Record<string, unknown>;
  executionMode: "readonly" | "controlled";
  patrolScope: Record<string, unknown>;
  enabled: boolean;
  lastScheduledAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ButlerOverviewDto {
  version: string;
  generatedAt: string;
  global: ButlerGlobalDigestDto;
  projects: ButlerProjectDigestDto[];
  sessions: ButlerSessionDigestDto[];
  inboxItems?: ButlerInboxItemDto[];
  patrols: ButlerPatrolDigestDto[];
  verifications: ButlerVerificationDigestDto[];
}

export interface ButlerSessionTargetProjectDto {
  id: string;
  workspaceId: string;
  name: string;
  repoRoot: string;
  lifecycleStatus: "active" | "paused" | "archived";
  riskLevel: "low" | "medium" | "high";
}

export interface ButlerSessionTargetSessionDto {
  id: string;
  projectId: string;
  sessionId: string;
  provider: string | null;
  title: string | null;
  role: "patrol" | "execution" | "verification" | "adhoc";
  ownershipMode: "managed" | "observed";
  status: "idle" | "running" | "blocked" | "failed" | "closed";
  runningState: string | null;
  lastSummary: string | null;
  lastCheckpointAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ButlerSessionTargetDto {
  workspaceId: string;
  project: ButlerSessionTargetProjectDto;
  session: ButlerSessionTargetSessionDto;
}

export interface ButlerSessionActionContextDto {
  workspaceId: string;
  project: ButlerSessionTargetProjectDto;
  session: ButlerSessionTargetSessionDto;
  latestFollowUpTask: ButlerFollowUpTaskDto | null;
  latestVerificationRun: ButlerVerificationRunDto | null;
}

export interface ButlerContextSnapshotDto extends ButlerOverviewDto {
  memories: Array<{
    id: string;
    projectId: string;
    title: string;
    memoryType: string;
    status: string;
    scopePath: string | null;
    tags: string[];
    confidence: number;
    updatedAt: string;
    createdAt: string;
  }>;
}

export interface ButlerProjectContextDto {
  version: string;
  generatedAt: string;
  project: ButlerProjectDigestDto;
  sessions: ButlerSessionDigestDto[];
  memories: ButlerContextSnapshotDto["memories"];
  inboxItems?: ButlerInboxItemDto[];
  patrols: ButlerPatrolDigestDto[];
  verifications: ButlerVerificationDigestDto[];
  topRisks: string[];
  nextActions: string[];
}

export interface ButlerSearchHitDto {
  kind: "project" | "session" | "memory" | "patrol" | "verification";
  id: string;
  sessionId: string | null;
  projectId: string | null;
  workspaceId: string | null;
  title: string;
  summary: string;
  score: number;
  updatedAt: string;
  isArchived: boolean;
}

export interface ButlerSearchResultDto {
  version: string;
  generatedAt: string;
  query: string;
  items: ButlerSearchHitDto[];
}

export interface ResumeButlerProjectSessionActionResultDto {
  result: {
    event: ButlerControlEventDto;
    resumed: ResumeButlerSessionResultDto;
  };
}

export interface ResumeButlerSessionResultDto {
  session: ButlerManagedSessionDto;
  resumedAt: string;
  provider: ButlerProviderId;
  providerSessionId: string;
}

export interface ButlerControlRelatedRefDto {
  kind: "project" | "butler-session" | "session" | "patrol-run" | "verification-run" | "workspace";
  id: string;
  label: string;
  routePath: string | null;
  workspaceId: string | null;
  projectId: string | null;
}

export interface ButlerControlEventDto {
  id: string;
  controlSessionId: string;
  kind: "action";
  actionType: "open-project" | "resume-session" | "start-patrol" | "start-verification";
  status: "succeeded" | "failed";
  title: string;
  content: string;
  relatedRefs: ButlerControlRelatedRefDto[];
  createdAt: string;
}

export interface ButlerInboxItemPayload {
  projectId?: string;
  itemType?: ButlerInboxItemType;
  title?: string;
  content?: string;
  priority?: ButlerInboxItemPriority;
  status?: ButlerInboxItemStatus;
}

const ASSISTANT_REQUEST_SOURCE_HEADER = "X-CodingNS-Assistant-Source";
const BUTLER_UI_REQUEST_SOURCE = "butler-ui";

const assistantCapabilityCompatibilityCache = new Map<string, boolean>();

interface AssistantCapabilityCompatibilityOptions<T> {
  unsupportedFallback?: T | (() => T);
}

async function requestAssistantCapability<T>(
  path: string,
  options: RequestInit = {},
  compatibility: AssistantCapabilityCompatibilityOptions<T> = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set(ASSISTANT_REQUEST_SOURCE_HEADER, BUTLER_UI_REQUEST_SOURCE);
  const compatibilityHostKey = getAssistantCompatibilityHostKey();
  const cachedSupport = assistantCapabilityCompatibilityCache.get(compatibilityHostKey);

  if (cachedSupport === false) {
    if (compatibility.unsupportedFallback !== undefined) {
      return resolveAssistantCompatibilityFallback(compatibility.unsupportedFallback);
    }

    throw createAssistantCapabilityUnsupportedError();
  }

  try {
    const response = await httpClient.request<T>(path, {
      ...options,
      headers
    });

    assistantCapabilityCompatibilityCache.set(compatibilityHostKey, true);
    return response;
  } catch (error) {
    if (!isAssistantCapabilityUnsupportedError(error)) {
      throw error;
    }

    assistantCapabilityCompatibilityCache.set(compatibilityHostKey, false);

    if (compatibility.unsupportedFallback !== undefined) {
      return resolveAssistantCompatibilityFallback(compatibility.unsupportedFallback);
    }

    throw createAssistantCapabilityUnsupportedError();
  }
}

function getAssistantCompatibilityHostKey(): string {
  return getHostBaseUrl();
}

function resolveAssistantCompatibilityFallback<T>(value: T | (() => T)): T {
  return typeof value === "function" ? (value as () => T)() : value;
}

function isAssistantCapabilityUnsupportedError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 405 || error.status === 501);
}

function createAssistantCapabilityUnsupportedError(): Error {
  return new Error("当前 Host 版本不支持新版助手接口，请先升级 Host。");
}

export function resetAssistantCapabilityCompatibilityCacheForTesting(): void {
  assistantCapabilityCompatibilityCache.clear();
}

export function getButlerProfile() {
  return httpClient.request<ButlerProfileResponseDto>("/api/butler/profile");
}

export function initButlerProfile(payload: ButlerProfilePayload) {
  return httpClient.request<ButlerProfileResponseDto>("/api/butler/profile/init", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateButlerProfile(payload: ButlerProfilePayload) {
  return httpClient.request<ButlerProfileResponseDto>("/api/butler/profile", {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function getCurrentButlerControlSession(workspaceId?: string | null) {
  const normalizedWorkspaceId = workspaceId?.trim() ?? "";
  const path = normalizedWorkspaceId
    ? `/api/butler/control-session?workspaceId=${encodeURIComponent(normalizedWorkspaceId)}`
    : "/api/butler/control-session";
  return httpClient.request<ButlerControlSessionResponseDto>(path);
}

export function listButlerControlSessions() {
  return httpClient.request<{ items: ButlerControlSessionDto[] }>("/api/butler/control-sessions");
}

export function getButlerControlSession(controlSessionId: string) {
  return httpClient.request<ButlerControlSessionResponseDto>(
    `/api/butler/control-sessions/${encodeURIComponent(controlSessionId)}`
  );
}

export function listButlerControlTimers(payload: {
  status?: ButlerControlTimerStatus | null;
  controlSessionId?: string | null;
  limit?: number | null;
} = {}) {
  const searchParams = new URLSearchParams();

  if (payload.status) {
    searchParams.set("status", payload.status);
  }

  if (payload.controlSessionId?.trim()) {
    searchParams.set("controlSessionId", payload.controlSessionId.trim());
  }

  if (payload.limit && payload.limit > 0) {
    searchParams.set("limit", String(payload.limit));
  }

  const query = searchParams.toString();
  const path = query ? `/api/butler/control-timers?${query}` : "/api/butler/control-timers";

  return httpClient.request<{ items: ButlerControlTimerDto[] }>(path);
}

export function getButlerControlTimer(timerId: string) {
  return httpClient.request<{ timer: ButlerControlTimerDto }>(
    `/api/butler/control-timers/${encodeURIComponent(timerId)}`
  );
}

export function resetButlerControlSession() {
  return httpClient.request<ButlerControlSessionResponseDto>("/api/butler/control-session/reset", {
    method: "POST"
  });
}

export function startButlerControlSession(payload: ButlerStartControlSessionPayload = {}) {
  return httpClient.request<{ controlSession: ButlerControlSessionDto }>(
    "/api/butler/control-session/start",
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function resumeButlerControlSession() {
  return httpClient.request<ButlerResumeControlSessionResponseDto>("/api/butler/control-session/resume", {
    method: "POST"
  });
}

export function sendButlerControlMessage(payload: ButlerSendMessagePayload) {
  return httpClient.request<ButlerSendMessageResponseDto>("/api/butler/control-session/messages", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function createButlerControlTimer(payload: {
  controlSessionId?: string | null;
  projectId?: string | null;
  targetSessionId?: string | null;
  title?: string | null;
  content: string;
  dueAt?: string | null;
  afterSeconds?: number | null;
}) {
  return httpClient.request<{ timer: ButlerControlTimerDto }>("/api/butler/control-timers", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function listAssistantAutomations(payload: {
  status?: AssistantAutomationStatus | null;
  controlSessionId?: string | null;
  limit?: number | null;
} = {}) {
  const searchParams = new URLSearchParams();

  if (payload.status) {
    searchParams.set("status", payload.status);
  }

  if (payload.controlSessionId?.trim()) {
    searchParams.set("controlSessionId", payload.controlSessionId.trim());
  }

  if (payload.limit && payload.limit > 0) {
    searchParams.set("limit", String(payload.limit));
  }

  const query = searchParams.toString();
  const path = query ? `/api/assistant/automations?${query}` : "/api/assistant/automations";

  return requestAssistantCapability<{ payload: { items: AssistantAutomationTaskDto[] } }>(
    path,
    {},
    {
      unsupportedFallback: () => ({
        payload: {
          items: []
        }
      })
    }
  );
}

export function listRecentAssistantAutomationRuns(payload: {
  controlSessionId?: string | null;
  limit?: number | null;
} = {}) {
  const searchParams = new URLSearchParams();

  if (payload.controlSessionId?.trim()) {
    searchParams.set("controlSessionId", payload.controlSessionId.trim());
  }

  if (payload.limit && payload.limit > 0) {
    searchParams.set("limit", String(payload.limit));
  }

  const query = searchParams.toString();
  const path = query
    ? `/api/assistant/automations/runs/recent?${query}`
    : "/api/assistant/automations/runs/recent";

  return requestAssistantCapability<{ payload: { items: AssistantAutomationRunDto[] } }>(
    path,
    {},
    {
      unsupportedFallback: () => ({
        payload: {
          items: []
        }
      })
    }
  );
}

export function cancelAssistantAutomation(automationId: string) {
  return requestAssistantCapability<{ payload: { automation: AssistantAutomationTaskDto } }>(
    `/api/assistant/automations/${encodeURIComponent(automationId)}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({})
    }
  );
}

export function updateAssistantAutomation(
  automationId: string,
  payload: {
    title?: string | null;
    content?: string;
    includeTriggerContext?: boolean;
    dueAt?: string | null;
    everySeconds?: number | null;
    everyMinutes?: number | null;
    everyHours?: number | null;
    stopAt?: string | null;
    cronMinute?: number | null;
    cronHour?: number | null;
    cronDaysOfWeek?: number[] | null;
    pollIntervalSeconds?: number | null;
    expiresAt?: string | null;
    maxChecks?: number | null;
  }
) {
  return requestAssistantCapability<{ payload: { automation: AssistantAutomationTaskDto } }>(
    `/api/assistant/automations/${encodeURIComponent(automationId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload)
    }
  );
}

export function skipAssistantAutomationWait(automationId: string) {
  return requestAssistantCapability<{ payload: { automation: AssistantAutomationTaskDto } }>(
    `/api/assistant/automations/${encodeURIComponent(automationId)}/skip-wait`,
    {
      method: "POST",
      body: JSON.stringify({})
    }
  );
}

export function cancelButlerControlTimer(timerId: string) {
  return httpClient.request<{ timer: ButlerControlTimerDto }>(
    `/api/butler/control-timers/${encodeURIComponent(timerId)}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({})
    }
  );
}

export function listButlerControlEvents() {
  return httpClient.request<{ items: ButlerControlEventDto[] }>("/api/butler/control-session/events");
}

export function getButlerOverview() {
  return httpClient.request<{ overview: ButlerOverviewDto }>("/api/butler/overview");
}

export function listButlerProjectSessions(projectId: string) {
  return httpClient.request<{ items: ButlerManagedSessionDto[] }>(
    `/api/butler/projects/${encodeURIComponent(projectId)}/sessions`
  );
}

export function resumeButlerProjectSession(projectId: string, butlerSessionId: string) {
  return httpClient.request<{ resumed: ResumeButlerSessionResultDto }>(
    `/api/butler/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(butlerSessionId)}/resume`,
    {
      method: "POST"
    }
  );
}

export function listButlerProjects(payload: {
  workspaceId?: string | null;
  status?: "active" | "paused" | "archived" | null;
  riskLevel?: "low" | "medium" | "high" | null;
} = {}) {
  const searchParams = new URLSearchParams();

  if (payload.workspaceId?.trim()) {
    searchParams.set("workspaceId", payload.workspaceId.trim());
  }

  if (payload.status) {
    searchParams.set("status", payload.status);
  }

  if (payload.riskLevel) {
    searchParams.set("riskLevel", payload.riskLevel);
  }

  const query = searchParams.toString();
  const path = query ? `/api/butler/projects?${query}` : "/api/butler/projects";

  return httpClient.request<{ items: ButlerProjectDto[] }>(path);
}

export function listButlerPatrolPlans(projectId: string, payload: {
  enabled?: boolean | null;
  executionMode?: "readonly" | "controlled" | null;
} = {}) {
  const searchParams = new URLSearchParams();

  if (payload.enabled !== null && payload.enabled !== undefined) {
    searchParams.set("enabled", String(payload.enabled));
  }

  if (payload.executionMode) {
    searchParams.set("executionMode", payload.executionMode);
  }

  const query = searchParams.toString();
  const path = query
    ? `/api/butler/projects/${encodeURIComponent(projectId)}/patrol-plans?${query}`
    : `/api/butler/projects/${encodeURIComponent(projectId)}/patrol-plans`;

  return httpClient.request<{ items: ButlerPatrolPlanDto[] }>(path);
}

export function listButlerInboxItems(payload: {
  workspaceId?: string | null;
  projectId?: string | null;
  status?: ButlerInboxItemStatus | null;
  itemType?: ButlerInboxItemType | null;
} = {}) {
  const searchParams = new URLSearchParams();

  if (payload.workspaceId?.trim()) {
    searchParams.set("workspaceId", payload.workspaceId.trim());
  }

  if (payload.projectId?.trim()) {
    searchParams.set("projectId", payload.projectId.trim());
  }

  if (payload.status) {
    searchParams.set("status", payload.status);
  }

  if (payload.itemType) {
    searchParams.set("itemType", payload.itemType);
  }

  const query = searchParams.toString();
  const path = query ? `/api/butler/inbox?${query}` : "/api/butler/inbox";

  return httpClient.request<{ items: ButlerInboxItemDto[] }>(path);
}

export function createButlerInboxItem(payload: {
  projectId: string;
  itemType?: ButlerInboxItemType;
  title: string;
  content: string;
  priority?: ButlerInboxItemPriority;
  status?: ButlerInboxItemStatus;
}) {
  return httpClient.request<{ item: ButlerInboxItemDto }>("/api/butler/inbox", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function listButlerFollowUpTasks(payload: {
  status?: ButlerFollowUpTaskStatus;
  projectId?: string | null;
  sessionId?: string | null;
} = {}) {
  const searchParams = new URLSearchParams();

  if (payload.status) {
    searchParams.set("status", payload.status);
  }

  if (payload.projectId?.trim()) {
    searchParams.set("projectId", payload.projectId.trim());
  }

  if (payload.sessionId?.trim()) {
    searchParams.set("sessionId", payload.sessionId.trim());
  }

  const query = searchParams.toString();
  const path = query ? `/api/butler/follow-up-tasks?${query}` : "/api/butler/follow-up-tasks";

  return httpClient.request<{ items: ButlerFollowUpTaskDto[] }>(path);
}

export function createButlerFollowUpTask(payload: {
  projectId: string;
  butlerSessionId: string;
  providerId: "codex" | "claude-code";
  objective: string;
  completionCriteria?: string;
  maxAutoContinueCount?: number;
  checkIntervalSeconds?: number;
}) {
  return httpClient.request<{ task: ButlerFollowUpTaskDto }>("/api/butler/follow-up-tasks", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getButlerFollowUpTask(taskId: string) {
  return httpClient.request<{ task: ButlerFollowUpTaskDto }>(
    `/api/butler/follow-up-tasks/${encodeURIComponent(taskId)}`
  );
}

export function cancelButlerFollowUpTask(taskId: string) {
  return httpClient.request<{ task: ButlerFollowUpTaskDto }>(
    `/api/butler/follow-up-tasks/${encodeURIComponent(taskId)}/cancel`,
    {
      method: "POST"
    }
  );
}

export function cancelButlerVerificationRun(projectId: string, verificationId: string) {
  return httpClient.request<{ run: ButlerVerificationRunDto }>(
    `/api/butler/projects/${encodeURIComponent(projectId)}/verifications/${encodeURIComponent(verificationId)}/cancel`,
    {
      method: "POST"
    }
  );
}

export function updateButlerInboxItem(itemId: string, payload: {
  projectId?: string;
  itemType?: ButlerInboxItemType;
  title?: string;
  content?: string;
  priority?: ButlerInboxItemPriority;
  status?: ButlerInboxItemStatus;
}) {
  return httpClient.request<{ item: ButlerInboxItemDto }>(
    `/api/butler/inbox/${encodeURIComponent(itemId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        projectId: payload.projectId,
        itemType: payload.itemType,
        title: payload.title,
        content: payload.content,
        priority: payload.priority,
        status: payload.status
      })
    }
  );
}

export function analyzeButlerInboxItem(itemId: string) {
  return httpClient.request<{ item: ButlerInboxItemDto; controlSession: ButlerControlSessionDto }>(
    `/api/butler/inbox/${encodeURIComponent(itemId)}/analyze`,
    {
      method: "POST",
      body: JSON.stringify({})
    }
  );
}

export function startButlerInboxItemSession(itemId: string) {
  return httpClient.request<{
    item: ButlerInboxItemDto;
    session: ButlerManagedSessionDto;
    followUpTask: ButlerFollowUpTaskDto | null;
  }>(
    `/api/butler/inbox/${encodeURIComponent(itemId)}/start-session`,
    {
      method: "POST",
      body: JSON.stringify({})
    }
  );
}

export function deleteButlerInboxItem(itemId: string) {
  return httpClient.request<void>(`/api/butler/inbox/${encodeURIComponent(itemId)}`, {
    method: "DELETE"
  });
}

export function listButlerNotificationArchives() {
  return httpClient.request<{ items: ButlerNotificationArchiveDto[] }>("/api/butler/notifications/archives");
}

export function updateButlerNotificationArchive(notificationId: string, archived: boolean) {
  return httpClient.request<{ item: ButlerNotificationArchiveDto | null }>(
    `/api/butler/notifications/archives/${encodeURIComponent(notificationId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ archived })
    }
  );
}

export function getButlerContextSnapshot() {
  return httpClient.request<{ snapshot: ButlerContextSnapshotDto }>("/api/butler/context-snapshot");
}

export function getButlerProjectContext(projectId: string) {
  return httpClient.request<{ context: ButlerProjectContextDto }>(
    `/api/butler/projects/${encodeURIComponent(projectId)}/context`
  );
}

export function searchButlerSummaries(payload: {
  q: string;
  projectId?: string | null;
  includeArchived?: boolean;
}) {
  const searchParams = new URLSearchParams();
  searchParams.set("q", payload.q);

  if (payload.projectId?.trim()) {
    searchParams.set("projectId", payload.projectId.trim());
  }

  if (payload.includeArchived) {
    searchParams.set("includeArchived", "true");
  }

  return httpClient.request<{ result: ButlerSearchResultDto }>(
    `/api/butler/search?${searchParams.toString()}`
  );
}

export function getButlerSessionTarget(sessionId: string) {
  const searchParams = new URLSearchParams();
  searchParams.set("sessionId", sessionId);

  return httpClient.request<{ target: ButlerSessionTargetDto }>(
    `/api/butler/session-target?${searchParams.toString()}`
  );
}

export function getButlerSessionActionContext(sessionId: string) {
  const searchParams = new URLSearchParams();
  searchParams.set("sessionId", sessionId);

  return httpClient.request<{ context: ButlerSessionActionContextDto }>(
    `/api/butler/session-action-context?${searchParams.toString()}`
  );
}

export function openButlerProjectAction(projectId: string) {
  return httpClient.request<{ result: unknown }>("/api/butler/actions/open-project", {
    method: "POST",
    body: JSON.stringify({
      projectId
    })
  });
}

export function resumeButlerProjectSessionAction(payload: {
  projectId: string;
  butlerSessionId: string;
}) {
  return httpClient.request<{ result: unknown }>("/api/butler/actions/resume-session", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function startButlerPatrolAction(payload: {
  projectId: string;
  planId?: string | null;
  triggerRef?: string | null;
  butlerSessionId?: string | null;
  suggestions?: string[];
}) {
  return httpClient.request<{ result: unknown }>("/api/butler/actions/start-patrol", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function startButlerVerificationAction(payload: {
  projectId: string;
  verificationType?: "test" | "health" | "browser" | "visual" | "metric";
  targetRef?: string | null;
  butlerSessionId?: string | null;
  sourcePatrolRunId?: string | null;
  spec?: Record<string, unknown>;
}) {
  return httpClient.request<{ result: { run: ButlerVerificationRunDto } }>("/api/butler/actions/start-verification", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
