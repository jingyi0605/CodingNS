import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import { requireUserId } from "../preferences/common.js";
import type { PluginRegistryService } from "./plugin-registry-service.js";
import type { PluginRuntimeService } from "./plugin-runtime-service.js";
import type { PluginRuntimeSessionService } from "./plugin-runtime-session-service.js";
import type { PluginStaticService } from "./plugin-static-service.js";

interface PluginParams {
  pluginId: string;
}

interface DisablePluginBody {
  reason?: string;
}

interface PluginRuntimeSessionParams extends PluginParams {
  runtimeSessionId: string;
}

interface CreateRuntimeSessionBody {
  workspaceId?: string;
}

interface PluginActionParams extends PluginParams {
  actionId: string;
}

interface PluginActionBody {
  runtimeSessionId?: string;
  workspaceId?: string;
  input?: unknown;
}

interface PluginFrontendParams extends PluginParams {
  "*": string;
}

interface PluginDesktopActionBody {
  runtimeSessionId?: string;
  workspaceId?: string;
  path?: string;
}

export class PluginController {
  constructor(
    private readonly pluginRegistryService: PluginRegistryService,
    private readonly pluginRuntimeService: PluginRuntimeService,
    private readonly pluginStaticService: PluginStaticService,
    private readonly pluginRuntimeSessionService: PluginRuntimeSessionService
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

  readonly createRuntimeSession = async (
    request: FastifyRequest<{ Params: PluginParams; Body: CreateRuntimeSessionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const detail = this.pluginRegistryService.getPlugin(request.params.pluginId);
    const workspaceId = resolveWorkspaceId(
      request.body?.workspaceId,
      request.auth?.workspaceId
    );
    const session = this.pluginRuntimeSessionService.createSession({
      pluginId: request.params.pluginId,
      workspaceId,
      openedByUserId: requireUserId(request),
      source: request.auth?.callerKind === "workspace_session" ? "assistant" : "frontend"
    });

    reply.send({
      runtimeSessionId: session.id,
      session,
      frontend: detail.manifest.frontend
        ? {
            basePath: this.pluginStaticService.buildFrontendBasePath(detail.definition.id),
            entryUrl: this.pluginStaticService.buildFrontendEntryUrl(detail.definition.id, detail.manifest)
          }
        : null,
      context: {
        pluginId: detail.definition.id,
        workspaceId: session.workspaceId,
        runtimeSessionId: session.id,
        pluginName: detail.manifest.name,
        pluginVersion: detail.manifest.version,
        frontendEntryUrl: detail.manifest.frontend
          ? this.pluginStaticService.buildFrontendEntryUrl(detail.definition.id, detail.manifest)
          : null,
        hostOrigin: request.headers.origin ?? null
      }
    });
  };

  readonly closeRuntimeSession = async (
    request: FastifyRequest<{ Params: PluginRuntimeSessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    const session = this.pluginRuntimeSessionService.getSessionOrThrow(request.params.runtimeSessionId);
    if (session.pluginId !== request.params.pluginId) {
      throw new AppError({
        statusCode: 403,
        errorCode: "PLUGIN_SCOPE_REJECTED",
        detail: "运行实例与目标插件不一致"
      });
    }

    reply.send(this.pluginRuntimeSessionService.closeSession(session.id));
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
    const runtimeSessionId = requireRuntimeSessionId(request.body?.runtimeSessionId);
    const runtimeSession = this.pluginRuntimeSessionService.getActiveSessionForPluginOrThrow(
      request.params.pluginId,
      runtimeSessionId
    );
    assertNoMismatchedWorkspaceId(request.body?.workspaceId, runtimeSession.workspaceId);

    reply.send(
      await this.pluginRuntimeService.callAction({
        pluginId: request.params.pluginId,
        actionId: request.params.actionId,
        workspaceId: runtimeSession.workspaceId,
        runtimeSessionId,
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
    const runtimeSessionId = requireRuntimeSessionId(request.body?.runtimeSessionId);
    const runtimeSession = this.pluginRuntimeSessionService.getActiveSessionForPluginOrThrow(
      request.params.pluginId,
      runtimeSessionId
    );
    assertNoMismatchedWorkspaceId(request.body?.workspaceId, runtimeSession.workspaceId);

    reply.send(
      this.pluginRuntimeService.prepareDesktopAction({
        pluginId: request.params.pluginId,
        workspaceId: runtimeSession.workspaceId,
        runtimeSessionId,
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
    const runtimeSessionId = requireRuntimeSessionId(request.body?.runtimeSessionId);
    const runtimeSession = this.pluginRuntimeSessionService.getActiveSessionForPluginOrThrow(
      request.params.pluginId,
      runtimeSessionId
    );
    assertNoMismatchedWorkspaceId(request.body?.workspaceId, runtimeSession.workspaceId);

    reply.send(
      this.pluginRuntimeService.prepareDesktopAction({
        pluginId: request.params.pluginId,
        workspaceId: runtimeSession.workspaceId,
        runtimeSessionId,
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

function requireRuntimeSessionId(value: string | null | undefined): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_RUNTIME_SESSION_REQUIRED",
      detail: "插件运行必须提供 runtimeSessionId"
    });
  }

  return normalized;
}

function assertNoMismatchedWorkspaceId(bodyWorkspaceId: string | null | undefined, workspaceId: string): void {
  const normalizedBodyWorkspaceId = bodyWorkspaceId?.trim() ?? "";
  if (normalizedBodyWorkspaceId && normalizedBodyWorkspaceId !== workspaceId) {
    throw new AppError({
      statusCode: 403,
      errorCode: "PLUGIN_SCOPE_REJECTED",
      detail: "插件请求的 workspaceId 与当前运行实例不一致"
    });
  }
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
