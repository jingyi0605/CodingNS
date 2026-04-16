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
import {
  isTerminalDebugEnabled,
  logTerminalDebug,
  terminalDebugNowMs
} from "../../shared/utils/terminal-debug-log.js";
import { createTaskManager, type TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES, type TaskHandle } from "../tasks/task-types.js";

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

interface AbortableInflightTask<TResult> {
  promise: Promise<TResult>;
  controller: AbortController;
  consumerCount: number;
  settled: boolean;
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
  private readonly gitInflight = new Map<string, AbortableInflightTask<GitPanelSnapshot>>();
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
    private readonly workspaceService: WorkspaceService,
    private readonly taskManager: TaskManager = createTaskManager()
  ) {
    this.registerBackgroundTasks();
  }

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
    options?: { force?: boolean; signal?: AbortSignal }
  ): Promise<GitPanelSnapshot> {
    const cached = this.gitSnapshotCache.get(workspaceId);

    if (!options?.force && cached && !isExpired(cached.cachedAt, GIT_SNAPSHOT_CACHE_MAX_AGE_MS)) {
      return cached.snapshot;
    }

    const inflight = this.gitInflight.get(workspaceId);

    if (inflight) {
      // 已经取消但还没从 inflight 表里清掉的任务不能复用，
      // 否则新的订阅会接到旧任务的 abort 结果，误报成内部错误。
      if (inflight.controller.signal.aborted) {
        this.gitInflight.delete(workspaceId);
      } else {
        return await awaitAbortableInflightTask(inflight, options?.signal);
      }
    }

    const controller = new AbortController();
    const task: AbortableInflightTask<GitPanelSnapshot> = {
      controller,
      consumerCount: 0,
      settled: false,
      promise: (async () => {
        // 先执行轻量级 status 检测（仅 2 条 git 命令）
        const status = await this.gitReadService.getStatus(workspaceId, controller.signal);

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
          this.gitReadService.getHistory(workspaceId, null, GIT_HISTORY_LIMIT, controller.signal),
          this.gitReadService.getBranches(workspaceId, controller.signal)
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
        task.settled = true;
        this.gitInflight.delete(workspaceId);
      })
    };

    this.gitInflight.set(workspaceId, task);
    return await awaitAbortableInflightTask(task, options?.signal);
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

    const task = this.taskManager.enqueue<{
      workspaceId: string;
    }, TerminalManagerSnapshot>(HOST_TASK_TYPES.terminalManagerSnapshot, {
      key: workspaceId,
      source: "workspace_panel.get_terminal_manager_snapshot",
      input: {
        workspaceId
      }
    }).promise.finally(() => {
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

  private registerBackgroundTasks(): void {
    if (!this.taskManager.has(HOST_TASK_TYPES.templateRuntimeStatusDiscovery)) {
      this.taskManager.register<{
        items: Array<{ templateId: string; port: number }>;
      }, TerminalTemplateRuntimeStatus[]>({
        taskType: HOST_TASK_TYPES.templateRuntimeStatusDiscovery,
        executionLane: "helper_process",
        helperProcessHandler: "terminal.template_runtime_status_discovery",
        run: async ({ items }, context) =>
          this.commandTemplateService.listTemplateRuntimeStatusesByItems(items, context.signal)
      });
    }

    if (!this.taskManager.has(HOST_TASK_TYPES.terminalManagerSnapshot)) {
      this.taskManager.register<{
        workspaceId: string;
      }, TerminalManagerSnapshot>({
        taskType: HOST_TASK_TYPES.terminalManagerSnapshot,
        executionLane: "host_background",
        run: async ({ workspaceId }, context) =>
          this.loadTerminalManagerSnapshot(workspaceId, context.signal)
      });
    }
  }

  private async loadTerminalManagerSnapshot(
    workspaceId: string,
    signal?: AbortSignal
  ): Promise<TerminalManagerSnapshot> {
    const startedAtMs = terminalDebugNowMs();
    const terminalListStartedAtMs = terminalDebugNowMs();
    const terminals = this.terminalService.listTerminalSnapshotItems(workspaceId);
    const terminalListMs = terminalDebugNowMs() - terminalListStartedAtMs;
    const templateListStartedAtMs = terminalDebugNowMs();
    const templates = this.commandTemplateService.listTemplates(workspaceId);
    const templateListMs = terminalDebugNowMs() - templateListStartedAtMs;
    const runtimeStatusItems = templates
      .filter((template) => template.port !== null)
      .map((template) => ({
        templateId: template.id,
        port: template.port as number
      }));
    const templateStatusStartedAtMs = terminalDebugNowMs();
    const templateStatusesHandle = runtimeStatusItems.length === 0
      ? null
      : this.taskManager.enqueue<{
          items: Array<{ templateId: string; port: number }>;
        }, TerminalTemplateRuntimeStatus[]>(HOST_TASK_TYPES.templateRuntimeStatusDiscovery, {
          key: workspaceId,
          source: "workspace_panel.load_terminal_manager_snapshot.runtime_status",
          input: {
            items: runtimeStatusItems
          }
        });
    const templateStatuses = templateStatusesHandle === null
      ? []
      : await awaitTaskHandleWithSignal(templateStatusesHandle, signal);
    const templateStatusMs = terminalDebugNowMs() - templateStatusStartedAtMs;
    const shellOptionsStartedAtMs = terminalDebugNowMs();
    const shellOptions = listTerminalShellOptions();
    const shellOptionsMs = terminalDebugNowMs() - shellOptionsStartedAtMs;
    const assembleStartedAtMs = terminalDebugNowMs();
    const snapshot: TerminalManagerSnapshot = {
      workspaceId,
      terminals,
      templates,
      templateStatuses,
      shellOptions
    };
    const assembleMs = terminalDebugNowMs() - assembleStartedAtMs;

    this.terminalManagerCache.set(workspaceId, {
      snapshot,
      cachedAt: Date.now()
    });

    if (isTerminalDebugEnabled()) {
      logTerminalDebug("workbench.terminal_manager_snapshot.completed", {
        workspaceId,
        terminalCount: terminals.length,
        templateCount: templates.length,
        templateStatusCount: templateStatuses.length,
        terminalListMs,
        templateListMs,
        templateStatusMs,
        shellOptionsMs,
        assembleMs,
        durationMs: terminalDebugNowMs() - startedAtMs
      });
    }

    return snapshot;
  }
}

function isExpired(cachedAt: number, maxAgeMs: number): boolean {
  return Date.now() - cachedAt > maxAgeMs;
}

function normalizePanelPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

async function awaitTaskHandleWithSignal<TResult>(
  handle: TaskHandle<TResult>,
  signal?: AbortSignal
): Promise<TResult> {
  if (!signal) {
    return await handle.promise;
  }

  if (signal.aborted) {
    handle.cancel(getAbortMessage(signal.reason));
    throw signal.reason ?? new Error("任务已取消");
  }

  return await new Promise<TResult>((resolve, reject) => {
    const onAbort = () => {
      handle.cancel(getAbortMessage(signal.reason));
      reject(signal.reason ?? new Error("任务已取消"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    handle.promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

async function awaitAbortableInflightTask<TResult>(
  task: AbortableInflightTask<TResult>,
  signal?: AbortSignal
): Promise<TResult> {
  task.consumerCount += 1;
  let released = false;

  const release = () => {
    if (released) {
      return;
    }

    released = true;
    task.consumerCount = Math.max(0, task.consumerCount - 1);

    if (task.consumerCount === 0 && !task.settled && !task.controller.signal.aborted) {
      task.controller.abort(new Error("git panel snapshot aborted"));
    }
  };

  if (!signal) {
    return await task.promise.finally(release);
  }

  if (signal.aborted) {
    release();
    throw signal.reason ?? new Error("任务已取消");
  }

  return await new Promise<TResult>((resolve, reject) => {
    const onAbort = () => {
      release();
      reject(signal.reason ?? new Error("任务已取消"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    task.promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        release();
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        release();
        reject(error);
      }
    );
  });
}

function getAbortMessage(reason: unknown): string {
  if (reason instanceof Error && reason.message.trim().length > 0) {
    return reason.message;
  }

  if (typeof reason === "string" && reason.trim().length > 0) {
    return reason;
  }

  return "任务已取消";
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
