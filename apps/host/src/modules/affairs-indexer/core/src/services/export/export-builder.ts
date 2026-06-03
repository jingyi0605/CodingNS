import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { RuntimeConfig } from "../../../../contracts/src/index.js";
import type { DirtyScope } from "../dirty/dirty-scope-resolver.js";
import {
  CatalogRepository,
  type ExportDocumentRecord,
  type ExportTagRecord,
} from "../../repositories/catalog-repository.js";
import { SearchIndexBuilder } from "../search/search-index-builder.js";
import {
  createJsonArrayFileWriter,
  iterateNdjsonFileSync,
  type JsonArrayFileWriter,
} from "../../utils/file-streaming.js";
import { logAffairsIndexerRss } from "../../utils/rss-log.js";
import { throwIfAborted, yieldToEventLoop } from "../../utils/abort.js";
import { writeAffairsLibraryDebugLog } from "../../../../../workspace/affairs-library-debug-log.js";

export interface ExportBuildOptions {
  dirtyScope?: DirtyScope;
  light?: boolean;
  signal?: AbortSignal;
  onStageChange?: (stage: ExportBuildStage) => void;
  commandName?: string;
  reason?: string;
  targetPath?: string;
}

export type ExportBuildStage =
  | "export_meta_detail"
  | "export_tag"
  | "export_relation"
  | "export_search";

export interface ExportBuildResult {
  outputDir: string;
  manifestPath: string;
  metaShardCount: number;
  detailShardCount: number;
  tagShardCount: number;
  searchBucketCount: number;
  relationGroupCount: number;
  filesWritten: string[];
  exportedAt: string;
}

interface ManifestEntry {
  version: number;
  format: "static-v2";
  generated_at: string;
  entries: {
    status: string;
    taxonomy: string;
    relations: string;
    bootstrap?: string;
    search_manifest: string;
  };
  meta_shards: Array<{ id: string; directory: string; directories?: string[]; path: string; document_count: number }>;
  detail_shards: Array<{ id: string; document_id: string; document_path: string; path: string }>;
  tag_shards: Array<{ id: string; root_type: string; path: string; node_count: number; posting_path: string }>;
  relation_shards: Array<{ id: string; path: string; document_count: number }>;
  search_buckets: Array<{ bucket: string; path: string; term_count: number }>;
}

interface RelationPair {
  document_id: string;
  related_document_id: string;
  relation_type: string;
  score: number;
  shared_tags: string[];
}

interface FolderBootstrapNode {
  path: string;
  name: string;
  parent_path: string | null;
  direct_document_count: number;
  document_count: number;
}

const RELATION_MAX_POSTING = 128;
const META_SHARD_TARGET_DOCUMENTS = 64;

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
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

function makeId(prefix: string, value: string): string {
  const digest = crypto.createHash("sha1").update(value).digest("hex").slice(0, 16);
  return `${prefix}_${digest}`;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function normalizeDirectory(filePath: string): string {
  const value = path.posix.dirname(filePath);
  return value && value !== "" ? value : ".";
}

function directoryName(directory: string): string {
  if (!directory || directory === ".") {
    return "资料库";
  }
  return path.posix.basename(directory);
}

function parentDirectory(directory: string): string | null {
  if (!directory || directory === ".") {
    return null;
  }
  const parent = path.posix.dirname(directory);
  return parent && parent !== "" ? parent : ".";
}

function topLevelDirectory(directory: string): string {
  if (!directory || directory === ".") {
    return ".";
  }
  return directory.split("/").filter(Boolean)[0] ?? ".";
}

function commonDirectory(directoryPaths: string[]): string {
  if (directoryPaths.length === 0) {
    return ".";
  }
  const normalized = uniqueSorted(directoryPaths);
  if (normalized.length === 1) {
    return normalized[0] ?? ".";
  }
  const partsList = normalized.map(item => item === "." ? [] : item.split("/").filter(Boolean));
  const minLength = Math.min(...partsList.map(parts => parts.length));
  const shared: string[] = [];
  for (let index = 0; index < minLength; index += 1) {
    const current = partsList[0]?.[index];
    if (!current || partsList.some(parts => parts[index] !== current)) {
      break;
    }
    shared.push(current);
  }
  return shared.length ? shared.join("/") : ".";
}

function metaShardDirectories(shard: { directory: string; directories?: string[] }): string[] {
  return uniqueSorted(shard.directories?.length ? shard.directories : [shard.directory]);
}

function ensureFolderBootstrapNode(
  folderMap: Map<string, FolderBootstrapNode>,
  directory: string,
): FolderBootstrapNode {
  const normalized = directory && directory !== "" ? directory : ".";
  const existing = folderMap.get(normalized);
  if (existing) {
    return existing;
  }
  const node: FolderBootstrapNode = {
    path: normalized,
    name: directoryName(normalized),
    parent_path: parentDirectory(normalized),
    direct_document_count: 0,
    document_count: 0,
  };
  folderMap.set(normalized, node);
  return node;
}

function makeTagTree(tags: ExportTagRecord[]) {
  const nodes = tags.map(tag => ({
    path: tag.path,
    name: tag.name,
    root_type: tag.rootType,
    parent_path: tag.parentPath,
    depth: tag.depth,
  }));
  const byPath = new Map<string, Record<string, unknown>>();
  for (const node of nodes) {
    byPath.set(node.path, { ...node, children: [] as Record<string, unknown>[] });
  }
  const roots: Record<string, unknown>[] = [];
  for (const node of byPath.values()) {
    const parentPath = node.parent_path as string | null;
    if (parentPath && byPath.has(parentPath)) {
      (byPath.get(parentPath)?.children as Record<string, unknown>[]).push(node);
    } else {
      roots.push(node);
    }
  }
  return {
    root_types: uniqueSorted(tags.map(tag => tag.rootType)),
    nodes,
    tree: roots,
  };
}

function buildRelationTempPath(tempDir: string, documentId: string): string {
  return path.join(tempDir, `${documentId}.relations.ndjson`);
}

function calculateScore(sharedTagCount: number, baseTagCount: number): number {
  return Number((sharedTagCount / Math.max(baseTagCount, 1)).toFixed(3));
}

function isRelationEligibleTag(tagPath: string): boolean {
  if (!tagPath) {
    return false;
  }
  return !(
    tagPath.startsWith("来源/")
    || tagPath.startsWith("类型/")
    || tagPath.startsWith("时间/")
    || tagPath.startsWith("状态/")
  );
}

/**
 * 静态导出构建器。
 * 这一版把 meta / detail / tag posting / relation / search 改成分段式处理，
 * 避免把 documents / relations / search 全量堆进内存。
 */
export class ExportBuilder {
  constructor(private readonly config: RuntimeConfig) {}

  async build(options: ExportBuildOptions = {}): Promise<ExportBuildResult> {
    const exportedAt = new Date().toISOString();
    const stageStartedAt = new Map<ExportBuildStage, number>();
    const repository = new CatalogRepository(this.config.dbPath);
    const tags = repository.listExportTags();
    const taxonomy = makeTagTree(tags);

    ensureDir(this.config.exportDir);
    const metaDir = path.join(this.config.exportDir, "meta");
    const detailDir = path.join(this.config.exportDir, "detail");
    const tagDir = path.join(this.config.exportDir, "tags");
    const relationDir = path.join(this.config.exportDir, "relations");
    const tempDir = path.join(this.config.exportDir, ".tmp");
    const relationTempDir = path.join(tempDir, "relations");
    ensureDir(metaDir);
    ensureDir(detailDir);
    ensureDir(tagDir);
    ensureDir(relationDir);
    ensureDir(relationTempDir);

    const previousManifestPath = path.join(this.config.exportDir, "manifest.json");
    const previousManifest = readJson<ManifestEntry>(previousManifestPath);
    const dirtyDirectories = new Set(options.dirtyScope?.dirtyDirectories ?? []);
    const dirtyTagPaths = new Set(options.dirtyScope?.dirtyTagPaths ?? []);
    const changedPaths = new Set(options.dirtyScope?.changedPaths ?? []);
    const dirtyRelationIds = new Set(options.dirtyScope?.dirtyRelations ?? []);
    const fullBuild = !options.dirtyScope || options.dirtyScope.trigger === "full";
    const lightBuild = options.light === true;

    const filesWritten: string[] = [];
    const metaShards: ManifestEntry["meta_shards"] = [];
    const detailShards: ManifestEntry["detail_shards"] = [];
    const tagShards: ManifestEntry["tag_shards"] = [];
    const relationShards: ManifestEntry["relation_shards"] = [];
    const detailDocumentPaths = new Set<string>();
    const folderBootstrapMap = new Map<string, FolderBootstrapNode>();
    ensureFolderBootstrapNode(folderBootstrapMap, ".");

    const startStage = (stage: ExportBuildStage, details?: Record<string, unknown>) => {
      stageStartedAt.set(stage, performance.now());
      options.onStageChange?.(stage);
      writeAffairsLibraryDebugLog({
        event: "export_stage_started",
        processRole: "helper",
        rootDir: this.config.rootDir,
        command: options.commandName ?? "export",
        reason: options.reason,
        targetPath: options.targetPath,
        status: "running",
        details: {
          stage,
          ...details
        }
      });
    };
    const finishStage = (stage: ExportBuildStage, details?: Record<string, unknown>) => {
      const startedAt = stageStartedAt.get(stage) ?? performance.now();
      writeAffairsLibraryDebugLog({
        event: "export_stage_finished",
        processRole: "helper",
        rootDir: this.config.rootDir,
        command: options.commandName ?? "export",
        reason: options.reason,
        targetPath: options.targetPath,
        status: "finished",
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
        details: {
          stage,
          ...details
        }
      });
    };

    let currentMetaRoot: string | null = null;
    let currentMetaDocuments: Array<Record<string, unknown>> = [];
    let currentMetaDirectories: string[] = [];
    let currentMetaDirectorySet = new Set<string>();
    const metaShardCounters = new Map<string, number>();
    const flushMetaShard = (): void => {
      if (!currentMetaRoot || currentMetaDocuments.length === 0) {
        return;
      }
      const shardDirectories = uniqueSorted(currentMetaDirectories);
      const shardDirectory = commonDirectory(shardDirectories);
      const shardIndex = metaShardCounters.get(currentMetaRoot) ?? 0;
      metaShardCounters.set(currentMetaRoot, shardIndex + 1);
      const shardId = makeId("meta", `${currentMetaRoot}::${shardIndex}`);
      const relativePath = path.posix.join("meta", `${shardId}.json`);
      metaShards.push({
        id: shardId,
        directory: shardDirectory,
        directories: shardDirectories,
        path: relativePath,
        document_count: currentMetaDocuments.length,
      });
      if (fullBuild || shardDirectories.some(directory => dirtyDirectories.has(directory))) {
        const absolutePath = path.join(this.config.exportDir, relativePath);
        writeJson(absolutePath, {
          version: 2,
          shard_type: "meta",
          directory: shardDirectory,
          directories: shardDirectories,
          exported_at: exportedAt,
          documents: currentMetaDocuments,
        });
        filesWritten.push(absolutePath);
      }
      currentMetaRoot = null;
      currentMetaDocuments = [];
      currentMetaDirectories = [];
      currentMetaDirectorySet = new Set<string>();
    };

    startStage("export_meta_detail", {
      fullBuild,
      lightBuild,
      dirtyDirectoryCount: dirtyDirectories.size,
      changedPathCount: changedPaths.size
    });
    for (const batch of repository.iterateExportDocumentRecords(2000)) {
      throwIfAborted(options.signal, "事务文档库导出已取消");
      for (const document of batch) {
        throwIfAborted(options.signal, "事务文档库导出已取消");
        const directory = normalizeDirectory(document.path);
        ensureFolderBootstrapNode(folderBootstrapMap, directory).direct_document_count += 1;
        let currentBootstrapDirectory: string | null = directory;
        while (currentBootstrapDirectory) {
          ensureFolderBootstrapNode(folderBootstrapMap, currentBootstrapDirectory).document_count += 1;
          currentBootstrapDirectory = parentDirectory(currentBootstrapDirectory);
        }
        const metaRoot = topLevelDirectory(directory);
        const shouldFlushForRoot = currentMetaRoot !== null && currentMetaRoot !== metaRoot;
        const shouldFlushForSize = currentMetaDocuments.length >= META_SHARD_TARGET_DOCUMENTS
          && !currentMetaDirectorySet.has(directory);
        if (shouldFlushForRoot || shouldFlushForSize) {
          flushMetaShard();
        }
        if (!currentMetaRoot) {
          currentMetaRoot = metaRoot;
        }
        if (!currentMetaDirectorySet.has(directory)) {
          currentMetaDirectorySet.add(directory);
          currentMetaDirectories.push(directory);
        }

        currentMetaDocuments.push({
          document_id: document.documentId,
          path: document.path,
          title: document.title,
          summary: document.summary,
          mtime: document.mtime,
          direct_tags: document.tags,
          derived_tags: document.derivedTags,
          detail_ref: `detail/${document.documentId}.json`,
        });

        const detailRelativePath = path.posix.join("detail", `${document.documentId}.json`);
        detailShards.push({
          id: makeId("detail", document.path),
          document_id: document.documentId,
          document_path: document.path,
          path: detailRelativePath,
        });
        detailDocumentPaths.add(document.path);

        if (fullBuild || changedPaths.has(document.path) || dirtyDirectories.has(directory)) {
          const absoluteDetailPath = path.join(this.config.exportDir, detailRelativePath);
          writeJson(absoluteDetailPath, {
            version: 2,
            shard_type: "detail",
            exported_at: exportedAt,
            document: {
              document_id: document.documentId,
              path: document.path,
              title: document.title,
              summary: document.summary,
              direct_tags: document.tags,
              derived_tags: document.derivedTags,
              mtime: document.mtime,
              directory,
            },
          });
          filesWritten.push(absoluteDetailPath);
        }
      }
      await yieldToEventLoop(options.signal, "事务文档库导出已取消");
    }
    flushMetaShard();
    logAffairsIndexerRss("export.meta_detail_complete", {
      rootDir: this.config.rootDir,
      fullBuild,
      lightBuild,
      metaShardCount: metaShards.length,
      detailShardCount: detailShards.length,
      dirtyDirectoryCount: dirtyDirectories.size,
      changedPathCount: changedPaths.size
    });
    finishStage("export_meta_detail", {
      metaShardCount: metaShards.length,
      detailShardCount: detailShards.length
    });

    const tagsByRoot = new Map<string, ExportTagRecord[]>();
    for (const tag of tags) {
      throwIfAborted(options.signal, "事务文档库导出已取消");
      const current = tagsByRoot.get(tag.rootType) ?? [];
      current.push(tag);
      tagsByRoot.set(tag.rootType, current);
    }

    let currentRootType: string | null = null;
    let currentPostingWriter: JsonArrayFileWriter | null = null;
    let currentPostingOutputPath: string | null = null;
    let currentTagPath: string | null = null;
    let currentTagDocuments: Array<{ document_id: string; path: string; title: string; derived: boolean }> = [];
    const flushCurrentTag = (): void => {
      if (!currentTagPath) {
        return;
      }
      if (currentPostingWriter) {
        currentPostingWriter.append({
          tag_path: currentTagPath,
          document_count: currentTagDocuments.length,
          documents: currentTagDocuments,
        });
      }
      currentTagPath = null;
      currentTagDocuments = [];
    };
    const flushCurrentRoot = (): void => {
      if (!currentRootType) {
        return;
      }
      flushCurrentTag();
      const shardId = makeId("tag", currentRootType);
      const relativePath = path.posix.join("tags", `${shardId}.json`);
      const postingPath = path.posix.join("tags", `${shardId}.posting.json`);
      tagShards.push({
        id: shardId,
        root_type: currentRootType,
        path: relativePath,
        node_count: (tagsByRoot.get(currentRootType) ?? []).length,
        posting_path: postingPath,
      });

      const dirtyRoot = [...dirtyTagPaths].some(tagPath => tagPath.startsWith(`${currentRootType}/`) || tagPath === currentRootType);
      if (fullBuild || dirtyRoot) {
        const absolutePath = path.join(this.config.exportDir, relativePath);
        writeJson(absolutePath, {
          version: 2,
          shard_type: "tag",
          root_type: currentRootType,
          exported_at: exportedAt,
          nodes: tagsByRoot.get(currentRootType) ?? [],
        });
        filesWritten.push(absolutePath);
      }

      currentPostingWriter?.close();
      if (currentPostingOutputPath) {
        filesWritten.push(currentPostingOutputPath);
      }

      currentRootType = null;
      currentPostingWriter = null;
      currentPostingOutputPath = null;
      currentTagPath = null;
      currentTagDocuments = [];
    };

    startStage("export_tag", {
      dirtyTagPathCount: dirtyTagPaths.size
    });
    for (const batch of repository.iterateTagPostingRows(10000)) {
      throwIfAborted(options.signal, "事务文档库导出已取消");
      for (const row of batch) {
        throwIfAborted(options.signal, "事务文档库导出已取消");
        if (currentRootType !== row.rootType) {
          flushCurrentRoot();
          currentRootType = row.rootType;
          const shardId = makeId("tag", currentRootType);
          const postingPath = path.posix.join("tags", `${shardId}.posting.json`);
          const dirtyRoot = fullBuild
            || [...dirtyTagPaths].some(tagPath => tagPath.startsWith(`${currentRootType}/`) || tagPath === currentRootType);
          if (dirtyRoot) {
            currentPostingOutputPath = path.join(this.config.exportDir, postingPath);
            currentPostingWriter = createJsonArrayFileWriter(currentPostingOutputPath, {
              prefix: `{\n  "version": 2,\n  "shard_type": "tag_posting",\n  "root_type": ${JSON.stringify(currentRootType)},\n  "exported_at": ${JSON.stringify(exportedAt)},\n  "postings": [`,
              suffix: "\n  ]\n}\n",
            });
          } else {
            currentPostingOutputPath = null;
            currentPostingWriter = null;
          }
        }
        if (currentTagPath !== row.tagPath) {
          flushCurrentTag();
          currentTagPath = row.tagPath;
        }
        currentTagDocuments.push({
          document_id: row.documentId,
          path: row.path,
          title: row.title,
          derived: row.derived,
        });
      }
      await yieldToEventLoop(options.signal, "事务文档库导出已取消");
    }
    flushCurrentRoot();
    logAffairsIndexerRss("export.tag_complete", {
      rootDir: this.config.rootDir,
      tagShardCount: tagShards.length,
      dirtyTagPathCount: dirtyTagPaths.size
    });
    finishStage("export_tag", {
      tagShardCount: tagShards.length
    });

    let currentRelationTag: string | null = null;
    let currentRelationPostings: Array<{ documentId: string; path: string; title: string }> = [];
    const flushRelationTag = (): void => {
      if (
        !currentRelationTag
        || !isRelationEligibleTag(currentRelationTag)
        || currentRelationPostings.length < 2
        || currentRelationPostings.length > RELATION_MAX_POSTING
      ) {
        currentRelationTag = null;
        currentRelationPostings = [];
        return;
      }

      const sharedTag = currentRelationTag;
      for (let index = 0; index < currentRelationPostings.length; index += 1) {
        for (let otherIndex = index + 1; otherIndex < currentRelationPostings.length; otherIndex += 1) {
          const left = currentRelationPostings[index];
          const right = currentRelationPostings[otherIndex];
          const pair: RelationPair = {
            document_id: left.documentId,
            related_document_id: right.documentId,
            relation_type: "shared_tag",
            score: calculateScore(1, 1),
            shared_tags: [sharedTag],
          };
          appendNdjson(buildRelationTempPath(relationTempDir, left.documentId), pair);
          appendNdjson(buildRelationTempPath(relationTempDir, right.documentId), {
            ...pair,
            document_id: right.documentId,
            related_document_id: left.documentId,
          });
        }
      }

      currentRelationTag = null;
      currentRelationPostings = [];
    };

    startStage("export_relation", {
      lightBuild,
      dirtyRelationCount: dirtyRelationIds.size
    });
    if (!lightBuild) {
      for (const batch of repository.iterateDirectTagPostingRows(10000)) {
        throwIfAborted(options.signal, "事务文档库导出已取消");
        for (const row of batch) {
          throwIfAborted(options.signal, "事务文档库导出已取消");
          if (currentRelationTag !== row.tagPath) {
            flushRelationTag();
            currentRelationTag = row.tagPath;
          }
          currentRelationPostings.push({
            documentId: row.documentId,
            path: row.path,
            title: row.title,
          });
        }
        await yieldToEventLoop(options.signal, "事务文档库导出已取消");
      }
    }
    flushRelationTag();

    const relationTempFiles = fs.existsSync(relationTempDir)
      ? fs.readdirSync(relationTempDir).filter(name => name.endsWith(".relations.ndjson"))
      : [];
    for (const fileName of relationTempFiles) {
      throwIfAborted(options.signal, "事务文档库导出已取消");
      const documentId = fileName.replace(/\.relations\.ndjson$/, "");
      const merged = new Map<string, RelationPair>();
      iterateNdjsonFileSync<RelationPair>(path.join(relationTempDir, fileName), (record) => {
        const key = `${record.document_id}::${record.related_document_id}`;
        const existing = merged.get(key);
        if (existing) {
          existing.shared_tags = uniqueSorted([...existing.shared_tags, ...record.shared_tags]);
          existing.score = calculateScore(existing.shared_tags.length, existing.shared_tags.length);
          return;
        }
        merged.set(key, {
          ...record,
          shared_tags: uniqueSorted(record.shared_tags),
        });
      });
      const relations = [...merged.values()].sort((a, b) => a.related_document_id.localeCompare(b.related_document_id, "zh-Hans-CN"));
      relationShards.push({
        id: makeId("relation", documentId),
        path: `relations/${documentId}.json`,
        document_count: relations.length,
      });

      if (fullBuild || dirtyRelationIds.has(documentId)) {
        const absolutePath = path.join(this.config.exportDir, "relations", `${documentId}.json`);
        writeJson(absolutePath, {
          version: 2,
          shard_type: "relation",
          exported_at: exportedAt,
          document_id: documentId,
          relations,
        });
        filesWritten.push(absolutePath);
      }
      safeUnlink(path.join(relationTempDir, fileName));
      await yieldToEventLoop(options.signal, "事务文档库导出已取消");
    }
    if (fs.existsSync(relationTempDir) && fs.readdirSync(relationTempDir).length === 0) {
      fs.rmdirSync(relationTempDir);
    }
    if (fs.existsSync(tempDir) && fs.readdirSync(tempDir).length === 0) {
      fs.rmdirSync(tempDir);
    }
    logAffairsIndexerRss("export.relation_complete", {
      rootDir: this.config.rootDir,
      relationGroupCount: relationShards.length,
      dirtyRelationCount: dirtyRelationIds.size,
      lightBuild
    });
    finishStage("export_relation", {
      relationGroupCount: relationShards.length
    });

    const statusPath = path.join(this.config.exportDir, "status.json");
    const taxonomyPath = path.join(this.config.exportDir, "taxonomy.json");
    const relationsPath = path.join(this.config.exportDir, "relations.json");
    const bootstrapPath = path.join(this.config.exportDir, "bootstrap.json");

    startStage("export_search", {
      lightBuild
    });
    const searchIndexResult = lightBuild
      ? { bucketCount: 0, filesWritten: [] as string[], manifestPath: path.join(this.config.exportDir, "search", "manifest.json") }
      : await new SearchIndexBuilder(this.config).build({
        dirtyScope: options.dirtyScope,
        signal: options.signal,
        commandName: options.commandName,
        reason: options.reason,
        targetPath: options.targetPath
      });
    logAffairsIndexerRss("export.search_complete", {
      rootDir: this.config.rootDir,
      searchBucketCount: searchIndexResult.bucketCount,
      searchFilesWritten: searchIndexResult.filesWritten.length
    });

    writeJson(statusPath, {
      version: 2,
      format: "static-v2",
      exported_at: exportedAt,
      document_count: detailShards.length,
      meta_shard_count: metaShards.length,
      detail_shard_count: detailShards.length,
      tag_shard_count: tagShards.length,
      relation_group_count: relationShards.length,
      search_bucket_count: searchIndexResult.bucketCount,
      dirty_scope: options.dirtyScope ?? null,
    });
    writeJson(taxonomyPath, {
      version: 2,
      format: "static-v2",
      exported_at: exportedAt,
      ...taxonomy,
    });
    writeJson(relationsPath, {
      version: 2,
      format: "static-v2",
      exported_at: exportedAt,
      groups: relationShards,
    });
    writeJson(bootstrapPath, {
      version: 2,
      format: "static-v2-bootstrap",
      exported_at: exportedAt,
      folders: [...folderBootstrapMap.values()]
        .sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN")),
    });

    filesWritten.push(statusPath, taxonomyPath, relationsPath, bootstrapPath, ...searchIndexResult.filesWritten);

    const searchManifest = lightBuild
      ? { buckets: previousManifest?.search_buckets ?? [] }
      : readJson<{ buckets?: ManifestEntry["search_buckets"] }>(searchIndexResult.manifestPath);
    const manifest: ManifestEntry = {
      version: 2,
      format: "static-v2",
      generated_at: exportedAt,
      entries: {
        status: "status.json",
        taxonomy: "taxonomy.json",
        relations: "relations.json",
        bootstrap: "bootstrap.json",
        search_manifest: "search/manifest.json",
      },
      meta_shards: metaShards,
      detail_shards: detailShards,
      tag_shards: tagShards,
      relation_shards: relationShards,
      search_buckets: searchManifest?.buckets ?? [],
    };

    const manifestPath = path.join(this.config.exportDir, "manifest.json");
    writeJson(manifestPath, manifest);
    filesWritten.push(manifestPath);
    logAffairsIndexerRss("export.complete", {
      rootDir: this.config.rootDir,
      manifestPath,
      metaShardCount: metaShards.length,
      detailShardCount: detailShards.length,
      tagShardCount: tagShards.length,
      relationGroupCount: relationShards.length,
      searchBucketCount: searchIndexResult.bucketCount
    });

    if (previousManifest) {
      const activeMetaPaths = new Set(metaShards.map(item => item.path));
      const activeDetailPaths = new Set(detailShards.map(item => item.path));
      const activeRelationPaths = new Set(relationShards.map(item => item.path));

      for (const shard of previousManifest.meta_shards ?? []) {
        throwIfAborted(options.signal, "事务文档库导出已取消");
        const shardDirectories = metaShardDirectories(shard);
        if (
          !activeMetaPaths.has(shard.path)
          && (fullBuild || shardDirectories.some(directory => dirtyDirectories.has(directory)))
        ) {
          const absolutePath = path.join(this.config.exportDir, shard.path);
          if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
        }
      }

      for (const shard of previousManifest.detail_shards ?? []) {
        throwIfAborted(options.signal, "事务文档库导出已取消");
        if (!activeDetailPaths.has(shard.path) || (changedPaths.has(shard.document_path) && !detailDocumentPaths.has(shard.document_path))) {
          const absolutePath = path.join(this.config.exportDir, shard.path);
          if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
        }
      }

      for (const shard of previousManifest.relation_shards ?? []) {
        throwIfAborted(options.signal, "事务文档库导出已取消");
        if (!activeRelationPaths.has(shard.path)) {
          const absolutePath = path.join(this.config.exportDir, shard.path);
          if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
        }
      }
    }
    finishStage("export_search", {
      searchBucketCount: searchIndexResult.bucketCount,
      searchFilesWritten: searchIndexResult.filesWritten.length
    });

    return {
      outputDir: this.config.exportDir,
      manifestPath,
      metaShardCount: metaShards.length,
      detailShardCount: detailShards.length,
      tagShardCount: tagShards.length,
      searchBucketCount: searchIndexResult.bucketCount,
      relationGroupCount: relationShards.length,
      filesWritten: uniqueSorted(filesWritten),
      exportedAt,
    };
  }
}
