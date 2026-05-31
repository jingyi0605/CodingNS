import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { RuntimeConfig } from "../../../../contracts/src/index.js";
import {
  CatalogRepository,
  type ExportDocumentRecord,
  type ExportTagRecord,
} from "../../repositories/catalog-repository.js";
import type { DirtyScope } from "../dirty/dirty-scope-resolver.js";

export interface ExportBuildOptions {
  dirtyScope?: DirtyScope;
}

export interface ExportBuildResult {
  outputDir: string;
  documentCount: number;
  taxonomyNodeCount: number;
  relationCount: number;
  filesWritten: string[];
  filesDeleted: string[];
  exportedAt: string;
}

interface ExportTaxonomyNode {
  path: string;
  name: string;
  root_type: string;
  parent_path: string | null;
  depth: number;
  direct_document_count: number;
  document_count: number;
  has_children: boolean;
  children?: ExportTaxonomyNode[];
}

interface ExportRelationRecord {
  document_id: string;
  related_document_id: string;
  relation_type: string;
  score: number;
  shared_tags: string[];
}

interface DirectorySnapshotFileRecord {
  file_id: string;
  document_id: string;
  path: string;
  title: string;
  summary: string;
  mtime: string;
  tags: string[];
  derived_tags: string[];
  confidence: Record<string, never>;
  sources: Record<string, never>;
  manual_override: boolean;
}

interface DirectorySnapshotTopTagRecord {
  tag_path: string;
  document_count: number;
}

interface DirectorySnapshotRecord {
  version: number;
  directory: string;
  updated_at: string;
  files: Record<string, DirectorySnapshotFileRecord>;
  document_count: number;
  top_tags: DirectorySnapshotTopTagRecord[];
}

interface SnapshotRegistry {
  directories: string[];
  updated_at: string;
}

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

function makeStableId(prefix: string, value: string): string {
  const digest = crypto.createHash("sha1").update(value).digest("hex");
  return `${prefix}_${digest}`;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function cloneNodeForTree(node: ExportTaxonomyNode): ExportTaxonomyNode {
  return {
    path: node.path,
    name: node.name,
    root_type: node.root_type,
    parent_path: node.parent_path,
    depth: node.depth,
    direct_document_count: node.direct_document_count,
    document_count: node.document_count,
    has_children: node.has_children,
    ...(node.children?.length
      ? { children: node.children.map(child => cloneNodeForTree(child)) }
      : {}),
  };
}

function buildTaxonomy(
  tags: ExportTagRecord[],
  documents: ExportDocumentRecord[],
): { rootTypes: string[]; nodes: ExportTaxonomyNode[]; tree: ExportTaxonomyNode[] } {
  const nodeMap = new Map<string, ExportTaxonomyNode>();
  const directDocumentSets = new Map<string, Set<string>>();
  const subtreeDocumentSets = new Map<string, Set<string>>();

  for (const tag of tags) {
    nodeMap.set(tag.path, {
      path: tag.path,
      name: tag.name,
      root_type: tag.rootType,
      parent_path: tag.parentPath,
      depth: tag.depth,
      direct_document_count: 0,
      document_count: 0,
      has_children: false,
      children: [],
    });
  }

  for (const document of documents) {
    const exactTags = uniqueSorted([...document.tags, ...document.derivedTags]);
    for (const tagPath of exactTags) {
      const exactSet = directDocumentSets.get(tagPath) ?? new Set<string>();
      exactSet.add(document.documentId);
      directDocumentSets.set(tagPath, exactSet);

      const parts = tagPath.split("/");
      for (let index = 1; index <= parts.length; index += 1) {
        const ancestorPath = parts.slice(0, index).join("/");
        const subtreeSet = subtreeDocumentSets.get(ancestorPath) ?? new Set<string>();
        subtreeSet.add(document.documentId);
        subtreeDocumentSets.set(ancestorPath, subtreeSet);
      }
    }
  }

  for (const node of nodeMap.values()) {
    node.direct_document_count = directDocumentSets.get(node.path)?.size ?? 0;
    node.document_count = subtreeDocumentSets.get(node.path)?.size ?? 0;
  }

  const roots: ExportTaxonomyNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parent_path) {
      const parent = nodeMap.get(node.parent_path);
      if (parent) {
        parent.children = parent.children ?? [];
        parent.children.push(node);
        parent.has_children = true;
        continue;
      }
    }
    roots.push(node);
  }

  const sortNodes = (items: ExportTaxonomyNode[]): ExportTaxonomyNode[] => {
    items.sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"));
    for (const item of items) {
      if (item.children?.length) {
        sortNodes(item.children);
      } else {
        delete item.children;
      }
    }
    return items;
  };

  const sortedRoots = sortNodes(roots);
  const sortedNodes = [...nodeMap.values()]
    .sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"))
    .map(node => ({
      path: node.path,
      name: node.name,
      root_type: node.root_type,
      parent_path: node.parent_path,
      depth: node.depth,
      direct_document_count: node.direct_document_count,
      document_count: node.document_count,
      has_children: node.has_children,
    }));
  const rootTypes = uniqueSorted(sortedNodes.map(item => item.root_type));

  return {
    rootTypes,
    nodes: sortedNodes,
    tree: sortedRoots.map(root => cloneNodeForTree(root)),
  };
}

function buildRelations(documents: ExportDocumentRecord[]): ExportRelationRecord[] {
  const relations: ExportRelationRecord[] = [];

  for (let index = 0; index < documents.length; index += 1) {
    const current = documents[index];
    const currentTags = new Set(current.tags);
    if (currentTags.size === 0) {
      continue;
    }

    for (let otherIndex = index + 1; otherIndex < documents.length; otherIndex += 1) {
      const other = documents[otherIndex];
      const sharedTags = uniqueSorted(other.tags.filter(tagPath => currentTags.has(tagPath)));
      if (sharedTags.length === 0) {
        continue;
      }

      relations.push({
        document_id: current.documentId,
        related_document_id: other.documentId,
        relation_type: "shared_tag",
        score: Number((sharedTags.length / Math.max(currentTags.size, 1)).toFixed(3)),
        shared_tags: sharedTags,
      });
    }
  }

  relations.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (a.document_id !== b.document_id) {
      return a.document_id.localeCompare(b.document_id, "zh-Hans-CN");
    }
    return a.related_document_id.localeCompare(b.related_document_id, "zh-Hans-CN");
  });

  return relations;
}

function buildDirectorySnapshots(
  documents: ExportDocumentRecord[],
  exportedAt: string,
): Map<string, DirectorySnapshotRecord> {
  const snapshots = new Map<string, DirectorySnapshotRecord>();

  for (const document of documents) {
    const directory = path.posix.dirname(document.path);
    const fileName = path.posix.basename(document.path);
    const snapshot = snapshots.get(directory) ?? {
      version: 1,
      directory,
      updated_at: exportedAt,
      files: {},
      document_count: 0,
      top_tags: [],
    };

    snapshot.document_count += 1;
    snapshot.files[fileName] = {
      file_id: makeStableId("file", document.path),
      document_id: document.documentId,
      path: document.path,
      title: document.title,
      summary: document.summary,
      mtime: document.mtime,
      tags: [...document.tags],
      derived_tags: [...document.derivedTags],
      confidence: {},
      sources: {},
      manual_override: false,
    };
    snapshots.set(directory, snapshot);
  }

  for (const snapshot of snapshots.values()) {
    const tagCounter = new Map<string, number>();

    for (const filePayload of Object.values(snapshot.files)) {
      for (const tagPath of filePayload.tags) {
        tagCounter.set(tagPath, (tagCounter.get(tagPath) ?? 0) + 1);
      }
    }

    snapshot.top_tags = [...tagCounter.entries()]
      .sort((a, b) => {
        if (b[1] !== a[1]) {
          return b[1] - a[1];
        }
        return a[0].localeCompare(b[0], "zh-Hans-CN");
      })
      .map(([tagPath, documentCount]) => ({
        tag_path: tagPath,
        document_count: documentCount,
      }));
  }

  return snapshots;
}

/**
 * 最小静态导出构建器。
 * 第二阶段补上目录快照清理与最小 Dirty Scope 感知，继续保持 legacy JSON 兼容。
 */
export class ExportBuilder {
  constructor(private readonly config: RuntimeConfig) {}

  build(options: ExportBuildOptions = {}): ExportBuildResult {
    const exportedAt = new Date().toISOString();
    const repository = new CatalogRepository(this.config.dbPath);
    const documents = repository.listExportDocuments();
    const tags = repository.listExportTags();
    const taxonomy = buildTaxonomy(tags, documents);
    const relations = buildRelations(documents);
    const directorySnapshots = buildDirectorySnapshots(documents, exportedAt);
    const dirtyDirectories = new Set(options.dirtyScope?.dirtyDirectories ?? []);
    const fullBuild = !options.dirtyScope || options.dirtyScope.trigger === "full";

    ensureDir(this.config.exportDir);

    const documentsFile = path.join(this.config.exportDir, "documents.json");
    const taxonomyFile = path.join(this.config.exportDir, "taxonomy.json");
    const relationsFile = path.join(this.config.exportDir, "relations.json");
    const statusFile = path.join(this.config.exportDir, "status.json");
    const registryFile = path.join(this.config.exportDir, ".snapshot-registry.json");

    writeJson(documentsFile, {
      version: 1,
      generator: {
        runtime: "node",
        package: "doc-semantic-index",
      },
      documents: documents.map(item => ({
        document_id: item.documentId,
        path: item.path,
        title: item.title,
        summary: item.summary,
        tags: item.tags,
        derived_tags: item.derivedTags,
        mtime: item.mtime,
      })),
    });

    writeJson(taxonomyFile, {
      version: 1,
      generator: {
        runtime: "node",
        package: "doc-semantic-index",
      },
      root_types: taxonomy.rootTypes,
      nodes: taxonomy.nodes,
      tree: taxonomy.tree,
    });

    writeJson(relationsFile, {
      version: 1,
      generator: {
        runtime: "node",
        package: "doc-semantic-index",
      },
      relations,
    });

    writeJson(statusFile, {
      version: 1,
      generator: {
        runtime: "node",
        package: "doc-semantic-index",
        exported_at: exportedAt,
      },
      watcher: {
        status: "idle",
        last_job: {
          job_type: "export",
          target_path: ".",
          status: "done",
          updated_at: exportedAt,
        },
      },
      queue: {
        queued: 0,
        running: 0,
        failed: 0,
      },
      vector_store: {
        mode: "disabled",
      },
      last_full_scan_at: exportedAt,
      document_count: documents.length,
      taxonomy_node_count: taxonomy.nodes.length,
      relation_count: relations.length,
      dirty_scope: options.dirtyScope ?? null,
    });

    const previousRegistry = readJson<SnapshotRegistry>(registryFile);
    const previousDirectories = new Set(previousRegistry?.directories ?? []);
    const currentDirectories = new Set(directorySnapshots.keys());
    const filesWritten: string[] = [documentsFile, taxonomyFile, relationsFile, statusFile];
    const filesDeleted: string[] = [];

    for (const [directory, snapshot] of directorySnapshots.entries()) {
      if (!fullBuild && !dirtyDirectories.has(directory)) {
        continue;
      }
      const targetDirectory = path.join(this.config.rootDir, directory);
      ensureDir(targetDirectory);
      const snapshotFile = path.join(targetDirectory, ".supertags.json");
      writeJson(snapshotFile, snapshot);
      filesWritten.push(snapshotFile);
    }

    const staleDirectories = fullBuild
      ? [...previousDirectories].filter(directory => !currentDirectories.has(directory))
      : [...dirtyDirectories].filter(directory => !currentDirectories.has(directory));

    for (const directory of staleDirectories) {
      const snapshotFile = path.join(this.config.rootDir, directory, ".supertags.json");
      if (fs.existsSync(snapshotFile)) {
        fs.unlinkSync(snapshotFile);
        filesDeleted.push(snapshotFile);
      }
    }

    writeJson(registryFile, {
      directories: uniqueSorted(currentDirectories),
      updated_at: exportedAt,
    });
    filesWritten.push(registryFile);

    return {
      outputDir: this.config.exportDir,
      documentCount: documents.length,
      taxonomyNodeCount: taxonomy.nodes.length,
      relationCount: relations.length,
      filesWritten: uniqueSorted(filesWritten),
      filesDeleted: uniqueSorted(filesDeleted),
      exportedAt,
    };
  }
}
