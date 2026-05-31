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
const DEFAULT_EXPORT_MODE = "v2" as const;
const INDEX_TASK_TIMEOUT_MS = 15 * 60 * 1000;
const INDEX_TASK_COOLDOWN_MS = 15_000;
const SNAPSHOT_CACHE_FILE_NAME = "codingns-affairs-snapshot-cache.json";

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
  selectedFavoriteId?: string | null;
  offset?: number;
  limit?: number;
}

export interface AffairsLibraryDocumentListDto {
  total: number;
  offset: number;
  limit: number;
  items: AffairsLibraryDocumentRecordDto[];
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
  exportMode?: string;
}

interface IndexStatusFilePayload {
  version?: number;
  format?: string;
  exported_at?: string;
  document_count?: number;
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
  signature: string;
  generatedAt: string | null;
  documents: AffairsLibraryDocumentRecordDto[];
  tags: AffairsLibraryTagNodeDto[];
  folders: AffairsLibraryFolderNodeDto[];
}

export class AffairsLibraryService {
  private readonly exportCache = new Map<string, AffairsLibraryExportCachePayload>();

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceNavigationStateRepository: WorkspaceNavigationStateRepository,
    private readonly taskManager: TaskManager,
    private readonly logger: AffairsLibraryLogger
  ) {
    this.registerBackgroundTasks();
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
      ...current,
      allowedExtensions,
      exportMode:
        typeof current.exportMode === "string" && current.exportMode.trim()
          ? current.exportMode.trim()
          : DEFAULT_EXPORT_MODE
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

    const exportRoot = path.join(binding.rootDir, ".ai-index", "exports-v2");
    const manifestPath = path.join(exportRoot, "manifest.json");

    if (!fs.existsSync(manifestPath)) {
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

    const exportData = this.readExportData(binding.rootDir);

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
        items: []
      };
    }

    const favorites = this.readFavorites(workspaceId, userId);
    const exportData = this.readExportData(binding.rootDir);
    const browseMode = input.browseMode === "tag" ? "tag" : "folder";
    const offset = Math.max(0, normalizePositiveInt(input.offset, 0, Number.MAX_SAFE_INTEGER));
    const limit = normalizePositiveInt(input.limit, 120, 400);
    const selectedFavorite = favorites.find(
      (item) => buildFavoriteNodeId(item.kind, item.path) === (input.selectedFavoriteId?.trim() ?? "")
    ) ?? null;

    const filtered = exportData.documents.filter((document) => {
      if (browseMode === "tag") {
        const tagPath = selectedFavorite?.kind === "tag"
          ? selectedFavorite.path
          : (input.selectedTagPath?.trim() ?? "");
        return !tagPath || matchesTagPath(document, tagPath);
      }

      const folderPath = selectedFavorite?.kind === "folder"
        ? selectedFavorite.path
        : (input.selectedFolderPath?.trim() ?? "");
      return matchesDirectFolder(document.path, folderPath);
    });

    const items = filtered.slice(offset, offset + limit).map<AffairsLibraryDocumentRecordDto>((document) => ({
      ...document,
      isFavorite: favorites.some((favorite) =>
        matchesFavorite(favorite, document.path, document.tags, document.derivedTags)
      )
    }));

    return {
      total: filtered.length,
      offset,
      limit,
      items
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

    const handle = this.taskManager.enqueue<{ workspaceId: string; rootDir: string; reason: string }, AffairsIndexerCommandResult>(
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

    return {
      taskId: handle.taskId,
      deduped: handle.deduped,
      status: this.readIndexStatus(workspaceId, binding)
    };
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
    if (taskSnapshot && (taskSnapshot.status === "queued" || taskSnapshot.status === "running")) {
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

    const exportRoot = path.join(binding.rootDir, ".ai-index", "exports-v2");
    const statusPath = path.join(exportRoot, "status.json");
    if (!fs.existsSync(statusPath)) {
      return {
        state: "stale",
        dirtyReasons: ["missing_export"],
        lastRequestedAt: null,
        lastStartedAt: null,
        lastCompletedAt: null,
        lastFailedAt: null,
        nextAllowedAt: null,
        runningTaskId: null,
        errorSummary: null
      };
    }

    const statusFile = readJsonFile<IndexStatusFilePayload>(statusPath);
    const lastCompletedAt = statusFile.exported_at?.trim() ?? null;
    const lastCompletedAtMs = lastCompletedAt ? Date.parse(lastCompletedAt) : Number.NaN;
    const nextAllowedAtMs = Number.isFinite(lastCompletedAtMs)
      ? lastCompletedAtMs + INDEX_TASK_COOLDOWN_MS
      : Number.NaN;
    const now = Date.now();

    return {
      state: Number.isFinite(nextAllowedAtMs) && now < nextAllowedAtMs ? "cooldown" : "fresh",
      dirtyReasons: [],
      lastRequestedAt: lastCompletedAt,
      lastStartedAt: lastCompletedAt,
      lastCompletedAt,
      lastFailedAt: null,
      nextAllowedAt: Number.isFinite(nextAllowedAtMs) ? toIso(nextAllowedAtMs) : null,
      runningTaskId: null,
      errorSummary: null
    };
  }

  private registerBackgroundTasks(): void {
    if (!this.taskManager.has(HOST_TASK_TYPES.affairsLibraryApplyConfig)) {
      this.taskManager.register<{ workspaceId: string; rootDir: string }, AffairsIndexerCommandResult>({
        taskType: HOST_TASK_TYPES.affairsLibraryApplyConfig,
        executionLane: "helper_process",
        helperProcessHandler: "affairs.library_apply_config",
        timeoutMs: INDEX_TASK_TIMEOUT_MS,
        run: async (input) => await this.runInternalCommand(input.rootDir, "apply-config")
      });
    }

    if (!this.taskManager.has(HOST_TASK_TYPES.affairsLibraryIndex)) {
      this.taskManager.register<{ workspaceId: string; rootDir: string; reason: string }, AffairsIndexerCommandResult>({
        taskType: HOST_TASK_TYPES.affairsLibraryIndex,
        executionLane: "helper_process",
        helperProcessHandler: "affairs.library_index",
        timeoutMs: INDEX_TASK_TIMEOUT_MS,
        run: async (input) => await this.runInternalCommand(input.rootDir, "index")
      });
    }

    if (!this.taskManager.has(HOST_TASK_TYPES.affairsLibraryRecomputeTags)) {
      this.taskManager.register<{ workspaceId: string; rootDir: string }, AffairsIndexerCommandResult>({
        taskType: HOST_TASK_TYPES.affairsLibraryRecomputeTags,
        executionLane: "helper_process",
        helperProcessHandler: "affairs.library_recompute_tags",
        timeoutMs: INDEX_TASK_TIMEOUT_MS,
        run: async (input) => await this.runInternalCommand(input.rootDir, "recompute-tags")
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

  private async runInternalCommand(rootDir: string, commandName: "apply-config" | "index" | "recompute-tags" | "export"): Promise<AffairsIndexerCommandResult> {
    this.logger.info(
      {
        rootDir,
        commandName,
        executionMode: "internal_helper"
      },
      "开始执行内置事务视图文档库索引命令"
    );

    return await runAffairsIndexerCommand(rootDir, commandName);
  }

  private readExportData(rootDir: string): AffairsLibraryExportData {
    const exportRoot = path.join(rootDir, ".ai-index", "exports-v2");
    const manifestPath = path.join(exportRoot, "manifest.json");
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

    const parsed = this.parseExportData(exportRoot, manifestPath);
    const cachePayload: AffairsLibraryExportCachePayload = {
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

  private parseExportData(exportRoot: string, manifestPath: string): AffairsLibraryExportData {
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
    const folders = (bootstrap.folders ?? []).map<AffairsLibraryFolderNodeDto>((folder) => ({
      path: folder.path?.trim() ?? ".",
      name: folder.name?.trim() || "资料库",
      parentPath: folder.parent_path?.trim() || null,
      directDocumentCount: Number(folder.direct_document_count ?? 0),
      documentCount: Number(folder.document_count ?? 0)
    }));

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
    return [
      manifestStat.mtimeMs,
      manifestStat.size,
      statusStat?.mtimeMs ?? "missing",
      statusStat?.size ?? "missing"
    ].join(":");
  }

  private readExportCacheFile(exportRoot: string, signature: string): AffairsLibraryExportCachePayload | null {
    const cachePath = path.join(exportRoot, SNAPSHOT_CACHE_FILE_NAME);
    if (!fs.existsSync(cachePath)) {
      return null;
    }

    try {
      const payload = readJsonFile<AffairsLibraryExportCachePayload>(cachePath);
      if (payload.signature !== signature) {
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

function countDocumentsForTag(documents: AffairsLibraryDocumentRecordDto[], tagPath: string): number {
  if (!tagPath) {
    return 0;
  }
  return documents.filter((document) => [...document.tags, ...document.derivedTags].some((tag) => tag === tagPath || tag.startsWith(`${tagPath}/`))).length;
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
  return [...document.tags, ...document.derivedTags].some((tag) => tag === tagPath || tag.startsWith(`${tagPath}/`));
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
