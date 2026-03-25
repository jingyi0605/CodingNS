import type { FileNode, TerminalInstance, TerminalTemplateRuntimeStatus } from "../../types/domain.js";
import type { FileTreeService } from "../file/file-tree-service.js";
import type { GitReadService } from "../git/git-read-service.js";
import type {
  GitBranchSnapshot,
  GitHistoryItem,
  GitRepoSnapshot,
  GitChangeItem
} from "../git/types.js";
import type { CommandTemplateService } from "../terminal/command-template-service.js";
import type { TerminalService } from "../terminal/terminal-service.js";

const FILE_TREE_CACHE_MAX_AGE_MS = 5_000;
const GIT_SNAPSHOT_CACHE_MAX_AGE_MS = 5_000;
const TERMINAL_MANAGER_CACHE_MAX_AGE_MS = 4_000;
const GIT_HISTORY_LIMIT = 20;

export interface FileTreeSnapshot {
  workspaceId: string;
  path: string;
  items: FileNode[];
}

export interface GitPanelSnapshot {
  workspaceId: string;
  status: {
    snapshot: GitRepoSnapshot;
    changes: GitChangeItem[];
  };
  history: GitHistoryItem[];
  historyTotalCount: number;
  historyNextCursor: string | null;
  branches: GitBranchSnapshot;
}

export interface TerminalManagerSnapshot {
  workspaceId: string;
  terminals: TerminalInstance[];
  templates: ReturnType<CommandTemplateService["listTemplates"]>;
  templateStatuses: TerminalTemplateRuntimeStatus[];
}

interface SnapshotCacheEntry<TSnapshot> {
  snapshot: TSnapshot;
  cachedAt: number;
}

export class WorkspacePanelSnapshotService {
  private readonly fileTreeCache = new Map<string, SnapshotCacheEntry<FileTreeSnapshot>>();
  private readonly gitSnapshotCache = new Map<string, SnapshotCacheEntry<GitPanelSnapshot>>();
  private readonly terminalManagerCache = new Map<
    string,
    SnapshotCacheEntry<TerminalManagerSnapshot>
  >();
  private readonly fileTreeInflight = new Map<string, Promise<FileTreeSnapshot>>();
  private readonly gitInflight = new Map<string, Promise<GitPanelSnapshot>>();
  private readonly terminalManagerInflight = new Map<string, Promise<TerminalManagerSnapshot>>();

  constructor(
    private readonly fileTreeService: FileTreeService,
    private readonly gitReadService: GitReadService,
    private readonly terminalService: TerminalService,
    private readonly commandTemplateService: CommandTemplateService
  ) {}

  async getFileTreeSnapshot(
    workspaceId: string,
    path: string,
    options?: { force?: boolean; limit?: number }
  ): Promise<FileTreeSnapshot> {
    const normalizedPath = normalizePanelPath(path);
    const cacheKey = `${workspaceId}::${normalizedPath}`;
    const cached = this.fileTreeCache.get(cacheKey);

    if (!options?.force && cached && !isExpired(cached.cachedAt, FILE_TREE_CACHE_MAX_AGE_MS)) {
      return cached.snapshot;
    }

    const inflight = this.fileTreeInflight.get(cacheKey);

    if (inflight) {
      return inflight;
    }

    const task = Promise.resolve().then(() => {
      const snapshot: FileTreeSnapshot = {
        workspaceId,
        path: normalizedPath,
        items: this.fileTreeService.list(workspaceId, normalizedPath || undefined, options?.limit)
      };

      this.fileTreeCache.set(cacheKey, {
        snapshot,
        cachedAt: Date.now()
      });

      return snapshot;
    }).finally(() => {
      this.fileTreeInflight.delete(cacheKey);
    });

    this.fileTreeInflight.set(cacheKey, task);
    return task;
  }

  async getGitPanelSnapshot(
    workspaceId: string,
    options?: { force?: boolean }
  ): Promise<GitPanelSnapshot> {
    const cached = this.gitSnapshotCache.get(workspaceId);

    if (!options?.force && cached && !isExpired(cached.cachedAt, GIT_SNAPSHOT_CACHE_MAX_AGE_MS)) {
      return cached.snapshot;
    }

    const inflight = this.gitInflight.get(workspaceId);

    if (inflight) {
      return inflight;
    }

    const task = Promise.all([
      this.gitReadService.getStatus(workspaceId),
      this.gitReadService.getHistory(workspaceId, null, GIT_HISTORY_LIMIT),
      this.gitReadService.getBranches(workspaceId)
    ]).then(([status, historyPage, branches]) => {
      const snapshot: GitPanelSnapshot = {
        workspaceId,
        status,
        history: historyPage.items,
        historyTotalCount: historyPage.totalCount,
        historyNextCursor: historyPage.nextCursor,
        branches
      };

      this.gitSnapshotCache.set(workspaceId, {
        snapshot,
        cachedAt: Date.now()
      });

      return snapshot;
    }).finally(() => {
      this.gitInflight.delete(workspaceId);
    });

    this.gitInflight.set(workspaceId, task);
    return task;
  }

  async getTerminalManagerSnapshot(
    workspaceId: string,
    options?: { force?: boolean }
  ): Promise<TerminalManagerSnapshot> {
    const cached = this.terminalManagerCache.get(workspaceId);

    if (
      !options?.force &&
      cached &&
      !isExpired(cached.cachedAt, TERMINAL_MANAGER_CACHE_MAX_AGE_MS)
    ) {
      return cached.snapshot;
    }

    const inflight = this.terminalManagerInflight.get(workspaceId);

    if (inflight) {
      return inflight;
    }

    const task = Promise.all([
      Promise.resolve(this.terminalService.listTerminals(workspaceId)),
      Promise.resolve(this.commandTemplateService.listTemplates(workspaceId)),
      this.commandTemplateService.listTemplateRuntimeStatuses(workspaceId)
    ]).then(([terminals, templates, templateStatuses]) => {
      const snapshot: TerminalManagerSnapshot = {
        workspaceId,
        terminals,
        templates,
        templateStatuses
      };

      this.terminalManagerCache.set(workspaceId, {
        snapshot,
        cachedAt: Date.now()
      });

      return snapshot;
    }).finally(() => {
      this.terminalManagerInflight.delete(workspaceId);
    });

    this.terminalManagerInflight.set(workspaceId, task);
    return task;
  }

  invalidateFileTree(workspaceId: string, path?: string): void {
    const normalizedPath = path === undefined ? null : normalizePanelPath(path);

    for (const key of [...this.fileTreeCache.keys()]) {
      if (!key.startsWith(`${workspaceId}::`)) {
        continue;
      }

      if (normalizedPath !== null && key !== `${workspaceId}::${normalizedPath}`) {
        continue;
      }

      this.fileTreeCache.delete(key);
    }
  }

  invalidateGit(workspaceId: string): void {
    this.gitSnapshotCache.delete(workspaceId);
  }

  invalidateTerminalManager(workspaceId: string): void {
    this.terminalManagerCache.delete(workspaceId);
  }
}

function isExpired(cachedAt: number, maxAgeMs: number): boolean {
  return Date.now() - cachedAt > maxAgeMs;
}

function normalizePanelPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}
