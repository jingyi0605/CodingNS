import { AppError, APP_ERROR_CODES, type RuntimeConfig } from "../../../../contracts/src/index.js";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { DocumentParser } from "../../parser/document-parser.js";
import { ParserSkipRepository } from "../../parser/parser-skip-repository.js";
import { CatalogRepository } from "../../repositories/catalog-repository.js";
import {
  CatalogWriteRepository,
  type IndexedDocumentBatchEntry,
} from "../../repositories/catalog-write-repository.js";
import { FileScanner, type FileScanResult } from "../../scanner/file-scanner.js";
import { SimpleTagInferenceEngine } from "../../tagging/simple-tag-inference.js";
import type { ReconcileScope } from "../../repositories/catalog-write-repository.js";
import type { ParsedDocument } from "../../parser/plain-text-parser.js";
import type { TagAssignment } from "../../tagging/simple-tag-inference.js";
import { DirtyScopeResolver, type DirtyScope } from "../dirty/dirty-scope-resolver.js";
import { logAffairsIndexerRss } from "../../utils/rss-log.js";

export interface TextIndexResult {
  scannedCount: number;
  indexedCount: number;
  indexedPaths: string[];
  skippedPaths: string[];
  failedPaths: string[];
  failedCount: number;
  failures: Array<{
    path: string;
    errorCode: string;
    message: string;
  }>;
  failureOverflowCount: number;
  deletedCount: number;
  deletedPaths: string[];
  dirtyScope: DirtyScope;
  timingsMs: {
    scanFs: number;
    parse: number;
    tagInference: number;
    skipCatalog: number;
    writeIndexed: number;
    writeSkipped: number;
    scanAndParse: number;
    writeSuccess: number;
    writeFailure: number;
    scanLoop: number;
    cleanup: number;
    reconcile: number;
    dirtyScope: number;
    total: number;
  };
  batchStats: {
    writeBatchSize: number;
    successBatchCount: number;
    failureBatchCount: number;
  };
  tagStats: {
    directAssignedCount: number;
    derivedAssignedCount: number;
    avgDirectPerIndexedDocument: number;
    avgDerivedPerIndexedDocument: number;
  };
  skipStats: {
    skippedCount: number;
    skippedByExtension: Record<string, number>;
    skipCatalogRecords: number;
  };
}

const RSS_PROGRESS_DOCUMENT_INTERVAL = 2000;
const RSS_PROGRESS_BATCH_INTERVAL = 10;

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function resolveReconcileScope(rootDir: string, targetPath?: string): ReconcileScope {
  if (!targetPath) {
    return { kind: "all" };
  }

  const absoluteTargetPath = path.resolve(rootDir, targetPath);
  if (fs.existsSync(absoluteTargetPath)) {
    const stat = fs.statSync(absoluteTargetPath);
    const relativeTargetPath = normalizeRelativePath(path.relative(rootDir, absoluteTargetPath));
    if (stat.isFile()) {
      return { kind: "exact", value: relativeTargetPath };
    }
    return relativeTargetPath && relativeTargetPath !== "."
      ? { kind: "prefix", value: relativeTargetPath }
      : { kind: "all" };
  }

  const normalizedTargetPath = normalizeRelativePath(targetPath).replace(/\/+$/, "");
  if (!normalizedTargetPath || normalizedTargetPath === ".") {
    return { kind: "all" };
  }
  if (path.extname(normalizedTargetPath)) {
    return { kind: "exact", value: normalizedTargetPath };
  }
  return { kind: "prefix", value: normalizedTargetPath };
}

/**
 * 最小文本索引服务。
 * 第二阶段补上 Dirty Scope 计算，为 watcher 和增量 export 打地基。
 */
export class TextIndexer {
  constructor(private readonly config: RuntimeConfig) {}

  async index(
    targetPath?: string,
    options: {
      allowedExtensionsOverride?: string[];
      reconcileMode?: "scope" | "none";
      collectChangedPaths?: boolean;
      dirtyScopeTrigger?: "full" | "incremental";
    } = {},
  ): Promise<TextIndexResult> {
    const startedAt = performance.now();
    const scanner = new FileScanner(this.config.rootDir, {
      allowedExtensions: options.allowedExtensionsOverride ?? this.config.allowedExtensions,
    });
    const parser = new DocumentParser({ config: this.config });
    const tagger = new SimpleTagInferenceEngine({ tagRulesPath: this.config.tagRulesPath });
    const writer = new CatalogWriteRepository(this.config.dbPath);
    const repository = new CatalogRepository(this.config.dbPath);
    const skipRepository = new ParserSkipRepository(this.config.dbPath);
    const runObservedAt = new Date().toISOString();
    const collectChangedPaths = options.collectChangedPaths ?? Boolean(targetPath);
    const maxReportedFailures = 200;
    const indexedPaths: string[] = collectChangedPaths ? [] : [];
    const skippedPaths: string[] = collectChangedPaths ? [] : [];
    const failedPaths: string[] = collectChangedPaths ? [] : [];
    const failures: Array<{
      path: string;
      errorCode: string;
      message: string;
    }> = [];
    const successEntries: IndexedDocumentBatchEntry[] = [];
    const skippedEntries: Array<{
      file: FileScanResult;
      adapter: string;
      reasonCode: string;
      message: string;
    }> = [];
    const failureEntries: Array<{
      file: FileScanResult;
      error: Error;
    }> = [];
    let scannedCount = 0;
    let indexedCount = 0;
    let failedCount = 0;
    let failureOverflowCount = 0;
    let scanFsMs = 0;
    let parseMs = 0;
    let tagInferenceMs = 0;
    let skipCatalogMs = 0;
    let writeIndexedMs = 0;
    let writeSkippedMs = 0;
    let writeFailureMs = 0;
    let cleanupMs = 0;
    let successBatchCount = 0;
    let skipBatchCount = 0;
    let failureBatchCount = 0;
    let skippedCount = 0;
    let directAssignedCount = 0;
    let derivedAssignedCount = 0;
    const skippedByExtension = new Map<string, number>();
    const skipCatalogKeys = new Set<string>();

    const maybeLogParseProgress = (): void => {
      if (scannedCount === 0 || scannedCount % RSS_PROGRESS_DOCUMENT_INTERVAL !== 0) {
        return;
      }

      logAffairsIndexerRss("index.parse_progress", {
        rootDir: this.config.rootDir,
        scannedCount,
        indexedCount,
        skippedCount,
        failedCount,
        pendingSuccessEntries: successEntries.length,
        pendingSkippedEntries: skippedEntries.length,
        pendingFailureEntries: failureEntries.length
      });
    };

    const maybeLogWriteProgress = (kind: "success" | "skip" | "failure"): void => {
      const batchCount = successBatchCount + skipBatchCount + failureBatchCount;
      if (batchCount === 0 || batchCount % RSS_PROGRESS_BATCH_INTERVAL !== 0) {
        return;
      }

      logAffairsIndexerRss("index.write_progress", {
        rootDir: this.config.rootDir,
        kind,
        scannedCount,
        indexedCount,
        skippedCount,
        failedCount,
        successBatchCount,
        skipBatchCount,
        failureBatchCount
      });
    };

    const flushSuccess = (): void => {
      if (successEntries.length === 0) {
        return;
      }
      const t0 = performance.now();
      writer.batchUpsertDocuments(successEntries, runObservedAt);
      writeIndexedMs += performance.now() - t0;
      successBatchCount += 1;
      successEntries.length = 0;
      maybeLogWriteProgress("success");
    };

    const flushFailures = (): void => {
      if (failureEntries.length === 0) {
        return;
      }
      const t0 = performance.now();
      writer.batchUpsertParseFailures(failureEntries, runObservedAt);
      writeFailureMs += performance.now() - t0;
      failureBatchCount += 1;
      failureEntries.length = 0;
      maybeLogWriteProgress("failure");
    };

    const flushSkipped = (): void => {
      if (skippedEntries.length === 0) {
        return;
      }
      const t0 = performance.now();
      writer.batchMarkSkippedDocuments(skippedEntries, runObservedAt);
      writeSkippedMs += performance.now() - t0;
      skipBatchCount += 1;
      skippedEntries.length = 0;
      maybeLogWriteProgress("skip");
    };

    const scanStartedAt = performance.now();
    writer.beginSession();
    skipRepository.beginSession();
    try {
      const iterator = scanner.scanIterator(targetPath);
      while (true) {
        const scanT0 = performance.now();
        const next = iterator.next();
        scanFsMs += performance.now() - scanT0;
        if (next.done) {
          break;
        }
        const file = next.value;
        scannedCount += 1;
        maybeLogParseProgress();
        try {
          const parseStartedAt = performance.now();
          const parseResult = await parser.parseWithOutcome(file.fullPath);
          parseMs += performance.now() - parseStartedAt;
          if ("kind" in parseResult && parseResult.kind === "skip") {
            skippedCount += 1;
            skippedByExtension.set(file.extension, (skippedByExtension.get(file.extension) ?? 0) + 1);
            if (collectChangedPaths) {
              skippedPaths.push(file.relativePath);
            }
            skippedEntries.push({
              file,
              adapter: parseResult.adapter,
              reasonCode: parseResult.reasonCode,
              message: parseResult.message,
            });
            const skipCatalogStartedAt = performance.now();
            const skipRecord = skipRepository.record({
              adapter: parseResult.adapter,
              reasonCode: parseResult.reasonCode,
              extension: parseResult.extension,
              path: file.relativePath,
              message: parseResult.message,
              observedAt: runObservedAt,
            });
            skipCatalogMs += performance.now() - skipCatalogStartedAt;
            skipCatalogKeys.add(skipRecord.skipKey);
            if (skippedEntries.length >= this.config.writeBatchSize) {
              flushSkipped();
            }
            continue;
          }
          const parsed = parseResult as ParsedDocument;
          const inferStartedAt = performance.now();
          const inferred = tagger.infer(file, parsed);
          tagInferenceMs += performance.now() - inferStartedAt;
          directAssignedCount += inferred.tags.length;
          derivedAssignedCount += inferred.derivedTags.length;
          successEntries.push({
            file,
            document: {
              title: parsed.title,
              summary: parsed.summary,
            },
            tags: inferred.tags,
            derivedTags: inferred.derivedTags,
          });
          indexedCount += 1;
          if (collectChangedPaths) {
            indexedPaths.push(file.relativePath);
          }
          if (successEntries.length >= this.config.writeBatchSize) {
            flushSuccess();
          }
        } catch (error) {
          const appError = error instanceof AppError
            ? error
            : new AppError(
              error instanceof Error ? error.message : "未知解析错误",
              APP_ERROR_CODES.PARSER_UNKNOWN_ERROR,
              {
                details: {
                  path: file.relativePath,
                },
                cause: error,
              },
            );
          failureEntries.push({
            file,
            error: appError,
          });
          failedCount += 1;
          if (collectChangedPaths) {
            failedPaths.push(file.relativePath);
          }
          if (failures.length < maxReportedFailures) {
            failures.push({
              path: file.relativePath,
              errorCode: appError.errorCode,
              message: appError.message,
            });
          } else {
            failureOverflowCount += 1;
          }
          if (failureEntries.length >= this.config.writeBatchSize) {
            flushFailures();
          }
        }
      }
      flushSuccess();
      flushSkipped();
      flushFailures();
    } finally {
      skipRepository.endSession();
      writer.endSession();
    }
    cleanupMs = 0;
    const scanAndParseMs = performance.now() - scanStartedAt;
    logAffairsIndexerRss("index.parse_complete", {
      rootDir: this.config.rootDir,
      scannedCount,
      indexedCount,
      skippedCount,
      failedCount,
      successBatchCount,
      skipBatchCount,
      failureBatchCount
    });

    let reconcile = { deletedCount: 0, deletedPaths: [] as string[] };
    let reconcileMs = 0;
    if ((options.reconcileMode ?? "scope") !== "none") {
      const reconcileStartedAt = performance.now();
      reconcile = writer.reconcileScope(
        resolveReconcileScope(this.config.rootDir, targetPath),
        runObservedAt,
      );
      reconcileMs = performance.now() - reconcileStartedAt;
    }

    const dirtyScopeStartedAt = performance.now();
    const dirtyScope = new DirtyScopeResolver(repository).resolve({
      targetPath,
      indexedPaths: collectChangedPaths ? indexedPaths : [],
      skippedPaths: collectChangedPaths ? skippedPaths : [],
      deletedPaths: reconcile.deletedPaths,
      failedPaths: collectChangedPaths ? failedPaths : [],
      triggerOverride: options.dirtyScopeTrigger,
    });
    const dirtyScopeMs = performance.now() - dirtyScopeStartedAt;
    const scanLoopMs = performance.now() - scanStartedAt - cleanupMs - reconcileMs - dirtyScopeMs;
    const writeSuccessMs = writeIndexedMs + writeSkippedMs;
    logAffairsIndexerRss("index.write_complete", {
      rootDir: this.config.rootDir,
      scannedCount,
      indexedCount,
      skippedCount,
      failedCount,
      deletedCount: reconcile.deletedCount,
      successBatchCount,
      skipBatchCount,
      failureBatchCount
    });

    return {
      scannedCount,
      indexedCount: collectChangedPaths ? indexedPaths.length : indexedCount,
      indexedPaths: collectChangedPaths ? indexedPaths : [],
      skippedPaths: collectChangedPaths ? skippedPaths : [],
      failedPaths: collectChangedPaths ? failedPaths : [],
      failedCount,
      failures,
      failureOverflowCount,
      deletedCount: reconcile.deletedCount,
      deletedPaths: reconcile.deletedPaths,
      dirtyScope,
      timingsMs: {
        scanFs: Number(scanFsMs.toFixed(2)),
        parse: Number(parseMs.toFixed(2)),
        tagInference: Number(tagInferenceMs.toFixed(2)),
        skipCatalog: Number(skipCatalogMs.toFixed(2)),
        writeIndexed: Number(writeIndexedMs.toFixed(2)),
        writeSkipped: Number(writeSkippedMs.toFixed(2)),
        scanAndParse: Number(scanAndParseMs.toFixed(2)),
        writeSuccess: Number(writeSuccessMs.toFixed(2)),
        writeFailure: Number(writeFailureMs.toFixed(2)),
        scanLoop: Number(scanLoopMs.toFixed(2)),
        cleanup: Number(cleanupMs.toFixed(2)),
        reconcile: Number(reconcileMs.toFixed(2)),
        dirtyScope: Number(dirtyScopeMs.toFixed(2)),
        total: Number((performance.now() - startedAt).toFixed(2)),
      },
      batchStats: {
        writeBatchSize: this.config.writeBatchSize,
        successBatchCount: successBatchCount + skipBatchCount,
        failureBatchCount,
      },
      tagStats: {
        directAssignedCount,
        derivedAssignedCount,
        avgDirectPerIndexedDocument: Number((indexedCount > 0 ? directAssignedCount / indexedCount : 0).toFixed(2)),
        avgDerivedPerIndexedDocument: Number((indexedCount > 0 ? derivedAssignedCount / indexedCount : 0).toFixed(2)),
      },
      skipStats: {
        skippedCount,
        skippedByExtension: Object.fromEntries(
          [...skippedByExtension.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh-Hans-CN")),
        ),
        skipCatalogRecords: skipCatalogKeys.size,
      },
    };
  }
}
