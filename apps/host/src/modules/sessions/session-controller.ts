import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { SessionHistoryService } from "./session-history-service.js";
import type { SessionLiveRuntimeService } from "./session-live-runtime-service.js";

interface SessionListQuery {
  workspaceId?: string;
}

interface SessionParams {
  sessionId: string;
}

interface SessionMessagesQuery {
  cursor?: string;
  limit?: string;
  direction?: string;
}

interface RuntimeOptionsBody {
  model?: string;
  reasoningLevel?: string;
  permissionMode?: string;
}

interface SendMessageBody {
  content?: string;
  clientRequestId?: string;
}

interface SendLiveMessageBody extends SendMessageBody, RuntimeOptionsBody {}

interface StartSessionBody {
  workspaceId?: string;
  provider?: string;
  initialPrompt?: string;
}

interface StartLiveSessionBody extends RuntimeOptionsBody {
  workspaceId?: string;
  provider?: string;
  content?: string;
  clientRequestId?: string;
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

function requireNonEmptyText(value: string | undefined, field: string, detail: string): string {
  const text = value?.trim();

  if (!text) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail,
      field
    });
  }

  return text;
}

function normalizeRuntimeOptions(input: RuntimeOptionsBody) {
  const model = input.model?.trim();
  const reasoningLevel = input.reasoningLevel?.trim();
  const permissionMode = input.permissionMode?.trim();

  if (!model && !reasoningLevel && !permissionMode) {
    return undefined;
  }

  return {
    model: model ?? null,
    reasoningLevel: reasoningLevel ?? null,
    permissionMode: permissionMode ?? null
  };
}

export class SessionController {
  constructor(
    private readonly sessionHistoryService: SessionHistoryService,
    private readonly sessionLiveRuntimeService: SessionLiveRuntimeService
  ) {}

  readonly list = async (
    request: FastifyRequest<{ Querystring: SessionListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const workspaceId = requireNonEmptyText(
      request.query.workspaceId,
      "workspaceId",
      "查询会话必须提供 workspaceId"
    );

    reply.send({
      items: await this.sessionHistoryService.discoverWorkspaceSessions(
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
      await this.sessionHistoryService.readSessionHistory(
        request.params.sessionId,
        request.query.cursor ?? null,
        Number(request.query.limit ?? "50"),
        request.query.direction === "backward" ? "backward" : "forward",
        requireUserId(request)
      )
    );
  };

  readonly getDetail = async (
    request: FastifyRequest<{ Params: SessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.sessionHistoryService.getSession(request.params.sessionId, requireUserId(request))
    );
  };

  readonly getCapabilities = async (
    request: FastifyRequest<{ Params: SessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.sessionHistoryService.getSessionCapabilities(request.params.sessionId));
  };

  readonly resume = async (
    request: FastifyRequest<{ Params: SessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.sessionHistoryService.resumeSession(request.params.sessionId));
  };

  readonly markSeen = async (
    request: FastifyRequest<{ Params: SessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    await this.sessionHistoryService.markSessionSeen(
      request.params.sessionId,
      requireUserId(request)
    );
    reply.status(204).send();
  };

  readonly start = async (
    request: FastifyRequest<{ Body: StartSessionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const workspaceId = requireNonEmptyText(
      request.body.workspaceId,
      "workspaceId",
      "创建会话必须提供 workspaceId"
    );
    const provider = requireNonEmptyText(
      request.body.provider,
      "provider",
      "创建会话必须提供 provider"
    );

    reply.status(201).send(
      await this.sessionHistoryService.startSession({
        workspaceId,
        userId: requireUserId(request),
        provider,
        initialPrompt: request.body.initialPrompt?.trim()
      })
    );
  };

  readonly startLive = async (
    request: FastifyRequest<{ Body: StartLiveSessionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const workspaceId = requireNonEmptyText(
      request.body.workspaceId,
      "workspaceId",
      "创建实时会话必须提供 workspaceId"
    );
    const provider = requireNonEmptyText(
      request.body.provider,
      "provider",
      "创建实时会话必须提供 provider"
    );
    const content = requireNonEmptyText(
      request.body.content,
      "content",
      "start-live 必须提供首条消息 content"
    );

    reply.status(201).send(
      await this.sessionLiveRuntimeService.startLiveSession({
        workspaceId,
        userId: requireUserId(request),
        provider,
        content,
        clientRequestId: request.body.clientRequestId?.trim() ?? null,
        runtimeOptions: normalizeRuntimeOptions(request.body)
      })
    );
  };

  readonly sendMessage = async (
    request: FastifyRequest<{ Params: SessionParams; Body: SendMessageBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const content = requireNonEmptyText(
      request.body.content,
      "content",
      "发送消息必须提供 content"
    );

    reply.status(201).send(
      await this.sessionHistoryService.sendMessage(
        request.params.sessionId,
        content,
        request.body.clientRequestId?.trim() ?? null
      )
    );
  };

  readonly sendLiveMessage = async (
    request: FastifyRequest<{ Params: SessionParams; Body: SendLiveMessageBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const content = requireNonEmptyText(
      request.body.content,
      "content",
      "messages/live 必须提供 content"
    );

    reply.status(202).send(
      await this.sessionLiveRuntimeService.sendLiveMessage({
        sessionId: request.params.sessionId,
        userId: requireUserId(request),
        content,
        clientRequestId: request.body.clientRequestId?.trim() ?? null,
        runtimeOptions: normalizeRuntimeOptions(request.body)
      })
    );
  };

  readonly getRuntime = async (
    request: FastifyRequest<{ Params: SessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.sessionLiveRuntimeService.getSessionRuntime(
        request.params.sessionId,
        requireUserId(request)
      )
    );
  };

  readonly interrupt = async (
    request: FastifyRequest<{ Params: SessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.sessionLiveRuntimeService.interruptSession(
        request.params.sessionId,
        requireUserId(request)
      )
    );
  };
}
