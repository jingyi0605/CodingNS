import type { RuntimeConfig } from "../../../../contracts/src/index.js";
import type { ExportDocumentRecord } from "../../repositories/catalog-repository.js";
import { CatalogRepository } from "../../repositories/catalog-repository.js";
import { CatalogWriteRepository } from "../../repositories/catalog-write-repository.js";
import { SUPPORTED_INDEX_EXTENSION_LIST } from "../../scanner/file-scanner.js";
import { ExportBuilder } from "../export/export-builder.js";
import { DirtyScopeResolver, type DirtyScope } from "../dirty/dirty-scope-resolver.js";
import { TextIndexer } from "./text-indexer.js";

const APPLIED_ALLOWED_EXTENSIONS_META_KEY = "config.allowed_extensions.applied";

function normalizeExtensions(values: string[]): string[] {
  return [...new Set(
    values
      .map(item => item.trim().toLowerCase())
      .filter(Boolean)
      .map(item => item.startsWith(".") ? item : `.${item}`),
  )].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function subtractExtensions(base: string[], removing: string[]): string[] {
  const removed = new Set(removing);
  return base.filter(item => !removed.has(item));
}

function uniqueDocuments(documents: ExportDocumentRecord[]): ExportDocumentRecord[] {
  const map = new Map<string, ExportDocumentRecord>();
  for (const document of documents) {
    map.set(document.documentId, document);
  }
  return [...map.values()];
}

function createExportSummary(
  dirtyScope: DirtyScope,
  exportResult: Awaited<ReturnType<ExportBuilder["build"]>>,
) {
  return {
    exportResult: {
      metaShardCount: exportResult.metaShardCount,
      detailShardCount: exportResult.detailShardCount,
      tagShardCount: exportResult.tagShardCount,
      exportedAt: exportResult.exportedAt,
    },
    dirtyScope,
  };
}

async function buildConfiguredExports(
  config: RuntimeConfig,
  dirtyScope: DirtyScope,
  signal?: AbortSignal,
) {
  const exportResult = await new ExportBuilder(config).build({ dirtyScope, signal });
  return createExportSummary(dirtyScope, exportResult);
}

function createEmptyIncrementalIndexResult(dirtyScope: DirtyScope) {
  return {
    scannedCount: 0,
    indexedCount: 0,
    unchangedCount: 0,
    indexedPaths: [] as string[],
    skippedPaths: [] as string[],
    failedPaths: [] as string[],
    failedCount: 0,
    failures: [] as Array<{ path: string; errorCode: string; message: string }>,
    failureOverflowCount: 0,
    deletedCount: 0,
    deletedPaths: [] as string[],
    dirtyScope,
    timingsMs: {
      scanFs: 0,
      parse: 0,
      tagInference: 0,
      skipCatalog: 0,
      writeIndexed: 0,
      writeSkipped: 0,
      scanAndParse: 0,
      writeSuccess: 0,
      writeFailure: 0,
      scanLoop: 0,
      cleanup: 0,
      reconcile: 0,
      dirtyScope: 0,
      total: 0,
    },
    batchStats: {
      writeBatchSize: 0,
      successBatchCount: 0,
      failureBatchCount: 0,
    },
    tagStats: {
      directAssignedCount: 0,
      derivedAssignedCount: 0,
      avgDirectPerIndexedDocument: 0,
      avgDerivedPerIndexedDocument: 0,
    },
    skipStats: {
      skippedCount: 0,
      skippedByExtension: {},
      skipCatalogRecords: 0,
    },
  };
}

export interface AllowedExtensionsDiffApplyResult {
  changed: boolean;
  addedExtensions: string[];
  removedExtensions: string[];
  dirtyScope: DirtyScope;
  indexResult: ReturnType<typeof createEmptyIncrementalIndexResult>;
  exportResult: ReturnType<typeof createExportSummary>["exportResult"] | null;
}

export class AllowedExtensionsDiffService {
  constructor(private readonly config: RuntimeConfig) {}

  private resolveEffectiveAllowedExtensions(): string[] {
    return normalizeExtensions(
      this.config.allowedExtensions.length > 0
        ? this.config.allowedExtensions
        : SUPPORTED_INDEX_EXTENSION_LIST,
    );
  }

  private inferPreviouslyAppliedExtensions(repository: CatalogRepository): string[] {
    const extensions = normalizeExtensions(repository.listActiveFileExtensions());
    return extensions.length > 0 ? extensions : normalizeExtensions(SUPPORTED_INDEX_EXTENSION_LIST);
  }

  private loadPreviouslyAppliedExtensions(
    writer: CatalogWriteRepository,
    repository: CatalogRepository,
  ): string[] {
    const raw = writer.getSchemaMeta(APPLIED_ALLOWED_EXTENSIONS_META_KEY);
    if (typeof raw === "string" && raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          return normalizeExtensions(parsed.filter((item): item is string => typeof item === "string"));
        }
      } catch (_) {
        return normalizeExtensions(SUPPORTED_INDEX_EXTENSION_LIST);
      }
    }

    return this.inferPreviouslyAppliedExtensions(repository);
  }

  syncCurrentAsApplied(): void {
    const writer = new CatalogWriteRepository(this.config.dbPath);
    writer.setSchemaMeta(
      APPLIED_ALLOWED_EXTENSIONS_META_KEY,
      JSON.stringify(this.resolveEffectiveAllowedExtensions()),
    );
  }

  async applyIfNeeded(signal?: AbortSignal): Promise<AllowedExtensionsDiffApplyResult> {
    const writer = new CatalogWriteRepository(this.config.dbPath);
    const repository = new CatalogRepository(this.config.dbPath);
    const effectiveCurrent = this.resolveEffectiveAllowedExtensions();
    const previous = this.loadPreviouslyAppliedExtensions(writer, repository);
    const addedExtensions = subtractExtensions(effectiveCurrent, previous);
    const removedExtensions = subtractExtensions(previous, effectiveCurrent);

    const resolver = new DirtyScopeResolver(repository);
    const emptyDirtyScope = resolver.resolve({
      indexedPaths: [],
      skippedPaths: [],
      deletedPaths: [],
      failedPaths: [],
      changedDocuments: [],
      triggerOverride: "incremental",
    });

    if (addedExtensions.length === 0 && removedExtensions.length === 0) {
      writer.setSchemaMeta(APPLIED_ALLOWED_EXTENSIONS_META_KEY, JSON.stringify(effectiveCurrent));
      const exportSummary = await buildConfiguredExports(this.config, emptyDirtyScope, signal);
      return {
        changed: false,
        addedExtensions,
        removedExtensions,
        dirtyScope: emptyDirtyScope,
        indexResult: createEmptyIncrementalIndexResult(emptyDirtyScope),
        exportResult: exportSummary.exportResult,
      };
    }

    const addedIndexResult = addedExtensions.length > 0
      ? await new TextIndexer(this.config).index(undefined, {
        allowedExtensionsOverride: addedExtensions,
        reconcileMode: "none",
        collectChangedPaths: true,
        dirtyScopeTrigger: "incremental",
        signal,
      })
      : createEmptyIncrementalIndexResult(emptyDirtyScope);

    const deletedDocuments = removedExtensions.length > 0
      ? repository.listExportDocumentsByExtensions(removedExtensions)
      : [];
    const deletionResult = removedExtensions.length > 0
      ? writer.deleteActiveFilesByExtensions(removedExtensions)
      : { deletedCount: 0, deletedPaths: [] as string[] };

    writer.setSchemaMeta(APPLIED_ALLOWED_EXTENSIONS_META_KEY, JSON.stringify(effectiveCurrent));

    const changedDocuments = uniqueDocuments([
      ...repository.listExportDocumentsByPaths(addedIndexResult.indexedPaths),
      ...deletedDocuments,
    ]);

    const dirtyScope = resolver.resolve({
      indexedPaths: addedIndexResult.indexedPaths,
      skippedPaths: addedIndexResult.skippedPaths,
      deletedPaths: deletionResult.deletedPaths,
      failedPaths: addedIndexResult.failedPaths,
      changedDocuments,
      triggerOverride: "incremental",
    });

    const exportSummary = await buildConfiguredExports(this.config, dirtyScope, signal);

    return {
      changed: true,
      addedExtensions,
      removedExtensions,
      dirtyScope,
      indexResult: {
        ...addedIndexResult,
        deletedCount: deletionResult.deletedCount,
        deletedPaths: deletionResult.deletedPaths,
        dirtyScope,
      },
      exportResult: exportSummary.exportResult,
    };
  }
}
