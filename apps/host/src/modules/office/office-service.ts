import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { OfficeApprovalRepository } from "../../storage/repositories/office-approval-repository.js";
import type { OfficeArtifactRepository } from "../../storage/repositories/office-artifact-repository.js";
import type { OfficeAuditEventRepository } from "../../storage/repositories/office-audit-event-repository.js";
import type { OfficeConnectorRepository } from "../../storage/repositories/office-connector-repository.js";
import type { OfficeReceiptRepository } from "../../storage/repositories/office-receipt-repository.js";
import type { OfficeRollbackRecordRepository } from "../../storage/repositories/office-rollback-record-repository.js";
import type { OfficeTaskRepository, OfficeTaskListFilters } from "../../storage/repositories/office-task-repository.js";
import type { OfficeTaskStepRepository } from "../../storage/repositories/office-task-step-repository.js";
import type {
  OfficeApproval,
  OfficeArtifact,
  OfficeAuditEvent,
  OfficeConnector,
  OfficeReceipt,
  OfficeRiskLevel,
  OfficeTask,
  OfficeTaskStatus,
  OfficeTaskType
} from "../../types/domain.js";

export interface CreateOfficeTaskInput {
  userId: string;
  workspaceId?: string | null;
  taskType: OfficeTaskType;
  title: string;
  description?: string | null;
  connectorId: string;
  targetRefKind?: string | null;
  targetRefId?: string | null;
  input?: unknown;
  riskLevel?: OfficeRiskLevel;
  approvalPolicyId?: string | null;
  idempotencyKey?: string | null;
}

export interface ReplyOfficeApprovalInput {
  approvalId: string;
  userId: string;
  status: "approved" | "rejected";
  decisionNote?: string | null;
}

export interface OfficeTaskDetail {
  task: OfficeTask;
  steps: ReturnType<OfficeTaskStepRepository["listByTaskId"]>;
  artifacts: OfficeArtifact[];
  approvals: OfficeApproval[];
  receipts: OfficeReceipt[];
  audits: OfficeAuditEvent[];
}

export class OfficeService {
  constructor(
    private readonly taskRepository: OfficeTaskRepository,
    private readonly taskStepRepository: OfficeTaskStepRepository,
    private readonly artifactRepository: OfficeArtifactRepository,
    private readonly approvalRepository: OfficeApprovalRepository,
    private readonly receiptRepository: OfficeReceiptRepository,
    private readonly connectorRepository: OfficeConnectorRepository,
    private readonly auditEventRepository: OfficeAuditEventRepository,
    private readonly rollbackRecordRepository: OfficeRollbackRecordRepository
  ) {}

  listTasks(filters: OfficeTaskListFilters): OfficeTask[] {
    return this.taskRepository.list(filters);
  }

  getTaskDetail(taskId: string, userId: string): OfficeTaskDetail {
    const task = this.requireOwnedTask(taskId, userId);
    return {
      task,
      steps: this.taskStepRepository.listByTaskId(task.id),
      artifacts: this.artifactRepository.listByTaskId(task.id),
      approvals: this.approvalRepository.listByTaskId(task.id),
      receipts: this.receiptRepository.listByTaskId(task.id),
      audits: this.auditEventRepository.listByTaskId(task.id)
    };
  }

  createTask(input: CreateOfficeTaskInput): { task: OfficeTask; requiresApproval: boolean } {
    const connector = this.requireActiveConnector(input.connectorId);
    const title = input.title.trim();

    if (!title) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "任务标题不能为空",
        field: "title"
      });
    }

    const idempotencyKey = normalizeNullableText(input.idempotencyKey);
    if (idempotencyKey) {
      const existing = this.taskRepository.findActiveByIdempotencyKey(input.userId, idempotencyKey);
      if (existing) {
        return {
          task: existing,
          requiresApproval: existing.status === "pending_approval"
        };
      }
    }

    const timestamp = nowIso();
    const riskLevel = input.riskLevel ?? "low";
    const requiresApproval = riskLevel === "high";
    const task: OfficeTask = {
      id: createId(),
      userId: input.userId,
      workspaceId: input.workspaceId ?? null,
      taskType: input.taskType,
      title,
      description: normalizeNullableText(input.description),
      connectorId: connector.id,
      targetRefKind: normalizeNullableText(input.targetRefKind),
      targetRefId: normalizeNullableText(input.targetRefId),
      inputJson: JSON.stringify(input.input ?? {}),
      status: requiresApproval ? "pending_approval" : "ready",
      riskLevel,
      approvalPolicyId: normalizeNullableText(input.approvalPolicyId),
      currentStepId: null,
      idempotencyKey,
      startedAt: null,
      finishedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.taskRepository.create(task);
    this.auditEventRepository.create({
      id: createId(),
      taskId: task.id,
      stepId: null,
      eventKind: "task_created",
      actorKind: "user",
      actorId: input.userId,
      summary: `创建 ${task.taskType} 任务`,
      payloadJson: JSON.stringify({
        connectorKey: connector.connectorKey,
        riskLevel: task.riskLevel
      }),
      createdAt: timestamp
    });

    if (requiresApproval) {
      this.approvalRepository.create({
        id: createId(),
        taskId: task.id,
        stepId: null,
        policyId: task.approvalPolicyId ?? "default_high_risk",
        status: "pending",
        approverUserId: null,
        decisionNote: null,
        decidedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }

    return {
      task,
      requiresApproval
    };
  }

  cancelTask(taskId: string, userId: string): OfficeTask {
    const current = this.requireOwnedTask(taskId, userId);
    if (!isMutableTaskStatus(current.status)) {
      throw new AppError({
        statusCode: 409,
        errorCode: "OFFICE_TASK_CANCEL_NOT_ALLOWED",
        detail: "当前任务状态不允许取消"
      });
    }

    const next: OfficeTask = {
      ...current,
      status: "cancelled",
      finishedAt: current.finishedAt ?? nowIso(),
      updatedAt: nowIso()
    };
    this.taskRepository.update(next);
    this.auditEventRepository.create({
      id: createId(),
      taskId: next.id,
      stepId: null,
      eventKind: "task_cancelled",
      actorKind: "user",
      actorId: userId,
      summary: "用户取消任务",
      payloadJson: null,
      createdAt: next.updatedAt
    });
    return next;
  }

  retryTask(taskId: string, userId: string): OfficeTask {
    const current = this.requireOwnedTask(taskId, userId);
    if (current.status !== "failed" && current.status !== "cancelled") {
      throw new AppError({
        statusCode: 409,
        errorCode: "OFFICE_TASK_RETRY_NOT_ALLOWED",
        detail: "只有失败或已取消的任务允许重试"
      });
    }

    const nextStatus: OfficeTaskStatus = current.riskLevel === "high" ? "pending_approval" : "ready";
    const next: OfficeTask = {
      ...current,
      status: nextStatus,
      currentStepId: null,
      startedAt: null,
      finishedAt: null,
      updatedAt: nowIso()
    };
    this.taskRepository.update(next);
    this.auditEventRepository.create({
      id: createId(),
      taskId: next.id,
      stepId: null,
      eventKind: "task_updated",
      actorKind: "user",
      actorId: userId,
      summary: "用户重试任务",
      payloadJson: JSON.stringify({ nextStatus }),
      createdAt: next.updatedAt
    });
    return next;
  }

  listConnectors(kind?: OfficeConnector["kind"]): OfficeConnector[] {
    return this.connectorRepository.list(kind);
  }

  replyApproval(input: ReplyOfficeApprovalInput): OfficeApproval {
    const current = this.approvalRepository.findById(input.approvalId.trim());
    if (!current) {
      throw new AppError({
        statusCode: 404,
        errorCode: "OFFICE_APPROVAL_NOT_FOUND",
        detail: "未找到对应审批记录"
      });
    }

    if (current.status !== "pending") {
      throw new AppError({
        statusCode: 409,
        errorCode: "OFFICE_APPROVAL_ALREADY_DECIDED",
        detail: "该审批已经处理过"
      });
    }

    const timestamp = nowIso();
    const next: OfficeApproval = {
      ...current,
      status: input.status,
      approverUserId: input.userId,
      decisionNote: normalizeNullableText(input.decisionNote),
      decidedAt: timestamp,
      updatedAt: timestamp
    };
    this.approvalRepository.update(next);

    const task = this.taskRepository.findById(current.taskId);
    if (task) {
      const taskNext: OfficeTask = {
        ...task,
        status: input.status === "approved" ? "ready" : "cancelled",
        finishedAt: input.status === "approved" ? task.finishedAt : timestamp,
        updatedAt: timestamp
      };
      this.taskRepository.update(taskNext);
      this.auditEventRepository.create({
        id: createId(),
        taskId: task.id,
        stepId: current.stepId,
        eventKind: input.status === "approved" ? "task_approved" : "task_rejected",
        actorKind: "user",
        actorId: input.userId,
        summary: input.status === "approved" ? "审批通过" : "审批拒绝",
        payloadJson: next.decisionNote ? JSON.stringify({ decisionNote: next.decisionNote }) : null,
        createdAt: timestamp
      });
    }

    return next;
  }

  private requireOwnedTask(taskId: string, userId: string): OfficeTask {
    const task = this.taskRepository.findById(taskId.trim());
    if (!task || task.userId !== userId) {
      throw new AppError({
        statusCode: 404,
        errorCode: "OFFICE_TASK_NOT_FOUND",
        detail: "未找到对应办公任务"
      });
    }

    return task;
  }

  private requireActiveConnector(connectorIdOrKey: string): OfficeConnector {
    const connectorRef = connectorIdOrKey.trim();
    const connector =
      this.connectorRepository.findById(connectorRef)
      ?? this.connectorRepository.findByKey(connectorRef);
    if (!connector) {
      throw new AppError({
        statusCode: 404,
        errorCode: "OFFICE_CONNECTOR_NOT_FOUND",
        detail: "未找到对应连接器",
        field: "connectorId"
      });
    }

    if (connector.status !== "active") {
      throw new AppError({
        statusCode: 409,
        errorCode: "OFFICE_CONNECTOR_DISABLED",
        detail: "当前连接器不可用",
        field: "connectorId"
      });
    }

    return connector;
  }
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isMutableTaskStatus(status: OfficeTaskStatus): boolean {
  return ["draft", "pending_approval", "ready", "running", "paused", "waiting_external"].includes(status);
}
