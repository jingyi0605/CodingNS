import fs from "node:fs";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { nowIso } from "../../shared/utils/time.js";
import type { WorkspaceNavigationStateRepository } from "../../storage/repositories/workspace-navigation-state-repository.js";
import {
  MAX_PREVIEW_FILE_BYTES,
  MAX_RESOURCE_PREVIEW_FILE_BYTES
} from "../file/file-constants.js";
import {
  buildPreviewCapabilities,
  detectPreviewKind,
  type FilePreviewResult,
  isResourcePreviewKind
} from "../file/file-preview-types.js";
import { normalizeRelativePath } from "../file/path-normalizer.js";
import type { TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES, type TaskSnapshot } from "../tasks/task-types.js";
import type { WorkspaceService } from "./workspace-service.js";
import {
  runAffairsIndexerCommand,
  type AffairsIndexerCommandResult
} from "../affairs-indexer/internal-command-runner.js";

const DEFAULT_CONFIG_RELATIVE_PATH = ".ai-index/doc-semantic-index.config.json";
const TAG_RULES_RELATIVE_PATH = ".ai-index/tag-rules.json";
const INDEX_DIR_RELATIVE_PATH = ".ai-index";
const EXPORT_DIR_RELATIVE_PATH = ".ai-index/exports";
const EXPORT_STATUS_RELATIVE_PATH = ".ai-index/exports/status.json";
const EXPORT_MANIFEST_RELATIVE_PATH = ".ai-index/exports/manifest.json";
const DEFAULT_EXPORT_MODE = "v2" as const;
const INDEX_TASK_TIMEOUT_MS = 15 * 60 * 1000;
const INDEX_TASK_COOLDOWN_MS = 15_000;
const AUTO_TASK_QUIET_WINDOW_MS = 800;
const AUTO_TASK_RETRY_WINDOW_MS = 1_000;
const SNAPSHOT_CACHE_FILE_NAME = "codingns-affairs-snapshot-cache.json";
const SNAPSHOT_CACHE_SCHEMA_VERSION = 2;

export type AffairsLibraryFavoriteKind = "folder" | "tag";

export interface AffairsLibraryFavoriteRecord {
  kind: AffairsLibraryFavoriteKind;
  path: string;
  label: string;
}

export interface AffairsLibraryBindingDto {
  workspaceId: string;
  rootDir: string;
  enabled: boolean;
  mirrorRoot: string | null;
  allowedExtensions: string[];
  configRelativePath: string;
  exportMode: "v2";
  updatedAt: string;
}

export interface AffairsLibraryIndexStatusDto {
  state: "fresh" | "stale" | "running" | "cooldown" | "failed";
  dirtyReasons: string[];
  lastRequestedAt: string | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  nextAllowedAt: string | null;
  runningTaskId: string | null;
  errorSummary: string | null;
}

export interface AffairsLibraryDocumentRecordDto {
  documentId: string;
  path: string;
  title: string;
  summary: string;
  updatedAt: string;
  createdAt?: string | null;
  sizeBytes?: number | null;
  tags: string[];
  derivedTags: string[];
  isFavorite: boolean;
}

export interface AffairsLibraryTagNodeDto {
  path: string;
  name: string;
  rootType: string;
  parentPath: string | null;
  depth: number;
  documentCount: number;
}

export interface AffairsLibraryFolderNodeDto {
  path: string;
  name: string;
  parentPath: string | null;
  directDocumentCount: number;
  documentCount: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface AffairsLibrarySnapshotDto {
  binding: AffairsLibraryBindingDto | null;
  status: AffairsLibraryIndexStatusDto;
  tags: AffairsLibraryTagNodeDto[];
  favorites: AffairsLibraryFavoriteRecord[];
  folders: AffairsLibraryFolderNodeDto[];
  documentCount: number;
  lastError: string | null;
}

export interface ListAffairsLibraryDocumentsInput {
  browseMode: "folder" | "tag";
  selectedFolderPath?: string | null;
  selectedTagPath?: string | null;
  selectedTagPaths?: string[] | null;
  selectedFavoriteId?: string | null;
  offset?: number;
  limit?: number;
}

export interface AffairsLibraryDocumentListDto {
  total: number;
  offset: number;
  limit: number;
  items: AffairsLibraryDocumentRecordDto[];
  tagFacetCounts?: Record<string, number>;
}

export interface AffairsLibraryResolvedPreviewFile {
  workspaceId: string;
  userId: string;
  rootDir: string;
  rootRealPath: string;
  relativePath: string;
  absolutePath: string;
  exists: boolean;
  stats: fs.Stats | null;
}

interface AffairsLibraryLogger {
  info(bindings: Record<string, unknown>, message: string): void;
  warn?(bindings: Record<string, unknown>, message: string): void;
}

interface WorkspaceNavigationStateLike {
  workspaceId: string;
  userId: string;
  collapsed: boolean;
  backgroundColor: string | null;
  affairsLibraryRootPath?: string | null;
  affairsLibraryEnabled?: boolean;
  affairsLibraryFavoritesJson?: string | null;
  updatedAt: string;
}

interface AffairsLibraryConfigPayload {
  allowedExtensions?: string[];
  mirrorRoot?: string;
}

interface IndexStatusFilePayload {
  version?: number;
  format?: string;
  exported_at?: string;
  document_count?: number;
}

interface ParsedIndexStatusFile {
  exportedAt: string | null;
  exportedAtMs: number;
  documentCount: number | null;
}

interface IndexManifestPayload {
  generated_at?: string;
  entries?: {
    status?: string;
    taxonomy?: string;
    bootstrap?: string;
  };
  meta_shards?: Array<{
    path?: string;
  }>;
}

interface IndexMetaShardPayload {
  documents?: Array<{
    document_id?: string;
    path?: string;
    title?: string;
    summary?: string;
    mtime?: string;
    direct_tags?: string[];
    derived_tags?: string[];
  }>;
}

interface IndexTaxonomyPayload {
  nodes?: Array<{
    path?: string;
    name?: string;
    root_type?: string;
    parent_path?: string | null;
    depth?: number;
  }>;
}

interface IndexBootstrapPayload {
  folders?: Array<{
    path?: string;
    name?: string;
    parent_path?: string | null;
    direct_document_count?: number;
    document_count?: number;
  }>;
}

interface AffairsLibraryExportData {
  documents: AffairsLibraryDocumentRecordDto[];
  tags: AffairsLibraryTagNodeDto[];
  folders: AffairsLibraryFolderNodeDto[];
  generatedAt: string | null;
}

interface AffairsLibraryExportCachePayload {
  schemaVersion: number;
  signature: string;
  generatedAt: string | null;
  documents: AffairsLibraryDocumentRecordDto[];
  tags: AffairsLibraryTagNodeDto[];
  folders: AffairsLibraryFolderNodeDto[];
}

interface AffairsLibraryAutoTaskState {
  timer: NodeJS.Timeout | null;
  applyConfigReasons: Set<string>;
  recomputeTagReasons: Set<string>;
  indexReasons: Set<string>;
  indexTargets: Set<string>;
}

export class AffairsLibraryService {
  private readonly exportCache = new Map<string, AffairsLibraryExportCachePayload>();
  private readonly autoTaskStateByWorkspace = new Map<string, AffairsLibraryAutoTaskState>();

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceNavigationStateRepository: WorkspaceNavigationStateRepository,
    private readonly taskManager: TaskManager,
    private readonly logger: AffairsLibraryLogger
  ) {
    this.registerBackgroundTasks();
    this.resumeEnabledBindings();
  }

  getBinding(workspaceId: string, userId: string): AffairsLibraryBindingDto | null {
    const state = this.workspaceNavigationStateRepository.findByWorkspaceIdAndUserId(workspaceId, userId);
    const rootDir = state?.affairsLibraryRootPath?.trim();

    if (!rootDir) {
      return null;
    }

    const enabled = state?.affairsLibraryEnabled === true;
    const config = this.readConfig(rootDir);

    return {
      workspaceId,
      rootDir,
      enabled,
      mirrorRoot: config.mirrorRoot,
      allowedExtensions: config.allowedExtensions,
      configRelativePath: DEFAULT_CONFIG_RELATIVE_PATH,
      exportMode: DEFAULT_EXPORT_MODE,
      updatedAt: state?.updatedAt ?? nowIso()
    };
  }

  saveBinding(workspaceId: string, userId: string, rootDir: string): AffairsLibraryBindingDto {
    const workspace = this.workspaceService.getWorkspaceOrThrow(workspaceId);
    const normalizedRootDir = rootDir.trim();

    if (!normalizedRootDir) {
      throw new AppError({
        statusCode: 400,
        errorCode: "AFFAIRS_LIBRARY_ROOT_REQUIRED",
        detail: "文档库路径不能为空",
        field: "rootDir"
      });
    }

    if (!path.isAbsolute(normalizedRootDir)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "AFFAIRS_LIBRARY_ROOT_NOT_ABSOLUTE",
        detail: "文档库路径必须是绝对路径",
        field: "rootDir"
      });
    }

    if (!fs.existsSync(normalizedRootDir) || !fs.statSync(normalizedRootDir).isDirectory()) {
      throw new AppError({
        statusCode: 400,
        errorCode: "AFFAIRS_LIBRARY_ROOT_INVALID",
        detail: "文档库路径不存在，或者不是文件夹",
        field: "rootDir"
      });
    }

    const currentState = this.workspaceNavigationStateRepository.findByWorkspaceIdAndUserId(workspaceId, userId);
    const nextRecord: WorkspaceNavigationStateLike = {
      workspaceId,
      userId,
      collapsed: currentState?.collapsed ?? false,
      backgroundColor: currentState?.backgroundColor ?? workspace.backgroundColor ?? null,
      affairsLibraryRootPath: normalizedRootDir,
      affairsLibraryEnabled: true,
      affairsLibraryFavoritesJson: currentState?.affairsLibraryFavoritesJson ?? "[]",
      updatedAt: nowIso()
    };
    this.workspaceNavigationStateRepository.upsert(nextRecord);
    this.scheduleAutoRefresh(workspaceId, "binding_saved");

    const config = this.readConfig(normalizedRootDir);
    return {
      workspaceId,
      rootDir: normalizedRootDir,
      enabled: true,
      mirrorRoot: config.mirrorRoot,
      allowedExtensions: config.allowedExtensions,
      configRelativePath: DEFAULT_CONFIG_RELATIVE_PATH,
      exportMode: DEFAULT_EXPORT_MODE,
      updatedAt: nextRecord.updatedAt
    };
  }

  setEnabled(workspaceId: string, userId: string, enabled: boolean): AffairsLibraryBindingDto {
    const workspace = this.workspaceService.getWorkspaceOrThrow(workspaceId);
    const currentState = this.workspaceNavigationStateRepository.findByWorkspaceIdAndUserId(workspaceId, userId);
    const rootDir = currentState?.affairsLibraryRootPath?.trim() ?? "";

    if (!rootDir) {
      throw new AppError({
        statusCode: 409,
        errorCode: "AFFAIRS_LIBRARY_BINDING_REQUIRED",
        detail: "当前工作区还没有绑定文档库路径"
      });
    }

    if (enabled) {
      this.assertLibraryRootDir(rootDir);
    }

    const nextRecord: WorkspaceNavigationStateLike = {
      workspaceId,
      userId,
      collapsed: currentState?.collapsed ?? false,
      backgroundColor: currentState?.backgroundColor ?? workspace.backgroundColor ?? null,
      affairsLibraryRootPath: rootDir,
      affairsLibraryEnabled: enabled,
      affairsLibraryFavoritesJson: currentState?.affairsLibraryFavoritesJson ?? "[]",
      updatedAt: nowIso()
    };
    this.workspaceNavigationStateRepository.upsert(nextRecord);
    if (enabled) {
      this.scheduleAutoRefresh(workspaceId, "library_enabled");
    }

    const config = this.readConfig(rootDir);
    return {
      workspaceId,
      rootDir,
      enabled,
      mirrorRoot: config.mirrorRoot,
      allowedExtensions: config.allowedExtensions,
      configRelativePath: DEFAULT_CONFIG_RELATIVE_PATH,
      exportMode: DEFAULT_EXPORT_MODE,
      updatedAt: nextRecord.updatedAt
    };
  }

  getConfig(workspaceId: string, userId: string): {
    binding: AffairsLibraryBindingDto | null;
    mirrorRoot: string | null;
    allowedExtensions: string[];
    configRelativePath: string;
    canWrite: boolean;
  } {
    const binding = this.getBinding(workspaceId, userId);
    if (!binding) {
      return {
        binding: null,
        mirrorRoot: null,
        allowedExtensions: [],
        configRelativePath: DEFAULT_CONFIG_RELATIVE_PATH,
        canWrite: false
      };
    }

    const config = this.readConfig(binding.rootDir);
    return {
      binding,
      mirrorRoot: config.mirrorRoot,
      allowedExtensions: config.allowedExtensions,
      configRelativePath: DEFAULT_CONFIG_RELATIVE_PATH,
      canWrite: true
    };
  }

  async saveConfig(
    workspaceId: string,
    userId: string,
    input: {
      mirrorRoot?: string | null;
      allowedExtensions?: string[];
    }
  ): Promise<{
    binding: AffairsLibraryBindingDto;
    mirrorRoot: string | null;
    allowedExtensions: string[];
    configRelativePath: string;
    canWrite: boolean;
    applyConfigTaskId: string;
    applyConfigStatus: AffairsLibraryIndexStatusDto;
  }> {
    const binding = this.requireBinding(workspaceId, userId);
    this.ensureLibraryEnabled(binding);

    const configPath = path.join(binding.rootDir, DEFAULT_CONFIG_RELATIVE_PATH);
    const current = this.readRawConfigFile(configPath);
    const mirrorRoot = normalizeOptionalAbsolutePath(input.mirrorRoot);
    const allowedExtensions = normalizeAllowedExtensions(input.allowedExtensions ?? current.allowedExtensions ?? []);
    const nextPayload: AffairsLibraryConfigPayload = {
      allowedExtensions,
    };

    if (mirrorRoot) {
      nextPayload.mirrorRoot = mirrorRoot;
    } else {
      delete nextPayload.mirrorRoot;
    }

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(nextPayload, null, 2)}\n`, "utf8");

    const handle = this.taskManager.enqueue<{ workspaceId: string; rootDir: string }, AffairsIndexerCommandResult>(
      HOST_TASK_TYPES.affairsLibraryApplyConfig,
      {
        key: workspaceId,
        source: "affairs_library.apply_config_after_save",
        input: {
          workspaceId,
          rootDir: binding.rootDir
        }
      }
    );
    await handle.promise;
    const nextBinding = this.requireBinding(workspaceId, userId);

    return {
      binding: nextBinding,
      mirrorRoot,
      allowedExtensions,
      configRelativePath: DEFAULT_CONFIG_RELATIVE_PATH,
      canWrite: true,
      applyConfigTaskId: handle.taskId,
      applyConfigStatus: this.readIndexStatus(workspaceId, nextBinding)
    };
  }

  getSnapshot(workspaceId: string, userId: string): AffairsLibrarySnapshotDto {
    const binding = this.getBinding(workspaceId, userId);
    const status = this.readIndexStatus(workspaceId, binding);
    const favorites = this.readFavorites(workspaceId, userId);

    if (!binding) {
      return {
        binding: null,
        status,
        tags: [],
        favorites,
        folders: [],
        documentCount: 0,
        lastError: null
      };
    }

    if (!binding.enabled) {
      return {
        binding,
        status,
        tags: [],
        favorites,
        folders: [],
        documentCount: 0,
        lastError: status.errorSummary
      };
    }

    const exportData = this.readAvailableExportData(binding.rootDir);
    if (!exportData) {
      return {
        binding,
        status: status.state === "fresh"
          ? {
              ...status,
              state: "stale",
              errorSummary: "当前还没有可读取的文档库导出结果，先运行一次索引刷新。"
            }
          : status,
        tags: [],
        favorites,
        folders: [],
        documentCount: 0,
        lastError: "当前还没有可读取的文档库导出结果，先运行一次索引刷新。"
      };
    }

    return {
      binding,
      status: {
        ...status,
        lastCompletedAt: status.lastCompletedAt ?? exportData.generatedAt ?? status.lastCompletedAt
      },
      tags: exportData.tags,
      favorites,
      folders: exportData.folders,
      documentCount: exportData.documents.length,
      lastError: status.errorSummary
    };
  }

  listDocuments(
    workspaceId: string,
    userId: string,
    input: ListAffairsLibraryDocumentsInput
  ): AffairsLibraryDocumentListDto {
    const binding = this.getBinding(workspaceId, userId);
    if (!binding || !binding.enabled) {
      return {
        total: 0,
        offset: 0,
        limit: normalizePositiveInt(input.limit, 120, 400),
        items: [],
        tagFacetCounts: {}
      };
    }

    const favorites = this.readFavorites(workspaceId, userId);
    const exportData = this.readAvailableExportData(binding.rootDir);
    if (!exportData) {
      return {
        total: 0,
        offset: 0,
        limit: normalizePositiveInt(input.limit, 120, 400),
        items: [],
        tagFacetCounts: {}
      };
    }
    const browseMode = input.browseMode === "tag" ? "tag" : "folder";
    const offset = Math.max(0, normalizePositiveInt(input.offset, 0, Number.MAX_SAFE_INTEGER));
    const limit = normalizePositiveInt(input.limit, 120, 400);
    const selectedFavorite = favorites.find(
      (item) => buildFavoriteNodeId(item.kind, item.path) === (input.selectedFavoriteId?.trim() ?? "")
    ) ?? null;
    const normalizedSelectedTagPaths = normalizeSelectedTagPaths(input.selectedTagPaths);

    const filtered = exportData.documents.filter((document) => {
      if (browseMode === "tag") {
        const tagPaths = selectedFavorite?.kind === "tag"
          ? [selectedFavorite.path]
          : normalizedSelectedTagPaths.length > 0
            ? normalizedSelectedTagPaths
            : (input.selectedTagPath?.trim() ? [input.selectedTagPath.trim()] : []);
        return tagPaths.length === 0 || tagPaths.every((tagPath) => matchesTagPath(document, tagPath));
      }

      const folderPath = selectedFavorite?.kind === "folder"
        ? selectedFavorite.path
        : (input.selectedFolderPath?.trim() ?? "");
      return matchesDirectFolder(document.path, folderPath);
    });

    const items = filtered.slice(offset, offset + limit).map<AffairsLibraryDocumentRecordDto>((document) => {
      const fileStats = readAffairsLibraryStatsSafe(binding.rootDir, document.path);
      return {
        ...document,
        createdAt: document.createdAt ?? toIsoOrNull(fileStats?.birthtime),
        sizeBytes: document.sizeBytes ?? fileStats?.size ?? null,
        isFavorite: favorites.some((favorite) =>
          matchesFavorite(favorite, document.path, document.tags, document.derivedTags)
        )
      };
    });

    return {
      total: filtered.length,
      offset,
      limit,
      items,
      tagFacetCounts: browseMode === "tag"
        ? buildTagFacetCounts(exportData.documents, normalizedSelectedTagPaths, selectedFavorite?.kind === "tag" ? selectedFavorite.path : null)
        : {}
    };
  }

  updateFavorites(
    workspaceId: string,
    userId: string,
    favorites: AffairsLibraryFavoriteRecord[]
  ): AffairsLibraryFavoriteRecord[] {
    const currentState = this.workspaceNavigationStateRepository.findByWorkspaceIdAndUserId(workspaceId, userId);
    const workspace = this.workspaceService.getWorkspaceOrThrow(workspaceId);
    const normalizedFavorites = favorites
      .filter((item) => item && (item.kind === "folder" || item.kind === "tag") && item.path.trim())
      .map((item) => ({
        kind: item.kind,
        path: item.path.trim(),
        label: item.label.trim() || item.path.trim()
      }));

    this.workspaceNavigationStateRepository.upsert({
      workspaceId,
      userId,
      collapsed: currentState?.collapsed ?? false,
      backgroundColor: currentState?.backgroundColor ?? workspace.backgroundColor ?? null,
      affairsLibraryRootPath: currentState?.affairsLibraryRootPath ?? null,
      affairsLibraryEnabled: currentState?.affairsLibraryEnabled ?? false,
      affairsLibraryFavoritesJson: JSON.stringify(normalizedFavorites),
      updatedAt: nowIso()
    });

    return normalizedFavorites;
  }

  previewDocument(workspaceId: string, userId: string, requestedPath: string): FilePreviewResult {
    const resolved = this.resolvePreviewFile(workspaceId, userId, requestedPath, {
      mustExist: true,
      kind: "file"
    });
    const previewKind = detectPreviewKind(resolved.relativePath);
    const fileSize = resolved.stats?.size ?? 0;

    if (isResourcePreviewKind(previewKind) && fileSize > MAX_RESOURCE_PREVIEW_FILE_BYTES) {
      return this.buildPreviewResult({
        workspaceId,
        path: resolved.relativePath,
        supported: false,
        kind: "unsupported",
        reason: "文件过大，当前内置资源预览暂不处理这么大的文件",
        content: null,
        version: null,
        size: fileSize,
        updatedAt: resolved.stats?.mtime.toISOString() ?? null
      });
    }

    if (!isResourcePreviewKind(previewKind) && fileSize > MAX_PREVIEW_FILE_BYTES) {
      return this.buildPreviewResult({
        workspaceId,
        path: resolved.relativePath,
        supported: false,
        kind: "unsupported",
        reason: "文件过大，本轮只提供轻量预览",
        content: null,
        version: null,
        size: fileSize,
        updatedAt: resolved.stats?.mtime.toISOString() ?? null
      });
    }

    if (previewKind === "image" || previewKind === "pdf") {
      return this.buildPreviewResult({
        workspaceId,
        path: resolved.relativePath,
        supported: true,
        kind: previewKind,
        reason: null,
        content: null,
        version: null,
        size: fileSize,
        updatedAt: resolved.stats?.mtime.toISOString() ?? null
      });
    }

    const buffer = fs.readFileSync(resolved.absolutePath);

    if (buffer.includes(0)) {
      return this.buildPreviewResult({
        workspaceId,
        path: resolved.relativePath,
        supported: false,
        kind: "binary",
        reason: "二进制文件暂不支持直接预览",
        content: null,
        version: null,
        size: fileSize || buffer.byteLength,
        updatedAt: resolved.stats?.mtime.toISOString() ?? null
      });
    }

    return this.buildPreviewResult({
      workspaceId,
      path: resolved.relativePath,
      supported: true,
      kind: previewKind,
      reason: null,
      content: buffer.toString("utf8"),
      version: null,
      size: fileSize || buffer.byteLength,
      updatedAt: resolved.stats?.mtime.toISOString() ?? null
    });
  }

  resolvePreviewFile(
    workspaceId: string,
    userId: string,
    requestedPath: string,
    options: {
      mustExist?: boolean;
      kind?: "file" | "directory" | "any";
    } = {}
  ): AffairsLibraryResolvedPreviewFile {
    const binding = this.requireBinding(workspaceId, userId);
    this.ensureLibraryEnabled(binding);
    this.assertLibraryRootDir(binding.rootDir);

    const rootRealPath = fs.realpathSync.native(binding.rootDir);
    const relativePath = normalizeRelativePath(requestedPath, false);
    const absolutePath = path.resolve(binding.rootDir, relativePath);
    const relativeToRoot = path.relative(binding.rootDir, absolutePath);

    if (
      relativeToRoot === ".."
      || relativeToRoot.startsWith(`..${path.sep}`)
      || path.isAbsolute(relativeToRoot)
    ) {
      throw new AppError({
        statusCode: 400,
        errorCode: "PATH_OUT_OF_WORKSPACE",
        detail: "文件路径超出事务资料库边界",
        field: "path"
      });
    }

    const exists = fs.existsSync(absolutePath);
    let stats: fs.Stats | null = null;

    if (exists) {
      const targetRealPath = fs.realpathSync.native(absolutePath);
      const relativeToRealRoot = path.relative(rootRealPath, targetRealPath);

      if (
        relativeToRealRoot === ".."
        || relativeToRealRoot.startsWith(`..${path.sep}`)
        || path.isAbsolute(relativeToRealRoot)
      ) {
        throw new AppError({
          statusCode: 400,
          errorCode: "PATH_OUT_OF_WORKSPACE",
          detail: "文件路径超出事务资料库边界",
          field: "path"
        });
      }

      stats = fs.statSync(absolutePath);
    } else if (options.mustExist ?? true) {
      throw new AppError({
        statusCode: 404,
        errorCode: "FILE_NOT_FOUND",
        detail: "指定文件不存在",
        field: "path"
      });
    }

    if (stats && options.kind === "file" && !stats.isFile()) {
      throw new AppError({
        statusCode: 400,
        errorCode: "NOT_A_FILE",
        detail: "指定路径不是文件",
        field: "path"
      });
    }

    if (stats && options.kind === "directory" && !stats.isDirectory()) {
      throw new AppError({
        statusCode: 400,
        errorCode: "NOT_A_DIRECTORY",
        detail: "指定路径不是目录",
        field: "path"
      });
    }

    return {
      workspaceId,
      userId,
      rootDir: binding.rootDir,
      rootRealPath,
      relativePath,
      absolutePath,
      exists,
      stats
    };
  }

  requestRefresh(
    workspaceId: string,
    userId: string,
    reason: string
  ): { taskId: string; deduped: boolean; status: AffairsLibraryIndexStatusDto } {
    const binding = this.requireBinding(workspaceId, userId);
    this.ensureLibraryEnabled(binding);

    const handle = this.taskManager.enqueue<{ workspaceId: string; rootDir: string; reason: string; targetPath?: string }, AffairsIndexerCommandResult>(
      HOST_TASK_TYPES.affairsLibraryIndex,
      {
        key: workspaceId,
        source: "affairs_library.refresh",
        input: {
          workspaceId,
          rootDir: binding.rootDir,
          reason: reason.trim() || "manual_refresh"
        }
      }
    );
    void handle.promise.then(() => {
      this.invalidateExportCache(binding.rootDir);
    });

    return {
      taskId: handle.taskId,
      deduped: handle.deduped,
      status: this.readIndexStatus(workspaceId, binding)
    };
  }

  requestRefreshHint(
    workspaceId: string,
    userId: string,
    reason: string,
    targetPath?: string | null
  ): { scheduled: boolean; status: AffairsLibraryIndexStatusDto } {
    const binding = this.requireBinding(workspaceId, userId);
    this.ensureLibraryEnabled(binding);

    this.scheduleAutoRefresh(
      workspaceId,
      reason.trim() || "directory_hint",
      normalizeHintTargetPath(targetPath)
    );

    return {
      scheduled: true,
      status: this.readIndexStatus(workspaceId, binding)
    };
  }

  notifyWorkspaceFileMutation(
    workspaceId: string,
    input: {
      absolutePath: string;
      kind: "upsert" | "delete";
    }
  ): void {
    const normalizedWorkspaceId = workspaceId.trim();
    const absolutePath = input.absolutePath.trim();
    if (!normalizedWorkspaceId || !absolutePath) {
      return;
    }

    const binding = this.workspaceNavigationStateRepository.findAnyEnabledAffairsLibraryByWorkspaceId(normalizedWorkspaceId);
    const rootDir = binding?.affairsLibraryRootPath?.trim() ?? "";
    if (!rootDir || binding?.affairsLibraryEnabled !== true) {
      return;
    }

    const relativePath = resolveAffairsLibraryRelativePath(rootDir, absolutePath);
    if (!relativePath) {
      return;
    }

    if (relativePath === DEFAULT_CONFIG_RELATIVE_PATH) {
      this.scheduleAutoApplyConfig(normalizedWorkspaceId, `app_write:${relativePath}`);
      return;
    }

    if (relativePath === TAG_RULES_RELATIVE_PATH) {
      this.scheduleAutoRecomputeTags(normalizedWorkspaceId, `app_write:${relativePath}`);
      return;
    }

    if (relativePath === ".ai-index" || relativePath.startsWith(".ai-index/")) {
      return;
    }

    const targetPath = normalizeMutationRefreshTarget(relativePath);
    if (!targetPath) {
      return;
    }

    this.scheduleAutoRefresh(
      normalizedWorkspaceId,
      `app_${input.kind}:${targetPath}`,
      targetPath
    );
  }

  scheduleAutoRefresh(workspaceId: string, reason: string, targetPath?: string): void {
    const normalizedWorkspaceId = workspaceId.trim();
    if (!normalizedWorkspaceId) {
      return;
    }

    const state = this.getOrCreateAutoTaskState(normalizedWorkspaceId);
    state.indexReasons.add(reason.trim() || "auto_refresh");
    if (targetPath?.trim()) {
      state.indexTargets.add(targetPath.trim().replace(/^\.\//, ""));
    }
    this.armAutoTaskTimer(normalizedWorkspaceId, AUTO_TASK_QUIET_WINDOW_MS);
  }

  scheduleAutoApplyConfig(workspaceId: string, reason: string): void {
    const normalizedWorkspaceId = workspaceId.trim();
    if (!normalizedWorkspaceId) {
      return;
    }

    const state = this.getOrCreateAutoTaskState(normalizedWorkspaceId);
    state.applyConfigReasons.add(reason.trim() || `watch:${DEFAULT_CONFIG_RELATIVE_PATH}`);
    this.armAutoTaskTimer(normalizedWorkspaceId, AUTO_TASK_QUIET_WINDOW_MS);
  }

  scheduleAutoRecomputeTags(workspaceId: string, reason: string): void {
    const normalizedWorkspaceId = workspaceId.trim();
    if (!normalizedWorkspaceId) {
      return;
    }

    const state = this.getOrCreateAutoTaskState(normalizedWorkspaceId);
    state.recomputeTagReasons.add(reason.trim() || `watch:${TAG_RULES_RELATIVE_PATH}`);
    this.armAutoTaskTimer(normalizedWorkspaceId, AUTO_TASK_QUIET_WINDOW_MS);
  }

  dispose(): void {
    for (const state of this.autoTaskStateByWorkspace.values()) {
      if (state.timer) {
        clearTimeout(state.timer);
      }
    }
    this.autoTaskStateByWorkspace.clear();
  }

  getRefreshTaskSnapshot(workspaceId: string): TaskSnapshot | null {
    return this.taskManager.peek(HOST_TASK_TYPES.affairsLibraryIndex, workspaceId);
  }

  private readFavorites(workspaceId: string, userId: string): AffairsLibraryFavoriteRecord[] {
    const state = this.workspaceNavigationStateRepository.findByWorkspaceIdAndUserId(workspaceId, userId);
    const raw = state?.affairsLibraryFavoritesJson?.trim();
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter((item): item is { kind?: string; path?: string; label?: string } => Boolean(item) && typeof item === "object")
        .filter((item) => (item.kind === "folder" || item.kind === "tag") && typeof item.path === "string" && item.path.trim())
        .map((item) => ({
          kind: item.kind as AffairsLibraryFavoriteKind,
          path: item.path!.trim(),
          label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : item.path!.trim()
        }));
    } catch {
      return [];
    }
  }

  private readIndexStatus(
    workspaceId: string,
    binding: AffairsLibraryBindingDto | null
  ): AffairsLibraryIndexStatusDto {
    const taskSnapshot = this.taskManager.peek(HOST_TASK_TYPES.affairsLibraryIndex, workspaceId);
    const exportStatus = binding?.enabled ? readIndexStatusFileSafe(binding.rootDir) : null;
    if (taskSnapshot && (taskSnapshot.status === "queued" || taskSnapshot.status === "running")) {
      const reconciledStatus = buildCompletedStatusFromExport(
        exportStatus,
        taskSnapshot.enqueuedAt,
        taskSnapshot.startedAt
      );
      if (reconciledStatus) {
        return reconciledStatus;
      }

      return {
        state: "running",
        dirtyReasons: ["refresh_requested"],
        lastRequestedAt: toIso(taskSnapshot.enqueuedAt),
        lastStartedAt: toIso(taskSnapshot.startedAt),
        lastCompletedAt: null,
        lastFailedAt: null,
        nextAllowedAt: null,
        runningTaskId: taskSnapshot.taskId,
        errorSummary: null
      };
    }

    if (taskSnapshot?.status === "failed" || taskSnapshot?.status === "timeout" || taskSnapshot?.status === "cancelled") {
      const failedAt = toIso(taskSnapshot.finishedAt);
      const failedAtMs = taskSnapshot.finishedAt ?? Date.now();
      const nextAllowedAtMs = failedAtMs + INDEX_TASK_COOLDOWN_MS;
      const now = Date.now();

      return {
        state: now < nextAllowedAtMs ? "cooldown" : "failed",
        dirtyReasons: ["refresh_failed"],
        lastRequestedAt: toIso(taskSnapshot.enqueuedAt),
        lastStartedAt: toIso(taskSnapshot.startedAt),
        lastCompletedAt: null,
        lastFailedAt: failedAt,
        nextAllowedAt: toIso(nextAllowedAtMs),
        runningTaskId: null,
        errorSummary: taskSnapshot.errorMessage ?? "最近一次文档库刷新失败"
      };
    }

    if (!binding) {
      return {
        state: "stale",
        dirtyReasons: ["binding_required"],
        lastRequestedAt: null,
        lastStartedAt: null,
        lastCompletedAt: null,
        lastFailedAt: null,
        nextAllowedAt: null,
        runningTaskId: null,
        errorSummary: null
      };
    }

    if (!binding.enabled) {
      return {
        state: "stale",
        dirtyReasons: ["library_disabled"],
        lastRequestedAt: null,
        lastStartedAt: null,
        lastCompletedAt: null,
        lastFailedAt: null,
        nextAllowedAt: null,
        runningTaskId: null,
        errorSummary: "文档库功能已关闭，启用后才会启动内置索引服务。"
      };
    }

    const cachedExportData = this.readLastUsableExportData(binding.rootDir);
    const missingArtifact = detectMissingIndexArtifact(binding.rootDir);
    if (missingArtifact) {
      return {
        state: "stale",
        dirtyReasons: [missingArtifact.reason],
        lastRequestedAt: null,
        lastStartedAt: null,
        lastCompletedAt: cachedExportData?.generatedAt ?? null,
        lastFailedAt: null,
        nextAllowedAt: null,
        runningTaskId: null,
        errorSummary: missingArtifact.errorSummary
      };
    }

    return buildCompletedStatusFromExport(exportStatus, null, null) ?? {
      state: "stale",
      dirtyReasons: ["missing_export_status"],
      lastRequestedAt: null,
      lastStartedAt: null,
      lastCompletedAt: null,
      lastFailedAt: null,
      nextAllowedAt: null,
      runningTaskId: null,
      errorSummary: "文档库导出状态文件缺失，系统会自动补跑一次全量重建。"
    };
  }

  private registerBackgroundTasks(): void {
    if (!this.taskManager.has(HOST_TASK_TYPES.affairsLibraryApplyConfig)) {
      this.taskManager.register<{ workspaceId: string; rootDir: string; reason?: string }, AffairsIndexerCommandResult>({
        taskType: HOST_TASK_TYPES.affairsLibraryApplyConfig,
        executionLane: "helper_process",
        helperProcessHandler: "affairs.library_apply_config",
        timeoutMs: INDEX_TASK_TIMEOUT_MS,
        run: async (input) =>
          await this.runInternalCommand(input.rootDir, "apply-config", {
            reason: input.reason
          })
      });
    }

    if (!this.taskManager.has(HOST_TASK_TYPES.affairsLibraryIndex)) {
      this.taskManager.register<{
        workspaceId: string;
        rootDir: string;
        reason: string;
        targetPath?: string;
        commandMode?: "incremental" | "full";
      }, AffairsIndexerCommandResult>({
        taskType: HOST_TASK_TYPES.affairsLibraryIndex,
        executionLane: "helper_process",
        helperProcessHandler: "affairs.library_index",
        timeoutMs: INDEX_TASK_TIMEOUT_MS,
        run: async (input) =>
          await this.runInternalCommand(
            input.rootDir,
            input.commandMode === "incremental" || input.targetPath ? "watch-touch" : "index",
            {
              targetPath: input.targetPath,
              reason: input.reason
            }
          )
      });
    }

    if (!this.taskManager.has(HOST_TASK_TYPES.affairsLibraryRecomputeTags)) {
      this.taskManager.register<{ workspaceId: string; rootDir: string; reason?: string }, AffairsIndexerCommandResult>({
        taskType: HOST_TASK_TYPES.affairsLibraryRecomputeTags,
        executionLane: "helper_process",
        helperProcessHandler: "affairs.library_recompute_tags",
        timeoutMs: INDEX_TASK_TIMEOUT_MS,
        run: async (input) =>
          await this.runInternalCommand(input.rootDir, "recompute-tags", {
            reason: input.reason
          })
      });
    }

    if (!this.taskManager.has(HOST_TASK_TYPES.affairsLibraryExport)) {
      this.taskManager.register<{ workspaceId: string; rootDir: string }, AffairsIndexerCommandResult>({
        taskType: HOST_TASK_TYPES.affairsLibraryExport,
        executionLane: "helper_process",
        helperProcessHandler: "affairs.library_export",
        timeoutMs: INDEX_TASK_TIMEOUT_MS,
        run: async (input) => await this.runInternalCommand(input.rootDir, "export")
      });
    }
  }

  private async runInternalCommand(
    rootDir: string,
    commandName: "apply-config" | "index" | "recompute-tags" | "export" | "watch-touch",
    options: {
      targetPath?: string;
      reason?: string;
    } = {}
  ): Promise<AffairsIndexerCommandResult> {
    this.logger.info(
      {
        rootDir,
        commandName,
        targetPath: options.targetPath ?? null,
        reason: options.reason ?? null,
        executionMode: "internal_helper"
      },
      "开始执行内置事务视图文档库索引命令"
    );

    return await runAffairsIndexerCommand(rootDir, commandName, options);
  }

  private resumeEnabledBindings(): void {
    for (const state of this.workspaceNavigationStateRepository.listEnabledAffairsLibraries()) {
      const binding = this.getBinding(state.workspaceId, state.userId);
      const status = this.readIndexStatus(state.workspaceId, binding);
      if (status.state === "fresh" || status.state === "cooldown" || status.state === "running") {
        this.logger.info(
          {
            workspaceId: state.workspaceId,
            rootDir: binding?.rootDir ?? state.affairsLibraryRootPath ?? null,
            status: status.state,
            source: "affairs_library.startup_resume"
          },
          "事务文档库启动恢复已跳过，当前索引状态无需补跑"
        );
        continue;
      }

      this.scheduleAutoRefresh(state.workspaceId, "startup_resume");
    }
  }

  private async flushAutoTasks(workspaceId: string): Promise<void> {
    const state = this.autoTaskStateByWorkspace.get(workspaceId);
    if (!state) {
      return;
    }

    state.timer = null;
    if (!hasPendingAutoTasks(state)) {
      this.autoTaskStateByWorkspace.delete(workspaceId);
      return;
    }

    const binding = this.workspaceNavigationStateRepository.findAnyEnabledAffairsLibraryByWorkspaceId(workspaceId);
    const rootDir = binding?.affairsLibraryRootPath?.trim() ?? "";

    if (!rootDir) {
      this.logger.info(
        {
          workspaceId,
          skipped: "binding_missing",
          source: "affairs_library.auto_task"
        },
        "事务文档库自动任务已跳过，当前工作区没有启用的文档库绑定"
      );
      this.autoTaskStateByWorkspace.delete(workspaceId);
      return;
    }

    if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
      this.logger.info(
        {
          workspaceId,
          rootDir,
          skipped: "root_dir_invalid",
          source: "affairs_library.auto_task"
        },
        "事务文档库自动任务已跳过，当前根目录不可用"
      );
      this.autoTaskStateByWorkspace.delete(workspaceId);
      return;
    }

    const missingArtifact = detectMissingIndexArtifact(rootDir);
    if (missingArtifact) {
      state.indexReasons.add(missingArtifact.reason);
      state.indexTargets.clear();
    }

    const blockingTask = this.findBlockingAutoTask(workspaceId);
    if (blockingTask) {
      this.logger.info(
        {
          workspaceId,
          blockingTaskType: blockingTask.taskType,
          blockingTaskStatus: blockingTask.status,
          source: "affairs_library.auto_task"
        },
        "事务文档库已有后台任务在跑，当前脏标记会等下一轮补跑"
      );
      this.armAutoTaskTimer(workspaceId, AUTO_TASK_RETRY_WINDOW_MS);
      return;
    }

    if (state.applyConfigReasons.size > 0) {
      const reason = joinAutoTaskReasons(state.applyConfigReasons, `watch:${DEFAULT_CONFIG_RELATIVE_PATH}`);
      state.applyConfigReasons.clear();
      const handle = this.taskManager.enqueue<{ workspaceId: string; rootDir: string; reason?: string }, AffairsIndexerCommandResult>(
        HOST_TASK_TYPES.affairsLibraryApplyConfig,
        {
          key: workspaceId,
          source: "affairs_library.watch_apply_config",
          input: {
            workspaceId,
            rootDir,
            reason
          }
        }
      );
      this.attachAutoTaskFollowUp(workspaceId, handle, {
        rootDir,
        reason,
        source: "affairs_library.watch_apply_config"
      });
      return;
    }

    if (state.recomputeTagReasons.size > 0) {
      const reason = joinAutoTaskReasons(state.recomputeTagReasons, `watch:${TAG_RULES_RELATIVE_PATH}`);
      state.recomputeTagReasons.clear();
      const handle = this.taskManager.enqueue<{ workspaceId: string; rootDir: string; reason?: string }, AffairsIndexerCommandResult>(
        HOST_TASK_TYPES.affairsLibraryRecomputeTags,
        {
          key: workspaceId,
          source: "affairs_library.watch_recompute_tags",
          input: {
            workspaceId,
            rootDir,
            reason
          }
        }
      );
      this.attachAutoTaskFollowUp(workspaceId, handle, {
        rootDir,
        reason,
        source: "affairs_library.watch_recompute_tags"
      });
      return;
    }

    if (state.indexReasons.size > 0 || state.indexTargets.size > 0) {
      const forceFullRebuild = [...state.indexReasons].some((reason) => shouldForceFullRebuild(reason));
      const targetPath = forceFullRebuild ? undefined : pickNarrowestTargetPath([...state.indexTargets]);
      const reason = joinAutoTaskReasons(
        state.indexReasons,
        targetPath ? `watch:${targetPath}` : "watch:auto_refresh"
      );
      state.indexReasons.clear();
      state.indexTargets.clear();
      const handle = this.taskManager.enqueue<{
        workspaceId: string;
        rootDir: string;
        reason: string;
        targetPath?: string;
        commandMode?: "incremental" | "full";
      }, AffairsIndexerCommandResult>(
        HOST_TASK_TYPES.affairsLibraryIndex,
        {
          key: workspaceId,
          source: "affairs_library.auto_refresh",
          input: {
            workspaceId,
            rootDir,
            reason,
            ...(targetPath ? {} : { commandMode: forceFullRebuild ? "full" : "incremental" }),
            ...(targetPath ? { targetPath } : {})
          }
        }
      );
      this.attachAutoTaskFollowUp(workspaceId, handle, {
        rootDir,
        reason,
        targetPath,
        source: "affairs_library.auto_refresh"
      });
      return;
    }

    this.autoTaskStateByWorkspace.delete(workspaceId);
  }

  private getOrCreateAutoTaskState(workspaceId: string): AffairsLibraryAutoTaskState {
    const current = this.autoTaskStateByWorkspace.get(workspaceId);
    if (current) {
      return current;
    }

    const next: AffairsLibraryAutoTaskState = {
      timer: null,
      applyConfigReasons: new Set<string>(),
      recomputeTagReasons: new Set<string>(),
      indexReasons: new Set<string>(),
      indexTargets: new Set<string>()
    };
    this.autoTaskStateByWorkspace.set(workspaceId, next);
    return next;
  }

  private armAutoTaskTimer(workspaceId: string, delayMs: number): void {
    const state = this.getOrCreateAutoTaskState(workspaceId);
    if (state.timer) {
      clearTimeout(state.timer);
    }
    state.timer = setTimeout(() => {
      void this.flushAutoTasks(workspaceId);
    }, delayMs);
  }

  private findBlockingAutoTask(workspaceId: string): TaskSnapshot | null {
    const taskTypes = [
      HOST_TASK_TYPES.affairsLibraryApplyConfig,
      HOST_TASK_TYPES.affairsLibraryIndex,
      HOST_TASK_TYPES.affairsLibraryRecomputeTags,
      HOST_TASK_TYPES.affairsLibraryExport
    ];

    for (const taskType of taskTypes) {
      const snapshot = this.taskManager.peek(taskType, workspaceId);
      if (snapshot && (snapshot.status === "queued" || snapshot.status === "running")) {
        return snapshot;
      }
    }

    return null;
  }

  private attachAutoTaskFollowUp(
    workspaceId: string,
    handle: {
      taskId: string;
      taskType: string;
      deduped: boolean;
      promise: Promise<AffairsIndexerCommandResult>;
    },
    meta: {
      rootDir: string;
      reason: string;
      source: string;
      targetPath?: string | null;
    }
  ): void {
    this.logger.info(
      {
        workspaceId,
        rootDir: meta.rootDir,
        reason: meta.reason,
        targetPath: meta.targetPath ?? null,
        taskType: handle.taskType,
        taskId: handle.taskId,
        deduped: handle.deduped,
        source: meta.source
      },
      "事务文档库自动任务已入队"
    );

    void handle.promise.then(
      (result) => {
        this.invalidateExportCache(meta.rootDir);
        this.logger.info(
          {
            workspaceId,
            rootDir: meta.rootDir,
            reason: meta.reason,
            targetPath: meta.targetPath ?? null,
            taskType: handle.taskType,
            taskId: handle.taskId,
            command: result.command,
            durationMs: result.durationMs,
            resultSummary: summarizeIndexerCommandResult(result.result),
            source: meta.source
          },
          "事务文档库自动任务执行完成"
        );
      },
      (error) => {
        this.logger.info(
          {
            workspaceId,
            rootDir: meta.rootDir,
            reason: meta.reason,
            targetPath: meta.targetPath ?? null,
            taskType: handle.taskType,
            taskId: handle.taskId,
            error: error instanceof Error ? error.message : String(error),
            source: meta.source
          },
          "事务文档库自动任务执行失败"
        );
      }
    ).finally(() => {
      const state = this.autoTaskStateByWorkspace.get(workspaceId);
      if (!state) {
        return;
      }

      if (!hasPendingAutoTasks(state)) {
        if (!state.timer) {
          this.autoTaskStateByWorkspace.delete(workspaceId);
        }
        return;
      }

      this.armAutoTaskTimer(workspaceId, 50);
    });
  }

  private readExportData(rootDir: string): AffairsLibraryExportData {
    const exportRoot = path.join(rootDir, EXPORT_DIR_RELATIVE_PATH);
    const manifestPath = path.join(rootDir, EXPORT_MANIFEST_RELATIVE_PATH);
    const signature = this.buildExportSignature(exportRoot, manifestPath);
    const cached = this.exportCache.get(rootDir);
    if (cached && cached.signature === signature) {
      return {
        documents: cached.documents,
        tags: cached.tags,
        folders: cached.folders,
        generatedAt: cached.generatedAt
      };
    }

    const diskCache = this.readExportCacheFile(exportRoot, signature);
    if (diskCache) {
      this.exportCache.set(rootDir, diskCache);
      return {
        documents: diskCache.documents,
        tags: diskCache.tags,
        folders: diskCache.folders,
        generatedAt: diskCache.generatedAt
      };
    }

    const parsed = this.parseExportData(rootDir, exportRoot, manifestPath);
    const cachePayload: AffairsLibraryExportCachePayload = {
      schemaVersion: SNAPSHOT_CACHE_SCHEMA_VERSION,
      signature,
      generatedAt: parsed.generatedAt,
      documents: parsed.documents,
      tags: parsed.tags,
      folders: parsed.folders
    };
    this.exportCache.set(rootDir, cachePayload);
    this.writeExportCacheFile(exportRoot, cachePayload);
    return parsed;
  }

  private parseExportData(rootDir: string, exportRoot: string, manifestPath: string): AffairsLibraryExportData {
    const manifest = readJsonFile<IndexManifestPayload>(manifestPath);
    const metaShardPaths = (manifest.meta_shards ?? [])
      .map((item) => item.path?.trim() ?? "")
      .filter(Boolean);
    const documents = metaShardPaths.flatMap((relativePath) => {
      const payload = readJsonFile<IndexMetaShardPayload>(path.join(exportRoot, relativePath));
      return (payload.documents ?? []).map<AffairsLibraryDocumentRecordDto>((document) => {
        const safePath = document.path?.trim() ?? "";
        return {
          documentId: document.document_id?.trim() ?? safePath,
          path: safePath,
          title: document.title?.trim() || path.basename(safePath) || "未命名文档",
          summary: document.summary?.trim() ?? "",
          updatedAt: document.mtime?.trim() ?? "",
          createdAt: null,
          sizeBytes: null,
          tags: Array.isArray(document.direct_tags) ? document.direct_tags.filter(Boolean) : [],
          derivedTags: Array.isArray(document.derived_tags) ? document.derived_tags.filter(Boolean) : [],
          isFavorite: false
        };
      });
    });

    const taxonomyEntry = manifest.entries?.taxonomy?.trim() || "taxonomy.json";
    const taxonomy = readJsonFile<IndexTaxonomyPayload>(path.join(exportRoot, taxonomyEntry));
    const tags = (taxonomy.nodes ?? []).map<AffairsLibraryTagNodeDto>((node) => ({
      path: node.path?.trim() ?? "",
      name: node.name?.trim() || node.path?.trim() || "未命名标签",
      rootType: node.root_type?.trim() || "unknown",
      parentPath: node.parent_path?.trim() || null,
      depth: Number.isFinite(node.depth) ? Number(node.depth) : 0,
      documentCount: countDocumentsForTag(documents, node.path?.trim() ?? "")
    })).filter((node) => node.path);

    const bootstrapEntry = manifest.entries?.bootstrap?.trim() || "bootstrap.json";
    const bootstrap = readJsonFile<IndexBootstrapPayload>(path.join(exportRoot, bootstrapEntry));
    const folders = (bootstrap.folders ?? []).map<AffairsLibraryFolderNodeDto>((folder) => {
      const normalizedPath = folder.path?.trim() ?? ".";
      const folderStats = readAffairsLibraryStatsSafe(rootDir, normalizedPath);
      return {
        path: normalizedPath,
        name: folder.name?.trim() || "资料库",
        parentPath: folder.parent_path?.trim() || null,
        directDocumentCount: Number(folder.direct_document_count ?? 0),
        documentCount: Number(folder.document_count ?? 0),
        createdAt: toIsoOrNull(folderStats?.birthtime),
        updatedAt: toIsoOrNull(folderStats?.mtime)
      };
    });

    return {
      documents,
      tags,
      folders,
      generatedAt: manifest.generated_at?.trim() ?? null
    };
  }

  private buildExportSignature(exportRoot: string, manifestPath: string): string {
    const manifestStat = fs.statSync(manifestPath);
    const statusPath = path.join(exportRoot, "status.json");
    const statusStat = fs.existsSync(statusPath) ? fs.statSync(statusPath) : null;
    const statusPayload = statusStat ? readJsonFile<IndexStatusFilePayload>(statusPath) : null;
    return [
      statusPayload?.exported_at?.trim() ?? "missing",
      statusPayload?.document_count ?? "missing",
      manifestStat.mtimeMs,
      manifestStat.size,
      statusStat?.mtimeMs ?? "missing",
      statusStat?.size ?? "missing"
    ].join(":");
  }

  private invalidateExportCache(rootDir: string): void {
    this.exportCache.delete(rootDir);
    const cachePath = path.join(rootDir, EXPORT_DIR_RELATIVE_PATH, SNAPSHOT_CACHE_FILE_NAME);
    try {
      fs.rmSync(cachePath, { force: true });
    } catch {
      // 这里只是尽量删掉快照缓存，失败不影响主链路。
    }
  }

  private readExportCacheFile(exportRoot: string, signature: string): AffairsLibraryExportCachePayload | null {
    const cachePath = path.join(exportRoot, SNAPSHOT_CACHE_FILE_NAME);
    if (!fs.existsSync(cachePath)) {
      return null;
    }

    try {
      const payload = readJsonFile<AffairsLibraryExportCachePayload>(cachePath);
      if (payload.schemaVersion !== SNAPSHOT_CACHE_SCHEMA_VERSION || payload.signature !== signature) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  private writeExportCacheFile(exportRoot: string, payload: AffairsLibraryExportCachePayload): void {
    const cachePath = path.join(exportRoot, SNAPSHOT_CACHE_FILE_NAME);
    try {
      fs.writeFileSync(cachePath, JSON.stringify(payload));
    } catch {
      // 缓存写失败不影响主流程，直接忽略。
    }
  }

  private buildPreviewResult(
    input: Omit<FilePreviewResult, "previewPath" | "previewUrl" | "capabilities">
  ): FilePreviewResult {
    return {
      ...input,
      previewPath: null,
      previewUrl: null,
      capabilities: buildPreviewCapabilities(input.kind, {
        supported: input.supported,
        content: input.content,
        version: input.version
      })
    };
  }

  private readAvailableExportData(rootDir: string): AffairsLibraryExportData | null {
    try {
      return this.readExportData(rootDir);
    } catch {
      return this.readLastUsableExportData(rootDir);
    }
  }

  private readLastUsableExportData(rootDir: string): AffairsLibraryExportData | null {
    const cached = this.exportCache.get(rootDir);
    if (cached) {
      return {
        documents: cached.documents,
        tags: cached.tags,
        folders: cached.folders,
        generatedAt: cached.generatedAt
      };
    }

    const exportRoot = path.join(rootDir, EXPORT_DIR_RELATIVE_PATH);
    const cachePath = path.join(exportRoot, SNAPSHOT_CACHE_FILE_NAME);
    if (!fs.existsSync(cachePath)) {
      return null;
    }

    try {
      const payload = readJsonFile<AffairsLibraryExportCachePayload>(cachePath);
      this.exportCache.set(rootDir, payload);
      return {
        documents: payload.documents,
        tags: payload.tags,
        folders: payload.folders,
        generatedAt: payload.generatedAt
      };
    } catch {
      return null;
    }
  }

  private readConfig(rootDir: string): {
    mirrorRoot: string | null;
    allowedExtensions: string[];
  } {
    const configPath = path.join(rootDir, DEFAULT_CONFIG_RELATIVE_PATH);
    const payload = this.readRawConfigFile(configPath);
    return {
      mirrorRoot: normalizeOptionalAbsolutePath(payload.mirrorRoot),
      allowedExtensions: normalizeAllowedExtensions(payload.allowedExtensions ?? [])
    };
  }

  private readRawConfigFile(configPath: string): AffairsLibraryConfigPayload {
    if (!fs.existsSync(configPath)) {
      return {};
    }
    try {
      return JSON.parse(fs.readFileSync(configPath, "utf8")) as AffairsLibraryConfigPayload;
    } catch {
      return {};
    }
  }

  private requireBinding(workspaceId: string, userId: string): AffairsLibraryBindingDto {
    const binding = this.getBinding(workspaceId, userId);
    if (!binding) {
      throw new AppError({
        statusCode: 409,
        errorCode: "AFFAIRS_LIBRARY_BINDING_REQUIRED",
        detail: "当前工作区还没有绑定文档库路径"
      });
    }
    return binding;
  }

  private ensureLibraryEnabled(binding: AffairsLibraryBindingDto): void {
    if (binding.enabled) {
      return;
    }
    throw new AppError({
      statusCode: 409,
      errorCode: "AFFAIRS_LIBRARY_DISABLED",
      detail: "文档库功能还没有启用，启用后才会启动内置索引服务。"
    });
  }

  private assertLibraryRootDir(rootDir: string): void {
    if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
      throw new AppError({
        statusCode: 400,
        errorCode: "AFFAIRS_LIBRARY_ROOT_INVALID",
        detail: "事务资料库路径不存在，或者不是文件夹",
        field: "path"
      });
    }
  }
}

function hasPendingAutoTasks(state: AffairsLibraryAutoTaskState): boolean {
  return state.applyConfigReasons.size > 0
    || state.recomputeTagReasons.size > 0
    || state.indexReasons.size > 0
    || state.indexTargets.size > 0;
}

function joinAutoTaskReasons(reasons: Set<string>, fallback: string): string {
  const items = [...reasons]
    .map((item) => item.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  return items.length > 0 ? items.join(" | ") : fallback;
}

function pickNarrowestTargetPath(targets: string[]): string | undefined {
  if (targets.length === 0) {
    return undefined;
  }

  let selected = targets[0]?.trim() || undefined;
  for (const target of targets) {
    const normalizedTarget = target.trim();
    if (!normalizedTarget) {
      continue;
    }
    if (!selected || selected.startsWith(`${normalizedTarget}/`)) {
      selected = normalizedTarget;
    }
  }

  return selected || undefined;
}

function summarizeIndexerCommandResult(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  const payload = result as Record<string, unknown>;
  const indexResult = payload.indexResult;
  if (indexResult && typeof indexResult === "object") {
    const indexPayload = indexResult as Record<string, unknown>;
    return {
      scannedCount: indexPayload.scannedCount ?? null,
      indexedCount: indexPayload.indexedCount ?? null,
      skippedCount: indexPayload.skippedCount ?? null,
      failedCount: indexPayload.failedCount ?? null,
      deletedCount: indexPayload.deletedCount ?? null,
      dirtyScope: indexPayload.dirtyScope ?? null
    };
  }

  if ("scannedCount" in payload || "indexedCount" in payload || "failedCount" in payload) {
    return {
      scannedCount: payload.scannedCount ?? null,
      indexedCount: payload.indexedCount ?? null,
      skippedCount: payload.skipStats && typeof payload.skipStats === "object"
        ? (payload.skipStats as Record<string, unknown>).skippedCount ?? null
        : null,
      failedCount: payload.failedCount ?? null,
      deletedCount: payload.deletedCount ?? null
    };
  }

  if ("changed" in payload || "addedExtensions" in payload || "removedExtensions" in payload) {
    return {
      changed: payload.changed ?? null,
      addedExtensions: payload.addedExtensions ?? null,
      removedExtensions: payload.removedExtensions ?? null
    };
  }

  if ("documentCount" in payload || "exportedAt" in payload) {
    return {
      documentCount: payload.documentCount ?? null,
      exportedAt: payload.exportedAt ?? null
    };
  }

  return null;
}

function countDocumentsForTag(documents: AffairsLibraryDocumentRecordDto[], tagPath: string): number {
  if (!tagPath) {
    return 0;
  }
  return documents.filter((document) => matchesTagPath(document, tagPath)).length;
}

function normalizeSelectedTagPaths(tagPaths: string[] | null | undefined): string[] {
  if (!Array.isArray(tagPaths)) {
    return [];
  }
  const unique = new Set<string>();
  tagPaths.forEach((item) => {
    const normalized = item.trim();
    if (normalized) {
      unique.add(normalized);
    }
  });
  return Array.from(unique);
}

function buildTagFacetCounts(
  documents: AffairsLibraryDocumentRecordDto[],
  selectedTagPaths: string[],
  selectedFavoriteTagPath: string | null
): Record<string, number> {
  const activeTagPaths = selectedFavoriteTagPath?.trim()
    ? [selectedFavoriteTagPath.trim()]
    : selectedTagPaths;
  const counts = new Map<string, number>();

  for (const document of documents) {
    const allTags = [...document.tags, ...document.derivedTags];
    const uniqueTags = new Set<string>();
    allTags
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .forEach((tag) => {
        uniqueTags.add(tag);
        buildAncestorPaths(tag).forEach((ancestorPath) => {
          uniqueTags.add(ancestorPath);
        });
      });
    uniqueTags.forEach((tag) => {
      const available = activeTagPaths
        .filter((selectedPath) => selectedPath !== tag)
        .every((selectedPath) => matchesTagPath(document, selectedPath));
      if (!available) {
        return;
      }
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    });
  }

  return Object.fromEntries(counts);
}

function buildAncestorPaths(tagPath: string): string[] {
  const normalized = tagPath.trim();
  if (!normalized) {
    return [];
  }
  const segments = normalized.split("/");
  const paths: string[] = [];
  for (let index = 0; index < segments.length - 1; index += 1) {
    paths.push(segments.slice(0, index + 1).join("/"));
  }
  return paths;
}

function readAffairsLibraryStatsSafe(rootDir: string, relativePath: string): fs.Stats | null {
  const normalizedPath = relativePath.trim();
  const targetPath = !normalizedPath || normalizedPath === "."
    ? rootDir
    : path.resolve(rootDir, normalizedPath);

  try {
    if (!fs.existsSync(targetPath)) {
      return null;
    }
    return fs.statSync(targetPath);
  } catch {
    return null;
  }
}

function toIsoOrNull(value: Date | null | undefined): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }
  return value.toISOString();
}

function resolveAffairsLibraryRelativePath(rootDir: string, absolutePath: string): string | null {
  const relativePath = path.relative(path.resolve(rootDir), path.resolve(absolutePath)).replace(/\\/g, "/");
  if (!relativePath || relativePath === "." || relativePath.startsWith("../")) {
    return null;
  }
  return relativePath;
}

function normalizeMutationRefreshTarget(relativePath: string): string | null {
  const normalizedPath = relativePath.trim().replace(/^\.\/+/, "").replace(/\/+$/, "");
  return normalizedPath || null;
}

function normalizeHintTargetPath(targetPath: string | null | undefined): string | undefined {
  const normalized = targetPath?.trim().replace(/^\.\/+/, "").replace(/\/+$/, "") ?? "";
  return normalized || undefined;
}

function detectMissingIndexArtifact(rootDir: string): {
  reason: string;
  errorSummary: string;
} | null {
  const checks = [
    {
      relativePath: INDEX_DIR_RELATIVE_PATH,
      reason: "missing_index_artifact",
      errorSummary: "文档库索引目录缺失，系统会自动补跑一次全量重建。"
    },
    {
      relativePath: EXPORT_DIR_RELATIVE_PATH,
      reason: "missing_export_dir",
      errorSummary: "文档库导出目录缺失，系统会自动补跑一次全量重建。"
    },
    {
      relativePath: EXPORT_STATUS_RELATIVE_PATH,
      reason: "missing_export_status",
      errorSummary: "文档库导出状态文件缺失，系统会自动补跑一次全量重建。"
    },
    {
      relativePath: EXPORT_MANIFEST_RELATIVE_PATH,
      reason: "missing_export_manifest",
      errorSummary: "文档库导出清单缺失，系统会自动补跑一次全量重建。"
    }
  ] as const;

  for (const check of checks) {
    if (!fs.existsSync(path.join(rootDir, check.relativePath))) {
      return {
        reason: check.reason,
        errorSummary: check.errorSummary
      };
    }
  }

  return null;
}

function shouldForceFullRebuild(reason: string): boolean {
  const normalizedReason = reason.trim();
  return normalizedReason.includes("missing_index_artifact")
    || normalizedReason.includes("missing_export_dir")
    || normalizedReason.includes("missing_export_status")
    || normalizedReason.includes("missing_export_manifest");
}

function matchesFavorite(
  favorite: AffairsLibraryFavoriteRecord,
  documentPath: string,
  directTags: readonly string[],
  derivedTags: readonly string[]
): boolean {
  if (favorite.kind === "folder") {
    const normalizedPath = favorite.path === "." ? "" : favorite.path.replace(/\/+$/g, "");
    return !normalizedPath || documentPath === normalizedPath || documentPath.startsWith(`${normalizedPath}/`);
  }

  return [...directTags, ...derivedTags].some((tag) => tag === favorite.path || tag.startsWith(`${favorite.path}/`));
}

function buildFavoriteNodeId(kind: AffairsLibraryFavoriteKind, pathValue: string): string {
  return `library:favorite:${kind}:${pathValue}`;
}

function matchesTagPath(document: AffairsLibraryDocumentRecordDto, tagPath: string): boolean {
  const normalizedTagPath = tagPath.trim();
  if (!normalizedTagPath) {
    return true;
  }
  return [...document.tags, ...document.derivedTags].some((tag) => tag === normalizedTagPath || isTagTreeAncestor(normalizedTagPath, tag));
}

function isTagTreeAncestor(parentPath: string, childPath: string): boolean {
  return childPath.startsWith(`${parentPath}/`);
}

function matchesDirectFolder(documentPath: string, folderPath: string | null | undefined): boolean {
  return normalizeFolderPath(getParentFolderPath(documentPath)) === normalizeFolderPath(folderPath ?? null);
}

function getParentFolderPath(documentPath: string): string | null {
  const normalized = documentPath.trim();
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : null;
}

function normalizeFolderPath(value: string | null | undefined): string {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized === ".") {
    return "";
  }
  return normalized.replace(/^\/+|\/+$/g, "");
}

function normalizePositiveInt(input: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(input)) {
    return fallback;
  }
  return Math.max(0, Math.min(Math.trunc(input as number), max));
}

function readIndexStatusFileSafe(rootDir: string): ParsedIndexStatusFile | null {
  const filePath = path.join(rootDir, EXPORT_STATUS_RELATIVE_PATH);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const payload = readJsonFile<IndexStatusFilePayload>(filePath);
    const exportedAt = payload.exported_at?.trim() ?? null;
    const exportedAtMs = exportedAt ? Date.parse(exportedAt) : Number.NaN;
    const documentCount = typeof payload.document_count === "number"
      ? payload.document_count
      : Number.isFinite(Number(payload.document_count))
        ? Number(payload.document_count)
        : null;
    return {
      exportedAt,
      exportedAtMs,
      documentCount
    };
  } catch {
    return null;
  }
}

function buildCompletedStatusFromExport(
  exportStatus: ParsedIndexStatusFile | null,
  enqueuedAtMs: number | null,
  startedAtMs: number | null
): AffairsLibraryIndexStatusDto | null {
  if (!exportStatus?.exportedAt || !Number.isFinite(exportStatus.exportedAtMs)) {
    return null;
  }

  const nextAllowedAtMs = exportStatus.exportedAtMs + INDEX_TASK_COOLDOWN_MS;
  const now = Date.now();
  const lastRequestedAtMs = Number.isFinite(enqueuedAtMs ?? Number.NaN)
    ? Math.max(exportStatus.exportedAtMs, enqueuedAtMs ?? Number.NaN)
    : exportStatus.exportedAtMs;
  const lastStartedAtMs = Number.isFinite(startedAtMs ?? Number.NaN)
    ? Math.max(exportStatus.exportedAtMs, startedAtMs ?? Number.NaN)
    : exportStatus.exportedAtMs;

  return {
    state: now < nextAllowedAtMs ? "cooldown" : "fresh",
    dirtyReasons: [],
    lastRequestedAt: toIso(lastRequestedAtMs),
    lastStartedAt: toIso(lastStartedAtMs),
    lastCompletedAt: exportStatus.exportedAt,
    lastFailedAt: null,
    nextAllowedAt: toIso(nextAllowedAtMs),
    runningTaskId: null,
    errorSummary: null
  };
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function normalizeOptionalAbsolutePath(input: string | null | undefined): string | null {
  const value = input?.trim() ?? "";
  if (!value) {
    return null;
  }
  return path.isAbsolute(value) ? value : null;
}

function normalizeAllowedExtensions(input: readonly string[]): string[] {
  const result = new Set<string>();
  for (const item of input) {
    const trimmed = String(item ?? "").trim().toLowerCase();
    if (!trimmed) {
      continue;
    }
    const normalized = trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
    result.add(normalized);
  }
  return [...result].sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

function toIso(timestamp: number | null): string | null {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString();
}
