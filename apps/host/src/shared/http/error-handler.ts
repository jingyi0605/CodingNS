import type { FastifyReply, FastifyRequest } from "fastify";

import { isAppError } from "../errors/app-error.js";

export interface ErrorPayload {
  error_code: string;
  detail: string;
  field?: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

export function sendError(
  reply: FastifyReply,
  statusCode: number,
  errorCode: string,
  detail: string,
  field?: string,
  data?: Record<string, unknown>
): FastifyReply {
  return reply.status(statusCode).send({
    error_code: errorCode,
    detail,
    field,
    data,
    timestamp: new Date().toISOString()
  } satisfies ErrorPayload);
}

export function setErrorHandler(
  error: Error,
  request: FastifyRequest,
  reply: FastifyReply
): FastifyReply {
  const requestContext = {
    method: request.method,
    url: request.url,
    errorName: error.name,
    errorMessage: error.message
  };

  // Host 当前关闭了 Fastify 内置 logger，这里显式写 stderr，避免 500 只有前端提示没有后端痕迹。
  console.error("[host-error]", requestContext, error);
  request.log.error(error);

  if (isAppError(error)) {
    return sendError(reply, error.statusCode, error.errorCode, error.message, error.field, error.data);
  }

  return sendError(reply, 500, "INTERNAL_ERROR", "服务内部错误");
}
