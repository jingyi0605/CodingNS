import path from "node:path";

import type { SessionListItem, Workspace, WorkspaceWorktreeRecord } from "../../types/domain.js";
import { logPerformance } from "../../shared/utils/perf-log.js";
import type { SessionHistoryService } from "../sessions/session-history-service.js";
import type { WorkspaceNavigationStateRepository } from "../../storage/repositories/workspace-navigation-state-repository.js";
import type { WorkspaceRepository } from "../../storage/repositories/workspace-repository.js";
import type { WorkspaceWorktreeRepository } from "../../storage/repositories/workspace-worktree-repository.js";
import type { ButlerProfileService } from "../butler/butler-profile-service.js";
import type { ButlerControlSessionRepository } from "../../storage/repositories/butler-control-session-repository.js";
import { createTaskManager, type TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES, type TaskHandle } from "../tasks/task-types.js";
import { withSnapshotRevision } from "./snapshot-revision.js";

const WORKBENCH_REFRESH_MAX_AGE_MS = 15_000;
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
    taskManager: TaskManager = createTaskManager()
  ) {
    this.taskManager = taskManager;
    this.registerBackgroundTasks();
  }

  getSnapshot(userId: string): WorkbenchSnapshot {
    const allWorkspaces = this.listWorkbenchWorkspaces();
    const workspaces = this.listVisibleWorkspaces(allWorkspaces);
    const workspaceById = new Map(allWorkspaces.map((workspace) => [workspace.id, workspace] as const));
    const navigationStates = this.workspaceNavigationStateRepository.listByUserId(userId);
    const navigationStateByWorkspaceId = new Map(
      navigationStates.map((item) => [item.workspaceId, item] as const)
    );

    const collapsedWorkspaceIdSet = new Set(
      navigationStates
        .filter((item) => item.collapsed)
        .map((item) => item.workspaceId)
    );

    return withSnapshotRevision({
      items: workspaces.map((workspace) => ({
        workspace: applyWorkspaceNavigationState(workspace, navigationStateByWorkspaceId.get(workspace.id)),
        sessions: projectWorkbenchSessions(this.filterButlerControlSessions(
          this.sessionHistoryService.listWorkspaceSessions(workspace.id, userId)
        )),
        childWorktrees: this.buildChildWorktrees(
          workspace.id,
          workspaceById,
          navigationStateByWorkspaceId,
          userId
        ),
        collapsed: collapsedWorkspaceIdSet.has(workspace.id)
      }))
    });
  }

  shouldRefreshSnapshot(): boolean {
    return this.listWorkbenchWorkspaces()
      .some((workspace) =>
        this.sessionHistoryService.needsWorkspaceDiscovery(
          workspace.id,
          WORKBENCH_REFRESH_MAX_AGE_MS
        )
      );
  }

  async refreshSnapshot(userId: string): Promise<WorkbenchSnapshot> {
    const startedAt = Date.now();
    this.scheduleSnapshotRefresh(userId, {
      force: true
    });

    const snapshot = this.getSnapshot(userId);

    logPerformance(
      "workbench.refresh_snapshot",
      Date.now() - startedAt,
      {
        workspaceCount: snapshot.items.length,
        sessionCount: snapshot.items.reduce(
          (total, item) => total + countWorkbenchSessions(item),
          0
        )
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
    this.scheduleWorkspaceRefreshes(this.listWorkbenchWorkspaces(), userId, options);
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
    const workspaces = this.listWorkbenchWorkspaces();

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

  private listWorkbenchWorkspaces(): Workspace[] {
    const butlerWorkspacePath = this.butlerProfileService.getProfile()?.workspacePath ?? null;

    if (!butlerWorkspacePath) {
      return this.workspaceRepository.list();
    }

    return this.workspaceRepository
      .list()
      .filter((workspace) => !isPathInsideButlerWorkspace(workspace.path, butlerWorkspacePath));
  }

  private listVisibleWorkspaces(workspaces: Workspace[]): Workspace[] {
    const childWorkspaceIdSet = new Set(this.workspaceWorktreeRepository?.listWorkspaceIds() ?? []);

    return workspaces.filter((workspace) => !childWorkspaceIdSet.has(workspace.id));
  }

  private scheduleWorkspaceRefreshes(
    workspaces: Workspace[],
    userId: string,
    options?: {
      force?: boolean;
    }
  ): void {
    if (typeof this.sessionHistoryService.requestWorkspaceDiscovery !== "function") {
      return;
    }

    for (const workspace of workspaces) {
      this.sessionHistoryService.requestWorkspaceDiscovery(workspace.id, userId, {
        maxAgeMs: WORKBENCH_REFRESH_MAX_AGE_MS,
        force: options?.force ?? false,
        refreshStateMode: "deferred"
      });
    }
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
  navigationState: { backgroundColor: string | null } | null | undefined
): Workspace {
  if (!navigationState) {
    return workspace;
  }

  return {
    ...workspace,
    backgroundColor: navigationState.backgroundColor
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

function countWorktreeNodeSessions(node: WorkbenchWorktreeNode): number {
  return node.sessions.length + node.children.reduce((total, child) => total + countWorktreeNodeSessions(child), 0);
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
    activityState: session.activityState
  };
}
