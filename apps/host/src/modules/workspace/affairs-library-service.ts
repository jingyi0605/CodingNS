import fs from "node:fs";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { nowIso } from "../../shared/utils/time.js";
import type { WorkspaceNavigationStateRepository } from "../../storage/repositories/workspace-navigation-state-repository.js";
import type { UserAffairsLibrarySettingRepository } from "../../storage/repositories/user-affairs-library-setting-repository.js";
import type { FileNode } from "../../types/domain.js";
import {
  MAX_TEXT_FILE_BYTES,
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
import { hashContent } from "../../shared/utils/hash.js";
import type { TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES, type TaskSnapshot } from "../tasks/task-types.js";
import type { WorkspaceService } from "./workspace-service.js";
import {
  runAffairsIndexerCommand,
  type AffairsIndexerCommandResult
} from "../affairs-indexer/internal-command-runner.js";
import {
  isIncludedHiddenPath,
  normalizeIncludedHiddenPaths,
  SUPPORTED_INDEX_EXTENSION_LIST
} from "../affairs-indexer/core/src/scanner/file-scanner.js";
import { writeAffairsLibraryDebugLog } from "./affairs-library-debug-log.js";
import {
  AFFAIRS_LIBRARY_DEBUG_EVENTS,
  AFFAIRS_LIBRARY_INDEX_DIRTY_REASONS,
  AFFAIRS_LIBRARY_RECONCILE_REASONS,
  AFFAIRS_LIBRARY_RECONCILE_SCOPES,
  AFFAIRS_LIBRARY_RECONCILE_STATUSES,
  type AffairsLibraryReconcileResult
} from "./affairs-library-refresh-contract.js";
import {
  getSharedTaskHelperPool,
  type TaskHelperWorkerHealthSnapshot
} from "../tasks/task-helper-pool.js";

export const AFFAIRS_GLOBAL_WORKSPACE_ID = "affairs-global";
const DEFAULT_CONFIG_RELATIVE_PATH = ".ai-index/doc-semantic-index.config.json";
const INDEX_DIR_RELATIVE_PATH = ".ai-index";
const EXPORT_DIR_RELATIVE_PATH = ".ai-index/exports";
const EXPORT_STATUS_RELATIVE_PATH = ".ai-index/exports/status.json";
const EXPORT_MANIFEST_RELATIVE_PATH = ".ai-index/exports/manifest.json";
const RUNTIME_STATUS_RELATIVE_PATH = ".ai-index/runtime-status.json";
const COMMAND_LOCK_DIR_RELATIVE_PATH = ".ai-index/runtime/command.lock";
const COMMAND_LOCK_OWNER_RELATIVE_PATH = ".ai-index/runtime/command.lock/owner.json";
const COMMAND_LOCK_HEARTBEAT_RELATIVE_PATH = ".ai-index/runtime/command.lock/heartbeat.json";
const DEFAULT_EXPORT_MODE = "v2" as const;
const INDEX_TASK_TIMEOUT_MS = 15 * 60 * 1000;
const DIRECTORY_HINT_TASK_TIMEOUT_MS = 8_000;
const INDEX_TASK_QUEUE_WAIT_TIMEOUT_MS = 60_000;
const DIRECTORY_HINT_QUEUE_WAIT_TIMEOUT_MS = 15_000;
const INDEX_TASK_COOLDOWN_MS = 15_000;
const AUTO_TASK_QUIET_WINDOW_MS = 800;
const AUTO_TASK_RETRY_WINDOW_MS = 1_000;
const LIGHTWEIGHT_RECONCILE_INTERVAL_MS = 45_000;
const LIGHTWEIGHT_RECONCILE_DRIFT_TOLERANCE_MS = 1_500;
const COMMAND_LOCK_STALE_HEARTBEAT_MS = 3 * 60 * 1000;
const ORPHAN_TASK_RECONCILE_GRACE_MS = 15_000;
const SNAPSHOT_CACHE_FILE_NAME = "codingns-affairs-snapshot-cache.json";
const SNAPSHOT_CACHE_SCHEMA_VERSION = 2;
const HOT_DIRECTORY_CACHE_TTL_MS = 10 * 60 * 1000;
const HOT_DIRECTORY_MAX_PER_WORKSPACE = 3;
const LIVE_DIRECTORY_SYNC_SCAN_MAX_DOCUMENTS = 200;

export type AffairsLibraryDirectoryStateDto = "idle" | "queued" | "running" | "queue_timeout" | "fresh" | "failed";
export type AffairsLibraryDirectorySourceDto = "live" | "snapshot" | "mixed" | "stale_fallback";

export type AffairsLibraryFavoriteKind = "folder" | "tag" | "document" | "tag_filter";

export interface AffairsLibraryFavoriteRecord {
  kind: AffairsLibraryFavoriteKind;
  path: string;
  label: string;
  tagPaths?: string[];
}

export interface AffairsLibraryBindingDto {
  workspaceId: string | null;
  rootDir: string;
  enabled: boolean;
  mirrorRoot: string | null;
  allowedExtensions: string[];
  includedHiddenPaths?: string[];
  folderOpenBehavior?: "single_click" | "double_click";
  configRelativePath: string;
  exportMode: "v2";
  updatedAt: string;
}

export interface AffairsLibraryIndexStatusDto {
  state: "fresh" | "stale" | "queued" | "running" | "queue_timeout" | "cooldown" | "failed";
  dirtyReasons: string[];
  lastRequestedAt: string | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  nextAllowedAt: string | null;
  runningTaskId: string | null;
  runningStage: string | null;
  errorSummary: string | null;
  workerHealth?: AffairsLibraryWorkerHealthDto | null;
  progress?: AffairsLibraryIndexProgressDto | null;
}

export interface AffairsLibraryWorkerHealthDto {
  workerKey: string;
  rootDir: string | null;
  state: "idle" | "running" | "terminating" | "recycled";
  pid: number | null;
  inflightLocalCount: number;
  inflightRemoteRequestCount: number;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  lastSoftCancelRequestedAt: string | null;
  lastHardKillAt: string | null;
  lastExitAt: string | null;
  lastTerminationReason: string | null;
}

export interface AffairsLibraryIndexProgressDto {
  scannedCount: number;
  indexedCount: number;
  skippedCount: number;
  failedCount: number;
  unchangedCount: number;
  totalCount: number | null;
  maxConcurrency: number | null;
}

export interface AffairsLibraryDirectoryStatusDto {
  path: string;
  state: AffairsLibraryDirectoryStateDto;
  source: AffairsLibraryDirectorySourceDto;
  lastRequestedAt: string | null;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  runningTaskId: string | null;
  errorSummary: string | null;
  generatedAt?: string | null;
  filesystemObservedAt?: string | null;
  staleReason?: string | null;
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
  keyword?: string | null;
  offset?: number;
  limit?: number;
}

export interface AffairsLibraryDocumentListDto {
  total: number;
  visibleEntryTotal?: number;
  offset: number;
  limit: number;
  items: AffairsLibraryDocumentRecordDto[];
  tagFacetCounts?: Record<string, number>;
  directoryStatus?: AffairsLibraryDirectoryStatusDto | null;
}

export type AffairsLibraryOperationType = "delete" | "move" | "copy" | "create_directory" | "create_file" | "write";

export interface AffairsLibraryDownloadDto {
  workspaceId: string;
  path: string;
  fileName: string;
  contentBase64: string;
  size: number;
  updatedAt: string;
}

export interface AffairsLibraryOperationResultDto {
  success: true;
  opType: AffairsLibraryOperationType;
  sourcePath: string;
  targetPath: string | null;
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

interface UserAffairsLibrarySettingLike {
  userId: string;
  rootDir: string | null;
  enabled: boolean;
  favoritesJson: string | null;
  lastWorkspaceId: string | null;
  dashboardStateJson?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AffairsLibraryConfigPayload {
  allowedExtensions?: string[];
  mirrorRoot?: string;
  includedHiddenPaths?: string[];
  folderOpenBehavior?: "single_click" | "double_click";
}

function parseDashboardStateJson(value: string | null | undefined): Record<string, unknown> {
  const raw = value?.trim();
  if (!raw) {
    return {};
  }

  try {
    return normalizeDashboardStatePayload(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

function normalizeDashboardStatePayload(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "事务工作台配置必须是对象",
      field: "dashboardState"
    });
  }

  return {
    ...(value as Record<string, unknown>),
    workspaceId: AFFAIRS_GLOBAL_WORKSPACE_ID
  };
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

interface RuntimeStatusFilePayload {
  status?: string;
  stage?: string;
  command?: string;
  updatedAt?: string;
  taskId?: string;
  taskType?: string;
  errorSummary?: string | null;
  progress?: {
    scannedCount?: number;
    indexedCount?: number;
    skippedCount?: number;
    failedCount?: number;
    unchangedCount?: number;
    totalCount?: number | null;
    maxConcurrency?: number | null;
  } | null;
}

interface ParsedRuntimeStatusFile {
  status: string | null;
  stage: string | null;
  command: string | null;
  taskId: string | null;
  taskType: string | null;
  updatedAt: string | null;
  updatedAtMs: number;
  errorSummary: string | null;
  progress: AffairsLibraryIndexProgressDto | null;
}

interface ParsedCommandLockOwnerFile {
  pid: number | null;
  command: string | null;
  taskId: string | null;
  taskType: string | null;
  acquiredAt: string | null;
}

interface ParsedCommandLockHeartbeatFile {
  ts: string | null;
  tsMs: number;
}

interface OrphanedRunningTaskInfo {
  reason: "command_lock_missing" | "command_lock_owner_dead" | "command_lock_heartbeat_stale";
  errorSummary: string;
  ownerPid: number | null;
  heartbeatAgeMs: number | null;
  runtimeUpdatedAt: string | null;
  runtimeAgeMs: number | null;
  runningStage: string | null;
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
  indexReasons: Set<string>;
  indexTargets: Set<string>;
}

interface AffairsLibraryDirectoryHintTaskResult {
  directoryPath: string;
  refreshedAt: string;
  source: AffairsLibraryDirectorySourceDto;
  itemCount: number;
  childDirectoryCount: number;
  changedPaths: string[];
  items: AffairsLibraryDocumentRecordDto[];
  generatedAt: string | null;
  filesystemObservedAt: string | null;
}

interface AffairsLibraryHotDirectoryCacheEntry {
  workspaceId: string;
  rootDir: string;
  directoryPath: string;
  items: AffairsLibraryDocumentRecordDto[];
  childDirectoryCount: number;
  updatedAtMs: number;
  source: AffairsLibraryDirectorySourceDto;
  dirty: boolean;
  pendingHintReasons: Set<string>;
  lastHintAt: string | null;
  lastRefreshRequestedAt: string | null;
  lastRefreshCompletedAt: string | null;
  lastRefreshFailedAt: string | null;
  lastError: string | null;
  status: AffairsLibraryDirectoryStateDto;
  generatedAt: string | null;
  filesystemObservedAt: string | null;
  staleReason: string | null;
}

interface AffairsLibraryFolderDocumentsBuildResult {
  items: AffairsLibraryDocumentRecordDto[];
  childDirectoryCount: number;
  source: AffairsLibraryDirectorySourceDto;
  generatedAt: string | null;
  filesystemObservedAt: string | null;
  staleReason: string | null;
}

interface AffairsLibraryLiveDirectoryScanDecision {
  avoidSyncScan: boolean;
  staleReason: string | null;
  estimatedDocumentCount: number | null;
}

interface AffairsLibraryLightweightReconcileResult extends AffairsLibraryReconcileResult {
  recentDirectoryPath: string | null;
}

interface AffairsLibraryReconcileObservationState {
  consecutiveLightweightDrifts: number;
  lastLightweightReason: string | null;
  lastLightweightObservedAt: string | null;
}

export class AffairsLibraryService {
  private readonly exportCache = new Map<string, AffairsLibraryExportCachePayload>();
  private readonly autoTaskStateByWorkspace = new Map<string, AffairsLibraryAutoTaskState>();
  private readonly hotDirectoryCache = new Map<string, AffairsLibraryHotDirectoryCacheEntry>();
  private readonly lightweightReconcileTimers = new Map<string, NodeJS.Timeout>();
  private readonly reconcileObservationStateByWorkspace = new Map<string, AffairsLibraryReconcileObservationState>();

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceNavigationStateRepository: WorkspaceNavigationStateRepository,
    private readonly userAffairsLibrarySettingRepository: UserAffairsLibrarySettingRepository,
    private readonly taskManager: TaskManager,
    private readonly logger: AffairsLibraryLogger
  ) {
    this.registerBackgroundTasks();
    this.resumeEnabledBindings();
    this.syncLightweightReconcileTimers();
  }

  getGlobalBinding(userId: string): AffairsLibraryBindingDto | null {
    const setting = this.resolveLibrarySetting(userId, AFFAIRS_GLOBAL_WORKSPACE_ID);
    return this.buildBindingFromSetting(setting, AFFAIRS_GLOBAL_WORKSPACE_ID);
  }

  getBinding(workspaceId: string, userId: string): AffairsLibraryBindingDto | null {
    const setting = this.resolveLibrarySetting(userId, workspaceId);
    return this.buildBindingFromSetting(setting, workspaceId);
  }

  saveGlobalBinding(userId: string, rootDir: string): AffairsLibraryBindingDto {
    const normalizedRootDir = this.normalizeAndValidateBindingRootDir(rootDir);
    const timestamp = nowIso();
    const currentSetting = this.resolveLibrarySetting(userId, null);
    const workspaceId = AFFAIRS_GLOBAL_WORKSPACE_ID;
    const nextSetting = this.upsertLibrarySetting({
      userId,
      rootDir: normalizedRootDir,
      enabled: true,
      favoritesJson: currentSetting?.favoritesJson ?? "[]",
      lastWorkspaceId: workspaceId ?? currentSetting?.lastWorkspaceId ?? null,
      dashboardStateJson: currentSetting?.dashboardStateJson ?? "{}",
      createdAt: currentSetting?.createdAt ?? timestamp,
      updatedAt: timestamp
    });
    this.syncLightweightReconcileTimers();
    this.scheduleAutoRefresh(workspaceId, "binding_saved");
    return this.buildBindingFromSetting(nextSetting, AFFAIRS_GLOBAL_WORKSPACE_ID)!;
  }

  setGlobalEnabled(userId: string, enabled: boolean): AffairsLibraryBindingDto {
    const currentSetting = this.resolveLibrarySetting(userId, null);
    const rootDir = currentSetting?.rootDir?.trim() ?? "";

    if (!rootDir) {
      throw new AppError({
        statusCode: 409,
        errorCode: "AFFAIRS_LIBRARY_BINDING_REQUIRED",
        detail: "当前用户还没有绑定文档库路径"
      });
    }

    if (enabled) {
      this.assertLibraryRootDir(rootDir);
    }

    const workspaceId = AFFAIRS_GLOBAL_WORKSPACE_ID;
    const nextSetting = this.upsertLibrarySetting({
      userId,
      rootDir,
      enabled,
      favoritesJson: currentSetting?.favoritesJson ?? "[]",
      lastWorkspaceId: workspaceId ?? currentSetting?.lastWorkspaceId ?? null,
      dashboardStateJson: currentSetting?.dashboardStateJson ?? "{}",
      createdAt: currentSetting?.createdAt ?? nowIso(),
      updatedAt: nowIso()
    });
    this.syncLightweightReconcileTimers();
    if (enabled) {
      this.scheduleAutoRefresh(workspaceId, "library_enabled");
    }

    return this.buildBindingFromSetting(nextSetting, AFFAIRS_GLOBAL_WORKSPACE_ID)!;
  }

  updateGlobalFavorites(
    userId: string,
    favorites: AffairsLibraryFavoriteRecord[]
  ): AffairsLibraryFavoriteRecord[] {
    const currentSetting = this.resolveLibrarySetting(userId, null);
    const normalizedFavorites = this.normalizeFavorites(favorites);
    const workspaceId = AFFAIRS_GLOBAL_WORKSPACE_ID;
    const nextSetting = this.upsertLibrarySetting({
      userId,
      rootDir: currentSetting?.rootDir ?? null,
      enabled: currentSetting?.enabled ?? false,
      favoritesJson: JSON.stringify(normalizedFavorites),
      lastWorkspaceId: workspaceId ?? currentSetting?.lastWorkspaceId ?? null,
      dashboardStateJson: currentSetting?.dashboardStateJson ?? "{}",
      createdAt: currentSetting?.createdAt ?? nowIso(),
      updatedAt: nowIso()
    });

    return normalizedFavorites;
  }

  getGlobalDashboardState(userId: string): Record<string, unknown> {
    const currentSetting = this.resolveLibrarySetting(userId, null);
    return parseDashboardStateJson(currentSetting?.dashboardStateJson);
  }

  updateGlobalDashboardState(userId: string, dashboardState: unknown): Record<string, unknown> {
    const normalizedState = normalizeDashboardStatePayload(dashboardState);
    const currentSetting = this.resolveLibrarySetting(userId, null);
    const timestamp = nowIso();

    this.upsertLibrarySetting({
      userId,
      rootDir: currentSetting?.rootDir ?? null,
      enabled: currentSetting?.enabled ?? false,
      favoritesJson: currentSetting?.favoritesJson ?? "[]",
      lastWorkspaceId: AFFAIRS_GLOBAL_WORKSPACE_ID,
      dashboardStateJson: JSON.stringify(normalizedState),
      createdAt: currentSetting?.createdAt ?? timestamp,
      updatedAt: timestamp
    });

    return normalizedState;
  }

  saveBinding(workspaceId: string, userId: string, rootDir: string): AffairsLibraryBindingDto {
    this.assertWorkspaceIdCanUseLegacyAffairsRoute(workspaceId);
    const normalizedRootDir = this.normalizeAndValidateBindingRootDir(rootDir);

    const timestamp = nowIso();
    const currentSetting = this.resolveLibrarySetting(userId, workspaceId);
    const nextSetting = this.upsertLibrarySetting({
      userId,
      rootDir: normalizedRootDir,
      enabled: true,
      favoritesJson: currentSetting?.favoritesJson ?? "[]",
      lastWorkspaceId: workspaceId,
      dashboardStateJson: currentSetting?.dashboardStateJson ?? "{}",
      createdAt: currentSetting?.createdAt ?? timestamp,
      updatedAt: timestamp
    });
    this.syncLightweightReconcileTimers();
    this.scheduleAutoRefresh(workspaceId, "binding_saved");

    return this.buildBindingFromSetting(nextSetting, workspaceId)!;
  }

  setEnabled(workspaceId: string, userId: string, enabled: boolean): AffairsLibraryBindingDto {
    this.assertWorkspaceIdCanUseLegacyAffairsRoute(workspaceId);
    const currentSetting = this.resolveLibrarySetting(userId, workspaceId);
    const rootDir = currentSetting?.rootDir?.trim() ?? "";

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

    const nextSetting = this.upsertLibrarySetting({
      userId,
      rootDir,
      enabled,
      favoritesJson: currentSetting?.favoritesJson ?? "[]",
      lastWorkspaceId: workspaceId,
      dashboardStateJson: currentSetting?.dashboardStateJson ?? "{}",
      createdAt: currentSetting?.createdAt ?? nowIso(),
      updatedAt: nowIso()
    });
    this.syncLightweightReconcileTimers();
    if (enabled) {
      this.scheduleAutoRefresh(workspaceId, "library_enabled");
    }

    return this.buildBindingFromSetting(nextSetting, workspaceId)!;
  }

  getConfig(workspaceId: string, userId: string): {
    binding: AffairsLibraryBindingDto | null;
    mirrorRoot: string | null;
    allowedExtensions: string[];
    includedHiddenPaths?: string[];
    folderOpenBehavior: "single_click" | "double_click";
    configRelativePath: string;
    canWrite: boolean;
  } {
    const binding = this.getBinding(workspaceId, userId);
    if (!binding) {
      return {
        binding: null,
        mirrorRoot: null,
        allowedExtensions: [],
        includedHiddenPaths: [],
        folderOpenBehavior: "double_click",
        configRelativePath: DEFAULT_CONFIG_RELATIVE_PATH,
        canWrite: false
      };
    }

    const config = this.readConfig(binding.rootDir);
    return {
      binding,
      mirrorRoot: config.mirrorRoot,
      allowedExtensions: config.allowedExtensions,
      includedHiddenPaths: config.includedHiddenPaths,
      folderOpenBehavior: config.folderOpenBehavior,
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
      includedHiddenPaths?: string[];
      folderOpenBehavior?: "single_click" | "double_click";
    }
  ): Promise<{
    binding: AffairsLibraryBindingDto;
    mirrorRoot: string | null;
    allowedExtensions: string[];
    includedHiddenPaths?: string[];
    folderOpenBehavior: "single_click" | "double_click";
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
    const includedHiddenPaths = normalizeIncludedHiddenPaths(
      input.includedHiddenPaths ?? current.includedHiddenPaths ?? []
    );
    const folderOpenBehavior = normalizeFolderOpenBehavior(input.folderOpenBehavior ?? current.folderOpenBehavior);
    const nextPayload: AffairsLibraryConfigPayload = {
      allowedExtensions,
      includedHiddenPaths,
      folderOpenBehavior,
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
      includedHiddenPaths,
      folderOpenBehavior,
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
        visibleEntryTotal: 0,
        offset: 0,
        limit: normalizePositiveInt(input.limit, 120, 400),
        items: [],
        tagFacetCounts: {},
        directoryStatus: null
      };
    }

    const favorites = this.readFavorites(workspaceId, userId);
    const exportData = this.readAvailableExportData(binding.rootDir);
    const browseMode = input.browseMode === "tag" ? "tag" : "folder";
    const offset = Math.max(0, normalizePositiveInt(input.offset, 0, Number.MAX_SAFE_INTEGER));
    const limit = normalizePositiveInt(input.limit, 120, 400);
    const normalizedKeyword = normalizeDocumentSearchKeyword(input.keyword);
    const indexStatus = this.readIndexStatus(workspaceId, binding);
    const selectedFavorite = favorites.find(
      (item) => buildFavoriteNodeId(item.kind, item.path) === (input.selectedFavoriteId?.trim() ?? "")
    ) ?? null;
    const normalizedSelectedTagPaths = normalizeSelectedTagPaths(input.selectedTagPaths);

    if (browseMode === "folder") {
      return this.listLiveFolderDocuments(workspaceId, binding.rootDir, favorites, exportData, selectedFavorite, {
        selectedFolderPath: input.selectedFolderPath,
        keyword: normalizedKeyword,
        offset,
        limit,
        indexStatus
      });
    }

    if (!exportData) {
      return {
        total: 0,
        visibleEntryTotal: 0,
        offset,
        limit,
        items: [],
        tagFacetCounts: {},
        directoryStatus: null
      };
    }

      const filtered = exportData.documents.filter((document) => {
      if (!matchesDocumentKeyword(document, normalizedKeyword)) {
        return false;
      }

      if (browseMode === "tag") {
        const tagPaths = selectedFavorite?.kind === "tag_filter"
          ? normalizeSelectedTagPaths(selectedFavorite.tagPaths ?? [])
          : selectedFavorite?.kind === "tag"
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
      visibleEntryTotal: filtered.length,
      offset,
      limit,
      items,
      tagFacetCounts: browseMode === "tag"
        ? buildTagFacetCounts(exportData.documents, normalizedSelectedTagPaths, selectedFavorite?.kind === "tag" ? selectedFavorite.path : null)
        : {},
      directoryStatus: null
    };
  }

  private listLiveFolderDocuments(
    workspaceId: string,
    rootDir: string,
    favorites: AffairsLibraryFavoriteRecord[],
    exportData: AffairsLibraryExportData | null,
    selectedFavorite: AffairsLibraryFavoriteRecord | null,
    input: {
      selectedFolderPath?: string | null;
      keyword?: string;
      offset: number;
      limit: number;
      indexStatus: AffairsLibraryIndexStatusDto;
    }
  ): AffairsLibraryDocumentListDto {
    const folderPath = selectedFavorite?.kind === "folder"
      ? selectedFavorite.path
      : (input.selectedFolderPath?.trim() ?? "");
    const normalizedFolderPath = normalizeFolderPath(folderPath);
    const normalizedDirectoryPath = normalizedFolderPath || ".";
    const directoryStatus = this.readDirectoryStatus(workspaceId, rootDir, normalizedDirectoryPath, "snapshot");
    const cacheKey = buildHotDirectoryCacheKey(workspaceId, normalizedDirectoryPath);
    const cachedDirectoryEntry = this.hotDirectoryCache.get(cacheKey) ?? null;
    const liveScanDecision = this.decideLiveDirectoryScan(
      input.indexStatus,
      directoryStatus,
      cachedDirectoryEntry,
      normalizedFolderPath,
      exportData
    );
    const fallbackResult = liveScanDecision.avoidSyncScan
      ? this.buildCachedFolderDocuments(
        workspaceId,
        rootDir,
        normalizedFolderPath,
        exportData,
        directoryStatus,
        liveScanDecision.staleReason
      )
      : null;
    const liveScanStartedAtMs = liveScanDecision.avoidSyncScan ? 0 : Date.now();
    const directoryResult = fallbackResult ?? this.buildFreshFolderDocuments(rootDir, normalizedFolderPath, exportData);
    const liveScanDurationMs = liveScanDecision.avoidSyncScan
      ? null
      : Math.max(0, Date.now() - liveScanStartedAtMs);
    const itemsWithFavorites = directoryResult.items.map((item) => ({
      ...item,
      isFavorite: favorites.some((favorite) =>
        matchesFavorite(favorite, item.path, item.tags, item.derivedTags)
      )
    }));
    const items = [...itemsWithFavorites].sort((left, right) => {
        const rightTime = Date.parse(right.updatedAt);
        const leftTime = Date.parse(left.updatedAt);
        if (Number.isFinite(rightTime) && Number.isFinite(leftTime) && rightTime !== leftTime) {
          return rightTime - leftTime;
        }
        return left.path.localeCompare(right.path, "zh-Hans-CN");
      });

    const effectiveSource = liveScanDecision.avoidSyncScan && fallbackResult
      ? fallbackResult.source
      : directoryResult.source;

    if (!liveScanDecision.avoidSyncScan) {
      this.updateHotDirectoryCache(workspaceId, rootDir, normalizedDirectoryPath, items, directoryResult.childDirectoryCount, directoryResult.source, {
        preserveStatus: directoryStatus.state === "running" || directoryStatus.state === "queued"
          || directoryStatus.state === "queue_timeout",
        generatedAt: directoryResult.generatedAt,
        filesystemObservedAt: directoryResult.filesystemObservedAt,
        staleReason: null
      });
      writeAffairsLibraryDebugLog({
        event: "directory_live_scan_sync",
        processRole: "host",
        workspaceId,
        rootDir,
        source: "affairs_library.folder_list",
        targetPath: normalizedDirectoryPath,
        status: directoryResult.source,
        durationMs: liveScanDurationMs,
        details: {
          estimatedDocumentCount: liveScanDecision.estimatedDocumentCount,
          itemCount: items.length,
          generatedAt: directoryResult.generatedAt,
          filesystemObservedAt: directoryResult.filesystemObservedAt
        }
      });
    } else {
      const fallbackEntry = this.getOrCreateHotDirectoryEntry(workspaceId, rootDir, normalizedDirectoryPath);
      fallbackEntry.items = directoryResult.items;
      fallbackEntry.childDirectoryCount = directoryResult.childDirectoryCount;
      fallbackEntry.source = directoryResult.source;
      fallbackEntry.generatedAt = directoryResult.generatedAt;
      fallbackEntry.filesystemObservedAt = directoryResult.filesystemObservedAt;
      fallbackEntry.staleReason = directoryResult.staleReason;
      this.writeDirectoryFallbackDebugLog(workspaceId, rootDir, normalizedDirectoryPath, liveScanDecision, directoryResult);
      this.ensureDirectoryWindow(workspaceId, rootDir, normalizedDirectoryPath);
    }
    this.ensureDirectoryWindow(workspaceId, rootDir, normalizedDirectoryPath);
    if (
      !liveScanDecision.avoidSyncScan
      && directoryStatus.state !== "running"
      && directoryStatus.state !== "queued"
    ) {
      this.scheduleDirectoryHintRefresh(workspaceId, normalizedDirectoryPath, "list_documents");
    } else if (
      liveScanDecision.avoidSyncScan
      && liveScanDecision.staleReason?.startsWith("large_directory:")
      && directoryStatus.state !== "running"
      && directoryStatus.state !== "queued"
    ) {
      this.scheduleDirectoryHintRefresh(workspaceId, normalizedDirectoryPath, "large_directory_live_scan");
    }

    const keyword = input.keyword?.trim() ?? "";
    const filteredItems = keyword
      ? items.filter((item) => matchesDocumentKeyword(item, keyword))
      : items;
    const resultItems = filteredItems.slice(input.offset, input.offset + input.limit);
    const visibleEntryTotal = directoryResult.childDirectoryCount + filteredItems.length;
    writeAffairsLibraryDebugLog({
      event: "folder_list_served",
      processRole: "host",
      workspaceId,
      rootDir,
      source: "affairs_library.folder_list",
      targetPath: normalizedDirectoryPath,
      status: "served",
      details: {
        resultSource: effectiveSource,
        usedCachedResult: liveScanDecision.avoidSyncScan,
        indexState: input.indexStatus.state,
        directoryState: directoryStatus.state,
        staleReason: directoryResult.staleReason,
        generatedAt: directoryResult.generatedAt,
        filesystemObservedAt: directoryResult.filesystemObservedAt,
        estimatedDocumentCount: liveScanDecision.estimatedDocumentCount,
        total: filteredItems.length,
        visibleEntryTotal,
        childDirectoryCount: directoryResult.childDirectoryCount,
        returned: resultItems.length,
        offset: input.offset,
        limit: input.limit,
        cachedItemCount: cachedDirectoryEntry?.items.length ?? 0
      }
    });

    return {
      total: filteredItems.length,
      visibleEntryTotal,
      offset: input.offset,
      limit: input.limit,
      items: resultItems,
      tagFacetCounts: {},
      directoryStatus: this.readDirectoryStatus(workspaceId, rootDir, normalizedDirectoryPath, effectiveSource)
    };
  }

  listFiles(
    workspaceId: string,
    userId: string,
    requestedPath: string | null | undefined,
    limit = 200
  ): FileNode[] {
    const resolved = this.resolvePreviewFile(workspaceId, userId, requestedPath ?? "", {
      mustExist: true,
      kind: "directory",
      allowRoot: true
    });

    const items = fs
      .readdirSync(resolved.absolutePath, { withFileTypes: true })
      .filter((entry) => !entry.isSymbolicLink())
      .reduce<FileNode[]>((result, entry) => {
        const childRelativePath = resolved.relativePath
          ? `${resolved.relativePath}/${entry.name}`
          : entry.name;
        const normalizedChildPath = childRelativePath.replace(/\\/g, "/");
        if (normalizedChildPath === ".ai-index" || normalizedChildPath.startsWith(".ai-index/")) {
          return result;
        }

        const childAbsolutePath = path.join(resolved.absolutePath, entry.name);
        const childStats = fs.statSync(childAbsolutePath);

        result.push({
          path: normalizedChildPath,
          name: entry.name,
          kind: entry.isDirectory() ? "directory" : "file",
          size: entry.isDirectory() ? null : childStats.size,
          updatedAt: childStats.mtime.toISOString()
        });
        return result;
      }, []);

    return items.slice(0, limit).sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "directory" ? -1 : 1;
        }

        return left.name.localeCompare(right.name, "zh-Hans-CN");
      });
  }

  private decideLiveDirectoryScan(
    indexStatus: AffairsLibraryIndexStatusDto,
    directoryStatus: AffairsLibraryDirectoryStatusDto | null,
    cachedDirectoryEntry: AffairsLibraryHotDirectoryCacheEntry | null,
    normalizedFolderPath: string,
    exportData: AffairsLibraryExportData | null
  ): AffairsLibraryLiveDirectoryScanDecision {
    const estimatedDocumentCount = estimateFolderDocumentCount(
      normalizedFolderPath,
      exportData,
      cachedDirectoryEntry
    );

    if (
      typeof estimatedDocumentCount === "number"
      && estimatedDocumentCount > LIVE_DIRECTORY_SYNC_SCAN_MAX_DOCUMENTS
    ) {
      return {
        avoidSyncScan: true,
        staleReason: `large_directory:${estimatedDocumentCount}`,
        estimatedDocumentCount
      };
    }

    if (!cachedDirectoryEntry || cachedDirectoryEntry.items.length === 0) {
      return {
        avoidSyncScan: false,
        staleReason: null,
        estimatedDocumentCount
      };
    }

    if (cachedDirectoryEntry.dirty) {
      return {
        avoidSyncScan: false,
        staleReason: null,
        estimatedDocumentCount
      };
    }

    if (indexStatus.state === "running") {
      return {
        avoidSyncScan: true,
        staleReason: "index_running",
        estimatedDocumentCount
      };
    }

    if (!directoryStatus) {
      return {
        avoidSyncScan: false,
        staleReason: null,
        estimatedDocumentCount
      };
    }

    return {
      avoidSyncScan: directoryStatus.state === "running",
      staleReason: directoryStatus.state === "running" ? "directory_hint_running" : null,
      estimatedDocumentCount
    };
  }

  private buildCachedFolderDocuments(
    workspaceId: string,
    rootDir: string,
    normalizedFolderPath: string,
    exportData: AffairsLibraryExportData | null,
    directoryStatus: AffairsLibraryDirectoryStatusDto | null,
    staleReason: string | null
  ): AffairsLibraryFolderDocumentsBuildResult {
    const cacheKey = buildHotDirectoryCacheKey(workspaceId, normalizedFolderPath || ".");
    const cached = this.hotDirectoryCache.get(cacheKey);
    if (cached && cached.items.length > 0) {
      return {
        items: cached.items,
        childDirectoryCount: cached.childDirectoryCount,
        source: staleReason ? "stale_fallback" : cached.source,
        generatedAt: cached.generatedAt,
        filesystemObservedAt: cached.filesystemObservedAt,
        staleReason
      };
    }

    const snapshotResult = this.buildSnapshotFolderDocuments(rootDir, normalizedFolderPath, exportData, directoryStatus);
    return staleReason
      ? {
          ...snapshotResult,
          source: "stale_fallback",
          staleReason
        }
      : snapshotResult;
  }

  private buildSnapshotFolderDocuments(
    rootDir: string,
    normalizedFolderPath: string,
    exportData: AffairsLibraryExportData | null,
    directoryStatus: AffairsLibraryDirectoryStatusDto | null
  ): AffairsLibraryFolderDocumentsBuildResult {
    const items = (exportData?.documents ?? [])
      .filter((document) => matchesDirectFolder(document.path, normalizedFolderPath))
      .map<AffairsLibraryDocumentRecordDto>((document) => ({
        ...document,
        isFavorite: false
      }));

    return {
      items,
      childDirectoryCount: countDirectChildFoldersFromSnapshot(normalizedFolderPath, exportData),
      source: directoryStatus?.source ?? "snapshot",
      generatedAt: exportData?.generatedAt ?? directoryStatus?.generatedAt ?? null,
      filesystemObservedAt: directoryStatus?.filesystemObservedAt ?? null,
      staleReason: directoryStatus?.staleReason ?? null
    };
  }

  private buildFreshFolderDocuments(
    rootDir: string,
    normalizedFolderPath: string,
    exportData: AffairsLibraryExportData | null
  ): AffairsLibraryFolderDocumentsBuildResult {
    return buildAffairsFolderDocumentsFromFilesystem(
      rootDir,
      normalizedFolderPath,
      exportData,
      this.readConfig(rootDir)
    );
  }

  private buildLiveDirectoryDocuments(
    rootDir: string,
    normalizedFolderPath: string,
    exportData: AffairsLibraryExportData | null,
    configuredExtensions: ReadonlySet<string>,
    supportedExtensions: ReadonlySet<string>,
    includedHiddenPaths: readonly string[]
  ): AffairsLibraryFolderDocumentsBuildResult {
    return buildAffairsFolderDocumentsFromFilesystem(
      rootDir,
      normalizedFolderPath,
      exportData,
      {
        mirrorRoot: null,
        allowedExtensions: [...configuredExtensions],
        includedHiddenPaths: [...includedHiddenPaths]
      },
      supportedExtensions
    );
  }

  private writeDirectoryFallbackDebugLog(
    workspaceId: string,
    rootDir: string,
    directoryPath: string,
    decision: AffairsLibraryLiveDirectoryScanDecision,
    result: AffairsLibraryFolderDocumentsBuildResult
  ): void {
    writeAffairsLibraryDebugLog({
      event: "directory_live_scan_deferred",
      processRole: "host",
      workspaceId,
      rootDir,
      source: "affairs_library.folder_list",
      targetPath: directoryPath,
      status: result.source,
      reason: decision.staleReason,
      details: {
        estimatedDocumentCount: decision.estimatedDocumentCount,
        generatedAt: result.generatedAt,
        filesystemObservedAt: result.filesystemObservedAt,
        itemCount: result.items.length
      }
    });
  }

  updateFavorites(
    workspaceId: string,
    userId: string,
    favorites: AffairsLibraryFavoriteRecord[]
  ): AffairsLibraryFavoriteRecord[] {
    this.assertWorkspaceIdCanUseLegacyAffairsRoute(workspaceId);
    const currentSetting = this.resolveLibrarySetting(userId, workspaceId);
    const normalizedFavorites = this.normalizeFavorites(favorites);

    const nextSetting = this.upsertLibrarySetting({
      userId,
      rootDir: currentSetting?.rootDir ?? null,
      enabled: currentSetting?.enabled ?? false,
      favoritesJson: JSON.stringify(normalizedFavorites),
      lastWorkspaceId: workspaceId,
      dashboardStateJson: currentSetting?.dashboardStateJson ?? "{}",
      createdAt: currentSetting?.createdAt ?? nowIso(),
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

    if (
      isResourcePreviewKind(previewKind)
      && previewKind !== "office"
      && fileSize > MAX_RESOURCE_PREVIEW_FILE_BYTES
    ) {
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

    if (previewKind === "image" || previewKind === "pdf" || previewKind === "office") {
      return this.buildPreviewResult({
        workspaceId,
        path: resolved.relativePath,
        supported: true,
        kind: previewKind,
        reason: null,
        content: null,
        version: previewKind === "office"
          ? buildOfficeDocumentVersion(fileSize, resolved.stats?.mtime.toISOString() ?? null)
          : null,
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
      version: shouldEnableAffairsLibraryInlineEditing(previewKind, fileSize || buffer.byteLength)
        ? hashContent(buffer)
        : null,
      size: fileSize || buffer.byteLength,
      updatedAt: resolved.stats?.mtime.toISOString() ?? null
    });
  }

  downloadFile(workspaceId: string, userId: string, requestedPath: string): AffairsLibraryDownloadDto {
    const resolved = this.resolvePreviewFile(workspaceId, userId, requestedPath, {
      mustExist: true,
      kind: "file"
    });
    this.ensureUserContentPath(resolved.relativePath);

    const buffer = fs.readFileSync(resolved.absolutePath);
    const stats = resolved.stats ?? fs.statSync(resolved.absolutePath);

    return {
      workspaceId,
      path: resolved.relativePath,
      fileName: path.basename(resolved.relativePath) || resolved.relativePath,
      contentBase64: buffer.toString("base64"),
      size: buffer.byteLength,
      updatedAt: stats.mtime.toISOString()
    };
  }

  operateFile(
    workspaceId: string,
    userId: string,
    input: {
      opType: AffairsLibraryOperationType;
      srcPath?: string;
      dstPath?: string | null;
      content?: string | null;
      expectedVersion?: string | null;
    }
  ): AffairsLibraryOperationResultDto {
    const opType = input.opType;
    if (
      opType !== "delete"
      && opType !== "move"
      && opType !== "copy"
      && opType !== "create_directory"
      && opType !== "create_file"
      && opType !== "write"
    ) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_FILE_OPERATION",
        detail: "不支持的文档库文件操作",
        field: "opType"
      });
    }

    if (opType === "create_directory" || opType === "create_file") {
      const target = this.resolvePreviewFile(workspaceId, userId, input.dstPath ?? "", {
        mustExist: false,
        kind: opType === "create_directory" ? "directory" : "file"
      });
      this.ensureUserContentPath(target.relativePath);

      if (target.exists) {
        throw new AppError({
          statusCode: 409,
          errorCode: "FILE_ALREADY_EXISTS",
          detail: "目标路径已存在",
          field: "dstPath"
        });
      }

      fs.mkdirSync(path.dirname(target.absolutePath), { recursive: true });
      if (opType === "create_directory") {
        fs.mkdirSync(target.absolutePath);
      } else {
        fs.writeFileSync(target.absolutePath, input.content ?? "", "utf8");
      }
      this.afterFileMutation(
        workspaceId,
        target.rootDir,
        `library_${opType}:${target.relativePath}`,
        target.relativePath
      );
      return {
        success: true,
        opType,
        sourcePath: target.relativePath,
        targetPath: target.relativePath
      };
    }

    const source = this.resolvePreviewFile(workspaceId, userId, input.srcPath ?? "", {
      mustExist: true,
      kind: "any"
    });
    this.ensureUserContentPath(source.relativePath);

    if (opType === "write") {
      if (!source.stats?.isFile()) {
        throw new AppError({
          statusCode: 400,
          errorCode: "NOT_A_FILE",
          detail: "指定路径不是文件",
          field: "srcPath"
        });
      }

      const currentBuffer = fs.readFileSync(source.absolutePath);
      ensureEditableAffairsLibraryTextBuffer(currentBuffer);
      const currentVersion = hashContent(currentBuffer);
      const expectedVersion = input.expectedVersion?.trim() ?? "";

      if (!expectedVersion) {
        throw new AppError({
          statusCode: 400,
          errorCode: "INVALID_CONTENT",
          detail: "保存文件必须提供 expectedVersion",
          field: "expectedVersion"
        });
      }

      if (expectedVersion !== currentVersion) {
        throw new AppError({
          statusCode: 409,
          errorCode: "FILE_VERSION_CONFLICT",
          detail: "文件已被其他修改覆盖，请先刷新再保存",
          field: "expectedVersion"
        });
      }

      const nextBuffer = Buffer.from(input.content ?? "", "utf8");
      ensureWritableAffairsLibraryTextBuffer(nextBuffer);
      fs.writeFileSync(source.absolutePath, nextBuffer);
      this.afterFileMutation(workspaceId, source.rootDir, `library_write:${source.relativePath}`, source.relativePath);
      return {
        success: true,
        opType,
        sourcePath: source.relativePath,
        targetPath: source.relativePath
      };
    }

    if (opType === "delete") {
      const refreshTargetPath = source.stats?.isDirectory()
        ? source.relativePath
        : getParentFolderPath(source.relativePath);
      const deletedPath = source.relativePath;
      if (source.stats?.isDirectory()) {
        fs.rmSync(source.absolutePath, { recursive: true, force: false });
      } else {
        fs.rmSync(source.absolutePath, { force: false });
      }
      this.removePathFromHotDirectoryCache(workspaceId, source.rootDir, deletedPath);
      this.afterFileMutation(
        workspaceId,
        source.rootDir,
        `library_delete:${source.relativePath}`,
        source.relativePath,
        { refreshTargetPath }
      );
      return {
        success: true,
        opType,
        sourcePath: source.relativePath,
        targetPath: null
      };
    }

    const target = this.resolvePreviewFile(workspaceId, userId, input.dstPath ?? "", {
      mustExist: false,
      kind: "any"
    });
    this.ensureUserContentPath(target.relativePath);

    if (target.exists) {
      throw new AppError({
        statusCode: 409,
        errorCode: "FILE_ALREADY_EXISTS",
        detail: "目标路径已存在",
        field: "dstPath"
      });
    }

    if (source.relativePath === target.relativePath) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_FILE_OPERATION",
        detail: "源路径和目标路径不能相同",
        field: "dstPath"
      });
    }

    if (source.stats?.isDirectory() && isSameOrDescendantRelativePath(source.relativePath, target.relativePath)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_FILE_OPERATION",
        detail: opType === "move" ? "目录不能移动到自己内部" : "目录不能复制到自己内部",
        field: "dstPath"
      });
    }

    if (opType === "move") {
      fs.renameSync(source.absolutePath, target.absolutePath);
    } else {
      fs.cpSync(source.absolutePath, target.absolutePath, {
        recursive: source.stats?.isDirectory() ?? false,
        errorOnExist: true,
        force: false
      });
    }

    this.afterFileMutation(
      workspaceId,
      source.rootDir,
      `library_${opType}:${source.relativePath}->${target.relativePath}`,
      target.relativePath
    );

    return {
      success: true,
      opType,
      sourcePath: source.relativePath,
      targetPath: target.relativePath
    };
  }

  resolvePreviewFile(
    workspaceId: string,
    userId: string,
    requestedPath: string,
    options: {
      mustExist?: boolean;
      kind?: "file" | "directory" | "any";
      allowRoot?: boolean;
    } = {}
  ): AffairsLibraryResolvedPreviewFile {
    const binding = this.requireBinding(workspaceId, userId);
    this.ensureLibraryEnabled(binding);
    this.assertLibraryRootDir(binding.rootDir);

    const rootRealPath = fs.realpathSync.native(binding.rootDir);
    const relativePath = normalizeRelativePath(requestedPath, options.allowRoot ?? false);
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

  private ensureUserContentPath(relativePath: string): void {
    const normalized = relativePath.trim().replace(/^\.\/+/, "");
    if (!normalized || normalized === ".ai-index" || normalized.startsWith(".ai-index/")) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_FILE_OPERATION",
        detail: "文档库内部索引文件不能在这里操作",
        field: "path"
      });
    }
  }

  private afterFileMutation(
    workspaceId: string,
    rootDir: string,
    reason: string,
    targetPath: string,
    options: {
      refreshTargetPath?: string | null;
    } = {}
  ): void {
    this.invalidateExportCache(rootDir);
    this.scheduleAutoRefresh(
      workspaceId,
      reason,
      normalizeMutationRefreshTarget(options.refreshTargetPath ?? targetPath) ?? undefined
    );
  }

  requestRefresh(
    workspaceId: string,
    userId: string,
    reason: string
  ): { taskId: string; deduped: boolean; status: AffairsLibraryIndexStatusDto } {
    const binding = this.requireBinding(workspaceId, userId);
    this.ensureLibraryEnabled(binding);
    const normalizedReason = reason.trim() || "manual_refresh";

    this.reconcileOrphanedRunningTasks(workspaceId, binding.rootDir, {
      source: "affairs_library.refresh",
      triggerReason: normalizedReason
    });

    const handle = this.taskManager.enqueue<{ workspaceId: string; rootDir: string; reason: string; targetPath?: string }, AffairsIndexerCommandResult>(
      HOST_TASK_TYPES.affairsLibraryIndex,
      {
        key: workspaceId,
        source: "affairs_library.refresh",
        input: {
          workspaceId,
          rootDir: binding.rootDir,
          reason: normalizedReason
        }
      }
    );
    writeAffairsLibraryDebugLog({
      event: "manual_refresh_enqueued",
      processRole: "host",
      workspaceId,
      rootDir: binding.rootDir,
      taskType: handle.taskType,
      taskId: handle.taskId,
      source: "affairs_library.refresh",
      reason: normalizedReason,
      deduped: handle.deduped,
      status: "queued"
    });
    void handle.promise.then((result) => {
      this.invalidateExportCache(binding.rootDir);
      writeAffairsLibraryDebugLog({
        event: "manual_refresh_finished",
        processRole: "host",
        workspaceId,
        rootDir: binding.rootDir,
        taskType: handle.taskType,
        taskId: handle.taskId,
        source: "affairs_library.refresh",
        reason: normalizedReason,
        status: "finished",
        durationMs: result.durationMs,
        resultSummary: summarizeIndexerCommandResult(result.result)
      });
    }).catch((error) => {
      writeAffairsLibraryDebugLog({
        event: "manual_refresh_failed",
        processRole: "host",
        workspaceId,
        rootDir: binding.rootDir,
        taskType: handle.taskType,
        taskId: handle.taskId,
        source: "affairs_library.refresh",
        reason: normalizedReason,
        status: "failed",
        message: error instanceof Error ? error.message : String(error)
      });
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
  ): { scheduled: boolean; status: AffairsLibraryIndexStatusDto; directoryStatus: AffairsLibraryDirectoryStatusDto | null } {
    const binding = this.requireBinding(workspaceId, userId);
    this.ensureLibraryEnabled(binding);
    const normalizedTargetPath = normalizeHintTargetPath(targetPath);
    const directoryPath = normalizeFolderPath(normalizedTargetPath) || ".";

    this.scheduleDirectoryHintRefresh(
      workspaceId,
      directoryPath,
      reason.trim() || "directory_hint"
    );
    writeAffairsLibraryDebugLog({
      event: "directory_hint_received",
      processRole: "host",
      workspaceId,
      rootDir: binding.rootDir,
      source: "affairs_library.directory_hint",
      reason: reason.trim() || "directory_hint",
      targetPath: directoryPath,
      status: "scheduled"
    });

    return {
      scheduled: true,
      status: this.readIndexStatus(workspaceId, binding),
      directoryStatus: this.readDirectoryStatus(workspaceId, binding.rootDir, directoryPath, "mixed")
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

    const binding = this.findEnabledBindingByWorkspaceId(normalizedWorkspaceId);
    const rootDir = binding?.rootDir?.trim() ?? "";
    if (!rootDir || binding?.enabled !== true) {
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

    if (relativePath === ".ai-index" || relativePath.startsWith(".ai-index/")) {
      return;
    }

    const targetPath = normalizeMutationRefreshTarget(
      input.kind === "delete"
        ? getParentFolderPath(relativePath)
        : relativePath
    );
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
    const normalizedTargetPath = targetPath?.trim().replace(/^\.\//, "") ?? undefined;

    const state = this.getOrCreateAutoTaskState(normalizedWorkspaceId);
    state.indexReasons.add(reason.trim() || "auto_refresh");
    if (normalizedTargetPath) {
      state.indexTargets.add(normalizedTargetPath);
      this.markHotDirectoryCacheDirty(
        normalizedWorkspaceId,
        deriveDirectoryPathFromDocumentTarget(normalizedTargetPath),
        reason.trim() || "auto_refresh"
      );
    }
    writeAffairsLibraryDebugLog({
      event: "auto_refresh_marked_dirty",
      processRole: "host",
      workspaceId: normalizedWorkspaceId,
      source: "affairs_library.auto_refresh",
      reason: reason.trim() || "auto_refresh",
      targetPath: normalizedTargetPath ?? null,
      details: {
        pendingReasonCount: state.indexReasons.size,
        pendingTargetCount: state.indexTargets.size
      }
    });
    if (normalizedTargetPath) {
      this.scheduleDirectoryHintRefresh(
        normalizedWorkspaceId,
        deriveDirectoryPathFromDocumentTarget(normalizedTargetPath),
        `watch_hint:${normalizedTargetPath}`
      );
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
    writeAffairsLibraryDebugLog({
      event: "auto_apply_config_marked_dirty",
      processRole: "host",
      workspaceId: normalizedWorkspaceId,
      source: "affairs_library.auto_apply_config",
      reason: reason.trim() || `watch:${DEFAULT_CONFIG_RELATIVE_PATH}`,
      details: {
        pendingReasonCount: state.applyConfigReasons.size
      }
    });
    this.armAutoTaskTimer(normalizedWorkspaceId, AUTO_TASK_QUIET_WINDOW_MS);
  }

  private syncLightweightReconcileTimers(): void {
    const enabledSettings = this.listEnabledSettingsWithWorkspace();
    const activeWorkspaceIds = new Set<string>();

    for (const setting of enabledSettings) {
      const rootDir = setting.rootDir?.trim() ?? "";
      const workspaceId = setting.lastWorkspaceId?.trim() ?? "";
      if (!workspaceId || !rootDir || setting.enabled !== true) {
        continue;
      }

      activeWorkspaceIds.add(workspaceId);
      this.ensureLightweightReconcileTimer(workspaceId);
    }

    for (const workspaceId of [...this.lightweightReconcileTimers.keys()]) {
      if (!activeWorkspaceIds.has(workspaceId)) {
        this.clearLightweightReconcileTimer(workspaceId);
      }
    }
  }

  private ensureLightweightReconcileTimer(workspaceId: string): void {
    if (this.lightweightReconcileTimers.has(workspaceId)) {
      return;
    }

    const timer = setInterval(() => {
      this.scheduleLightweightReconcile(workspaceId, AFFAIRS_LIBRARY_RECONCILE_REASONS.timer);
    }, LIGHTWEIGHT_RECONCILE_INTERVAL_MS);
    this.lightweightReconcileTimers.set(workspaceId, timer);
  }

  private clearLightweightReconcileTimer(workspaceId: string): void {
    const timer = this.lightweightReconcileTimers.get(workspaceId);
    if (!timer) {
      return;
    }

    clearInterval(timer);
    this.lightweightReconcileTimers.delete(workspaceId);
  }

  private scheduleLightweightReconcile(workspaceId: string, triggerReason: string): void {
    const binding = this.findEnabledBindingByWorkspaceId(workspaceId);
    const rootDir = binding?.rootDir?.trim() ?? "";
    if (!rootDir || binding?.enabled !== true) {
      this.clearLightweightReconcileTimer(workspaceId);
      return;
    }

    const activeTask = this.findBlockingAutoTask(workspaceId);
    if (activeTask) {
      writeAffairsLibraryDebugLog({
        event: AFFAIRS_LIBRARY_DEBUG_EVENTS.lightweightReconcileSkipped,
        processRole: "host",
        workspaceId,
        rootDir,
        taskType: activeTask.taskType,
        taskId: activeTask.taskId,
        source: "affairs_library.lightweight_reconcile",
        reason: triggerReason,
        status: activeTask.status,
        details: {
          skipReason: "blocking_task_active",
          triggerReason
        }
      });
      return;
    }

    const result = this.evaluateLightweightReconcile(workspaceId, rootDir);
    this.recordLightweightReconcileObservation(workspaceId, result);
    writeAffairsLibraryDebugLog({
      event: AFFAIRS_LIBRARY_DEBUG_EVENTS.lightweightReconcileTick,
      processRole: "host",
      workspaceId,
      rootDir,
      source: "affairs_library.lightweight_reconcile",
      reason: result.reason,
      status: result.status,
      details: {
        triggerReason,
        scope: result.scope,
        targetPaths: result.targetPaths
      }
    });

    if (result.status === AFFAIRS_LIBRARY_RECONCILE_STATUSES.healthy) {
      return;
    }

    if (result.recentDirectoryPath) {
      this.scheduleDirectoryHintRefresh(
        workspaceId,
        result.recentDirectoryPath,
        `${AFFAIRS_LIBRARY_RECONCILE_REASONS.recentDirectoryMtime}:${result.recentDirectoryPath}`
      );
    }

    writeAffairsLibraryDebugLog({
      event: AFFAIRS_LIBRARY_DEBUG_EVENTS.lightweightReconcileDriftDetected,
      processRole: "host",
      workspaceId,
      rootDir,
      source: "affairs_library.lightweight_reconcile",
      reason: result.reason,
      status: result.status,
      details: {
        scope: result.scope,
        targetPaths: result.targetPaths,
        observedAt: result.observedAt
      }
    });

    this.scheduleAutoRefresh(workspaceId, result.reason);

    writeAffairsLibraryDebugLog({
      event: AFFAIRS_LIBRARY_DEBUG_EVENTS.lightweightReconcileScheduledRefresh,
      processRole: "host",
      workspaceId,
      rootDir,
      source: "affairs_library.lightweight_reconcile",
      reason: result.reason,
      status: "queued",
      details: {
        scope: result.scope,
        targetPaths: result.targetPaths,
        observedAt: result.observedAt
      }
    });
  }

  schedulePeriodicAudit(workspaceId: string, triggerReason: string): void {
    const binding = this.findEnabledBindingByWorkspaceId(workspaceId);
    const rootDir = binding?.rootDir?.trim() ?? "";
    if (!rootDir || binding?.enabled !== true) {
      return;
    }

    const activeTask = this.findBlockingAutoTask(workspaceId);
    if (activeTask) {
      writeAffairsLibraryDebugLog({
        event: AFFAIRS_LIBRARY_DEBUG_EVENTS.periodicAuditSkipped,
        processRole: "host",
        workspaceId,
        rootDir,
        taskType: activeTask.taskType,
        taskId: activeTask.taskId,
        source: "affairs_library.periodic_audit",
        reason: triggerReason,
        status: activeTask.status,
        details: {
          skipReason: "blocking_task_active",
          triggerReason
        }
      });
      return;
    }

    const result = this.evaluatePeriodicAudit(workspaceId, rootDir);
    writeAffairsLibraryDebugLog({
      event: AFFAIRS_LIBRARY_DEBUG_EVENTS.periodicAuditTick,
      processRole: "host",
      workspaceId,
      rootDir,
      source: "affairs_library.periodic_audit",
      reason: result.reason,
      status: result.status,
      details: {
        triggerReason,
        scope: result.scope,
        targetPaths: result.targetPaths
      }
    });

    if (result.status === AFFAIRS_LIBRARY_RECONCILE_STATUSES.healthy) {
      return;
    }

    writeAffairsLibraryDebugLog({
      event: AFFAIRS_LIBRARY_DEBUG_EVENTS.periodicAuditDriftDetected,
      processRole: "host",
      workspaceId,
      rootDir,
      source: "affairs_library.periodic_audit",
      reason: result.reason,
      status: result.status,
      details: {
        scope: result.scope,
        targetPaths: result.targetPaths,
        observedAt: result.observedAt
      }
    });

    this.scheduleAutoRefresh(workspaceId, result.reason);

    writeAffairsLibraryDebugLog({
      event: AFFAIRS_LIBRARY_DEBUG_EVENTS.periodicAuditScheduledRefresh,
      processRole: "host",
      workspaceId,
      rootDir,
      source: "affairs_library.periodic_audit",
      reason: result.reason,
      status: "queued",
      details: {
        scope: result.scope,
        targetPaths: result.targetPaths,
        observedAt: result.observedAt
      }
    });
  }

  private evaluateLightweightReconcile(
    workspaceId: string,
    rootDir: string
  ): AffairsLibraryLightweightReconcileResult {
    const observedAt = nowIso();
    const missingArtifact = detectMissingIndexArtifact(rootDir);
    if (missingArtifact) {
      return {
        scope: AFFAIRS_LIBRARY_RECONCILE_SCOPES.lightweight,
        status: AFFAIRS_LIBRARY_RECONCILE_STATUSES.rebuildRequired,
        reason: `lightweight_reconcile:${missingArtifact.reason}`,
        targetPaths: [],
        observedAt,
        recentDirectoryPath: null
      };
    }

    const pendingAutoTaskState = this.autoTaskStateByWorkspace.get(workspaceId);
    if (pendingAutoTaskState && hasPendingAutoTasks(pendingAutoTaskState) && !pendingAutoTaskState.timer) {
      return {
        scope: AFFAIRS_LIBRARY_RECONCILE_SCOPES.lightweight,
        status: AFFAIRS_LIBRARY_RECONCILE_STATUSES.driftDetected,
        reason: AFFAIRS_LIBRARY_RECONCILE_REASONS.pendingDirtySignal,
        targetPaths: [],
        observedAt,
        recentDirectoryPath: null
      };
    }

    const exportStatus = readIndexStatusFileSafe(rootDir);
    const runtimeStatus = readRuntimeStatusFileSafe(rootDir);
    if (
      runtimeStatus?.updatedAtMs
      && Number.isFinite(runtimeStatus.updatedAtMs)
      && runtimeStatus.updatedAtMs > (exportStatus?.exportedAtMs ?? 0) + LIGHTWEIGHT_RECONCILE_DRIFT_TOLERANCE_MS
    ) {
      return {
        scope: AFFAIRS_LIBRARY_RECONCILE_SCOPES.lightweight,
        status: AFFAIRS_LIBRARY_RECONCILE_STATUSES.driftDetected,
        reason: AFFAIRS_LIBRARY_RECONCILE_REASONS.runtimeStatusAhead,
        targetPaths: [],
        observedAt,
        recentDirectoryPath: null
      };
    }

    const recentDirectoryDrift = this.findRecentDirectoryDrift(
      workspaceId,
      rootDir,
      exportStatus?.exportedAtMs ?? 0
    );
    if (recentDirectoryDrift) {
      return {
        scope: AFFAIRS_LIBRARY_RECONCILE_SCOPES.lightweight,
        status: AFFAIRS_LIBRARY_RECONCILE_STATUSES.driftDetected,
        reason: `${AFFAIRS_LIBRARY_RECONCILE_REASONS.recentDirectoryMtime}:${recentDirectoryDrift.directoryPath}`,
        targetPaths: [recentDirectoryDrift.directoryPath],
        observedAt,
        recentDirectoryPath: recentDirectoryDrift.directoryPath
      };
    }

    return {
      scope: AFFAIRS_LIBRARY_RECONCILE_SCOPES.lightweight,
      status: AFFAIRS_LIBRARY_RECONCILE_STATUSES.healthy,
      reason: AFFAIRS_LIBRARY_RECONCILE_REASONS.timer,
      targetPaths: [],
      observedAt,
      recentDirectoryPath: null
    };
  }

  private evaluatePeriodicAudit(
    workspaceId: string,
    rootDir: string
  ): AffairsLibraryReconcileResult {
    const observedAt = nowIso();
    const missingArtifact = detectMissingIndexArtifact(rootDir);
    if (missingArtifact) {
      return {
        scope: AFFAIRS_LIBRARY_RECONCILE_SCOPES.periodicAudit,
        status: AFFAIRS_LIBRARY_RECONCILE_STATUSES.rebuildRequired,
        reason: `periodic_audit:${missingArtifact.reason}`,
        targetPaths: [],
        observedAt
      };
    }

    const pendingAutoTaskState = this.autoTaskStateByWorkspace.get(workspaceId);
    if (pendingAutoTaskState && hasPendingAutoTasks(pendingAutoTaskState) && !pendingAutoTaskState.timer) {
      return {
        scope: AFFAIRS_LIBRARY_RECONCILE_SCOPES.periodicAudit,
        status: AFFAIRS_LIBRARY_RECONCILE_STATUSES.driftDetected,
        reason: AFFAIRS_LIBRARY_RECONCILE_REASONS.periodicAuditPendingDirtySignal,
        targetPaths: [],
        observedAt
      };
    }

    const exportStatus = readIndexStatusFileSafe(rootDir);
    const runtimeStatus = readRuntimeStatusFileSafe(rootDir);
    if (
      runtimeStatus?.updatedAtMs
      && Number.isFinite(runtimeStatus.updatedAtMs)
      && runtimeStatus.updatedAtMs > (exportStatus?.exportedAtMs ?? 0) + LIGHTWEIGHT_RECONCILE_DRIFT_TOLERANCE_MS
    ) {
      return {
        scope: AFFAIRS_LIBRARY_RECONCILE_SCOPES.periodicAudit,
        status: AFFAIRS_LIBRARY_RECONCILE_STATUSES.driftDetected,
        reason: AFFAIRS_LIBRARY_RECONCILE_REASONS.periodicAuditRuntimeStatusAhead,
        targetPaths: [],
        observedAt
      };
    }

    const observation = this.reconcileObservationStateByWorkspace.get(workspaceId);
    if ((observation?.consecutiveLightweightDrifts ?? 0) >= 2) {
      return {
        scope: AFFAIRS_LIBRARY_RECONCILE_SCOPES.periodicAudit,
        status: AFFAIRS_LIBRARY_RECONCILE_STATUSES.driftDetected,
        reason: `${AFFAIRS_LIBRARY_RECONCILE_REASONS.periodicAuditLightweightDriftStreak}:${observation?.lastLightweightReason ?? "unknown"}`,
        targetPaths: [],
        observedAt
      };
    }

    const rootStats = readAffairsLibraryStatsSafe(rootDir, ".");
    if (
      rootStats
      && Number.isFinite(rootStats.mtimeMs)
      && rootStats.mtimeMs > (exportStatus?.exportedAtMs ?? 0) + LIGHTWEIGHT_RECONCILE_DRIFT_TOLERANCE_MS
    ) {
      return {
        scope: AFFAIRS_LIBRARY_RECONCILE_SCOPES.periodicAudit,
        status: AFFAIRS_LIBRARY_RECONCILE_STATUSES.driftDetected,
        reason: AFFAIRS_LIBRARY_RECONCILE_REASONS.periodicAuditRootDirMtime,
        targetPaths: ["."],
        observedAt
      };
    }

    return {
      scope: AFFAIRS_LIBRARY_RECONCILE_SCOPES.periodicAudit,
      status: AFFAIRS_LIBRARY_RECONCILE_STATUSES.healthy,
      reason: AFFAIRS_LIBRARY_RECONCILE_REASONS.periodicAuditTimer,
      targetPaths: [],
      observedAt
    };
  }

  private recordLightweightReconcileObservation(
    workspaceId: string,
    result: AffairsLibraryReconcileResult
  ): void {
    const current = this.reconcileObservationStateByWorkspace.get(workspaceId) ?? {
      consecutiveLightweightDrifts: 0,
      lastLightweightObservedAt: null,
      lastLightweightReason: null
    } satisfies AffairsLibraryReconcileObservationState;

    if (result.status === AFFAIRS_LIBRARY_RECONCILE_STATUSES.healthy) {
      this.reconcileObservationStateByWorkspace.set(workspaceId, {
        consecutiveLightweightDrifts: 0,
        lastLightweightObservedAt: result.observedAt,
        lastLightweightReason: null
      });
      return;
    }

    this.reconcileObservationStateByWorkspace.set(workspaceId, {
      consecutiveLightweightDrifts: current.consecutiveLightweightDrifts + 1,
      lastLightweightObservedAt: result.observedAt,
      lastLightweightReason: result.reason
    });
  }

  private findRecentDirectoryDrift(
    workspaceId: string,
    rootDir: string,
    referenceTimestampMs: number
  ): { directoryPath: string; observedAt: string } | null {
    const candidateDirectoryPaths = new Set<string>(["."]);
    const recentDirectories = [...this.hotDirectoryCache.values()]
      .filter((entry) => entry.workspaceId === workspaceId)
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
      .slice(0, HOT_DIRECTORY_MAX_PER_WORKSPACE);

    for (const entry of recentDirectories) {
      candidateDirectoryPaths.add(entry.directoryPath);
    }

    let selected: { directoryPath: string; observedAt: string; observedAtMs: number } | null = null;

    for (const directoryPath of candidateDirectoryPaths) {
      const stats = readAffairsLibraryStatsSafe(rootDir, directoryPath);
      if (!stats) {
        continue;
      }

      const observedAtMs = stats.mtimeMs;
      if (!Number.isFinite(observedAtMs)) {
        continue;
      }

      if (observedAtMs <= referenceTimestampMs + LIGHTWEIGHT_RECONCILE_DRIFT_TOLERANCE_MS) {
        continue;
      }

      const candidate = {
        directoryPath,
        observedAt: new Date(observedAtMs).toISOString(),
        observedAtMs
      };

      if (!selected || candidate.observedAtMs > selected.observedAtMs) {
        selected = candidate;
      }
    }

    return selected
      ? {
          directoryPath: selected.directoryPath,
          observedAt: selected.observedAt
        }
      : null;
  }


  dispose(): void {
    for (const state of this.autoTaskStateByWorkspace.values()) {
      if (state.timer) {
        clearTimeout(state.timer);
      }
    }
    this.autoTaskStateByWorkspace.clear();
    for (const timer of this.lightweightReconcileTimers.values()) {
      clearInterval(timer);
    }
    this.lightweightReconcileTimers.clear();
    this.reconcileObservationStateByWorkspace.clear();
    this.hotDirectoryCache.clear();
  }

  getRefreshTaskSnapshot(workspaceId: string): TaskSnapshot | null {
    return this.taskManager.peek(HOST_TASK_TYPES.affairsLibraryIndex, workspaceId);
  }

  private readDirectoryStatus(
    workspaceId: string,
    _rootDir: string,
    directoryPath: string,
    fallbackSource: AffairsLibraryDirectorySourceDto
  ): AffairsLibraryDirectoryStatusDto {
    const normalizedPath = normalizeFolderPath(directoryPath) || ".";
    const cacheKey = buildHotDirectoryCacheKey(workspaceId, normalizedPath);
    const entry = this.hotDirectoryCache.get(cacheKey);
    const snapshot = this.taskManager.peek(HOST_TASK_TYPES.affairsLibraryDirectoryHint, cacheKey);
    if (snapshot && (snapshot.status === "queued" || snapshot.status === "running" || snapshot.status === "queue_timeout")) {
      return {
        path: normalizedPath,
        state: snapshot.status === "running"
          ? "running"
          : snapshot.status === "queue_timeout"
            ? "queue_timeout"
            : "queued",
        source: entry?.source ?? fallbackSource,
        lastRequestedAt: toIso(snapshot.enqueuedAt),
        lastCompletedAt: entry?.lastRefreshCompletedAt ?? null,
        lastFailedAt: snapshot.status === "queue_timeout"
          ? toIso(snapshot.finishedAt)
          : entry?.lastRefreshFailedAt ?? null,
        runningTaskId: snapshot.status === "running" ? snapshot.taskId : null,
        errorSummary: snapshot.status === "queue_timeout"
          ? snapshot.errorMessage ?? entry?.lastError ?? null
          : entry?.lastError ?? null,
        generatedAt: entry?.generatedAt ?? null,
        filesystemObservedAt: entry?.filesystemObservedAt ?? null,
        staleReason: entry?.staleReason ?? null
      };
    }
    return {
      path: normalizedPath,
      state: entry?.status ?? "idle",
      source: entry?.source ?? fallbackSource,
      lastRequestedAt: entry?.lastRefreshRequestedAt ?? null,
      lastCompletedAt: entry?.lastRefreshCompletedAt ?? null,
      lastFailedAt: entry?.lastRefreshFailedAt ?? null,
      runningTaskId: null,
      errorSummary: entry?.lastError ?? null,
      generatedAt: entry?.generatedAt ?? null,
      filesystemObservedAt: entry?.filesystemObservedAt ?? null,
      staleReason: entry?.staleReason ?? null
    };
  }

  private getOrCreateHotDirectoryEntry(
    workspaceId: string,
    rootDir: string,
    directoryPath: string
  ): AffairsLibraryHotDirectoryCacheEntry {
    const normalizedDirectoryPath = normalizeFolderPath(directoryPath) || ".";
    const cacheKey = buildHotDirectoryCacheKey(workspaceId, normalizedDirectoryPath);
    const existing = this.hotDirectoryCache.get(cacheKey);
    if (existing) {
      if (existing.rootDir !== rootDir) {
        existing.rootDir = rootDir;
      }
      return existing;
    }

    const entry: AffairsLibraryHotDirectoryCacheEntry = {
      workspaceId,
      rootDir,
      directoryPath: normalizedDirectoryPath,
      items: [],
      childDirectoryCount: 0,
      updatedAtMs: 0,
      source: "snapshot",
      dirty: true,
      pendingHintReasons: new Set<string>(),
      lastHintAt: null,
      lastRefreshRequestedAt: null,
      lastRefreshCompletedAt: null,
      lastRefreshFailedAt: null,
      lastError: null,
      status: "idle",
      generatedAt: null,
      filesystemObservedAt: null,
      staleReason: null
    };
    this.hotDirectoryCache.set(cacheKey, entry);
    return entry;
  }

  private updateHotDirectoryCache(
    workspaceId: string,
    rootDir: string,
    directoryPath: string,
    items: AffairsLibraryDocumentRecordDto[],
    childDirectoryCount: number,
    source: AffairsLibraryDirectorySourceDto,
    options: {
      preserveStatus?: boolean;
      requestedAt?: string | null;
      completedAt?: string | null;
      failedAt?: string | null;
      errorSummary?: string | null;
      generatedAt?: string | null;
      filesystemObservedAt?: string | null;
      staleReason?: string | null;
    } = {}
  ): AffairsLibraryHotDirectoryCacheEntry {
    const entry = this.getOrCreateHotDirectoryEntry(workspaceId, rootDir, directoryPath);
    entry.rootDir = rootDir;
    entry.items = items;
    entry.childDirectoryCount = childDirectoryCount;
    entry.updatedAtMs = Date.now();
    entry.source = source;
    entry.lastRefreshRequestedAt = options.requestedAt ?? entry.lastRefreshRequestedAt;
    entry.lastRefreshCompletedAt = options.completedAt ?? entry.lastRefreshCompletedAt;
    entry.lastRefreshFailedAt = options.failedAt ?? entry.lastRefreshFailedAt;
    entry.lastError = options.errorSummary ?? null;
    entry.generatedAt = options.generatedAt ?? entry.generatedAt;
    entry.filesystemObservedAt = options.filesystemObservedAt ?? entry.filesystemObservedAt;
    entry.staleReason = options.staleReason ?? null;
    entry.dirty = false;
    if (!options.preserveStatus) {
      entry.status = options.errorSummary ? "failed" : "fresh";
    }
    if (!options.preserveStatus) {
      entry.pendingHintReasons.clear();
    }
    this.ensureDirectoryWindow(workspaceId, rootDir, directoryPath);
    return entry;
  }

  private markHotDirectoryCacheDirty(workspaceId: string, directoryPath: string, reason: string): void {
    const binding = this.findEnabledBindingByWorkspaceId(workspaceId);
    const rootDir = binding?.rootDir?.trim() ?? "";
    if (!rootDir) {
      return;
    }
    const entry = this.getOrCreateHotDirectoryEntry(workspaceId, rootDir, directoryPath);
    entry.dirty = true;
    entry.status = entry.status === "running" ? "running" : "idle";
    entry.pendingHintReasons.add(reason);
    entry.lastHintAt = nowIso();
    entry.staleReason = null;
    this.ensureDirectoryWindow(workspaceId, rootDir, directoryPath);
  }

  private removePathFromHotDirectoryCache(workspaceId: string, rootDir: string, targetPath: string): void {
    const normalizedTargetPath = normalizeMutationRefreshTarget(targetPath);
    if (!normalizedTargetPath) {
      return;
    }

    const deletedDirectoryPath = normalizeFolderPath(normalizedTargetPath);
    const parentDirectoryPath = normalizeFolderPath(getParentFolderPath(normalizedTargetPath));
    for (const entry of this.hotDirectoryCache.values()) {
      if (entry.workspaceId !== workspaceId || entry.rootDir !== rootDir) {
        continue;
      }

      const normalizedEntryDirectoryPath = normalizeFolderPath(entry.directoryPath);
      const beforeCount = entry.items.length;
      entry.items = entry.items.filter((item) => {
        const itemPath = normalizeMutationRefreshTarget(item.path);
        if (!itemPath) {
          return false;
        }
        return itemPath !== normalizedTargetPath && !itemPath.startsWith(`${normalizedTargetPath}/`);
      });

      if (
        beforeCount !== entry.items.length
        || normalizedEntryDirectoryPath === parentDirectoryPath
        || normalizedEntryDirectoryPath === deletedDirectoryPath
        || normalizedEntryDirectoryPath.startsWith(`${deletedDirectoryPath}/`)
      ) {
        entry.dirty = true;
        entry.status = entry.status === "running" ? "running" : "idle";
        entry.pendingHintReasons.add(`library_delete:${normalizedTargetPath}`);
        entry.lastHintAt = nowIso();
        entry.staleReason = null;
      }
    }
  }

  private ensureDirectoryWindow(workspaceId: string, rootDir: string, directoryPath: string): void {
    const entry = this.getOrCreateHotDirectoryEntry(workspaceId, rootDir, directoryPath);
    entry.updatedAtMs = Math.max(entry.updatedAtMs, Date.now());
    const workspaceEntries = [...this.hotDirectoryCache.entries()]
      .filter(([, candidate]) => candidate.workspaceId === workspaceId)
      .sort((left, right) => right[1].updatedAtMs - left[1].updatedAtMs);
    const expireBefore = Date.now() - HOT_DIRECTORY_CACHE_TTL_MS;
    for (let index = 0; index < workspaceEntries.length; index += 1) {
      const [cacheKey, candidate] = workspaceEntries[index]!;
      const expired = candidate.updatedAtMs > 0 && candidate.updatedAtMs < expireBefore;
      const overflow = index >= HOT_DIRECTORY_MAX_PER_WORKSPACE;
      if (expired || overflow) {
        this.hotDirectoryCache.delete(cacheKey);
      }
    }
  }

  private scheduleDirectoryHintRefresh(workspaceId: string, directoryPath: string, reason: string): void {
    const binding = this.findEnabledBindingByWorkspaceId(workspaceId);
    const rootDir = binding?.rootDir?.trim() ?? "";
    if (!rootDir) {
      return;
    }
    const normalizedDirectoryPath = normalizeFolderPath(directoryPath) || ".";
    const entry = this.getOrCreateHotDirectoryEntry(workspaceId, rootDir, normalizedDirectoryPath);
    const cacheKey = buildHotDirectoryCacheKey(workspaceId, normalizedDirectoryPath);
    const now = Date.now();
    const isFreshEnough = entry.status === "fresh"
      && !entry.dirty
      && entry.updatedAtMs > 0
      && now - entry.updatedAtMs < HOT_DIRECTORY_CACHE_TTL_MS;
    if (reason === "list_documents" && isFreshEnough) {
      return;
    }

    entry.pendingHintReasons.add(reason);
    entry.lastHintAt = nowIso();
    entry.lastRefreshRequestedAt = nowIso();
    entry.status = "queued";
    this.ensureDirectoryWindow(workspaceId, rootDir, normalizedDirectoryPath);

    const current = this.taskManager.peek(HOST_TASK_TYPES.affairsLibraryDirectoryHint, cacheKey);
    if (current && (current.status === "queued" || current.status === "running")) {
      writeAffairsLibraryDebugLog({
        event: "directory_hint_task_deduped",
        processRole: "host",
        workspaceId,
        rootDir,
        taskType: current.taskType,
        taskId: current.taskId,
        source: "affairs_library.directory_hint",
        reason,
        targetPath: normalizedDirectoryPath,
        status: current.status
      });
      return;
    }

    const handle = this.taskManager.enqueue<{
      workspaceId: string;
      rootDir: string;
      directoryPath: string;
      reason: string;
    }, AffairsLibraryDirectoryHintTaskResult>(
      HOST_TASK_TYPES.affairsLibraryDirectoryHint,
      {
        key: cacheKey,
        source: "affairs_library.directory_hint",
        input: {
          workspaceId,
          rootDir,
          directoryPath: normalizedDirectoryPath,
          reason
        }
      }
    );
    this.attachDirectoryHintTaskFollowUp(workspaceId, cacheKey, handle, {
      rootDir,
      directoryPath: normalizedDirectoryPath,
      reason
    });
  }

  private async runDirectoryHintTask(input: {
    workspaceId: string;
    rootDir: string;
    directoryPath: string;
    reason: string;
  }): Promise<AffairsLibraryDirectoryHintTaskResult> {
    const exportData = this.readAvailableExportData(input.rootDir);
    const previous = this.getOrCreateHotDirectoryEntry(input.workspaceId, input.rootDir, input.directoryPath).items;
    const liveResult = this.buildFreshFolderDocuments(
      input.rootDir,
      normalizeFolderPath(input.directoryPath),
      exportData
    );
    const completedAt = nowIso();
    const previousPathSet = new Set(previous.map((item) => item.path));
    const nextPathSet = new Set(liveResult.items.map((item) => item.path));
    const changedPaths = [
      ...liveResult.items.map((item) => item.path).filter((item) => !previousPathSet.has(item)),
      ...previous.map((item) => item.path).filter((item) => !nextPathSet.has(item))
    ].sort((left, right) => left.localeCompare(right, "zh-CN"));
    return {
      directoryPath: input.directoryPath,
      refreshedAt: completedAt,
      source: liveResult.source,
      itemCount: liveResult.items.length,
      childDirectoryCount: liveResult.childDirectoryCount,
      changedPaths,
      items: liveResult.items,
      generatedAt: liveResult.generatedAt,
      filesystemObservedAt: liveResult.filesystemObservedAt
    };
  }

  private attachDirectoryHintTaskFollowUp(
    workspaceId: string,
    cacheKey: string,
    handle: {
      taskId: string;
      taskType: string;
      deduped: boolean;
      promise: Promise<AffairsLibraryDirectoryHintTaskResult>;
    },
    meta: {
      rootDir: string;
      directoryPath: string;
      reason: string;
    }
  ): void {
    writeAffairsLibraryDebugLog({
      event: "task_enqueued",
      processRole: "host",
      workspaceId,
      rootDir: meta.rootDir,
      taskType: handle.taskType,
      taskId: handle.taskId,
      source: "affairs_library.directory_hint",
      reason: meta.reason,
      targetPath: meta.directoryPath,
      deduped: handle.deduped,
      status: "queued"
    });
    void handle.promise.then((result) => {
      this.updateHotDirectoryCache(
        workspaceId,
        meta.rootDir,
        meta.directoryPath,
        result.items,
        result.childDirectoryCount,
        result.source,
        {
          requestedAt: this.getOrCreateHotDirectoryEntry(workspaceId, meta.rootDir, meta.directoryPath).lastRefreshRequestedAt,
          completedAt: result.refreshedAt,
          errorSummary: null,
          generatedAt: result.generatedAt,
          filesystemObservedAt: result.filesystemObservedAt,
          staleReason: null
        }
      );
      writeAffairsLibraryDebugLog({
        event: "task_finished",
        processRole: "host",
        workspaceId,
        rootDir: meta.rootDir,
        taskType: handle.taskType,
        taskId: handle.taskId,
        source: "affairs_library.directory_hint",
        reason: meta.reason,
        targetPath: meta.directoryPath,
        status: "finished",
        resultSummary: {
          directoryPath: result.directoryPath,
          source: result.source,
          itemCount: result.itemCount,
          changedPaths: result.changedPaths
        }
      });
    }).catch((error) => {
      const entry = this.hotDirectoryCache.get(cacheKey);
      if (entry) {
        entry.status = "failed";
        entry.lastError = error instanceof Error ? error.message : String(error);
        entry.lastRefreshFailedAt = nowIso();
        entry.staleReason = AFFAIRS_LIBRARY_INDEX_DIRTY_REASONS.staleFallback;
      }
      writeAffairsLibraryDebugLog({
        event: "task_failed",
        processRole: "host",
        workspaceId,
        rootDir: meta.rootDir,
        taskType: handle.taskType,
        taskId: handle.taskId,
        source: "affairs_library.directory_hint",
        reason: meta.reason,
        targetPath: meta.directoryPath,
        status: "failed",
        message: error instanceof Error ? error.message : String(error)
      });
    });
  }

  private readFavorites(workspaceId: string, userId: string): AffairsLibraryFavoriteRecord[] {
    const setting = this.resolveLibrarySetting(userId, workspaceId);
    const raw = setting?.favoritesJson?.trim();
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter((item): item is { kind?: string; path?: string; label?: string; tagPaths?: unknown } => Boolean(item) && typeof item === "object")
        .filter((item) => isAffairsLibraryFavoriteKind(item.kind) && typeof item.path === "string" && item.path.trim())
        .map((item) => ({
          kind: item.kind as AffairsLibraryFavoriteKind,
          path: item.path!.trim(),
          label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : item.path!.trim(),
          ...(item.kind === "tag_filter"
            ? { tagPaths: normalizeSelectedTagPaths(Array.isArray(item.tagPaths) ? item.tagPaths : item.path!.split("|")) }
            : {})
        }));
    } catch {
      return [];
    }
  }

  private readIndexStatus(
    workspaceId: string,
    binding: AffairsLibraryBindingDto | null
  ): AffairsLibraryIndexStatusDto {
    const taskSnapshot = this.findRelevantIndexTaskSnapshot(workspaceId);
    const exportStatus = binding?.enabled ? readIndexStatusFileSafe(binding.rootDir) : null;
    const runtimeStatus = binding?.enabled ? readRuntimeStatusFileSafe(binding.rootDir) : null;
    const workerHealth = binding?.enabled
      ? mapTaskHelperWorkerHealth(getSharedTaskHelperPool().getWorkerHealth(binding.rootDir))
      : null;
    if (taskSnapshot?.status === "queue_timeout") {
      return {
        state: "queue_timeout",
        dirtyReasons: [AFFAIRS_LIBRARY_INDEX_DIRTY_REASONS.queueTimeout],
        lastRequestedAt: toIso(taskSnapshot.enqueuedAt),
        lastStartedAt: null,
        lastCompletedAt: null,
        lastFailedAt: toIso(taskSnapshot.finishedAt),
        nextAllowedAt: null,
        runningTaskId: null,
        runningStage: null,
        errorSummary: taskSnapshot.errorMessage ?? "文档库刷新排队等待超时",
        workerHealth,
        progress: runtimeStatus?.progress ?? null
      };
    }

    if (taskSnapshot && (taskSnapshot.status === "queued" || taskSnapshot.status === "running")) {
      const activeStartedAtMs = taskSnapshot.startedAt ?? taskSnapshot.enqueuedAt ?? null;
      const reconciledStatus = hasExportCaughtUp(exportStatus, activeStartedAtMs)
        ? buildCompletedStatusFromExport(
          exportStatus,
          taskSnapshot.enqueuedAt,
          taskSnapshot.startedAt
        )
        : null;
      if (reconciledStatus) {
        return {
          ...reconciledStatus,
          workerHealth,
          progress: runtimeStatus?.progress ?? null
        };
      }

      const orphanedRunningTask = binding?.enabled
        ? detectOrphanedRunningTask(binding.rootDir, taskSnapshot, runtimeStatus)
        : null;
      if (orphanedRunningTask) {
        return {
          state: "failed",
          dirtyReasons: [AFFAIRS_LIBRARY_INDEX_DIRTY_REASONS.refreshFailed, orphanedRunningTask.reason],
          lastRequestedAt: toIso(taskSnapshot.enqueuedAt),
          lastStartedAt: toIso(taskSnapshot.startedAt),
          lastCompletedAt: null,
          lastFailedAt: nowIso(),
          nextAllowedAt: null,
          runningTaskId: null,
          runningStage: null,
          errorSummary: orphanedRunningTask.errorSummary,
          workerHealth,
          progress: runtimeStatus?.progress ?? null,
        };
      }

      return {
        state: taskSnapshot.status === "queued" ? "queued" : "running",
        dirtyReasons: [AFFAIRS_LIBRARY_INDEX_DIRTY_REASONS.refreshRequested],
        lastRequestedAt: toIso(taskSnapshot.enqueuedAt),
        lastStartedAt: toIso(taskSnapshot.startedAt),
        lastCompletedAt: null,
        lastFailedAt: null,
        nextAllowedAt: null,
        runningTaskId: taskSnapshot.status === "running" ? taskSnapshot.taskId : null,
        runningStage: resolveAffairsLibraryRunningStage(workspaceId, taskSnapshot, runtimeStatus),
        errorSummary: null,
        workerHealth,
        progress: runtimeStatus?.progress ?? null,
      };
    }

    if (taskSnapshot?.status === "failed" || taskSnapshot?.status === "timeout" || taskSnapshot?.status === "cancelled") {
      const failedReferenceMs = taskSnapshot.finishedAt ?? taskSnapshot.startedAt ?? taskSnapshot.enqueuedAt ?? null;
      if (hasExportCaughtUp(exportStatus, failedReferenceMs)) {
        const completedStatus = buildCompletedStatusFromExport(
          exportStatus,
          taskSnapshot.enqueuedAt,
          taskSnapshot.startedAt
        );
        return completedStatus ? {
          ...completedStatus,
          workerHealth,
          progress: runtimeStatus?.progress ?? null
        } : {
          state: "fresh",
          dirtyReasons: [],
          lastRequestedAt: toIso(taskSnapshot.enqueuedAt),
          lastStartedAt: toIso(taskSnapshot.startedAt),
          lastCompletedAt: exportStatus?.exportedAt ?? null,
          lastFailedAt: null,
          nextAllowedAt: null,
          runningTaskId: null,
          runningStage: null,
          errorSummary: null,
          workerHealth,
          progress: runtimeStatus?.progress ?? null,
        };
      }

      const failedAt = toIso(taskSnapshot.finishedAt);
      const failedAtMs = taskSnapshot.finishedAt ?? Date.now();
      const nextAllowedAtMs = failedAtMs + INDEX_TASK_COOLDOWN_MS;
      const now = Date.now();

      return {
        state: now < nextAllowedAtMs ? "cooldown" : "failed",
        dirtyReasons: [AFFAIRS_LIBRARY_INDEX_DIRTY_REASONS.refreshFailed],
        lastRequestedAt: toIso(taskSnapshot.enqueuedAt),
        lastStartedAt: toIso(taskSnapshot.startedAt),
        lastCompletedAt: null,
        lastFailedAt: failedAt,
        nextAllowedAt: toIso(nextAllowedAtMs),
        runningTaskId: null,
        runningStage: null,
        errorSummary: taskSnapshot.errorMessage ?? "最近一次文档库刷新失败",
        workerHealth,
        progress: runtimeStatus?.progress ?? null,
      };
    }

    if (!binding) {
      return {
        state: "stale",
        dirtyReasons: [AFFAIRS_LIBRARY_INDEX_DIRTY_REASONS.bindingRequired],
        lastRequestedAt: null,
        lastStartedAt: null,
        lastCompletedAt: null,
        lastFailedAt: null,
        nextAllowedAt: null,
        runningTaskId: null,
        runningStage: null,
        errorSummary: null,
        workerHealth
      };
    }

    if (!binding.enabled) {
      return {
        state: "stale",
        dirtyReasons: [AFFAIRS_LIBRARY_INDEX_DIRTY_REASONS.libraryDisabled],
        lastRequestedAt: null,
        lastStartedAt: null,
        lastCompletedAt: null,
        lastFailedAt: null,
        nextAllowedAt: null,
        runningTaskId: null,
        runningStage: null,
        errorSummary: "文档库功能已关闭，启用后才会启动内置索引服务。",
        workerHealth
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
        runningStage: null,
        errorSummary: missingArtifact.errorSummary,
        workerHealth
      };
    }

    const completedStatus = buildCompletedStatusFromExport(exportStatus, null, null);
    return completedStatus ? {
      ...completedStatus,
      workerHealth,
      progress: runtimeStatus?.progress ?? null
    } : {
      state: "stale",
      dirtyReasons: [AFFAIRS_LIBRARY_INDEX_DIRTY_REASONS.missingExportStatus],
      lastRequestedAt: null,
      lastStartedAt: null,
      lastCompletedAt: null,
      lastFailedAt: null,
      nextAllowedAt: null,
      runningTaskId: null,
      runningStage: null,
      errorSummary: "文档库导出状态文件缺失，系统会自动补跑一次全量重建。",
      workerHealth
    };
  }

  private registerBackgroundTasks(): void {
    if (!this.taskManager.has(HOST_TASK_TYPES.affairsLibraryApplyConfig)) {
      this.taskManager.register<{ workspaceId: string; rootDir: string; reason?: string }, AffairsIndexerCommandResult>({
        taskType: HOST_TASK_TYPES.affairsLibraryApplyConfig,
        executionLane: "helper_process",
        helperProcessHandler: "affairs.library_apply_config",
        timeoutMs: INDEX_TASK_TIMEOUT_MS,
        queueWaitTimeoutMs: INDEX_TASK_QUEUE_WAIT_TIMEOUT_MS,
        run: async (input) =>
          await this.runInternalCommand(input.rootDir, "apply-config", {
            reason: input.reason
          })
      });
    }

    if (!this.taskManager.has(HOST_TASK_TYPES.affairsLibraryDirectoryHint)) {
      this.taskManager.register<{
        workspaceId: string;
        rootDir: string;
        directoryPath: string;
        reason: string;
      }, AffairsLibraryDirectoryHintTaskResult>({
        taskType: HOST_TASK_TYPES.affairsLibraryDirectoryHint,
        executionLane: "helper_process",
        helperProcessHandler: "affairs.library_directory_hint",
        timeoutMs: DIRECTORY_HINT_TASK_TIMEOUT_MS,
        queueWaitTimeoutMs: DIRECTORY_HINT_QUEUE_WAIT_TIMEOUT_MS,
        run: async (input) => await this.runDirectoryHintTask(input)
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
        queueWaitTimeoutMs: INDEX_TASK_QUEUE_WAIT_TIMEOUT_MS,
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

    if (!this.taskManager.has(HOST_TASK_TYPES.affairsLibraryExport)) {
      this.taskManager.register<{ workspaceId: string; rootDir: string }, AffairsIndexerCommandResult>({
        taskType: HOST_TASK_TYPES.affairsLibraryExport,
        executionLane: "helper_process",
        helperProcessHandler: "affairs.library_export",
        timeoutMs: INDEX_TASK_TIMEOUT_MS,
        queueWaitTimeoutMs: INDEX_TASK_QUEUE_WAIT_TIMEOUT_MS,
        run: async (input) => await this.runInternalCommand(input.rootDir, "export")
      });
    }
  }

  private async runInternalCommand(
    rootDir: string,
    commandName: "apply-config" | "index" | "export" | "watch-touch",
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
    for (const setting of this.listEnabledSettingsWithWorkspace()) {
      const workspaceId = setting.lastWorkspaceId?.trim() ?? "";
      const userId = setting.userId?.trim() ?? "";
      if (!workspaceId || !userId) {
        continue;
      }
      const binding = this.getBinding(workspaceId, userId);
      const status = this.readIndexStatus(workspaceId, binding);
      if (status.state === "fresh" || status.state === "cooldown" || status.state === "queued" || status.state === "running") {
        this.logger.info(
          {
            workspaceId,
            rootDir: binding?.rootDir ?? setting.rootDir ?? null,
            status: status.state,
            source: "affairs_library.startup_resume"
          },
          "事务文档库启动恢复已跳过，当前索引状态无需补跑"
        );
        continue;
      }

      this.scheduleAutoRefresh(workspaceId, "startup_resume");
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
      writeAffairsLibraryDebugLog({
        event: "auto_task_skipped",
        processRole: "host",
        workspaceId,
        source: "affairs_library.auto_task",
        status: "skipped",
        message: "当前工作区没有启用的文档库绑定"
      });
      return;
    }

    const binding = this.findEnabledBindingByWorkspaceId(workspaceId);
    const rootDir = binding?.rootDir?.trim() ?? "";

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
      writeAffairsLibraryDebugLog({
        event: "auto_task_skipped",
        processRole: "host",
        workspaceId,
        rootDir,
        source: "affairs_library.auto_task",
        status: "skipped",
        message: "当前根目录不可用"
      });
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
      writeAffairsLibraryDebugLog({
        event: "auto_task_detected_missing_artifact",
        processRole: "host",
        workspaceId,
        rootDir,
        source: "affairs_library.auto_task",
        reason: missingArtifact.reason,
        message: missingArtifact.errorSummary
      });
    }

    const blockingTask = this.reconcileOrphanedRunningTasks(workspaceId, rootDir, {
      source: "affairs_library.auto_task",
      triggerReason: "auto_refresh"
    });
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
      writeAffairsLibraryDebugLog({
        event: "auto_task_blocked_by_running_task",
        processRole: "host",
        workspaceId,
        rootDir,
        taskType: blockingTask.taskType,
        taskId: blockingTask.taskId,
        source: "affairs_library.auto_task",
        status: blockingTask.status,
        details: {
          blockingTaskStatus: blockingTask.status
        }
      });
      return;
    }

    if (state.applyConfigReasons.size > 0) {
      const reason = joinAutoTaskReasons(state.applyConfigReasons, `watch:${DEFAULT_CONFIG_RELATIVE_PATH}`);
      writeAffairsLibraryDebugLog({
        event: "auto_task_flush_apply_config",
        processRole: "host",
        workspaceId,
        rootDir,
        source: "affairs_library.watch_apply_config",
        reason,
        details: {
          pendingReasonCount: state.applyConfigReasons.size
        }
      });
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

    if (state.indexReasons.size > 0 || state.indexTargets.size > 0) {
      const forceFullRebuild = [...state.indexReasons].some((reason) => shouldForceFullRebuild(reason));
      const targetPath = forceFullRebuild ? undefined : pickNarrowestTargetPath([...state.indexTargets]);
      const reason = joinAutoTaskReasons(
        state.indexReasons,
        targetPath ? `watch:${targetPath}` : "watch:auto_refresh"
      );
      writeAffairsLibraryDebugLog({
        event: "auto_task_flush_index",
        processRole: "host",
        workspaceId,
        rootDir,
        source: "affairs_library.auto_refresh",
        reason,
        targetPath: targetPath ?? null,
        details: {
          forceFullRebuild,
          pendingReasonCount: state.indexReasons.size,
          pendingTargetCount: state.indexTargets.size,
          pendingTargets: [...state.indexTargets].sort((a, b) => a.localeCompare(b, "zh-CN"))
        }
      });
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

  private reconcileOrphanedRunningTasks(
    workspaceId: string,
    rootDir: string,
    meta: {
      source: string;
      triggerReason: string;
    }
  ): TaskSnapshot | null {
    const runtimeStatus = readRuntimeStatusFileSafe(rootDir);
    const activeSnapshots = this.findActiveLibraryTaskSnapshots(workspaceId);

    for (const snapshot of activeSnapshots) {
      if (snapshot.status !== "running") {
        continue;
      }

      const orphanedRunningTask = detectOrphanedRunningTask(rootDir, snapshot, runtimeStatus);
      if (!orphanedRunningTask) {
        continue;
      }

      this.logger.warn?.(
        {
          workspaceId,
          rootDir,
          taskType: snapshot.taskType,
          taskId: snapshot.taskId,
          reason: orphanedRunningTask.reason,
          ownerPid: orphanedRunningTask.ownerPid,
          heartbeatAgeMs: orphanedRunningTask.heartbeatAgeMs,
          runtimeUpdatedAt: orphanedRunningTask.runtimeUpdatedAt,
          runtimeAgeMs: orphanedRunningTask.runtimeAgeMs,
          runningStage: orphanedRunningTask.runningStage,
          source: meta.source,
          triggerReason: meta.triggerReason
        },
        "检测到事务文档库 orphan running 任务，准备主动清理"
      );
      writeAffairsLibraryDebugLog({
        event: "orphan_running_task_detected",
        processRole: "host",
        workspaceId,
        rootDir,
        taskType: snapshot.taskType,
        taskId: snapshot.taskId,
        source: meta.source,
        reason: orphanedRunningTask.reason,
        status: snapshot.status,
        details: {
          triggerReason: meta.triggerReason,
          ownerPid: orphanedRunningTask.ownerPid,
          heartbeatAgeMs: orphanedRunningTask.heartbeatAgeMs,
          runtimeUpdatedAt: orphanedRunningTask.runtimeUpdatedAt,
          runtimeAgeMs: orphanedRunningTask.runtimeAgeMs,
          runningStage: orphanedRunningTask.runningStage
        },
        message: orphanedRunningTask.errorSummary
      });

      this.taskManager.cancel(snapshot.taskType, workspaceId, `orphaned_helper_process:${orphanedRunningTask.reason}`);

      writeAffairsLibraryDebugLog({
        event: "orphan_running_task_cancelled",
        processRole: "host",
        workspaceId,
        rootDir,
        taskType: snapshot.taskType,
        taskId: snapshot.taskId,
        source: meta.source,
        reason: orphanedRunningTask.reason,
        status: "cancelled",
        details: {
          triggerReason: meta.triggerReason,
          ownerPid: orphanedRunningTask.ownerPid,
          heartbeatAgeMs: orphanedRunningTask.heartbeatAgeMs,
          runtimeUpdatedAt: orphanedRunningTask.runtimeUpdatedAt,
          runtimeAgeMs: orphanedRunningTask.runtimeAgeMs,
          runningStage: orphanedRunningTask.runningStage
        },
        message: "检测到 orphan running 任务后已主动取消，避免持续阻塞后续刷新。"
      });
      this.logger.warn?.(
        {
          workspaceId,
          rootDir,
          taskType: snapshot.taskType,
          taskId: snapshot.taskId,
          reason: orphanedRunningTask.reason,
          source: meta.source,
          triggerReason: meta.triggerReason
        },
        "事务文档库 orphan running 任务已主动取消"
      );
    }

    return this.findBlockingAutoTask(workspaceId);
  }

  private findActiveLibraryTaskSnapshots(workspaceId: string): TaskSnapshot[] {
    const taskTypes = [
      HOST_TASK_TYPES.affairsLibraryApplyConfig,
      HOST_TASK_TYPES.affairsLibraryIndex,
      HOST_TASK_TYPES.affairsLibraryExport
    ];

    return taskTypes
      .map((taskType) => this.taskManager.peek(taskType, workspaceId))
      .filter((snapshot): snapshot is TaskSnapshot => Boolean(snapshot))
      .filter((snapshot) => snapshot.status === "queued" || snapshot.status === "running");
  }

  private findBlockingAutoTask(workspaceId: string): TaskSnapshot | null {
    return this.findActiveLibraryTaskSnapshots(workspaceId)[0] ?? null;
  }

  private findRelevantIndexTaskSnapshot(workspaceId: string): TaskSnapshot | null {
    const taskTypes = [
      HOST_TASK_TYPES.affairsLibraryApplyConfig,
      HOST_TASK_TYPES.affairsLibraryIndex,
      HOST_TASK_TYPES.affairsLibraryExport
    ];
    const snapshots = taskTypes
      .map((taskType) => this.taskManager.peek(taskType, workspaceId))
      .filter((snapshot): snapshot is TaskSnapshot => Boolean(snapshot));

    const active = snapshots
      .filter((snapshot) => snapshot.status === "queued" || snapshot.status === "running")
      .sort((left, right) =>
        (right.startedAt ?? right.enqueuedAt ?? 0) - (left.startedAt ?? left.enqueuedAt ?? 0)
      );
    if (active.length > 0) {
      return active[0] ?? null;
    }

    const failed = snapshots
      .filter((snapshot) =>
        snapshot.status === "failed"
        || snapshot.status === "timeout"
        || snapshot.status === "cancelled"
        || snapshot.status === "queue_timeout"
      )
      .sort((left, right) =>
        (right.finishedAt ?? right.startedAt ?? right.enqueuedAt ?? 0)
        - (left.finishedAt ?? left.startedAt ?? left.enqueuedAt ?? 0)
      );

    return failed[0] ?? null;
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
    writeAffairsLibraryDebugLog({
      event: "task_enqueued",
      processRole: "host",
      workspaceId,
      rootDir: meta.rootDir,
      taskType: handle.taskType,
      taskId: handle.taskId,
      source: meta.source,
      reason: meta.reason,
      targetPath: meta.targetPath ?? null,
      deduped: handle.deduped,
      status: "queued"
    });

    void handle.promise.then(
      (result) => {
        this.invalidateExportCache(meta.rootDir);
        writeAffairsLibraryDebugLog({
          event: "task_finished",
          processRole: "host",
          workspaceId,
          rootDir: meta.rootDir,
          taskType: handle.taskType,
          taskId: handle.taskId,
          command: result.command,
          source: meta.source,
          reason: meta.reason,
          targetPath: meta.targetPath ?? null,
          durationMs: result.durationMs,
          status: "finished",
          deduped: handle.deduped,
          resultSummary: summarizeIndexerCommandResult(result.result)
        });
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
        writeAffairsLibraryDebugLog({
          event: "task_failed",
          processRole: "host",
          workspaceId,
          rootDir: meta.rootDir,
          taskType: handle.taskType,
          taskId: handle.taskId,
          source: meta.source,
          reason: meta.reason,
          targetPath: meta.targetPath ?? null,
          status: "failed",
          deduped: handle.deduped,
          message: error instanceof Error ? error.message : String(error)
        });
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
    writeAffairsLibraryDebugLog({
      event: "snapshot_cache_invalidated",
      processRole: "host",
      rootDir,
      source: "affairs_library.export_cache",
      details: {
        cachePath
      }
    });
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
    input: Omit<FilePreviewResult, "previewPath" | "previewUrl" | "onlyOffice" | "capabilities">
  ): FilePreviewResult {
    return {
      ...input,
      previewPath: null,
      previewUrl: null,
      onlyOffice: null,
      capabilities: buildPreviewCapabilities(input.kind, {
        supported: input.supported,
        content: input.content,
        version: input.version
      })
    };
  }

  private readAvailableExportData(rootDir: string): AffairsLibraryExportData | null {
    const startedAtMs = Date.now();
    try {
      const result = this.readExportData(rootDir);
      writeAffairsLibraryDebugLog({
        event: "export_data_read",
        processRole: "host",
        rootDir,
        source: "affairs_library.export_data",
        status: result ? "fresh" : "missing",
        durationMs: Math.max(0, Date.now() - startedAtMs),
        details: {
          generatedAt: result?.generatedAt ?? null,
          documentCount: result?.documents.length ?? 0
        }
      });
      return result;
    } catch {
      const fallback = this.readLastUsableExportData(rootDir);
      writeAffairsLibraryDebugLog({
        event: "export_data_read",
        processRole: "host",
        rootDir,
        source: "affairs_library.export_data",
        status: fallback ? "stale_fallback" : "missing",
        durationMs: Math.max(0, Date.now() - startedAtMs),
        details: {
          generatedAt: fallback?.generatedAt ?? null,
          documentCount: fallback?.documents.length ?? 0
        }
      });
      return fallback;
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
    includedHiddenPaths: string[];
    folderOpenBehavior: "single_click" | "double_click";
  } {
    const configPath = path.join(rootDir, DEFAULT_CONFIG_RELATIVE_PATH);
    const payload = this.readRawConfigFile(configPath);
    return {
      mirrorRoot: normalizeOptionalAbsolutePath(payload.mirrorRoot),
      allowedExtensions: normalizeAllowedExtensions(payload.allowedExtensions ?? []),
      includedHiddenPaths: normalizeIncludedHiddenPaths(payload.includedHiddenPaths ?? []),
      folderOpenBehavior: normalizeFolderOpenBehavior(payload.folderOpenBehavior)
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

  getGlobalSetting(userId: string): UserAffairsLibrarySettingLike | null {
    return this.userAffairsLibrarySettingRepository.findByUserId(userId);
  }

  getEnabledBindingForWorkspace(workspaceId: string): UserAffairsLibrarySettingLike | null {
    return this.findEnabledBindingByWorkspaceId(workspaceId);
  }

  listEnabledBindingsForWatch(): Array<{
    workspaceId: string | null;
    rootDir: string | null;
    enabled: boolean;
  }> {
    return this.listEnabledSettingsWithWorkspace().map((item) => ({
      workspaceId: item.lastWorkspaceId ?? null,
      rootDir: item.rootDir ?? null,
      enabled: item.enabled === true
    }));
  }

  getBindingForWatch(workspaceId: string): {
    workspaceId: string | null;
    rootDir: string | null;
    enabled: boolean;
  } | null {
    const binding = this.findEnabledBindingByWorkspaceId(workspaceId);
    if (!binding) {
      return null;
    }
    return {
      workspaceId: binding.lastWorkspaceId ?? null,
      rootDir: binding.rootDir ?? null,
      enabled: binding.enabled === true
    };
  }

  private buildBindingFromSetting(
    setting: UserAffairsLibrarySettingLike | null,
    fallbackWorkspaceId: string | null
  ): AffairsLibraryBindingDto | null {
    const rootDir = setting?.rootDir?.trim();

    if (!rootDir) {
      return null;
    }

    const config = this.readConfig(rootDir);
    return {
      workspaceId: fallbackWorkspaceId === AFFAIRS_GLOBAL_WORKSPACE_ID
        ? AFFAIRS_GLOBAL_WORKSPACE_ID
        : setting?.lastWorkspaceId ?? fallbackWorkspaceId,
      rootDir,
      enabled: setting?.enabled === true,
      mirrorRoot: config.mirrorRoot,
      allowedExtensions: config.allowedExtensions,
      includedHiddenPaths: config.includedHiddenPaths,
      folderOpenBehavior: config.folderOpenBehavior,
      configRelativePath: DEFAULT_CONFIG_RELATIVE_PATH,
      exportMode: DEFAULT_EXPORT_MODE,
      updatedAt: setting?.updatedAt ?? nowIso()
    };
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

  private resolveLibrarySetting(userId: string, workspaceId?: string | null): UserAffairsLibrarySettingLike | null {
    const currentSetting = this.userAffairsLibrarySettingRepository.findByUserId(userId);
    const currentRootDir = currentSetting?.rootDir?.trim() ?? "";
    if (currentRootDir) {
      return currentSetting;
    }

    const workspaceScope = workspaceId?.trim() ?? "";
    const legacyFromWorkspace = ((
      workspaceScope
        ? this.workspaceNavigationStateRepository.findByWorkspaceIdAndUserId(workspaceScope, userId)
        : null
    ) ?? (
      workspaceScope
        ? this.workspaceNavigationStateRepository.findLatestAffairsLibraryByWorkspaceId(workspaceScope)
        : null
    )) ?? null;
    const legacyFromUser = !workspaceScope
      ? this.workspaceNavigationStateRepository
        .listByUserId(userId)
        .filter((item) => item.affairsLibraryRootPath?.trim())
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
      : null;
    const legacy = legacyFromWorkspace ?? legacyFromUser;
    const legacyRootDir = legacy?.affairsLibraryRootPath?.trim() ?? "";
    if (!legacyRootDir) {
      return currentSetting;
    }

    const migrated = this.upsertLibrarySetting({
      userId,
      rootDir: legacyRootDir,
      enabled: legacy?.affairsLibraryEnabled === true,
      favoritesJson: legacy?.affairsLibraryFavoritesJson ?? "[]",
      lastWorkspaceId: AFFAIRS_GLOBAL_WORKSPACE_ID,
      dashboardStateJson: currentSetting?.dashboardStateJson ?? "{}",
      createdAt: currentSetting?.createdAt ?? legacy?.updatedAt ?? nowIso(),
      updatedAt: legacy?.updatedAt ?? nowIso()
    });
    return migrated;
  }

  private upsertLibrarySetting(record: UserAffairsLibrarySettingLike): UserAffairsLibrarySettingLike {
    return this.userAffairsLibrarySettingRepository.upsert({
      userId: record.userId,
      rootDir: record.rootDir?.trim() || null,
      enabled: record.enabled === true,
      favoritesJson: record.favoritesJson ?? null,
      lastWorkspaceId: this.normalizeAffairsWorkspaceId(record.lastWorkspaceId),
      dashboardStateJson: record.dashboardStateJson?.trim() || "{}",
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    });
  }

  private listEnabledSettingsWithWorkspace(): UserAffairsLibrarySettingLike[] {
    if (typeof this.userAffairsLibrarySettingRepository.listEnabled === "function") {
      return this.userAffairsLibrarySettingRepository
        .listEnabled()
        .filter((item) => Boolean(item.rootDir?.trim()));
    }

    return this.workspaceNavigationStateRepository
      .listEnabledAffairsLibraries()
      .map((item) => ({
        userId: item.userId,
        rootDir: item.affairsLibraryRootPath ?? null,
        enabled: item.affairsLibraryEnabled === true,
        favoritesJson: item.affairsLibraryFavoritesJson ?? null,
        lastWorkspaceId: AFFAIRS_GLOBAL_WORKSPACE_ID,
        dashboardStateJson: "{}",
        createdAt: item.updatedAt,
        updatedAt: item.updatedAt
      }))
      .filter((item) => Boolean(item.rootDir?.trim()));
  }

  private findEnabledBindingByWorkspaceId(workspaceId: string): UserAffairsLibrarySettingLike | null {
    const normalizedWorkspaceId = this.normalizeAffairsWorkspaceId(workspaceId);

    if (typeof this.userAffairsLibrarySettingRepository.findEnabledByWorkspaceId === "function") {
      const direct = this.userAffairsLibrarySettingRepository.findEnabledByWorkspaceId(normalizedWorkspaceId);
      if (direct) {
        return direct;
      }
      if (normalizedWorkspaceId === AFFAIRS_GLOBAL_WORKSPACE_ID && typeof this.userAffairsLibrarySettingRepository.listEnabled === "function") {
        return this.userAffairsLibrarySettingRepository
          .listEnabled()
          .find((item) => item.rootDir?.trim() && item.enabled === true) ?? null;
      }
      return null;
    }

    const legacy = this.workspaceNavigationStateRepository.findAnyEnabledAffairsLibraryByWorkspaceId(normalizedWorkspaceId);
    if (!legacy?.affairsLibraryRootPath?.trim()) {
      return null;
    }

    return {
      userId: legacy.userId,
      rootDir: legacy.affairsLibraryRootPath ?? null,
      enabled: legacy.affairsLibraryEnabled === true,
      favoritesJson: legacy.affairsLibraryFavoritesJson ?? null,
      lastWorkspaceId: legacy.workspaceId,
      dashboardStateJson: "{}",
      createdAt: legacy.updatedAt,
      updatedAt: legacy.updatedAt
    };
  }


  private normalizeAffairsWorkspaceId(workspaceId?: string | null): string {
    return workspaceId?.trim() || AFFAIRS_GLOBAL_WORKSPACE_ID;
  }

  private assertWorkspaceIdCanUseLegacyAffairsRoute(workspaceId: string): void {
    const normalizedWorkspaceId = workspaceId.trim();
    if (!normalizedWorkspaceId || normalizedWorkspaceId === AFFAIRS_GLOBAL_WORKSPACE_ID) {
      return;
    }
    this.workspaceService.getWorkspaceOrThrow(normalizedWorkspaceId);
  }

  private normalizeAndValidateBindingRootDir(rootDir: string): string {
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

    return normalizedRootDir;
  }

  private normalizeFavorites(favorites: AffairsLibraryFavoriteRecord[]): AffairsLibraryFavoriteRecord[] {
    return favorites
      .filter((item) => item && isAffairsLibraryFavoriteKind(item.kind) && item.path.trim())
      .map((item) => ({
        kind: item.kind,
        path: item.path.trim(),
        label: item.label.trim() || item.path.trim(),
        ...(item.kind === "tag_filter"
          ? { tagPaths: normalizeSelectedTagPaths(item.tagPaths ?? item.path.split("|")) }
          : {})
      }));
  }

  private resolvePreferredWorkspaceId(preferredWorkspaceId?: string | null): string | null {
    return this.normalizeAffairsWorkspaceId(preferredWorkspaceId);
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

function buildOfficeDocumentVersion(fileSize: number, updatedAt: string | null): string | null {
  if (!updatedAt) {
    return null;
  }

  return `${updatedAt}:${fileSize}`;
}

function shouldEnableAffairsLibraryInlineEditing(
  previewKind: FilePreviewResult["kind"],
  fileSize: number
): boolean {
  return fileSize <= MAX_TEXT_FILE_BYTES
    && (previewKind === "text" || previewKind === "markdown" || previewKind === "html");
}

function ensureEditableAffairsLibraryTextBuffer(buffer: Buffer): void {
  if (buffer.byteLength > MAX_TEXT_FILE_BYTES) {
    throw new AppError({
      statusCode: 400,
      errorCode: "FILE_TOO_LARGE",
      detail: "文件过大，暂不支持直接编辑",
      field: "srcPath"
    });
  }

  if (buffer.includes(0)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "BINARY_FILE_NOT_SUPPORTED",
      detail: "二进制文件暂不支持直接编辑",
      field: "srcPath"
    });
  }
}

function ensureWritableAffairsLibraryTextBuffer(buffer: Buffer): void {
  if (buffer.byteLength > MAX_TEXT_FILE_BYTES) {
    throw new AppError({
      statusCode: 400,
      errorCode: "FILE_TOO_LARGE",
      detail: "文件过大，暂不支持直接保存",
      field: "content"
    });
  }
}

function hasPendingAutoTasks(state: AffairsLibraryAutoTaskState): boolean {
  return state.applyConfigReasons.size > 0
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

function normalizeMutationRefreshTarget(relativePath: string | null | undefined): string | null {
  const normalizedPath = relativePath?.trim().replace(/^\.\/+/, "").replace(/\/+$/, "") ?? "";
  return normalizedPath || null;
}

function normalizeHintTargetPath(targetPath: string | null | undefined): string | undefined {
  const normalized = targetPath?.trim().replace(/^\.\/+/, "").replace(/\/+$/, "") ?? "";
  return normalized || undefined;
}

function normalizeDirectoryPathFromTargetPath(targetPath: string | null | undefined): string {
  const normalized = normalizeHintTargetPath(targetPath);
  if (!normalized) {
    return ".";
  }
  const parentPath = getParentFolderPath(normalized);
  return normalizeFolderPath(parentPath) || normalized;
}

function deriveDirectoryPathFromDocumentTarget(targetPath: string | null | undefined): string {
  return normalizeDirectoryPathFromTargetPath(targetPath);
}

function buildHotDirectoryCacheKey(workspaceId: string, directoryPath: string): string {
  return `${workspaceId}::${normalizeFolderPath(directoryPath) || "."}`;
}

function estimateFolderDocumentCount(
  normalizedFolderPath: string,
  exportData: AffairsLibraryExportData | null,
  cachedEntry: AffairsLibraryHotDirectoryCacheEntry | null
): number | null {
  if (cachedEntry?.items.length) {
    return cachedEntry.items.length;
  }

  const folderPath = normalizedFolderPath || ".";
  const folderNode = exportData?.folders.find((item) => normalizeFolderPath(item.path) === folderPath);
  if (folderNode) {
    return Math.max(0, folderNode.directDocumentCount);
  }

  if (!exportData) {
    return null;
  }

  if (!normalizedFolderPath) {
    return exportData.documents.length;
  }

  let count = 0;
  for (const document of exportData.documents) {
    if (!matchesDirectFolder(document.path, normalizedFolderPath)) {
      continue;
    }
    count += 1;
    if (count > LIVE_DIRECTORY_SYNC_SCAN_MAX_DOCUMENTS) {
      return count;
    }
  }

  return count;
}

function mapTaskHelperWorkerHealth(
  snapshot: TaskHelperWorkerHealthSnapshot | null
): AffairsLibraryWorkerHealthDto | null {
  if (!snapshot) {
    return null;
  }

  return {
    ...snapshot
  };
}

function detectMissingIndexArtifact(rootDir: string): {
  reason: string;
  errorSummary: string;
} | null {
  const checks = [
    {
      relativePath: INDEX_DIR_RELATIVE_PATH,
      reason: AFFAIRS_LIBRARY_INDEX_DIRTY_REASONS.missingIndexArtifact,
      errorSummary: "文档库索引目录缺失，系统会自动补跑一次全量重建。"
    },
    {
      relativePath: EXPORT_DIR_RELATIVE_PATH,
      reason: AFFAIRS_LIBRARY_INDEX_DIRTY_REASONS.missingExportDir,
      errorSummary: "文档库导出目录缺失，系统会自动补跑一次全量重建。"
    },
    {
      relativePath: EXPORT_STATUS_RELATIVE_PATH,
      reason: AFFAIRS_LIBRARY_INDEX_DIRTY_REASONS.missingExportStatus,
      errorSummary: "文档库导出状态文件缺失，系统会自动补跑一次全量重建。"
    },
    {
      relativePath: EXPORT_MANIFEST_RELATIVE_PATH,
      reason: AFFAIRS_LIBRARY_INDEX_DIRTY_REASONS.missingExportManifest,
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
  return normalizedReason.includes(AFFAIRS_LIBRARY_INDEX_DIRTY_REASONS.missingIndexArtifact)
    || normalizedReason.includes(AFFAIRS_LIBRARY_INDEX_DIRTY_REASONS.missingExportDir)
    || normalizedReason.includes(AFFAIRS_LIBRARY_INDEX_DIRTY_REASONS.missingExportStatus)
    || normalizedReason.includes(AFFAIRS_LIBRARY_INDEX_DIRTY_REASONS.missingExportManifest);
}

function normalizeDocumentSearchKeyword(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function matchesDocumentKeyword(
  document: Pick<AffairsLibraryDocumentRecordDto, "title" | "path" | "summary" | "tags" | "derivedTags">,
  normalizedKeyword: string
): boolean {
  if (!normalizedKeyword) {
    return true;
  }

  return [
    document.title,
    document.path,
    document.summary,
    ...document.tags,
    ...document.derivedTags
  ].some((value) => value?.toLowerCase().includes(normalizedKeyword));
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

  if (favorite.kind === "document") {
    return favorite.path === documentPath;
  }

  if (favorite.kind === "tag_filter") {
    const tagPaths = normalizeSelectedTagPaths(favorite.tagPaths ?? favorite.path.split("|"));
    return tagPaths.length > 0 && tagPaths.every((tagPath) => (
      [...directTags, ...derivedTags].some((tag) => tag === tagPath || tag.startsWith(`${tagPath}/`))
    ));
  }

  return [...directTags, ...derivedTags].some((tag) => tag === favorite.path || tag.startsWith(`${favorite.path}/`));
}

function buildFavoriteNodeId(kind: AffairsLibraryFavoriteKind, pathValue: string): string {
  return `library:favorite:${kind}:${pathValue}`;
}

function isAffairsLibraryFavoriteKind(kind: unknown): kind is AffairsLibraryFavoriteKind {
  return kind === "folder" || kind === "tag" || kind === "document" || kind === "tag_filter";
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

function readAffairsLibraryExportDataSafe(rootDir: string): AffairsLibraryExportData | null {
  try {
    return readAffairsLibraryExportDataFromDisk(rootDir);
  } catch {
    return null;
  }
}

function readAffairsLibraryExportDataFromDisk(rootDir: string): AffairsLibraryExportData | null {
  const exportRoot = path.join(rootDir, EXPORT_DIR_RELATIVE_PATH);
  const manifestPath = path.join(exportRoot, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  const manifest = readJsonFile<IndexManifestPayload>(manifestPath);
  const documents = (manifest.meta_shards ?? []).flatMap((shard) => {
    const shardPath = shard.path?.trim();
    if (!shardPath) {
      return [];
    }
    const payload = readJsonFile<IndexMetaShardPayload>(path.join(exportRoot, shardPath));
    return (payload.documents ?? []).map<AffairsLibraryDocumentRecordDto>((document) => ({
      documentId: document.document_id?.trim() || document.path?.trim() || "",
      path: document.path?.trim() || "",
      title: document.title?.trim() || document.path?.trim() || "未命名文档",
      summary: document.summary?.trim() || "",
      updatedAt: document.mtime?.trim() || "",
      createdAt: null,
      sizeBytes: null,
      tags: Array.isArray(document.direct_tags) ? document.direct_tags.filter(Boolean) : [],
      derivedTags: Array.isArray(document.derived_tags) ? document.derived_tags.filter(Boolean) : [],
      isFavorite: false
    }));
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

function normalizeFolderOpenBehavior(value: unknown): "single_click" | "double_click" {
  return value === "single_click" ? "single_click" : "double_click";
}

function readAffairsLibraryConfigSafe(rootDir: string): {
  mirrorRoot: string | null;
  allowedExtensions: string[];
  includedHiddenPaths: string[];
  folderOpenBehavior: "single_click" | "double_click";
} {
  const configPath = path.join(rootDir, DEFAULT_CONFIG_RELATIVE_PATH);
  const payload = fs.existsSync(configPath)
    ? readJsonFile<AffairsLibraryConfigPayload>(configPath)
    : {};
  return {
    mirrorRoot: normalizeOptionalAbsolutePath(payload.mirrorRoot),
    allowedExtensions: normalizeAllowedExtensions(payload.allowedExtensions ?? []),
    includedHiddenPaths: normalizeIncludedHiddenPaths(payload.includedHiddenPaths ?? []),
    folderOpenBehavior: normalizeFolderOpenBehavior(payload.folderOpenBehavior)
  };
}

function countDirectChildFoldersFromSnapshot(
  normalizedFolderPath: string,
  exportData: AffairsLibraryExportData | null
): number {
  if (!exportData) {
    return 0;
  }
  const normalizedCurrentPath = normalizeFolderPath(normalizedFolderPath);
  return exportData.folders.filter((folder) => normalizeFolderPath(folder.parentPath) === normalizedCurrentPath).length;
}

function countVisibleDirectChildDirectories(
  targetDir: string,
  normalizedFolderPath: string,
  includedHiddenPaths: readonly string[]
): number {
  if (!fs.existsSync(targetDir)) {
    return 0;
  }
  let stats: fs.Stats | null = null;
  try {
    stats = fs.statSync(targetDir);
  } catch {
    stats = null;
  }
  if (!stats?.isDirectory()) {
    return 0;
  }
  let count = 0;
  for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }
    const relativePath = normalizedFolderPath ? `${normalizedFolderPath}/${entry.name}` : entry.name;
    if (relativePath === '.ai-index' || relativePath.startsWith('.ai-index/')) {
      continue;
    }
    if (
      (entry.name.startsWith('.') || hasHiddenPathSegment(relativePath))
      && !isIncludedHiddenPath(relativePath, includedHiddenPaths)
    ) {
      continue;
    }
    count += 1;
  }
  return count;
}

function buildAffairsFolderDocumentsFromFilesystem(
  rootDir: string,
  normalizedFolderPath: string,
  exportData: AffairsLibraryExportData | null,
  config: {
    mirrorRoot: string | null;
    allowedExtensions: string[];
    includedHiddenPaths: string[];
  },
  supportedExtensions: ReadonlySet<string> = new Set(SUPPORTED_INDEX_EXTENSION_LIST)
): AffairsLibraryFolderDocumentsBuildResult {
  const targetDir = normalizedFolderPath
    ? path.resolve(rootDir, normalizedFolderPath)
    : rootDir;
  const configuredExtensions = new Set(config.allowedExtensions.map((item) => item.toLowerCase()));
  const documentMap = new Map<string, AffairsLibraryDocumentRecordDto>();
  let hasSnapshotData = false;
  let hasLiveData = false;
  let targetStats: fs.Stats | null = null;
  if (fs.existsSync(targetDir)) {
    try {
      targetStats = fs.statSync(targetDir);
    } catch {
      targetStats = null;
    }
  }
  const canVerifyLiveFiles = targetStats?.isDirectory() === true;

  for (const document of exportData?.documents ?? []) {
    if (!matchesDirectFolder(document.path, normalizedFolderPath)) {
      continue;
    }
    const extension = path.extname(document.path).toLowerCase();
    if (!supportedExtensions.has(extension)) {
      continue;
    }
    if (configuredExtensions.size > 0 && !configuredExtensions.has(extension)) {
      continue;
    }
    const stat = readAffairsLibraryStatsSafe(rootDir, document.path);
    if (canVerifyLiveFiles && !stat?.isFile()) {
      continue;
    }
    documentMap.set(document.path, {
      ...document,
      createdAt: document.createdAt ?? toIsoOrNull(stat?.birthtime),
      sizeBytes: document.sizeBytes ?? stat?.size ?? null,
      updatedAt: stat?.mtime.toISOString() ?? document.updatedAt,
      isFavorite: false
    });
    hasSnapshotData = true;
  }

  if (targetStats?.isDirectory()) {
    for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
      const relativePath = normalizedFolderPath ? `${normalizedFolderPath}/${entry.name}` : entry.name;
      if (
        (entry.name.startsWith(".") || hasHiddenPathSegment(relativePath))
        && !isIncludedHiddenPath(relativePath, config.includedHiddenPaths)
      ) {
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (!supportedExtensions.has(extension)) {
        continue;
      }
      if (configuredExtensions.size > 0 && !configuredExtensions.has(extension)) {
        continue;
      }

      const stat = readAffairsLibraryStatsSafe(rootDir, relativePath);
      const exported = documentMap.get(relativePath);
      documentMap.set(relativePath, {
        documentId: exported?.documentId ?? relativePath,
        path: relativePath,
        title: exported?.title?.trim() || path.basename(entry.name, extension) || entry.name,
        summary: exported?.summary ?? "",
        updatedAt: stat?.mtime.toISOString() ?? exported?.updatedAt ?? "",
        createdAt: toIsoOrNull(stat?.birthtime) ?? exported?.createdAt ?? null,
        sizeBytes: stat?.size ?? exported?.sizeBytes ?? null,
        tags: exported?.tags ?? [],
        derivedTags: exported?.derivedTags ?? [],
        isFavorite: false
      });
      hasLiveData = true;
    }
  }

  return {
    items: [...documentMap.values()],
    childDirectoryCount: countVisibleDirectChildDirectories(targetDir, normalizedFolderPath, config.includedHiddenPaths),
    source: hasLiveData && hasSnapshotData
      ? "mixed"
      : hasLiveData
        ? "live"
        : "snapshot",
    generatedAt: exportData?.generatedAt ?? null,
    filesystemObservedAt: hasLiveData ? nowIso() : null,
    staleReason: null
  };
}

export async function runAffairsLibraryDirectoryHintInHelper(input: {
  rootDir: string;
  directoryPath: string;
  signal?: AbortSignal;
}): Promise<AffairsLibraryDirectoryHintTaskResult> {
  if (input.signal?.aborted) {
    throw input.signal.reason ?? new Error("helper task aborted");
  }
  const exportData = readAffairsLibraryExportDataSafe(input.rootDir);
  const result = buildAffairsFolderDocumentsFromFilesystem(
    input.rootDir,
    normalizeFolderPath(input.directoryPath),
    exportData,
    readAffairsLibraryConfigSafe(input.rootDir)
  );
  return {
    directoryPath: input.directoryPath,
    refreshedAt: nowIso(),
    source: result.source,
    itemCount: result.items.length,
    childDirectoryCount: result.childDirectoryCount,
    changedPaths: result.items.map((item) => item.path).sort((left, right) => left.localeCompare(right, "zh-CN")),
    items: result.items,
    generatedAt: result.generatedAt,
    filesystemObservedAt: result.filesystemObservedAt
  };
}

function isSameOrDescendantRelativePath(targetPath: string, candidatePath: string): boolean {
  return candidatePath === targetPath || candidatePath.startsWith(`${targetPath}/`);
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

function readRuntimeStatusFileSafe(rootDir: string): ParsedRuntimeStatusFile | null {
  const filePath = path.join(rootDir, RUNTIME_STATUS_RELATIVE_PATH);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const payload = readJsonFile<RuntimeStatusFilePayload>(filePath);
    const updatedAt = payload.updatedAt?.trim() ?? null;
    const updatedAtMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
    const rawProgress = payload.progress;
    const progress = rawProgress && typeof rawProgress === "object"
      ? {
        scannedCount: Number(rawProgress.scannedCount ?? 0),
        indexedCount: Number(rawProgress.indexedCount ?? 0),
        skippedCount: Number(rawProgress.skippedCount ?? 0),
        failedCount: Number(rawProgress.failedCount ?? 0),
        unchangedCount: Number(rawProgress.unchangedCount ?? 0),
        totalCount: rawProgress.totalCount === null || rawProgress.totalCount === undefined
          ? null
          : Number(rawProgress.totalCount),
        maxConcurrency: rawProgress.maxConcurrency === null || rawProgress.maxConcurrency === undefined
          ? null
          : Number(rawProgress.maxConcurrency),
      }
      : null;
    return {
      status: payload.status?.trim() ?? null,
      stage: payload.stage?.trim() ?? null,
      command: payload.command?.trim() ?? null,
      taskId: payload.taskId?.trim() ?? null,
      taskType: payload.taskType?.trim() ?? null,
      updatedAt,
      updatedAtMs,
      errorSummary: payload.errorSummary?.trim() ?? null,
      progress: progress && Number.isFinite(progress.scannedCount)
        && Number.isFinite(progress.indexedCount)
        && Number.isFinite(progress.skippedCount)
        && Number.isFinite(progress.failedCount)
        && Number.isFinite(progress.unchangedCount)
        ? progress
        : null,
    };
  } catch {
    return null;
  }
}

function readCommandLockOwnerFileSafe(rootDir: string): ParsedCommandLockOwnerFile | null {
  const filePath = path.join(rootDir, COMMAND_LOCK_OWNER_RELATIVE_PATH);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const payload = readJsonFile<{
      pid?: number;
      command?: string;
      taskId?: string;
      taskType?: string;
      acquiredAt?: string;
    }>(filePath);
    return {
      pid: typeof payload.pid === "number" && Number.isFinite(payload.pid) ? payload.pid : null,
      command: payload.command?.trim() ?? null,
      taskId: payload.taskId?.trim() ?? null,
      taskType: payload.taskType?.trim() ?? null,
      acquiredAt: payload.acquiredAt?.trim() ?? null
    };
  } catch {
    return null;
  }
}

function readCommandLockHeartbeatFileSafe(rootDir: string): ParsedCommandLockHeartbeatFile | null {
  const filePath = path.join(rootDir, COMMAND_LOCK_HEARTBEAT_RELATIVE_PATH);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const payload = readJsonFile<{ ts?: string }>(filePath);
    const ts = payload.ts?.trim() ?? null;
    const tsMs = ts ? Date.parse(ts) : Number.NaN;
    return {
      ts,
      tsMs
    };
  } catch {
    return null;
  }
}

function detectOrphanedRunningTask(
  rootDir: string,
  taskSnapshot: TaskSnapshot,
  runtimeStatus: ParsedRuntimeStatusFile | null
): OrphanedRunningTaskInfo | null {
  if (taskSnapshot.status !== "running") {
    return null;
  }

  const runningStartedAtMs = taskSnapshot.startedAt ?? taskSnapshot.enqueuedAt ?? null;
  if (
    Number.isFinite(runningStartedAtMs ?? Number.NaN)
    && Date.now() - (runningStartedAtMs ?? 0) < ORPHAN_TASK_RECONCILE_GRACE_MS
  ) {
    return null;
  }

  const lockDir = path.join(rootDir, COMMAND_LOCK_DIR_RELATIVE_PATH);
  if (!fs.existsSync(lockDir)) {
    return {
      reason: "command_lock_missing",
      errorSummary: "文档库索引任务已失去 helper 锁文件，上一轮运行可能异常退出。",
      ownerPid: null,
      heartbeatAgeMs: null,
      runtimeUpdatedAt: runtimeStatus?.updatedAt ?? null,
      runtimeAgeMs: Number.isFinite(runtimeStatus?.updatedAtMs ?? Number.NaN)
        ? Date.now() - (runtimeStatus?.updatedAtMs ?? 0)
        : null,
      runningStage: runtimeStatus?.stage ?? null
    };
  }

  const owner = readCommandLockOwnerFileSafe(rootDir);
  if (!owner) {
    return {
      reason: "command_lock_missing",
      errorSummary: "文档库索引任务缺少 helper 锁 owner 信息，上一轮运行可能异常退出。",
      ownerPid: null,
      heartbeatAgeMs: null,
      runtimeUpdatedAt: runtimeStatus?.updatedAt ?? null,
      runtimeAgeMs: Number.isFinite(runtimeStatus?.updatedAtMs ?? Number.NaN)
        ? Date.now() - (runtimeStatus?.updatedAtMs ?? 0)
        : null,
      runningStage: runtimeStatus?.stage ?? null
    };
  }

  if (owner.taskId && owner.taskId !== taskSnapshot.taskId) {
    return null;
  }

  if (owner.taskType && owner.taskType !== taskSnapshot.taskType) {
    return null;
  }

  if (owner.pid === null || !isProcessAliveSafe(owner.pid)) {
    return {
      reason: "command_lock_owner_dead",
      errorSummary: `文档库索引任务的 helper 进程（pid=${owner.pid ?? "unknown"}）已经退出，但 Host 没收到结束回调。`,
      ownerPid: owner.pid,
      heartbeatAgeMs: null,
      runtimeUpdatedAt: runtimeStatus?.updatedAt ?? null,
      runtimeAgeMs: Number.isFinite(runtimeStatus?.updatedAtMs ?? Number.NaN)
        ? Date.now() - (runtimeStatus?.updatedAtMs ?? 0)
        : null,
      runningStage: runtimeStatus?.stage ?? null
    };
  }

  const heartbeat = readCommandLockHeartbeatFileSafe(rootDir);
  const heartbeatAgeMs = Number.isFinite(heartbeat?.tsMs ?? Number.NaN)
    ? Date.now() - (heartbeat?.tsMs ?? 0)
    : Number.POSITIVE_INFINITY;
  if (heartbeatAgeMs > COMMAND_LOCK_STALE_HEARTBEAT_MS) {
    return {
      reason: "command_lock_heartbeat_stale",
      errorSummary: "文档库索引任务的 helper 心跳已长时间不刷新，上一轮运行很可能已经卡死。",
      ownerPid: owner.pid,
      heartbeatAgeMs: Number.isFinite(heartbeatAgeMs) ? heartbeatAgeMs : null,
      runtimeUpdatedAt: runtimeStatus?.updatedAt ?? null,
      runtimeAgeMs: Number.isFinite(runtimeStatus?.updatedAtMs ?? Number.NaN)
        ? Date.now() - (runtimeStatus?.updatedAtMs ?? 0)
        : null,
      runningStage: runtimeStatus?.stage ?? null
    };
  }

  if (
    runtimeStatus?.status === "running"
    && runtimeStatus.taskId === taskSnapshot.taskId
    && Number.isFinite(runtimeStatus.updatedAtMs)
  ) {
    const runtimeAgeMs = Date.now() - runtimeStatus.updatedAtMs;
    if (runtimeAgeMs > COMMAND_LOCK_STALE_HEARTBEAT_MS && heartbeatAgeMs > COMMAND_LOCK_STALE_HEARTBEAT_MS) {
      return {
        reason: "command_lock_heartbeat_stale",
        errorSummary: "文档库索引任务的运行状态和 helper 心跳都已长时间停止刷新，上一轮运行很可能已经卡死。",
        ownerPid: owner.pid,
        heartbeatAgeMs,
        runtimeUpdatedAt: runtimeStatus.updatedAt,
        runtimeAgeMs,
        runningStage: runtimeStatus.stage
      };
    }
  }

  return null;
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
    runningStage: null,
    errorSummary: null
  };
}

function hasExportCaughtUp(
  exportStatus: ParsedIndexStatusFile | null,
  referenceTimestampMs: number | null
): boolean {
  if (!exportStatus?.exportedAt || !Number.isFinite(exportStatus.exportedAtMs)) {
    return false;
  }

  if (!referenceTimestampMs || !Number.isFinite(referenceTimestampMs)) {
    return true;
  }

  return exportStatus.exportedAtMs >= referenceTimestampMs;
}

function resolveAffairsLibraryRunningStage(
  workspaceId: string,
  taskSnapshot: TaskSnapshot,
  runtimeStatus: ParsedRuntimeStatusFile | null
): string | null {
  void workspaceId;
  if (taskSnapshot.status === "queued") {
    return "queued";
  }

  if (
    runtimeStatus?.status === "running"
    && runtimeStatus.stage
    && doesRuntimeStatusMatchTask(taskSnapshot, runtimeStatus)
  ) {
    return runtimeStatus.stage;
  }

  switch (taskSnapshot.taskType) {
    case HOST_TASK_TYPES.affairsLibraryApplyConfig:
      return "apply_config";
    case HOST_TASK_TYPES.affairsLibraryExport:
      return "export";
    case HOST_TASK_TYPES.affairsLibraryIndex:
      return "index";
    default:
      return null;
  }
}

function doesRuntimeStatusMatchTask(
  taskSnapshot: TaskSnapshot,
  runtimeStatus: ParsedRuntimeStatusFile
): boolean {
  if (runtimeStatus.taskId && runtimeStatus.taskId === taskSnapshot.taskId) {
    return true;
  }

  if (runtimeStatus.taskType && runtimeStatus.taskType !== taskSnapshot.taskType) {
    return false;
  }

  const referenceMs = taskSnapshot.startedAt ?? taskSnapshot.enqueuedAt ?? Number.NaN;
  if (!Number.isFinite(referenceMs)) {
    return true;
  }

  return Number.isFinite(runtimeStatus.updatedAtMs) && runtimeStatus.updatedAtMs >= referenceMs;
}

function isProcessAliveSafe(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "EPERM";
  }
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

function hasHiddenPathSegment(relativePath: string): boolean {
  return relativePath
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .some((segment) => segment.startsWith("."));
}
