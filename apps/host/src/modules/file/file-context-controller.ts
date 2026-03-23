import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { FileContentService } from "./file-content-service.js";
import type { FileContextService } from "./file-context-service.js";

interface SessionParams {
  sessionId: string;
  bindingId?: string;
}

interface AttachFileContextBody {
  workspaceId?: string;
  path?: string;
  rangeStart?: number;
  rangeEnd?: number;
}

export class FileContextController {
  constructor(
    private readonly fileContentService: FileContentService,
    private readonly fileContextService: FileContextService
  ) {}

  readonly attach = async (
    request: FastifyRequest<{ Params: SessionParams; Body: AttachFileContextBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const workspaceId = request.body.workspaceId?.trim();

    if (!workspaceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "挂载文件上下文必须提供 workspaceId",
        field: "workspaceId"
      });
    }

    const userId = requireUserId(request);
    const snapshot = this.fileContentService.readFile(
      workspaceId,
      request.body.path?.trim() ?? "",
      userId,
      {
        recordRecent: false
      }
    );

    reply.status(201).send(
      await this.fileContextService.attach({
        sessionId: request.params.sessionId,
        workspaceId,
        snapshot,
        userId,
        rangeStart: request.body.rangeStart,
        rangeEnd: request.body.rangeEnd
      })
    );
  };

  readonly list = async (
    request: FastifyRequest<{ Params: SessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: await this.fileContextService.list(request.params.sessionId, requireUserId(request))
    });
  };

  readonly detach = async (
    request: FastifyRequest<{ Params: SessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.fileContextService.detach(
        request.params.sessionId,
        request.params.bindingId ?? "",
        requireUserId(request)
      )
    );
  };
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
