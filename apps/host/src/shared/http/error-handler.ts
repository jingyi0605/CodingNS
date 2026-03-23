import type { FastifyReply, FastifyRequest } from "fastify";

import { isAppError } from "../errors/app-error.js";

export interface ErrorPayload {
  error_code: string;
  detail: string;
  field?: string;
  timestamp: string;
}

export function sendError(
  reply: FastifyReply,
  statusCode: number,
  errorCode: string,
  detail: string,
  field?: string
): FastifyReply {
  return reply.status(statusCode).send({
    error_code: errorCode,
    detail,
    field,
    timestamp: new Date().toISOString()
  } satisfies ErrorPayload);
}

export function setErrorHandler(
  error: Error,
  request: FastifyRequest,
  reply: FastifyReply
): FastifyReply {
  request.log.error(error);

  if (isAppError(error)) {
    return sendError(reply, error.statusCode, error.errorCode, error.message, error.field);
  }

  return sendError(reply, 500, "INTERNAL_ERROR", "服务内部错误");
}
