import type { FastifyReply, FastifyRequest } from "fastify";

import type { OfficeRiskLevel, OpsTargetKind, OpsTargetStatus } from "../../types/domain.js";
import { requireUserId } from "../preferences/common.js";
import { OpsRuntimeService } from "./ops-runtime-service.js";

interface OpsTargetListQuery {
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
        profileId: request.body.profileId?.trim() ?? "",
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
