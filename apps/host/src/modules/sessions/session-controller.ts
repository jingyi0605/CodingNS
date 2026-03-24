import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { SessionHistoryService } from "./session-history-service.js";
import type { SessionLiveRuntimeService } from "./session-live-runtime-service.js";
import type { SessionImageAttachmentInput } from "./session-message-attachment-service.js";

interface SessionListQuery {
  workspaceId?: string;
}

interface SessionParams {
  sessionId: string;
}

interface SessionAttachmentParams extends SessionParams {
  attachmentId: string;
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

interface AttachmentsBody {
  attachments?: SessionImageAttachmentInput[];
}

interface SendLiveMessageBody extends SendMessageBody, RuntimeOptionsBody, AttachmentsBody {}

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
  attachments?: SessionImageAttachmentInput[];
}

interface RenameSessionBody {
  title?: string;
}

interface ArchiveSessionBody {
  archived?: boolean;
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

function requireMessageContentOrAttachments(
  value: string | undefined,
  attachments: SessionImageAttachmentInput[],
  field: string,
  detail: string
): string {
  const text = value?.trim() ?? "";

  if (text.length === 0 && attachments.length === 0) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail,
      field
    });
  }

  return text;
}

function normalizeAttachments(input: AttachmentsBody): SessionImageAttachmentInput[] {
  if (!Array.isArray(input.attachments)) {
    return [];
  }

  return input.attachments.map((attachment, index) => {
    const fileName = attachment?.fileName?.trim();
    const mimeType = attachment?.mimeType?.trim();
    const contentBase64 = attachment?.contentBase64?.trim();
    const fileSize = Number(attachment?.fileSize ?? 0);

    if (!fileName || !mimeType || !contentBase64 || !Number.isFinite(fileSize) || fileSize <= 0) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: `attachments[${index}] 缺少有效的图片字段`,
        field: "attachments"
      });
    }

    return {
      fileName,
      mimeType,
      fileSize,
      contentBase64
    };
  });
}

function requireClientRequestIdForAttachments(
  clientRequestId: string | undefined,
  attachments: SessionImageAttachmentInput[]
): string | null {
  const normalized = clientRequestId?.trim() ?? null;

  if (attachments.length > 0 && !normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "发送图片时必须提供 clientRequestId",
      field: "clientRequestId"
    });
  }

  return normalized;
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

  readonly readAttachment = async (
    request: FastifyRequest<{ Params: SessionAttachmentParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    const userId = requireUserId(request);
    this.sessionHistoryService.getSession(request.params.sessionId, userId);
    const attachment = this.sessionHistoryService.readSessionAttachment(
      request.params.sessionId,
      request.params.attachmentId
    );

    if (!attachment) {
      throw new AppError({
        statusCode: 404,
        errorCode: "ATTACHMENT_NOT_FOUND",
        detail: "未找到对应的图片附件",
        field: "attachmentId"
      });
    }

    reply
      .type(attachment.mimeType)
      .header("Cache-Control", "private, max-age=300")
      .header("Content-Disposition", `inline; filename="${encodeURIComponent(attachment.fileName)}"`)
      .send(attachment.content);
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

  readonly renameTitle = async (
    request: FastifyRequest<{ Params: SessionParams; Body: RenameSessionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const title = requireNonEmptyText(
      request.body.title,
      "title",
      "重命名会话时必须提供 title"
    );

    reply.send(
      await this.sessionHistoryService.renameSessionTitle(
        request.params.sessionId,
        requireUserId(request),
        title
      )
    );
  };

  readonly updateArchiveState = async (
    request: FastifyRequest<{ Params: SessionParams; Body: ArchiveSessionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.sessionHistoryService.updateSessionArchiveState({
        sessionId: request.params.sessionId,
        userId: requireUserId(request),
        isArchived: request.body.archived === true
      })
    );
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
    const attachments = normalizeAttachments(request.body);
    const content = requireMessageContentOrAttachments(
      request.body.content,
      attachments,
      "content",
      "start-live 必须提供首条消息 content"
    );
    const clientRequestId = requireClientRequestIdForAttachments(
      request.body.clientRequestId,
      attachments
    );
    const runtimeOptions = normalizeRuntimeOptions(request.body);

    reply.status(201).send(
      await this.sessionLiveRuntimeService.startLiveSession({
        workspaceId,
        userId: requireUserId(request),
        provider,
        content,
        clientRequestId,
        runtimeOptions: runtimeOptions
          ? {
              ...runtimeOptions,
              attachments
            }
          : {
              attachments
            }
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
    const attachments = normalizeAttachments(request.body);
    const content = requireMessageContentOrAttachments(
      request.body.content,
      attachments,
      "content",
      "messages/live 必须提供 content"
    );
    const clientRequestId = requireClientRequestIdForAttachments(
      request.body.clientRequestId,
      attachments
    );
    const runtimeOptions = normalizeRuntimeOptions(request.body);

    reply.status(202).send(
      await this.sessionLiveRuntimeService.sendLiveMessage({
        sessionId: request.params.sessionId,
        userId: requireUserId(request),
        content,
        clientRequestId,
        runtimeOptions: runtimeOptions
          ? {
              ...runtimeOptions,
              attachments
            }
          : {
              attachments
            }
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
