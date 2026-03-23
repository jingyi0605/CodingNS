import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { SessionRuntimeService } from "./session-runtime-service.js";

interface SessionListQuery {
  workspaceId?: string;
}

interface SessionParams {
  sessionId: string;
}

interface SessionMessagesQuery {
  cursor?: string;
  limit?: string;
}

interface StartSessionBody {
  workspaceId?: string;
  provider?: string;
  initialPrompt?: string;
}

export class SessionController {
  constructor(private readonly sessionRuntimeService: SessionRuntimeService) {}

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
      items: await this.sessionRuntimeService.discoverWorkspaceSessions(workspaceId)
    });
  };

  readonly readMessages = async (
    request: FastifyRequest<{
      Params: SessionParams;
      Querystring: SessionMessagesQuery;
    }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.sessionRuntimeService.readSessionHistory(
        request.params.sessionId,
        request.query.cursor ?? null,
        Number(request.query.limit ?? "50")
      )
    );
  };

  readonly getCapabilities = async (
    request: FastifyRequest<{ Params: SessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.sessionRuntimeService.getSessionCapabilities(request.params.sessionId));
  };

  readonly resume = async (
    request: FastifyRequest<{ Params: SessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.sessionRuntimeService.resumeSession(request.params.sessionId));
  };

  readonly start = async (
    request: FastifyRequest<{ Body: StartSessionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const workspaceId = request.body.workspaceId?.trim();
    const provider = request.body.provider?.trim();

    if (!workspaceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "创建会话必须提供 workspaceId",
        field: "workspaceId"
      });
    }

    if (!provider) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "创建会话必须提供 provider",
        field: "provider"
      });
    }

    reply.status(201).send(
      await this.sessionRuntimeService.startSession({
        workspaceId,
        provider,
        initialPrompt: request.body.initialPrompt?.trim()
      })
    );
  };
}
