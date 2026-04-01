import fs from "node:fs";
import path from "node:path";

import chokidar, { type FSWatcher } from "chokidar";
import ignore from "ignore";

import type { WorkspaceService } from "../workspace/workspace-service.js";

const DEBOUNCE_MS = 500;

interface WatcherEntry {
  watcher: FSWatcher;
  debounceTimer: NodeJS.Timeout | null;
  subscriberCount: number;
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
  private readonly watchers = new Map<string, WatcherEntry>();
  private onChange: ((workspaceId: string) => void) | null = null;

  constructor(private readonly workspaceService: WorkspaceService) {}

  setOnChange(callback: (workspaceId: string) => void): void {
    this.onChange = callback;
  }

  /**
   * 为指定工作区启动文件监听。内部使用引用计数，多个订阅者共享同一个 watcher。
   */
  subscribe(workspaceId: string): void {
    const existing = this.watchers.get(workspaceId);
    if (existing) {
      existing.subscriberCount++;
      return;
    }

    const workspace = this.workspaceService.getWorkspaceOrThrow(workspaceId);
    const ig = loadGitignoreRules(workspace.path);

    const watcher = chokidar.watch(workspace.path, {
      ignored: (absolutePath: string) => {
        // chokidar 传入绝对路径，转为相对路径后用 ignore 库匹配
        const relative = path.relative(workspace.path, absolutePath);
        if (!relative) {
          return false;
        }
        return ig.ignores(relative);
      },
      ignoreInitial: true,
      ignorePermissionErrors: true,
      persistent: true
    });

    const entry: WatcherEntry = {
      watcher,
      debounceTimer: null,
      subscriberCount: 1
    };

    watcher.on("all", () => {
      this.scheduleRefresh(workspaceId);
    });

    this.watchers.set(workspaceId, entry);
  }

  /**
   * 取消订阅。引用计数归零时自动关闭 watcher。
   */
  unsubscribe(workspaceId: string): void {
    const entry = this.watchers.get(workspaceId);
    if (!entry) {
      return;
    }

    entry.subscriberCount--;
    if (entry.subscriberCount <= 0) {
      entry.watcher.close();
      if (entry.debounceTimer) {
        clearTimeout(entry.debounceTimer);
      }
      this.watchers.delete(workspaceId);
    }
  }

  private scheduleRefresh(workspaceId: string): void {
    const entry = this.watchers.get(workspaceId);
    if (!entry) {
      return;
    }

    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer);
    }

    entry.debounceTimer = setTimeout(() => {
      entry.debounceTimer = null;
      this.onChange?.(workspaceId);
    }, DEBOUNCE_MS);
  }

  dispose(): void {
    for (const entry of this.watchers.values()) {
      entry.watcher.close();
      if (entry.debounceTimer) {
        clearTimeout(entry.debounceTimer);
      }
    }
    this.watchers.clear();
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
