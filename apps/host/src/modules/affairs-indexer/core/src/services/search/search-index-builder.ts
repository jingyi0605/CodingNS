import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { RuntimeConfig } from "../../../../contracts/src/index.js";
import type { DirtyScope } from "../dirty/dirty-scope-resolver.js";
import {
  CatalogRepository,
  type ExportDocumentRecord,
} from "../../repositories/catalog-repository.js";
import {
  iterateNdjsonFileSync,
} from "../../utils/file-streaming.js";
import { logAffairsIndexerRss } from "../../utils/rss-log.js";
import { throwIfAborted, yieldToEventLoop } from "../../utils/abort.js";
import { writeAffairsLibraryDebugLog } from "../../../../../workspace/affairs-library-debug-log.js";

export interface SearchIndexBuildOptions {
  dirtyScope?: DirtyScope;
  signal?: AbortSignal;
  commandName?: string;
  reason?: string;
  targetPath?: string;
}

export interface SearchIndexBuildResult {
  outputDir: string;
  bucketCount: number;
  manifestPath: string;
  filesWritten: string[];
  exportedAt: string;
}

interface SearchManifest {
  version: number;
  format: "search-v1";
  generated_at: string;
  buckets: Array<{
    bucket: string;
    path: string;
    term_count: number;
  }>;
}

interface SearchDocumentEntry {
  document_id: string;
  path: string;
  title: string;
  summary: string;
  mtime: string;
  tags: string[];
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function appendNdjson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf-8");
}

function safeUnlink(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function normalizeText(value: string): string {
  return value.toLowerCase();
}

function tokenize(value: string): string[] {
  const terms = new Set<string>();
  const normalized = normalizeText(value);
  const wordMatches = normalized.match(/[a-z0-9][a-z0-9._-]*/g) ?? [];
  for (const word of wordMatches) {
    if (word.length >= 2) {
      terms.add(word);
    }
  }

  const compact = normalized.replace(/\s+/g, "");
  const hanMatches = compact.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const block of hanMatches) {
    if (block.length <= 4) {
      terms.add(block);
      continue;
    }
    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index <= block.length - size; index += 1) {
        terms.add(block.slice(index, index + size));
      }
    }
  }

  return [...terms];
}

function buildBucketName(term: string): string {
  const first = term[0] ?? "_";
  if (/[a-z0-9]/.test(first)) {
    return first;
  }
  return "han";
}

function buildDocumentEntry(document: ExportDocumentRecord): SearchDocumentEntry {
  return {
    document_id: document.documentId,
    path: document.path,
    title: document.title,
    summary: document.summary,
    mtime: document.mtime,
    tags: [...document.tags, ...document.derivedTags],
  };
}

function mergePosting(
  termMap: Map<string, string[]>,
  term: string,
  documentId: string,
): void {
  const postings = termMap.get(term) ?? [];
  if (postings[postings.length - 1] !== documentId) {
    postings.push(documentId);
  }
  termMap.set(term, postings);
}

function writeSearchBucketFile(
  filePath: string,
  exportedAt: string,
  bucket: string,
  documents: SearchDocumentEntry[],
  terms: Array<{
    term: string;
    document_count: number;
    document_ids: string[];
  }>
): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(
    filePath,
    `{\n  "version": 1,\n  "format": "search-bucket-v1",\n  "generated_at": ${JSON.stringify(exportedAt)},\n  "bucket": ${JSON.stringify(bucket)},\n  "documents": [`,
    "utf-8"
  );
  let isFirst = true;
  for (const document of documents) {
    fs.appendFileSync(
      filePath,
      `${isFirst ? "" : ","}\n${JSON.stringify(document, null, 2)}`,
      "utf-8"
    );
    isFirst = false;
  }
  fs.appendFileSync(filePath, `${isFirst ? "" : "\n"}  ],\n  "terms": [`, "utf-8");

  isFirst = true;
  for (const term of terms) {
    fs.appendFileSync(
      filePath,
      `${isFirst ? "" : ","}\n${JSON.stringify(term, null, 2)}`,
      "utf-8"
    );
    isFirst = false;
  }
  fs.appendFileSync(filePath, `${isFirst ? "" : "\n"}  ]\n}\n`, "utf-8");
}

/**
 * 离线关键词倒排构建器。
 * 改成两阶段流式：第一阶段按 bucket 写临时 NDJSON，第二阶段逐 bucket 汇总为静态 JSON，
 * 避免把全部 documents / terms 一次性挂在内存里。
 */
export class SearchIndexBuilder {
  constructor(private readonly config: RuntimeConfig) {}

  async build(options: SearchIndexBuildOptions = {}): Promise<SearchIndexBuildResult> {
    const exportedAt = new Date().toISOString();
    const startedAt = performance.now();
    const repository = new CatalogRepository(this.config.dbPath);
    const outputDir = path.join(this.config.exportDir, "search");
    const tempDir = path.join(outputDir, ".tmp");
    ensureDir(outputDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
    ensureDir(tempDir);

    const filesWritten: string[] = [];
    const manifestBuckets: SearchManifest["buckets"] = [];
    const documentTempPaths = new Map<string, string>();
    const termTempPaths = new Map<string, string>();
    writeAffairsLibraryDebugLog({
      event: "search_build_started",
      processRole: "helper",
      rootDir: this.config.rootDir,
      command: options.commandName ?? "export",
      reason: options.reason,
      targetPath: options.targetPath,
      status: "running",
      details: {
        outputDir,
        tempDir
      }
    });

    for (const batch of repository.iterateExportDocumentRecords(2000)) {
      throwIfAborted(options.signal, "事务文档库搜索索引构建已取消");
      for (const document of batch) {
        throwIfAborted(options.signal, "事务文档库搜索索引构建已取消");
        const entry = buildDocumentEntry(document);
        const sourceText = [
          document.path,
          document.title,
          document.summary,
          ...document.tags,
          ...document.derivedTags,
        ].join("\n");
        const bucketTerms = new Map<string, string[]>();

        for (const term of tokenize(sourceText)) {
          const bucket = buildBucketName(term);
          const current = bucketTerms.get(bucket) ?? [];
          current.push(term);
          bucketTerms.set(bucket, current);
        }

        for (const [bucket, terms] of bucketTerms.entries()) {
          const documentTempPath = documentTempPaths.get(bucket) ?? path.join(tempDir, `${bucket}.documents.ndjson`);
          const termTempPath = termTempPaths.get(bucket) ?? path.join(tempDir, `${bucket}.terms.ndjson`);
          if (!documentTempPaths.has(bucket)) {
            writeAffairsLibraryDebugLog({
              event: "search_bucket_temp_prepared",
              processRole: "helper",
              rootDir: this.config.rootDir,
              command: options.commandName ?? "export",
              reason: options.reason,
              targetPath: options.targetPath,
              status: "running",
              details: {
                bucket,
                documentTempPath,
                termTempPath
              }
            });
          }
          documentTempPaths.set(bucket, documentTempPath);
          termTempPaths.set(bucket, termTempPath);
          appendNdjson(documentTempPath, entry);
          for (const term of new Set(terms)) {
            appendNdjson(termTempPath, {
              term,
              document_id: entry.document_id,
            });
          }
        }
      }
      await yieldToEventLoop(options.signal, "事务文档库搜索索引构建已取消");
    }

    for (const bucket of [...documentTempPaths.keys()].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))) {
      throwIfAborted(options.signal, "事务文档库搜索索引构建已取消");
      const documentTempPath = documentTempPaths.get(bucket)!;
      const termTempPath = termTempPaths.get(bucket)!;
      const bucketStartedAt = performance.now();
      writeAffairsLibraryDebugLog({
        event: "search_bucket_build_started",
        processRole: "helper",
        rootDir: this.config.rootDir,
        command: options.commandName ?? "export",
        reason: options.reason,
        targetPath: options.targetPath,
        status: "running",
        details: {
          bucket,
          documentTempPath,
          termTempPath
        }
      });
      const documentMap = new Map<string, SearchDocumentEntry>();
      const termMap = new Map<string, string[]>();

      iterateNdjsonFileSync<SearchDocumentEntry>(documentTempPath, (document) => {
        documentMap.set(document.document_id, document);
      });

      iterateNdjsonFileSync<{ term: string; document_id: string }>(termTempPath, (record) => {
        mergePosting(termMap, record.term, record.document_id);
      });

      const filePath = path.join(outputDir, `${bucket}.json`);
      writeSearchBucketFile(
        filePath,
        exportedAt,
        bucket,
        [...documentMap.values()].sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN")),
        [...termMap.entries()]
          .sort((a, b) => a[0].localeCompare(b[0], "zh-Hans-CN"))
          .map(([term, documentIds]) => ({
            term,
            document_count: documentIds.length,
            document_ids: documentIds,
          }))
      );
      filesWritten.push(filePath);
      manifestBuckets.push({
        bucket,
        path: `search/${bucket}.json`,
        term_count: termMap.size,
      });
      writeAffairsLibraryDebugLog({
        event: "search_bucket_build_finished",
        processRole: "helper",
        rootDir: this.config.rootDir,
        command: options.commandName ?? "export",
        reason: options.reason,
        targetPath: options.targetPath,
        status: "finished",
        durationMs: Number((performance.now() - bucketStartedAt).toFixed(2)),
        details: {
          bucket,
          filePath,
          documentCount: documentMap.size,
          termCount: termMap.size
        }
      });

      safeUnlink(documentTempPath);
      safeUnlink(termTempPath);
      writeAffairsLibraryDebugLog({
        event: "search_bucket_temp_cleaned",
        processRole: "helper",
        rootDir: this.config.rootDir,
        command: options.commandName ?? "export",
        reason: options.reason,
        targetPath: options.targetPath,
        status: "finished",
        details: {
          bucket,
          documentTempPath,
          termTempPath
        }
      });
      await yieldToEventLoop(options.signal, "事务文档库搜索索引构建已取消");
    }

    if (fs.existsSync(tempDir) && fs.readdirSync(tempDir).length === 0) {
      fs.rmdirSync(tempDir);
      writeAffairsLibraryDebugLog({
        event: "search_temp_dir_removed",
        processRole: "helper",
        rootDir: this.config.rootDir,
        command: options.commandName ?? "export",
        reason: options.reason,
        targetPath: options.targetPath,
        status: "finished",
        details: {
          tempDir
        }
      });
    }

    const manifestPath = path.join(outputDir, "manifest.json");
    writeJson(manifestPath, {
      version: 1,
      format: "search-v1",
      generated_at: exportedAt,
      buckets: manifestBuckets,
    } satisfies SearchManifest);
    filesWritten.push(manifestPath);
    logAffairsIndexerRss(this.config, "search.complete", {
      rootDir: this.config.rootDir,
      bucketCount: manifestBuckets.length,
      fileCount: filesWritten.length
    });
    writeAffairsLibraryDebugLog({
      event: "search_build_finished",
      processRole: "helper",
      rootDir: this.config.rootDir,
      command: options.commandName ?? "export",
      reason: options.reason,
      targetPath: options.targetPath,
      status: "finished",
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
      details: {
        bucketCount: manifestBuckets.length,
        fileCount: filesWritten.length,
        manifestPath
      }
    });

    return {
      outputDir,
      bucketCount: manifestBuckets.length,
      manifestPath,
      filesWritten,
      exportedAt,
    };
  }
}
