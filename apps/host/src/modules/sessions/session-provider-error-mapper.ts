import { AppError } from "../../shared/errors/app-error.js";

export function mapSessionProviderError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error && error.message === "PROVIDER_NOT_SUPPORTED") {
    return new AppError({
      statusCode: 400,
      errorCode: "PROVIDER_NOT_SUPPORTED",
      detail: "当前 provider 不受支持"
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

  if (error instanceof Error && error.message === "PROVIDER_SESSION_NOT_FOUND") {
    return new AppError({
      statusCode: 404,
      errorCode: "PROVIDER_SESSION_NOT_FOUND",
      detail: "provider 会话不存在或已被删除",
      field: "sessionId"
    });
  }

  if (error instanceof Error && error.message === "PROVIDER_SESSION_ID_REQUIRED") {
    return new AppError({
      statusCode: 400,
      errorCode: "PROVIDER_SESSION_ID_REQUIRED",
      detail: "providerSessionId 不能为空",
      field: "providerSessionId"
    });
  }

  if (error instanceof Error && error.message === "SERVER_UNAVAILABLE") {
    return new AppError({
      statusCode: 503,
      errorCode: "PROVIDER_RUNTIME_UNAVAILABLE",
      detail: "provider 服务暂时不可用，请确认 OpenCode server 已启动且可访问"
    });
  }

  if (error instanceof Error && error.message === "SERVER_TIMEOUT") {
    return new AppError({
      statusCode: 503,
      errorCode: "PROVIDER_RUNTIME_TIMEOUT",
      detail: "provider 服务请求超时，请确认 OpenCode server 正在运行且响应正常"
    });
  }

  if (error instanceof Error && error.message === "OPENCODE_DB_NOT_FOUND") {
    return new AppError({
      statusCode: 404,
      errorCode: "OPENCODE_DB_NOT_FOUND",
      detail: "未找到 OpenCode 本地数据库，请检查 opencodeDbPath 配置"
    });
  }

  if (error instanceof Error && error.message === "OPENCODE_ARCHIVE_NOT_SUPPORTED") {
    return new AppError({
      statusCode: 400,
      errorCode: "OPENCODE_ARCHIVE_NOT_SUPPORTED",
      detail: "OpenCode 当前不支持归档状态回写"
    });
  }

  if (error instanceof Error && error.message === "OPENCODE_EVENT_STREAM_UNAVAILABLE") {
    return new AppError({
      statusCode: 503,
      errorCode: "PROVIDER_RUNTIME_UNAVAILABLE",
      detail: "OpenCode 事件流不可用，请检查 /event 接口是否可访问"
    });
  }

  if (error instanceof Error && error.message.startsWith("OPENCODE_HTTP_")) {
    return new AppError({
      statusCode: 502,
      errorCode: "PROVIDER_IO_ERROR",
      detail: error.message
    });
  }

  return new AppError({
    statusCode: 502,
    errorCode: "PROVIDER_IO_ERROR",
    detail: error instanceof Error ? error.message : "provider I/O 失败"
  });
}
