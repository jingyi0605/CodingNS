import type { SessionListItem, Workspace } from "../../types/domain.js";
import { logPerformance } from "../../shared/utils/perf-log.js";
import type { SessionHistoryService } from "../sessions/session-history-service.js";
import type { WorkspaceRepository } from "../../storage/repositories/workspace-repository.js";

const WORKBENCH_REFRESH_MAX_AGE_MS = 15_000;

export interface WorkbenchSnapshotItem {
  workspace: Workspace;
  sessions: SessionListItem[];
}

export interface WorkbenchSnapshot {
  items: WorkbenchSnapshotItem[];
}

export class WorkbenchService {
  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly sessionHistoryService: SessionHistoryService
  ) {}

  getSnapshot(userId: string): WorkbenchSnapshot {
    const workspaces = this.workspaceRepository.list();

    return {
      items: workspaces.map((workspace) => ({
        workspace,
        sessions: this.sessionHistoryService.listWorkspaceSessions(workspace.id, userId)
      }))
    };
  }

  shouldRefreshSnapshot(): boolean {
    return this.workspaceRepository
      .list()
      .some((workspace) =>
        this.sessionHistoryService.needsWorkspaceDiscovery(
          workspace.id,
          WORKBENCH_REFRESH_MAX_AGE_MS
        )
      );
  }

  async refreshSnapshot(userId: string): Promise<WorkbenchSnapshot> {
    const startedAt = Date.now();
    const workspaces = this.workspaceRepository.list();

    await Promise.all(
      workspaces.map((workspace) =>
        this.sessionHistoryService.discoverWorkspaceSessions(workspace.id, userId, {
          maxAgeMs: WORKBENCH_REFRESH_MAX_AGE_MS,
          refreshStateMode: "deferred"
        })
      )
    );

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
    const workspaces = this.workspaceRepository.list();

    await Promise.all(
      workspaces.map((workspace) =>
        this.sessionHistoryService.syncWorkspaceSessionTitles(workspace.id, userId)
      )
    );

    return this.getSnapshot(userId);
  }
}
