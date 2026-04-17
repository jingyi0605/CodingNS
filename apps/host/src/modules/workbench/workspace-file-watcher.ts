import fs from "node:fs";
import path from "node:path";

import chokidar, { type FSWatcher } from "chokidar";
import ignore from "ignore";

import type { Workspace } from "../../types/domain.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";

const DEBOUNCE_MS = 500;
const GIT_REF_WATCH_DEPTH = 8;

interface WatcherEntry {
  watcher: FSWatcher;
  subscriberCount: number;
}

interface GitWatchTarget {
  path: string;
  depth?: number;
}

export interface WorkspaceWatcherEvent {
  workspaceId: string;
  scope: "fileTree" | "git";
}

/**
 * 工作区文件监听服务。
 *
 * 使用 chokidar 监听工作区目录的文件变化，通过防抖机制在文件变更时主动通知上层。
 * 利用 `ignore` 库解析 .gitignore 规则，在 chokidar 层面排除被 git 忽略的文件——
 * 这些文件的变化根本不会产生事件，避免无意义的 git status 调用。
 *
 * 设计原则：
 * - chokidar 只当触发器，不负责精确过滤（git 命令自己处理）
 * - .gitignore 排除是"尽力而为"：解析根目录 .gitignore，覆盖 90%+ 场景
 * - 后端 isGitStatusChanged 缓存机制兜底剩余情况
 */
export class WorkspaceFileWatcher {
  private readonly fileTreeWatchers = new Map<string, WatcherEntry>();
  private readonly gitWatchers = new Map<string, WatcherEntry>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private onChange: ((event: WorkspaceWatcherEvent) => void) | null = null;

  constructor(private readonly workspaceService: WorkspaceService) {}

  setOnChange(callback: (event: WorkspaceWatcherEvent) => void): void {
    this.onChange = callback;
  }

  /**
   * 文件树监听只盯当前展开目录，避免默认递归监听整个工作区。
   */
  subscribeFileTree(workspaceId: string, paths: string[]): void {
    const workspace = this.workspaceService.getWorkspaceOrThrow(workspaceId);
    const ig = loadGitignoreRules(workspace.path);

    for (const normalizedPath of normalizeWatchPaths(paths)) {
      const key = `${workspaceId}::${normalizedPath}`;
      const existing = this.fileTreeWatchers.get(key);

      if (existing) {
        existing.subscriberCount += 1;
        continue;
      }

      const watchTarget = resolveFileTreeWatchTarget(workspace.path, normalizedPath);
      const watcher = chokidar.watch(watchTarget, {
        depth: 0,
        ignored: (absolutePath: string) => shouldIgnoreWorkspacePath(workspace.path, ig, absolutePath),
        ignoreInitial: true,
        ignorePermissionErrors: true,
        persistent: true
      });

      watcher.on("all", () => {
        this.scheduleRefresh(workspaceId, "fileTree");
      });

      this.fileTreeWatchers.set(key, {
        watcher,
        subscriberCount: 1
      });
    }
  }

  /**
   * Git 监听只盯 `.git` 元数据和 worktree 相关的 gitdir/commondir。
   */
  subscribeGit(workspaceId: string): void {
    const workspace = this.workspaceService.getWorkspaceOrThrow(workspaceId);

    for (const target of resolveGitWatchTargets(workspace)) {
      const key = `${workspaceId}::${target.path}`;
      const existing = this.gitWatchers.get(key);

      if (existing) {
        existing.subscriberCount += 1;
        continue;
      }

      const watcher = chokidar.watch(target.path, {
        depth: target.depth,
        ignoreInitial: true,
        ignorePermissionErrors: true,
        persistent: true
      });

      watcher.on("all", () => {
        this.scheduleRefresh(workspaceId, "git");
      });

      this.gitWatchers.set(key, {
        watcher,
        subscriberCount: 1
      });
    }
  }

  unsubscribeFileTree(workspaceId: string, paths: string[]): void {
    for (const normalizedPath of normalizeWatchPaths(paths)) {
      const key = `${workspaceId}::${normalizedPath}`;
      const entry = this.fileTreeWatchers.get(key);

      if (!entry) {
        continue;
      }

      entry.subscriberCount -= 1;

      if (entry.subscriberCount <= 0) {
        void entry.watcher.close();
        this.fileTreeWatchers.delete(key);
      }
    }
  }

  unsubscribeGit(workspaceId: string): void {
    for (const key of [...this.gitWatchers.keys()]) {
      if (!key.startsWith(`${workspaceId}::`)) {
        continue;
      }

      const entry = this.gitWatchers.get(key);

      if (!entry) {
        continue;
      }

      entry.subscriberCount -= 1;

      if (entry.subscriberCount <= 0) {
        void entry.watcher.close();
        this.gitWatchers.delete(key);
      }
    }
  }

  private scheduleRefresh(workspaceId: string, scope: "fileTree" | "git"): void {
    const key = `${scope}::${workspaceId}`;
    const existingTimer = this.debounceTimers.get(key);

    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      this.onChange?.({
        workspaceId,
        scope
      });
    }, DEBOUNCE_MS);

    this.debounceTimers.set(key, timer);
  }

  dispose(): void {
    for (const entry of this.fileTreeWatchers.values()) {
      void entry.watcher.close();
    }

    for (const entry of this.gitWatchers.values()) {
      void entry.watcher.close();
    }

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }

    this.fileTreeWatchers.clear();
    this.gitWatchers.clear();
    this.debounceTimers.clear();
  }
}

/**
 * 始终排除的目录模式——这些目录包含大量生成文件或编译产物，
 * 监视它们会导致文件描述符耗尽（EBADF）。
 */
const ALWAYS_IGNORE_PATTERNS = [
  ".git",
  "node_modules",
  "target",
  "build",
  "dist",
  ".next",
  ".nuxt",
  "out",
  ".output"
];

/**
 * 读取工作区根目录的 .gitignore 文件，构建 ignore 实例。
 * 始终排除 .git 目录本身（不应监听 git 内部文件），
 * 并排除大型构建产物目录以避免文件描述符耗尽。
 */
function loadGitignoreRules(workspacePath: string): ReturnType<typeof ignore> {
  const ig = ignore();

  ig.add(ALWAYS_IGNORE_PATTERNS);

  const gitignorePath = path.join(workspacePath, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    try {
      const content = fs.readFileSync(gitignorePath, "utf-8");
      ig.add(content);
    } catch {
      // 读取失败时静默降级，只排除内置规则
    }
  }

  return ig;
}

function normalizeWatchPaths(paths: string[]): string[] {
  const uniquePaths = new Set<string>();

  for (const value of paths.length > 0 ? paths : [""]) {
    uniquePaths.add(normalizePanelPath(value));
  }

  return [...uniquePaths];
}

function normalizePanelPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function shouldIgnoreWorkspacePath(
  workspacePath: string,
  ig: ReturnType<typeof ignore>,
  absolutePath: string
): boolean {
  const relative = path.relative(workspacePath, absolutePath);

  if (!relative) {
    return false;
  }

  return ig.ignores(relative);
}

function resolveFileTreeWatchTarget(workspacePath: string, relativePath: string): string {
  const workspaceRoot = path.resolve(workspacePath);
  let currentPath = path.resolve(workspaceRoot, relativePath || ".");

  while (isPathInside(currentPath, workspaceRoot)) {
    if (fs.existsSync(currentPath)) {
      try {
        if (fs.statSync(currentPath).isDirectory()) {
          return currentPath;
        }
      } catch {
        return path.dirname(currentPath);
      }

      return path.dirname(currentPath);
    }

    const parentPath = path.dirname(currentPath);

    if (parentPath === currentPath) {
      break;
    }

    currentPath = parentPath;
  }

  return workspaceRoot;
}

function resolveGitWatchTargets(workspace: Workspace): GitWatchTarget[] {
  const targets = new Set<string>();
  const workspaceRoot = path.resolve(workspace.path);
  const gitEntry = path.join(workspaceRoot, ".git");
  addExistingFileWatchTarget(targets, gitEntry);

  const repoRootEntry = workspace.repoRoot && path.resolve(workspace.repoRoot) !== workspaceRoot
    ? path.join(path.resolve(workspace.repoRoot), ".git")
    : null;

  addExistingFileWatchTarget(targets, repoRootEntry);

  const candidateGitDirs = [gitEntry, repoRootEntry].filter((value): value is string => Boolean(value));

  for (const candidate of candidateGitDirs) {
    const resolvedGitDir = resolveGitDirectory(candidate);

    if (!resolvedGitDir) {
      continue;
    }

    addGitMetadataWatchTargets(targets, resolvedGitDir);

    const commonDir = resolveGitCommonDirectory(resolvedGitDir);

    if (commonDir) {
      addGitMetadataWatchTargets(targets, commonDir);
    }
  }

  return [...targets].map((targetPath) => ({
    path: targetPath,
    depth: isGitRefDirectory(targetPath) ? GIT_REF_WATCH_DEPTH : 0
  }));
}

function resolveGitDirectory(gitEntryPath: string): string | null {
  if (!fs.existsSync(gitEntryPath)) {
    return null;
  }

  try {
    const stat = fs.statSync(gitEntryPath);

    if (stat.isDirectory()) {
      return gitEntryPath;
    }

    if (!stat.isFile()) {
      return null;
    }

    const content = fs.readFileSync(gitEntryPath, "utf-8");
    const gitDirLine = content
      .split(/\r?\n/)
      .find((line) => line.trim().toLowerCase().startsWith("gitdir:"));

    if (!gitDirLine) {
      return null;
    }

    const rawGitDir = gitDirLine.slice(gitDirLine.indexOf(":") + 1).trim();

    if (!rawGitDir) {
      return null;
    }

    return path.resolve(path.dirname(gitEntryPath), rawGitDir);
  } catch {
    return null;
  }
}

function resolveGitCommonDirectory(gitDirectory: string): string | null {
  const commonDirPath = path.join(gitDirectory, "commondir");

  if (!fs.existsSync(commonDirPath)) {
    return null;
  }

  try {
    const rawValue = fs.readFileSync(commonDirPath, "utf-8").trim();

    if (!rawValue) {
      return null;
    }

    return path.resolve(gitDirectory, rawValue);
  } catch {
    return null;
  }
}

function addGitMetadataWatchTargets(targets: Set<string>, gitDirectory: string): void {
  addExistingFileWatchTarget(targets, path.join(gitDirectory, "HEAD"));
  addExistingFileWatchTarget(targets, path.join(gitDirectory, "index"));
  addExistingFileWatchTarget(targets, path.join(gitDirectory, "packed-refs"));
  addExistingFileWatchTarget(targets, path.join(gitDirectory, "FETCH_HEAD"));
  addExistingFileWatchTarget(targets, path.join(gitDirectory, "ORIG_HEAD"));
  addExistingFileWatchTarget(targets, path.join(gitDirectory, "MERGE_HEAD"));
  addExistingFileWatchTarget(targets, path.join(gitDirectory, "REBASE_HEAD"));
  addExistingFileWatchTarget(targets, path.join(gitDirectory, "CHERRY_PICK_HEAD"));
  addExistingFileWatchTarget(targets, path.join(gitDirectory, "logs", "HEAD"));
  addExistingDirectoryWatchTarget(targets, path.join(gitDirectory, "refs", "heads"));
  addExistingDirectoryWatchTarget(targets, path.join(gitDirectory, "refs", "remotes"));
  addExistingDirectoryWatchTarget(targets, path.join(gitDirectory, "rebase-merge"));
  addExistingDirectoryWatchTarget(targets, path.join(gitDirectory, "rebase-apply"));
}

function addExistingFileWatchTarget(targets: Set<string>, targetPath: string | null): void {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return;
  }

  try {
    const resolvedPath = path.resolve(targetPath);

    if (fs.statSync(resolvedPath).isFile()) {
      targets.add(resolvedPath);
    }
  } catch {
    // 忽略不存在或无法访问的路径
  }
}

function addExistingDirectoryWatchTarget(targets: Set<string>, targetPath: string | null): void {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return;
  }

  try {
    const resolvedPath = path.resolve(targetPath);

    if (fs.statSync(resolvedPath).isDirectory()) {
      targets.add(resolvedPath);
    }
  } catch {
    // 忽略不存在或无法访问的路径
  }
}

function isGitRefDirectory(targetPath: string): boolean {
  return (
    targetPath.endsWith(`${path.sep}refs${path.sep}heads`) ||
    targetPath.endsWith(`${path.sep}refs${path.sep}remotes`)
  );
}

function isPathInside(candidate: string, parent: string): boolean {
  const normalizedCandidate = path.resolve(candidate);
  const normalizedParent = path.resolve(parent);

  return (
    normalizedCandidate === normalizedParent ||
    normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`)
  );
}
