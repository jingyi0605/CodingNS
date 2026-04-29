import { AppError } from "../../../shared/errors/app-error.js";

export function invalidWechatClawInput(detail: string, field?: string): AppError {
  return new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    detail,
    field
  });
}

export function wechatClawStateError(detail: string): AppError {
  return new AppError({
    statusCode: 409,
    errorCode: "WECHAT_CLAW_RUNTIME_STATE_INVALID",
    detail
  });
}

export function wechatClawUpstreamError(
  detail: string,
  data?: Record<string, unknown>
): AppError {
  return new AppError({
    statusCode: 502,
    errorCode: "WECHAT_CLAW_UPSTREAM_ERROR",
    detail,
    data
  });
}

export function wechatClawAuthError(detail: string): AppError {
  return new AppError({
    statusCode: 401,
    errorCode: "WECHAT_CLAW_RUNTIME_UNAUTHORIZED",
    detail
  });
}
