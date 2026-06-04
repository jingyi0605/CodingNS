import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { RuntimeConfig } from "../../../../contracts/src/index.js";
import {
  CatalogRepository,
  type RecomputeScope,
  type ResolvedDocumentTagRow,
  type TagRuleRow,
  type TagRecomputeDocumentRow,
  type TagResolvedSourceType,
} from "../../repositories/catalog-repository.js";
import {
  CatalogWriteRepository,
  type RecomputedResolvedTagEntry,
} from "../../repositories/catalog-write-repository.js";
import { SimpleTagInferenceEngine } from "../../tagging/simple-tag-inference.js";
import type { FileScanResult } from "../../scanner/file-scanner.js";
import type { ParsedDocument } from "../../parser/plain-text-parser.js";
import { ExportBuilder } from "../export/export-builder.js";
import type { DirtyScope } from "../dirty/dirty-scope-resolver.js";
import { throwIfAborted, yieldToEventLoop } from "../../utils/abort.js";

export interface TagRecomputeRunInput {
  scope?: RecomputeScope;
  signal?: AbortSignal;
  onProgress?: (progress: TagRecomputeProgressSnapshot) => void;
}

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

export interface TagRecomputeProgressSnapshot {
  phase: "prepare" | "recompute" | "write" | "export" | "finished";
  label: string;
  detail: string | null;
  current: number;
  total: number;
  percent: number;
}

interface ResolvedTagAccumulator {
  documentId: string;
  entries: RecomputedResolvedTagEntry[];
}

interface EffectiveFolderTagAssignment {
  id: string;
  tagPath: string;
  folderPath: string;
}

interface SmartRuleAssignment {
  tagPath: string;
  ruleId: string;
  evidence: string;
}

function collectTagAncestors(tagPath: string): string[] {
  const parts = tagPath.split("/").filter(Boolean);
  const values: string[] = [];
  for (let index = 1; index <= parts.length; index += 1) {
    values.push(parts.slice(0, index).join("/"));
  }
  return values;
}

function sourcePriority(sourceType: TagResolvedSourceType): number {
  switch (sourceType) {
    case "manual_document":
      return 1;
    case "folder_binding":
      return 2;
    case "smart_rule":
      return 3;
    case "system_derived":
      return 4;
    default:
      return 99;
  }
}

function setResolvedTag(
  target: Map<string, RecomputedResolvedTagEntry>,
  entry: RecomputedResolvedTagEntry,
): void {
  const current = target.get(entry.tagPath);
  if (!current) {
    target.set(entry.tagPath, entry);
    return;
  }
  const currentPriority = sourcePriority(current.sourceType);
  const nextPriority = sourcePriority(entry.sourceType);
  if (nextPriority < currentPriority) {
    target.set(entry.tagPath, entry);
    return;
  }
  if (nextPriority === currentPriority && entry.confidence >= current.confidence) {
    target.set(entry.tagPath, entry);
  }
}

/**
 * 只重算标签，不重新解析原始文件。
 * 当前只合并人工绑定、文件夹绑定和系统派生结果。
 */
export class TagRecomputeService {
  constructor(private readonly config: RuntimeConfig) {}

  async run(input: TagRecomputeRunInput = {}): Promise<TagRecomputeResult> {
    const startedAt = performance.now();
    const repository = new CatalogRepository(this.config.dbPath, {
      tempStore: "MEMORY",
    });
    const writer = new CatalogWriteRepository(this.config.dbPath);
    const tagger = new SimpleTagInferenceEngine();
    const observedAt = new Date().toISOString();
    const scope = input.scope ?? { kind: "full" as const };
    let scannedCount = 0;
    let updatedCount = 0;
    let directAssignedCount = 0;
    let derivedAssignedCount = 0;
    let inferMs = 0;
    let writeMs = 0;
    const folderBindingOnly = isFolderBindingOnlyScope(scope);

    const documents = repository.listRecomputeCandidateDocuments(scope);
    const documentIds = documents.map(item => item.documentId);
    const documentPaths = documents.map(item => item.path);
    const totalDocuments = documents.length;
    this.emitProgress(input, {
      phase: "prepare",
      label: folderBindingOnly ? "正在准备文件夹标签分配" : "正在准备标签重算",
      detail: totalDocuments > 0 ? `共 ${totalDocuments} 份文档` : "没有需要处理的文档",
      current: 0,
      total: Math.max(totalDocuments, 1),
      percent: totalDocuments === 0 ? 100 : 2,
    });
    const manualBindingsByDocument = this.resolveManualAssignments(repository, documentIds);
    const folderBindingsByDocument = this.resolveFolderAssignments(repository, scope, documentPaths);
    const retainedResolvedByDocument = folderBindingOnly
      ? this.resolveRetainedResolvedAssignments(repository, documentIds)
      : new Map<string, ResolvedDocumentTagRow[]>();
    const smartRules = folderBindingOnly ? [] : repository.listAllEnabledTagRules();

    const accumulators = new Map<string, ResolvedTagAccumulator>();

    const inferStartedAt = performance.now();
    for (const row of documents) {
      throwIfAborted(input.signal, "事务文档库标签重算已取消");
      const manualBindings = manualBindingsByDocument.get(row.documentId) ?? [];
      const folderBindings = folderBindingsByDocument.get(row.documentId) ?? [];
      const accumulator = folderBindingOnly
        ? this.mergeResolvedAssignmentsWithRetained(
            row.documentId,
            retainedResolvedByDocument.get(row.documentId) ?? [],
            manualBindings,
            folderBindings,
          )
        : (() => {
            const file = buildFileScanResult(this.config.rootDir, row);
            const parsed = buildParsedDocument(row);
            const inferred = tagger.infer(file, parsed);
            const smartBindings = this.resolveSmartRuleAssignments(file, row, parsed, smartRules);
            return this.mergeResolvedAssignments(
              row.documentId,
              inferred,
              manualBindings,
              folderBindings,
              smartBindings,
            );
          })();
      accumulators.set(row.documentId, accumulator);
      directAssignedCount += accumulator.entries.filter(item => item.sourceType !== "system_derived").length;
      derivedAssignedCount += accumulator.entries.filter(item => item.sourceType === "system_derived").length;
      scannedCount += 1;
      if (scannedCount === 1 || scannedCount === totalDocuments || scannedCount % 25 === 0) {
        this.emitProgress(input, {
          phase: "recompute",
          label: folderBindingOnly ? "正在应用文件夹标签" : "正在重算标签",
          detail: totalDocuments > 0 ? `${scannedCount} / ${totalDocuments}` : "没有需要处理的文档",
          current: scannedCount,
          total: Math.max(totalDocuments, 1),
          percent: resolveProgressPercent("recompute", scannedCount, totalDocuments),
        });
      }
      if (scannedCount % 200 === 0) {
        await yieldToEventLoop(input.signal, "事务文档库标签重算已取消");
      }
    }
    inferMs += performance.now() - inferStartedAt;

    throwIfAborted(input.signal, "事务文档库标签重算已取消");
    this.emitProgress(input, {
      phase: "write",
      label: "正在写入标签结果",
      detail: totalDocuments > 0 ? `准备写入 ${totalDocuments} 份文档` : "没有需要写入的结果",
      current: totalDocuments,
      total: Math.max(totalDocuments, 1),
      percent: resolveProgressPercent("write", totalDocuments, totalDocuments),
    });
    const writeStartedAt = performance.now();
    const written = writer.recomputeResolvedTags(
      [...accumulators.values()].flatMap(item => item.entries),
      observedAt,
      documentIds,
    );
    writeMs += performance.now() - writeStartedAt;
    updatedCount += written.updatedCount;

    throwIfAborted(input.signal, "事务文档库标签重算已取消");
    const updatedDocumentIdSet = new Set(written.updatedDocumentIds);
    const updatedEntries = [...accumulators.values()]
      .filter((item) => updatedDocumentIdSet.has(item.documentId))
      .flatMap(item => item.entries);
    const dirtyTagPathsForChanges = new Set<string>();
    updatedEntries.forEach((entry) => {
      collectTagAncestors(entry.tagPath).forEach(tagPath => dirtyTagPathsForChanges.add(tagPath));
    });
    const dirtyScope = this.buildDirtyScopeFromResolvedEntries(
      updatedEntries,
      dirtyTagPathsForChanges,
    );
    const hasTagDefinitionDrift = this.hasTagDefinitionDriftSinceLastExport(repository);
    const shouldRefreshExport = updatedCount > 0 || !isDirtyScopeEmpty(dirtyScope) || hasTagDefinitionDrift;
    let exportResult: TagRecomputeResult["exportResult"] = null;
    let exportMs = 0;
    if (shouldRefreshExport) {
      this.emitProgress(input, {
        phase: "export",
        label: "正在刷新标签结果",
        detail: "马上就好",
        current: totalDocuments,
        total: Math.max(totalDocuments, 1),
        percent: resolveProgressPercent("export", totalDocuments, totalDocuments),
      });
      const exportStartedAt = performance.now();
      const exported = await new ExportBuilder(this.config).build({
        dirtyScope: {
          ...dirtyScope,
          trigger: "full",
        },
        light: true,
        signal: input.signal,
      });
      exportMs = performance.now() - exportStartedAt;
      exportResult = {
        metaShardCount: exported.metaShardCount,
        detailShardCount: exported.detailShardCount,
        tagShardCount: exported.tagShardCount,
        exportedAt: exported.exportedAt,
      };
    }
    this.emitProgress(input, {
      phase: "finished",
      label: "标签分配已完成",
      detail: totalDocuments > 0 ? `已处理 ${totalDocuments} 份文档` : "这次没有需要处理的文档",
      current: totalDocuments,
      total: Math.max(totalDocuments, 1),
      percent: 100,
    });

    return {
      scannedCount,
      updatedCount,
      directAssignedCount,
      derivedAssignedCount,
      dirtyScope,
      exportResult,
      timingsMs: {
        infer: Number(inferMs.toFixed(2)),
        write: Number(writeMs.toFixed(2)),
        export: Number(exportMs.toFixed(2)),
        total: Number((performance.now() - startedAt).toFixed(2)),
      },
    };
  }

  private resolveManualAssignments(repository: CatalogRepository, documentIds: string[]) {
    const rows = repository.listManualDocumentTagBindingsByDocumentIds(documentIds);
    const byDocument = new Map<string, typeof rows>();
    rows.forEach(row => {
      const current = byDocument.get(row.documentId) ?? [];
      current.push(row);
      byDocument.set(row.documentId, current);
    });
    return byDocument;
  }

  private resolveFolderAssignments(repository: CatalogRepository, scope: RecomputeScope, documentPaths: string[]) {
    const rows = scope.kind === "folder" && scope.folderPath
      ? repository.listEffectiveFolderTagBindingsForFolderScope(scope.folderPath)
      : repository.listEffectiveFolderTagBindingsForDocumentPaths(documentPaths);
    const byDocument = new Map<string, EffectiveFolderTagAssignment[]>();
    rows.forEach(row => {
      const current = byDocument.get(row.documentId) ?? [];
      current.push({
        id: row.id,
        tagPath: row.tagPath,
        folderPath: row.folderPath,
      });
      byDocument.set(row.documentId, current);
    });
    return byDocument;
  }

  private resolveRetainedResolvedAssignments(repository: CatalogRepository, documentIds: string[]) {
    const rows = repository.listResolvedDocumentTagsByDocumentIds(documentIds)
      .filter((row) => row.sourceType !== "manual_document" && row.sourceType !== "folder_binding");
    const byDocument = new Map<string, ResolvedDocumentTagRow[]>();
    rows.forEach((row) => {
      const current = byDocument.get(row.documentId) ?? [];
      current.push(row);
      byDocument.set(row.documentId, current);
    });
    return byDocument;
  }

  private mergeResolvedAssignments(
    documentId: string,
    inferred: ReturnType<SimpleTagInferenceEngine["infer"]>,
    manualBindings: Array<{ id: string; tagPath: string }>,
    folderBindings: EffectiveFolderTagAssignment[],
    smartBindings: SmartRuleAssignment[],
  ): ResolvedTagAccumulator {
    const merged = new Map<string, RecomputedResolvedTagEntry>();

    manualBindings.forEach(binding => {
      setResolvedTag(merged, {
        documentId,
        tagPath: binding.tagPath,
        sourceType: "manual_document",
        confidence: 1,
        sourceRef: binding.id,
        evidence: "手动分配",
      });
    });

    folderBindings.forEach(binding => {
      setResolvedTag(merged, {
        documentId,
        tagPath: binding.tagPath,
        sourceType: "folder_binding",
        confidence: 0.98,
        sourceRef: binding.id,
        evidence: `继承自文件夹：${binding.folderPath || "."}`,
      });
    });

    smartBindings.forEach(binding => {
      setResolvedTag(merged, {
        documentId,
        tagPath: binding.tagPath,
        sourceType: "smart_rule",
        confidence: 0.96,
        sourceRef: binding.ruleId,
        evidence: binding.evidence,
      });
    });

    inferred.derivedTags.forEach(tag => {
      setResolvedTag(merged, {
        documentId,
        tagPath: tag.tagPath,
        sourceType: "system_derived",
        confidence: tag.confidence,
        sourceRef: tag.source,
        evidence: tag.evidence,
      });
    });

    return {
      documentId,
      entries: [...merged.values()].sort((left, right) => left.tagPath.localeCompare(right.tagPath, "zh-Hans-CN")),
    };
  }

  private mergeResolvedAssignmentsWithRetained(
    documentId: string,
    retained: ResolvedDocumentTagRow[],
    manualBindings: Array<{ id: string; tagPath: string }>,
    folderBindings: EffectiveFolderTagAssignment[],
  ): ResolvedTagAccumulator {
    const merged = new Map<string, RecomputedResolvedTagEntry>();

    manualBindings.forEach(binding => {
      setResolvedTag(merged, {
        documentId,
        tagPath: binding.tagPath,
        sourceType: "manual_document",
        confidence: 1,
        sourceRef: binding.id,
        evidence: "手动分配",
      });
    });

    folderBindings.forEach(binding => {
      setResolvedTag(merged, {
        documentId,
        tagPath: binding.tagPath,
        sourceType: "folder_binding",
        confidence: 0.98,
        sourceRef: binding.id,
        evidence: `继承自文件夹：${binding.folderPath || "."}`,
      });
    });

    retained.forEach((entry) => {
      setResolvedTag(merged, {
        documentId,
        tagPath: entry.path,
        sourceType: entry.sourceType,
        confidence: entry.confidence,
        sourceRef: entry.sourceRef,
        evidence: entry.evidence,
      });
    });

    return {
      documentId,
      entries: [...merged.values()].sort((left, right) => left.tagPath.localeCompare(right.tagPath, "zh-Hans-CN")),
    };
  }

  private resolveSmartRuleAssignments(
    file: FileScanResult,
    row: TagRecomputeDocumentRow,
    parsed: ParsedDocument,
    rules: TagRuleRow[],
  ): SmartRuleAssignment[] {
    if (rules.length === 0) {
      return [];
    }
    const rulesByTagPath = new Map<string, TagRuleRow[]>();
    rules.forEach(rule => {
      const current = rulesByTagPath.get(rule.tagPath) ?? [];
      current.push(rule);
      rulesByTagPath.set(rule.tagPath, current);
    });
    const matched: SmartRuleAssignment[] = [];
    rulesByTagPath.forEach((tagRules, tagPath) => {
      const result = evaluateSmartRuleGroup(file, row, parsed, tagRules);
      if (!result) {
        return;
      }
      matched.push({
        tagPath,
        ruleId: result.ruleId,
        evidence: result.evidence,
      });
    });
    return matched.sort((left, right) => left.tagPath.localeCompare(right.tagPath, "zh-Hans-CN"));
  }

  private buildDirtyScopeFromResolvedEntries(
    entries: RecomputedResolvedTagEntry[],
    dirtyTagPaths: Set<string>,
  ): DirtyScope {
    return {
      trigger: "incremental",
      changedPaths: [],
      dirtyDirectories: [],
      dirtyTagPaths: [...dirtyTagPaths],
      dirtyMetaShards: [],
      dirtyDetailShards: [],
      dirtyPostingBuckets: [],
      dirtyRelations: entries.map(item => item.documentId),
    };
  }

  private emitProgress(input: TagRecomputeRunInput, progress: TagRecomputeProgressSnapshot): void {
    input.onProgress?.(progress);
  }

  private hasTagDefinitionDriftSinceLastExport(repository: CatalogRepository): boolean {
    const statusPath = path.join(this.config.exportDir, "status.json");
    if (!fs.existsSync(statusPath)) {
      return true;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(statusPath, "utf8")) as { exported_at?: string };
      const exportedAt = typeof raw.exported_at === "string" ? raw.exported_at : "";
      if (!exportedAt) {
        return true;
      }
      return repository.listTagDefinitions(true).some((definition) => definition.updatedAt > exportedAt);
    } catch {
      return true;
    }
  }
}

function isDirtyScopeEmpty(scope: DirtyScope): boolean {
  return scope.changedPaths.length === 0
    && scope.dirtyDirectories.length === 0
    && scope.dirtyTagPaths.length === 0
    && scope.dirtyMetaShards.length === 0
    && scope.dirtyDetailShards.length === 0
    && scope.dirtyPostingBuckets.length === 0
    && scope.dirtyRelations.length === 0;
}

function isFolderBindingOnlyScope(scope: RecomputeScope): boolean {
  return scope.kind === "folder" && scope.mode === "folder_bindings_only";
}

function resolveProgressPercent(
  phase: TagRecomputeProgressSnapshot["phase"],
  current: number,
  total: number,
): number {
  const safeTotal = total > 0 ? total : 1;
  const loopRatio = Math.min(1, Math.max(0, current / safeTotal));
  switch (phase) {
    case "prepare":
      return total === 0 ? 100 : 2;
    case "recompute":
      return Math.round(8 + loopRatio * 82);
    case "write":
      return 94;
    case "export":
      return 98;
    case "finished":
      return 100;
    default:
      return 0;
  }
}

function buildFileScanResult(rootDir: string, row: TagRecomputeDocumentRow): FileScanResult {
  return {
    relativePath: row.path,
    fullPath: path.join(rootDir, row.path),
    name: path.posix.basename(row.path),
    extension: row.extension,
    size: 0,
    mtime: row.mtime,
    ctime: row.ctime,
  };
}

function buildParsedDocument(row: TagRecomputeDocumentRow): ParsedDocument {
  const pathText = row.path.split(/[\/_-]/g).join("\n");
  return {
    title: row.title,
    summary: row.summary,
    text: `${row.title}\n${row.summary}\n${row.contentText}\n${pathText}`,
    parser: "sqlite_metadata",
  };
}

function evaluateSmartRuleGroup(
  file: FileScanResult,
  row: TagRecomputeDocumentRow,
  parsed: ParsedDocument,
  rules: TagRuleRow[],
): { ruleId: string; evidence: string } | null {
  const sortedRules = [...rules].sort((left, right) => left.priority - right.priority);
  const matchedAnd: Array<{ ruleId: string; evidence: string }> = [];
  const matchedOr: Array<{ ruleId: string; evidence: string }> = [];
  let hasOrRule = false;

  for (const rule of sortedRules) {
    const match = evaluateSingleSmartRule(file, row, parsed, rule);
    if (rule.relation === "not") {
      if (match) {
        return null;
      }
      continue;
    }
    if (rule.relation === "or") {
      hasOrRule = true;
      if (match) {
        matchedOr.push({
          ruleId: rule.id,
          evidence: resolveSmartRuleEvidence(rule),
        });
      }
      continue;
    }
    if (!match) {
      return null;
    }
    matchedAnd.push({
      ruleId: rule.id,
      evidence: resolveSmartRuleEvidence(rule),
    });
  }

  if (hasOrRule && matchedOr.length === 0) {
    return null;
  }

  const evidenceItems = [...matchedAnd, ...matchedOr];
  if (evidenceItems.length === 0) {
    return null;
  }

  return {
    ruleId: evidenceItems[0]?.ruleId ?? sortedRules[0]!.id,
    evidence: evidenceItems.map(item => item.evidence).join("；"),
  };
}

function evaluateSingleSmartRule(
  file: FileScanResult,
  row: TagRecomputeDocumentRow,
  parsed: ParsedDocument,
  rule: TagRuleRow,
): boolean {
  switch (rule.ruleType) {
    case "file_name_contains": {
      const keyword = String((rule.matcher as { keyword?: string }).keyword ?? "").trim().toLowerCase();
      return keyword.length > 0 && file.name.toLowerCase().includes(keyword);
    }
    case "file_content_contains": {
      const keyword = String((rule.matcher as { keyword?: string }).keyword ?? "").trim().toLowerCase();
      return keyword.length > 0 && parsed.text.toLowerCase().includes(keyword);
    }
    case "file_extension_in": {
      const rawExtensions = Array.isArray((rule.matcher as { extensions?: string[] }).extensions)
        ? (rule.matcher as { extensions?: string[] }).extensions ?? []
        : [];
      const extensions = rawExtensions
        .map(item => item.trim().toLowerCase())
        .filter(Boolean)
        .map(item => item.startsWith(".") ? item : `.${item}`);
      return extensions.includes(file.extension.toLowerCase());
    }
    case "modified_time_between": {
      const matcher = rule.matcher as { start?: string | null; end?: string | null };
      const modifiedAt = new Date(row.mtime);
      if (Number.isNaN(modifiedAt.getTime())) {
        return false;
      }
      const startTime = matcher.start ? new Date(matcher.start).getTime() : null;
      const endTime = matcher.end ? new Date(matcher.end).getTime() : null;
      if (startTime !== null && Number.isNaN(startTime)) {
        return false;
      }
      if (endTime !== null && Number.isNaN(endTime)) {
        return false;
      }
      if (startTime !== null && modifiedAt.getTime() < startTime) {
        return false;
      }
      if (endTime !== null && modifiedAt.getTime() > endTime) {
        return false;
      }
      return startTime !== null || endTime !== null;
    }
    case "document_path_in_folder": {
      const folderPath = normalizeFolderScopeMatcherPath((rule.matcher as { folderPath?: string | null }).folderPath);
      return matchesDocumentPathInFolderScope(row.path, folderPath);
    }
    default:
      return false;
  }
}

function resolveSmartRuleEvidence(rule: TagRuleRow): string {
  switch (rule.ruleType) {
    case "file_name_contains":
      return `文件名包含“${String((rule.matcher as { keyword?: string }).keyword ?? "").trim()}”`;
    case "file_content_contains":
      return `文件内容包含“${String((rule.matcher as { keyword?: string }).keyword ?? "").trim()}”`;
    case "file_extension_in": {
      const extensions = Array.isArray((rule.matcher as { extensions?: string[] }).extensions)
        ? (rule.matcher as { extensions?: string[] }).extensions ?? []
        : [];
      return `文件类型命中：${extensions.join("、")}`;
    }
    case "modified_time_between": {
      const matcher = rule.matcher as { start?: string | null; end?: string | null };
      if (matcher.start && matcher.end) {
        return `修改时间介于 ${matcher.start} 到 ${matcher.end}`;
      }
      if (matcher.start) {
        return `修改时间晚于 ${matcher.start}`;
      }
      if (matcher.end) {
        return `修改时间早于 ${matcher.end}`;
      }
      return "修改时间命中";
    }
    case "document_path_in_folder": {
      const folderPath = normalizeFolderScopeMatcherPath((rule.matcher as { folderPath?: string | null }).folderPath);
      return folderPath === "."
        ? "位于根目录及其子文件夹"
        : `位于“${folderPath}”及其子文件夹`;
    }
    default:
      return "规则命中";
  }
}

function normalizeFolderScopeMatcherPath(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim().replace(/^\.\/+/, "").replace(/\/+$/g, "");
  return normalized || ".";
}

function matchesDocumentPathInFolderScope(documentPath: string, folderPath: string): boolean {
  if (folderPath === ".") {
    return true;
  }
  return documentPath === folderPath || documentPath.startsWith(`${folderPath}/`);
}
