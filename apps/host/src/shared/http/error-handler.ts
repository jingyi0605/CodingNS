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
  const requestContext = buildHostLogContext(error, request);

  if (isAppError(error)) {
    if (shouldLogAsCompactRequestWarning(error)) {
      logCompactRequestWarning(error, request, requestContext);

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

function buildHostLogContext(
  error: Error,
  request: FastifyRequest
): {
  timestamp: string;
  method: string;
  url: string;
  errorName: string;
  errorMessage: string;
} {
  return {
    timestamp: new Date().toISOString(),
    method: request.method,
    url: request.url,
    errorName: error.name,
    errorMessage: error.message
  };
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

function shouldLogAsCompactRequestWarning(error: AppError): boolean {
  return shouldLogAsExpectedRequestWarning(error) || isAttachmentNotFoundError(error);
}

function shouldEmitExpectedRequestWarning(error: AppError, request: FastifyRequest): boolean {
  pruneExpiredExpectedRequestWarnings();

  const now = Date.now();
  const warningKey = buildCompactRequestWarningKey(error, request);
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

function buildCompactRequestWarningKey(error: AppError, request: FastifyRequest): string {
  if (shouldLogAsExpectedRequestWarning(error)) {
    return [
      error.statusCode,
      error.errorCode,
      readAuthorizationFingerprint(request)
    ].join(":");
  }

  const attachmentParams = readAttachmentRequestParams(request);

  return [
    error.statusCode,
    error.errorCode,
    request.method,
    request.url,
    attachmentParams.sessionId ?? "unknown-session",
    attachmentParams.attachmentId ?? "unknown-attachment"
  ].join(":");
}

function logCompactRequestWarning(
  error: AppError,
  request: FastifyRequest,
  requestContext: {
    method: string;
    url: string;
    errorName: string;
    errorMessage: string;
  }
): void {
  if (!shouldEmitExpectedRequestWarning(error, request)) {
    return;
  }

  const payload = {
    ...requestContext,
    statusCode: error.statusCode,
    errorCode: error.errorCode,
    ...(isAttachmentNotFoundError(error) ? readAttachmentRequestParams(request) : {})
  };

  console.warn("[host-warning]", payload);
  request.log.warn(payload);
}

function isAttachmentNotFoundError(error: AppError): boolean {
  return error.statusCode === 404 && error.errorCode === "ATTACHMENT_NOT_FOUND";
}

function readAttachmentRequestParams(
  request: FastifyRequest
): {
  sessionId?: string;
  attachmentId?: string;
} {
  const params = request.params;

  if (!params || typeof params !== "object") {
    return {};
  }

  const candidate = params as Record<string, unknown>;
  const sessionId = typeof candidate.sessionId === "string" ? candidate.sessionId : undefined;
  const attachmentId = typeof candidate.attachmentId === "string" ? candidate.attachmentId : undefined;

  return {
    sessionId,
    attachmentId
  };
}
