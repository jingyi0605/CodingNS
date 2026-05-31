import fs from "node:fs";
import path from "node:path";

import type { WorkspaceNavigationStateRepository } from "../../storage/repositories/workspace-navigation-state-repository.js";

export interface AffairsLibraryWatchDirtyEvent {
  kind: "index" | "config" | "tag-rules";
  reason: string;
  targetPath?: string;
}

interface AffairsLibraryDirtyWatchLogger {
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
}

interface WatchEntry {
  rootDir: string;
  watcher: fs.FSWatcher;
  periodicTimer: NodeJS.Timeout | null;
}

interface PendingWorkspaceDirtyState {
  configChanged: boolean;
  tagRulesChanged: boolean;
  indexChanged: boolean;
  reasons: Set<string>;
  indexTargets: Set<string>;
}

const CONFIG_RELATIVE_PATH = ".ai-index/doc-semantic-index.config.json";
const TAG_RULES_RELATIVE_PATH = ".ai-index/tag-rules.json";
const INDEX_EXPORTS_RELATIVE_PATH = ".ai-index/exports";
const INDEX_EXPORT_STATUS_RELATIVE_PATH = ".ai-index/exports/status.json";
const INDEX_EXPORT_MANIFEST_RELATIVE_PATH = ".ai-index/exports/manifest.json";
const AUTO_REFRESH_QUIET_WINDOW_MS = 800;
const PERIODIC_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const INDEX_DIR_NAME = ".ai-index";
const DIRECTORY_EVENT_RECENT_WINDOW_MS = 5_000;
const DIRECTORY_EVENT_SCAN_LIMIT = 2_000;
const TEMPORARY_FILE_PATTERNS = [
  /\.swp$/i,
  /\.swo$/i,
  /\.swx$/i,
  /\.tmp$/i,
  /\.temp$/i,
  /\.bak$/i,
  /\.orig$/i,
  /\.part$/i,
  /\.partial$/i,
  /\.download$/i,
  /\.crdownload$/i,
  /~$/i,
  /^~\$/i,
  /^\.~.+/i,
  /^#.*#$/i,
  /^\.#.+/i,
  /^\.goutputstream-.+/i,
  /^\.tmp.+/i,
  /^\.DS_Store$/i
];

/**
 * 外部文件自动刷新服务。
 *
 * 这一版不再用 chokidar 递归盯整棵资料库，改成每个资料库根目录只挂一个
 * `fs.watch(..., { recursive: true })`。这样句柄数量跟“资料库数量”相关，
 * 不再跟目录树规模线性增长。
 *
 * 规则：
 * - 配置文件、标签规则：继续走专用链路
 * - 普通文档：走 targeted refresh
 * - 常见临时文件：直接忽略
 * - 再补一层低频周期刷新，给外部 watcher 漏事件兜底
 */
export class AffairsLibraryDirtyWatchService {
  private readonly watchersByWorkspace = new Map<string, WatchEntry>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly pendingDirtyStateByWorkspace = new Map<string, PendingWorkspaceDirtyState>();

  constructor(
    private readonly workspaceNavigationStateRepository: WorkspaceNavigationStateRepository,
    private readonly onWorkspaceDirty: (workspaceId: string, event: AffairsLibraryWatchDirtyEvent) => void,
    private readonly logger: AffairsLibraryDirtyWatchLogger
  ) {}

  syncAll(): void {
    const enabledStates = this.workspaceNavigationStateRepository.listEnabledAffairsLibraries();
    const activeWorkspaceIds = new Set(enabledStates.map((item) => item.workspaceId));

    for (const state of enabledStates) {
      const rootDir = state.affairsLibraryRootPath?.trim() ?? "";
      if (rootDir) {
        this.ensureWorkspaceWatch(state.workspaceId, rootDir);
      }
    }

    for (const workspaceId of [...this.watchersByWorkspace.keys()]) {
      if (!activeWorkspaceIds.has(workspaceId)) {
        this.stopWorkspaceWatch(workspaceId);
      }
    }
  }

  syncWorkspace(workspaceId: string): void {
    const state = this.workspaceNavigationStateRepository.findAnyEnabledAffairsLibraryByWorkspaceId(workspaceId);
    const rootDir = state?.affairsLibraryRootPath?.trim() ?? "";

    if (!rootDir) {
      this.stopWorkspaceWatch(workspaceId);
      return;
    }

    this.ensureWorkspaceWatch(workspaceId, rootDir);
  }

  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.pendingDirtyStateByWorkspace.clear();

    for (const entry of this.watchersByWorkspace.values()) {
      if (entry.periodicTimer) {
        clearInterval(entry.periodicTimer);
      }
      entry.watcher.close();
    }
    this.watchersByWorkspace.clear();
  }

  private ensureWorkspaceWatch(workspaceId: string, rootDir: string): void {
    if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
      this.stopWorkspaceWatch(workspaceId);
      this.logger.info(
        {
          workspaceId,
          rootDir,
          skipped: "root_dir_invalid"
        },
        "事务文档库外部刷新监听已跳过，根目录当前不可用"
      );
      return;
    }

    const existing = this.watchersByWorkspace.get(workspaceId);
    if (existing?.rootDir === rootDir) {
      return;
    }

    if (existing) {
      this.stopWorkspaceWatch(workspaceId);
    }

    try {
      const watcher = fs.watch(
        rootDir,
        { persistent: true, recursive: true },
        (eventType, fileName) => {
          try {
            this.handleFsWatchEvent(workspaceId, rootDir, eventType, fileName);
          } catch (error) {
            this.logger.warn(
              {
                workspaceId,
                rootDir,
                eventType,
                fileName: normalizeFsWatchFileName(fileName),
                error: error instanceof Error ? error.message : String(error),
                source: "affairs_library.watch"
              },
              "事务文档库外部刷新监听处理文件变动失败"
            );
          }
        }
      );

      watcher.on("error", (error) => {
        this.logger.warn(
          {
            workspaceId,
            rootDir,
            error: error instanceof Error ? error.message : String(error),
            source: "affairs_library.watch"
          },
          "事务文档库外部刷新监听异常，已停止当前监听，等待下次同步恢复"
        );
        this.stopWorkspaceWatch(workspaceId);
      });

      const periodicTimer = setInterval(() => {
        this.onWorkspaceDirty(workspaceId, {
          kind: "index",
          reason: "periodic_refresh"
        });
      }, PERIODIC_REFRESH_INTERVAL_MS);

      this.watchersByWorkspace.set(workspaceId, {
        rootDir,
        watcher,
        periodicTimer
      });

      this.logger.info(
        {
          workspaceId,
          rootDir,
          periodicRefreshIntervalMs: PERIODIC_REFRESH_INTERVAL_MS,
          source: "affairs_library.watch"
        },
        "事务文档库外部刷新监听已启动"
      );
    } catch (error) {
      this.logger.warn(
        {
          workspaceId,
          rootDir,
          error: error instanceof Error ? error.message : String(error),
          source: "affairs_library.watch"
        },
        "事务文档库外部刷新监听启动失败"
      );
      this.stopWorkspaceWatch(workspaceId);
    }
  }

  private stopWorkspaceWatch(workspaceId: string): void {
    const timer = this.debounceTimers.get(workspaceId);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(workspaceId);
    }
    this.pendingDirtyStateByWorkspace.delete(workspaceId);

    const entry = this.watchersByWorkspace.get(workspaceId);
    if (!entry) {
      return;
    }

    if (entry.periodicTimer) {
      clearInterval(entry.periodicTimer);
    }
    entry.watcher.close();
    this.watchersByWorkspace.delete(workspaceId);
    this.logger.info(
      {
        workspaceId,
        rootDir: entry.rootDir,
        source: "affairs_library.watch"
      },
      "事务文档库外部刷新监听已停止"
    );
  }

  private handleFsWatchEvent(
    workspaceId: string,
    rootDir: string,
    eventType: string,
    fileName: string | Buffer | null
  ): void {
    const relativePath = this.normalizeRelativePath(rootDir, fileName);
    if (!relativePath) {
      return;
    }

    const dirtyState = this.getOrCreatePendingDirtyState(workspaceId);
    const missingIndexArtifactReason = this.detectMissingIndexArtifactReason(rootDir, relativePath);
    if (missingIndexArtifactReason) {
      dirtyState.indexChanged = true;
      dirtyState.reasons.add(missingIndexArtifactReason);
      this.logger.info(
        {
          workspaceId,
          rootDir,
          eventType,
          relativePath,
          reason: missingIndexArtifactReason,
          source: "affairs_library.watch"
        },
        "事务文档库外部刷新监听发现索引产物缺失，已提交重建脏标记"
      );
      this.scheduleWorkspaceRefresh(workspaceId);
      return;
    }

    const effectiveTargetPath = this.resolveEffectiveTargetPath(rootDir, relativePath);
    if (!effectiveTargetPath) {
      return;
    }

    dirtyState.reasons.add(`${eventType}:${effectiveTargetPath}`);

    if (effectiveTargetPath === CONFIG_RELATIVE_PATH) {
      dirtyState.configChanged = true;
    } else if (effectiveTargetPath === TAG_RULES_RELATIVE_PATH) {
      dirtyState.tagRulesChanged = true;
    } else {
      dirtyState.indexChanged = true;
      dirtyState.indexTargets.add(normalizeTargetPath(effectiveTargetPath));
    }

    this.logger.info(
      {
        workspaceId,
        rootDir,
        eventType,
        relativePath: effectiveTargetPath,
        source: "affairs_library.watch"
      },
      "事务文档库外部刷新监听捕获到文件变动"
    );
    this.scheduleWorkspaceRefresh(workspaceId);
  }

  private scheduleWorkspaceRefresh(workspaceId: string): void {
    const existingTimer = this.debounceTimers.get(workspaceId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(workspaceId);
      this.flushWorkspaceDirtyState(workspaceId);
    }, AUTO_REFRESH_QUIET_WINDOW_MS);

    this.debounceTimers.set(workspaceId, timer);
  }

  private flushWorkspaceDirtyState(workspaceId: string): void {
    const state = this.pendingDirtyStateByWorkspace.get(workspaceId);
    if (!state) {
      return;
    }
    this.pendingDirtyStateByWorkspace.delete(workspaceId);

    const reasons = [...state.reasons].sort((a, b) => a.localeCompare(b, "zh-CN"));
    this.logger.info(
      {
        workspaceId,
        reasonCount: reasons.length,
        configChanged: state.configChanged,
        tagRulesChanged: state.tagRulesChanged,
        indexChanged: state.indexChanged,
        indexTargets: [...state.indexTargets].sort((a, b) => a.localeCompare(b, "zh-CN")),
        reasons,
        source: "affairs_library.watch"
      },
      "事务文档库外部刷新监听已提交脏标记"
    );

    if (state.configChanged) {
      this.onWorkspaceDirty(workspaceId, {
        kind: "config",
        reason: reasons.find((item) => item.includes(CONFIG_RELATIVE_PATH)) ?? "watch:config_changed"
      });
    }

    if (state.tagRulesChanged) {
      this.onWorkspaceDirty(workspaceId, {
        kind: "tag-rules",
        reason: reasons.find((item) => item.includes(TAG_RULES_RELATIVE_PATH)) ?? "watch:tag_rules_changed"
      });
    }

    if (state.indexChanged) {
      const targetPath = pickNarrowestTargetPath([...state.indexTargets]);
      this.onWorkspaceDirty(workspaceId, {
        kind: "index",
        reason: reasons.find((item) => isIndexReason(item)) ?? "watch:external_change",
        ...(targetPath ? { targetPath } : {})
      });
    }
  }

  private shouldIgnorePath(relativePath: string): boolean {
    if (relativePath === CONFIG_RELATIVE_PATH || relativePath === TAG_RULES_RELATIVE_PATH) {
      return false;
    }

    if (relativePath === INDEX_DIR_NAME || relativePath.startsWith(`${INDEX_DIR_NAME}/`)) {
      return true;
    }

    const baseName = path.posix.basename(relativePath);
    return TEMPORARY_FILE_PATTERNS.some((pattern) => pattern.test(baseName));
  }

  private detectMissingIndexArtifactReason(rootDir: string, relativePath: string): string | null {
    if (relativePath === CONFIG_RELATIVE_PATH || relativePath === TAG_RULES_RELATIVE_PATH) {
      return null;
    }
    if (relativePath !== INDEX_DIR_NAME && !relativePath.startsWith(`${INDEX_DIR_NAME}/`)) {
      return null;
    }

    const indexDirPath = path.join(rootDir, INDEX_DIR_NAME);
    if (!fs.existsSync(indexDirPath)) {
      return "watch:missing_index_artifact:.ai-index";
    }

    const exportDirPath = path.join(rootDir, INDEX_EXPORTS_RELATIVE_PATH);
    if (!fs.existsSync(exportDirPath)) {
      return "watch:missing_index_artifact:.ai-index/exports";
    }

    if (!fs.existsSync(path.join(rootDir, INDEX_EXPORT_STATUS_RELATIVE_PATH))) {
      return `watch:missing_index_artifact:${INDEX_EXPORT_STATUS_RELATIVE_PATH}`;
    }

    if (!fs.existsSync(path.join(rootDir, INDEX_EXPORT_MANIFEST_RELATIVE_PATH))) {
      return `watch:missing_index_artifact:${INDEX_EXPORT_MANIFEST_RELATIVE_PATH}`;
    }

    return null;
  }

  private resolveEffectiveTargetPath(rootDir: string, relativePath: string): string | null {
    if (this.shouldIgnorePath(relativePath)) {
      return null;
    }

    const absolutePath = path.join(rootDir, relativePath);
    if (!fs.existsSync(absolutePath)) {
      return relativePath;
    }

    let stats: fs.Stats;
    try {
      stats = fs.statSync(absolutePath);
    } catch {
      return relativePath;
    }

    if (!stats.isDirectory()) {
      return relativePath;
    }

    const candidates = scanRecentDirectoryTargets(
      rootDir,
      relativePath,
      Date.now() - DIRECTORY_EVENT_RECENT_WINDOW_MS
    ).filter((item) => !this.shouldIgnorePath(item));

    if (candidates.length === 0) {
      return null;
    }

    return pickNarrowestTargetPath(candidates) ?? relativePath;
  }

  private normalizeRelativePath(rootDir: string, inputPath: string | Buffer | null): string | null {
    const normalizedInput = normalizeFsWatchFileName(inputPath);
    if (!normalizedInput) {
      return null;
    }

    const rootBaseName = path.basename(rootDir).trim();
    if (normalizedInput === rootBaseName) {
      return null;
    }

    const relativePath = normalizedInput.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!relativePath || relativePath === "." || relativePath.startsWith("../")) {
      const fallback = path.relative(rootDir, normalizedInput).replace(/\\/g, "/");
      if (!fallback || fallback === "." || fallback.startsWith("../")) {
        return null;
      }
      return fallback;
    }

    return relativePath;
  }

  private getOrCreatePendingDirtyState(workspaceId: string): PendingWorkspaceDirtyState {
    const current = this.pendingDirtyStateByWorkspace.get(workspaceId);
    if (current) {
      return current;
    }

    const next: PendingWorkspaceDirtyState = {
      configChanged: false,
      tagRulesChanged: false,
      indexChanged: false,
      reasons: new Set<string>(),
      indexTargets: new Set<string>()
    };
    this.pendingDirtyStateByWorkspace.set(workspaceId, next);
    return next;
  }
}

function normalizeFsWatchFileName(value: string | Buffer | null): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf-8").trim();
  }
  return "";
}

function normalizeTargetPath(relativePath: string): string {
  return relativePath.trim().replace(/^\.\/+/, "").replace(/\/+$/, "");
}

function pickNarrowestTargetPath(targets: string[]): string | undefined {
  if (targets.length === 0) {
    return undefined;
  }

  let selected = targets[0]?.trim() || undefined;
  for (const target of targets) {
    const normalizedTarget = target.trim();
    if (!normalizedTarget) {
      continue;
    }
    if (!selected || selected.startsWith(`${normalizedTarget}/`)) {
      selected = normalizedTarget;
    }
  }

  return selected || undefined;
}

function isIndexReason(reason: string): boolean {
  return !reason.includes(CONFIG_RELATIVE_PATH) && !reason.includes(TAG_RULES_RELATIVE_PATH);
}

function scanRecentDirectoryTargets(
  rootDir: string,
  relativeDirectoryPath: string,
  minMtimeMs: number
): string[] {
  const absoluteDirectoryPath = path.join(rootDir, relativeDirectoryPath);
  const stack: Array<{ absolutePath: string; relativePath: string }> = [{
    absolutePath: absoluteDirectoryPath,
    relativePath: relativeDirectoryPath
  }];
  const results: string[] = [];
  let visitedCount = 0;

  while (stack.length > 0 && visitedCount < DIRECTORY_EVENT_SCAN_LIMIT) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.absolutePath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (visitedCount >= DIRECTORY_EVENT_SCAN_LIMIT) {
        break;
      }
      visitedCount += 1;

      const nextRelativePath = normalizeTargetPath(path.posix.join(current.relativePath, entry.name));
      const nextAbsolutePath = path.join(current.absolutePath, entry.name);
      let stats: fs.Stats;
      try {
        stats = fs.statSync(nextAbsolutePath);
      } catch {
        continue;
      }

      if (stats.mtimeMs < minMtimeMs) {
        if (entry.isDirectory()) {
          stack.push({
            absolutePath: nextAbsolutePath,
            relativePath: nextRelativePath
          });
        }
        continue;
      }

      if (entry.isDirectory()) {
        stack.push({
          absolutePath: nextAbsolutePath,
          relativePath: nextRelativePath
        });
        continue;
      }

      results.push(nextRelativePath);
    }
  }

  return results;
}
