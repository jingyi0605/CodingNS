import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { WorkbenchService } from "./workbench-service.js";

function requireUserId(request: FastifyRequest): string {
  const userId = request.auth?.user.userId;

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
    const awaitDiscovery = request.headers["x-codingns-workbench-await-discovery"] === "true";

    if (refresh) {
      reply.send(await this.workbenchService.refreshSnapshot(userId, {
        force: true,
        awaitDiscovery
      }));
      return;
    }

    reply.send(this.workbenchService.getSnapshot(userId));
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

    const snapshot = refresh
      ? await this.workbenchService.refreshAffairsAssistantSessionsSnapshot(request.params.workspaceId, userId, {
        force: true
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
