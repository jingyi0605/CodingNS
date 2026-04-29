import { createHash } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

import { type AppError, isAppError } from "../errors/app-error.js";

export interface ErrorPayload {
  error_code: string;
  detail: string;
  field?: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

const EXPECTED_REQUEST_WARNING_DEDUP_TTL_MS = 2_000;
const expectedRequestWarningLogAtByKey = new Map<string, number>();

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

  if (isAppError(error)) {
    if (shouldLogAsExpectedRequestWarning(error)) {
      if (shouldEmitExpectedRequestWarning(error, request)) {
        console.warn("[host-warning]", {
          ...requestContext,
          statusCode: error.statusCode,
          errorCode: error.errorCode
        });
        request.log.warn({
          err: error,
          ...requestContext,
          statusCode: error.statusCode,
          errorCode: error.errorCode
        });
      }

      return sendError(reply, error.statusCode, error.errorCode, error.message, error.field, error.data);
    }

    // Host 当前关闭了 Fastify 内置 logger，这里显式写 stderr，避免 500 只有前端提示没有后端痕迹。
    console.error("[host-error]", requestContext, error);
    request.log.error(error);
    return sendError(reply, error.statusCode, error.errorCode, error.message, error.field, error.data);
  }

  console.error("[host-error]", requestContext, error);
  request.log.error(error);
  return sendError(reply, 500, "INTERNAL_ERROR", "服务内部错误");
}

function shouldLogAsExpectedRequestWarning(error: AppError): boolean {
  if (error.statusCode !== 401) {
    return false;
  }

  return (
    error.errorCode === "UNAUTHORIZED"
    || error.errorCode === "TOKEN_INVALID"
    || error.errorCode === "TOKEN_EXPIRED"
  );
}

function shouldEmitExpectedRequestWarning(error: AppError, request: FastifyRequest): boolean {
  pruneExpiredExpectedRequestWarnings();

  const now = Date.now();
  const warningKey = [
    error.statusCode,
    error.errorCode,
    readAuthorizationFingerprint(request)
  ].join(":");
  const lastLoggedAt = expectedRequestWarningLogAtByKey.get(warningKey);

  expectedRequestWarningLogAtByKey.set(warningKey, now);

  return !lastLoggedAt || now - lastLoggedAt > EXPECTED_REQUEST_WARNING_DEDUP_TTL_MS;
}

function pruneExpiredExpectedRequestWarnings(): void {
  const now = Date.now();

  for (const [warningKey, loggedAt] of expectedRequestWarningLogAtByKey.entries()) {
    if (now - loggedAt > EXPECTED_REQUEST_WARNING_DEDUP_TTL_MS) {
      expectedRequestWarningLogAtByKey.delete(warningKey);
    }
  }
}

function readAuthorizationFingerprint(request: FastifyRequest): string {
  const authorization = request.headers.authorization;

  if (!authorization) {
    return "anonymous";
  }

  return createHash("sha1").update(authorization).digest("hex").slice(0, 12);
}
