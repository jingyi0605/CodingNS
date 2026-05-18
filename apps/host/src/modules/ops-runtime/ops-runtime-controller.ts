import type { FastifyReply, FastifyRequest } from "fastify";

import type { OfficeRiskLevel, OpsTargetKind, OpsTargetStatus } from "../../types/domain.js";
import { requireUserId } from "../preferences/common.js";
import { OpsRuntimeService } from "./ops-runtime-service.js";

interface OpsTargetListQuery {
  workspaceId?: string;
  kind?: OpsTargetKind;
  status?: OpsTargetStatus;
}

interface OpsTargetParams {
  targetId: string;
}

interface OpsTaskParams {
  taskId: string;
}

interface CreateOpsTargetBody {
  workspaceId?: string | null;
  kind?: OpsTargetKind;
  displayName?: string;
  environment?: string | null;
  config?: unknown;
  credentialRef?: string | null;
  status?: OpsTargetStatus;
}

interface CreateOpsSshTaskBody {
  title?: string;
  targetId?: string;
  riskLevel?: OfficeRiskLevel;
  input?: unknown;
}

interface CreateOpsBrowserTaskBody {
  title?: string;
  targetId?: string;
  profileId?: string;
  executionBackend?: "playwright" | "opencli_bridge";
  riskLevel?: OfficeRiskLevel;
  input?: unknown;
}

export class OpsRuntimeController {
  constructor(private readonly opsRuntimeService: OpsRuntimeService) {}

  readonly listTargets = async (
    request: FastifyRequest<{ Querystring: OpsTargetListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: this.opsRuntimeService.listTargets({
        userId: requireUserId(request),
        workspaceId: normalizeOptionalText(request.query.workspaceId),
        kind: request.query.kind,
        status: request.query.status
      })
    });
  };

  readonly createTarget = async (
    request: FastifyRequest<{ Body: CreateOpsTargetBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.opsRuntimeService.createTarget({
        userId: requireUserId(request),
        workspaceId: request.body.workspaceId,
        kind: request.body.kind ?? "ssh_host",
        displayName: request.body.displayName?.trim() ?? "",
        environment: request.body.environment,
        config: request.body.config ?? {},
        credentialRef: request.body.credentialRef
      })
    );
  };

  readonly getTarget = async (
    request: FastifyRequest<{ Params: OpsTargetParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.opsRuntimeService.getTarget(request.params.targetId, requireUserId(request)));
  };

  readonly updateTarget = async (
    request: FastifyRequest<{ Params: OpsTargetParams; Body: CreateOpsTargetBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.opsRuntimeService.updateTarget({
        userId: requireUserId(request),
        targetId: request.params.targetId,
        workspaceId: request.body.workspaceId,
        kind: request.body.kind,
        displayName: request.body.displayName,
        environment: request.body.environment,
        config: request.body.config,
        credentialRef: request.body.credentialRef,
        status: request.body.status
      })
    );
  };

  readonly createSshTask = async (
    request: FastifyRequest<{ Body: CreateOpsSshTaskBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.opsRuntimeService.createSshTask({
        userId: requireUserId(request),
        title: request.body.title?.trim() ?? "SSH 运维任务",
        targetId: request.body.targetId?.trim() ?? "",
        riskLevel: request.body.riskLevel,
        input: request.body.input
      })
    );
  };

  readonly createBrowserTask = async (
    request: FastifyRequest<{ Body: CreateOpsBrowserTaskBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.opsRuntimeService.createBrowserTask({
        userId: requireUserId(request),
        title: request.body.title?.trim() ?? "浏览器运维任务",
        targetId: request.body.targetId?.trim() ?? "",
        profileId: request.body.profileId?.trim() ?? null,
        executionBackend: request.body.executionBackend,
        riskLevel: request.body.riskLevel,
        input: request.body.input
      })
    );
  };

  readonly executeSshTask = async (
    request: FastifyRequest<{ Params: OpsTaskParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.opsRuntimeService.executeSshTask(
        request.params.taskId,
        requireUserId(request)
      )
    );
  };

  readonly getSshExecution = async (
    request: FastifyRequest<{ Params: OpsTaskParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      task: this.opsRuntimeService.getSshExecutionSnapshot(
        request.params.taskId,
        requireUserId(request)
      )
    });
  };

  readonly cancelSshExecution = async (
    request: FastifyRequest<{ Params: OpsTaskParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.opsRuntimeService.cancelSshExecution(
        request.params.taskId,
        requireUserId(request)
      )
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
