import path from "node:path";
import { performance } from "node:perf_hooks";
import type { RuntimeConfig } from "../../../../contracts/src/index.js";
import {
  CatalogRepository,
  type RecomputeScope,
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

export interface TagRecomputeRunInput {
  scope?: RecomputeScope;
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

  run(input: TagRecomputeRunInput = {}): TagRecomputeResult {
    const startedAt = performance.now();
    const repository = new CatalogRepository(this.config.dbPath);
    const writer = new CatalogWriteRepository(this.config.dbPath);
    const tagger = new SimpleTagInferenceEngine();
    const observedAt = new Date().toISOString();
    const scope = input.scope ?? { kind: "full" as const };
    const dirtyTagPaths = new Set<string>();
    let scannedCount = 0;
    let updatedCount = 0;
    let directAssignedCount = 0;
    let derivedAssignedCount = 0;
    let inferMs = 0;
    let writeMs = 0;

    const documents = repository.listRecomputeCandidateDocuments(scope);
    const documentIds = documents.map(item => item.documentId);
    const documentPaths = documents.map(item => item.path);
    const manualBindingsByDocument = this.resolveManualAssignments(repository, documentIds);
    const folderBindingsByDocument = this.resolveFolderAssignments(repository, documentPaths);
    const smartRules = repository.listAllEnabledTagRules();

    const accumulators = new Map<string, ResolvedTagAccumulator>();

    const inferStartedAt = performance.now();
    for (const row of documents) {
      const file = buildFileScanResult(this.config.rootDir, row);
      const parsed = buildParsedDocument(row);
      const inferred = tagger.infer(file, parsed);
      const manualBindings = manualBindingsByDocument.get(row.documentId) ?? [];
      const folderBindings = folderBindingsByDocument.get(row.documentId) ?? [];
      const smartBindings = this.resolveSmartRuleAssignments(file, row, parsed, smartRules);
      const accumulator = this.mergeResolvedAssignments(
        row.documentId,
        inferred,
        manualBindings,
        folderBindings,
        smartBindings,
      );
      accumulators.set(row.documentId, accumulator);
      directAssignedCount += accumulator.entries.filter(item => item.sourceType !== "system_derived").length;
      derivedAssignedCount += accumulator.entries.filter(item => item.sourceType === "system_derived").length;
      accumulator.entries.forEach(entry => {
        collectTagAncestors(entry.tagPath).forEach(tagPath => dirtyTagPaths.add(tagPath));
      });
      scannedCount += 1;
    }
    inferMs += performance.now() - inferStartedAt;

    const writeStartedAt = performance.now();
    const written = writer.recomputeResolvedTags(
      [...accumulators.values()].flatMap(item => item.entries),
      observedAt,
      documentIds,
    );
    writeMs += performance.now() - writeStartedAt;
    updatedCount += written.updatedCount;

    const dirtyScope = this.buildDirtyScopeFromResolvedEntries(
      [...accumulators.values()].flatMap(item => item.entries),
      dirtyTagPaths,
    );
    const exportStartedAt = performance.now();
    const exportResult = new ExportBuilder(this.config).build({
      dirtyScope: {
        ...dirtyScope,
        trigger: "full",
      },
      light: true,
    });
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

  private resolveFolderAssignments(repository: CatalogRepository, documentPaths: string[]) {
    const rows = repository.listEffectiveFolderTagBindingsForDocumentPaths(documentPaths);
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
    default:
      return "规则命中";
  }
}
