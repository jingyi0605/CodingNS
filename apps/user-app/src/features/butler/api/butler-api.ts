import { httpClient } from "../../../network/http-client";
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
    [key: string]: unknown;
  };
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
    [key: string]: unknown;
  };
}

export interface ButlerProfileResponseDto {
  initialized: boolean;
  profile: ButlerProfileDto | null;
}

export interface ButlerControlSessionDto {
  id: string;
  providerId: ButlerProviderId;
  sessionId: string;
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
}

export interface ButlerControlSessionResponseDto {
  controlSession: ButlerControlSessionDto | null;
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
  status: string;
  targetRef: string | null;
  summary: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface ButlerOverviewDto {
  version: string;
  generatedAt: string;
  global: ButlerGlobalDigestDto;
  projects: ButlerProjectDigestDto[];
  sessions: ButlerSessionDigestDto[];
  patrols: ButlerPatrolDigestDto[];
  verifications: ButlerVerificationDigestDto[];
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
  patrols: ButlerPatrolDigestDto[];
  verifications: ButlerVerificationDigestDto[];
  topRisks: string[];
  nextActions: string[];
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

export function getCurrentButlerControlSession() {
  return httpClient.request<ButlerControlSessionResponseDto>("/api/butler/control-session");
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

export function listButlerControlEvents() {
  return httpClient.request<{ items: ButlerControlEventDto[] }>("/api/butler/control-session/events");
}

export function getButlerOverview() {
  return httpClient.request<{ overview: ButlerOverviewDto }>("/api/butler/overview");
}

export function getButlerContextSnapshot() {
  return httpClient.request<{ snapshot: ButlerContextSnapshotDto }>("/api/butler/context-snapshot");
}

export function getButlerProjectContext(projectId: string) {
  return httpClient.request<{ context: ButlerProjectContextDto }>(
    `/api/butler/projects/${encodeURIComponent(projectId)}/context`
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
  return httpClient.request<{ result: unknown }>("/api/butler/actions/start-verification", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
