import { randomUUID } from "node:crypto";

import { AppError } from "../../shared/errors/app-error.js";
import { nowIso } from "../../shared/utils/time.js";
import type { WorkspaceRepository } from "../../storage/repositories/workspace-repository.js";
import type { ButlerFollowUpTaskRepository } from "../../storage/repositories/butler-follow-up-task-repository.js";
import type { ButlerProjectRepository } from "../../storage/repositories/butler-project-repository.js";
import type { ButlerInboxItemRepository } from "../../storage/repositories/butler-inbox-item-repository.js";
import type { UserTeableMirrorRecordMappingRepository } from "../../storage/repositories/user-teable-mirror-record-mapping-repository.js";
import type { UserTeableMirrorTableBindingRepository } from "../../storage/repositories/user-teable-mirror-table-binding-repository.js";
import type { UserTeableSyncLogRepository } from "../../storage/repositories/user-teable-sync-log-repository.js";
import type { Workspace, TeableMirrorReadOnlyMode, TeableSyncLogState, TeableSyncLogTriggerType, TeableSyncSourceType, UserTeableMirrorRecordMappingRecord, UserTeableMirrorTableBindingRecord, UserTeableSyncLogRecord } from "../../types/domain.js";
import type { TaskManager } from "../tasks/task-manager.js";
import type { TaskSnapshot } from "../tasks/task-types.js";
import { HOST_TASK_TYPES } from "../tasks/task-types.js";
import type { AffairsLightweightSessionService } from "./affairs-lightweight-session-service.js";
import type { AffairsTagService } from "./affairs-tag-service.js";
import { TeableApiClient } from "./teable-api-client.js";
import type { TeableFieldMappingDto, TeableFieldMappingService } from "./teable-field-mapping-service.js";
import type { TeableGlobalBindingOverviewDto } from "./teable-global-binding-service.js";
import type { TeableGlobalBindingService } from "./teable-global-binding-service.js";
import type { TeableCredentialService } from "./teable-credential-service.js";
import type { TeableWorkbenchSyncConfigDto, TeableWorkbenchSyncConfigService } from "./teable-workbench-sync-config-service.js";

export interface TeableMirrorTableBindingDto {
  mirrorType: TeableSyncSourceType;
  tableId: string;
  tableName: string;
  readOnlyMode: TeableMirrorReadOnlyMode;
  lastSyncedAt: string | null;
  updatedAt: string;
}

export interface SaveTeableMirrorTableBindingInput {
  mirrorType: TeableSyncSourceType;
  tableId: string;
  tableName: string;
  readOnlyMode?: TeableMirrorReadOnlyMode;
  lastSyncedAt?: string | null;
}

export interface TeableMirrorRecordMappingDto {
  mirrorType: TeableSyncSourceType;
  localId: string;
  teableRecordId: string;
  fingerprint: string;
  lastSyncedAt: string;
  deletedAt: string | null;
  updatedAt: string;
}

export interface SaveTeableMirrorRecordMappingInput {
  mirrorType: TeableSyncSourceType;
  localId: string;
  teableRecordId: string;
  fingerprint: string;
  lastSyncedAt?: string;
  deletedAt?: string | null;
}

export interface RunTeableMirrorSyncInput {
  workspaceId?: string;
  workspaceIds?: string[];
  mirrorTypes?: TeableSyncSourceType[];
}

export interface TeableMirrorSyncResult {
  state: "succeeded" | "partial_failed" | "failed";
  summary: string;
  syncedMirrorTypes: TeableSyncSourceType[];
  failedMirrorTypes: Array<{
    mirrorType: TeableSyncSourceType;
    detail: string;
  }>;
  counts: Record<TeableSyncSourceType, {
    created: number;
    updated: number;
    deleted: number;
    skipped: number;
  }>;
}

export interface RequestTeableMirrorSyncInput extends RunTeableMirrorSyncInput {}

export interface RequestTeableLocalChangeMirrorSyncInput {
  mirrorTypes: TeableSyncSourceType[];
  reason: string;
}

export interface TeableMirrorSyncTaskRequestDto {
  taskId: string;
  deduped: boolean;
  taskType: "mirror_sync";
  state: "queued";
  summary: string;
  updatedAt: string;
}

export interface TeableSyncTaskSnapshotDto {
  taskId: string;
  taskType: "mirror_sync";
  state: "queued" | "running" | "succeeded" | "partial_failed" | "failed";
  summary: string | null;
  lastError: string | null;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  progress: {
    phase: string;
    label: string | null;
    detail: string | null;
    current: number | null;
    total: number | null;
    percent: number | null;
    updatedAt: string;
  } | null;
  result: TeableMirrorSyncResult | null;
}

export interface TeableSyncLogDto {
  logId: string;
  triggerType: TeableSyncLogTriggerType;
  sourceTypes: TeableSyncSourceType[];
  taskId: string | null;
  state: TeableSyncLogState;
  summary: string;
  counts: Partial<TeableMirrorSyncResult["counts"]>;
  errorDetail: string | null;
  reason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeableOverviewDto {
  binding: TeableGlobalBindingOverviewDto;
  syncConfigs: TeableWorkbenchSyncConfigDto[];
  mirrorBindings: TeableMirrorTableBindingDto[];
  latestMirrorSyncTask: TeableSyncTaskSnapshotDto | null;
}

interface MirrorSourceRecord {
  localId: string;
  payload: Record<string, unknown>;
  fingerprint: string;
}

interface RunTeableMirrorSyncTaskInput {
  userId: string;
  mirrorTypes: TeableSyncSourceType[];
  triggerType: TeableSyncLogTriggerType;
  reason?: string | null;
  logId?: string | null;
}

const SUPPORTED_MIRROR_TYPES: TeableSyncSourceType[] = ["tags", "sessions", "todos"];
const SUPPORTED_READ_ONLY_MODES: TeableMirrorReadOnlyMode[] = ["role_based", "matrix_based", "unknown"];

export class TeableMirrorSyncService {
  private readonly taskManager?: TaskManager;
  private readonly teableGlobalBindingService?: TeableGlobalBindingService;
  private readonly teableCredentialService?: TeableCredentialService;
  private readonly teableWorkbenchSyncConfigService?: TeableWorkbenchSyncConfigService;
  private readonly affairsTagService?: AffairsTagService;
  private readonly affairsLightweightSessionService?: AffairsLightweightSessionService;
  private readonly butlerInboxItemRepository?: Pick<ButlerInboxItemRepository, "list">;
  private readonly butlerProjectRepository?: Pick<ButlerProjectRepository, "list">;
  private readonly butlerFollowUpTaskRepository?: Pick<ButlerFollowUpTaskRepository, "list">;
  private readonly workspaceRepository?: Pick<WorkspaceRepository, "list" | "findById">;
  private readonly teableFieldMappingService?: Pick<TeableFieldMappingService, "resolveMapping" | "applyMapping">;
  private readonly syncLogRepository?: UserTeableSyncLogRepository;

  constructor(
    private readonly mirrorTableBindingRepository: UserTeableMirrorTableBindingRepository,
    private readonly mirrorRecordMappingRepository: UserTeableMirrorRecordMappingRepository,
    extra1?: unknown,
    extra2?: unknown,
    extra3?: unknown,
    extra4?: unknown,
    extra5?: unknown,
    extra6?: unknown,
    extra7?: unknown,
    extra8?: unknown,
    extra9?: unknown,
    extra10?: unknown,
    extra11?: unknown,
    extra12?: unknown
  ) {
    if (isTaskManagerLike(extra1)) {
      this.taskManager = extra1 as TaskManager;
      this.teableGlobalBindingService = extra2 as TeableGlobalBindingService | undefined;
      this.teableCredentialService = extra3 as TeableCredentialService | undefined;
      this.teableWorkbenchSyncConfigService = extra4 as TeableWorkbenchSyncConfigService | undefined;
      this.affairsTagService = extra5 as AffairsTagService | undefined;
      this.affairsLightweightSessionService = extra6 as AffairsLightweightSessionService | undefined;
      this.butlerInboxItemRepository = extra7 as Pick<ButlerInboxItemRepository, "list"> | undefined;
      this.butlerProjectRepository = extra8 as Pick<ButlerProjectRepository, "list"> | undefined;
      this.butlerFollowUpTaskRepository = extra9 as Pick<ButlerFollowUpTaskRepository, "list"> | undefined;
      this.workspaceRepository = extra10 as Pick<WorkspaceRepository, "list" | "findById"> | undefined;
      this.teableFieldMappingService = extra11 as Pick<TeableFieldMappingService, "resolveMapping" | "applyMapping"> | undefined;
      this.syncLogRepository = extra12 as UserTeableSyncLogRepository | undefined;
    } else {
      this.taskManager = undefined;
      this.teableGlobalBindingService = extra1 as TeableGlobalBindingService | undefined;
      this.teableCredentialService = extra2 as TeableCredentialService | undefined;
      this.teableWorkbenchSyncConfigService = extra3 as TeableWorkbenchSyncConfigService | undefined;
      this.affairsTagService = extra4 as AffairsTagService | undefined;
      this.affairsLightweightSessionService = extra5 as AffairsLightweightSessionService | undefined;
      this.butlerInboxItemRepository = extra6 as Pick<ButlerInboxItemRepository, "list"> | undefined;
      this.butlerProjectRepository = extra7 as Pick<ButlerProjectRepository, "list"> | undefined;
      this.butlerFollowUpTaskRepository = extra8 as Pick<ButlerFollowUpTaskRepository, "list"> | undefined;
      this.workspaceRepository = extra9 as Pick<WorkspaceRepository, "list" | "findById"> | undefined;
      this.teableFieldMappingService = extra10 as Pick<TeableFieldMappingService, "resolveMapping" | "applyMapping"> | undefined;
      this.syncLogRepository = extra11 as UserTeableSyncLogRepository | undefined;
    }
    this.registerBackgroundTasks();
  }

  listMirrorTableBindings(userId: string): TeableMirrorTableBindingDto[] {
    return this.mirrorTableBindingRepository.listByUserId(userId).map(mapBindingRecordToDto);
  }

  saveMirrorTableBinding(userId: string, input: SaveTeableMirrorTableBindingInput): TeableMirrorTableBindingDto {
    const mirrorType = normalizeMirrorType(input.mirrorType);
    const tableId = normalizeRequiredText(input.tableId, "tableId", "镜像表 tableId 不能为空");
    const tableName = normalizeRequiredText(input.tableName, "tableName", "镜像表 tableName 不能为空");
    const readOnlyMode = normalizeReadOnlyMode(input.readOnlyMode ?? "unknown");
    const current = this.mirrorTableBindingRepository.findByUserIdAndMirrorType(userId, mirrorType);
    const updatedAt = nowIso();
    const record: UserTeableMirrorTableBindingRecord = {
      bindingId: current?.bindingId ?? `teable-mirror-binding-${mirrorType}-${randomUUID()}`,
      userId,
      mirrorType,
      tableId,
      tableName,
      readOnlyMode,
      lastSyncedAt: normalizeOptionalText(input.lastSyncedAt),
      createdAt: current?.createdAt ?? updatedAt,
      updatedAt
    };
    return mapBindingRecordToDto(this.mirrorTableBindingRepository.upsert(record));
  }

  listMirrorRecordMappings(userId: string, mirrorType: TeableSyncSourceType): TeableMirrorRecordMappingDto[] {
    return this.mirrorRecordMappingRepository.listByUserIdAndMirrorType(userId, normalizeMirrorType(mirrorType)).map(mapRecordMappingToDto);
  }

  saveMirrorRecordMapping(userId: string, input: SaveTeableMirrorRecordMappingInput): TeableMirrorRecordMappingDto {
    const mirrorType = normalizeMirrorType(input.mirrorType);
    const localId = normalizeRequiredText(input.localId, "localId", "localId 不能为空");
    const teableRecordId = normalizeRequiredText(input.teableRecordId, "teableRecordId", "teableRecordId 不能为空");
    const fingerprint = normalizeRequiredText(input.fingerprint, "fingerprint", "fingerprint 不能为空");
    const current = this.mirrorRecordMappingRepository.findByUserIdAndMirrorTypeAndLocalId(userId, mirrorType, localId);
    const updatedAt = nowIso();
    const record: UserTeableMirrorRecordMappingRecord = {
      mappingId: current?.mappingId ?? `teable-mirror-record-${mirrorType}-${randomUUID()}`,
      userId,
      mirrorType,
      localId,
      teableRecordId,
      fingerprint,
      lastSyncedAt: normalizeRequiredText(input.lastSyncedAt ?? updatedAt, "lastSyncedAt", "lastSyncedAt 不能为空"),
      deletedAt: normalizeOptionalText(input.deletedAt),
      createdAt: current?.createdAt ?? updatedAt,
      updatedAt
    };
    return mapRecordMappingToDto(this.mirrorRecordMappingRepository.upsert(record));
  }

  requestMirrorSync(userId: string, input: RequestTeableMirrorSyncInput): TeableMirrorSyncTaskRequestDto {
    return this.enqueueMirrorSync(userId, {
      mirrorTypes: input.mirrorTypes,
      triggerType: "manual",
      reason: "manual_request",
      source: "teable.mirror_sync.request"
    });
  }

  requestLocalChangeMirrorSync(userId: string, input: RequestTeableLocalChangeMirrorSyncInput): TeableMirrorSyncTaskRequestDto | null {
    if (!this.teableGlobalBindingService || !this.teableWorkbenchSyncConfigService) {
      return null;
    }
    const binding = this.teableGlobalBindingService.getGlobalBinding(userId);
    if (!binding?.enabled || binding.mirrorMode !== "event_driven") {
      return null;
    }
    const requestedMirrorTypes = normalizeRequestedMirrorTypes(input.mirrorTypes);
    const enabledMirrorTypes = this.teableWorkbenchSyncConfigService.getConfigs(userId)
      .filter((item) => item.enabled && requestedMirrorTypes.includes(item.sourceType))
      .map((item) => item.sourceType);
    if (enabledMirrorTypes.length === 0) {
      return null;
    }
    return this.enqueueMirrorSync(userId, {
      mirrorTypes: enabledMirrorTypes,
      triggerType: "local_change",
      reason: input.reason,
      source: "teable.mirror_sync.local_change"
    });
  }

  listSyncLogs(userId: string, input: {
    limit?: number;
    triggerType?: TeableSyncLogTriggerType;
    state?: TeableSyncLogState;
  } = {}): TeableSyncLogDto[] {
    return this.syncLogRepository?.listByUserId(userId, input).map(mapSyncLogRecordToDto) ?? [];
  }

  private enqueueMirrorSync(userId: string, input: {
    mirrorTypes?: TeableSyncSourceType[];
    triggerType: TeableSyncLogTriggerType;
    reason?: string | null;
    source: string;
  }): TeableMirrorSyncTaskRequestDto {
    this.ensureTaskManager();
    const mirrorTypes = normalizeRequestedMirrorTypes(input.mirrorTypes);
    const createdAt = nowIso();
    const pendingLog = this.createSyncLog(userId, {
      triggerType: input.triggerType,
      sourceTypes: mirrorTypes,
      state: "queued",
      summary: input.triggerType === "local_change" ? "本地数据变化，已准备同步到 Teable" : "Teable 镜像同步任务已入队",
      reason: input.reason ?? null,
      createdAt
    });
    const handle = this.taskManager!.enqueue<RunTeableMirrorSyncTaskInput, TeableMirrorSyncResult>(
      HOST_TASK_TYPES.teableMirrorSync,
      {
        key: buildMirrorSyncTaskKey(userId),
        source: input.source,
        input: {
          userId,
          mirrorTypes,
          triggerType: input.triggerType,
          reason: input.reason ?? null,
          logId: pendingLog?.logId ?? null
        }
      }
    );
    if (pendingLog) {
      this.updateSyncLog(userId, pendingLog.logId, {
        taskId: handle.taskId,
        state: handle.deduped ? "running" : "queued",
        summary: handle.deduped ? "已合并到正在运行的 Teable 同步任务" : pendingLog.summary,
        startedAt: handle.deduped ? nowIso() : null
      });
      if (handle.deduped) {
        void handle.promise
          .then((result) => {
            this.updateSyncLog(userId, pendingLog.logId, {
              state: result.state,
              summary: result.summary,
              counts: result.counts,
              errorDetail: result.failedMirrorTypes.length > 0
                ? result.failedMirrorTypes.map((item) => `${resolveMirrorTypeLabel(item.mirrorType)}：${item.detail}`).join("\n")
                : null,
              finishedAt: nowIso()
            });
          })
          .catch((error) => {
            this.updateSyncLog(userId, pendingLog.logId, {
              state: "failed",
              summary: "Teable 镜像同步失败",
              errorDetail: error instanceof Error ? error.message : String(error),
              finishedAt: nowIso()
            });
          });
      }
    }
    void handle.promise.catch(() => undefined);
    return {
      taskId: handle.taskId,
      deduped: handle.deduped,
      taskType: "mirror_sync",
      state: "queued",
      summary: handle.deduped ? "Teable 镜像同步任务已在队列中" : "Teable 镜像同步任务已入队",
      updatedAt: nowIso()
    };
  }

  getMirrorSyncTaskSnapshot(
    userId: string,
    _workspaceIdsOrWorkspaceId?: string[] | string,
    _workspaceId?: string
  ): TeableSyncTaskSnapshotDto | null {
    this.ensureTaskManager();
    const snapshot = this.taskManager!.peek<TeableMirrorSyncResult>(
      HOST_TASK_TYPES.teableMirrorSync,
      buildMirrorSyncTaskKey(userId)
    );
    return mapTaskSnapshotToDto(snapshot);
  }

  getOverview(
    userId: string,
    workspaceIdsOrWorkspaceId?: string[] | string,
    workspaceId?: string
  ): TeableOverviewDto {
    if (!this.teableGlobalBindingService || !this.teableWorkbenchSyncConfigService) {
      throw new AppError({
        statusCode: 500,
        errorCode: "TEABLE_OVERVIEW_DEPENDENCY_MISSING",
        detail: "Teable 总览依赖没有完整注入"
      });
    }
    return {
      binding: this.teableGlobalBindingService.getOverview(userId),
      syncConfigs: this.teableWorkbenchSyncConfigService.getConfigs(userId),
      mirrorBindings: this.listMirrorTableBindings(userId),
      latestMirrorSyncTask: this.getMirrorSyncTaskSnapshot(userId, workspaceIdsOrWorkspaceId, workspaceId)
    };
  }

  async runMirrorSync(userId: string, input: RunTeableMirrorSyncInput): Promise<TeableMirrorSyncResult> {
    this.ensureSyncDependencies();
    const binding = this.teableGlobalBindingService!.getGlobalBinding(userId);
    if (!binding || !binding.enabled) {
      throw new AppError({
        statusCode: 400,
        errorCode: "TEABLE_BINDING_REQUIRED",
        detail: "当前事务工作台还没有可用的 Teable 绑定"
      });
    }
    const token = this.teableCredentialService!.loadToken(userId, binding.authRef);
    if (!token) {
      throw new AppError({
        statusCode: 400,
        errorCode: "TEABLE_AUTH_REQUIRED",
        detail: "当前 Teable 认证引用没有可用 token"
      });
    }

    const client = new TeableApiClient(binding.baseUrl, token);
    const allConfigs = this.teableWorkbenchSyncConfigService!.getConfigs(userId);
    const requestedMirrorTypes = normalizeRequestedMirrorTypes(input.mirrorTypes);
    const configs = allConfigs.filter((item) => item.enabled && requestedMirrorTypes.includes(item.sourceType));
    if (configs.length === 0) {
      return {
        state: "succeeded",
        summary: "当前没有启用的镜像配置需要同步",
        syncedMirrorTypes: [],
        failedMirrorTypes: [],
        counts: buildEmptyCounts()
      };
    }

    const result: TeableMirrorSyncResult = {
      state: "succeeded",
      summary: "Teable 镜像同步完成",
      syncedMirrorTypes: [],
      failedMirrorTypes: [],
      counts: buildEmptyCounts()
    };

    for (const config of configs) {
      try {
        const sourceRecords = await this.readMirrorSourceRecords(userId, config);
        const tableBinding = await this.ensureMirrorTable(client, userId, binding.baseId, config);
        const mapping = this.resolveFieldMapping(userId, config.configId, config.sourceType, config.targetTableId ?? tableBinding.tableId);
        const counts = await this.syncMirrorRecords(client, userId, config.sourceType, tableBinding.tableId, sourceRecords, mapping);
        result.counts[config.sourceType] = counts;
        result.syncedMirrorTypes.push(config.sourceType);
      } catch (error) {
        result.failedMirrorTypes.push({
          mirrorType: config.sourceType,
          detail: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (result.failedMirrorTypes.length > 0 && result.syncedMirrorTypes.length > 0) {
      result.state = "partial_failed";
      result.summary = "Teable 镜像同步部分成功，部分失败";
    } else if (result.failedMirrorTypes.length > 0) {
      result.state = "failed";
      result.summary = "Teable 镜像同步失败";
    }

    return result;
  }

  private async ensureMirrorTable(
    client: TeableApiClient,
    userId: string,
    baseId: string,
    config: TeableWorkbenchSyncConfigDto
  ): Promise<TeableMirrorTableBindingDto> {
    const mirrorType = config.sourceType;
    const targetTableId = config.targetTableId?.trim() ?? "";
    if (!targetTableId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "TEABLE_TARGET_TABLE_REQUIRED",
        detail: `${resolveMirrorTypeLabel(mirrorType)} 镜像还没有指定目标表，请先到设置里绑定目标表`
      });
    }
    const existingBinding = this.mirrorTableBindingRepository.findByUserIdAndMirrorType(userId, mirrorType);
    if (existingBinding?.tableId === targetTableId) {
      return mapBindingRecordToDto(existingBinding);
    }
    const table = await this.findExistingTable(client, baseId, targetTableId);
    if (!table) {
      throw new AppError({
        statusCode: 400,
        errorCode: "TEABLE_TARGET_TABLE_NOT_FOUND",
        detail: `${resolveMirrorTypeLabel(mirrorType)} 镜像指定的目标表不存在，请先检查 Teable 连接和表 ID`
      });
    }
    return this.saveMirrorTableBinding(userId, {
      mirrorType,
      tableId: table.id,
      tableName: table.name,
      readOnlyMode: existingBinding?.readOnlyMode ?? "unknown",
      lastSyncedAt: existingBinding?.lastSyncedAt ?? null
    });
  }

  private async syncMirrorRecords(
    client: TeableApiClient,
    userId: string,
    mirrorType: TeableSyncSourceType,
    tableId: string,
    sourceRecords: MirrorSourceRecord[],
    mapping: TeableFieldMappingDto
  ): Promise<{ created: number; updated: number; deleted: number; skipped: number }> {
    const currentMappings = this.mirrorRecordMappingRepository.listByUserIdAndMirrorType(userId, mirrorType);
    const mappingByLocalId = new Map(currentMappings.map((item) => [item.localId, item] as const));
    const sourceByLocalId = new Map(sourceRecords.map((item) => [item.localId, item] as const));
    const createdPayload: Array<{ fields: Record<string, unknown> }> = [];
    const createdLocalIds: string[] = [];
    const updatedPayload: Array<{ id: string; fields: Record<string, unknown> }> = [];
    const deletedRecordIds: string[] = [];
    let skipped = 0;

    for (const source of sourceRecords) {
      const existing = mappingByLocalId.get(source.localId);
      const fields = this.teableFieldMappingService!.applyMapping(mapping, source.payload);
      if (Object.keys(fields).length === 0) {
        skipped += 1;
        continue;
      }
      if (!existing) {
        createdPayload.push({ fields });
        createdLocalIds.push(source.localId);
        continue;
      }
      if (existing.fingerprint === source.fingerprint && !existing.deletedAt) {
        skipped += 1;
        continue;
      }
      updatedPayload.push({ id: existing.teableRecordId, fields });
    }

    for (const existing of currentMappings) {
      if (!sourceByLocalId.has(existing.localId) && !existing.deletedAt) {
        deletedRecordIds.push(existing.teableRecordId);
      }
    }

    let created = 0;
    let updated = 0;
    let deleted = 0;
    const syncedAt = nowIso();

    if (createdPayload.length > 0) {
      const createdResponse = await client.createRecords(tableId, {
        fieldKeyType: "id",
        records: createdPayload
      });
      created = createdResponse.records.length;
      createdResponse.records.forEach((record, index) => {
        const localId = createdLocalIds[index];
        const source = localId ? sourceByLocalId.get(localId) : null;
        if (!localId || !source) {
          return;
        }
        this.saveMirrorRecordMapping(userId, {
          mirrorType,
          localId,
          teableRecordId: record.id,
          fingerprint: source.fingerprint,
          lastSyncedAt: syncedAt,
          deletedAt: null
        });
      });
    }

    if (updatedPayload.length > 0) {
      await client.updateRecords(tableId, {
        fieldKeyType: "id",
        records: updatedPayload
      });
      updated = updatedPayload.length;
      for (const item of updatedPayload) {
        const localEntry = currentMappings.find((entry) => entry.teableRecordId === item.id);
        const source = localEntry ? sourceByLocalId.get(localEntry.localId) : null;
        if (!localEntry || !source) {
          continue;
        }
        this.saveMirrorRecordMapping(userId, {
          mirrorType,
          localId: localEntry.localId,
          teableRecordId: localEntry.teableRecordId,
          fingerprint: source.fingerprint,
          lastSyncedAt: syncedAt,
          deletedAt: null
        });
      }
    }

    if (deletedRecordIds.length > 0) {
      await client.deleteRecords(tableId, deletedRecordIds);
      deleted = deletedRecordIds.length;
      for (const mappingRecord of currentMappings) {
        if (!deletedRecordIds.includes(mappingRecord.teableRecordId)) {
          continue;
        }
        this.saveMirrorRecordMapping(userId, {
          mirrorType,
          localId: mappingRecord.localId,
          teableRecordId: mappingRecord.teableRecordId,
          fingerprint: mappingRecord.fingerprint,
          lastSyncedAt: syncedAt,
          deletedAt: syncedAt
        });
      }
    }

    const currentBinding = this.mirrorTableBindingRepository.findByUserIdAndMirrorType(userId, mirrorType);
    this.saveMirrorTableBinding(userId, {
      mirrorType,
      tableId,
      tableName: currentBinding?.tableName ?? getDefaultMirrorTableName(mirrorType),
      readOnlyMode: currentBinding?.readOnlyMode ?? "unknown",
      lastSyncedAt: syncedAt
    });

    return { created, updated, deleted, skipped };
  }

  private async readMirrorSourceRecords(
    userId: string,
    config: TeableWorkbenchSyncConfigDto
  ): Promise<MirrorSourceRecord[]> {
    switch (config.sourceType) {
      case "tags":
        return this.readTagMirrorSourceRecords(userId, config);
      case "sessions":
        return this.readSessionMirrorSourceRecords(userId, config);
      case "todos":
        return this.readTodoMirrorSourceRecords(config);
      default:
        return [];
    }
  }

  private readTagMirrorSourceRecords(userId: string, config: TeableWorkbenchSyncConfigDto): MirrorSourceRecord[] {
    const rootTagIds = Array.isArray((config.scope as { rootTagIds?: string[] }).rootTagIds)
      ? (config.scope as { rootTagIds: string[] }).rootTagIds
      : [];
    if (rootTagIds.length === 0) {
      return [];
    }
    const tagList = this.affairsTagService!.listGlobalTags(userId, { includeDisabled: true });
    const roots = tagList.items.filter((item) => rootTagIds.includes(item.id));
    if (roots.length === 0) {
      return [];
    }
    return tagList.items
      .filter((item) => roots.some((root) => item.id === root.id || item.path === root.path || item.path.startsWith(`${root.path}/`)))
      .map((item) => {
        const payload = {
          tag_id: item.id,
          path: item.path,
          name: item.name,
          parent_id: item.parentId,
          parent_path: item.parentPath,
          root_type: item.rootType,
          status: item.status,
          description: item.description ?? "",
          document_count: item.documentCount,
          updated_at: item.updatedAt
        };
        return {
          localId: item.id,
          payload,
          fingerprint: JSON.stringify(payload)
        } satisfies MirrorSourceRecord;
      });
  }

  private async readSessionMirrorSourceRecords(userId: string, config: TeableWorkbenchSyncConfigDto): Promise<MirrorSourceRecord[]> {
    const workspaces = resolveScopedWorkspaces(this.workspaceRepository!, config.scope);
    const groups = await Promise.all(workspaces.map(async (workspace) => ({
      workspace,
      sessions: await this.affairsLightweightSessionService!.listSessions(workspace.id, userId)
    })));
    return groups.flatMap(({ workspace, sessions }) => sessions.map((item) => {
      const payload = {
        workspace_id: workspace.id,
        workspace_name: workspace.name,
        session_id: item.sessionId,
        title: item.title,
        provider: item.provider,
        message_count: item.messageCount,
        last_message_at: item.lastMessageAt ?? null,
        running_state: item.runningState ?? null,
        activity_state: item.activityState,
        updated_at: item.updatedAt
      };
      return {
        localId: buildScopedLocalId(workspace.id, item.sessionId),
        payload,
        fingerprint: JSON.stringify(payload)
      } satisfies MirrorSourceRecord;
    }));
  }

  private readTodoMirrorSourceRecords(config: TeableWorkbenchSyncConfigDto): MirrorSourceRecord[] {
    const workspaces = resolveScopedWorkspaces(this.workspaceRepository!, config.scope);
    const workspaceById = new Map(workspaces.map((item) => [item.id, item] as const));
    const selectedWorkspaceIds = new Set(workspaces.map((item) => item.id));
    const projects = this.butlerProjectRepository!.list().filter((item) => selectedWorkspaceIds.has(item.workspaceId));
    const projectById = new Map(projects.map((item) => [item.id, item] as const));
    const scope = config.scope as { includeWorkspaceTodos?: boolean; includeAffairsTodos?: boolean };
    const records: MirrorSourceRecord[] = [];

    if (scope.includeWorkspaceTodos !== false) {
      const items = this.butlerInboxItemRepository!.list({}).filter((item) => projectById.has(item.projectId));
      for (const item of items) {
        const project = projectById.get(item.projectId)!;
        const workspace = workspaceById.get(project.workspaceId) ?? null;
        const payload = {
          workspace_id: workspace?.id ?? null,
          workspace_name: workspace?.name ?? null,
          todo_id: item.id,
          title: item.title,
          content: item.content,
          source_type: "workspace",
          item_type: item.itemType,
          priority: item.priority,
          status: item.status,
          project_id: item.projectId,
          updated_at: item.updatedAt
        };
        records.push({
          localId: `workspace:${item.id}`,
          payload,
          fingerprint: JSON.stringify(payload)
        });
      }
    }

    if (scope.includeAffairsTodos !== false) {
      const items = this.butlerFollowUpTaskRepository!.list({}).filter((item) => projectById.has(item.projectId));
      for (const item of items) {
        const project = projectById.get(item.projectId)!;
        const workspace = workspaceById.get(project.workspaceId) ?? null;
        const payload = {
          workspace_id: workspace?.id ?? null,
          workspace_name: workspace?.name ?? null,
          todo_id: item.id,
          title: item.objective,
          content: item.completionCriteria,
          source_type: "affairs",
          item_type: "follow_up",
          priority: null,
          status: item.status,
          project_id: item.projectId,
          updated_at: item.updatedAt
        };
        records.push({
          localId: `affairs:${item.id}`,
          payload,
          fingerprint: JSON.stringify(payload)
        });
      }
    }

    return records;
  }

  private resolveFieldMapping(
    userId: string,
    configId: string,
    sourceType: TeableSyncSourceType,
    targetTableId: string
  ): TeableFieldMappingDto {
    const mapping = this.teableFieldMappingService!.resolveMapping(userId, configId);
    if (!mapping) {
      throw new AppError({
        statusCode: 400,
        errorCode: "TEABLE_FIELD_MAPPING_REQUIRED",
        detail: `${resolveMirrorTypeLabel(sourceType)} 镜像还没有配置字段映射`
      });
    }
    if (mapping.targetTableId !== targetTableId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "TEABLE_FIELD_MAPPING_TARGET_MISMATCH",
        detail: `${resolveMirrorTypeLabel(sourceType)} 镜像的字段映射和目标表不一致，请重新保存映射`
      });
    }
    return mapping;
  }

  private ensureSyncDependencies(): void {
    if (!this.teableGlobalBindingService || !this.teableCredentialService || !this.teableWorkbenchSyncConfigService || !this.affairsTagService || !this.affairsLightweightSessionService || !this.butlerInboxItemRepository || !this.butlerProjectRepository || !this.butlerFollowUpTaskRepository || !this.workspaceRepository || !this.teableFieldMappingService) {
      throw new AppError({
        statusCode: 500,
        errorCode: "TEABLE_SYNC_DEPENDENCY_MISSING",
        detail: "Teable 镜像同步依赖没有完整注入"
      });
    }
  }

  private ensureTaskManager(): void {
    if (!this.taskManager) {
      throw new AppError({
        statusCode: 500,
        errorCode: "TEABLE_TASK_MANAGER_MISSING",
        detail: "Teable 镜像同步任务管理器没有注入"
      });
    }
  }

  private registerBackgroundTasks(): void {
    if (!this.taskManager || this.taskManager.has(HOST_TASK_TYPES.teableMirrorSync)) {
      return;
    }
    this.taskManager.register<RunTeableMirrorSyncTaskInput, TeableMirrorSyncResult>({
      taskType: HOST_TASK_TYPES.teableMirrorSync,
      executionLane: "host_background",
      timeoutMs: 60_000,
      concurrency: 1,
      run: async (input, context) => {
        const mirrorTypes = normalizeRequestedMirrorTypes(input.mirrorTypes);
        if (input.logId) {
          this.updateSyncLog(input.userId, input.logId, {
            taskId: context.taskId,
            state: "running",
            summary: "Teable 镜像同步进行中",
            startedAt: nowIso()
          });
        }
        context.reportProgress({
          phase: "queued",
          label: "开始准备 Teable 镜像同步",
          detail: `本次共 ${mirrorTypes.length} 类：${mirrorTypes.map(resolveMirrorTypeLabel).join("、")}`,
          percent: 0
        });
        let result: TeableMirrorSyncResult;
        try {
          result = await this.runMirrorSync(input.userId, { mirrorTypes });
        } catch (error) {
          if (input.logId) {
            this.updateSyncLog(input.userId, input.logId, {
              state: "failed",
              summary: "Teable 镜像同步失败",
              errorDetail: error instanceof Error ? error.message : String(error),
              finishedAt: nowIso()
            });
          }
          throw error;
        }
        if (input.logId) {
          this.updateSyncLog(input.userId, input.logId, {
            state: result.state,
            summary: result.summary,
            counts: result.counts,
            errorDetail: result.failedMirrorTypes.length > 0
              ? result.failedMirrorTypes.map((item) => `${resolveMirrorTypeLabel(item.mirrorType)}：${item.detail}`).join("\n")
              : null,
            finishedAt: nowIso()
          });
        }
        context.reportProgress({
          phase: result.state,
          label: result.summary,
          detail: buildMirrorSyncProgressDetail(result),
          current: mirrorTypes.length,
          total: mirrorTypes.length,
          percent: 100
        });
        return result;
      }
    });
  }

  private async findExistingTable(
    client: TeableApiClient,
    baseId: string,
    targetTableId: string
  ): Promise<{ id: string; name: string } | null> {
    const tables = await client.listTables(baseId);
    return tables.find((item) => item.id === targetTableId) ?? null;
  }

  private createSyncLog(userId: string, input: {
    triggerType: TeableSyncLogTriggerType;
    sourceTypes: TeableSyncSourceType[];
    state: TeableSyncLogState;
    summary: string;
    reason: string | null;
    createdAt: string;
  }): UserTeableSyncLogRecord | null {
    if (!this.syncLogRepository) {
      return null;
    }
    const record: UserTeableSyncLogRecord = {
      logId: `teable-sync-log-${randomUUID()}`,
      userId,
      triggerType: input.triggerType,
      sourceTypesJson: JSON.stringify(input.sourceTypes),
      taskId: null,
      state: input.state,
      summary: input.summary,
      countsJson: "{}",
      errorDetail: null,
      reason: input.reason,
      startedAt: null,
      finishedAt: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt
    };
    return this.syncLogRepository.create(record);
  }

  private updateSyncLog(userId: string, logId: string, patch: {
    taskId?: string | null;
    state?: TeableSyncLogState;
    summary?: string;
    counts?: Partial<TeableMirrorSyncResult["counts"]>;
    errorDetail?: string | null;
    reason?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  }): void {
    if (!this.syncLogRepository) {
      return;
    }
    const current = this.syncLogRepository.findById(userId, logId);
    if (!current) {
      return;
    }
    this.syncLogRepository.update({
      ...current,
      taskId: patch.taskId !== undefined ? patch.taskId : current.taskId,
      state: patch.state ?? current.state,
      summary: patch.summary ?? current.summary,
      countsJson: patch.counts ? JSON.stringify(patch.counts) : current.countsJson,
      errorDetail: patch.errorDetail !== undefined ? patch.errorDetail : current.errorDetail,
      reason: patch.reason !== undefined ? patch.reason : current.reason,
      startedAt: patch.startedAt !== undefined ? patch.startedAt : current.startedAt,
      finishedAt: patch.finishedAt !== undefined ? patch.finishedAt : current.finishedAt,
      updatedAt: nowIso()
    });
  }
}

function buildEmptyCounts(): TeableMirrorSyncResult["counts"] {
  return {
    tags: { created: 0, updated: 0, deleted: 0, skipped: 0 },
    sessions: { created: 0, updated: 0, deleted: 0, skipped: 0 },
    todos: { created: 0, updated: 0, deleted: 0, skipped: 0 }
  };
}

function resolveScopedWorkspaces(
  workspaceRepository: Pick<WorkspaceRepository, "list" | "findById">,
  scope: unknown
): Workspace[] {
  const all = workspaceRepository.list();
  const normalizedScope = scope && typeof scope === "object" && !Array.isArray(scope)
    ? scope as Record<string, unknown>
    : {};
  const mode = normalizedScope.mode === "selected_workspaces" ? "selected_workspaces" : "all_workspaces";
  if (mode !== "selected_workspaces") {
    return all;
  }
  const ids = Array.isArray(normalizedScope.workspaceIds)
    ? Array.from(new Set(normalizedScope.workspaceIds.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)))
    : [];
  return ids.map((id) => workspaceRepository.findById(id)).filter((item): item is Workspace => Boolean(item));
}

function getDefaultMirrorTableName(mirrorType: TeableSyncSourceType): string {
  switch (mirrorType) {
    case "tags":
      return "cn_tags";
    case "sessions":
      return "cn_sessions";
    case "todos":
      return "cn_todos";
    default:
      return `cn_${mirrorType}`;
  }
}

function mapBindingRecordToDto(record: UserTeableMirrorTableBindingRecord): TeableMirrorTableBindingDto {
  return {
    mirrorType: record.mirrorType,
    tableId: record.tableId,
    tableName: record.tableName,
    readOnlyMode: record.readOnlyMode,
    lastSyncedAt: record.lastSyncedAt,
    updatedAt: record.updatedAt
  };
}

function mapRecordMappingToDto(record: UserTeableMirrorRecordMappingRecord): TeableMirrorRecordMappingDto {
  return {
    mirrorType: record.mirrorType,
    localId: record.localId,
    teableRecordId: record.teableRecordId,
    fingerprint: record.fingerprint,
    lastSyncedAt: record.lastSyncedAt,
    deletedAt: record.deletedAt,
    updatedAt: record.updatedAt
  };
}

function mapSyncLogRecordToDto(record: UserTeableSyncLogRecord): TeableSyncLogDto {
  return {
    logId: record.logId,
    triggerType: record.triggerType,
    sourceTypes: parseMirrorTypesJson(record.sourceTypesJson),
    taskId: record.taskId,
    state: record.state,
    summary: record.summary,
    counts: parseCountsJson(record.countsJson),
    errorDetail: record.errorDetail,
    reason: record.reason,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function parseMirrorTypesJson(raw: string): TeableSyncSourceType[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? normalizeRequestedMirrorTypes(parsed as TeableSyncSourceType[]) : [];
  } catch {
    return [];
  }
}

function parseCountsJson(raw: string): TeableSyncLogDto["counts"] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as TeableSyncLogDto["counts"]
      : {};
  } catch {
    return {};
  }
}

function normalizeMirrorType(value: string): TeableSyncSourceType {
  if ((SUPPORTED_MIRROR_TYPES as string[]).includes(value)) {
    return value as TeableSyncSourceType;
  }
  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    field: "mirrorType",
    detail: "mirrorType 只允许 tags、sessions、todos"
  });
}

function normalizeReadOnlyMode(value: string): TeableMirrorReadOnlyMode {
  if ((SUPPORTED_READ_ONLY_MODES as string[]).includes(value)) {
    return value as TeableMirrorReadOnlyMode;
  }
  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    field: "readOnlyMode",
    detail: "readOnlyMode 只允许 role_based、matrix_based、unknown"
  });
}

function normalizeRequiredText(value: string, field: string, detail: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new AppError({ statusCode: 400, errorCode: "INVALID_INPUT", field, detail });
  }
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
}

function normalizeRequestedMirrorTypes(values: TeableSyncSourceType[] | undefined): TeableSyncSourceType[] {
  const target = values?.length ? values : SUPPORTED_MIRROR_TYPES;
  return Array.from(new Set(target.map(normalizeMirrorType)));
}

function buildMirrorSyncTaskKey(userId: string): string {
  return `${userId}:global`;
}

function buildScopedLocalId(scopeId: string, localId: string): string {
  return `${scopeId}:${localId}`;
}

function mapTaskSnapshotToDto(snapshot: TaskSnapshot<TeableMirrorSyncResult> | null): TeableSyncTaskSnapshotDto | null {
  if (!snapshot) {
    return null;
  }
  return {
    taskId: snapshot.taskId,
    taskType: "mirror_sync",
    state: resolveMirrorSyncTaskState(snapshot),
    summary: resolveMirrorSyncTaskSummary(snapshot),
    lastError: snapshot.status === "failed" || snapshot.status === "queue_timeout" || snapshot.status === "timeout"
      ? snapshot.errorMessage ?? snapshot.errorDetail ?? "Teable 镜像同步失败"
      : null,
    updatedAt: new Date(snapshot.finishedAt ?? snapshot.progress?.updatedAt ?? snapshot.startedAt ?? snapshot.enqueuedAt).toISOString(),
    startedAt: snapshot.startedAt === null ? null : new Date(snapshot.startedAt).toISOString(),
    finishedAt: snapshot.finishedAt === null ? null : new Date(snapshot.finishedAt).toISOString(),
    progress: snapshot.progress ? {
      phase: snapshot.progress.phase,
      label: snapshot.progress.label ?? null,
      detail: snapshot.progress.detail ?? null,
      current: snapshot.progress.current ?? null,
      total: snapshot.progress.total ?? null,
      percent: snapshot.progress.percent ?? null,
      updatedAt: new Date(snapshot.progress.updatedAt).toISOString()
    } : null,
    result: snapshot.result ?? null
  };
}

function resolveMirrorSyncTaskState(snapshot: TaskSnapshot<TeableMirrorSyncResult>): TeableSyncTaskSnapshotDto["state"] {
  if (snapshot.status === "succeeded") {
    return snapshot.result?.state ?? "succeeded";
  }
  if (snapshot.status === "failed" || snapshot.status === "timeout" || snapshot.status === "queue_timeout" || snapshot.status === "cancelled") {
    return "failed";
  }
  if (snapshot.status === "running") {
    return "running";
  }
  return "queued";
}

function resolveMirrorSyncTaskSummary(snapshot: TaskSnapshot<TeableMirrorSyncResult>): string | null {
  if (snapshot.result?.summary?.trim()) {
    return snapshot.result.summary.trim();
  }
  if (snapshot.progress?.label?.trim()) {
    return snapshot.progress.label.trim();
  }
  if (snapshot.status === "queued") {
    return "Teable 镜像同步任务排队中";
  }
  if (snapshot.status === "running") {
    return "Teable 镜像同步进行中";
  }
  if (snapshot.status === "failed" || snapshot.status === "timeout" || snapshot.status === "queue_timeout" || snapshot.status === "cancelled") {
    return snapshot.errorMessage ?? "Teable 镜像同步失败";
  }
  return null;
}

function resolveMirrorTypeLabel(mirrorType: TeableSyncSourceType): string {
  switch (mirrorType) {
    case "tags":
      return "标签";
    case "sessions":
      return "会话";
    case "todos":
      return "代办";
    default:
      return mirrorType;
  }
}

function buildMirrorSyncProgressDetail(result: TeableMirrorSyncResult): string {
  const succeeded = result.syncedMirrorTypes.map(resolveMirrorTypeLabel);
  const failed = result.failedMirrorTypes.map((item) => resolveMirrorTypeLabel(item.mirrorType));
  const segments: string[] = [];
  if (succeeded.length > 0) {
    segments.push(`已完成：${succeeded.join("、")}`);
  }
  if (failed.length > 0) {
    segments.push(`失败：${failed.join("、")}`);
  }
  return segments.join("；");
}

function isTaskManagerLike(value: unknown): value is TaskManager {
  return typeof value === "object" && value !== null && typeof (value as TaskManager).has === "function" && typeof (value as TaskManager).enqueue === "function";
}
