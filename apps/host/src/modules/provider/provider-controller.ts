import type { FastifyReply, FastifyRequest } from "fastify";

import type { HostConfig } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { logPermissionDebug } from "../../shared/utils/permission-debug-log.js";
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
  tool_name?: string;
  notification_type?: string;
}

export class ProviderController {
  constructor(
    private readonly sessionHistoryService: SessionHistoryService,
    private readonly sessionLiveRuntimeService: Pick<
      SessionLiveRuntimeService,
      "getClaudeHookBridgeConfig" | "ingestClaudeHookEvent"
    >,
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
      logPermissionDebug("claude_hook_bridge.reject_unauthorized", {
        providedTokenLength: normalizedToken.length
      });
      throw new AppError({
        statusCode: 401,
        errorCode: "UNAUTHORIZED",
        detail: "Claude hook token 无效"
      });
    }

    logPermissionDebug("claude_hook_bridge.receive", {
      hookEventName: request.body?.hook_event_name ?? null,
      sessionId: request.body?.session_id ?? null,
      cwd: request.body?.cwd ?? null,
      transcriptPath: request.body?.transcript_path ?? null,
      toolName: request.body?.tool_name ?? null,
      notificationType: request.body?.notification_type ?? null
    });
    const result = await this.sessionLiveRuntimeService.ingestClaudeHookEvent(request.body ?? {});
    logPermissionDebug("claude_hook_bridge.respond", {
      hookEventName: request.body?.hook_event_name ?? null,
      accepted: result.accepted,
      ignored: result.ignored,
      sessionId: result.sessionId,
      hasBridgeResponse: result.bridgeResponse !== null
    });
    reply.send(result.bridgeResponse ?? {});
  };
}
