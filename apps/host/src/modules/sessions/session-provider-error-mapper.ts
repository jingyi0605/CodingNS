import { AppError } from "../../shared/errors/app-error.js";

export function mapSessionProviderError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error && error.message === "PROVIDER_NOT_SUPPORTED") {
    return new AppError({
      statusCode: 400,
      errorCode: "PROVIDER_NOT_SUPPORTED",
      detail: "当前仅支持 claude-code 和 codex provider"
    });
  }

  if (error instanceof Error && error.message === "CURSOR_INVALID") {
    return new AppError({
      statusCode: 400,
      errorCode: "CURSOR_INVALID",
      detail: "cursor 无效",
      field: "cursor"
    });
  }

  return new AppError({
    statusCode: 502,
    errorCode: "PROVIDER_IO_ERROR",
    detail: error instanceof Error ? error.message : "provider I/O 失败"
  });
}
