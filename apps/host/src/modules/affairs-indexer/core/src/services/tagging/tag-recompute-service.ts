import path from "node:path";
import { performance } from "node:perf_hooks";
import type { RuntimeConfig } from "../../../../contracts/src/index.js";
import { CatalogRepository } from "../../repositories/catalog-repository.js";
import { CatalogWriteRepository } from "../../repositories/catalog-write-repository.js";
import { SimpleTagInferenceEngine } from "../../tagging/simple-tag-inference.js";
import type { FileScanResult } from "../../scanner/file-scanner.js";
import type { ParsedDocument } from "../../parser/plain-text-parser.js";
import { ExportBuilder } from "../export/export-builder.js";
import type { DirtyScope } from "../dirty/dirty-scope-resolver.js";

export interface TagRecomputeResult {
  scannedCount: number;
  updatedCount: number;
  directAssignedCount: number;
  derivedAssignedCount: number;
  dirtyScope: DirtyScope;
  exportResult: {
    metaShardCount: number;
    detailShardCount: number;
    tagShardCount: number;
    exportedAt: string;
  } | null;
  timingsMs: {
    infer: number;
    write: number;
    export: number;
    total: number;
  };
}

function collectTagAncestors(tagPath: string): string[] {
  const parts = tagPath.split("/").filter(Boolean);
  const values: string[] = [];
  for (let index = 1; index <= parts.length; index += 1) {
    values.push(parts.slice(0, index).join("/"));
  }
  return values;
}

/**
 * 只重算标签，不重新解析原始文件。
 * 这里故意只使用 SQLite 里已有的路径、标题、摘要和时间元数据。
 */
export class TagRecomputeService {
  constructor(private readonly config: RuntimeConfig) {}

  run(): TagRecomputeResult {
    const startedAt = performance.now();
    const repository = new CatalogRepository(this.config.dbPath);
    const writer = new CatalogWriteRepository(this.config.dbPath);
    const tagger = new SimpleTagInferenceEngine({ tagRulesPath: this.config.tagRulesPath });
    const observedAt = new Date().toISOString();
    const dirtyTagPaths = new Set<string>();
    let scannedCount = 0;
    let updatedCount = 0;
    let directAssignedCount = 0;
    let derivedAssignedCount = 0;
    let inferMs = 0;
    let writeMs = 0;

    for (const batch of repository.iterateTagRecomputeDocuments(this.config.writeBatchSize)) {
      const writeEntries: Array<{
        documentId: string;
        tags: ReturnType<SimpleTagInferenceEngine["infer"]>["tags"];
        derivedTags: ReturnType<SimpleTagInferenceEngine["infer"]>["derivedTags"];
      }> = [];

      const inferStartedAt = performance.now();
      for (const row of batch) {
        const file: FileScanResult = {
          relativePath: row.path,
          fullPath: path.join(this.config.rootDir, row.path),
          name: path.posix.basename(row.path),
          extension: row.extension,
          size: 0,
          mtime: row.mtime,
          ctime: row.ctime,
        };
        const pathText = row.path.split(/[\/_-]/g).join("\n");
        const parsed: ParsedDocument = {
          title: row.title,
          summary: row.summary,
          text: `${row.title}\n${row.summary}\n${pathText}`,
          parser: "sqlite_metadata",
        };
        const inferred = tagger.infer(file, parsed);
        directAssignedCount += inferred.tags.length;
        derivedAssignedCount += inferred.derivedTags.length;
        inferred.tags.forEach(tag => collectTagAncestors(tag.tagPath).forEach(item => dirtyTagPaths.add(item)));
        inferred.derivedTags.forEach(tag => collectTagAncestors(tag.tagPath).forEach(item => dirtyTagPaths.add(item)));
        writeEntries.push({
          documentId: row.documentId,
          tags: inferred.tags,
          derivedTags: inferred.derivedTags,
        });
        scannedCount += 1;
      }
      inferMs += performance.now() - inferStartedAt;

      const writeStartedAt = performance.now();
      const written = writer.recomputeDocumentTags(writeEntries, observedAt);
      writeMs += performance.now() - writeStartedAt;
      updatedCount += written.updatedCount;
    }

    const dirtyScope: DirtyScope = {
      trigger: "incremental",
      changedPaths: [],
      dirtyDirectories: [],
      dirtyTagPaths: [...dirtyTagPaths],
      dirtyMetaShards: [],
      dirtyDetailShards: [],
      dirtyPostingBuckets: [],
      dirtyRelations: [],
    };

    const exportStartedAt = performance.now();
    const exportDirtyScope: DirtyScope = {
      ...dirtyScope,
      trigger: "full",
    };
    const exportResult = new ExportBuilder(this.config).build({ dirtyScope: exportDirtyScope, light: true });
    const exportMs = performance.now() - exportStartedAt;

    return {
      scannedCount,
      updatedCount,
      directAssignedCount,
      derivedAssignedCount,
      dirtyScope,
      exportResult: {
        metaShardCount: exportResult.metaShardCount,
        detailShardCount: exportResult.detailShardCount,
        tagShardCount: exportResult.tagShardCount,
        exportedAt: exportResult.exportedAt,
      },
      timingsMs: {
        infer: Number(inferMs.toFixed(2)),
        write: Number(writeMs.toFixed(2)),
        export: Number(exportMs.toFixed(2)),
        total: Number((performance.now() - startedAt).toFixed(2)),
      },
    };
  }
}
