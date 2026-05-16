import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { BrowserProfileService } from "../browser-runtime/browser-profile-service.js";
import type { OfficeService } from "../office/office-service.js";
import type { OfficeTaskRepository } from "../../storage/repositories/office-task-repository.js";
import type { OpsTargetRepository, OpsTargetListFilters } from "../../storage/repositories/ops-target-repository.js";
import type { OpsTarget, OpsTargetKind, OpsTargetStatus } from "../../types/domain.js";
import type { TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES, type TaskSnapshot } from "../tasks/task-types.js";
import type { SshOpsExecutor } from "./ssh-ops-executor.js";

export interface CreateOpsTargetInput {
  userId: string;
  workspaceId?: string | null;
  kind: OpsTargetKind;
  displayName: string;
  environment?: string | null;
  config: unknown;
  credentialRef?: string | null;
}

export interface UpdateOpsTargetInput {
  userId: string;
  targetId: string;
  workspaceId?: string | null;
  kind?: OpsTargetKind;
  displayName?: string | null;
  environment?: string | null;
  config?: unknown;
  credentialRef?: string | null;
  status?: OpsTargetStatus;
}

export interface CreateOpsSshTaskInput {
  userId: string;
  title: string;
  targetId: string;
  riskLevel?: "low" | "medium" | "high";
  input?: unknown;
}

export interface CreateOpsBrowserTaskInput {
  userId: string;
  title: string;
  targetId: string;
  profileId: string;
  riskLevel?: "low" | "medium" | "high";
  input?: unknown;
}

export class OpsRuntimeService {
  constructor(
    private readonly opsTargetRepository: OpsTargetRepository,
    private readonly browserProfileService: BrowserProfileService,
    private readonly officeService: OfficeService,
    private readonly officeTaskRepository: OfficeTaskRepository,
    private readonly sshOpsExecutor: SshOpsExecutor,
    private readonly taskManager: TaskManager
  ) {
    this.registerBackgroundTask();
  }

  listTargets(filters: OpsTargetListFilters): OpsTarget[] {
    return this.opsTargetRepository.list(filters);
  }

  getTarget(targetId: string, userId: string): OpsTarget {
    return this.requireOwnedTarget(targetId, userId);
  }

  createTarget(input: CreateOpsTargetInput): OpsTarget {
    const displayName = input.displayName.trim();
    if (!displayName) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_OPS_TARGET_DISPLAY_NAME",
        detail: "运维目标名称不能为空",
        field: "displayName"
      });
    }

    validateOpsTargetConfig(input.kind, input.config);

    const timestamp = nowIso();
    return this.opsTargetRepository.create({
      id: createId(),
      userId: input.userId,
      workspaceId: normalizeNullableText(input.workspaceId),
      kind: input.kind,
      displayName,
      environment: normalizeNullableText(input.environment),
      configJson: JSON.stringify(input.config),
      credentialRef: normalizeNullableText(input.credentialRef),
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  updateTarget(input: UpdateOpsTargetInput): OpsTarget {
    const current = this.requireOwnedTarget(input.targetId, input.userId);
    const nextKind = input.kind ?? current.kind;
    const nextDisplayName = input.displayName === undefined
      ? current.displayName
      : typeof input.displayName === "string"
        ? input.displayName.trim()
        : "";

    if (!nextDisplayName) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_OPS_TARGET_DISPLAY_NAME",
        detail: "运维目标名称不能为空",
        field: "displayName"
      });
    }

    const nextConfig = input.config === undefined
      ? JSON.parse(current.configJson) as unknown
      : input.config;
    validateOpsTargetConfig(nextKind, nextConfig);

    return this.opsTargetRepository.update({
      ...current,
      workspaceId: input.workspaceId === undefined
        ? current.workspaceId
        : normalizeNullableText(input.workspaceId),
      kind: nextKind,
      displayName: nextDisplayName,
      environment: input.environment === undefined
        ? current.environment
        : normalizeNullableText(input.environment),
      configJson: JSON.stringify(nextConfig),
      credentialRef: input.credentialRef === undefined
        ? current.credentialRef
        : normalizeNullableText(input.credentialRef),
      status: input.status ?? current.status,
      updatedAt: nowIso()
    });
  }

  createSshTask(input: CreateOpsSshTaskInput) {
    const target = this.requireActiveTarget(input.targetId, input.userId, "ssh_host");

    return this.officeService.createTask({
      userId: input.userId,
      workspaceId: target.workspaceId,
      taskType: "ops",
      title: input.title.trim() || "SSH 运维任务",
      connectorId: "ops.ssh",
      targetRefKind: "ops_target",
      targetRefId: target.id,
      input: {
        targetId: target.id,
        targetKind: target.kind,
        config: JSON.parse(target.configJson),
        commandSpec: input.input ?? {}
      },
      riskLevel: input.riskLevel ?? "medium"
    });
  }

  createBrowserTask(input: CreateOpsBrowserTaskInput) {
    const target = this.requireActiveTarget(input.targetId, input.userId, "web_console");
    const profile = this.browserProfileService.getProfile(input.profileId, input.userId);
    if (profile.status !== "active") {
      throw new AppError({
        statusCode: 409,
        errorCode: "BROWSER_PROFILE_NOT_ACTIVE",
        detail: "当前浏览器 Profile 不可用"
      });
    }

    if (target.workspaceId !== profile.workspaceId) {
      throw new AppError({
        statusCode: 409,
        errorCode: "OPS_TARGET_BROWSER_PROFILE_WORKSPACE_MISMATCH",
        detail: "浏览器运维目标和浏览器 Profile 不属于同一工作区"
      });
    }

    return this.officeService.createTask({
      userId: input.userId,
      workspaceId: profile.workspaceId,
      taskType: "ops",
      title: input.title.trim() || "浏览器运维任务",
      connectorId: "ops.browser_console",
      targetRefKind: "ops_target",
      targetRefId: target.id,
      input: {
        targetId: target.id,
        targetKind: target.kind,
        profileId: profile.id,
        engine: profile.engine,
        mode: profile.mode,
        config: JSON.parse(target.configJson),
        actions: input.input ?? {}
      },
      riskLevel: input.riskLevel ?? "high"
    });
  }

  async executeSshTask(taskId: string, userId: string) {
    const task = this.requireExecutableSshTask(taskId, userId);
    const handle = this.taskManager.enqueue<{ taskId: string; userId: string }, Awaited<ReturnType<SshOpsExecutor["execute"]>>>(
      HOST_TASK_TYPES.officeOpsSshTaskExecute,
      {
        key: task.id,
        source: "office.ops_ssh_task.execute",
        input: {
          taskId: task.id,
          userId
        }
      }
    );

    void handle.promise.catch(() => undefined);
    return {
      taskId: task.id,
      executionTaskId: handle.taskId,
      deduped: handle.deduped
    };
  }

  getSshExecutionSnapshot(taskId: string, userId: string): TaskSnapshot | null {
    this.requireOwnedOpsTask(taskId, userId, "ops.ssh");
    return this.taskManager.peek(HOST_TASK_TYPES.officeOpsSshTaskExecute, taskId.trim());
  }

  cancelSshExecution(taskId: string, userId: string): { taskId: string; cancelled: boolean } {
    const task = this.requireOwnedOpsTask(taskId, userId, "ops.ssh");
    this.taskManager.cancel(
      HOST_TASK_TYPES.officeOpsSshTaskExecute,
      task.id,
      "office_ops_ssh_task_cancelled"
    );
    return {
      taskId: task.id,
      cancelled: true
    };
  }

  private registerBackgroundTask(): void {
    if (this.taskManager.has(HOST_TASK_TYPES.officeOpsSshTaskExecute)) {
      return;
    }

    this.taskManager.register<{ taskId: string; userId: string }, Awaited<ReturnType<SshOpsExecutor["execute"]>>>({
      taskType: HOST_TASK_TYPES.officeOpsSshTaskExecute,
      executionLane: "host_background",
      timeoutMs: 300_000,
      concurrency: 1,
      run: async (input, context) => {
        const task = this.requireExecutableSshTask(input.taskId, input.userId);
        return await this.sshOpsExecutor.execute({
          task,
          runContext: context
        });
      }
    });
  }

  private requireOwnedTarget(targetId: string, userId: string): OpsTarget {
    const target = this.opsTargetRepository.findById(targetId.trim());
    if (!target || target.userId !== userId) {
      throw new AppError({
        statusCode: 404,
        errorCode: "OPS_TARGET_NOT_FOUND",
        detail: "未找到对应运维目标"
      });
    }

    return target;
  }

  private requireActiveTarget(targetId: string, userId: string, expectedKind: OpsTargetKind): OpsTarget {
    const target = this.requireOwnedTarget(targetId, userId);
    if (target.kind !== expectedKind) {
      throw new AppError({
        statusCode: 409,
        errorCode: "OPS_TARGET_KIND_MISMATCH",
        detail: "运维目标类型不匹配"
      });
    }

    if (target.status !== "active") {
      throw new AppError({
        statusCode: 409,
        errorCode: "OPS_TARGET_NOT_ACTIVE",
        detail: "当前运维目标不可用"
      });
    }

    return target;
  }

  private requireExecutableSshTask(taskId: string, userId: string) {
    const task = this.requireOwnedOpsTask(taskId, userId, "ops.ssh");
    if (task.status !== "ready" && task.status !== "failed") {
      throw new AppError({
        statusCode: 409,
        errorCode: "OPS_SSH_TASK_EXECUTION_NOT_ALLOWED",
        detail: "当前 SSH 运维任务状态不允许执行"
      });
    }

    return task;
  }

  private requireOwnedOpsTask(taskId: string, userId: string, connectorId?: string) {
    const task = this.officeTaskRepository.findById(taskId.trim());
    if (!task || task.userId !== userId || task.taskType !== "ops") {
      throw new AppError({
        statusCode: 404,
        errorCode: "OPS_TASK_NOT_FOUND",
        detail: "未找到对应运维任务"
      });
    }

    if (connectorId && task.connectorId !== connectorId) {
      throw new AppError({
        statusCode: 404,
        errorCode: "OPS_TASK_NOT_FOUND",
        detail: "未找到对应运维任务"
      });
    }

    return task;
  }
}

function validateOpsTargetConfig(kind: OpsTargetKind, config: unknown): void {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_OPS_TARGET_CONFIG",
      detail: "运维目标配置不合法",
      field: "config"
    });
  }

  const record = config as Record<string, unknown>;
  if (kind === "ssh_host") {
    if (typeof record.host !== "string" || !record.host.trim()) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_OPS_TARGET_CONFIG",
        detail: "SSH 目标必须提供 host",
        field: "config.host"
      });
    }

    if (typeof record.username !== "string" || !record.username.trim()) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_OPS_TARGET_CONFIG",
        detail: "SSH 目标必须提供 username",
        field: "config.username"
      });
    }

    return;
  }

  if (typeof record.baseUrl !== "string" || !record.baseUrl.trim()) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_OPS_TARGET_CONFIG",
      detail: "控制台目标必须提供 baseUrl",
      field: "config.baseUrl"
    });
  }
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
