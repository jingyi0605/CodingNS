import fs from "node:fs";
import path from "node:path";
import { AppError } from "../../shared/errors/app-error.js";
import type { TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES, type TaskSnapshot } from "../tasks/task-types.js";
import type { WorkspaceService } from "./workspace-service.js";
import { AFFAIRS_GLOBAL_WORKSPACE_ID, type AffairsLibraryService } from "./affairs-library-service.js";
import {
  CatalogRepository,
  type ManualTagBindingStats,
  type RecomputeScope,
  type TagDefinitionRow,
  type TagRuleMatcher,
  type TagRuleRelation,
  type TagRuleRow,
  type TagRuleType,
  type TagResolvedSourceType,
} from "../affairs-indexer/core/src/repositories/catalog-repository.js";
import {
  CatalogWriteRepository,
  type SaveTagRuleInput,
} from "../affairs-indexer/core/src/repositories/catalog-write-repository.js";
import { createAffairsIndexerRuntimeConfig } from "../affairs-indexer/internal-command-runner.js";
import { TagRecomputeService } from "../affairs-indexer/core/src/services/tagging/tag-recompute-service.js";
import { ExportBuilder } from "../affairs-indexer/core/src/services/export/export-builder.js";
import { initCatalog } from "../affairs-indexer/core/src/sqlite/init-catalog.js";

const TAG_EXPORT_REFRESH_TASK_TIMEOUT_MS = 30 * 60 * 1000;
const TAG_RECOMPUTE_TASK_TIMEOUT_MS = 30 * 60 * 1000;

export interface AffairsTagNodeDto {
  id: string;
  path: string;
  name: string;
  rootType: string;
  parentId: string | null;
  parentPath: string | null;
  description: string | null;
  status: "active" | "disabled";
  documentCount: number;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
}

export interface AffairsTagDetailDto extends AffairsTagNodeDto {}

export interface AffairsTagRuleDto {
  id: string;
  relation: TagRuleRelation;
  ruleType: TagRuleType;
  matcher: TagRuleMatcher;
  enabled: boolean;
  priority: number;
}

export interface AffairsTagDetailWithRulesDto extends AffairsTagDetailDto {
  smartRules: AffairsTagRuleDto[];
  smartRuleEnabled: boolean;
}

export interface AffairsResolvedTagSourceDto {
  path: string;
  sourceType: TagResolvedSourceType;
  sourceRef: string | null;
  evidence: string | null;
  confidence: number;
  priority: number;
}

export type AffairsTagRecommendationReason =
  | "name_match"
  | "folder_context"
  | "smart_rule"
  | "time_pattern";

export interface AffairsTagRecommendationDto {
  tagId: string;
  path: string;
  name: string;
  score: number;
  reason: AffairsTagRecommendationReason;
  evidence: string;
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
  recommendedTags: AffairsTagRecommendationDto[];
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
  recommendedTags: AffairsTagRecommendationDto[];
}

export interface AffairsTagRecomputeRequestResultDto {
  taskId: string;
  deduped: boolean;
  status: "queued";
  scope: "full";
}

export interface AffairsTagRecoveryStatusDto {
  task: TaskSnapshot | null;
  bindingStats: ManualTagBindingStats;
}

export class AffairsTagService {
  private teableMirrorSyncNotifier: ((userId: string, reason: string) => void) | null = null;

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly affairsLibraryService: AffairsLibraryService,
    private readonly taskManager: TaskManager,
  ) {
    this.registerBackgroundTasks();
  }

  configureTeableMirrorSyncNotifier(notifier: (userId: string, reason: string) => void): void {
    this.teableMirrorSyncNotifier = notifier;
  }

  listTags(workspaceId: string, userId: string, input: { includeDisabled?: boolean } = {}) {
    const { dbPath } = this.requireBinding(workspaceId, userId);
    return this.listTagsFromCatalog(dbPath, input);
  }

  listGlobalTags(userId: string, input: { includeDisabled?: boolean } = {}) {
    const { dbPath } = this.requireGlobalBinding(userId);
    return this.listTagsFromCatalog(dbPath, input);
  }

  private listTagsFromCatalog(dbPath: string, input: { includeDisabled?: boolean } = {}) {
    const repository = new CatalogRepository(dbPath);
    const definitions = repository.listTagDefinitions(input.includeDisabled === true);
    const enabledRules = repository.listAllEnabledTagRules();
    const countByPath = this.buildTagDocumentCountMap(repository);
    const resolvedRows = repository.listExportDocuments().flatMap(doc => [
      ...doc.tags.map(tagPath => ({ tagPath, derived: false })),
      ...doc.derivedTags.map(tagPath => ({ tagPath, derived: true })),
    ]);
    const parentPathById = new Map(definitions.map(item => [item.id, item.path]));

    const items = definitions.map((tag) => this.toTagNodeDto(tag, parentPathById, countByPath.get(tag.path) ?? 0));
    return {
      items,
      summary: {
        totalActiveTags: items.filter(item => item.status === "active").length,
        totalDisabledTags: items.filter(item => item.status === "disabled").length,
        totalRuleEnabledTags: new Set(enabledRules.map(item => item.tagId)).size,
        totalBoundDocuments: new Set(resolvedRows.map(item => item.tagPath)).size,
      },
      status: {
        recomputeState: "idle" as const,
        lastRecomputedAt: null,
        lastError: null,
      },
    };
  }

  getTagDetail(workspaceId: string, userId: string, tagId: string): AffairsTagDetailWithRulesDto {
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
    const definitions = repository.listTagDefinitions(true);
    const parentPathById = new Map(definitions.map(item => [item.id, item.path]));
    const countByPath = this.buildTagDocumentCountMap(repository);
    const rules = repository.listTagRulesByTagIds([tagId]);
    return {
      ...this.toTagNodeDto(definition, parentPathById, countByPath.get(definition.path) ?? 0),
      smartRules: rules.map(mapTagRuleDto),
      smartRuleEnabled: rules.some(rule => rule.enabled),
    };
  }

  ensureTagDefinition(
    workspaceId: string,
    userId: string,
    input: {
      path: string;
    },
  ): AffairsTagDetailWithRulesDto {
    const normalizedPath = normalizeTagPath(input.path);
    if (!normalizedPath) {
      throw new AppError({
        statusCode: 400,
        errorCode: "AFFAIRS_TAG_PATH_REQUIRED",
        detail: "标签路径不能为空",
        field: "path",
      });
    }
    const { dbPath, rootDir } = this.requireBinding(workspaceId, userId);
    const repository = new CatalogRepository(dbPath);
    const writer = new CatalogWriteRepository(dbPath);
    const definitions = repository.listTagDefinitions(true);
    const definitionByPath = new Map(definitions.map(item => [item.path, item]));
    const segments = normalizedPath.split("/").filter(Boolean);
    let currentPath = "";
    let parentId: string | null = null;
    let lastTagId: string | null = null;
    let rootType = segments[0] ?? normalizedPath;

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const existing = definitionByPath.get(currentPath);
      if (existing) {
        if (existing.status === "disabled") {
          writer.saveTagDefinition({
            id: existing.id,
            path: existing.path,
            name: existing.name,
            rootType: existing.rootType,
            parentId: existing.parentId,
            canonicalName: existing.canonicalName,
            description: existing.description,
            status: "active",
            createdBy: existing.createdBy,
          });
          definitionByPath.set(currentPath, { ...existing, status: "active", disabledAt: null });
        }
        parentId = existing.id;
        lastTagId = existing.id;
        rootType = existing.rootType;
        continue;
      }

      const nextParentId = parentId;
      const result = writer.saveTagDefinition({
        path: currentPath,
        name: segment,
        rootType,
        parentId: nextParentId,
        canonicalName: segment,
        description: null,
        status: "active",
        createdBy: userId || "user",
      });
      parentId = result.id;
      lastTagId = result.id;
      definitionByPath.set(currentPath, {
        id: result.id,
        path: currentPath,
        name: segment,
        rootType,
        parentId: nextParentId,
        canonicalName: segment,
        description: null,
        status: "active",
        createdBy: userId || "user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        disabledAt: null,
      });
    }

    if (!lastTagId) {
      throw new AppError({
        statusCode: 500,
        errorCode: "AFFAIRS_TAG_ENSURE_FAILED",
        detail: "标签创建失败",
      });
    }

    this.taskManager.enqueue<{ workspaceId: string; rootDir: string; reason: string }, { ok: true }>(
      HOST_TASK_TYPES.affairsLibraryTagExportRefresh,
      {
        key: `${workspaceId}:full`,
        source: "affairs_tag.ensure_tag_definition",
        input: {
          workspaceId,
          rootDir,
          reason: `tag_definition_ensured:${lastTagId}`,
        },
      },
    );
    this.notifyTeableTagChanged(userId, `tag_definition_ensured:${lastTagId}`);
    return this.getTagDetail(workspaceId, userId, lastTagId);
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
      smartRules?: AffairsTagRuleDto[];
    },
  ): AffairsTagDetailWithRulesDto {
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
    if (Array.isArray(input.smartRules)) {
      writer.replaceTagRules(result.id, normalizeTagRulesInput(input.smartRules));
    }
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
    if (Array.isArray(input.smartRules)) {
      this.taskManager.enqueue<{ workspaceId: string; rootDir: string; reason: string; scope?: RecomputeScope }, { ok: true }>(
        HOST_TASK_TYPES.affairsLibraryTagApplyBindings,
        {
          key: `${workspaceId}:full`,
          source: "affairs_tag.save_tag_definition",
          input: {
            workspaceId,
            rootDir,
            reason: `tag_definition_saved:${result.id}`,
            scope: { kind: "full" },
          },
        },
      );
    } else {
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
    }
    this.notifyTeableTagChanged(userId, `tag_definition_saved:${result.id}`);
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
    this.notifyTeableTagChanged(userId, `tag_definition_deleted:${tagId}`);
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
    const manualTagIds = new Set(manualBindings.map(item => item.tagId));
    const excludedTagIds = new Set([
      ...manualBindings.map(item => item.tagId),
      ...folderBindings.map(item => item.tagId),
      ...resolved.map(item => item.tagId),
    ]);
    const excludedTagPaths = new Set([
      ...manualBindings.map(item => item.tagPath),
      ...folderBindings.map(item => item.tagPath),
      ...resolved.map(item => item.path),
    ]);
    return {
      documentId,
      path: context.path,
      title: context.title,
      manualTagIds: [...manualTagIds],
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
      recommendedTags: this.recommendTagsForTarget(repository, {
        kind: "document",
        path: context.path,
        title: context.title,
        extension: context.extension,
        modifiedAt: context.modifiedAt,
        excludedTagIds,
        excludedTagPaths,
      }),
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
    writer.replaceManualDocumentTagBindings({
      documentId,
      inodeKey: context.inodeKey,
      contentHash: context.contentHash,
      size: context.size,
      extension: context.extension,
    }, tagIds);
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
    this.notifyTeableTagChanged(userId, `manual_document_binding_saved:${documentId}`);
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
    const assignedTagIds = new Set(bindings.map(item => item.tagId));
    return {
      folderPath: normalizedFolderPath,
      exists,
      bindingTagIds: [...assignedTagIds],
      bindings: bindings.map(item => ({
        id: item.id,
        tagId: item.tagId,
        tagPath: item.tagPath,
        applyMode: item.applyMode,
      })),
      recommendedTags: this.recommendTagsForTarget(repository, {
        kind: "folder",
        path: normalizedFolderPath,
        title: normalizedFolderPath === "." ? path.basename(rootDir) : path.posix.basename(normalizedFolderPath),
        excludedTagIds: assignedTagIds,
      }),
    };
  }

  getFolderTagApplyTaskSnapshot(workspaceId: string, userId: string, folderPath: string): TaskSnapshot | null {
    this.requireBinding(workspaceId, userId);
    const normalizedFolderPath = normalizeFolderPath(folderPath);
    return this.taskManager.peek(
      HOST_TASK_TYPES.affairsLibraryTagApplyBindings,
      `${workspaceId}:folder:${normalizedFolderPath}`,
    );
  }

  getDocumentTagApplyTaskSnapshot(workspaceId: string, userId: string, documentId: string): TaskSnapshot | null {
    this.requireBinding(workspaceId, userId);
    return this.taskManager.peek(
      HOST_TASK_TYPES.affairsLibraryTagApplyBindings,
      `${workspaceId}:doc:${documentId}`,
    );
  }

  getFullTagRecomputeTaskSnapshot(workspaceId: string, userId: string): TaskSnapshot | null {
    this.requireBinding(workspaceId, userId);
    return this.taskManager.peek(
      HOST_TASK_TYPES.affairsLibraryTagRecompute,
      `${workspaceId}:full`,
    );
  }

  getTagRecoveryStatus(workspaceId: string, userId: string): AffairsTagRecoveryStatusDto {
    const { dbPath } = this.requireBinding(workspaceId, userId);
    const repository = new CatalogRepository(dbPath);
    return {
      task: this.taskManager.peek(
        HOST_TASK_TYPES.affairsLibraryTagRecompute,
        `${workspaceId}:full`,
      ),
      bindingStats: repository.getManualTagBindingStats(),
    };
  }

  requestFullTagRecompute(workspaceId: string, userId: string): AffairsTagRecomputeRequestResultDto {
    const { rootDir } = this.requireBinding(workspaceId, userId);
    const handle = this.taskManager.enqueue<{ workspaceId: string; rootDir: string; reason: string; scope?: RecomputeScope }, { ok: true }>(
      HOST_TASK_TYPES.affairsLibraryTagRecompute,
      {
        key: `${workspaceId}:full`,
        source: "affairs_tag.request_full_recompute",
        input: {
          workspaceId,
          rootDir,
          reason: "manual_full_recompute_requested",
          scope: { kind: "full", mode: "full" },
        },
      },
    );
    return {
      taskId: handle.taskId,
      deduped: handle.deduped,
      status: "queued",
      scope: "full",
    };
  }

  private notifyTeableTagChanged(userId: string, reason: string): void {
    this.teableMirrorSyncNotifier?.(userId, reason);
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
          // 文件夹分配标签只重跑目标文件夹子树，但要走完整标签推理，
          // 这样它和“位于某文件夹及其子文件夹”的智能规则语义保持一致。
          scope: { kind: "folder", folderPath: normalizedFolderPath },
        },
      },
    );
    this.notifyTeableTagChanged(userId, `folder_binding_saved:${normalizedFolderPath}`);
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

  private requireBinding(workspaceId: string, userId: string) {
    const normalizedWorkspaceId = workspaceId.trim();
    if (normalizedWorkspaceId !== AFFAIRS_GLOBAL_WORKSPACE_ID) {
      this.workspaceService.getWorkspaceOrThrow(normalizedWorkspaceId);
    }
    const binding = this.affairsLibraryService.getBinding(normalizedWorkspaceId || AFFAIRS_GLOBAL_WORKSPACE_ID, userId);
    const rootDir = binding?.rootDir?.trim() ?? "";
    if (!rootDir || binding?.enabled !== true) {
      throw new AppError({
        statusCode: 409,
        errorCode: "AFFAIRS_LIBRARY_BINDING_REQUIRED",
        detail: "当前工作区还没有启用事务文档库",
      });
    }
    // 这里不能假设 catalog.db 一定已经被 helper 跑到最新版本。
    // 事务文档库标签接口会直接打开 SQLite；如果用户库还是旧 schema，
    // prepareStatements 阶段就会因为缺表直接炸掉。
    // 所以每次进入标签链路前先补一次幂等迁移，保证旧库也能安全读写。
    initCatalog(createAffairsIndexerRuntimeConfig(rootDir));
    return {
      rootDir,
      dbPath: resolveCatalogDbPath(rootDir),
    };
  }

  private requireGlobalBinding(userId: string) {
    const binding = this.affairsLibraryService.getGlobalBinding(userId);
    const rootDir = binding?.rootDir?.trim() ?? "";
    if (!rootDir || binding?.enabled !== true) {
      throw new AppError({
        statusCode: 409,
        errorCode: "AFFAIRS_LIBRARY_BINDING_REQUIRED",
        detail: "事务文档库还没有启用",
      });
    }
    initCatalog(createAffairsIndexerRuntimeConfig(rootDir));
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
        // 事务文档库全量标签恢复可能要扫几千到上万文档，30s 很容易误杀。
        timeoutMs: TAG_RECOMPUTE_TASK_TIMEOUT_MS,
        run: async (input, context) => {
          await new TagRecomputeService(createAffairsIndexerRuntimeConfig(input.rootDir)).run({
            scope: input.scope,
            signal: context.signal,
            onProgress: context.reportProgress,
          });
          return { ok: true };
        },
      });
    }
    if (!this.taskManager.has(HOST_TASK_TYPES.affairsLibraryTagApplyBindings)) {
      this.taskManager.register<{ workspaceId: string; rootDir: string; reason: string; scope?: RecomputeScope }, { ok: true }>({
        taskType: HOST_TASK_TYPES.affairsLibraryTagApplyBindings,
        executionLane: "helper_process",
        timeoutMs: TAG_RECOMPUTE_TASK_TIMEOUT_MS,
        run: async (input, context) => {
          await new TagRecomputeService(createAffairsIndexerRuntimeConfig(input.rootDir)).run({
            scope: input.scope,
            signal: context.signal,
            onProgress: context.reportProgress,
          });
          return { ok: true };
        },
      });
    }
    if (!this.taskManager.has(HOST_TASK_TYPES.affairsLibraryTagExportRefresh)) {
      this.taskManager.register<{ workspaceId: string; rootDir: string; reason: string }, { ok: true }>({
        taskType: HOST_TASK_TYPES.affairsLibraryTagExportRefresh,
        executionLane: "helper_process",
        helperProcessHandler: "affairs.library_export",
        // 这里跑的不是轻量标签刷新，而是整套静态导出。
        // 大库下 20s 很容易误判超时，直接对齐文档库索引任务的分钟级超时。
        timeoutMs: TAG_EXPORT_REFRESH_TASK_TIMEOUT_MS,
        run: async (input, context) => {
          await new ExportBuilder(createAffairsIndexerRuntimeConfig(input.rootDir)).build({
            signal: context.signal,
          });
          return { ok: true };
        },
      });
    }
  }

  private toTagNodeDto(
    row: TagDefinitionRow,
    parentPathById: Map<string, string>,
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
      documentCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      disabledAt: row.disabledAt,
    };
  }

  private buildTagDocumentCountMap(repository: CatalogRepository): Map<string, number> {
    const countByPath = new Map<string, number>();
    repository.listExportDocuments().forEach((document) => {
      document.tags.forEach((tagPath) => {
        countByPath.set(tagPath, (countByPath.get(tagPath) ?? 0) + 1);
      });
      document.derivedTags.forEach((tagPath) => {
        countByPath.set(tagPath, (countByPath.get(tagPath) ?? 0) + 1);
      });
    });
    return countByPath;
  }

  private recommendTagsForTarget(
    repository: CatalogRepository,
    target: {
      kind: "document" | "folder";
      path: string;
      title: string;
      extension?: string;
      modifiedAt?: string;
      excludedTagIds: Set<string>;
      excludedTagPaths?: Set<string>;
    },
  ): AffairsTagRecommendationDto[] {
    const definitions = repository.listTagDefinitions(false)
      .filter((tag) =>
        isBusinessTagDefinition(tag)
        && !target.excludedTagIds.has(tag.id)
        && !target.excludedTagPaths?.has(tag.path));
    if (definitions.length === 0) {
      return [];
    }

    const candidates = new Map<string, AffairsTagRecommendationDto>();
    const tagById = new Map(definitions.map(tag => [tag.id, tag]));
    const countByPath = this.buildTagDocumentCountMap(repository);
    const targetText = buildRecommendationTargetText(target.path, target.title);

    for (const tag of definitions) {
      const score = scoreTagNameMatch(tag, targetText);
      if (score <= 0) {
        continue;
      }
      setTagRecommendation(candidates, tag, {
        score,
        reason: "name_match",
        evidence: "文件夹或文件名称里出现了这个标签的关键词",
      });
    }

    for (const binding of repository.listAllFolderTagBindings()) {
      const tag = tagById.get(binding.tagId);
      if (!tag) {
        continue;
      }
      const relationScore = scoreFolderContext(target.kind, target.path, binding.folderPath);
      if (relationScore <= 0) {
        continue;
      }
      setTagRecommendation(candidates, tag, {
        score: relationScore,
        reason: "folder_context",
        evidence: binding.folderPath === "."
          ? "根目录已经配置过这个标签"
          : `相关文件夹“${binding.folderPath}”已经配置过这个标签`,
      });
    }

    const rulesByTagId = new Map<string, TagRuleRow[]>();
    for (const rule of repository.listAllEnabledTagRules()) {
      const rules = rulesByTagId.get(rule.tagId) ?? [];
      rules.push(rule);
      rulesByTagId.set(rule.tagId, rules);
    }
    for (const [tagId, rules] of rulesByTagId) {
      const tag = tagById.get(tagId);
      const matchedRule = tag ? resolveMatchedRecommendationRule(target, rules) : null;
      if (!tag || !matchedRule) {
        continue;
      }
      setTagRecommendation(candidates, tag, {
        score: 82,
        reason: "smart_rule",
        evidence: resolveRecommendationRuleEvidence(matchedRule),
      });
    }

    if (target.kind === "document" && target.modifiedAt) {
      const timeScore = scoreRecentModifiedAt(target.modifiedAt);
      if (timeScore > 0) {
        for (const tag of definitions) {
          if (!isTimeLikeBusinessTag(tag)) {
            continue;
          }
          setTagRecommendation(candidates, tag, {
            score: timeScore,
            reason: "time_pattern",
            evidence: "最近修改时间和这个标签有关",
          });
        }
      }
    }

    return [...candidates.values()]
      .map(item => ({
        ...item,
        score: Math.min(100, item.score + Math.min(8, Math.log2((countByPath.get(item.path) ?? 0) + 1) * 1.5)),
      }))
      .sort((left, right) =>
        right.score - left.score
        || left.path.localeCompare(right.path, "zh-Hans-CN"))
      .slice(0, 8)
      .map(item => ({ ...item, score: Number(item.score.toFixed(2)) }));
  }

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

function normalizeTagPath(value: string): string {
  return value
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/g, "")
    .split("/")
    .map(item => item.trim())
    .filter(Boolean)
    .join("/");
}

function resolveCatalogDbPath(rootDir: string): string {
  return path.join(rootDir, ".ai-index", "catalog.db");
}

function resolvePriority(sourceType: TagResolvedSourceType): number {
  switch (sourceType) {
    case "manual_document":
      return 1;
    case "folder_binding":
      return 2;
    case "smart_rule":
      return 3;
    case "system_derived":
      return 4;
  }
}

function mapTagRuleDto(rule: TagRuleRow): AffairsTagRuleDto {
  return {
    id: rule.id,
    relation: rule.relation,
    ruleType: rule.ruleType,
    matcher: rule.matcher,
    enabled: rule.enabled,
    priority: rule.priority,
  };
}

function normalizeTagRulesInput(rules: AffairsTagRuleDto[]): SaveTagRuleInput[] {
  return rules
    .map((rule, index) => ({
      relation: (rule.relation === "or" || rule.relation === "not" ? rule.relation : "and") as TagRuleRelation,
      ruleType: rule.ruleType,
      matcher: rule.matcher,
      enabled: rule.enabled !== false,
      priority: Number.isFinite(rule.priority) ? rule.priority : index,
    }))
    .sort((left, right) => left.priority - right.priority);
}

function isBusinessTagDefinition(tag: TagDefinitionRow): boolean {
  if (tag.status === "disabled") {
    return false;
  }
  const rootType = tag.rootType.trim().toLowerCase();
  return rootType !== "类型" && rootType !== "type" && rootType !== "时间" && rootType !== "time";
}

function buildRecommendationTargetText(targetPath: string, title: string): string {
  return buildSearchableRecommendationText([
    targetPath,
    path.posix.basename(targetPath),
    title,
    targetPath.split(/[\/._\-\s]+/g).join(" "),
  ]);
}

function normalizeRecommendationText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\\/_\-–—.()[\]{}【】（）]+/g, " ")
    .replace(/\s+/g, " ");
}

function buildSearchableRecommendationText(parts: string[]): string {
  const values = new Set<string>();
  for (const part of parts) {
    const normalized = normalizeRecommendationText(part);
    const compact = compactRecommendationText(part);
    const stripped = stripMeaninglessRecommendationWords(compact);
    if (normalized) {
      values.add(normalized);
    }
    if (compact) {
      values.add(compact);
    }
    if (stripped) {
      values.add(stripped);
    }
  }
  return [...values].join(" ");
}

function scoreTagNameMatch(tag: TagDefinitionRow, targetText: string): number {
  const tokens = splitRecommendationTokens(targetText);
  const tokenSet = new Set(tokens);
  const segments = tag.path.split("/").map(normalizeRecommendationText).filter((segment) => isUsefulRecommendationToken(segment));
  const tagName = normalizeRecommendationText(tag.name);
  const tagPath = normalizeRecommendationText(tag.path);
  const tagNameTokens = splitRecommendationTokens(tagName).filter(isUsefulRecommendationToken);
  const tagMatchTexts = buildTagMatchTexts(tag);
  let score = 0;

  if (tagName && isUsefulRecommendationToken(tagName) && tokenSet.has(tagName)) {
    score = Math.max(score, 90);
  }
  if (tagName && isUsefulRecommendationToken(tagName) && tokens.some(token => token.length > tagName.length && token.includes(tagName))) {
    score = Math.max(score, 86);
  }
  if (tagPath && targetText.includes(tagPath)) {
    score = Math.max(score, 94);
  }

  for (const tagText of tagMatchTexts) {
    const overlapLength = findLongestCommonChineseTextLength(tagText, targetText);
    if (overlapLength >= MIN_RECOMMENDATION_OVERLAP_LENGTH) {
      score = Math.max(score, scoreTextOverlap(overlapLength, tagText.length));
      continue;
    }
    const bestSimilarity = Math.max(0, ...tokens.map(token => similarityRatio(tagText, stripMeaninglessRecommendationWords(token))));
    if (tagText.length >= 4 && bestSimilarity >= 0.88) {
      score = Math.max(score, 76 + Math.round((bestSimilarity - 0.88) * 70));
    }
  }

  const matchedSegments = segments.filter(segment => tokenSet.has(segment));
  if (matchedSegments.length >= 2) {
    score = Math.max(score, 84 + matchedSegments.length * 3);
  }

  const matchedNameTokens = tagNameTokens.filter(token => tokenSet.has(token));
  if (tagNameTokens.length >= 2 && matchedNameTokens.length === tagNameTokens.length) {
    score = Math.max(score, 88);
  }

  if (score === 0 && tagName.length >= 3) {
    const bestSimilarity = Math.max(0, ...tokens.map(token => similarityRatio(tagName, token)));
    if (bestSimilarity >= 0.86) {
      score = Math.max(score, 78 + Math.round((bestSimilarity - 0.86) * 60));
    }
  }
  return Math.min(score, 94);
}

function buildTagMatchTexts(tag: TagDefinitionRow): string[] {
  const rawNames = [
    tag.name,
    path.posix.basename(tag.path),
  ];
  const candidates = new Set<string>();
  for (const rawName of rawNames) {
    const compact = compactRecommendationText(rawName);
    const stripped = stripMeaninglessRecommendationWords(compact);
    for (const candidate of [compact, stripped]) {
      if (isUsefulTagMatchText(candidate)) {
        candidates.add(candidate);
      }
    }
  }
  return [...candidates].sort((left, right) => right.length - left.length);
}

function compactRecommendationText(value: string): string {
  return normalizeRecommendationText(value).replace(/\s+/g, "");
}

function stripMeaninglessRecommendationWords(value: string): string {
  let result = value;
  let changed = true;
  while (changed) {
    changed = false;
    for (const word of MEANINGLESS_RECOMMENDATION_WORDS) {
      if (word && result.includes(word)) {
        result = result.replaceAll(word, "");
        changed = true;
      }
    }
  }
  return result;
}

function isUsefulTagMatchText(value: string): boolean {
  if (value.length < MIN_RECOMMENDATION_OVERLAP_LENGTH) {
    return false;
  }
  if (GENERIC_RECOMMENDATION_TOKENS.has(value)) {
    return false;
  }
  return !MEANINGLESS_RECOMMENDATION_WORDS.includes(value);
}

function findLongestCommonChineseTextLength(left: string, right: string): number {
  const leftText = compactRecommendationText(left);
  const rightText = compactRecommendationText(right);
  const maxLength = Math.min(leftText.length, rightText.length);
  for (let length = maxLength; length >= MIN_RECOMMENDATION_OVERLAP_LENGTH; length -= 1) {
    for (let index = 0; index + length <= leftText.length; index += 1) {
      const fragment = leftText.slice(index, index + length);
      if (isUsefulTagMatchText(fragment) && rightText.includes(fragment)) {
        return length;
      }
    }
  }
  return 0;
}

function scoreTextOverlap(overlapLength: number, tagTextLength: number): number {
  const coverage = tagTextLength > 0 ? overlapLength / tagTextLength : 0;
  if (overlapLength >= 6 || coverage >= 0.72) {
    return 92;
  }
  if (overlapLength >= 4 || coverage >= 0.56) {
    return 86;
  }
  return 80;
}

function splitRecommendationTokens(value: string): string[] {
  return value
    .split(/\s+/g)
    .map(token => token.trim())
    .filter(Boolean);
}

function isUsefulRecommendationToken(value: string): boolean {
  const token = value.trim().toLowerCase();
  if (token.length < 2) {
    return false;
  }
  return !GENERIC_RECOMMENDATION_TOKENS.has(token);
}

const GENERIC_RECOMMENDATION_TOKENS = new Set([
  "文档",
  "文件",
  "资料",
  "附件",
  "其他",
  "相关",
  "临时",
  "新建",
  "默认",
  "document",
  "documents",
  "file",
  "files",
  "other",
  "misc",
  "temp",
  "有限公司",
  "有限责任公司",
  "股份有限公司",
  "集团有限公司",
  "公司",
  "集团",
]);

const MEANINGLESS_RECOMMENDATION_WORDS = [
  "集团有限公司",
  "股份有限公司",
  "有限责任公司",
  "有限公司",
  "集团公司",
  "总公司",
  "分公司",
  "公司",
  "集团",
  "co.,ltd",
  "coltd",
  "ltd",
  "inc",
  "llc",
  "corp",
  "corporation",
  "company",
  "采购",
  "服务",
  "管理",
  "建设",
];

const MIN_RECOMMENDATION_OVERLAP_LENGTH = 3;

function similarityRatio(left: string, right: string): number {
  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 1;
  }
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) {
    return 1;
  }
  const distance = levenshteinDistance(left, right);
  return (maxLength - distance) / maxLength;
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + substitutionCost,
      );
    }
    for (let j = 0; j < previous.length; j += 1) {
      previous[j] = current[j]!;
    }
  }

  return previous[right.length] ?? 0;
}

function setTagRecommendation(
  target: Map<string, AffairsTagRecommendationDto>,
  tag: TagDefinitionRow,
  input: {
    score: number;
    reason: AffairsTagRecommendationReason;
    evidence: string;
  },
): void {
  const current = target.get(tag.id);
  if (current && current.score > input.score) {
    return;
  }
  target.set(tag.id, {
    tagId: tag.id,
    path: tag.path,
    name: tag.name,
      score: input.score,
      reason: input.reason,
      evidence: input.evidence,
  });
}

function scoreFolderContext(targetKind: "document" | "folder", targetPath: string, bindingFolderPath: string): number {
  const targetFolderPath = targetKind === "document"
    ? normalizeFolderPath(targetPath.includes("/") ? path.posix.dirname(targetPath) : ".")
    : normalizeFolderPath(targetPath);
  const bindingPath = normalizeFolderPath(bindingFolderPath);
  if (bindingPath === ".") {
    return 0;
  }
  if (bindingPath === targetFolderPath) {
    return 86;
  }
  if (targetFolderPath.startsWith(`${bindingPath}/`)) {
    return 80;
  }
  const parentPath = normalizeFolderPath(path.posix.dirname(targetFolderPath));
  if (bindingPath === parentPath) {
    return 76;
  }
  if (parentPath !== "." && path.posix.dirname(bindingPath) === parentPath && areSiblingFolderNamesRelated(targetFolderPath, bindingPath)) {
    return 72;
  }
  return 0;
}

function areSiblingFolderNamesRelated(leftPath: string, rightPath: string): boolean {
  const leftName = normalizeRecommendationText(path.posix.basename(leftPath));
  const rightName = normalizeRecommendationText(path.posix.basename(rightPath));
  if (!leftName || !rightName) {
    return false;
  }
  const leftTokens = splitRecommendationTokens(leftName).filter(isUsefulRecommendationToken);
  const rightTokens = splitRecommendationTokens(rightName).filter(isUsefulRecommendationToken);
  if (leftTokens.some(token => rightTokens.includes(token))) {
    return true;
  }
  return similarityRatio(leftName, rightName) >= 0.82;
}

function matchesRecommendationRule(
  target: {
    kind: "document" | "folder";
    path: string;
    title: string;
    extension?: string;
    modifiedAt?: string;
  },
  rule: TagRuleRow,
): boolean {
  switch (rule.ruleType) {
    case "file_name_contains": {
      const keyword = String((rule.matcher as { keyword?: string }).keyword ?? "").trim().toLowerCase();
      return keyword.length > 0 && path.posix.basename(target.path).toLowerCase().includes(keyword);
    }
    case "file_content_contains": {
      const keyword = String((rule.matcher as { keyword?: string }).keyword ?? "").trim().toLowerCase();
      const text = `${target.title}\n${target.path}`.toLowerCase();
      return keyword.length > 0 && text.includes(keyword);
    }
    case "file_extension_in": {
      if (target.kind !== "document") {
        return false;
      }
      const rawExtensions = Array.isArray((rule.matcher as { extensions?: string[] }).extensions)
        ? (rule.matcher as { extensions?: string[] }).extensions ?? []
        : [];
      const extensions = rawExtensions
        .map(item => item.trim().toLowerCase())
        .filter(Boolean)
        .map(item => item.startsWith(".") ? item : `.${item}`);
      return Boolean(target.extension) && extensions.includes(String(target.extension).toLowerCase());
    }
    case "modified_time_between": {
      if (target.kind !== "document" || !target.modifiedAt) {
        return false;
      }
      const matcher = rule.matcher as { start?: string | null; end?: string | null };
      const modifiedAt = new Date(target.modifiedAt).getTime();
      if (Number.isNaN(modifiedAt)) {
        return false;
      }
      const startTime = matcher.start ? new Date(matcher.start).getTime() : null;
      const endTime = matcher.end ? new Date(matcher.end).getTime() : null;
      if (startTime !== null && (Number.isNaN(startTime) || modifiedAt < startTime)) {
        return false;
      }
      if (endTime !== null && (Number.isNaN(endTime) || modifiedAt > endTime)) {
        return false;
      }
      return startTime !== null || endTime !== null;
    }
    case "document_path_in_folder": {
      const folderPath = normalizeFolderPath((rule.matcher as { folderPath?: string | null }).folderPath ?? "");
      return matchesPathInFolderScope(target.path, folderPath);
    }
  }
}

function resolveMatchedRecommendationRule(
  target: {
    kind: "document" | "folder";
    path: string;
    title: string;
    extension?: string;
    modifiedAt?: string;
  },
  rules: TagRuleRow[],
): TagRuleRow | null {
  const sortedRules = [...rules].sort((left, right) => left.priority - right.priority);
  const matchedAnd: TagRuleRow[] = [];
  const matchedOr: TagRuleRow[] = [];
  let hasOrRule = false;

  for (const rule of sortedRules) {
    const matched = matchesRecommendationRule(target, rule);
    if (rule.relation === "not") {
      if (matched) {
        return null;
      }
      continue;
    }
    if (rule.relation === "or") {
      hasOrRule = true;
      if (matched) {
        matchedOr.push(rule);
      }
      continue;
    }
    if (!matched) {
      return null;
    }
    matchedAnd.push(rule);
  }

  if (hasOrRule && matchedOr.length === 0) {
    return null;
  }
  return matchedAnd[0] ?? matchedOr[0] ?? null;
}

function resolveRecommendationRuleEvidence(rule: TagRuleRow): string {
  switch (rule.ruleType) {
    case "file_name_contains":
      return `智能规则：文件名包含“${String((rule.matcher as { keyword?: string }).keyword ?? "").trim()}”`;
    case "file_content_contains":
      return `智能规则：标题、路径或内容包含“${String((rule.matcher as { keyword?: string }).keyword ?? "").trim()}”`;
    case "file_extension_in": {
      const extensions = Array.isArray((rule.matcher as { extensions?: string[] }).extensions)
        ? (rule.matcher as { extensions?: string[] }).extensions ?? []
        : [];
      return `智能规则：文件类型命中 ${extensions.join("、")}`;
    }
    case "modified_time_between":
      return "智能规则：修改时间命中";
    case "document_path_in_folder": {
      const folderPath = normalizeFolderPath((rule.matcher as { folderPath?: string | null }).folderPath ?? "");
      return folderPath === "." ? "智能规则：位于根目录下" : `智能规则：位于“${folderPath}”下`;
    }
  }
}

function matchesPathInFolderScope(targetPath: string, folderPath: string): boolean {
  if (folderPath === ".") {
    return true;
  }
  return targetPath === folderPath || targetPath.startsWith(`${folderPath}/`);
}

function scoreRecentModifiedAt(modifiedAt: string): number {
  const time = new Date(modifiedAt).getTime();
  if (Number.isNaN(time)) {
    return 0;
  }
  const dayDistance = Math.floor((Date.now() - time) / 86400000);
  if (dayDistance <= 7) {
    return 54;
  }
  if (dayDistance <= 30) {
    return 44;
  }
  return 0;
}

function isTimeLikeBusinessTag(tag: TagDefinitionRow): boolean {
  const text = `${tag.path}/${tag.name}`.toLowerCase();
  return /最近|近期|本周|本月|待处理|跟进|urgent|recent|week|month|todo|follow/.test(text);
}
