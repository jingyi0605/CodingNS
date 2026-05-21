import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { PluginRuntimeSessionRepository } from "../../storage/repositories/plugin-runtime-session-repository.js";
import type { PluginRuntimeSession, PluginRuntimeSessionSource } from "../../types/domain.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import type { PluginRegistryService } from "./plugin-registry-service.js";

export interface CreatePluginRuntimeSessionInput {
  pluginId: string;
  workspaceId: string;
  openedByUserId: string;
  source: PluginRuntimeSessionSource;
}

export class PluginRuntimeSessionService {
  constructor(
    private readonly pluginRegistryService: PluginRegistryService,
    private readonly pluginRuntimeSessionRepository: PluginRuntimeSessionRepository,
    private readonly workspaceService: WorkspaceService
  ) {}

  createSession(input: CreatePluginRuntimeSessionInput): PluginRuntimeSession {
    const detail = this.pluginRegistryService.getPlugin(input.pluginId);
    if (!detail.enablement.enabled) {
      throw new AppError({
        statusCode: 403,
        errorCode: "PLUGIN_DISABLED",
        detail: "当前插件已禁用"
      });
    }

    this.workspaceService.getWorkspaceOrThrow(input.workspaceId);

    const timestamp = nowIso();
    return this.pluginRuntimeSessionRepository.create({
      id: createId(),
      pluginId: input.pluginId,
      workspaceId: input.workspaceId,
      openedByUserId: input.openedByUserId,
      source: input.source,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
      closedAt: null
    });
  }

  getSessionOrThrow(sessionId: string): PluginRuntimeSession {
    const session = this.pluginRuntimeSessionRepository.findById(sessionId);
    if (!session) {
      throw new AppError({
        statusCode: 404,
        errorCode: "PLUGIN_RUNTIME_SESSION_NOT_FOUND",
        detail: "未找到对应插件运行实例"
      });
    }

    return session;
  }

  getActiveSessionOrThrow(sessionId: string): PluginRuntimeSession {
    const session = this.getSessionOrThrow(sessionId);
    if (session.status !== "active" || session.closedAt) {
      throw new AppError({
        statusCode: 409,
        errorCode: "PLUGIN_RUNTIME_SESSION_CLOSED",
        detail: "当前插件运行实例已关闭"
      });
    }

    return session;
  }

  getActiveSessionForPluginOrThrow(pluginId: string, sessionId: string): PluginRuntimeSession {
    const session = this.getActiveSessionOrThrow(sessionId);
    if (session.pluginId !== pluginId) {
      throw new AppError({
        statusCode: 403,
        errorCode: "PLUGIN_SCOPE_REJECTED",
        detail: "运行实例与目标插件不一致"
      });
    }

    return session;
  }

  closeSession(sessionId: string): PluginRuntimeSession {
    const session = this.getSessionOrThrow(sessionId);
    if (session.status === "closed") {
      return session;
    }

    const closedAt = nowIso();
    return this.pluginRuntimeSessionRepository.update({
      ...session,
      status: "closed",
      updatedAt: closedAt,
      closedAt
    });
  }
}
