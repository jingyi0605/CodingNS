import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { ButlerControlSessionRepository } from "../../storage/repositories/butler-control-session-repository.js";
import type { SessionProviderConfigMode } from "../../types/domain.js";
import type { SessionHistoryService } from "./session-history-service.js";
import type { SessionLiveRuntimeService } from "./session-live-runtime-service.js";
import type { SessionAttachmentInput } from "./session-message-attachment-service.js";

interface SessionListQuery {
  workspaceId?: string;
}

interface SessionParams {
  sessionId: string;
}

interface SessionAttachmentParams extends SessionParams {
  attachmentId: string;
}

interface SessionQueueItemParams extends SessionParams {
  queueItemId: string;
}

interface SessionPermissionRequestParams extends SessionParams {
  requestId: string;
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
  providerConfigMode?: SessionProviderConfigMode;
  providerPresetId?: string | null;
}

interface SendMessageBody extends RuntimeOptionsBody {
  content?: string;
  clientRequestId?: string;
}

interface AttachmentsBody {
  attachments?: SessionAttachmentInput[];
}

interface SendLiveMessageBody extends SendMessageBody, RuntimeOptionsBody, AttachmentsBody {}
interface EnqueueLiveMessageBody extends SendLiveMessageBody {}

interface StartSessionBody {
  workspaceId?: string;
  provider?: string;
  initialPrompt?: string;
  parentSessionId?: string | null;
  sessionKind?: "default" | "annotation";
  annotationSourceMessageId?: string | null;
  annotationSourceText?: string | null;
}

interface StartLiveSessionBody extends RuntimeOptionsBody {
  workspaceId?: string;
  provider?: string;
  content?: string;
  clientRequestId?: string;
  attachments?: SessionAttachmentInput[];
  parentSessionId?: string | null;
  sessionKind?: "default" | "annotation";
  annotationSourceMessageId?: string | null;
  annotationSourceText?: string | null;
  providerConfigMode?: SessionProviderConfigMode;
  providerPresetId?: string | null;
}

interface RenameSessionBody {
  title?: string;
}

interface ArchiveSessionBody {
  archived?: boolean;
}

interface FavoriteSessionBody {
  favorite?: boolean;
}

interface ForkSessionBody {
  sourceType?: "session" | "message";
  sourceMessageId?: string | null;
  sourceMessageSnapshot?: {
    role?: "user" | "assistant" | "tool" | "system";
    kind?: "text" | "thinking" | "tool_call" | "tool_result";
    content?: string | null;
  } | null;
  strategy?: "auto" | "native-only" | "reconstruct-only";
  targetProvider?: string | null;
  providerConfigMode?: SessionProviderConfigMode;
  providerPresetId?: string | null;
  sessionKind?: "default" | "annotation";
  annotationSourceMessageId?: string | null;
  annotationSourceText?: string | null;
}

interface ReplyPermissionRequestBody {
  action?: string;
  answers?: Record<string, string[]>;
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
  attachments: SessionAttachmentInput[],
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

function normalizeAttachments(input: AttachmentsBody): SessionAttachmentInput[] {
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
        detail: `attachments[${index}] 缺少有效的附件字段`,
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
  attachments: SessionAttachmentInput[]
): string | null {
  const normalized = clientRequestId?.trim() ?? null;

  if (attachments.length > 0 && !normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "发送附件时必须提供 clientRequestId",
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

function normalizeProviderConfigMode(
  value: string | undefined
): SessionProviderConfigMode | undefined {
  if (!value) {
    return undefined;
  }

  if (value === "global-default" || value === "cc-switch-preset") {
    return value;
  }

  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    detail: "providerConfigMode 非法",
    field: "providerConfigMode"
  });
}

export class SessionController {
  constructor(
    private readonly sessionHistoryService: SessionHistoryService,
    private readonly sessionLiveRuntimeService: Pick<
      SessionLiveRuntimeService,
      | "startLiveSession"
      | "sendLiveMessage"
      | "enqueueLiveMessage"
      | "getSessionRuntime"
      | "interruptSession"
      | "replyPermissionRequest"
      | "listPermissionRequests"
      | "listQueuedMessages"
      | "deleteQueuedMessage"
      | "steerQueuedMessage"
    >,
    private readonly butlerControlSessionRepository: Pick<ButlerControlSessionRepository, "listSessionIds">
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
      items: filterButlerControlSessions(
        await this.sessionHistoryService.discoverWorkspaceSessions(
          workspaceId,
          requireUserId(request)
        ),
        this.butlerControlSessionRepository
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
        detail: "未找到对应的附件",
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

  readonly getChangedFiles = async (
    request: FastifyRequest<{ Params: SessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: await this.sessionHistoryService.listSessionChangedFiles(
        request.params.sessionId,
        requireUserId(request)
      )
    });
  };

  readonly getCapabilities = async (
    request: FastifyRequest<{ Params: SessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.sessionHistoryService.getSessionCapabilities(request.params.sessionId));
  };

  readonly listPermissionRequests = async (
    request: FastifyRequest<{ Params: SessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: await this.sessionLiveRuntimeService.listPermissionRequests(
        request.params.sessionId,
        requireUserId(request)
      )
    });
  };

  readonly listQueue = async (
    request: FastifyRequest<{ Params: SessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: await this.sessionLiveRuntimeService.listQueuedMessages(
        request.params.sessionId,
        requireUserId(request)
      )
    });
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

  readonly deleteSession = async (
    request: FastifyRequest<{ Params: SessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    await this.sessionHistoryService.deleteSession(
      request.params.sessionId,
      requireUserId(request)
    );
    reply.status(204).send();
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

  readonly updateFavoriteState = async (
    request: FastifyRequest<{ Params: SessionParams; Body: FavoriteSessionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.sessionHistoryService.updateSessionFavoriteState({
        sessionId: request.params.sessionId,
        userId: requireUserId(request),
        isFavorite: request.body.favorite === true
      })
    );
  };

  readonly fork = async (
    request: FastifyRequest<{ Params: SessionParams; Body: ForkSessionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const sourceType = request.body.sourceType === "message" ? "message" : "session";

    reply.status(201).send(
      await this.sessionHistoryService.forkSession({
        sessionId: request.params.sessionId,
        userId: requireUserId(request),
        sourceType,
        sourceMessageId: request.body.sourceMessageId?.trim() ?? null,
        sourceMessageSnapshot:
          request.body.sourceMessageSnapshot
          && typeof request.body.sourceMessageSnapshot === "object"
            ? {
                role:
                  request.body.sourceMessageSnapshot.role === "assistant"
                  || request.body.sourceMessageSnapshot.role === "tool"
                  || request.body.sourceMessageSnapshot.role === "system"
                    ? request.body.sourceMessageSnapshot.role
                    : "user",
                kind:
                  request.body.sourceMessageSnapshot.kind === "thinking"
                  || request.body.sourceMessageSnapshot.kind === "tool_call"
                  || request.body.sourceMessageSnapshot.kind === "tool_result"
                    ? request.body.sourceMessageSnapshot.kind
                    : "text",
                content: request.body.sourceMessageSnapshot.content ?? ""
              }
            : null,
        strategy: request.body.strategy ?? "auto",
        targetProvider: request.body.targetProvider?.trim() || null,
        providerConfigMode: normalizeProviderConfigMode(request.body.providerConfigMode),
        providerPresetId: request.body.providerPresetId?.trim() || null,
        sessionKind: request.body.sessionKind === "annotation" ? "annotation" : "default",
        annotationSourceMessageId: request.body.annotationSourceMessageId?.trim() || null,
        annotationSourceText: request.body.annotationSourceText?.trim() || null
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
        initialPrompt: request.body.initialPrompt?.trim(),
        parentSessionId: request.body.parentSessionId?.trim() || null,
        sessionKind: request.body.sessionKind === "annotation" ? "annotation" : "default",
        annotationSourceMessageId: request.body.annotationSourceMessageId?.trim() || null,
        annotationSourceText: request.body.annotationSourceText?.trim() || null
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
        parentSessionId: request.body.parentSessionId?.trim() || null,
        sessionKind: request.body.sessionKind === "annotation" ? "annotation" : "default",
        annotationSourceMessageId: request.body.annotationSourceMessageId?.trim() || null,
        annotationSourceText: request.body.annotationSourceText?.trim() || null,
        providerConfigMode: normalizeProviderConfigMode(request.body.providerConfigMode),
        providerPresetId: request.body.providerPresetId?.trim() || null,
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
    const runtimeOptions = normalizeRuntimeOptions(request.body);

    reply.status(201).send(
      await this.sessionHistoryService.sendMessage(
        request.params.sessionId,
        content,
        request.body.clientRequestId?.trim() ?? null,
        runtimeOptions?.permissionMode ?? null
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
        providerConfigMode: normalizeProviderConfigMode(request.body.providerConfigMode),
        providerPresetId: request.body.providerPresetId?.trim() || null,
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

  readonly enqueueLiveMessage = async (
    request: FastifyRequest<{ Params: SessionParams; Body: EnqueueLiveMessageBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const attachments = normalizeAttachments(request.body);
    const content = requireMessageContentOrAttachments(
      request.body.content,
      attachments,
      "content",
      "queue 必须提供 content"
    );
    const clientRequestId = requireClientRequestIdForAttachments(
      request.body.clientRequestId,
      attachments
    );
    const runtimeOptions = normalizeRuntimeOptions(request.body);

    reply.status(202).send(
      await this.sessionLiveRuntimeService.enqueueLiveMessage({
        sessionId: request.params.sessionId,
        userId: requireUserId(request),
        content,
        clientRequestId,
        providerConfigMode: normalizeProviderConfigMode(request.body.providerConfigMode),
        providerPresetId: request.body.providerPresetId?.trim() || null,
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

  readonly replyPermissionRequest = async (
    request: FastifyRequest<{
      Params: SessionPermissionRequestParams;
      Body: ReplyPermissionRequestBody;
    }>,
    reply: FastifyReply
  ): Promise<void> => {
    const action = requireNonEmptyText(
      request.body.action,
      "action",
      "回复权限申请时必须提供 action"
    );

    reply.send(
      await this.sessionLiveRuntimeService.replyPermissionRequest(
        request.params.sessionId,
        requireUserId(request),
        request.params.requestId,
        {
          action,
          answers: request.body.answers
        }
      )
    );
  };

  readonly deleteQueuedMessage = async (
    request: FastifyRequest<{ Params: SessionQueueItemParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    await this.sessionLiveRuntimeService.deleteQueuedMessage(
      request.params.sessionId,
      requireUserId(request),
      request.params.queueItemId
    );
    reply.status(204).send();
  };

  readonly steerQueuedMessage = async (
    request: FastifyRequest<{ Params: SessionQueueItemParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.status(202).send(
      await this.sessionLiveRuntimeService.steerQueuedMessage(
        request.params.sessionId,
        requireUserId(request),
        request.params.queueItemId
      )
    );
  };
}

function filterButlerControlSessions(
  sessions: Awaited<ReturnType<SessionHistoryService["discoverWorkspaceSessions"]>>,
  butlerControlSessionRepository: Pick<ButlerControlSessionRepository, "listSessionIds">
) {
  const hiddenSessionIds = new Set(butlerControlSessionRepository.listSessionIds());

  if (hiddenSessionIds.size === 0) {
    return sessions;
  }

  return sessions.filter((session) => !hiddenSessionIds.has(session.sessionId));
}
