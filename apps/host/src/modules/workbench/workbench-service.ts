import path from "node:path";

import type { SessionListItem, Workspace } from "../../types/domain.js";
import { logPerformance } from "../../shared/utils/perf-log.js";
import type { SessionHistoryService } from "../sessions/session-history-service.js";
import type { WorkspaceNavigationStateRepository } from "../../storage/repositories/workspace-navigation-state-repository.js";
import type { WorkspaceRepository } from "../../storage/repositories/workspace-repository.js";
import type { ButlerProfileService } from "../butler/butler-profile-service.js";
import type { ButlerControlSessionRepository } from "../../storage/repositories/butler-control-session-repository.js";

const WORKBENCH_REFRESH_MAX_AGE_MS = 15_000;

export interface WorkbenchSnapshotItem {
  workspace: Workspace;
  sessions: SessionListItem[];
  collapsed: boolean;
}

export interface WorkbenchSnapshot {
  items: WorkbenchSnapshotItem[];
}

export class WorkbenchService {
  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly workspaceNavigationStateRepository: WorkspaceNavigationStateRepository,
    private readonly sessionHistoryService: SessionHistoryService,
    private readonly butlerProfileService: Pick<ButlerProfileService, "getProfile">,
    private readonly butlerControlSessionRepository: Pick<ButlerControlSessionRepository, "listSessionIds">
  ) {}

  getSnapshot(userId: string): WorkbenchSnapshot {
    const workspaces = this.listVisibleWorkspaces();
    this.scheduleWorkspaceRefreshes(workspaces, userId);
    const collapsedWorkspaceIdSet = new Set(
      this.workspaceNavigationStateRepository
        .listByUserId(userId)
        .filter((item) => item.collapsed)
        .map((item) => item.workspaceId)
    );

    return {
      items: workspaces.map((workspace) => ({
        workspace,
        sessions: this.filterButlerControlSessions(
          this.sessionHistoryService.listWorkspaceSessions(workspace.id, userId)
        ),
        collapsed: collapsedWorkspaceIdSet.has(workspace.id)
      }))
    };
  }

  shouldRefreshSnapshot(): boolean {
    return this.listVisibleWorkspaces()
      .some((workspace) =>
        this.sessionHistoryService.needsWorkspaceDiscovery(
          workspace.id,
          WORKBENCH_REFRESH_MAX_AGE_MS
        )
      );
  }

  async refreshSnapshot(userId: string): Promise<WorkbenchSnapshot> {
    const startedAt = Date.now();
    const workspaces = this.listVisibleWorkspaces();

    this.scheduleWorkspaceRefreshes(workspaces, userId, {
      force: true
    });

    const snapshot = this.getSnapshot(userId);

    logPerformance(
      "workbench.refresh_snapshot",
      Date.now() - startedAt,
      {
        workspaceCount: workspaces.length,
        sessionCount: snapshot.items.reduce((total, item) => total + item.sessions.length, 0)
      },
      {
        thresholdMs: 300
      }
    );

    return snapshot;
  }

  async syncSessionTitles(userId: string): Promise<WorkbenchSnapshot> {
    const workspaces = this.listVisibleWorkspaces();

    await Promise.all(
      workspaces.map((workspace) =>
        this.sessionHistoryService.syncWorkspaceSessionTitles(workspace.id, userId)
      )
    );

    return this.getSnapshot(userId);
  }

  private listVisibleWorkspaces(): Workspace[] {
    const butlerWorkspacePath = this.butlerProfileService.getProfile()?.workspacePath ?? null;

    if (!butlerWorkspacePath) {
      return this.workspaceRepository.list();
    }

    return this.workspaceRepository
      .list()
      .filter((workspace) => !isPathInsideButlerWorkspace(workspace.path, butlerWorkspacePath));
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
}

function isPathInsideButlerWorkspace(candidatePath: string, butlerWorkspacePath: string): boolean {
  const relative = path.relative(path.resolve(butlerWorkspacePath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
