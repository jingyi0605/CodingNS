import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { AppError } from "../../shared/errors/app-error.js";
import { AppError as IndexerAppError } from "./contracts/src/index.js";
import { loadRuntimeConfig } from "./core/src/config/load-runtime-config.js";
import { AllowedExtensionsDiffService } from "./core/src/services/indexer/allowed-extensions-diff-service.js";
import { TextIndexer } from "./core/src/services/indexer/text-indexer.js";
import { ExportBuilder } from "./core/src/services/export/export-builder.js";
import { initCatalog } from "./core/src/sqlite/init-catalog.js";
import { CatalogWriteRepository } from "./core/src/repositories/catalog-write-repository.js";
import { CatalogRepository } from "./core/src/repositories/catalog-repository.js";
import { acquireAffairsIndexerRootLock } from "./core/src/utils/root-command-lock.js";
import type { DirtyScope } from "./core/src/services/dirty/dirty-scope-resolver.js";
import type { ExportBuildStage } from "./core/src/services/export/export-builder.js";
import type { RuntimeConfig } from "./contracts/src/index.js";
import { writeAffairsLibraryDebugLog } from "../workspace/affairs-library-debug-log.js";
import type { TextIndexProgress, TextIndexResult } from "./core/src/services/indexer/text-indexer.js";

export type AffairsIndexerCommandName = "apply-config" | "index" | "export" | "watch-touch";
export type AffairsIndexerRuntimeStage =
  | "init"
  | "index"
  | "export"
  | "export_meta_detail"
  | "export_tag"
  | "export_relation"
  | "export_search"
  | "sqlite"
  | "finished"
  | "failed";

interface AffairsIndexerTaskMeta {
  taskId?: string;
  taskType?: string;
  key?: string;
  attempt?: number;
}

interface RuntimeProgressPayload extends TextIndexProgress {}

interface AffairsIndexerRootLockHandle {
  release(): void;
}

const DEFAULT_RUNTIME_HEARTBEAT_MS = 3_000;
const DEFAULT_RUNTIME_PROGRESS_FLUSH_INTERVAL_MS = 1_500;
const DEFAULT_RUNTIME_PROGRESS_FLUSH_SCANNED_DELTA = 500;
const DEFAULT_RUNTIME_PROGRESS_FLUSH_RESULT_DELTA = 100;

export interface AffairsIndexerCommandResult<TResult = unknown> {
  ok: true;
  command: AffairsIndexerCommandName;
  message: string;
  durationMs: number;
  config: {
    rootDir: string;
    indexDir: string;
    dbPath: string;
    exportDir: string;
    configFilePath: string | null;
  };
  result: TResult;
}

export async function runAffairsIndexerCommand(
  rootDir: string,
  command: AffairsIndexerCommandName,
  options: {
    targetPath?: string;
    reason?: string;
    taskMeta?: AffairsIndexerTaskMeta;
    signal?: AbortSignal;
  } = {}
): Promise<AffairsIndexerCommandResult> {
  const startedAt = performance.now();
  const runtimeStageWriter = createRuntimeStageWriter(rootDir, command, options);
  let config: RuntimeConfig | null = null;
  let rootLock: AffairsIndexerRootLockHandle | null = null;

  try {
    config = createAffairsIndexerRuntimeConfig(rootDir);
    writeAffairsIndexerHelperLog(
      {
        phase: "start",
        command,
        rootDir,
        targetPath: options.targetPath,
        reason: options.reason
      },
      config.logLevel
    );
    rootLock = await acquireAffairsIndexerRootLock(rootDir, command, {
      signal: options.signal,
      reason: options.reason,
      targetPath: options.targetPath,
      taskId: options.taskMeta?.taskId,
      taskType: options.taskMeta?.taskType,
    });
    runtimeStageWriter.write("running", "init");
    runtimeStageWriter.startHeartbeat();
    initCatalog(config);
    writeAffairsLibraryDebugLog({
      event: "helper_command_started",
      processRole: "helper",
      rootDir,
      command,
      reason: options.reason,
      targetPath: options.targetPath,
      status: "started",
      details: {
        indexDir: config.indexDir,
        dbPath: config.dbPath,
        exportDir: config.exportDir,
        configFilePath: config.configFilePath
      }
    });

    let message = "";
    let result: unknown;

    switch (command) {
      case "apply-config": {
        runtimeStageWriter.write("running", "index");
        const applyResult = await new AllowedExtensionsDiffService(config).applyIfNeeded(options.signal);
        result = {
          changed: applyResult.changed,
          addedExtensions: applyResult.addedExtensions,
          removedExtensions: applyResult.removedExtensions,
          dirtyScope: summarizeDirtyScope(applyResult.dirtyScope),
          indexResult: {
            scannedCount: applyResult.indexResult.scannedCount,
            indexedCount: applyResult.indexResult.indexedCount,
            skippedCount: applyResult.indexResult.skipStats.skippedCount,
            failedCount: applyResult.indexResult.failedCount,
            deletedCount: applyResult.indexResult.deletedCount,
            indexedPathsSample: applyResult.indexResult.indexedPaths.slice(0, 20),
            deletedPathsSample: applyResult.indexResult.deletedPaths.slice(0, 20),
            failedPathsSample: applyResult.indexResult.failedPaths.slice(0, 20),
          },
          exportResult: applyResult.exportResult,
        };
        message = applyResult.changed
          ? "配置差分已应用并完成增量导出。"
          : "配置没有产生扩展名差分，无需额外应用。";
        break;
      }
      case "index": {
        runtimeStageWriter.write("running", "index");
        const indexer = new TextIndexer(config);
        const indexResult = await indexer.index(undefined, {
          collectChangedPaths: true,
          dirtyScopeTrigger: "full",
          signal: options.signal,
          onProgress: (progress) => runtimeStageWriter.setProgress(progress),
        });
        let exportResult: Awaited<ReturnType<ExportBuilder["build"]>> | null = null;
        const exportSkipped = shouldSkipExportAfterIndex(indexResult);
        if (exportSkipped) {
          writeAffairsLibraryDebugLog({
            event: "index_export_skipped_no_changes",
            processRole: "helper",
            rootDir,
            command,
            reason: options.reason,
            targetPath: options.targetPath,
            status: "finished",
            resultSummary: summarizeDirtyScope(indexResult.dirtyScope),
            details: {
              scannedCount: indexResult.scannedCount,
              indexedCount: indexResult.indexedCount,
              unchangedCount: indexResult.unchangedCount,
              skippedCount: indexResult.skipStats.skippedCount,
              failedCount: indexResult.failedCount,
              deletedCount: indexResult.deletedCount
            }
          });
        } else {
          runtimeStageWriter.write("running", "export");
          exportResult = await new ExportBuilder(config).build({
            dirtyScope: indexResult.dirtyScope,
            signal: options.signal,
            onStageChange: (stage) => runtimeStageWriter.write("running", stage),
            commandName: command,
            reason: options.reason,
            targetPath: options.targetPath
          });
        }
        runtimeStageWriter.write("running", "sqlite");
        writeIndexerCommandMeta(config, command, options);
        result = {
          indexResult: {
            scannedCount: indexResult.scannedCount,
            indexedCount: indexResult.indexedCount,
            unchangedCount: indexResult.unchangedCount,
            skippedCount: indexResult.skipStats.skippedCount,
            failedCount: indexResult.failedCount,
            deletedCount: indexResult.deletedCount,
            indexedPathsSample: indexResult.indexedPaths.slice(0, 20),
            deletedPathsSample: indexResult.deletedPaths.slice(0, 20),
            failedPathsSample: indexResult.failedPaths.slice(0, 20),
            dirtyScope: summarizeDirtyScope(indexResult.dirtyScope)
          },
          exportSkipped,
          exportResult
        };
        message = exportSkipped
          ? "文本文件索引已完成，本轮没有变化，沿用现有导出结果。"
          : "文本文件索引和静态导出已完成。";
        break;
      }
      case "export": {
        runtimeStageWriter.write("running", "export");
        const exportResult = await new ExportBuilder(config).build({
          signal: options.signal,
          onStageChange: (stage) => runtimeStageWriter.write("running", stage),
          commandName: command,
          reason: options.reason,
          targetPath: options.targetPath
        });
        result = { exportResult };
        message = "静态导出完成。";
        break;
      }
      case "watch-touch": {
        const targetPath = normalizeOptionalTargetPath(options.targetPath);
        runtimeStageWriter.write("running", "index");
        const indexer = new TextIndexer(config);
        const indexResult = await indexer.index(targetPath, {
          collectChangedPaths: true,
          dirtyScopeTrigger: "incremental",
          signal: options.signal,
          onProgress: (progress) => runtimeStageWriter.setProgress(progress),
        });
        let exportResult: Awaited<ReturnType<ExportBuilder["build"]>> | null = null;
        const exportSkipped = shouldSkipExportAfterIndex(indexResult);
        if (exportSkipped) {
          writeAffairsLibraryDebugLog({
            event: "watch_touch_export_skipped_no_changes",
            processRole: "helper",
            rootDir,
            command,
            reason: options.reason,
            targetPath: options.targetPath,
            status: "finished",
            resultSummary: summarizeDirtyScope(indexResult.dirtyScope),
            details: {
              scannedCount: indexResult.scannedCount,
              indexedCount: indexResult.indexedCount,
              unchangedCount: indexResult.unchangedCount,
              skippedCount: indexResult.skipStats.skippedCount,
              failedCount: indexResult.failedCount,
              deletedCount: indexResult.deletedCount
            }
          });
        } else {
          runtimeStageWriter.write("running", "export");
          exportResult = await new ExportBuilder(config).build({
            dirtyScope: indexResult.dirtyScope,
            signal: options.signal,
            onStageChange: (stage) => runtimeStageWriter.write("running", stage),
            commandName: command,
            reason: options.reason,
            targetPath: options.targetPath
          });
        }
        runtimeStageWriter.write("running", "sqlite");
        new CatalogWriteRepository(config.dbPath).setSchemaMeta(
          "watcher.last_touch",
          JSON.stringify({
            observedAt: new Date().toISOString(),
            reason: options.reason?.trim() || "watch_touch",
            targetPath: targetPath ?? null,
            dirtyScope: summarizeDirtyScope(indexResult.dirtyScope)
          })
        );
        writeIndexerCommandMeta(config, command, options);
        result = {
          targetPath: targetPath ?? null,
          reason: options.reason?.trim() || "watch_touch",
          exportSkipped,
          indexResult: {
            scannedCount: indexResult.scannedCount,
            indexedCount: indexResult.indexedCount,
            unchangedCount: indexResult.unchangedCount,
            skippedCount: indexResult.skipStats.skippedCount,
            failedCount: indexResult.failedCount,
            deletedCount: indexResult.deletedCount,
            indexedPathsSample: indexResult.indexedPaths.slice(0, 20),
            deletedPathsSample: indexResult.deletedPaths.slice(0, 20),
            failedPathsSample: indexResult.failedPaths.slice(0, 20),
            dirtyScope: summarizeDirtyScope(indexResult.dirtyScope)
          },
          exportResult
        };
        message = exportSkipped
          ? targetPath
            ? `检测到文件检查完成，本轮没有变化，沿用现有导出结果：${targetPath}`
            : "检测到文件检查完成，本轮没有变化，沿用现有导出结果。"
          : targetPath
            ? `检测到文件变动，已按范围增量刷新：${targetPath}`
            : "检测到文件变动，已执行一次全库增量刷新。";
        break;
      }
      default:
        throw new AppError({
          statusCode: 400,
          errorCode: "AFFAIRS_LIBRARY_COMMAND_UNSUPPORTED",
          detail: `不支持的文档库命令：${command}`,
        });
    }

    const commandResult: AffairsIndexerCommandResult = {
      ok: true,
      command,
      message,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
      config: {
        rootDir: config.rootDir,
        indexDir: config.indexDir,
        dbPath: config.dbPath,
        exportDir: config.exportDir,
        configFilePath: config.configFilePath,
      },
      result,
    };
    runtimeStageWriter.stopHeartbeat();
    runtimeStageWriter.write("finished", "finished");
    writeAffairsIndexerHelperLog(
      {
        phase: "finish",
        command,
        rootDir,
        targetPath: options.targetPath,
        reason: options.reason,
        durationMs: commandResult.durationMs,
        resultSummary: summarizeCommandResult(result)
      },
      config.logLevel
    );
    writeAffairsLibraryDebugLog({
      event: "helper_command_finished",
      processRole: "helper",
      rootDir,
      command,
      reason: options.reason,
      targetPath: options.targetPath,
      durationMs: commandResult.durationMs,
      status: "finished",
      resultSummary: summarizeCommandResult(result)
    });
    rootLock.release();
    rootLock = null;
    return commandResult;
  } catch (error) {
    rootLock?.release();
    rootLock = null;
    runtimeStageWriter.stopHeartbeat();
    runtimeStageWriter.write(
      "failed",
      "failed",
      error instanceof Error ? error.message : String(error)
    );
    writeAffairsIndexerHelperLog(
      {
        phase: "error",
        command,
        rootDir,
        targetPath: options.targetPath,
        reason: options.reason,
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
        error: error instanceof Error ? error.message : String(error)
      },
      config?.logLevel ?? null
    );
    writeAffairsLibraryDebugLog({
      event: "helper_command_failed",
      processRole: "helper",
      rootDir,
      command,
      reason: options.reason,
      targetPath: options.targetPath,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
      status: "failed",
      message: error instanceof Error ? error.message : String(error)
    });
    throw normalizeAffairsIndexerError(error, command, rootDir);
  }
}

export function createAffairsIndexerRuntimeConfig(rootDir: string): RuntimeConfig {
  return loadRuntimeConfig(rootDir, {
    args: {
      rootDir,
      "root-dir": rootDir,
    },
    env: process.env,
  });
}

function normalizeOptionalTargetPath(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized.replace(/^\.\//, "") : undefined;
}

function collectIndexerFailureDetails(rootDir: string): {
  tagCount: number;
  documentTagCount: number;
  derivedTagCount: number;
} | null {
  try {
    const config = createAffairsIndexerRuntimeConfig(rootDir);
    const repository = new CatalogWriteRepository(config.dbPath);
    return {
      tagCount: new CatalogRepository(config.dbPath).listTagDefinitions(true).length,
      documentTagCount: repository.countRows("document_tags"),
      derivedTagCount: repository.countRows("derived_document_tags"),
    };
  } catch {
    return null;
  }
}

function summarizeDirtyScope(
  dirtyScope: DirtyScope | null
): {
  trigger: string;
  changedPaths: number;
  dirtyDirectories: number;
  dirtyTagPaths: number;
  dirtyRelations: number;
} | null {
  if (!dirtyScope) {
    return null;
  }

  return {
    trigger: dirtyScope.trigger,
    changedPaths: dirtyScope.changedPaths.length,
    dirtyDirectories: dirtyScope.dirtyDirectories.length,
    dirtyTagPaths: dirtyScope.dirtyTagPaths.length,
    dirtyRelations: dirtyScope.dirtyRelations.length,
  };
}

function shouldSkipExportAfterIndex(indexResult: TextIndexResult): boolean {
  if (indexResult.indexedCount !== 0) {
    return false;
  }
  if (indexResult.failedCount !== 0) {
    return false;
  }
  if (indexResult.deletedCount !== 0) {
    return false;
  }
  if (indexResult.skipStats.skippedCount !== 0) {
    return false;
  }
  const dirtyScope = indexResult.dirtyScope;
  if (!dirtyScope) {
    return true;
  }
  return dirtyScope.changedPaths.length === 0
    && dirtyScope.dirtyDirectories.length === 0
    && dirtyScope.dirtyTagPaths.length === 0
    && dirtyScope.dirtyRelations.length === 0;
}

function writeIndexerCommandMeta(
  config: RuntimeConfig,
  command: AffairsIndexerCommandName,
  options: {
    targetPath?: string;
    reason?: string;
    taskMeta?: AffairsIndexerTaskMeta;
  }
): void {
  new CatalogWriteRepository(config.dbPath).setSchemaMeta(
    "runtime.last_command",
    JSON.stringify({
      command,
      observedAt: new Date().toISOString(),
      reason: options.reason?.trim() || null,
      targetPath: normalizeOptionalTargetPath(options.targetPath) ?? null,
      taskId: options.taskMeta?.taskId ?? null,
      taskType: options.taskMeta?.taskType ?? null
    })
  );
}

function createRuntimeStageWriter(
  rootDir: string,
  command: AffairsIndexerCommandName,
  options: {
    targetPath?: string;
    reason?: string;
    taskMeta?: AffairsIndexerTaskMeta;
  }
) {
  const runtimeStatusPath = path.join(rootDir, ".ai-index", "runtime-status.json");
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let currentStatus: "running" | "finished" | "failed" = "running";
  let currentStage: AffairsIndexerRuntimeStage = "init";
  let currentErrorSummary: string | null = null;
  let currentProgress: RuntimeProgressPayload | null = null;
  let lastProgressFlushAtMs = 0;
  let lastFlushedProgress: RuntimeProgressPayload | null = null;

  const captureFlushedProgressSnapshot = (flushedAtMs: number): void => {
    lastProgressFlushAtMs = flushedAtMs;
    lastFlushedProgress = currentProgress ? { ...currentProgress } : null;
  };

  const flush = () => {
    const flushedAtMs = Date.now();
    fs.mkdirSync(path.dirname(runtimeStatusPath), { recursive: true });
    fs.writeFileSync(
      runtimeStatusPath,
      `${JSON.stringify({
        version: 1,
        command,
        status: currentStatus,
        stage: currentStage,
        updatedAt: new Date().toISOString(),
        reason: options.reason?.trim() || null,
        targetPath: normalizeOptionalTargetPath(options.targetPath) ?? null,
        taskId: options.taskMeta?.taskId ?? null,
        taskType: options.taskMeta?.taskType ?? null,
        taskKey: options.taskMeta?.key ?? null,
        attempt: options.taskMeta?.attempt ?? null,
        errorSummary: currentErrorSummary,
        progress: currentProgress
      }, null, 2)}\n`,
      "utf8"
    );
    captureFlushedProgressSnapshot(flushedAtMs);
  };

  return {
    write: (
      status: "running" | "finished" | "failed",
      stage: AffairsIndexerRuntimeStage,
      errorSummary: string | null = null
    ) => {
      currentStatus = status;
      currentStage = stage;
      currentErrorSummary = errorSummary;
      flush();
    },
    setProgress: (progress: RuntimeProgressPayload | null) => {
      currentProgress = progress;
      if (shouldFlushRuntimeProgress(progress, lastFlushedProgress, lastProgressFlushAtMs, Date.now())) {
        flush();
      }
    },
    startHeartbeat: () => {
      if (heartbeatTimer) {
        return;
      }
      heartbeatTimer = setInterval(() => {
        if (currentStatus === "running") {
          flush();
        }
      }, resolveRuntimeHeartbeatIntervalMs());
      heartbeatTimer.unref?.();
    },
    stopHeartbeat: () => {
      if (!heartbeatTimer) {
        return;
      }
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };
}

function shouldFlushRuntimeProgress(
  next: RuntimeProgressPayload | null,
  previous: RuntimeProgressPayload | null,
  lastFlushAtMs: number,
  nowMs: number
): boolean {
  if (!next) {
    return true;
  }
  if (!previous) {
    return true;
  }
  if (nowMs - lastFlushAtMs >= resolveRuntimeProgressFlushIntervalMs()) {
    return true;
  }
  if (next.scannedCount - previous.scannedCount >= resolveRuntimeProgressFlushScannedDelta()) {
    return true;
  }
  if (
    hasRuntimeProgressResultDelta(next, previous, resolveRuntimeProgressFlushResultDelta())
    || next.totalCount !== previous.totalCount
    || next.maxConcurrency !== previous.maxConcurrency
  ) {
    return true;
  }
  return false;
}

function hasRuntimeProgressResultDelta(
  next: RuntimeProgressPayload,
  previous: RuntimeProgressPayload,
  threshold: number
): boolean {
  return Math.abs(next.indexedCount - previous.indexedCount) >= threshold
    || Math.abs(next.skippedCount - previous.skippedCount) >= threshold
    || Math.abs(next.failedCount - previous.failedCount) >= threshold
    || Math.abs(next.unchangedCount - previous.unchangedCount) >= threshold;
}

function resolveRuntimeHeartbeatIntervalMs(): number {
  const raw = process.env.CODINGNS_AFFAIRS_RUNTIME_HEARTBEAT_MS?.trim();
  if (!raw) {
    return DEFAULT_RUNTIME_HEARTBEAT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_RUNTIME_HEARTBEAT_MS;
  }
  return Math.max(100, Math.floor(parsed));
}

function resolveRuntimeProgressFlushIntervalMs(): number {
  return resolvePositiveIntegerEnv(
    process.env.CODINGNS_AFFAIRS_RUNTIME_PROGRESS_FLUSH_MS,
    DEFAULT_RUNTIME_PROGRESS_FLUSH_INTERVAL_MS,
    100
  );
}

function resolveRuntimeProgressFlushScannedDelta(): number {
  return resolvePositiveIntegerEnv(
    process.env.CODINGNS_AFFAIRS_RUNTIME_PROGRESS_FLUSH_SCANNED_DELTA,
    DEFAULT_RUNTIME_PROGRESS_FLUSH_SCANNED_DELTA,
    1
  );
}

function resolveRuntimeProgressFlushResultDelta(): number {
  return resolvePositiveIntegerEnv(
    process.env.CODINGNS_AFFAIRS_RUNTIME_PROGRESS_FLUSH_RESULT_DELTA,
    DEFAULT_RUNTIME_PROGRESS_FLUSH_RESULT_DELTA,
    1
  );
}

function resolvePositiveIntegerEnv(
  rawValue: string | undefined,
  fallback: number,
  minimum: number
): number {
  const raw = rawValue?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(minimum, Math.floor(parsed));
}

function normalizeAffairsIndexerError(
  error: unknown,
  command: AffairsIndexerCommandName,
  rootDir: string
): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof IndexerAppError) {
    return new AppError({
      statusCode: resolveIndexerStatusCode(error.errorCode),
      errorCode: `AFFAIRS_LIBRARY_${error.errorCode}`,
      detail: error.message,
      data: {
        command,
        rootDir,
        ...(error.details ? { details: error.details } : {}),
      },
    });
  }

  if (error instanceof Error) {
    const details = collectIndexerFailureDetails(rootDir);
    return new AppError({
      statusCode: 500,
      errorCode: "AFFAIRS_LIBRARY_INTERNAL_INDEXER_FAILED",
      detail: error.message || "内置文档库索引器执行失败",
      data: {
        command,
        rootDir,
        ...(details ? { details } : {}),
      },
    });
  }

  return new AppError({
    statusCode: 500,
    errorCode: "AFFAIRS_LIBRARY_INTERNAL_INDEXER_FAILED",
    detail: "内置文档库索引器执行失败",
    data: {
      command,
      rootDir,
    },
  });
}

function resolveIndexerStatusCode(errorCode: string): number {
  switch (errorCode) {
    case "CONFIG_FILE_NOT_FOUND":
    case "CONFIG_FILE_INVALID":
    case "CONFIG_INVALID_VALUE":
    case "COMMAND_NOT_SUPPORTED":
    case "SEARCH_QUERY_REQUIRED":
    case "CONTEXT_TARGET_REQUIRED":
    case "PARSER_ROUTE_UNSUPPORTED":
    case "PARSER_ADAPTER_UNAVAILABLE":
    case "WATCH_PATH_NOT_FOUND":
    case "SEARCH_INDEX_INVALID":
    case "EXPORT_INVALID_PAYLOAD":
    case "MCP_INVALID_REQUEST":
      return 400;
    default:
      return 500;
  }
}

function summarizeCommandResult(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  const payload = result as Record<string, unknown>;
  const indexResult = payload.indexResult;
  if (indexResult && typeof indexResult === "object") {
    const indexPayload = indexResult as Record<string, unknown>;
    return {
      scannedCount: indexPayload.scannedCount ?? null,
      indexedCount: indexPayload.indexedCount ?? null,
      unchangedCount: indexPayload.unchangedCount ?? null,
      skippedCount: indexPayload.skippedCount ?? null,
      failedCount: indexPayload.failedCount ?? null,
      deletedCount: indexPayload.deletedCount ?? null,
      dirtyScope: indexPayload.dirtyScope ?? null,
      indexedPathsSample: indexPayload.indexedPathsSample ?? null,
      deletedPathsSample: indexPayload.deletedPathsSample ?? null,
      failedPathsSample: indexPayload.failedPathsSample ?? null
    };
  }

  if ("scannedCount" in payload || "indexedCount" in payload || "failedCount" in payload) {
    return {
      scannedCount: payload.scannedCount ?? null,
      indexedCount: payload.indexedCount ?? null,
      unchangedCount: payload.unchangedCount ?? null,
      failedCount: payload.failedCount ?? null,
      deletedCount: payload.deletedCount ?? null,
      dirtyScope: payload.dirtyScope ?? null,
      indexedPathsSample: payload.indexedPathsSample ?? null,
      deletedPathsSample: payload.deletedPathsSample ?? null,
      failedPathsSample: payload.failedPathsSample ?? null
    };
  }

  if ("changed" in payload || "addedExtensions" in payload || "removedExtensions" in payload) {
    return {
      changed: payload.changed ?? null,
      addedExtensions: payload.addedExtensions ?? null,
      removedExtensions: payload.removedExtensions ?? null
    };
  }

  if ("documentCount" in payload || "exportedAt" in payload) {
    return {
      documentCount: payload.documentCount ?? null,
      exportedAt: payload.exportedAt ?? null
    };
  }

  return null;
}

function writeAffairsIndexerHelperLog(
  payload: {
    phase: "start" | "finish" | "error";
    command: AffairsIndexerCommandName;
    rootDir: string;
    targetPath?: string;
    reason?: string;
    durationMs?: number;
    error?: string;
    resultSummary?: Record<string, unknown> | null;
  },
  logLevel: RuntimeConfig["logLevel"] | null
): void {
  if (!shouldWriteAffairsIndexerStructuredDebugLog(logLevel)) {
    return;
  }

  try {
    const rssBytes = process.memoryUsage.rss();
    console.error(
      JSON.stringify({
        source: "affairs_library.helper",
        ...payload,
        targetPath: payload.targetPath ?? null,
        reason: payload.reason ?? null,
        durationMs: payload.durationMs ?? null,
        error: payload.error ?? null,
        resultSummary: payload.resultSummary ?? null,
        rssBytes,
        rssMb: Number((rssBytes / 1024 / 1024).toFixed(2))
      })
    );
  } catch {
    // 结构化日志写失败不影响主流程。
  }
}

function shouldWriteAffairsIndexerStructuredDebugLog(
  logLevel: RuntimeConfig["logLevel"] | null
): boolean {
  return logLevel === "debug" || process.env.DOC_SEMANTIC_INDEX_LOG_LEVEL?.trim() === "debug";
}
