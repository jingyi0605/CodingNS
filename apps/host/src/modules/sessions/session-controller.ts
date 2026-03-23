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

interface SendMessageBody {
  content?: string;
  clientRequestId?: string;
}

interface StartSessionBody {
  workspaceId?: string;
  provider?: string;
  initialPrompt?: string;
}

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
      items: await this.sessionRuntimeService.discoverWorkspaceSessions(
        workspaceId,
        requireUserId(request)
      )
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
        Number(request.query.limit ?? "50"),
        requireUserId(request)
      )
    );
  };

  readonly getDetail = async (
    request: FastifyRequest<{ Params: SessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.sessionRuntimeService.getSession(request.params.sessionId, requireUserId(request))
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

  readonly markSeen = async (
    request: FastifyRequest<{ Params: SessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    await this.sessionRuntimeService.markSessionSeen(
      request.params.sessionId,
      requireUserId(request)
    );
    reply.status(204).send();
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
        userId: requireUserId(request),
        provider,
        initialPrompt: request.body.initialPrompt?.trim()
      })
    );
  };

  readonly sendMessage = async (
    request: FastifyRequest<{ Params: SessionParams; Body: SendMessageBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const content = request.body.content?.trim();

    if (!content) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "发送消息必须提供内容",
        field: "content"
      });
    }

    reply.status(201).send(
      await this.sessionRuntimeService.sendMessage(
        request.params.sessionId,
        content,
        request.body.clientRequestId?.trim() ?? null
      )
    );
  };
}
