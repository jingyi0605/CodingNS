import crypto from "node:crypto";
import path from "node:path";
import type { ExportDocumentRecord } from "../../repositories/catalog-repository.js";
import { CatalogRepository } from "../../repositories/catalog-repository.js";

export interface DirtyScope {
  trigger: "full" | "incremental";
  changedPaths: string[];
  deletedPaths?: string[];
  dirtyDirectories: string[];
  dirtyTagPaths: string[];
  dirtyMetaShards: string[];
  dirtyDetailShards: string[];
  dirtyPostingBuckets: string[];
  dirtyRelations: string[];
}

export interface ResolveDirtyScopeInput {
  targetPath?: string;
  indexedPaths?: string[];
  skippedPaths?: string[];
  deletedPaths?: string[];
  failedPaths?: string[];
  changedDocuments?: ExportDocumentRecord[];
  triggerOverride?: "full" | "incremental";
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function stableShardId(prefix: string, value: string): string {
  const digest = crypto.createHash("sha1").update(value).digest("hex").slice(0, 12);
  return `${prefix}_${digest}`;
}

function directoryOf(filePath: string): string {
  const resolved = path.posix.dirname(filePath);
  return resolved && resolved !== "" ? resolved : ".";
}

function collectDirtyTagRoots(documents: ExportDocumentRecord[]): string[] {
  const values: string[] = [];
  for (const document of documents) {
    for (const tagPath of [...document.tags, ...document.derivedTags]) {
      values.push(tagPath);
      const parts = tagPath.split("/");
      for (let index = 1; index <= parts.length; index += 1) {
        values.push(parts.slice(0, index).join("/"));
      }
    }
  }
  return uniqueSorted(values);
}

function collectDirtyPostingBuckets(tagPaths: string[]): string[] {
  const buckets: string[] = [];
  for (const tagPath of tagPaths) {
    const rootType = tagPath.split("/")[0] || tagPath;
    buckets.push(stableShardId("posting", rootType));
  }
  return uniqueSorted(buckets);
}

/**
 * DirtyScope 解析器。
 * 第二阶段扩成正式传播规则的第一版：目录、tag ancestor、detail/meta shard、posting bucket、relation 文档集都能列清楚。
 */
export class DirtyScopeResolver {
  constructor(private readonly repository: CatalogRepository) {}

  resolve(input: ResolveDirtyScopeInput): DirtyScope {
    const indexedPaths = input.indexedPaths ?? [];
    const skippedPaths = input.skippedPaths ?? [];
    const deletedPaths = input.deletedPaths ?? [];
    const failedPaths = input.failedPaths ?? [];
    const changedPaths = uniqueSorted([...indexedPaths, ...skippedPaths, ...deletedPaths, ...failedPaths]);
    const changedDocuments = input.changedDocuments ?? this.repository.listExportDocumentsByPaths(indexedPaths);
    const dirtyDirectories = uniqueSorted(changedPaths.map(directoryOf));
    const dirtyTagPaths = collectDirtyTagRoots(changedDocuments);
    const dirtyRelations = uniqueSorted(changedDocuments.map(document => document.documentId));

    return {
      trigger: input.triggerOverride ?? (input.targetPath ? "incremental" : "full"),
      changedPaths,
      deletedPaths,
      dirtyDirectories,
      dirtyTagPaths,
      dirtyMetaShards: uniqueSorted(dirtyDirectories.map(directory => stableShardId("meta", directory))),
      dirtyDetailShards: uniqueSorted(changedPaths.map(item => stableShardId("detail", item))),
      dirtyPostingBuckets: collectDirtyPostingBuckets(dirtyTagPaths),
      dirtyRelations,
    };
  }
}
