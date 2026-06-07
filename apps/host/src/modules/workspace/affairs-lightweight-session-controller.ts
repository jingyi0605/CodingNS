import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import { requireUserId } from "../preferences/common.js";
import type { AffairsLightweightAttachmentInput, AffairsLightweightSessionService } from "./affairs-lightweight-session-service.js";

interface WorkspaceParams {
  workspaceId: string;
}

interface LightweightSessionParams extends WorkspaceParams {
  sessionId: string;
}

interface AffairsLightweightAttachmentBody {
  kind?: "image" | "file";
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  contentBase64?: string | null;
}

interface AffairsLightweightStartBody {
  provider?: string;
  content?: string;
  clientRequestId?: string | null;
  model?: string | null;
  reasoningLevel?: string | null;
  attachments?: AffairsLightweightAttachmentBody[] | null;
}

interface AffairsLightweightSendBody extends AffairsLightweightStartBody {}
interface AffairsLightweightSeenBody {
  seenAt?: string | null;
}
interface AffairsLightweightTitleBody {
  title?: string | null;
}
interface AffairsLightweightArchiveBody {
  archived?: boolean;
}
interface AffairsLightweightFavoriteBody {
  favorite?: boolean;
}

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

function normalizeAttachments(input: AffairsLightweightStartBody | AffairsLightweightSendBody): AffairsLightweightAttachmentInput[] {
  if (!Array.isArray(input.attachments)) {
    return [];
  }

  return input.attachments.map((attachment, index) => {
    const kind: "image" | "file" = attachment?.kind === "image" ? "image" : "file";
    const fileName = attachment?.fileName?.trim() ?? "";
    const mimeType = attachment?.mimeType?.trim() ?? "";
    const contentBase64 = attachment?.contentBase64?.trim() ?? "";
    const fileSize = Number(attachment?.fileSize ?? 0);

    if (!fileName || !mimeType || !contentBase64 || !Number.isFinite(fileSize) || fileSize <= 0) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: `attachments[${index}] 缺少有效的附件字段`,
        field: "attachments"
      });
    }

    return {
      kind,
      fileName,
      mimeType,
      fileSize,
      contentBase64
    };
  });
}

function requireTextOrAttachments(
  value: string | null | undefined,
  attachments: unknown[],
  field: string,
  detail: string
): string {
  const normalized = value?.trim() ?? "";
  if (!normalized && attachments.length === 0) {
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

  readonly markSeen = async (
    request: FastifyRequest<{ Params: LightweightSessionParams; Body: AffairsLightweightSeenBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    await this.affairsLightweightSessionService.markSessionSeen(
      request.params.workspaceId,
      request.params.sessionId,
      requireUserId(request),
      request.body?.seenAt ?? null
    );
    reply.status(204).send();
  };

  readonly renameTitle = async (
    request: FastifyRequest<{ Params: LightweightSessionParams; Body: AffairsLightweightTitleBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const title = requireText(
      request.body.title,
      "title",
      "事务轻量会话标题不能为空"
    );
    reply.send(
      await this.affairsLightweightSessionService.renameSessionTitle(
        request.params.workspaceId,
        request.params.sessionId,
        requireUserId(request),
        title
      )
    );
  };

  readonly updateArchiveState = async (
    request: FastifyRequest<{ Params: LightweightSessionParams; Body: AffairsLightweightArchiveBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.affairsLightweightSessionService.updateSessionArchiveState(
        request.params.workspaceId,
        request.params.sessionId,
        requireUserId(request),
        request.body.archived === true
      )
    );
  };

  readonly updateFavoriteState = async (
    request: FastifyRequest<{ Params: LightweightSessionParams; Body: AffairsLightweightFavoriteBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.affairsLightweightSessionService.updateSessionFavoriteState(
        request.params.workspaceId,
        request.params.sessionId,
        requireUserId(request),
        request.body.favorite === true
      )
    );
  };

  readonly deleteSession = async (
    request: FastifyRequest<{ Params: LightweightSessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    await this.affairsLightweightSessionService.deleteSession(
      request.params.workspaceId,
      request.params.sessionId,
      requireUserId(request)
    );
    reply.status(204).send();
  };

  readonly startSession = async (
    request: FastifyRequest<{ Params: WorkspaceParams; Body: AffairsLightweightStartBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const attachments = normalizeAttachments(request.body);
    const content = requireTextOrAttachments(
      request.body.content,
      attachments,
      "content",
      "事务轻量会话必须提供首条消息或附件"
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
        reasoningLevel: request.body.reasoningLevel ?? null,
        attachments
      })
    );
  };

  readonly startSessionStream = async (
    request: FastifyRequest<{ Params: WorkspaceParams; Body: AffairsLightweightStartBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const attachments = normalizeAttachments(request.body);
    const content = requireTextOrAttachments(
      request.body.content,
      attachments,
      "content",
      "事务轻量会话必须提供首条消息或附件"
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
        reasoningLevel: request.body.reasoningLevel ?? null,
        attachments
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
    const attachments = normalizeAttachments(request.body);
    const content = requireTextOrAttachments(
      request.body.content,
      attachments,
      "content",
      "事务轻量会话发送消息必须提供 content 或附件"
    );
    reply.status(201).send(
      await this.affairsLightweightSessionService.sendMessage({
        workspaceId: request.params.workspaceId,
        userId: requireUserId(request),
        sessionId: request.params.sessionId,
        content,
        clientRequestId: request.body.clientRequestId ?? null,
        model: request.body.model ?? null,
        reasoningLevel: request.body.reasoningLevel ?? null,
        attachments
      })
    );
  };

  readonly sendMessageStream = async (
    request: FastifyRequest<{ Params: LightweightSessionParams; Body: AffairsLightweightSendBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const attachments = normalizeAttachments(request.body);
    const content = requireTextOrAttachments(
      request.body.content,
      attachments,
      "content",
      "事务轻量会话发送消息必须提供 content 或附件"
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
        reasoningLevel: request.body.reasoningLevel ?? null,
        attachments
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
