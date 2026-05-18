import type { FastifyReply, FastifyRequest } from "fastify";

import type { BrowserEngine, BrowserProfileMode, BrowserProfileOwnershipScope, OfficeRiskLevel } from "../../types/domain.js";
import { requireUserId } from "../preferences/common.js";
import { BrowserRuntimeService } from "./browser-runtime-service.js";
import type { BrowserExecutionBackend, BrowserSessionRequirement } from "./browser-task-payload.js";

interface BrowserProfileListQuery {
  workspaceId?: string;
}

interface CreateBrowserProfileBody {
  workspaceId?: string | null;
  engine?: BrowserEngine;
  mode?: BrowserProfileMode;
  displayName?: string | null;
  ownershipScope?: BrowserProfileOwnershipScope;
  cdpEndpoint?: string | null;
}

interface UpdateBrowserProfileBody {
  ownershipScope?: BrowserProfileOwnershipScope;
}

interface CreateBrowserTaskBody {
  workspaceId?: string | null;
  title?: string;
  profileId?: string;
  riskLevel?: OfficeRiskLevel;
  executionBackend?: BrowserExecutionBackend;
  sessionRequirement?: BrowserSessionRequirement;
  input?: unknown;
}

interface BrowserTaskParams {
  taskId: string;
}

interface BrowserProfileParams {
  profileId: string;
}

export class BrowserRuntimeController {
  constructor(private readonly browserRuntimeService: BrowserRuntimeService) {}

  readonly listProfiles = async (
    request: FastifyRequest<{ Querystring: BrowserProfileListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: this.browserRuntimeService.listProfiles(
        requireUserId(request),
        normalizeOptionalText(request.query.workspaceId)
      )
    });
  };

  readonly createProfile = async (
    request: FastifyRequest<{ Body: CreateBrowserProfileBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.browserRuntimeService.createProfile({
        userId: requireUserId(request),
        workspaceId: normalizeOptionalText(request.body.workspaceId),
        engine: request.body.engine ?? "chrome",
        mode: request.body.mode,
        displayName: request.body.displayName,
        ownershipScope: request.body.ownershipScope,
        cdpEndpoint: request.body.cdpEndpoint
      })
    );
  };

  readonly createTask = async (
    request: FastifyRequest<{ Body: CreateBrowserTaskBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.browserRuntimeService.createBrowserTask({
        userId: requireUserId(request),
        workspaceId: normalizeOptionalText(request.body.workspaceId),
        title: request.body.title?.trim() || "浏览器任务",
        profileId: request.body.profileId?.trim() || "",
        riskLevel: request.body.riskLevel,
        executionBackend: request.body.executionBackend,
        sessionRequirement: request.body.sessionRequirement,
        input: request.body.input
      })
    );
  };

  readonly getProfile = async (
    request: FastifyRequest<{ Params: BrowserProfileParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.browserRuntimeService.getProfile(
        request.params.profileId,
        requireUserId(request)
      )
    );
  };

  readonly updateProfile = async (
    request: FastifyRequest<{ Params: BrowserProfileParams; Body: UpdateBrowserProfileBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.browserRuntimeService.updateProfile({
        userId: requireUserId(request),
        profileId: request.params.profileId,
        ownershipScope: request.body.ownershipScope
      })
    );
  };

  readonly deleteProfile = async (
    request: FastifyRequest<{ Params: BrowserProfileParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.browserRuntimeService.deleteProfile(
        request.params.profileId,
        requireUserId(request)
      )
    );
  };

  readonly attachCdp = async (
    request: FastifyRequest<{ Body: CreateBrowserProfileBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.browserRuntimeService.attachCdpProfile({
        userId: requireUserId(request),
        workspaceId: normalizeOptionalText(request.body.workspaceId),
        engine: request.body.engine ?? "chrome",
        mode: "cdp_attached",
        displayName: request.body.displayName,
        ownershipScope: request.body.ownershipScope,
        cdpEndpoint: request.body.cdpEndpoint
      })
    );
  };

  readonly executeTask = async (
    request: FastifyRequest<{ Params: BrowserTaskParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.browserRuntimeService.executeBrowserTask(
        request.params.taskId,
        requireUserId(request)
      )
    );
  };

  readonly getExecution = async (
    request: FastifyRequest<{ Params: BrowserTaskParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      task: this.browserRuntimeService.getExecutionSnapshot(
        request.params.taskId,
        requireUserId(request)
      )
    });
  };

  readonly getBridgeStatus = async (
    _request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.browserRuntimeService.getBridgeStatus());
  };

  readonly cancelExecution = async (
    request: FastifyRequest<{ Params: BrowserTaskParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.browserRuntimeService.cancelExecution(
        request.params.taskId,
        requireUserId(request)
      )
    );
  };
}

function normalizeOptionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
