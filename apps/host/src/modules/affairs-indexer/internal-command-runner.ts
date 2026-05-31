import { performance } from "node:perf_hooks";

import { AppError } from "../../shared/errors/app-error.js";
import { AppError as IndexerAppError } from "./contracts/src/index.js";
import { loadRuntimeConfig } from "./core/src/config/load-runtime-config.js";
import { AllowedExtensionsDiffService } from "./core/src/services/indexer/allowed-extensions-diff-service.js";
import { TextIndexer } from "./core/src/services/indexer/text-indexer.js";
import { TagRecomputeService } from "./core/src/services/tagging/tag-recompute-service.js";
import { ExportBuilder } from "./core/src/services/export/export-builder.js";
import { initCatalog } from "./core/src/sqlite/init-catalog.js";
import { CatalogWriteRepository } from "./core/src/repositories/catalog-write-repository.js";
import type { DirtyScope } from "./core/src/services/dirty/dirty-scope-resolver.js";
import type { RuntimeConfig } from "./contracts/src/index.js";

export type AffairsIndexerCommandName = "apply-config" | "index" | "recompute-tags" | "export" | "watch-touch";

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
  } = {}
): Promise<AffairsIndexerCommandResult> {
  const startedAt = performance.now();
  writeAffairsIndexerHelperLog({
    phase: "start",
    command,
    rootDir,
    targetPath: options.targetPath,
    reason: options.reason
  });

  try {
    const config = createAffairsIndexerRuntimeConfig(rootDir);
    initCatalog(config);

    let message = "";
    let result: unknown;

    switch (command) {
      case "apply-config": {
        const applyResult = await new AllowedExtensionsDiffService(config).applyIfNeeded();
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
        const indexResult = await new TextIndexer(config).index(undefined, {
          collectChangedPaths: true,
          dirtyScopeTrigger: "full"
        });
        const exportResult = new ExportBuilder(config).build({ dirtyScope: indexResult.dirtyScope });
        result = {
          indexResult: {
            scannedCount: indexResult.scannedCount,
            indexedCount: indexResult.indexedCount,
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
        message = "文本文件索引和静态导出已完成。";
        break;
      }
      case "recompute-tags": {
        result = new TagRecomputeService(config).run();
        message = "标签已基于当前规则重算，未重新解析原始文件。";
        break;
      }
      case "export": {
        const exportResult = new ExportBuilder(config).build();
        result = { exportResult };
        message = "静态导出完成。";
        break;
      }
      case "watch-touch": {
        const targetPath = normalizeOptionalTargetPath(options.targetPath);
        const indexResult = await new TextIndexer(config).index(targetPath, {
          collectChangedPaths: true,
          dirtyScopeTrigger: "incremental"
        });
        const exportResult = new ExportBuilder(config).build({ dirtyScope: indexResult.dirtyScope });
        new CatalogWriteRepository(config.dbPath).setSchemaMeta(
          "watcher.last_touch",
          JSON.stringify({
            observedAt: new Date().toISOString(),
            reason: options.reason?.trim() || "watch_touch",
            targetPath: targetPath ?? null,
            dirtyScope: summarizeDirtyScope(indexResult.dirtyScope)
          })
        );
        result = {
          targetPath: targetPath ?? null,
          reason: options.reason?.trim() || "watch_touch",
          indexResult: {
            scannedCount: indexResult.scannedCount,
            indexedCount: indexResult.indexedCount,
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
        message = targetPath
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
    writeAffairsIndexerHelperLog({
      phase: "finish",
      command,
      rootDir,
      targetPath: options.targetPath,
      reason: options.reason,
      durationMs: commandResult.durationMs,
      resultSummary: summarizeCommandResult(result)
    });
    return commandResult;
  } catch (error) {
    writeAffairsIndexerHelperLog({
      phase: "error",
      command,
      rootDir,
      targetPath: options.targetPath,
      reason: options.reason,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
      error: error instanceof Error ? error.message : String(error)
    });
    throw normalizeAffairsIndexerError(error, command, rootDir);
  }
}

function createAffairsIndexerRuntimeConfig(rootDir: string): RuntimeConfig {
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
    return new AppError({
      statusCode: 500,
      errorCode: "AFFAIRS_LIBRARY_INTERNAL_INDEXER_FAILED",
      detail: error.message || "内置文档库索引器执行失败",
      data: {
        command,
        rootDir,
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
      skippedCount: indexPayload.skippedCount ?? null,
      failedCount: indexPayload.failedCount ?? null,
      deletedCount: indexPayload.deletedCount ?? null,
      dirtyScope: indexPayload.dirtyScope ?? null
    };
  }

  if ("scannedCount" in payload || "indexedCount" in payload || "failedCount" in payload) {
    return {
      scannedCount: payload.scannedCount ?? null,
      indexedCount: payload.indexedCount ?? null,
      failedCount: payload.failedCount ?? null,
      deletedCount: payload.deletedCount ?? null,
      dirtyScope: payload.dirtyScope ?? null
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

function writeAffairsIndexerHelperLog(payload: {
  phase: "start" | "finish" | "error";
  command: AffairsIndexerCommandName;
  rootDir: string;
  targetPath?: string;
  reason?: string;
  durationMs?: number;
  error?: string;
  resultSummary?: Record<string, unknown> | null;
}): void {
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
