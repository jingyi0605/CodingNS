import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AppError, isAppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { WorkspaceNavigationStateRepository } from "../../storage/repositories/workspace-navigation-state-repository.js";
import type { WorkspaceRepository } from "../../storage/repositories/workspace-repository.js";
import type { WorkspaceWorktreeRepository } from "../../storage/repositories/workspace-worktree-repository.js";
import type { SessionIsolatedWorkspaceRepository } from "../../storage/repositories/session-isolated-workspace-repository.js";
import type { Workspace, WorkspaceNavigationStateRecord } from "../../types/domain.js";
import type { ButlerProfileService } from "../butler/butler-profile-service.js";
import { createGitAuthContext, type GitAuthInput } from "../git/git-auth.js";
import type { GitCommandRunner } from "../git/git-command-runner.js";
import { createTaskManager, type TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES, type TaskHandle } from "../tasks/task-types.js";
import { writeAffairsLibraryDebugLog } from "./affairs-library-debug-log.js";
import { readWorkspaceCodeCompositionWithSignal } from "./workspace-code-composition.js";

interface WorkspaceDirectoryOption {
  path: string;
  name: string;
}

export interface WorkspaceDirectoryBrowseResult {
  currentPath: string;
  parentPath: string | null;
  roots: WorkspaceDirectoryOption[];
  items: WorkspaceDirectoryOption[];
}

export interface WorkspaceCreatedDirectoryResult {
  path: string;
  name: string;
}

export interface CloneWorkspaceInput {
  repositoryUrl: string;
  parentPath: string;
  directoryName?: string;
  name?: string;
  auth?: GitAuthInput | null;
}

interface WorkspaceGitRemoteSummary {
  name: string;
  url: string;
}

export interface WorkspaceGitSummary {
  isRepository: boolean;
  repoRoot: string | null;
  currentBranch: string | null;
  commitCount: number | null;
  remotes: WorkspaceGitRemoteSummary[];
  error: string | null;
}

export interface WorkspaceCodeCompositionItem {
  type: string;
  count: number;
  ratio: number;
}

export interface WorkspaceCodeCompositionSummary {
  scannedFileCount: number;
  truncated: boolean;
  items: WorkspaceCodeCompositionItem[];
  error: string | null;
}

export interface WorkspaceManagementSummary {
  workspaceId: string;
  name: string;
  path: string;
  git: WorkspaceGitSummary;
  codeComposition: WorkspaceCodeCompositionSummary;
}

export interface UpdateWorkspaceNavigationStateInput {
  collapsed?: boolean;
  backgroundColor?: string | null;
}

const DIRECTORY_BROWSE_LIMIT = 200;
const GIT_CLONE_TIMEOUT_MS = 120_000;

export class WorkspaceService {
  private readonly taskManager: TaskManager;

  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly gitCommandRunner: GitCommandRunner,
    private readonly workspaceNavigationStateRepository: WorkspaceNavigationStateRepository,
    private readonly butlerProfileService?: Pick<ButlerProfileService, "getProfile">,
    private readonly workspaceWorktreeRepository?: Pick<WorkspaceWorktreeRepository, "listWorkspaceIds">,
    taskManager: TaskManager = createTaskManager(),
    private readonly sessionIsolatedWorkspaceRepository?: Pick<
      SessionIsolatedWorkspaceRepository,
      "listByLifecycleStatuses"
    >
  ) {
    this.taskManager = taskManager;
    this.registerBackgroundTasks();
  }

  browseDirectories(requestedPath?: string): WorkspaceDirectoryBrowseResult {
    const roots = listDirectoryRoots();
    const fallbackPath = resolveDefaultBrowsePath(roots);
    const currentPath = resolveBrowsePath(requestedPath, fallbackPath);

    ensureExistingDirectory(currentPath, "path");

    return {
      currentPath,
      parentPath: resolveParentPath(currentPath),
      roots,
      items: fs
        .readdirSync(currentPath, {
          withFileTypes: true
        })
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .slice(0, DIRECTORY_BROWSE_LIMIT)
        .map((entry) => ({
          path: path.join(currentPath, entry.name),
          name: entry.name
        }))
        .sort((left, right) => left.name.localeCompare(right.name))
    };
  }

  createDirectory(parentPath: string, directoryName: string): WorkspaceCreatedDirectoryResult {
    const normalizedParentPath = parentPath.trim();

    if (!normalizedParentPath) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "父目录不能为空",
        field: "parentPath"
      });
    }

    const resolvedParentPath = path.resolve(normalizedParentPath);
    ensureExistingDirectory(resolvedParentPath, "parentPath");

    const normalizedDirectoryName = normalizeSingleDirectoryName(directoryName, "directoryName");
    const targetPath = path.join(resolvedParentPath, normalizedDirectoryName);

    if (fs.existsSync(targetPath)) {
      throw new AppError({
        statusCode: 409,
        errorCode: "WORKSPACE_DIRECTORY_EXISTS",
        detail: "目标目录已经存在",
        field: "directoryName"
      });
    }

    fs.mkdirSync(targetPath);

    return {
      path: targetPath,
      name: normalizedDirectoryName
    };
  }

  importWorkspace(workspacePath: string, name?: string): Workspace {
    const resolvedPath = path.resolve(workspacePath);
    ensureExistingDirectory(resolvedPath, "path");
    return createWorkspaceRecord(this.workspaceRepository, resolvedPath, name);
  }

  async cloneWorkspace(input: CloneWorkspaceInput): Promise<Workspace> {
    const repositoryUrl = input.repositoryUrl.trim();

    if (!repositoryUrl) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "Git 仓库地址不能为空",
        field: "repositoryUrl"
      });
    }

    const parentPath = path.resolve(input.parentPath);
    ensureExistingDirectory(parentPath, "parentPath");

    const directoryName = normalizeCloneDirectoryName(input.directoryName, repositoryUrl);
    const targetPath = path.join(parentPath, directoryName);

    if (fs.existsSync(targetPath)) {
      throw new AppError({
        statusCode: 409,
        errorCode: "WORKSPACE_TARGET_EXISTS",
        detail: "目标路径已经存在，不能直接覆盖克隆",
        field: "directoryName"
      });
    }

    const authContext = createGitAuthContext(input.auth);

    try {
      await this.gitCommandRunner.run(parentPath, ["clone", repositoryUrl, directoryName], {
        timeoutMs: GIT_CLONE_TIMEOUT_MS,
        env: authContext?.env,
        operation: "workspace.cloneWorkspace"
      });

      return this.importWorkspace(targetPath, input.name?.trim());
    } catch (error) {
      if (fs.existsSync(targetPath)) {
        // clone 失败会留下半成品目录，直接清掉，避免下一次重试被脏状态卡死。
        fs.rmSync(targetPath, { recursive: true, force: true });
      }

      throw mapCloneError(error);
    } finally {
      authContext?.cleanup();
    }
  }

  list(): Workspace[] {
    return this.listVisibleWorkspaces();
  }

  reorderWorkspaces(workspaceIds: string[]): Workspace[] {
    const normalizedWorkspaceIds = normalizeWorkspaceIds(workspaceIds);
    const visibleWorkspaces = this.listVisibleWorkspaces();

    if (normalizedWorkspaceIds.length !== visibleWorkspaces.length) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "工作区重排必须提交当前全部可见工作区",
        field: "workspaceIds"
      });
    }

    const visibleWorkspaceIdSet = new Set(visibleWorkspaces.map((workspace) => workspace.id));
    if (visibleWorkspaceIdSet.size !== normalizedWorkspaceIds.length) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "工作区列表包含重复项或数量异常",
        field: "workspaceIds"
      });
    }

    for (const workspaceId of normalizedWorkspaceIds) {
      if (!visibleWorkspaceIdSet.has(workspaceId)) {
        throw new AppError({
          statusCode: 400,
          errorCode: "INVALID_INPUT",
          detail: "工作区重排列表包含未知项目",
          field: "workspaceIds"
        });
      }
    }

    this.workspaceRepository.reorderVisible(normalizedWorkspaceIds);
    return this.listVisibleWorkspaces();
  }

  removeWorkspace(workspaceId: string): Workspace {
    const workspace = this.getWorkspaceOrThrow(workspaceId);
    const timestamp = nowIso();

    return (
      this.workspaceRepository.markRemoved(workspace.id, timestamp, timestamp) ?? {
        ...workspace,
        updatedAt: timestamp,
        removedAt: timestamp
      }
    );
  }

  async getManagementSummary(workspaceId: string): Promise<WorkspaceManagementSummary> {
    return await this.taskManager.enqueue<{
      workspaceId: string;
    }, WorkspaceManagementSummary>(HOST_TASK_TYPES.workspaceManagementSummary, {
      key: workspaceId,
      source: "workspace.get_management_summary",
      input: {
        workspaceId
      }
    }).promise;
  }

  getWorkspaceOrThrow(workspaceId: string): Workspace {
    const workspace = this.workspaceRepository.findById(workspaceId);

    if (!workspace) {
      throw new AppError({
        statusCode: 404,
        errorCode: "WORKSPACE_NOT_FOUND",
        detail: "指定工作区不存在"
      });
    }

    return workspace;
  }

  findWorkspaceByPath(workspacePath: string): Workspace | null {
    return this.workspaceRepository.findByPath(path.resolve(workspacePath));
  }

  updateNavigationState(
    workspaceId: string,
    userId: string,
    input: UpdateWorkspaceNavigationStateInput
  ): WorkspaceNavigationStateRecord {
    this.getWorkspaceOrThrow(workspaceId);
    if (input.collapsed === undefined && input.backgroundColor === undefined) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "至少要更新一个导航状态字段"
      });
    }

    const normalizedBackgroundColor = normalizeWorkspaceNavigationBackgroundColor(input.backgroundColor);
    const existing =
      this.workspaceNavigationStateRepository.findByWorkspaceIdAndUserId(workspaceId, userId);
    const timestamp = nowIso();
    try {
      const nextRecord = this.workspaceNavigationStateRepository.upsert({
        workspaceId,
        userId,
        collapsed: input.collapsed ?? existing?.collapsed ?? false,
        backgroundColor:
          normalizedBackgroundColor !== undefined
            ? normalizedBackgroundColor
            : existing?.backgroundColor ?? null,
        affairsLibraryRootPath: existing?.affairsLibraryRootPath ?? null,
        affairsLibraryEnabled: existing?.affairsLibraryEnabled ?? false,
        affairsLibraryFavoritesJson: existing?.affairsLibraryFavoritesJson ?? null,
        updatedAt: timestamp
      });

      writeAffairsLibraryDebugLog({
        event: "workspace_navigation_state_update",
        processRole: "host",
        workspaceId,
        rootDir: nextRecord.affairsLibraryRootPath ?? null,
        source: "workspace.navigation_state",
        status: "succeeded",
        details: {
          userId,
          collapsed: input.collapsed ?? null,
          backgroundColor: normalizedBackgroundColor ?? null,
          oldBinding: toWorkspaceNavigationBindingLog(existing),
          newBinding: toWorkspaceNavigationBindingLog(nextRecord),
        },
      });

      return nextRecord;
    } catch (error) {
      writeAffairsLibraryDebugLog({
        event: "workspace_navigation_state_update",
        processRole: "host",
        workspaceId,
        rootDir: existing?.affairsLibraryRootPath ?? null,
        source: "workspace.navigation_state",
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
        details: {
          userId,
          collapsed: input.collapsed ?? null,
          backgroundColor: normalizedBackgroundColor ?? null,
          oldBinding: toWorkspaceNavigationBindingLog(existing),
          newBinding: null,
        },
      });
      throw error;
    }
  }

  private listVisibleWorkspaces(): Workspace[] {
    const childWorkspaceIdSet = new Set(this.workspaceWorktreeRepository?.listWorkspaceIds() ?? []);
    const hiddenTemporaryWorkspaceIdSet = new Set(
      this.sessionIsolatedWorkspaceRepository
        ?.listByLifecycleStatuses(["active", "removing"])
        .map((record) => record.workspaceId)
        ?? []
    );
    const butlerWorkspacePath = this.butlerProfileService?.getProfile()?.workspacePath ?? null;

    if (!butlerWorkspacePath) {
      return this.workspaceRepository
        .list()
        .filter((workspace) => !childWorkspaceIdSet.has(workspace.id))
        .filter((workspace) => !hiddenTemporaryWorkspaceIdSet.has(workspace.id));
    }

    return this.workspaceRepository
      .list()
      .filter((workspace) => !childWorkspaceIdSet.has(workspace.id))
      .filter((workspace) => !hiddenTemporaryWorkspaceIdSet.has(workspace.id))
      .filter((workspace) => !isPathInsideButlerWorkspace(workspace.path, butlerWorkspacePath));
  }

  private async readGitSummary(
    workspace: Workspace,
    signal?: AbortSignal
  ): Promise<WorkspaceGitSummary> {
    const workspacePath = path.resolve(workspace.path);

    if (!fs.existsSync(workspacePath) || !fs.statSync(workspacePath).isDirectory()) {
      return {
        isRepository: false,
        repoRoot: null,
        currentBranch: null,
        commitCount: null,
        remotes: [],
        error: "工作区路径不存在，Git 信息不可用"
      };
    }

    try {
      const repoRootResult = await this.gitCommandRunner.run(
        workspacePath,
        ["rev-parse", "--show-toplevel"],
        {
          allowNonZeroExit: true,
          workspaceId: workspace.id,
          operation: "workspace.readGitSummary",
          signal
        }
      );

      if (repoRootResult.exitCode !== 0) {
        return {
          isRepository: false,
          repoRoot: null,
          currentBranch: null,
          commitCount: null,
          remotes: [],
          error: "当前工作区不是 Git 仓库"
        };
      }

      const repoRoot = repoRootResult.stdout.trim();

      if (!repoRoot) {
        return {
          isRepository: false,
          repoRoot: null,
          currentBranch: null,
          commitCount: null,
          remotes: [],
          error: "Git 仓库根目录解析失败"
        };
      }

      const [branchResult, commitCountResult, remoteResult] = await Promise.all([
        this.gitCommandRunner.run(repoRoot, ["branch", "--show-current"], {
          allowNonZeroExit: true,
          workspaceId: workspace.id,
          operation: "workspace.readGitSummary",
          signal
        }),
        this.gitCommandRunner.run(repoRoot, ["rev-list", "--count", "--all"], {
          allowNonZeroExit: true,
          workspaceId: workspace.id,
          operation: "workspace.readGitSummary",
          signal
        }),
        this.gitCommandRunner.run(repoRoot, ["remote", "-v"], {
          allowNonZeroExit: true,
          workspaceId: workspace.id,
          operation: "workspace.readGitSummary",
          signal
        })
      ]);

      return {
        isRepository: true,
        repoRoot,
        currentBranch: normalizeGitOutput(branchResult.stdout),
        commitCount: parseGitCommitCount(commitCountResult.stdout),
        remotes: parseGitRemotes(remoteResult.stdout),
        error: null
      };
    } catch (error) {
      return {
        isRepository: false,
        repoRoot: null,
        currentBranch: null,
        commitCount: null,
        remotes: [],
        error: mapWorkspaceGitSummaryError(error)
      };
    }
  }

  private registerBackgroundTasks(): void {
    if (!this.taskManager.has(HOST_TASK_TYPES.workspaceCodeCompositionScan)) {
      this.taskManager.register<{
        workspacePath: string;
      }, WorkspaceCodeCompositionSummary>({
        taskType: HOST_TASK_TYPES.workspaceCodeCompositionScan,
        executionLane: "helper_process",
        helperProcessHandler: "workspace.code_composition_scan",
        run: async ({ workspacePath }, context) =>
          readWorkspaceCodeCompositionWithSignal(workspacePath, context.signal)
      });
    }

    if (!this.taskManager.has(HOST_TASK_TYPES.workspaceManagementSummary)) {
      this.taskManager.register<{
        workspaceId: string;
      }, WorkspaceManagementSummary>({
        taskType: HOST_TASK_TYPES.workspaceManagementSummary,
        executionLane: "host_background",
        run: async ({ workspaceId }, context) =>
          this.loadManagementSummary(workspaceId, context.signal)
      });
    }
  }

  private async loadManagementSummary(
    workspaceId: string,
    signal?: AbortSignal
  ): Promise<WorkspaceManagementSummary> {
    const workspace = this.getWorkspaceOrThrow(workspaceId);
    const codeCompositionHandle = this.taskManager.enqueue<{
      workspacePath: string;
    }, WorkspaceCodeCompositionSummary>(HOST_TASK_TYPES.workspaceCodeCompositionScan, {
      key: workspace.id,
      source: "workspace.load_management_summary.code_composition",
      input: {
        workspacePath: workspace.path
      }
    });

    const [git, codeComposition] = await Promise.all([
      this.readGitSummary(workspace, signal),
      awaitTaskHandleWithSignal(codeCompositionHandle, signal)
    ]);

    return {
      workspaceId: workspace.id,
      name: workspace.name,
      path: workspace.path,
      git,
      codeComposition
    };
  }
}

function normalizeWorkspaceNavigationBackgroundColor(
  backgroundColor: string | null | undefined
): string | null | undefined {
  if (backgroundColor === undefined) {
    return undefined;
  }

  if (backgroundColor === null) {
    return null;
  }

  const normalizedColor = backgroundColor.trim().toUpperCase();

  if (!normalizedColor) {
    return null;
  }

  if (!/^#[0-9A-F]{6}$/.test(normalizedColor)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "背景颜色必须是 #RRGGBB 格式",
      field: "backgroundColor"
    });
  }

  return normalizedColor;
}

function toWorkspaceNavigationBindingLog(
  record: Pick<
    WorkspaceNavigationStateRecord,
    "affairsLibraryRootPath" | "affairsLibraryEnabled" | "affairsLibraryFavoritesJson"
  > | null | undefined
): {
  rootPath: string | null;
  enabled: boolean;
  favoritesJson: string | null;
} | null {
  if (!record) {
    return null;
  }

  return {
    rootPath: record.affairsLibraryRootPath ?? null,
    enabled: record.affairsLibraryEnabled === true,
    favoritesJson: record.affairsLibraryFavoritesJson ?? null,
  };
}

function createWorkspaceRecord(
  workspaceRepository: WorkspaceRepository,
  workspacePath: string,
  name?: string
): Workspace {
  const existing = workspaceRepository.findByPath(workspacePath);

  if (existing) {
    if (!existing.removedAt) {
      return existing;
    }

    const timestamp = nowIso();

    return (
      workspaceRepository.restore(existing.id, {
        name: name?.trim() || undefined,
        repoRoot: workspacePath,
        updatedAt: timestamp
      }) ?? {
        ...existing,
        name: name?.trim() || existing.name,
        repoRoot: workspacePath,
        updatedAt: timestamp,
        removedAt: null
      }
    );
  }

  const timestamp = nowIso();

  return workspaceRepository.create({
    id: createId(),
    name: name?.trim() || path.basename(workspacePath),
    path: workspacePath,
    repoRoot: workspacePath,
    favorite: false,
    sortOrder: workspaceRepository.getNextSortOrder(),
    createdAt: timestamp,
    updatedAt: timestamp,
    removedAt: null
  });
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

function getAbortMessage(reason: unknown): string {
  if (reason instanceof Error && reason.message.trim().length > 0) {
    return reason.message;
  }

  if (typeof reason === "string" && reason.trim().length > 0) {
    return reason;
  }

  return "任务已取消";
}

function normalizeWorkspaceIds(workspaceIds: string[]): string[] {
  if (!Array.isArray(workspaceIds)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "workspaceIds 必须是数组",
      field: "workspaceIds"
    });
  }

  const normalizedIds = workspaceIds.map((workspaceId, index) => {
    if (typeof workspaceId !== "string" || !workspaceId.trim()) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "workspaceIds 里的每一项都必须是非空字符串",
        field: `workspaceIds.${index}`
      });
    }

    return workspaceId.trim();
  });
  const uniqueIds = new Set(normalizedIds);

  if (uniqueIds.size !== normalizedIds.length) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "workspaceIds 不允许重复",
      field: "workspaceIds"
    });
  }

  return normalizedIds;
}

function ensureExistingDirectory(targetPath: string, field: string): void {
  if (!fs.existsSync(targetPath)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_WORKSPACE_PATH",
      detail: "工作区路径不存在",
      field
    });
  }

  if (!fs.statSync(targetPath).isDirectory()) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_WORKSPACE_PATH",
      detail: "工作区路径必须是目录",
      field
    });
  }
}

function normalizeCloneDirectoryName(directoryName: string | undefined, repositoryUrl: string): string {
  const rawValue = directoryName?.trim() || deriveDirectoryNameFromRepository(repositoryUrl);
  return normalizeSingleDirectoryName(rawValue, "directoryName");
}

function deriveDirectoryNameFromRepository(repositoryUrl: string): string {
  const normalized = repositoryUrl.trim().replace(/\\/g, "/").replace(/[\/]+$/, "");
  const lastSlashIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf(":"));
  const rawName = lastSlashIndex >= 0 ? normalized.slice(lastSlashIndex + 1) : normalized;
  return rawName.replace(/\.git$/i, "");
}

function normalizeSingleDirectoryName(rawValue: string | undefined, field: string): string {
  const normalized = rawValue?.trim() || "";

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "目标目录名不能为空",
      field
    });
  }

  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("-") ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    path.isAbsolute(normalized)
  ) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "目标目录名无效，必须是单层目录名",
      field
    });
  }

  return normalized;
}

function isPathInsideButlerWorkspace(candidatePath: string, butlerWorkspacePath: string): boolean {
  const relative = path.relative(path.resolve(butlerWorkspacePath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function mapCloneError(error: unknown): AppError {
  if (isAppError(error)) {
    if (error.errorCode === "GIT_COMMAND_FAILED") {
      return mapGitCloneCommandError(error.message);
    }

    return error;
  }

  return mapGitCloneCommandError(error instanceof Error ? error.message : "Git clone 失败");
}

function mapGitCloneCommandError(detail: string): AppError {
  if (
    /authentication failed|fatal: could not read Username|fatal: could not read Password|permission denied/i.test(
      detail
    )
  ) {
    return new AppError({
      statusCode: 401,
      errorCode: "GIT_CLONE_AUTH_FAILED",
      detail: "Git 仓库认证失败，请检查用户名、密码或 token"
    });
  }

  if (
    /unable to access|failed to connect|connection timed out|operation timed out|could not resolve host|network is unreachable|connection reset/i.test(
      detail
    )
  ) {
    return new AppError({
      statusCode: 502,
      errorCode: "GIT_CLONE_NETWORK_FAILED",
      detail: "连接 Git 仓库失败，请检查网络或仓库地址"
    });
  }

  if (/repository .* not found|remote branch .* not found|repository not found|not found/i.test(detail)) {
    return new AppError({
      statusCode: 404,
      errorCode: "GIT_REPOSITORY_NOT_FOUND",
      detail: "Git 仓库不存在，或当前账号没有访问权限"
    });
  }

  return new AppError({
    statusCode: 500,
    errorCode: "GIT_CLONE_FAILED",
    detail: detail.trim() || "Git clone 失败"
  });
}

function mapWorkspaceGitSummaryError(error: unknown): string {
  if (isAppError(error)) {
    if (error.errorCode === "GIT_COMMAND_TIMEOUT") {
      return "Git 信息读取超时，请稍后重试";
    }

    return error.message;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Git 信息读取失败";
}

function listDirectoryRoots(): WorkspaceDirectoryOption[] {
  if (process.platform === "win32") {
    const driveLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

    return driveLetters
      .map((letter) => `${letter}:\\`)
      .filter((rootPath) => fs.existsSync(rootPath))
      .map((rootPath) => ({
        path: rootPath,
        name: rootPath
      }));
  }

  return [
    {
      path: "/",
      name: "/"
    }
  ];
}

function resolveDefaultBrowsePath(roots: WorkspaceDirectoryOption[]): string {
  const homePath = os.homedir();

  if (homePath && fs.existsSync(homePath) && fs.statSync(homePath).isDirectory()) {
    return path.resolve(homePath);
  }

  if (roots[0]?.path) {
    return roots[0].path;
  }

  return path.resolve(process.cwd());
}

function resolveBrowsePath(requestedPath: string | undefined, fallbackPath: string): string {
  const trimmedPath = requestedPath?.trim();

  if (!trimmedPath) {
    return fallbackPath;
  }

  return path.resolve(trimmedPath);
}

function resolveParentPath(currentPath: string): string | null {
  const parentPath = path.dirname(currentPath);
  const currentRoot = path.parse(currentPath).root;

  if (parentPath === currentPath || currentPath === currentRoot) {
    return null;
  }

  return parentPath;
}

function normalizeGitOutput(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}

function parseGitCommitCount(value: string): number | null {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseGitRemotes(output: string): WorkspaceGitRemoteSummary[] {
  const remoteMap = new Map<string, WorkspaceGitRemoteSummary>();

  for (const line of output.split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      continue;
    }

    const match = /^([^\s]+)\s+([^\s]+)\s+\((fetch|push)\)$/.exec(trimmedLine);

    if (!match) {
      continue;
    }

    const [, name, url, mode] = match;
    const existing = remoteMap.get(name);

    // 远程列表通常 fetch/push 会重复两次，这里优先保留 fetch 行，避免 UI 重复。
    if (!existing || mode === "fetch") {
      remoteMap.set(name, { name, url });
    }
  }

  return [...remoteMap.values()].sort((left, right) => left.name.localeCompare(right.name));
}
