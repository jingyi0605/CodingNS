import type { ButlerProject, SessionActivityState, SessionRunningState } from "../../types/domain.js";
import { nowIso } from "../../shared/utils/time.js";
import type { ButlerProjectService } from "../butler/butler-project-service.js";
import type { ButlerProjectSessionView, ButlerSessionService } from "../butler/butler-session-service.js";
import { createTaskManager, type TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES, type TaskHandle } from "../tasks/task-types.js";
import type { AffairsLibraryBindingDto, AffairsLibraryService } from "../workspace/affairs-library-service.js";
import type { AffairsAssistantSessionSnapshotRecord } from "../../types/domain.js";
import type { AffairsAssistantSessionSnapshotRepository } from "../../storage/repositories/affairs-assistant-session-snapshot-repository.js";

const AFFAIRS_ASSISTANT_SESSION_SNAPSHOT_MAX_AGE_MS = 15_000;
const AFFAIRS_ASSISTANT_SESSION_TASK_TIMEOUT_MS = 30_000;

export interface AffairsAssistantSessionSummary {
  sessionId: string;
  workspaceId: string;
  provider: string;
  providerSessionId: string;
  rawStoreRef: string;
  providerConfigMode: "global-default";
  providerPresetId: null;
  parentSessionId: null;
  isSubagent: false;
  subagentLabel: null;
  isArchived: boolean;
  isFavorite: boolean;
  title: string;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: "idle";
  syncCursor: null;
  lastSyncAt: string | null;
  lastErrorCode: null;
  lastErrorDetail: null;
  resumedAt: null;
  runningState: SessionRunningState | null;
  activitySource: "inferred";
  lastEventAt: string | null;
  completedAt: string | null;
  lastSeenAt: string | null;
  activityState: "idle" | "running" | "completed_unread";
}

export interface AffairsAssistantSessionSnapshot {
  workspaceId: string;
  userId: string;
  projectId: string | null;
  projectWorkspaceId: string | null;
  agentWorkspacePath: string | null;
  sessions: AffairsAssistantSessionSummary[];
  updatedAt: string;
}

export class AffairsAssistantSessionSnapshotService {
  constructor(
    private readonly repository: AffairsAssistantSessionSnapshotRepository,
    private readonly affairsLibraryService: Pick<AffairsLibraryService, "getBinding">,
    private readonly butlerProjectService: Pick<ButlerProjectService, "list">,
    private readonly butlerSessionService: Pick<
      ButlerSessionService,
      "ensureProjectSessionsSynced" | "listByProject"
    >,
    private readonly taskManager: TaskManager = createTaskManager()
  ) {
    this.registerBackgroundTasks();
  }

  readSnapshot(workspaceId: string, userId: string): AffairsAssistantSessionSnapshot | null {
    const record = this.repository.findByWorkspaceAndUserId(workspaceId, userId);

    if (!record) {
      return null;
    }

    return mapSnapshotRecord(record);
  }

  shouldRefresh(workspaceId: string, userId: string, maxAgeMs = AFFAIRS_ASSISTANT_SESSION_SNAPSHOT_MAX_AGE_MS): boolean {
    const snapshot = this.readSnapshot(workspaceId, userId);

    if (!snapshot) {
      return true;
    }

    const updatedAtMs = Date.parse(snapshot.updatedAt);

    if (!Number.isFinite(updatedAtMs)) {
      return true;
    }

    return Date.now() - updatedAtMs > maxAgeMs;
  }

  scheduleRefresh(
    workspaceId: string,
    userId: string,
    options?: {
      force?: boolean;
      source?: string;
    }
  ): TaskHandle<AffairsAssistantSessionSnapshot> | null {
    const normalizedWorkspaceId = workspaceId.trim();
    const normalizedUserId = userId.trim();

    if (!normalizedWorkspaceId || !normalizedUserId) {
      return null;
    }

    if (!options?.force && !this.shouldRefresh(normalizedWorkspaceId, normalizedUserId)) {
      this.taskManager.recordCacheHit(HOST_TASK_TYPES.workbenchAffairsAssistantSessions, `${normalizedWorkspaceId}:${normalizedUserId}`);
      return null;
    }

    return this.taskManager.enqueue<{
      workspaceId: string;
      userId: string;
      force: boolean;
    }, AffairsAssistantSessionSnapshot>(HOST_TASK_TYPES.workbenchAffairsAssistantSessions, {
      key: `${normalizedWorkspaceId}:${normalizedUserId}`,
      source: options?.source ?? "workbench.affairs_assistant_sessions",
      input: {
        workspaceId: normalizedWorkspaceId,
        userId: normalizedUserId,
        force: options?.force ?? false
      }
    });
  }

  async refreshNow(
    workspaceId: string,
    userId: string,
    options?: {
      force?: boolean;
      source?: string;
    }
  ): Promise<AffairsAssistantSessionSnapshot> {
    const handle = this.scheduleRefresh(workspaceId, userId, {
      force: options?.force ?? false,
      source: options?.source ?? "workbench.affairs_assistant_sessions.await"
    });

    if (!handle) {
      return this.readSnapshot(workspaceId, userId) ?? createEmptySnapshot({
        workspaceId,
        userId
      });
    }

    return await handle.promise;
  }

  private registerBackgroundTasks(): void {
    if (this.taskManager.has(HOST_TASK_TYPES.workbenchAffairsAssistantSessions)) {
      return;
    }

    this.taskManager.register<{
      workspaceId: string;
      userId: string;
      force: boolean;
    }, AffairsAssistantSessionSnapshot>({
      taskType: HOST_TASK_TYPES.workbenchAffairsAssistantSessions,
      executionLane: "host_background",
      timeoutMs: AFFAIRS_ASSISTANT_SESSION_TASK_TIMEOUT_MS,
      run: async (input, context) => {
        context.reportProgress({
          phase: "resolve_binding",
          label: "读取事务文档绑定"
        });
        return await this.runRefreshSnapshot(input.workspaceId, input.userId, input.force, context.signal);
      }
    });
  }

  private async runRefreshSnapshot(
    workspaceId: string,
    userId: string,
    force: boolean,
    signal?: AbortSignal
  ): Promise<AffairsAssistantSessionSnapshot> {
    const binding = this.affairsLibraryService.getBinding(workspaceId, userId);
    const agentWorkspacePath = resolveAffairsAgentWorkspacePath(binding);

    if (!binding?.enabled || !agentWorkspacePath) {
      return this.persistSnapshot(createEmptySnapshot({
        workspaceId,
        userId,
        agentWorkspacePath
      }));
    }

    const activeProjects = this.butlerProjectService
      .list()
      .filter((project) => project.lifecycleStatus === "active");
    const projectCandidates = buildAffairsAgentProjectCandidates(activeProjects, agentWorkspacePath);

    if (projectCandidates.length === 0) {
      return this.persistSnapshot(createEmptySnapshot({
        workspaceId,
        userId,
        agentWorkspacePath
      }));
    }

    let resolvedProject: ButlerProject | null = null;
    let resolvedSessions: ButlerProjectSessionView[] = [];

    for (const project of projectCandidates) {
      if (signal?.aborted) {
        throw signal.reason ?? new Error("aborted");
      }

      await this.butlerSessionService.ensureProjectSessionsSynced(project.id, userId, {
        includeArchived: true,
        force,
        mode: "background",
        signal
      });

      const sessions = this.butlerSessionService.listByProject(project.id, userId, {
        includeArchived: true
      });

      if (!resolvedProject || sessions.length > 0) {
        resolvedProject = project;
        resolvedSessions = sessions;
      }

      if (sessions.length > 0) {
        break;
      }
    }

    return this.persistSnapshot({
      workspaceId,
      userId,
      projectId: resolvedProject?.id ?? null,
      projectWorkspaceId: resolvedProject?.workspaceId ?? null,
      agentWorkspacePath,
      sessions: resolvedProject
        ? resolvedSessions.map((session) => mapButlerProjectSessionToAffairsAssistantSummary(
          session,
          resolvedProject.workspaceId
        ))
        : [],
      updatedAt: nowIso()
    });
  }

  private persistSnapshot(snapshot: AffairsAssistantSessionSnapshot): AffairsAssistantSessionSnapshot {
    this.repository.upsert({
      workspaceId: snapshot.workspaceId,
      userId: snapshot.userId,
      projectId: snapshot.projectId,
      projectWorkspaceId: snapshot.projectWorkspaceId,
      agentWorkspacePath: snapshot.agentWorkspacePath,
      sessionsJson: JSON.stringify(snapshot.sessions),
      updatedAt: snapshot.updatedAt
    });

    return snapshot;
  }
}

function createEmptySnapshot(input: {
  workspaceId: string;
  userId: string;
  agentWorkspacePath?: string | null;
}): AffairsAssistantSessionSnapshot {
  return {
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: null,
    projectWorkspaceId: null,
    agentWorkspacePath: input.agentWorkspacePath ?? null,
    sessions: [],
    updatedAt: nowIso()
  };
}

function mapSnapshotRecord(record: AffairsAssistantSessionSnapshotRecord): AffairsAssistantSessionSnapshot {
  return {
    workspaceId: record.workspaceId,
    userId: record.userId,
    projectId: record.projectId,
    projectWorkspaceId: record.projectWorkspaceId,
    agentWorkspacePath: record.agentWorkspacePath,
    sessions: parseSnapshotSessions(record.sessionsJson),
    updatedAt: record.updatedAt
  };
}

function parseSnapshotSessions(input: string): AffairsAssistantSessionSummary[] {
  try {
    const parsed = JSON.parse(input) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is AffairsAssistantSessionSummary => {
      if (!item || typeof item !== "object") {
        return false;
      }

      const candidate = item as Record<string, unknown>;
      return typeof candidate.sessionId === "string" && typeof candidate.title === "string";
    });
  } catch {
    return [];
  }
}

function mapButlerProjectSessionToAffairsAssistantSummary(
  session: ButlerProjectSessionView,
  workspaceId: string
): AffairsAssistantSessionSummary {
  const normalizedProvider = session.provider?.trim() || "codex";
  const updatedAt = session.updatedAt;
  const runningState = normalizeAffairsRunningState(session.runningState);
  const completedAt = session.completedAt ?? (session.status === "closed" ? updatedAt : null);
  const lastEventAt = session.lastEventAt ?? updatedAt;

  return {
    sessionId: session.sessionId,
    workspaceId,
    provider: normalizedProvider,
    providerSessionId: session.sessionId,
    rawStoreRef: `butler://${session.id}`,
    providerConfigMode: "global-default",
    providerPresetId: null,
    parentSessionId: null,
    isSubagent: false,
    subagentLabel: null,
    isArchived: session.isArchived,
    isFavorite: session.isFavorite,
    title: session.title?.trim() || session.sessionId,
    messageCount: 0,
    lastMessageAt: updatedAt,
    createdAt: session.createdAt,
    updatedAt,
    syncStatus: "idle",
    syncCursor: null,
    lastSyncAt: updatedAt,
    lastErrorCode: null,
    lastErrorDetail: null,
    resumedAt: null,
    runningState,
    activitySource: "inferred",
    lastEventAt,
    completedAt,
    lastSeenAt: session.lastSeenAt,
    activityState: resolveAffairsAssistantActivityState({
      runningState,
      status: session.status,
      completedAt,
      lastSeenAt: session.lastSeenAt
    })
  };
}

function resolveAffairsAssistantActivityState(input: {
  runningState: AffairsAssistantSessionSummary["runningState"];
  status: ButlerProjectSessionView["status"];
  completedAt: string | null;
  lastSeenAt: string | null;
}): SessionActivityState {
  if (input.status === "running" || input.runningState === "starting" || input.runningState === "running") {
    return "running";
  }

  if (input.completedAt && (!input.lastSeenAt || input.completedAt > input.lastSeenAt)) {
    return "completed_unread";
  }

  return "idle";
}

function buildAffairsAgentProjectCandidates(
  projects: ButlerProject[],
  workspacePath: string
): ButlerProject[] {
  const normalizedWorkspacePath = normalizeAffairsWorkspacePath(workspacePath);

  return projects
    .map((project) => ({
      project,
      matchLength: resolveAffairsWorkspacePathMatchLength(project.repoRoot, normalizedWorkspacePath)
    }))
    .filter((item) => item.matchLength > 0)
    .sort((left, right) => right.matchLength - left.matchLength)
    .map((item) => item.project);
}

function resolveAffairsAgentWorkspacePath(binding: AffairsLibraryBindingDto | null): string | null {
  const mirrorRoot = binding?.mirrorRoot?.trim() ?? "";

  if (mirrorRoot) {
    return mirrorRoot;
  }

  const rootDir = binding?.rootDir?.trim() ?? "";
  return rootDir || null;
}

function normalizeAffairsRunningState(runningState: string | null | undefined): AffairsAssistantSessionSummary["runningState"] {
  switch (runningState) {
    case "idle":
    case "starting":
    case "running":
    case "completed":
    case "interrupted":
    case "failed":
      return runningState;
    case "reconnecting":
    case "stale":
    case "unknown":
    default:
      return "idle";
  }
}

function resolveAffairsWorkspacePathMatchLength(
  leftPath: string | null | undefined,
  rightPath: string | null | undefined
): number {
  const normalizedLeftPath = normalizeAffairsWorkspacePath(leftPath);
  const normalizedRightPath = normalizeAffairsWorkspacePath(rightPath);

  if (!normalizedLeftPath || !normalizedRightPath) {
    return 0;
  }

  if (normalizedLeftPath === normalizedRightPath) {
    return normalizedLeftPath.length;
  }

  if (normalizedRightPath.startsWith(`${normalizedLeftPath}/`)) {
    return normalizedLeftPath.length;
  }

  if (normalizedLeftPath.startsWith(`${normalizedRightPath}/`)) {
    return normalizedRightPath.length;
  }

  return 0;
}

function normalizeAffairsWorkspacePath(input: string | null | undefined): string {
  return input?.trim().replace(/\/+$/g, "") ?? "";
}
