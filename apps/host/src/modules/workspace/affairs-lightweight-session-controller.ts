import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import { requireUserId } from "../preferences/common.js";
import type { AffairsLightweightSessionService } from "./affairs-lightweight-session-service.js";

interface WorkspaceParams {
  workspaceId: string;
}

interface LightweightSessionParams extends WorkspaceParams {
  sessionId: string;
}

interface AffairsLightweightStartBody {
  provider?: string;
  content?: string;
  clientRequestId?: string | null;
  model?: string | null;
  reasoningLevel?: string | null;
}

interface AffairsLightweightSendBody extends AffairsLightweightStartBody {}

function requireText(value: string | null | undefined, field: string, detail: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail,
      field
    });
  }
  return normalized;
}

export class AffairsLightweightSessionController {
  constructor(
    private readonly affairsLightweightSessionService: AffairsLightweightSessionService
  ) {}

  readonly listSessions = async (
    request: FastifyRequest<{ Params: WorkspaceParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: await this.affairsLightweightSessionService.listSessions(
        request.params.workspaceId,
        requireUserId(request)
      )
    });
  };

  readonly getSession = async (
    request: FastifyRequest<{ Params: LightweightSessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.affairsLightweightSessionService.getSession(
        request.params.workspaceId,
        request.params.sessionId,
        requireUserId(request)
      )
    );
  };

  readonly readMessages = async (
    request: FastifyRequest<{ Params: LightweightSessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.affairsLightweightSessionService.readMessages(
        request.params.workspaceId,
        request.params.sessionId,
        requireUserId(request)
      )
    );
  };

  readonly startSession = async (
    request: FastifyRequest<{ Params: WorkspaceParams; Body: AffairsLightweightStartBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const content = requireText(
      request.body.content,
      "content",
      "事务轻量会话必须提供首条消息"
    );
    const provider = requireText(
      request.body.provider,
      "provider",
      "事务轻量会话必须提供 provider"
    );
    reply.status(201).send(
      await this.affairsLightweightSessionService.startSession({
        workspaceId: request.params.workspaceId,
        userId: requireUserId(request),
        provider,
        content,
        clientRequestId: request.body.clientRequestId ?? null,
        model: request.body.model ?? null,
        reasoningLevel: request.body.reasoningLevel ?? null
      })
    );
  };

  readonly startSessionStream = async (
    request: FastifyRequest<{ Params: WorkspaceParams; Body: AffairsLightweightStartBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const content = requireText(
      request.body.content,
      "content",
      "事务轻量会话必须提供首条消息"
    );
    const provider = requireText(
      request.body.provider,
      "provider",
      "事务轻量会话必须提供 provider"
    );
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    try {
      await this.affairsLightweightSessionService.startSessionStream({
        workspaceId: request.params.workspaceId,
        userId: requireUserId(request),
        provider,
        content,
        clientRequestId: request.body.clientRequestId ?? null,
        model: request.body.model ?? null,
        reasoningLevel: request.body.reasoningLevel ?? null
      }, async (event) => {
        reply.raw.write(`${JSON.stringify(event)}\n`);
      });
    } catch (error) {
      if (!reply.raw.writableEnded) {
        const detail = error instanceof AppError ? error.message : "轻量会话流式执行失败";
        const errorCode = error instanceof AppError ? error.errorCode : "LIGHTWEIGHT_RUNTIME_FAILED";
        reply.raw.write(`${JSON.stringify({ type: "error", errorCode, detail })}\n`);
      }
    } finally {
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    }
  };

  readonly sendMessage = async (
    request: FastifyRequest<{ Params: LightweightSessionParams; Body: AffairsLightweightSendBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const content = requireText(
      request.body.content,
      "content",
      "事务轻量会话发送消息必须提供 content"
    );
    reply.status(201).send(
      await this.affairsLightweightSessionService.sendMessage({
        workspaceId: request.params.workspaceId,
        userId: requireUserId(request),
        sessionId: request.params.sessionId,
        content,
        clientRequestId: request.body.clientRequestId ?? null,
        model: request.body.model ?? null,
        reasoningLevel: request.body.reasoningLevel ?? null
      })
    );
  };

  readonly sendMessageStream = async (
    request: FastifyRequest<{ Params: LightweightSessionParams; Body: AffairsLightweightSendBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const content = requireText(
      request.body.content,
      "content",
      "事务轻量会话发送消息必须提供 content"
    );
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    try {
      await this.affairsLightweightSessionService.sendMessageStream({
        workspaceId: request.params.workspaceId,
        userId: requireUserId(request),
        sessionId: request.params.sessionId,
        content,
        clientRequestId: request.body.clientRequestId ?? null,
        model: request.body.model ?? null,
        reasoningLevel: request.body.reasoningLevel ?? null
      }, async (event) => {
        reply.raw.write(`${JSON.stringify(event)}\n`);
      });
    } catch (error) {
      if (!reply.raw.writableEnded) {
        const detail = error instanceof AppError ? error.message : "轻量会话流式执行失败";
        const errorCode = error instanceof AppError ? error.errorCode : "LIGHTWEIGHT_RUNTIME_FAILED";
        reply.raw.write(`${JSON.stringify({ type: "error", errorCode, detail })}\n`);
      }
    } finally {
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    }
  };
}
