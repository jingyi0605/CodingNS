import type { FastifyReply, FastifyRequest } from "fastify";

import type { OfficeConnectorKind, OfficeRiskLevel, OfficeTaskStatus, OfficeTaskType } from "../../types/domain.js";
import { requireUserId } from "../preferences/common.js";
import type { CreateOfficeTaskInput, ReplyOfficeApprovalInput } from "./office-service.js";
import { OfficeService } from "./office-service.js";

interface OfficeTaskListQuery {
  workspaceId?: string;
  taskType?: OfficeTaskType;
  status?: OfficeTaskStatus;
  riskLevel?: OfficeRiskLevel;
  limit?: string;
}

interface OfficeTaskParams {
  taskId: string;
}

interface OfficeApprovalParams {
  approvalId: string;
}

interface OfficeConnectorListQuery {
  kind?: OfficeConnectorKind;
}

export class OfficeController {
  constructor(private readonly officeService: OfficeService) {}

  readonly listTasks = async (
    request: FastifyRequest<{ Querystring: OfficeTaskListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const userId = requireUserId(request);
    const limit = request.query.limit ? Number.parseInt(request.query.limit, 10) : undefined;
    reply.send({
      items: this.officeService.listTasks({
        userId,
        workspaceId: normalizeOptionalText(request.query.workspaceId),
        taskType: request.query.taskType,
        status: request.query.status,
        riskLevel: request.query.riskLevel,
        limit: Number.isFinite(limit) ? limit : undefined
      })
    });
  };

  readonly createTask = async (
    request: FastifyRequest<{ Body: Omit<CreateOfficeTaskInput, "userId"> }>,
    reply: FastifyReply
  ): Promise<void> => {
    const userId = requireUserId(request);
    reply.send(
      this.officeService.createTask({
        ...request.body,
        userId
      })
    );
  };

  readonly getTask = async (
    request: FastifyRequest<{ Params: OfficeTaskParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.officeService.getTaskDetail(request.params.taskId, requireUserId(request)));
  };

  readonly cancelTask = async (
    request: FastifyRequest<{ Params: OfficeTaskParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.officeService.cancelTask(request.params.taskId, requireUserId(request)));
  };

  readonly retryTask = async (
    request: FastifyRequest<{ Params: OfficeTaskParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.officeService.retryTask(request.params.taskId, requireUserId(request)));
  };

  readonly listConnectors = async (
    request: FastifyRequest<{ Querystring: OfficeConnectorListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: this.officeService.listConnectors(request.query.kind)
    });
  };

  readonly replyApproval = async (
    request: FastifyRequest<{
      Params: OfficeApprovalParams;
      Body: Omit<ReplyOfficeApprovalInput, "approvalId" | "userId">;
    }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.officeService.replyApproval({
        approvalId: request.params.approvalId,
        userId: requireUserId(request),
        status: request.body.status,
        decisionNote: request.body.decisionNote
      })
    );
  };
}

function normalizeOptionalText(value: string | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
