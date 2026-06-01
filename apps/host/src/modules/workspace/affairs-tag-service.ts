import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { AppError } from "../../shared/errors/app-error.js";
import type { TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES } from "../tasks/task-types.js";
import type { WorkspaceService } from "./workspace-service.js";
import type { AffairsLibraryService } from "./affairs-library-service.js";
import {
  CatalogRepository,
  type RecomputeScope,
  type RecommendationBatchRow,
  type RecommendationItemRow,
  type TagDefinitionRow,
  type TagResolvedSourceType,
} from "../affairs-indexer/core/src/repositories/catalog-repository.js";
import {
  CatalogWriteRepository,
  type SaveRecommendationItemDecisionInput,
  type SaveTagRuleInput,
} from "../affairs-indexer/core/src/repositories/catalog-write-repository.js";
import { createAffairsIndexerRuntimeConfig } from "../affairs-indexer/internal-command-runner.js";
import { TagRecomputeService } from "../affairs-indexer/core/src/services/tagging/tag-recompute-service.js";
import { ExportBuilder } from "../affairs-indexer/core/src/services/export/export-builder.js";
import { openDatabase } from "../affairs-indexer/core/src/sqlite/open-database.js";

interface WorkspaceNavigationStateRepositoryLike {
  findByWorkspaceIdAndUserId(workspaceId: string, userId: string): {
    affairsLibraryRootPath?: string | null;
    affairsLibraryEnabled?: boolean;
  } | null;
}

export interface AffairsTagNodeDto {
  id: string;
  path: string;
  name: string;
  rootType: string;
  parentId: string | null;
  parentPath: string | null;
  description: string | null;
  status: "active" | "disabled";
  ruleEnabled: boolean;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
}

export interface AffairsTagRuleDto {
  id: string;
  enabled: boolean;
  ruleType: string;
  scope: string[];
  matcher: Record<string, unknown>;
  minScore: number | null;
  priority: number;
  source: string;
  updatedAt: string;
}

export interface AffairsTagDetailDto extends AffairsTagNodeDto {
  rules: AffairsTagRuleDto[];
}

export interface AffairsResolvedTagSourceDto {
  path: string;
  sourceType: TagResolvedSourceType;
  sourceRef: string | null;
  evidence: string | null;
  confidence: number;
  priority: number;
}

export interface AffairsDocumentTagDetailsDto {
  documentId: string;
  path: string;
  title: string;
  manualTagIds: string[];
  effectiveFolderBindings: Array<{
    id: string;
    folderPath: string;
    tagId: string;
    tagPath: string;
  }>;
  resolvedTags: AffairsResolvedTagSourceDto[];
}

export interface AffairsFolderTagDetailsDto {
  folderPath: string;
  exists: boolean;
  bindingTagIds: string[];
  bindings: Array<{
    id: string;
    tagId: string;
    tagPath: string;
    applyMode: string;
  }>;
}

export interface AffairsTagRecommendationItemDto {
  id: string;
  proposedPath: string;
  proposedName: string;
  proposedParentPath: string | null;
  documentCount: number;
  evidence: Record<string, unknown>;
  selectedByDefault: boolean;
  status: string;
}

export interface AffairsTagRecommendationBatchDto {
  id: string;
  status: string;
  summary: string | null;
  generatedAt: string;
  updatedAt: string;
  evidenceSnapshot: Record<string, unknown> | null;
  items?: AffairsTagRecommendationItemDto[];
}

export interface ApplyAffairsTagRecommendationBatchResultDto {
  batch: AffairsTagRecommendationBatchDto;
  createdTags: AffairsTagDetailDto[];
  exportRefreshTask: {
    taskId: string;
    deduped: boolean;
    status: "queued";
  };
}

export class AffairsTagService {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceNavigationStateRepository: WorkspaceNavigationStateRepositoryLike,
    private readonly affairsLibraryService: AffairsLibraryService,
    private readonly taskManager: TaskManager,
  ) {
    this.registerBackgroundTasks();
  }

  listTags(workspaceId: string, userId: string, input: { includeDisabled?: boolean } = {}) {
    const { dbPath } = this.requireBinding(workspaceId, userId);
    const repository = new CatalogRepository(dbPath);
    const definitions = repository.listTagDefinitions(input.includeDisabled === true);
    const rules = repository.listTagRulesByTagIds(definitions.map(item => item.id));
    const resolvedRows = repository.listExportDocuments().flatMap(doc => [
      ...doc.tags.map(tagPath => ({ tagPath, derived: false })),
      ...doc.derivedTags.map(tagPath => ({ tagPath, derived: true })),
    ]);
    const countByPath = new Map<string, number>();
    resolvedRows.forEach(row => {
      countByPath.set(row.tagPath, (countByPath.get(row.tagPath) ?? 0) + 1);
    });
    const parentPathById = new Map(definitions.map(item => [item.id, item.path]));
    const rulesByTagId = new Map<string, boolean>();
    rules.forEach(rule => {
      if (rule.enabled) {
        rulesByTagId.set(rule.tagId, true);
      }
    });

    const items = definitions.map((tag) => this.toTagNodeDto(tag, parentPathById, rulesByTagId.get(tag.id) === true, countByPath.get(tag.path) ?? 0));
    return {
      items,
      summary: {
        totalActiveTags: items.filter(item => item.status === "active").length,
        totalDisabledTags: items.filter(item => item.status === "disabled").length,
        totalRuleEnabledTags: items.filter(item => item.ruleEnabled).length,
        totalBoundDocuments: new Set(resolvedRows.map(item => item.tagPath)).size,
      },
      status: {
        recomputeState: "idle" as const,
        lastRecomputedAt: null,
        lastError: null,
      },
    };
  }

  getTagDetail(workspaceId: string, userId: string, tagId: string): AffairsTagDetailDto {
    const { dbPath } = this.requireBinding(workspaceId, userId);
    const repository = new CatalogRepository(dbPath);
    const definition = repository.getTagDefinitionById(tagId);
    if (!definition) {
      throw new AppError({
        statusCode: 404,
        errorCode: "AFFAIRS_TAG_NOT_FOUND",
        detail: "标签不存在",
      });
    }
    const rules = repository.listTagRulesByTagIds([tagId]).map(mapTagRuleDto);
    const definitions = repository.listTagDefinitions(true);
    const parentPathById = new Map(definitions.map(item => [item.id, item.path]));
    return {
      ...this.toTagNodeDto(definition, parentPathById, rules.some(item => item.enabled), 0),
      rules,
    };
  }

  saveTagDefinition(
    workspaceId: string,
    userId: string,
    input: {
      tagId?: string;
      name: string;
      parentId?: string | null;
      description?: string | null;
      status?: "active" | "disabled";
    },
  ): AffairsTagDetailDto {
    const { dbPath, rootDir } = this.requireBinding(workspaceId, userId);
    const repository = new CatalogRepository(dbPath);
    const writer = new CatalogWriteRepository(dbPath);
    const existingDefinitions = repository.listTagDefinitions(true);
    const current = input.tagId
      ? existingDefinitions.find(item => item.id === input.tagId) ?? null
      : null;
    const parent = input.parentId ? existingDefinitions.find(item => item.id === input.parentId) ?? null : null;
    if (input.parentId && !parent) {
      throw new AppError({
        statusCode: 400,
        errorCode: "AFFAIRS_TAG_PARENT_NOT_FOUND",
        detail: "父标签不存在",
        field: "parentId",
      });
    }
    if (current && parent && isDescendantTag(existingDefinitions, parent.id, current.id)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "AFFAIRS_TAG_PARENT_CYCLE",
        detail: "不能把标签移动到自己的下级标签下面",
        field: "parentId",
      });
    }
    const normalizedName = input.name.trim();
    if (!normalizedName) {
      throw new AppError({
        statusCode: 400,
        errorCode: "AFFAIRS_TAG_NAME_REQUIRED",
        detail: "标签名称不能为空",
        field: "name",
      });
    }
    const nextPath = [parent?.path, normalizedName].filter(Boolean).join("/") || normalizedName;
    const conflict = existingDefinitions.find(item => item.path === nextPath && item.id !== input.tagId);
    if (conflict) {
      throw new AppError({
        statusCode: 409,
        errorCode: "AFFAIRS_TAG_PATH_CONFLICT",
        detail: "标签路径已存在，请换一个名称或层级",
        field: "name",
      });
    }
    const rootType = parent?.rootType ?? normalizedName;
    if (current) {
      const descendantUpdates = buildDescendantTagPathUpdates(existingDefinitions, current, nextPath, rootType);
      const conflictPaths = new Set([nextPath, ...descendantUpdates.map(item => item.nextPath)]);
      const conflict = existingDefinitions.find(item => item.id !== current.id
        && !descendantUpdates.some(update => update.tag.id === item.id)
        && conflictPaths.has(item.path));
      if (conflict) {
        throw new AppError({
          statusCode: 409,
          errorCode: "AFFAIRS_TAG_PATH_CONFLICT",
          detail: "标签移动后会和现有标签路径冲突",
          field: "parentId",
        });
      }
    }
    const result = writer.saveTagDefinition({
      id: input.tagId,
      path: nextPath,
      name: normalizedName,
      rootType,
      parentId: parent?.id ?? null,
      canonicalName: normalizedName,
      description: input.description ?? null,
      status: input.status ?? "active",
      createdBy: userId || "user",
    });
    if (current) {
      buildDescendantTagPathUpdates(existingDefinitions, current, nextPath, rootType)
        .forEach(({ tag, nextPath: childPath }) => {
          writer.saveTagDefinition({
            id: tag.id,
            path: childPath,
            name: tag.name,
            rootType,
            parentId: tag.parentId,
            canonicalName: tag.canonicalName,
            description: tag.description,
            status: tag.status === "disabled" ? "disabled" : "active",
            createdBy: tag.createdBy,
          });
        });
    }
    const detail = this.getTagDetail(workspaceId, userId, result.id);
    this.taskManager.enqueue<{ workspaceId: string; rootDir: string; reason: string }, { ok: true }>(
      HOST_TASK_TYPES.affairsLibraryTagExportRefresh,
      {
        key: `${workspaceId}:full`,
        source: "affairs_tag.save_tag_definition",
        input: {
          workspaceId,
          rootDir,
          reason: `tag_definition_saved:${result.id}`,
        },
      },
    );
    return detail;
  }

  deleteTagDefinition(workspaceId: string, userId: string, tagId: string) {
    const { dbPath, rootDir } = this.requireBinding(workspaceId, userId);
    const repository = new CatalogRepository(dbPath);
    const writer = new CatalogWriteRepository(dbPath);
    const definitions = repository.listTagDefinitions(true);
    const current = definitions.find(item => item.id === tagId) ?? null;
    if (!current) {
      throw new AppError({
        statusCode: 404,
        errorCode: "AFFAIRS_TAG_NOT_FOUND",
        detail: "标签不存在",
      });
    }
    const descendants = collectDescendantTags(definitions, current.id);
    const deleteRows = [current, ...descendants];
    const deletedTagIds = deleteRows.map(item => item.id);
    const deletedPaths = deleteRows.map(item => item.path);
    writer.deleteTagDefinitions([...descendants].reverse().map(item => item.id).concat(current.id));
    const handle = this.taskManager.enqueue<{ workspaceId: string; rootDir: string; reason: string }, { ok: true }>(
      HOST_TASK_TYPES.affairsLibraryTagExportRefresh,
      {
        key: `${workspaceId}:full`,
        source: "affairs_tag.delete_tag_definition",
        input: {
          workspaceId,
          rootDir,
          reason: `tag_definition_deleted:${tagId}`,
        },
      },
    );
    return {
      deletedTagIds,
      deletedPaths,
      exportRefreshTask: {
        taskId: handle.taskId,
        deduped: handle.deduped,
        status: "queued" as const,
      },
    };
  }

  saveTagRules(
    workspaceId: string,
    userId: string,
    tagId: string,
    rules: Array<{
      id?: string;
      enabled?: boolean;
      ruleType?: string;
      scope?: string[];
      matcher?: Record<string, unknown>;
      minScore?: number | null;
      priority?: number;
      source?: string;
    }>,
  ) {
    const { dbPath, rootDir } = this.requireBinding(workspaceId, userId);
    const repository = new CatalogRepository(dbPath);
    if (!repository.getTagDefinitionById(tagId)) {
      throw new AppError({
        statusCode: 404,
        errorCode: "AFFAIRS_TAG_NOT_FOUND",
        detail: "标签不存在",
      });
    }
    const writer = new CatalogWriteRepository(dbPath);
    const normalizedRules: SaveTagRuleInput[] = rules.map((rule, index) => ({
      id: rule.id?.trim() || createStableId("tag_rule", `${tagId}:${index}:${JSON.stringify(rule.matcher ?? {})}`),
      enabled: rule.enabled === true,
      ruleType: rule.ruleType?.trim() || "keyword",
      scopeJson: JSON.stringify(rule.scope ?? ["path", "title", "summary", "body"]),
      matcherJson: JSON.stringify(rule.matcher ?? {}),
      minScore: typeof rule.minScore === "number" ? rule.minScore : null,
      priority: typeof rule.priority === "number" ? rule.priority : 0,
      source: rule.source?.trim() || "user",
    }));
    writer.upsertTagRules(tagId, normalizedRules);
    const detail = this.getTagDetail(workspaceId, userId, tagId);
    const handle = this.taskManager.enqueue<{ workspaceId: string; rootDir: string; reason: string; scope?: RecomputeScope }, { ok: true }>(
      HOST_TASK_TYPES.affairsLibraryTagRecompute,
      {
        key: `${workspaceId}:tag:${tagId}`,
        source: "affairs_tag.save_rules",
        input: {
          workspaceId,
          rootDir,
          reason: `tag_rule_saved:${tagId}`,
          scope: { kind: "tag", tagId },
        },
      },
    );
    return {
      tag: detail,
      rules: detail.rules,
      recomputeTask: {
        taskId: handle.taskId,
        deduped: handle.deduped,
        status: "queued" as const,
        affectedTagPaths: [detail.path],
      },
    };
  }

  getDocumentTagDetails(workspaceId: string, userId: string, documentId: string): AffairsDocumentTagDetailsDto {
    const { dbPath } = this.requireBinding(workspaceId, userId);
    const repository = new CatalogRepository(dbPath);
    const context = repository.getDocumentContext(documentId);
    if (!context) {
      throw new AppError({
        statusCode: 404,
        errorCode: "AFFAIRS_DOCUMENT_NOT_FOUND",
        detail: "文档不存在",
      });
    }
    const manualBindings = repository.listManualDocumentTagBindingsByDocumentIds([documentId]);
    const folderBindings = repository.listEffectiveFolderTagBindingsForDocumentPaths([context.path]);
    const resolved = repository.listResolvedDocumentTagsByDocumentIds([documentId]);
    return {
      documentId,
      path: context.path,
      title: context.title,
      manualTagIds: manualBindings.map(item => item.tagId),
      effectiveFolderBindings: folderBindings.map(item => ({
        id: item.id,
        folderPath: item.folderPath,
        tagId: item.tagId,
        tagPath: item.tagPath,
      })),
      resolvedTags: resolved.map(item => ({
        path: item.path,
        sourceType: item.sourceType,
        sourceRef: item.sourceRef,
        evidence: item.evidence,
        confidence: item.confidence,
        priority: resolvePriority(item.sourceType),
      })),
    };
  }

  saveDocumentTagBindings(workspaceId: string, userId: string, documentId: string, tagIds: string[]) {
    const { dbPath, rootDir } = this.requireBinding(workspaceId, userId);
    const repository = new CatalogRepository(dbPath);
    const context = repository.getDocumentContext(documentId);
    if (!context) {
      throw new AppError({
        statusCode: 404,
        errorCode: "AFFAIRS_DOCUMENT_NOT_FOUND",
        detail: "文档不存在",
      });
    }
    const writer = new CatalogWriteRepository(dbPath);
    writer.replaceManualDocumentTagBindings(documentId, tagIds);
    const handle = this.taskManager.enqueue<{ workspaceId: string; rootDir: string; reason: string; scope?: RecomputeScope }, { ok: true }>(
      HOST_TASK_TYPES.affairsLibraryTagApplyBindings,
      {
        key: `${workspaceId}:doc:${documentId}`,
        source: "affairs_tag.save_document_bindings",
        input: {
          workspaceId,
          rootDir,
          reason: `manual_document_binding_saved:${documentId}`,
          scope: { kind: "document", documentId },
        },
      },
    );
    return {
      target: {
        type: "document" as const,
        documentId,
      },
      items: this.getDocumentTagDetails(workspaceId, userId, documentId).resolvedTags,
      refreshTask: {
        taskId: handle.taskId,
        deduped: handle.deduped,
        affectedPaths: [context.path],
      },
    };
  }

  getFolderTagDetails(workspaceId: string, userId: string, folderPath: string): AffairsFolderTagDetailsDto {
    const { dbPath, rootDir } = this.requireBinding(workspaceId, userId);
    const normalizedFolderPath = normalizeFolderPath(folderPath);
    const exists = normalizedFolderPath === "."
      ? fs.existsSync(rootDir) && fs.statSync(rootDir).isDirectory()
      : this.affairsLibraryService.resolvePreviewFile(workspaceId, userId, normalizedFolderPath, {
        mustExist: false,
        kind: "directory",
      }).exists;
    const repository = new CatalogRepository(dbPath);
    const bindings = repository.listFolderTagBindingsByPaths([normalizedFolderPath]);
    return {
      folderPath: normalizedFolderPath,
      exists,
      bindingTagIds: bindings.map(item => item.tagId),
      bindings: bindings.map(item => ({
        id: item.id,
        tagId: item.tagId,
        tagPath: item.tagPath,
        applyMode: item.applyMode,
      })),
    };
  }

  saveFolderTagBindings(workspaceId: string, userId: string, folderPath: string, tagIds: string[]) {
    const { dbPath, rootDir } = this.requireBinding(workspaceId, userId);
    const normalizedFolderPath = normalizeFolderPath(folderPath);
    const writer = new CatalogWriteRepository(dbPath);
    writer.replaceFolderTagBindings(normalizedFolderPath, tagIds);
    const handle = this.taskManager.enqueue<{ workspaceId: string; rootDir: string; reason: string; scope?: RecomputeScope }, { ok: true }>(
      HOST_TASK_TYPES.affairsLibraryTagApplyBindings,
      {
        key: `${workspaceId}:folder:${normalizedFolderPath}`,
        source: "affairs_tag.save_folder_bindings",
        input: {
          workspaceId,
          rootDir,
          reason: `folder_binding_saved:${normalizedFolderPath}`,
          scope: { kind: "folder", folderPath: normalizedFolderPath },
        },
      },
    );
    return {
      target: {
        type: "folder" as const,
        folderPath: normalizedFolderPath,
      },
      items: [],
      refreshTask: {
        taskId: handle.taskId,
        deduped: handle.deduped,
        affectedPaths: [normalizedFolderPath],
      },
    };
  }

  listRecommendationBatches(workspaceId: string, userId: string): AffairsTagRecommendationBatchDto[] {
    const { dbPath } = this.requireBinding(workspaceId, userId);
    const repository = new CatalogRepository(dbPath);
    return repository.listRecommendationBatches().map(item => this.mapRecommendationBatch(item));
  }

  getRecommendationBatch(workspaceId: string, userId: string, batchId: string): AffairsTagRecommendationBatchDto {
    const { dbPath } = this.requireBinding(workspaceId, userId);
    const repository = new CatalogRepository(dbPath);
    const batch = repository.getRecommendationBatchById(batchId);
    if (!batch) {
      throw new AppError({
        statusCode: 404,
        errorCode: "AFFAIRS_TAG_RECOMMENDATION_BATCH_NOT_FOUND",
        detail: "推荐批次不存在",
      });
    }
    return {
      ...this.mapRecommendationBatch(batch),
      items: repository.listRecommendationItemsByBatchId(batchId).map(mapRecommendationItemDto),
    };
  }

  applyRecommendationBatch(
    workspaceId: string,
    userId: string,
    batchId: string,
    input: {
      items?: Array<{
        itemId: string;
        proposedPath?: string;
        proposedName?: string;
        proposedParentPath?: string | null;
        selected?: boolean;
      }> | null;
    } = {},
  ): ApplyAffairsTagRecommendationBatchResultDto {
    const { dbPath, rootDir } = this.requireBinding(workspaceId, userId);
    const repository = new CatalogRepository(dbPath);
    const writer = new CatalogWriteRepository(dbPath);
    const batch = repository.getRecommendationBatchById(batchId);
    if (!batch) {
      throw new AppError({
        statusCode: 404,
        errorCode: "AFFAIRS_TAG_RECOMMENDATION_BATCH_NOT_FOUND",
        detail: "推荐批次不存在",
      });
    }
    if (batch.status !== "draft") {
      throw new AppError({
        statusCode: 409,
        errorCode: "AFFAIRS_TAG_RECOMMENDATION_BATCH_NOT_DRAFT",
        detail: "只有草稿批次可以导入",
      });
    }

    const currentItems = repository.listRecommendationItemsByBatchId(batchId);
    const decisionsById = new Map((input.items ?? []).map(item => [item.itemId, item]));
    const decisionWrites: SaveRecommendationItemDecisionInput[] = [];
    const acceptedItems: typeof currentItems = [];

    currentItems.forEach((item) => {
      const decision = decisionsById.get(item.id);
      const selected = decision?.selected ?? item.selectedByDefault;
      const proposedPath = decision?.proposedPath?.trim() || item.proposedPath;
      const proposedParentPath = decision?.proposedParentPath === undefined
        ? item.proposedParentPath
        : decision.proposedParentPath?.trim() || null;
      const proposedName = decision?.proposedName?.trim() || inferTagNameFromPath(proposedPath);
      decisionWrites.push({
        itemId: item.id,
        proposedPath,
        proposedName,
        proposedParentPath,
        selectedByDefault: selected,
        status: selected ? "accepted" : "rejected",
      });
      if (selected) {
        acceptedItems.push({
          ...item,
          proposedPath,
          proposedName,
          proposedParentPath,
          selectedByDefault: selected,
          status: "accepted",
        });
      }
    });

    const now = new Date().toISOString();
    writer.replaceRecommendationItemDecisions(batchId, decisionWrites, now);

    const existingDefinitions = repository.listTagDefinitions(true);
    const tagByPath = new Map(existingDefinitions.map(item => [item.path, item]));
    const createdTags: AffairsTagDetailDto[] = [];

    acceptedItems
      .sort((left, right) => left.proposedPath.localeCompare(right.proposedPath, "zh-Hans-CN"))
      .forEach((item) => {
        const normalizedPath = item.proposedPath.trim().replace(/^\/+|\/+$/g, "");
        if (!normalizedPath) {
          return;
        }
        const segments = normalizedPath.split("/").map(segment => segment.trim()).filter(Boolean);
        let parentRow: TagDefinitionRow | null = null;
        segments.forEach((segment, index) => {
          const currentPath = segments.slice(0, index + 1).join("/");
          const existing = tagByPath.get(currentPath) ?? null;
          if (existing) {
            parentRow = existing;
            return;
          }
          const rootType = parentRow?.rootType ?? segments[0] ?? segment;
          const saved = writer.saveTagDefinition({
            path: currentPath,
            name: index === segments.length - 1
              ? (item.proposedName.trim() || segment)
              : segment,
            rootType,
            parentId: parentRow?.id ?? null,
            canonicalName: index === segments.length - 1
              ? (item.proposedName.trim() || segment)
              : segment,
            description: index === segments.length - 1
              ? (item.documentCount > 0 ? `推荐导入，命中文档 ${item.documentCount} 份` : "推荐导入")
              : "推荐导入自动补齐的父标签",
            status: "active",
            createdBy: userId || "user",
          }, now);
          const detail = this.getTagDetail(workspaceId, userId, saved.id);
          createdTags.push(detail);
          const row: TagDefinitionRow = {
            id: detail.id,
            path: detail.path,
            name: detail.name,
            rootType: detail.rootType,
            parentId: detail.parentId,
            canonicalName: detail.name,
            description: detail.description,
            status: detail.status,
            createdBy: userId || "user",
            createdAt: detail.createdAt,
            updatedAt: detail.updatedAt,
            disabledAt: detail.disabledAt,
          };
          tagByPath.set(detail.path, row);
          parentRow = row;
        });
      });

    writer.updateRecommendationBatchStatus(batchId, "applied", now);

    const handle = this.taskManager.enqueue<{ workspaceId: string; rootDir: string; reason: string }, { ok: true }>(
      HOST_TASK_TYPES.affairsLibraryTagExportRefresh,
      {
        key: `${workspaceId}:full`,
        source: "affairs_tag.apply_recommendation_batch",
        input: {
          workspaceId,
          rootDir,
          reason: `apply_tag_recommendation_batch:${batchId}`,
        },
      },
    );

    return {
      batch: this.getRecommendationBatch(workspaceId, userId, batchId),
      createdTags,
      exportRefreshTask: {
        taskId: handle.taskId,
        deduped: handle.deduped,
        status: "queued",
      },
    };
  }

  discardRecommendationBatch(workspaceId: string, userId: string, batchId: string): AffairsTagRecommendationBatchDto {
    const { dbPath } = this.requireBinding(workspaceId, userId);
    const repository = new CatalogRepository(dbPath);
    const writer = new CatalogWriteRepository(dbPath);
    const batch = repository.getRecommendationBatchById(batchId);
    if (!batch) {
      throw new AppError({
        statusCode: 404,
        errorCode: "AFFAIRS_TAG_RECOMMENDATION_BATCH_NOT_FOUND",
        detail: "推荐批次不存在",
      });
    }
    if (batch.status !== "draft") {
      throw new AppError({
        statusCode: 409,
        errorCode: "AFFAIRS_TAG_RECOMMENDATION_BATCH_NOT_DRAFT",
        detail: "只有草稿批次可以放弃",
      });
    }
    const now = new Date().toISOString();
    const decisions = repository.listRecommendationItemsByBatchId(batchId).map((item) => ({
      itemId: item.id,
      proposedPath: item.proposedPath,
      proposedName: item.proposedName,
      proposedParentPath: item.proposedParentPath,
      selectedByDefault: false,
      status: "rejected" as const,
    }));
    writer.replaceRecommendationItemDecisions(batchId, decisions, now);
    writer.updateRecommendationBatchStatus(batchId, "discarded", now);
    return this.getRecommendationBatch(workspaceId, userId, batchId);
  }

  createRecommendationBatch(workspaceId: string, userId: string) {
    const { dbPath, rootDir } = this.requireBinding(workspaceId, userId);
    const repository = new CatalogRepository(dbPath);
    const exportDocuments = repository.listExportDocuments();
    const candidateMap = new Map<string, { count: number; titles: string[] }>();
    exportDocuments.forEach(doc => {
      const folderName = normalizeFolderPath(path.dirname(doc.path));
      const segments = folderName.split("/").filter(Boolean);
      if (segments.length === 0) {
        return;
      }
      const top = segments[0]!;
      const current = candidateMap.get(top) ?? { count: 0, titles: [] };
      current.count += 1;
      if (current.titles.length < 5) {
        current.titles.push(doc.title);
      }
      candidateMap.set(top, current);
    });
    const batchId = createStableId("tag_batch", `${workspaceId}:${Date.now()}`);
    const observedAt = new Date().toISOString();
    const batchSummary = `基于当前文档库目录和文档标题生成了 ${candidateMap.size} 组候选标签。`;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = openDatabase(dbPath);
    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare(`
        INSERT INTO tag_recommendation_batches(id, status, summary, evidence_snapshot_json, generated_at, updated_at)
        VALUES(?, 'draft', ?, ?, ?, ?)
      `).run(
        batchId,
        batchSummary,
        JSON.stringify({ candidateCount: candidateMap.size }),
        observedAt,
        observedAt,
      );
      let index = 0;
      for (const [key, value] of candidateMap.entries()) {
        const proposedPath = `推荐/${key}`;
        const itemId = createStableId("tag_batch_item", `${batchId}:${key}`);
        db.prepare(`
          INSERT INTO tag_recommendation_items(
            id,
            batch_id,
            proposed_path,
            proposed_name,
            proposed_parent_path,
            document_count,
            evidence_json,
            selected_by_default,
            status,
            created_at,
            updated_at
          )
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
        `).run(
          itemId,
          batchId,
          proposedPath,
          key,
          "推荐",
          value.count,
          JSON.stringify({ sampleTitles: value.titles }),
          index < 5 ? 1 : 0,
          observedAt,
          observedAt,
        );
        index += 1;
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      db.close();
    }
    const handle = this.taskManager.enqueue<{ workspaceId: string; rootDir: string; reason: string }, { ok: true }>(
      HOST_TASK_TYPES.affairsLibraryTagRecommendationGenerate,
      {
        key: workspaceId,
        source: "affairs_tag.recommendation_generate",
        input: {
          workspaceId,
          rootDir,
          reason: "generate_tag_recommendations",
        },
      },
    );
    return {
      batch: this.getRecommendationBatch(workspaceId, userId, batchId),
      task: {
        taskId: handle.taskId,
        deduped: handle.deduped,
        status: "queued" as const,
      },
    };
  }

  private requireBinding(workspaceId: string, userId: string) {
    this.workspaceService.getWorkspaceOrThrow(workspaceId);
    const state = this.workspaceNavigationStateRepository.findByWorkspaceIdAndUserId(workspaceId, userId);
    const rootDir = state?.affairsLibraryRootPath?.trim() ?? "";
    if (!rootDir || state?.affairsLibraryEnabled !== true) {
      throw new AppError({
        statusCode: 409,
        errorCode: "AFFAIRS_LIBRARY_BINDING_REQUIRED",
        detail: "当前工作区还没有启用事务文档库",
      });
    }
    return {
      rootDir,
      dbPath: resolveCatalogDbPath(rootDir),
    };
  }

  private registerBackgroundTasks(): void {
    if (!this.taskManager.has(HOST_TASK_TYPES.affairsLibraryTagRecompute)) {
      this.taskManager.register<{ workspaceId: string; rootDir: string; reason: string; scope?: RecomputeScope }, { ok: true }>({
        taskType: HOST_TASK_TYPES.affairsLibraryTagRecompute,
        executionLane: "helper_process",
        helperProcessHandler: "affairs.library_recompute_tags",
        timeoutMs: 30_000,
        run: async (input) => {
          new TagRecomputeService(createAffairsIndexerRuntimeConfig(input.rootDir)).run({
            scope: input.scope,
          });
          return { ok: true };
        },
      });
    }
    if (!this.taskManager.has(HOST_TASK_TYPES.affairsLibraryTagApplyBindings)) {
      this.taskManager.register<{ workspaceId: string; rootDir: string; reason: string; scope?: RecomputeScope }, { ok: true }>({
        taskType: HOST_TASK_TYPES.affairsLibraryTagApplyBindings,
        executionLane: "helper_process",
        helperProcessHandler: "affairs.library_recompute_tags",
        timeoutMs: 30_000,
        run: async (input) => {
          new TagRecomputeService(createAffairsIndexerRuntimeConfig(input.rootDir)).run({
            scope: input.scope,
          });
          return { ok: true };
        },
      });
    }
    if (!this.taskManager.has(HOST_TASK_TYPES.affairsLibraryTagRecommendationGenerate)) {
      this.taskManager.register<{ workspaceId: string; rootDir: string; reason: string }, { ok: true }>({
        taskType: HOST_TASK_TYPES.affairsLibraryTagRecommendationGenerate,
        executionLane: "host_background",
        timeoutMs: 10_000,
        run: async () => ({ ok: true }),
      });
    }
    if (!this.taskManager.has(HOST_TASK_TYPES.affairsLibraryTagExportRefresh)) {
      this.taskManager.register<{ workspaceId: string; rootDir: string; reason: string }, { ok: true }>({
        taskType: HOST_TASK_TYPES.affairsLibraryTagExportRefresh,
        executionLane: "helper_process",
        helperProcessHandler: "affairs.library_export",
        timeoutMs: 20_000,
        run: async (input) => {
          new ExportBuilder(createAffairsIndexerRuntimeConfig(input.rootDir)).build();
          return { ok: true };
        },
      });
    }
  }

  private toTagNodeDto(
    row: TagDefinitionRow,
    parentPathById: Map<string, string>,
    ruleEnabled: boolean,
    documentCount: number,
  ): AffairsTagNodeDto {
    return {
      id: row.id,
      path: row.path,
      name: row.name,
      rootType: row.rootType,
      parentId: row.parentId,
      parentPath: row.parentId ? parentPathById.get(row.parentId) ?? null : null,
      description: row.description,
      status: row.status === "disabled" ? "disabled" : "active",
      ruleEnabled,
      documentCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      disabledAt: row.disabledAt,
    };
  }

  private mapRecommendationBatch(batch: RecommendationBatchRow): AffairsTagRecommendationBatchDto {
    return {
      id: batch.id,
      status: batch.status,
      summary: batch.summary,
      generatedAt: batch.generatedAt,
      updatedAt: batch.updatedAt,
      evidenceSnapshot: asRecordOrNull(parseJsonSafe(batch.evidenceSnapshotJson)),
    };
  }
}

function mapTagRuleDto(rule: ReturnType<CatalogRepository["listTagRulesByTagIds"]>[number]): AffairsTagRuleDto {
  return {
    id: rule.id,
    enabled: rule.enabled,
    ruleType: rule.ruleType,
    scope: parseJsonSafe(rule.scopeJson) as string[] ?? [],
    matcher: parseJsonSafe(rule.matcherJson) as Record<string, unknown> ?? {},
    minScore: rule.minScore,
    priority: rule.priority,
    source: rule.source,
    updatedAt: rule.updatedAt,
  };
}

function mapRecommendationItemDto(item: RecommendationItemRow): AffairsTagRecommendationItemDto {
  return {
    id: item.id,
    proposedPath: item.proposedPath,
    proposedName: item.proposedName,
    proposedParentPath: item.proposedParentPath,
    documentCount: item.documentCount,
    evidence: parseJsonSafe(item.evidenceJson) as Record<string, unknown> ?? {},
    selectedByDefault: item.selectedByDefault,
    status: item.status,
  };
}

function deriveParentPath(tagPath: string): string | null {
  const segments = tagPath.split("/").map(item => item.trim()).filter(Boolean);
  if (segments.length <= 1) {
    return null;
  }
  return segments.slice(0, -1).join("/");
}

function inferTagNameFromPath(tagPath: string): string {
  const segments = tagPath.split("/").map(item => item.trim()).filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

function isDescendantTag(definitions: TagDefinitionRow[], candidateId: string, ancestorId: string): boolean {
  let current = definitions.find(item => item.id === candidateId) ?? null;
  const visited = new Set<string>();
  while (current?.parentId) {
    if (current.parentId === ancestorId) {
      return true;
    }
    if (visited.has(current.parentId)) {
      return false;
    }
    visited.add(current.parentId);
    current = definitions.find(item => item.id === current?.parentId) ?? null;
  }
  return false;
}

function collectDescendantTags(definitions: TagDefinitionRow[], ancestorId: string): TagDefinitionRow[] {
  const childrenByParentId = new Map<string, TagDefinitionRow[]>();
  definitions.forEach((item) => {
    if (!item.parentId) {
      return;
    }
    const items = childrenByParentId.get(item.parentId) ?? [];
    items.push(item);
    childrenByParentId.set(item.parentId, items);
  });
  const result: TagDefinitionRow[] = [];
  const queue = [...(childrenByParentId.get(ancestorId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    const children = childrenByParentId.get(current.id);
    if (children?.length) {
      queue.push(...children);
    }
  }
  return result;
}

function buildDescendantTagPathUpdates(
  definitions: TagDefinitionRow[],
  current: TagDefinitionRow,
  nextPath: string,
  nextRootType: string,
): Array<{ tag: TagDefinitionRow; nextPath: string; nextRootType: string }> {
  const oldPrefix = `${current.path}/`;
  const nextPrefix = `${nextPath}/`;
  return definitions
    .filter(item => item.path.startsWith(oldPrefix))
    .sort((left, right) => left.path.localeCompare(right.path, "zh-Hans-CN"))
    .map(tag => ({
      tag,
      nextPath: `${nextPrefix}${tag.path.slice(oldPrefix.length)}`,
      nextRootType,
    }));
}

function normalizeFolderPath(value: string): string {
  return value.trim().replace(/^\.\/+/, "").replace(/\/+$/g, "") || ".";
}

function resolvePriority(sourceType: TagResolvedSourceType): number {
  switch (sourceType) {
    case "manual_document":
      return 1;
    case "folder_binding":
      return 2;
    case "rule_match":
      return 3;
    case "system_derived":
      return 4;
  }
}

function parseJsonSafe(value: string | null): unknown {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function createStableId(prefix: string, raw: string): string {
  return `${prefix}_${crypto.createHash("sha1").update(raw).digest("hex")}`;
}

function resolveCatalogDbPath(rootDir: string): string {
  const dbPath = path.join(rootDir, ".ai-index", "catalog.db");
  if (fs.existsSync(dbPath)) {
    return dbPath;
  }
  const legacyDbPath = path.join(rootDir, ".ai-index", "catalog.sqlite");
  if (fs.existsSync(legacyDbPath)) {
    return legacyDbPath;
  }
  return dbPath;
}
