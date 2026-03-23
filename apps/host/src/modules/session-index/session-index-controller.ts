import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { SessionIndexService } from "./session-index-service.js";

interface SessionListQuery {
  workspaceId?: string;
}

export class SessionIndexController {
  constructor(private readonly sessionIndexService: SessionIndexService) {}

  readonly list = async (
    request: FastifyRequest<{ Querystring: SessionListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const workspaceId = request.query.workspaceId?.trim();

    if (!workspaceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "查询会话必须提供 workspaceId",
        field: "workspaceId"
      });
    }

    reply.send({
      items: this.sessionIndexService.list(workspaceId)
    });
  };
}
