import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { RuntimeObservabilityService } from "./observability-service.js";

interface RuntimeObservabilityQuery {
  sessionId?: string;
  activityLimit?: string;
}

interface RuntimeObservabilitySessionBody {
  ttlMs?: number;
}

interface RuntimeObservabilitySessionParams {
  sessionId: string;
}

export class ObservabilityController {
  constructor(private readonly runtimeObservabilityService: RuntimeObservabilityService) {}

  readonly createRuntimeSession = async (
    request: FastifyRequest<{ Body: RuntimeObservabilitySessionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    assertAuthenticated(request);
    reply.send(this.runtimeObservabilityService.openSession(request.body?.ttlMs));
  };

  readonly heartbeatRuntimeSession = async (
    request: FastifyRequest<{
      Params: RuntimeObservabilitySessionParams;
      Body: RuntimeObservabilitySessionBody;
    }>,
    reply: FastifyReply
  ): Promise<void> => {
    assertAuthenticated(request);
    reply.send(
      this.runtimeObservabilityService.touchSession(
        request.params.sessionId,
        request.body?.ttlMs
      )
    );
  };

  readonly closeRuntimeSession = async (
    request: FastifyRequest<{ Params: RuntimeObservabilitySessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    assertAuthenticated(request);
    this.runtimeObservabilityService.closeSession(request.params.sessionId);
    reply.code(204).send();
  };

  readonly getRuntimeSnapshot = async (
    request: FastifyRequest<{ Querystring: RuntimeObservabilityQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    assertAuthenticated(request);

    const sessionId = request.query.sessionId?.trim();

    if (!sessionId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "缺少观测会话 sessionId",
        field: "sessionId"
      });
    }

    const activityLimit = Number.parseInt(request.query.activityLimit ?? "100", 10);
    reply.send(this.runtimeObservabilityService.observe(sessionId, activityLimit));
  };
}

function assertAuthenticated(request: FastifyRequest): void {
  if (!request.auth?.user.userId) {
    throw new AppError({
      statusCode: 401,
      errorCode: "UNAUTHORIZED",
      detail: "当前请求缺少有效登录态"
    });
  }
}
