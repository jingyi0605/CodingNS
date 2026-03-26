import type { FastifyReply, FastifyRequest } from "fastify";

import type { HostConfig } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { SessionHistoryService } from "../sessions/session-history-service.js";
import type { SessionLiveRuntimeService } from "../sessions/session-live-runtime-service.js";

interface ProviderParams {
  provider: string;
}

interface ProviderCapabilitiesQuery {
  workspaceId?: string;
}

interface ClaudeHookEventBody {
  hook_event_name?: string;
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  reason?: string;
  stop_hook_active?: boolean;
}

export class ProviderController {
  constructor(
    private readonly sessionHistoryService: SessionHistoryService,
    private readonly sessionLiveRuntimeService: SessionLiveRuntimeService,
    private readonly config: HostConfig
  ) {}

  readonly getCapabilities = async (
    request: FastifyRequest<{ Params: ProviderParams; Querystring: ProviderCapabilitiesQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const provider = request.params.provider.trim();

    if (!provider) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "provider 不能为空",
        field: "provider"
      });
    }

    reply.send(
      await this.sessionHistoryService.getProviderCapabilities(
        provider,
        request.query.workspaceId?.trim() || null
      )
    );
  };

  readonly getClaudeHookBridgeConfig = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    if (!request.auth?.user.userId) {
      throw new AppError({
        statusCode: 401,
        errorCode: "UNAUTHORIZED",
        detail: "当前请求缺少有效登录态"
      });
    }

    reply.send(this.sessionLiveRuntimeService.getClaudeHookBridgeConfig());
  };

  readonly receiveClaudeHookEvent = async (
    request: FastifyRequest<{ Body: ClaudeHookEventBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const providedToken = request.headers["x-codingns-hook-token"];
    const normalizedToken =
      typeof providedToken === "string"
        ? providedToken.trim()
        : Array.isArray(providedToken)
          ? providedToken[0]?.trim() ?? ""
          : "";

    if (normalizedToken !== this.config.claudeHookBridgeToken) {
      throw new AppError({
        statusCode: 401,
        errorCode: "UNAUTHORIZED",
        detail: "Claude hook token 无效"
      });
    }

    reply.send(await this.sessionLiveRuntimeService.ingestClaudeHookEvent(request.body ?? {}));
  };
}
