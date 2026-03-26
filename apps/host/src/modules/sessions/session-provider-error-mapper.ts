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

  if (error instanceof Error && error.message === "ACTIVE_RUN_EXISTS") {
    return new AppError({
      statusCode: 409,
      errorCode: "ACTIVE_RUN_EXISTS",
      detail: "当前会话已经有一条运行中的执行链，不能重复启动",
      field: "sessionId"
    });
  }

  if (error instanceof Error && error.message === "IN_RUN_INPUT_NOT_SUPPORTED") {
    return new AppError({
      statusCode: 409,
      errorCode: "IN_RUN_INPUT_NOT_SUPPORTED",
      detail: "当前会话正在运行，但当前 provider 还不支持在运行中继续输入",
      field: "sessionId"
    });
  }

  return new AppError({
    statusCode: 502,
    errorCode: "PROVIDER_IO_ERROR",
    detail: error instanceof Error ? error.message : "provider I/O 失败"
  });
}
