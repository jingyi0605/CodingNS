import type { SessionListItem, Workspace } from "../../types/domain.js";
import type { SessionHistoryService } from "../sessions/session-history-service.js";
import type { WorkspaceRepository } from "../../storage/repositories/workspace-repository.js";
import type { SessionIndexRepository } from "../../storage/repositories/session-index-repository.js";

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
    private readonly sessionIndexRepository: SessionIndexRepository,
    private readonly sessionHistoryService: SessionHistoryService
  ) {}

  getSnapshot(userId: string): WorkbenchSnapshot {
    const workspaces = this.workspaceRepository.list();

    return {
      items: workspaces.map((workspace) => ({
        workspace,
        sessions: this.sessionIndexRepository.listByWorkspace(workspace.id, userId)
      }))
    };
  }

  async refreshSnapshot(userId: string): Promise<WorkbenchSnapshot> {
    const workspaces = this.workspaceRepository.list();

    await Promise.all(
      workspaces.map((workspace) =>
        this.sessionHistoryService.discoverWorkspaceSessions(workspace.id, userId, {
          maxAgeMs: WORKBENCH_REFRESH_MAX_AGE_MS
        })
      )
    );

    return this.getSnapshot(userId);
  }
}
