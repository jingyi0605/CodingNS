import fs from "node:fs";
import path from "node:path";

import type { WorkspaceService } from "../workspace/workspace-service.js";

const AGENTS_FILE_NAME = "AGENTS.md";
const WATCH_DEBOUNCE_MS = 300;

interface WorkspaceSessionInstructionWatchLogger {
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
}

interface WatchEntry {
  workspacePath: string;
  watcher: fs.FSWatcher;
  timer: NodeJS.Timeout | null;
}

export class WorkspaceSessionInstructionWatchService {
  private readonly watchersByWorkspace = new Map<string, WatchEntry>();

  constructor(
    private readonly workspaceService: Pick<WorkspaceService, "list" | "getWorkspaceOrThrow">,
    private readonly onWorkspaceAgentsChanged: (input: {
      workspaceId: string;
      workspacePath: string;
      reason: string;
    }) => void,
    private readonly logger: WorkspaceSessionInstructionWatchLogger
  ) {}

  syncAll(): void {
    const workspaces = this.workspaceService.list();
    const activeWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));

    for (const workspace of workspaces) {
      this.ensureWorkspaceWatch(workspace.id, workspace.path);
    }

    for (const workspaceId of [...this.watchersByWorkspace.keys()]) {
      if (!activeWorkspaceIds.has(workspaceId)) {
        this.stopWorkspaceWatch(workspaceId);
      }
    }
  }

  syncWorkspace(workspaceId: string): void {
    try {
      const workspace = this.workspaceService.getWorkspaceOrThrow(workspaceId);
      this.ensureWorkspaceWatch(workspace.id, workspace.path);
    } catch {
      this.stopWorkspaceWatch(workspaceId);
    }
  }

  dispose(): void {
    for (const workspaceId of [...this.watchersByWorkspace.keys()]) {
      this.stopWorkspaceWatch(workspaceId);
    }
  }

  private ensureWorkspaceWatch(workspaceId: string, workspacePath: string): void {
    const normalizedWorkspacePath = workspacePath.trim();
    if (!normalizedWorkspacePath || !fs.existsSync(normalizedWorkspacePath) || !fs.statSync(normalizedWorkspacePath).isDirectory()) {
      this.stopWorkspaceWatch(workspaceId);
      return;
    }

    const existing = this.watchersByWorkspace.get(workspaceId);
    if (existing?.workspacePath === normalizedWorkspacePath) {
      return;
    }

    if (existing) {
      this.stopWorkspaceWatch(workspaceId);
    }

    try {
      const watcher = fs.watch(normalizedWorkspacePath, { persistent: true }, (eventType, fileName) => {
        if (!shouldHandleAgentsWatchEvent(fileName)) {
          return;
        }
        this.scheduleBundleRefresh(workspaceId, normalizedWorkspacePath, `agents_watch:${eventType || "unknown"}`);
      });

      watcher.on("error", (error) => {
        this.logger.warn(
          {
            workspaceId,
            workspacePath: normalizedWorkspacePath,
            error: error instanceof Error ? error.message : String(error),
            source: "workspace_session.agents_watch"
          },
          "工作区 AGENTS.md 监听异常，已停止当前监听"
        );
        this.stopWorkspaceWatch(workspaceId);
      });

      this.watchersByWorkspace.set(workspaceId, {
        workspacePath: normalizedWorkspacePath,
        watcher,
        timer: null
      });
    } catch (error) {
      this.logger.warn(
        {
          workspaceId,
          workspacePath: normalizedWorkspacePath,
          error: error instanceof Error ? error.message : String(error),
          source: "workspace_session.agents_watch"
        },
        "工作区 AGENTS.md 监听启动失败"
      );
      this.stopWorkspaceWatch(workspaceId);
    }
  }

  private scheduleBundleRefresh(workspaceId: string, workspacePath: string, reason: string): void {
    const entry = this.watchersByWorkspace.get(workspaceId);
    if (!entry) {
      return;
    }

    if (entry.timer) {
      clearTimeout(entry.timer);
    }

    entry.timer = setTimeout(() => {
      entry.timer = null;
      this.onWorkspaceAgentsChanged({
        workspaceId,
        workspacePath,
        reason
      });
    }, WATCH_DEBOUNCE_MS);
  }

  private stopWorkspaceWatch(workspaceId: string): void {
    const entry = this.watchersByWorkspace.get(workspaceId);
    if (!entry) {
      return;
    }

    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    entry.watcher.close();
    this.watchersByWorkspace.delete(workspaceId);
  }
}

function shouldHandleAgentsWatchEvent(fileName: string | Buffer | null): boolean {
  if (!fileName) {
    return true;
  }

  const normalized = path.basename(String(fileName)).trim().toLowerCase();
  return normalized === AGENTS_FILE_NAME.toLowerCase();
}
