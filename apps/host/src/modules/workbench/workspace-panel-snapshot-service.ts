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
import { listTerminalShellOptions, type TerminalShellOption } from "../terminal/terminal-shell.js";
import type {
  WorkspaceManagementSummary,
  WorkspaceService
} from "../workspace/workspace-service.js";

const FILE_TREE_CACHE_MAX_AGE_MS = 5_000;
const GIT_SNAPSHOT_CACHE_MAX_AGE_MS = 15_000;
const TERMINAL_MANAGER_CACHE_MAX_AGE_MS = 4_000;
const WORKSPACE_MANAGEMENT_CACHE_MAX_AGE_MS = 30_000;
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
  shellOptions: TerminalShellOption[];
}

export type WorkspaceManagementSnapshot = WorkspaceManagementSummary;

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
  private readonly workspaceManagementCache = new Map<
    string,
    SnapshotCacheEntry<WorkspaceManagementSnapshot>
  >();
  private readonly fileTreeInflight = new Map<string, Promise<FileTreeSnapshot>>();
  private readonly gitInflight = new Map<string, Promise<GitPanelSnapshot>>();
  private readonly terminalManagerInflight = new Map<string, Promise<TerminalManagerSnapshot>>();
  private readonly workspaceManagementInflight = new Map<
    string,
    Promise<WorkspaceManagementSnapshot>
  >();

  constructor(
    private readonly fileTreeService: FileTreeService,
    private readonly gitReadService: GitReadService,
    private readonly terminalService: TerminalService,
    private readonly commandTemplateService: CommandTemplateService,
    private readonly workspaceService: WorkspaceService
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

    const task = (async () => {
      // 先执行轻量级 status 检测（仅 2 条 git 命令）
      const status = await this.gitReadService.getStatus(workspaceId);

      // 如果有缓存，比较 status 是否有变化
      if (cached && !isGitStatusChanged(cached.snapshot.status, status)) {
        // 状态未变，延长缓存 TTL，跳过昂贵的 history/branches 查询
        this.gitSnapshotCache.set(workspaceId, {
          snapshot: cached.snapshot,
          cachedAt: Date.now()
        });
        return cached.snapshot;
      }

      // 状态有变化，执行完整刷新（复用已获取的 status）
      const [historyPage, branches] = await Promise.all([
        this.gitReadService.getHistory(workspaceId, null, GIT_HISTORY_LIMIT),
        this.gitReadService.getBranches(workspaceId)
      ]);

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
    })().finally(() => {
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
      Promise.resolve(this.terminalService.listTerminalSnapshotItems(workspaceId)),
      Promise.resolve(this.commandTemplateService.listTemplates(workspaceId)),
      this.commandTemplateService.listTemplateRuntimeStatuses(workspaceId)
    ]).then(([terminals, templates, templateStatuses]) => {
      const snapshot: TerminalManagerSnapshot = {
        workspaceId,
        terminals,
        templates,
        templateStatuses,
        shellOptions: listTerminalShellOptions()
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

  async getWorkspaceManagementSnapshot(
    workspaceId: string,
    options?: { force?: boolean }
  ): Promise<WorkspaceManagementSnapshot> {
    const cached = this.workspaceManagementCache.get(workspaceId);

    if (
      !options?.force &&
      cached &&
      !isExpired(cached.cachedAt, WORKSPACE_MANAGEMENT_CACHE_MAX_AGE_MS)
    ) {
      return cached.snapshot;
    }

    const inflight = this.workspaceManagementInflight.get(workspaceId);

    if (inflight) {
      return inflight;
    }

    const task = this.workspaceService.getManagementSummary(workspaceId)
      .then((snapshot) => {
        this.workspaceManagementCache.set(workspaceId, {
          snapshot,
          cachedAt: Date.now()
        });

        return snapshot;
      })
      .finally(() => {
        this.workspaceManagementInflight.delete(workspaceId);
      });

    this.workspaceManagementInflight.set(workspaceId, task);
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

  invalidateWorkspaceManagement(workspaceId: string): void {
    this.workspaceManagementCache.delete(workspaceId);
  }
}

function isExpired(cachedAt: number, maxAgeMs: number): boolean {
  return Date.now() - cachedAt > maxAgeMs;
}

function normalizePanelPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

/**
 * 比较两次 git status 结果，判断工作区是否有文件变更。
 * 比较维度：分支元信息 + 变更文件列表（路径 + 暂存/工作区状态）。
 */
function isGitStatusChanged(
  cached: { snapshot: GitRepoSnapshot; changes: GitChangeItem[] },
  current: { snapshot: GitRepoSnapshot; changes: GitChangeItem[] }
): boolean {
  if (
    cached.snapshot.branch !== current.snapshot.branch ||
    cached.snapshot.ahead !== current.snapshot.ahead ||
    cached.snapshot.behind !== current.snapshot.behind ||
    cached.snapshot.isDirty !== current.snapshot.isDirty
  ) {
    return true;
  }

  const cachedChanges = cached.changes;
  const currentChanges = current.changes;

  if (cachedChanges.length !== currentChanges.length) {
    return true;
  }

  for (let i = 0; i < cachedChanges.length; i++) {
    // 仅比较 `status` 会漏掉 “M(未暂存) -> M(已暂存)” 这类关键变化，
    // 必须连同 staged/worktree 列一起比较，才能避免缓存误判为“无变化”。
    if (
      cachedChanges[i].path !== currentChanges[i].path ||
      cachedChanges[i].status !== currentChanges[i].status ||
      cachedChanges[i].staged !== currentChanges[i].staged ||
      cachedChanges[i].stagedStatus !== currentChanges[i].stagedStatus ||
      cachedChanges[i].worktreeStatus !== currentChanges[i].worktreeStatus
    ) {
      return true;
    }
  }

  return false;
}
