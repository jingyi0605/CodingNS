import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import { requireUserId } from "../preferences/common.js";
import type { PluginRegistryService } from "./plugin-registry-service.js";
import type { PluginRuntimeService } from "./plugin-runtime-service.js";
import type { PluginStaticService } from "./plugin-static-service.js";

interface PluginParams {
  pluginId: string;
}

interface DisablePluginBody {
  reason?: string;
}

interface PluginActionParams extends PluginParams {
  actionId: string;
}

interface PluginActionBody {
  workspaceId?: string;
  input?: unknown;
}

interface PluginFrontendParams extends PluginParams {
  "*": string;
}

interface PluginDesktopActionBody {
  workspaceId?: string;
  path?: string;
}

export class PluginController {
  constructor(
    private readonly pluginRegistryService: PluginRegistryService,
    private readonly pluginRuntimeService: PluginRuntimeService,
    private readonly pluginStaticService: PluginStaticService
  ) {}

  readonly list = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    reply.send({
      items: this.pluginRegistryService.listPlugins()
    });
  };

  readonly get = async (
    request: FastifyRequest<{ Params: PluginParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    const detail = this.pluginRegistryService.getPlugin(request.params.pluginId);
    reply.send({
      ...detail,
      frontend: detail.manifest.frontend
        ? {
            basePath: this.pluginStaticService.buildFrontendBasePath(detail.definition.id),
            entryUrl: this.pluginStaticService.buildFrontendEntryUrl(detail.definition.id, detail.manifest)
          }
        : null
    });
  };

  readonly enable = async (
    request: FastifyRequest<{ Params: PluginParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.pluginRegistryService.enablePlugin(
        request.params.pluginId,
        requireUserId(request)
      )
    );
  };

  readonly disable = async (
    request: FastifyRequest<{ Params: PluginParams; Body: DisablePluginBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.pluginRegistryService.disablePlugin(
        request.params.pluginId,
        requireUserId(request),
        request.body?.reason
      )
    );
  };

  readonly callAction = async (
    request: FastifyRequest<{ Params: PluginActionParams; Body: PluginActionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.pluginRuntimeService.callAction({
        pluginId: request.params.pluginId,
        actionId: request.params.actionId,
        workspaceId: resolveWorkspaceId(request.body?.workspaceId, request.auth?.workspaceId),
        input: request.body?.input,
        triggerKind: request.auth?.callerKind === "workspace_session" ? "assistant" : "frontend",
        actorUserId: requireUserId(request)
      })
    );
  };

  readonly listRuns = async (
    request: FastifyRequest<{ Params: PluginParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: this.pluginRuntimeService.listRuns(request.params.pluginId)
    });
  };

  readonly desktopOpenFile = async (
    request: FastifyRequest<{ Params: PluginParams; Body: PluginDesktopActionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.pluginRuntimeService.prepareDesktopAction({
        pluginId: request.params.pluginId,
        workspaceId: resolveWorkspaceId(request.body?.workspaceId, request.auth?.workspaceId),
        requestedPath: requirePluginPath(request.body?.path),
        permission: "open_file",
        actorUserId: requireUserId(request)
      })
    );
  };

  readonly desktopRevealInFileManager = async (
    request: FastifyRequest<{ Params: PluginParams; Body: PluginDesktopActionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.pluginRuntimeService.prepareDesktopAction({
        pluginId: request.params.pluginId,
        workspaceId: resolveWorkspaceId(request.body?.workspaceId, request.auth?.workspaceId),
        requestedPath: requirePluginPath(request.body?.path),
        permission: "reveal_in_file_manager",
        actorUserId: requireUserId(request)
      })
    );
  };

  readonly publicFrontendAsset = async (
    request: FastifyRequest<{ Params: PluginFrontendParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    const requestedPath = request.params["*"] ?? "";
    return this.pluginStaticService.serveFrontendAsset(
      request.params.pluginId,
      requestedPath,
      reply
    );
  };

  readonly publicRuntimeSdk = async (
    _request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    return this.pluginStaticService.serveRuntimeSdk(reply);
  };
}

function resolveWorkspaceId(bodyWorkspaceId: string | null | undefined, authWorkspaceId: string | null | undefined): string {
  const normalizedAuthWorkspaceId = authWorkspaceId?.trim() ?? "";
  if (normalizedAuthWorkspaceId) {
    if (bodyWorkspaceId?.trim() && bodyWorkspaceId.trim() !== normalizedAuthWorkspaceId) {
      throw new AppError({
        statusCode: 403,
        errorCode: "PLUGIN_SCOPE_REJECTED",
        detail: "插件请求的 workspaceId 与当前受控工作区不一致"
      });
    }

    return normalizedAuthWorkspaceId;
  }

  const normalizedBodyWorkspaceId = bodyWorkspaceId?.trim() ?? "";
  if (!normalizedBodyWorkspaceId) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_WORKSPACE_CONTEXT_REQUIRED",
      detail: "插件运行必须绑定当前工作区"
    });
  }

  return normalizedBodyWorkspaceId;
}

function requirePluginPath(value: string | null | undefined): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_PATH_REQUIRED",
      detail: "插件桌面动作必须提供目标路径"
    });
  }

  return normalized;
}
