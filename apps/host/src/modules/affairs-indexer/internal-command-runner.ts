import { performance } from "node:perf_hooks";

import { AppError } from "../../shared/errors/app-error.js";
import { AppError as IndexerAppError } from "./contracts/src/index.js";
import { loadRuntimeConfig } from "./core/src/config/load-runtime-config.js";
import { AllowedExtensionsDiffService } from "./core/src/services/indexer/allowed-extensions-diff-service.js";
import { TextIndexer } from "./core/src/services/indexer/text-indexer.js";
import { TagRecomputeService } from "./core/src/services/tagging/tag-recompute-service.js";
import { ExportBuilder } from "./core/src/services/export/export-builder.js";
import { ExportV2Builder } from "./core/src/services/export/export-v2-builder.js";
import { initCatalog } from "./core/src/sqlite/init-catalog.js";
import type { DirtyScope } from "./core/src/services/dirty/dirty-scope-resolver.js";
import type { RuntimeConfig } from "./contracts/src/index.js";

export type AffairsIndexerCommandName = "apply-config" | "index" | "recompute-tags" | "export";

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
    exportV2Dir: string;
    exportMode: RuntimeConfig["exportMode"];
    configFilePath: string | null;
  };
  result: TResult;
}

export async function runAffairsIndexerCommand(
  rootDir: string,
  command: AffairsIndexerCommandName
): Promise<AffairsIndexerCommandResult> {
  const startedAt = performance.now();

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
          exportV2Result: applyResult.exportV2Result,
          exportMode: config.exportMode,
        };
        message = applyResult.changed
          ? "配置差分已应用并完成增量导出。"
          : "配置没有产生扩展名差分，无需额外应用。";
        break;
      }
      case "index": {
        result = await new TextIndexer(config).index();
        message = "文本文件索引完成。";
        break;
      }
      case "recompute-tags": {
        result = new TagRecomputeService(config).run();
        message = "标签已基于当前规则重算，未重新解析原始文件。";
        break;
      }
      case "export": {
        const legacy = config.exportMode === "v2" ? null : new ExportBuilder(config).build();
        const v2 = config.exportMode === "legacy" ? null : new ExportV2Builder(config).build();
        result = { legacy, v2 };
        message = `静态导出完成，模式=${config.exportMode}。`;
        break;
      }
      default:
        throw new AppError({
          statusCode: 400,
          errorCode: "AFFAIRS_LIBRARY_COMMAND_UNSUPPORTED",
          detail: `不支持的文档库命令：${command}`,
        });
    }

    return {
      ok: true,
      command,
      message,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
      config: {
        rootDir: config.rootDir,
        indexDir: config.indexDir,
        dbPath: config.dbPath,
        exportDir: config.exportDir,
        exportV2Dir: config.exportV2Dir,
        exportMode: config.exportMode,
        configFilePath: config.configFilePath,
      },
      result,
    };
  } catch (error) {
    throw normalizeAffairsIndexerError(error, command, rootDir);
  }
}

function createAffairsIndexerRuntimeConfig(rootDir: string): RuntimeConfig {
  return loadRuntimeConfig(rootDir, {
    args: {
      rootDir,
      "root-dir": rootDir,
      exportMode: "v2",
      "export-mode": "v2",
    },
    env: process.env,
  });
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
