import path from "node:path";

import type { SessionListItem, Workspace, WorkspaceWorktreeRecord } from "../../types/domain.js";
import { logPerformance } from "../../shared/utils/perf-log.js";
import type {
  SessionHistoryService,
  WorkspaceDiscoveryStatusSummary
} from "../sessions/session-history-service.js";
import type { WorkspaceNavigationStateRepository } from "../../storage/repositories/workspace-navigation-state-repository.js";
import type { WorkspaceRepository } from "../../storage/repositories/workspace-repository.js";
import type { WorkspaceWorktreeRepository } from "../../storage/repositories/workspace-worktree-repository.js";
import type { SessionIsolatedWorkspaceRepository } from "../../storage/repositories/session-isolated-workspace-repository.js";
import type { ButlerProfileService } from "../butler/butler-profile-service.js";
import type { ButlerControlSessionRepository } from "../../storage/repositories/butler-control-session-repository.js";
import { createTaskManager, type TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES, type TaskHandle } from "../tasks/task-types.js";
import { withSnapshotRevision } from "./snapshot-revision.js";
import type {
  AffairsAssistantSessionSnapshot,
  AffairsAssistantSessionSnapshotService
} from "./affairs-assistant-session-snapshot-service.js";

const WORKBENCH_DISCOVERY_REFRESH_BUDGET = 3;
const WORKBENCH_DISCOVERY_VISIBLE_MAX_AGE_MS = 15_000;
const WORKBENCH_DISCOVERY_HOT_MAX_AGE_MS = 60_000;
const WORKBENCH_DISCOVERY_WARM_MAX_AGE_MS = 120_000;
const WORKBENCH_DISCOVERY_COLD_MAX_AGE_MS = 300_000;
const WORKBENCH_DISCOVERY_RECENT_ACTIVITY_WINDOW_MS = 30 * 60_000;
const SESSION_TITLE_SYNC_CONCURRENCY = 4;

export interface WorkbenchWorktreeNode {
  workspace: Workspace;
  meta: WorkspaceWorktreeRecord;
  sessions: WorkbenchSessionSummary[];
  children: WorkbenchWorktreeNode[];
}

export interface WorkbenchSnapshotItem {
  workspace: Workspace;
  sessions: WorkbenchSessionSummary[];
  childWorktrees?: WorkbenchWorktreeNode[];
  collapsed: boolean;
}

export interface WorkbenchSnapshot {
  revision: string;
  items: WorkbenchSnapshotItem[];
}

interface WorkbenchDiscoveryCandidate {
  workspace: Workspace;
  maxAgeMs: number;
  priorityBand: 0 | 1 | 2 | 3;
  hasRunningSession: boolean;
  hasRecentActivity: boolean;
  isVisibleRoot: boolean;
  sortOrder: number;
  recentActivityAtMs: number;
}

export class WorkbenchService {
  private readonly taskManager: TaskManager;

  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly workspaceNavigationStateRepository: WorkspaceNavigationStateRepository,
    private readonly sessionHistoryService: SessionHistoryService,
    private readonly butlerProfileService: Pick<ButlerProfileService, "getProfile">,
    private readonly butlerControlSessionRepository: Pick<ButlerControlSessionRepository, "listSessionIds">,
    private readonly workspaceWorktreeRepository?: Pick<
      WorkspaceWorktreeRepository,
      "listWorkspaceIds" | "listByRootWorkspaceId"
    >,
    taskManager: TaskManager = createTaskManager(),
    private readonly sessionIsolatedWorkspaceRepository?: Pick<
      SessionIsolatedWorkspaceRepository,
      "listByLifecycleStatuses"
    >,
    private readonly affairsAssistantSessionSnapshotService?: Pick<
      AffairsAssistantSessionSnapshotService,
      "readSnapshot" | "refreshNow" | "scheduleRefresh" | "shouldRefresh"
    >
  ) {
    this.taskManager = taskManager;
    this.registerBackgroundTasks();
  }

  getSnapshot(userId: string): WorkbenchSnapshot {
    const allWorkspaces = this.listWorkbenchWorkspaces(userId);
    const navigationStates = this.workspaceNavigationStateRepository.listByUserId(userId);
    const navigationStateByWorkspaceId = new Map(
      navigationStates.map((item) => [item.workspaceId, item] as const)
    );
    const hiddenWorkspaceIdSet = new Set(
      navigationStates
        .filter((item) => item.hidden)
        .map((item) => item.workspaceId)
    );
    const workspaces = this.listVisibleWorkspaces(allWorkspaces, hiddenWorkspaceIdSet);
    const workspaceById = new Map(
      allWorkspaces
        .filter((workspace) => !hiddenWorkspaceIdSet.has(workspace.id))
        .map((workspace) => [workspace.id, workspace] as const)
    );

    const collapsedWorkspaceIdSet = new Set(
      navigationStates
        .filter((item) => item.collapsed)
        .map((item) => item.workspaceId)
    );

    return withSnapshotRevision({
      items: workspaces.map((workspace) => {
        return {
          workspace: applyWorkspaceNavigationState(workspace, navigationStateByWorkspaceId.get(workspace.id)),
          sessions: projectWorkbenchSessions(this.filterButlerControlSessions(
            this.sessionHistoryService.listWorkspaceSessions(workspace.id, userId)
          )),
          childWorktrees: this.buildChildWorktrees(
          workspace.id,
          workspaceById,
          navigationStateByWorkspaceId,
          hiddenWorkspaceIdSet,
          userId
          ),
          collapsed: collapsedWorkspaceIdSet.has(workspace.id)
        };
      })
    });
  }

  getAffairsAssistantSessionsSnapshot(
    workspaceId: string,
    userId: string
  ): AffairsAssistantSessionSnapshot {
    return this.affairsAssistantSessionSnapshotService?.readSnapshot(workspaceId, userId)
      ?? createEmptyAffairsAssistantSessionsSnapshot(workspaceId, userId);
  }

  async refreshAffairsAssistantSessionsSnapshot(
    workspaceId: string,
    userId: string,
    options?: {
      force?: boolean;
      awaitRefresh?: boolean;
    }
  ): Promise<AffairsAssistantSessionSnapshot> {
    if (!this.affairsAssistantSessionSnapshotService) {
      return createEmptyAffairsAssistantSessionsSnapshot(workspaceId, userId);
    }

    if (!options?.awaitRefresh) {
      const current = this.getAffairsAssistantSessionsSnapshot(workspaceId, userId);
      const handle = this.affairsAssistantSessionSnapshotService.scheduleRefresh(workspaceId, userId, {
        force: options?.force ?? false,
        source: "workbench.refresh_affairs_assistant_sessions.background"
      });
      void handle?.promise.catch((error) => {
        logPerformance(
          "workbench.refresh_affairs_assistant_sessions.background_failed",
          0,
          {
            workspaceId,
            userId,
            error: error instanceof Error ? error.message : "unknown"
          },
          {
            thresholdMs: 0,
            force: true
          }
        );
      });
      return current;
    }

    return await this.affairsAssistantSessionSnapshotService.refreshNow(workspaceId, userId, {
      force: options?.force ?? false,
      source: "workbench.refresh_affairs_assistant_sessions"
    });
  }

  shouldRefreshSnapshot(userId: string): boolean {
    return this.selectDiscoveryCandidates(userId, false).length > 0;
  }

  async refreshSnapshot(
    userId: string,
    options?: {
      force?: boolean;
      awaitDiscovery?: boolean;
    }
  ): Promise<WorkbenchSnapshot> {
    const startedAt = Date.now();
    const force = options?.force ?? true;
    const awaitDiscovery = options?.awaitDiscovery ?? false;

    if (awaitDiscovery) {
      await this.refreshWorkspaceSessions(userId, {
        force,
        refreshStateMode: "deferred"
      });
    } else {
      this.scheduleSnapshotRefresh(userId, {
        force
      });
    }

    const snapshot = this.getSnapshot(userId);

    logPerformance(
      "workbench.refresh_snapshot",
      Date.now() - startedAt,
      {
        workspaceCount: snapshot.items.length,
        sessionCount: snapshot.items.reduce(
          (total, item) => total + countWorkbenchSessions(item),
          0
        ),
        awaitDiscovery
      },
      {
        thresholdMs: 300
      }
    );

    return snapshot;
  }

  scheduleSnapshotRefresh(
    userId: string,
    options?: {
      force?: boolean;
    }
  ): void {
    this.scheduleWorkspaceRefreshes(userId, options);
  }

  async syncSessionTitles(userId: string): Promise<WorkbenchSnapshot> {
    return await this.scheduleSessionTitleSync(userId, "workbench.sync_session_titles").promise;
  }

  scheduleSessionTitleSync(userId: string, source = "workbench.sync_session_titles"): TaskHandle<WorkbenchSnapshot> {
    return this.taskManager.enqueue<{
      userId: string;
    }, WorkbenchSnapshot>(HOST_TASK_TYPES.workbenchSyncTitles, {
      key: userId,
      source,
      input: {
        userId
      }
    });
  }

  private registerBackgroundTasks(): void {
    if (!this.taskManager.has(HOST_TASK_TYPES.workbenchSyncTitles)) {
      this.taskManager.register<{
        userId: string;
      }, WorkbenchSnapshot>({
        taskType: HOST_TASK_TYPES.workbenchSyncTitles,
        executionLane: "host_background",
        run: async ({ userId }, context) => this.runSyncSessionTitles(userId, context.signal)
      });
    }
  }

  private async runSyncSessionTitles(
    userId: string,
    signal?: AbortSignal
  ): Promise<WorkbenchSnapshot> {
    const workspaces = this.listWorkbenchWorkspaces(userId);

    await Promise.all(
      workspaces.map((workspace) =>
        this.sessionHistoryService.syncWorkspaceSessionTitles(
          workspace.id,
          userId,
          SESSION_TITLE_SYNC_CONCURRENCY,
          signal
        )
      )
    );

    return this.getSnapshot(userId);
  }

  private listWorkbenchWorkspaces(userId: string): Workspace[] {
    const butlerWorkspacePath = this.butlerProfileService.getProfile(userId)?.workspacePath ?? null;

    if (!butlerWorkspacePath) {
      return this.workspaceRepository.listByOwnerUserId(userId);
    }

    return this.workspaceRepository
      .listByOwnerUserId(userId)
      .filter((workspace) => !isPathInsideButlerWorkspace(workspace.path, butlerWorkspacePath));
  }

  private listVisibleWorkspaces(workspaces: Workspace[], hiddenWorkspaceIdSet: ReadonlySet<string> = new Set()): Workspace[] {
    const childWorkspaceIdSet = new Set(this.workspaceWorktreeRepository?.listWorkspaceIds() ?? []);
    const hiddenTemporaryWorkspaceIdSet = new Set(
      this.sessionIsolatedWorkspaceRepository
        ?.listByLifecycleStatuses(["active", "removing"])
        .map((record) => record.workspaceId)
        ?? []
    );

    return workspaces
      .filter((workspace) => !childWorkspaceIdSet.has(workspace.id))
      .filter((workspace) => !hiddenTemporaryWorkspaceIdSet.has(workspace.id))
      .filter((workspace) => !hiddenWorkspaceIdSet.has(workspace.id));
  }

  private scheduleWorkspaceRefreshes(
    userId: string,
    options?: {
      force?: boolean;
    }
  ): void {
    if (typeof this.sessionHistoryService.requestWorkspaceDiscovery === "function") {
      for (const candidate of this.selectDiscoveryCandidates(userId, options?.force ?? false)) {
        this.sessionHistoryService.requestWorkspaceDiscovery(candidate.workspace.id, userId, {
          maxAgeMs: candidate.maxAgeMs,
          force: options?.force ?? false,
          refreshStateMode: "deferred"
        });
      }
    }
  }

  private async refreshWorkspaceSessions(
    userId: string,
    options?: {
      force?: boolean;
      refreshStateMode?: "inline" | "deferred";
    }
  ): Promise<void> {
    const candidates = this.selectDiscoveryCandidates(userId, options?.force ?? false);

    await Promise.allSettled(
      candidates.map((candidate) =>
        this.sessionHistoryService.discoverWorkspaceSessions(candidate.workspace.id, userId, {
          maxAgeMs: candidate.maxAgeMs,
          force: options?.force ?? true,
          refreshStateMode: options?.refreshStateMode ?? "deferred"
        })
      )
    );
  }

  private selectDiscoveryCandidates(
    userId: string,
    force: boolean
  ): WorkbenchDiscoveryCandidate[] {
    const selected: WorkbenchDiscoveryCandidate[] = [];

    for (const candidate of this.buildDiscoveryCandidates(userId)) {
      if (!candidate.hasRunningSession && !candidate.hasRecentActivity) {
        continue;
      }

      if (
        !force
        && !this.sessionHistoryService.needsWorkspaceDiscovery(candidate.workspace.id, candidate.maxAgeMs)
      ) {
        continue;
      }

      selected.push(candidate);

      if (selected.length >= WORKBENCH_DISCOVERY_REFRESH_BUDGET) {
        break;
      }
    }

    return selected;
  }

  private buildDiscoveryCandidates(userId: string): WorkbenchDiscoveryCandidate[] {
    const workspaces = this.listWorkbenchWorkspaces(userId);
    const navigationStates = this.workspaceNavigationStateRepository.listByUserId(userId);
    const hiddenWorkspaceIdSet = new Set(
      navigationStates
        .filter((item) => item.hidden)
        .map((item) => item.workspaceId)
    );
    const visibleRootIds = new Set(
      this.listVisibleWorkspaces(workspaces, hiddenWorkspaceIdSet).map((workspace) => workspace.id)
    );
    const childWorkspaceIdSet = new Set(this.workspaceWorktreeRepository?.listWorkspaceIds() ?? []);
    const hiddenTemporaryWorkspaceIdSet = new Set(
      this.sessionIsolatedWorkspaceRepository
        ?.listByLifecycleStatuses(["active", "removing"])
        .map((record) => record.workspaceId)
        ?? []
    );

    return workspaces
      .filter((workspace) => !hiddenWorkspaceIdSet.has(workspace.id))
      .filter((workspace) => !hiddenTemporaryWorkspaceIdSet.has(workspace.id))
      .map((workspace, index) => {
        const sessions = this.filterButlerControlSessions(
          this.sessionHistoryService.listWorkspaceSessions(workspace.id, userId)
        );
        const discoveryStatus = this.sessionHistoryService.getWorkspaceDiscoveryStatusSummary?.(workspace.id) ?? null;
        const isVisibleRoot = visibleRootIds.has(workspace.id);
        const isChildWorkspace = childWorkspaceIdSet.has(workspace.id);
        const hasRunningSession = sessions.some(
          (session) =>
            session.activityState === "running"
            || session.runningState === "running"
            || session.runningState === "starting"
        );
        const recentActivityAtMs = resolveRecentActivityAtMs(sessions);
        const hasRecentActivity =
          recentActivityAtMs > 0
          && Date.now() - recentActivityAtMs <= WORKBENCH_DISCOVERY_RECENT_ACTIVITY_WINDOW_MS;
        const isDirty = isDiscoveryStatusDirty(discoveryStatus);
        const priorityBand = resolveDiscoveryPriorityBand({
          isVisibleRoot,
          isChildWorkspace,
          hasRunningSession,
          hasRecentActivity,
          isDirty,
          favorite: workspace.favorite
        });

        return {
          workspace,
          maxAgeMs: resolveDiscoveryMaxAgeMs(priorityBand),
          priorityBand,
          hasRunningSession,
          hasRecentActivity,
          isVisibleRoot,
          sortOrder: index,
          recentActivityAtMs
        } satisfies WorkbenchDiscoveryCandidate;
      })
      .sort(compareDiscoveryCandidates);
  }

  private filterButlerControlSessions(sessions: SessionListItem[]): SessionListItem[] {
    const hiddenSessionIds = new Set(this.butlerControlSessionRepository.listSessionIds());

    if (hiddenSessionIds.size === 0) {
      return sessions;
    }

    return sessions.filter((session) => !hiddenSessionIds.has(session.sessionId));
  }

  private buildChildWorktrees(
    rootWorkspaceId: string,
    workspaceById: ReadonlyMap<string, Workspace>,
    navigationStateByWorkspaceId: ReadonlyMap<string, { backgroundColor: string | null }>,
    hiddenWorkspaceIdSet: ReadonlySet<string>,
    userId: string
  ): WorkbenchWorktreeNode[] {
    if (!this.workspaceWorktreeRepository) {
      return [];
    }

    const records = this.workspaceWorktreeRepository
      .listByRootWorkspaceId(rootWorkspaceId)
      .filter((record) => record.lifecycleStatus !== "removed");
    const nodeByWorkspaceId = new Map<string, WorkbenchWorktreeNode>();
    const roots: WorkbenchWorktreeNode[] = [];

    for (const record of records) {
      if (hiddenWorkspaceIdSet.has(record.workspaceId)) {
        continue;
      }

      const workspace = workspaceById.get(record.workspaceId);

      if (!workspace) {
        continue;
      }

      nodeByWorkspaceId.set(record.workspaceId, {
        workspace: applyWorkspaceNavigationState(
          workspace,
          navigationStateByWorkspaceId.get(record.workspaceId) ?? null
        ),
        meta: record,
        sessions: projectWorkbenchSessions(this.filterButlerControlSessions(
          this.sessionHistoryService.listWorkspaceSessions(workspace.id, userId)
        )),
        children: []
      });
    }

    for (const record of records) {
      const currentNode = nodeByWorkspaceId.get(record.workspaceId);

      if (!currentNode) {
        continue;
      }

      if (record.parentWorkspaceId === rootWorkspaceId) {
        roots.push(currentNode);
        continue;
      }

      const parentNode = nodeByWorkspaceId.get(record.parentWorkspaceId);

      if (parentNode) {
        parentNode.children.push(currentNode);
        continue;
      }

      roots.push(currentNode);
    }

    return roots;
  }
}

function applyWorkspaceNavigationState(
  workspace: Workspace,
  navigationState: {
    backgroundColor: string | null;
    hidden?: boolean;
    shortcutAppsCollapsed?: boolean;
    shortcutAppsSide?: "left" | "right";
  } | null | undefined
): Workspace {
  if (!navigationState) {
    return workspace;
  }

  return {
    ...workspace,
    backgroundColor: navigationState.backgroundColor,
    hidden: navigationState.hidden ?? false,
    shortcutAppsCollapsed: navigationState.shortcutAppsCollapsed ?? false,
    shortcutAppsSide: navigationState.shortcutAppsSide ?? "left"
  };
}

function isPathInsideButlerWorkspace(candidatePath: string, butlerWorkspacePath: string): boolean {
  const relative = path.relative(path.resolve(butlerWorkspacePath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function countWorkbenchSessions(item: WorkbenchSnapshotItem): number {
  return item.sessions.length + (item.childWorktrees ?? [])
    .reduce((total, node) => total + countWorktreeNodeSessions(node), 0);
}

function resolveRecentActivityAtMs(sessions: SessionListItem[]): number {
  let recentActivityAtMs = 0;

  for (const session of sessions) {
    const candidateMs = Math.max(
      parseIsoTimeMs(session.lastEventAt),
      parseIsoTimeMs(session.lastMessageAt),
      parseIsoTimeMs(session.updatedAt)
    );

    if (candidateMs > recentActivityAtMs) {
      recentActivityAtMs = candidateMs;
    }
  }

  return recentActivityAtMs;
}

function parseIsoTimeMs(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : 0;
}

function isDiscoveryStatusDirty(status: WorkspaceDiscoveryStatusSummary | null): boolean {
  if (!status) {
    return false;
  }

  return status.dirtyReasonCount > 0 || status.phase === "failed" || status.phase === "stale";
}

function resolveDiscoveryPriorityBand(input: {
  isVisibleRoot: boolean;
  isChildWorkspace: boolean;
  hasRunningSession: boolean;
  hasRecentActivity: boolean;
  isDirty: boolean;
  favorite: boolean;
}): 0 | 1 | 2 | 3 {
  if (input.hasRunningSession) {
    return 0;
  }

  if (input.hasRecentActivity) {
    return 1;
  }

  if (input.isDirty || input.isVisibleRoot || input.favorite || input.isChildWorkspace) {
    return 2;
  }

  return 3;
}

function resolveDiscoveryMaxAgeMs(priorityBand: 0 | 1 | 2 | 3): number {
  switch (priorityBand) {
    case 0:
      return WORKBENCH_DISCOVERY_VISIBLE_MAX_AGE_MS;
    case 1:
      return WORKBENCH_DISCOVERY_HOT_MAX_AGE_MS;
    case 2:
      return WORKBENCH_DISCOVERY_WARM_MAX_AGE_MS;
    case 3:
    default:
      return WORKBENCH_DISCOVERY_COLD_MAX_AGE_MS;
  }
}

function compareDiscoveryCandidates(
  left: WorkbenchDiscoveryCandidate,
  right: WorkbenchDiscoveryCandidate
): number {
  if (left.priorityBand !== right.priorityBand) {
    return left.priorityBand - right.priorityBand;
  }

  if (left.hasRunningSession !== right.hasRunningSession) {
    return left.hasRunningSession ? -1 : 1;
  }

  if (left.hasRecentActivity !== right.hasRecentActivity) {
    return left.hasRecentActivity ? -1 : 1;
  }

  if (left.recentActivityAtMs !== right.recentActivityAtMs) {
    return right.recentActivityAtMs - left.recentActivityAtMs;
  }

  if (left.isVisibleRoot !== right.isVisibleRoot) {
    return left.isVisibleRoot ? -1 : 1;
  }

  return left.sortOrder - right.sortOrder;
}

function countWorktreeNodeSessions(node: WorkbenchWorktreeNode): number {
  return node.sessions.length + node.children.reduce((total, child) => total + countWorktreeNodeSessions(child), 0);
}

function createEmptyAffairsAssistantSessionsSnapshot(
  workspaceId: string,
  userId: string
): AffairsAssistantSessionSnapshot {
  return {
    workspaceId,
    userId,
    projectId: null,
    projectWorkspaceId: null,
    agentWorkspacePath: null,
    sessions: [],
    updatedAt: new Date(0).toISOString()
  };
}

interface WorkbenchSessionSummary {
  sessionId: string;
  workspaceId: string;
  provider: SessionListItem["provider"];
  parentSessionId?: string | null;
  sessionKind?: SessionListItem["sessionKind"];
  forkMethod?: SessionListItem["forkMethod"];
  forkSourceType?: SessionListItem["forkSourceType"];
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
  syncStatus: SessionListItem["syncStatus"];
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
  runningState: SessionListItem["runningState"];
  activitySource: SessionListItem["activitySource"];
  activityResolutionSource?: SessionListItem["activityResolutionSource"];
  lastEventAt: string | null;
  completedAt: string | null;
  lastSeenAt: string | null;
  activityState: SessionListItem["activityState"];
  parallelGroup?: SessionListItem["parallelGroup"];
  displayParentSessionId?: string | null;
  sessionIsolatedWorkspace?: SessionListItem["sessionIsolatedWorkspace"];
}

function projectWorkbenchSessions(sessions: SessionListItem[]): WorkbenchSessionSummary[] {
  return sessions.map(projectWorkbenchSession);
}

function projectWorkbenchSession(session: SessionListItem): WorkbenchSessionSummary {
  return {
    sessionId: session.sessionId,
    workspaceId: session.workspaceId,
    provider: session.provider,
    parentSessionId: session.parentSessionId ?? null,
    sessionKind: session.sessionKind,
    forkMethod: session.forkMethod ?? null,
    forkSourceType: session.forkSourceType ?? null,
    inheritedPrefixMessageCount: session.inheritedPrefixMessageCount ?? null,
    isSubagent: session.isSubagent ?? false,
    subagentLabel: session.subagentLabel ?? null,
    isArchived: session.isArchived,
    isFavorite: session.isFavorite,
    title: session.title,
    messageCount: session.messageCount,
    lastMessageAt: session.lastMessageAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    syncStatus: session.syncStatus,
    lastErrorCode: session.lastErrorCode,
    lastErrorDetail: session.lastErrorDetail,
    runningState: session.runningState,
    activitySource: session.activitySource,
    activityResolutionSource: session.activityResolutionSource,
    lastEventAt: session.lastEventAt,
    completedAt: session.completedAt,
    lastSeenAt: session.lastSeenAt,
    activityState: session.activityState,
    parallelGroup: session.parallelGroup ?? null,
    displayParentSessionId: session.displayParentSessionId ?? null,
    sessionIsolatedWorkspace: session.sessionIsolatedWorkspace ?? null
  };
}
