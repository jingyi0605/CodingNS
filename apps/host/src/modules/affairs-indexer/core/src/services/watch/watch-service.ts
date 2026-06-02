import fs from "node:fs";
import path from "node:path";
import { AppError, APP_ERROR_CODES, type RuntimeConfig } from "../../../../contracts/src/index.js";
import { loadRuntimeConfig } from "../../config/load-runtime-config.js";
import { CatalogWriteRepository } from "../../repositories/catalog-write-repository.js";
import { ExportBuilder } from "../export/export-builder.js";
import { AllowedExtensionsDiffService, type AllowedExtensionsDiffApplyResult } from "../indexer/allowed-extensions-diff-service.js";
import { TextIndexer, type TextIndexResult } from "../indexer/text-indexer.js";

const WATCHER_READY_META_KEY = "watcher.ready_after_initial_export";

function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch (_) {
    return null;
  }
}

export interface WatchServiceOptions {
  targetPath?: string;
  once?: boolean;
  debounceMs?: number;
  durationMs?: number;
}

export interface WatchCycleResult {
  scopePath?: string;
  kind: "index" | "config";
  index: TextIndexResult | null;
  configApply: AllowedExtensionsDiffApplyResult | null;
  export: {
    metaShardCount: number;
    detailShardCount: number;
    tagShardCount: number;
    exportedAt: string;
  } | null;
}

export interface WatchRunResult {
  mode: "once" | "watch";
  watchRoot: string;
  recursive: boolean;
  debounceMs: number;
  cycleCount: number;
  eventCount: number;
  lastEvent: {
    eventType: string;
    relativePath: string | null;
  } | null;
  initialCycle: WatchCycleResult;
  cycles: WatchCycleResult[];
  stoppedBy: "once" | "signal" | "timeout";
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function resolveWatchRoot(rootDir: string, targetPath?: string): string {
  return targetPath ? path.resolve(rootDir, targetPath) : rootDir;
}

function isConfigPath(relativePath: string | null): boolean {
  return relativePath === ".ai-index/doc-semantic-index.config.json"
    || relativePath === "doc-semantic-index.config.json"
    || relativePath === ".doc-semantic-indexrc.json"
    || relativePath === ".doc-semantic-index/config.json";
}

function isIgnoredWatchPath(relativePath: string | null): boolean {
  if (!relativePath) {
    return false;
  }
  if (isConfigPath(relativePath)) {
    return false;
  }
  return relativePath === ".ai-index" || relativePath.startsWith(".ai-index/");
}

/**
 * 最小 watch 服务。
 * 第二阶段补上 Dirty Scope 透传与静态导出构建。
 */
export class WatchService {
  constructor(private readonly config: RuntimeConfig) {}

  private async runCycleAsync(targetPath?: string): Promise<WatchCycleResult> {
    const indexer = new TextIndexer(this.config);
    const indexResult = await indexer.index(targetPath);
    const exportResult = await new ExportBuilder(this.config).build({ dirtyScope: indexResult.dirtyScope });

    return {
      scopePath: targetPath,
      kind: "index",
      index: indexResult,
      configApply: null,
      export: {
        metaShardCount: exportResult.metaShardCount,
        detailShardCount: exportResult.detailShardCount,
        tagShardCount: exportResult.tagShardCount,
        exportedAt: exportResult.exportedAt,
      },
    };
  }

  private async runConfigCycleAsync(): Promise<WatchCycleResult> {
    const config = loadRuntimeConfig(this.config.rootDir, {
      args: {
        rootDir: this.config.rootDir,
      },
      env: process.env,
    });
    const result = await new AllowedExtensionsDiffService(config).applyIfNeeded();
    return {
      scopePath: ".ai-index/doc-semantic-index.config.json",
      kind: "config",
      index: result.indexResult,
      configApply: result,
      export: result.exportResult,
    };
  }

  async run(options: WatchServiceOptions = {}): Promise<WatchRunResult> {
    const debounceMs = typeof options.debounceMs === "number" && options.debounceMs >= 0
      ? options.debounceMs
      : this.config.watchDebounceMs;
    const watchRoot = resolveWatchRoot(this.config.rootDir, options.targetPath);
    const initialCycle = await this.runCycleAsync(options.targetPath);
    if (!options.targetPath) {
      new AllowedExtensionsDiffService(this.config).syncCurrentAsApplied();
    }

    if (options.once) {
      return {
        mode: "once",
        watchRoot,
        recursive: false,
        debounceMs,
        cycleCount: 1,
        eventCount: 0,
        lastEvent: null,
        initialCycle,
        cycles: [initialCycle],
        stoppedBy: "once",
      };
    }

    const writer = new CatalogWriteRepository(this.config.dbPath);
    const manifest = readJsonFile<{ detail_shards?: unknown[] }>(path.join(this.config.exportDir, "manifest.json"));
    const indexedDocumentCount = writer.countActiveIndexedDocuments();
    const exportedDocumentCount = Array.isArray(manifest?.detail_shards) ? manifest.detail_shards.length : 0;
    const exportIsStale = exportedDocumentCount < indexedDocumentCount;
    if (!options.targetPath && exportIsStale) {
      const exportResult = await new ExportBuilder(this.config).build({ light: true });
      writer.setSchemaMeta(WATCHER_READY_META_KEY, new Date().toISOString());
      initialCycle.export = {
        metaShardCount: exportResult.metaShardCount,
        detailShardCount: exportResult.detailShardCount,
        tagShardCount: exportResult.tagShardCount,
        exportedAt: exportResult.exportedAt,
      };
    }

    if (!fs.existsSync(watchRoot)) {
      throw new AppError(
        `watch 目标路径不存在：${watchRoot}`,
        APP_ERROR_CODES.WATCH_PATH_NOT_FOUND,
        {
          details: {
            watchRoot,
            targetPath: options.targetPath ?? null,
          },
        },
      );
    }

    const recursive = true;
    const cycles: WatchCycleResult[] = [initialCycle];
    let cycleCount = 1;
    let eventCount = 0;
    let lastEvent: WatchRunResult["lastEvent"] = null;
    let stopped = false;
    let timeoutId: NodeJS.Timeout | null = null;
    let debounceTimer: NodeJS.Timeout | null = null;
    let pendingScope: string | undefined;

    return await new Promise<WatchRunResult>((resolve, reject) => {
      const finish = (stoppedBy: WatchRunResult["stoppedBy"]): void => {
        if (stopped) {
          return;
        }
        stopped = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        watcher.close();
        process.off("SIGINT", handleSignal);
        process.off("SIGTERM", handleSignal);
        resolve({
          mode: "watch",
          watchRoot,
          recursive,
          debounceMs,
          cycleCount,
          eventCount,
          lastEvent,
          initialCycle,
          cycles,
          stoppedBy,
        });
      };

      const handleSignal = (): void => finish("signal");

      const flush = async (): Promise<void> => {
        try {
          const cycle = pendingScope && isConfigPath(pendingScope)
            ? await this.runConfigCycleAsync()
            : await this.runCycleAsync(pendingScope ?? options.targetPath);
          cycles.push(cycle);
          cycleCount += 1;
          pendingScope = undefined;
        } catch (error) {
          reject(error);
        }
      };

      const scheduleFlush = (): void => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          void flush();
        }, debounceMs);
      };

      const watcher = fs.watch(watchRoot, { recursive }, (eventType, filename) => {
        eventCount += 1;
        const resolvedRelativePath = filename
          ? normalizeRelativePath(path.relative(this.config.rootDir, path.join(watchRoot, filename.toString())))
          : null;
        lastEvent = {
          eventType,
          relativePath: resolvedRelativePath,
        };

        if (isIgnoredWatchPath(resolvedRelativePath)) {
          return;
        }

        if (!filename) {
          pendingScope = options.targetPath;
          scheduleFlush();
          return;
        }

        const rawPath = path.join(watchRoot, filename.toString());
        const relativePath = normalizeRelativePath(path.relative(this.config.rootDir, rawPath));
        if (isConfigPath(relativePath)) {
          pendingScope = relativePath;
          scheduleFlush();
          return;
        }

        const scopeAbsolutePath = eventType === "rename" ? path.dirname(rawPath) : rawPath;
        const relativeScope = normalizeRelativePath(path.relative(this.config.rootDir, scopeAbsolutePath));
        pendingScope = !relativeScope || relativeScope === "." ? undefined : relativeScope;
        scheduleFlush();
      });

      watcher.on("error", error => reject(error));

      process.on("SIGINT", handleSignal);
      process.on("SIGTERM", handleSignal);

      if (typeof options.durationMs === "number" && options.durationMs > 0) {
        timeoutId = setTimeout(() => finish("timeout"), options.durationMs);
      }
    });
  }
}
