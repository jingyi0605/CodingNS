import type { FastifyReply, FastifyRequest } from "fastify";

import type { HostConfig } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { logPermissionDebug } from "../../shared/utils/permission-debug-log.js";
import type { SessionHistoryService } from "../sessions/session-history-service.js";
import type { SessionLiveRuntimeService } from "../sessions/session-live-runtime-service.js";
import type { SessionProviderConfigMode } from "../../types/domain.js";
import type { SessionProviderConfigService } from "../sessions/session-provider-config-service.js";
import type { ProviderCatalogService } from "./provider-catalog-service.js";
import {
  isClaudeCompatibleProvider,
  type ClaudeCompatibleProviderId
} from "../sessions/claude-compatible-provider-registry.js";

interface ProviderParams {
  provider: string;
}

interface ProviderCapabilitiesQuery {
  workspaceId?: string;
  providerConfigMode?: SessionProviderConfigMode;
  providerPresetId?: string | null;
}

interface UpdateProviderCatalogBody {
  enabled?: boolean;
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
    private readonly sessionProviderConfigService: SessionProviderConfigService,
    private readonly providerCatalogService: ProviderCatalogService,
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

    const baseCapabilities = await this.sessionHistoryService.getProviderCapabilities(
      provider,
      request.query.workspaceId?.trim() || null
    );

    const resolvedCapabilities = this.sessionProviderConfigService.resolveCapabilities({
        provider: baseCapabilities.provider,
        baseCapabilities,
        providerConfigMode: normalizeProviderConfigMode(request.query.providerConfigMode),
        providerPresetId: request.query.providerPresetId?.trim() || null
      });

    reply.send(this.providerCatalogService.applyProviderEnabledState(resolvedCapabilities));
  };

  readonly listCatalog = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    reply.send({
      items: this.providerCatalogService.listCatalog()
    });
  };

  readonly updateCatalogEntry = async (
    request: FastifyRequest<{ Params: ProviderParams; Body: UpdateProviderCatalogBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    if (typeof request.body?.enabled !== "boolean") {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "enabled 必须是 boolean",
        field: "enabled"
      });
    }

    reply.send({
      item: this.providerCatalogService.updateProviderEnabled(
        request.params.provider,
        request.body.enabled
      )
    });
  };

  readonly getClaudeHookBridgeConfig = async (
    request: FastifyRequest<{ Params: ProviderParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    if (!request.auth?.user.userId) {
      throw new AppError({
        statusCode: 401,
        errorCode: "UNAUTHORIZED",
        detail: "当前请求缺少有效登录态"
      });
    }

    const provider = requireClaudeCompatibleProvider(request.params.provider);
    reply.send(this.sessionLiveRuntimeService.getClaudeHookBridgeConfig(provider));
  };

  readonly receiveClaudeHookEvent = async (
    request: FastifyRequest<{ Params: ProviderParams; Body: ClaudeHookEventBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const provider = requireClaudeCompatibleProvider(request.params.provider);
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
        detail: "兼容 CLI hook token 无效"
      });
    }

    logPermissionDebug("claude_hook_bridge.receive", {
      provider,
      hookEventName: request.body?.hook_event_name ?? null,
      sessionId: request.body?.session_id ?? null,
      cwd: request.body?.cwd ?? null,
      transcriptPath: request.body?.transcript_path ?? null,
      toolName: request.body?.tool_name ?? null,
      notificationType: request.body?.notification_type ?? null
    });
    const result = await this.sessionLiveRuntimeService.ingestClaudeHookEvent(provider, request.body ?? {});
    logPermissionDebug("claude_hook_bridge.respond", {
      provider,
      hookEventName: request.body?.hook_event_name ?? null,
      accepted: result.accepted,
      ignored: result.ignored,
      sessionId: result.sessionId,
      hasBridgeResponse: result.bridgeResponse !== null
    });
    reply.send(result.bridgeResponse ?? {});
  };
}

function normalizeProviderConfigMode(
  value: string | undefined
): SessionProviderConfigMode | undefined {
  if (!value) {
    return undefined;
  }

  if (value === "global-default" || value === "cc-switch-preset") {
    return value;
  }

  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    detail: "providerConfigMode 非法",
    field: "providerConfigMode"
  });
}

function requireClaudeCompatibleProvider(value: string): ClaudeCompatibleProviderId {
  const normalized = value.trim();

  if (isClaudeCompatibleProvider(normalized)) {
    return normalized;
  }

  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    detail: "hook bridge 只支持 claude-code 或 legna-code",
    field: "provider"
  });
}
