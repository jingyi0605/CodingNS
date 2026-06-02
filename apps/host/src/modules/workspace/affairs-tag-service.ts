import fs from "node:fs";
import path from "node:path";
import { AppError } from "../../shared/errors/app-error.js";
import type { TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES } from "../tasks/task-types.js";
import type { WorkspaceService } from "./workspace-service.js";
import type { AffairsLibraryService } from "./affairs-library-service.js";
import {
  CatalogRepository,
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
    const enabledRules = repository.listAllEnabledTagRules();
    const resolvedRows = repository.listExportDocuments().flatMap(doc => [
      ...doc.tags.map(tagPath => ({ tagPath, derived: false })),
      ...doc.derivedTags.map(tagPath => ({ tagPath, derived: true })),
    ]);
    const countByPath = new Map<string, number>();
    resolvedRows.forEach(row => {
      countByPath.set(row.tagPath, (countByPath.get(row.tagPath) ?? 0) + 1);
    });
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
    const rules = repository.listTagRulesByTagIds([tagId]);
    return {
      ...this.toTagNodeDto(definition, parentPathById, 0),
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
        timeoutMs: 30_000,
        run: async (input) => {
          new TagRecomputeService(createAffairsIndexerRuntimeConfig(input.rootDir)).run({
            scope: input.scope,
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
