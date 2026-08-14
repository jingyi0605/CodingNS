import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { WorkbenchService } from "./workbench-service.js";

function requireUserId(request: FastifyRequest): string {
  const userId = (request as FastifyRequest & {
    auth?: {
      user?: {
        userId?: string;
      };
    };
  }).auth?.user?.userId;

  if (!userId) {
    throw new AppError({
      statusCode: 401,
      errorCode: "UNAUTHORIZED",
      detail: "当前请求缺少有效登录态"
    });
  }

  return userId;
}

export class WorkbenchController {
  constructor(private readonly workbenchService: WorkbenchService) {}

  readonly getSnapshot = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const userId = requireUserId(request);
    const refresh = request.headers["x-codingns-workbench-refresh"] === "true";

    if (refresh) {
      // HTTP 导航刷新也不能等待 workspace discovery。
      // 旧前端可能还会带 await-discovery header；服务端必须兜底，只安排后台刷新并立即返回当前缓存。
      reply.send(await this.workbenchService.refreshSnapshot(userId, {
        force: true,
        awaitDiscovery: false
      }));
      return;
    }

    reply.send(this.workbenchService.getSnapshot(userId));
  };

  readonly getPeerWorkspaceSummary = async (
    request: FastifyRequest<{
      Querystring: {
        workspaceId?: string | string[];
      };
    }>,
    reply: FastifyReply
  ): Promise<void> => {
    const userId = requireUserId(request);
    const workspaceIds = normalizeWorkspaceIds(request.query?.workspaceId);

    workspaceIds.forEach((workspaceId) => {
      this.workbenchService.schedulePeerWorkspaceSummaryRefresh(workspaceId, userId);
    });

    reply.send({
      items: workspaceIds.map((workspaceId) => ({
        workspaceId,
        summary: this.workbenchService.getPeerWorkspaceSummary(workspaceId, userId)
      }))
    });
  };

  readonly getAffairsAssistantSessions = async (
    request: FastifyRequest<{
      Params: {
        workspaceId: string;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> => {
    const userId = requireUserId(request);
    const refresh = request.headers["x-codingns-affairs-assistant-refresh"] === "true";
    const awaitRefresh = request.headers["x-codingns-affairs-assistant-await-refresh"] === "true";

    const snapshot = refresh
      ? await this.workbenchService.refreshAffairsAssistantSessionsSnapshot(request.params.workspaceId, userId, {
        force: true,
        awaitRefresh
      })
      : this.workbenchService.getAffairsAssistantSessionsSnapshot(request.params.workspaceId, userId);

    reply.send({
      item: {
        projectId: snapshot.projectId,
        projectWorkspaceId: snapshot.projectWorkspaceId,
        agentWorkspacePath: snapshot.agentWorkspacePath,
        sessions: snapshot.sessions,
        updatedAt: snapshot.updatedAt
      }
    });
  };
}

function normalizeWorkspaceIds(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of values) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  if (result.length === 0) {
    throw new AppError({
      statusCode: 400,
      errorCode: "WORKSPACE_ID_REQUIRED",
      detail: "缺少 workspaceId"
    });
  }

  return result;
}
