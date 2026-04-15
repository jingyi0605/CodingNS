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

  if (error instanceof Error && error.message === "PROVIDER_FORK_NOT_SUPPORTED") {
    return new AppError({
      statusCode: 400,
      errorCode: "PROVIDER_FORK_NOT_SUPPORTED",
      detail: "当前 provider 还没有接入统一 fork 能力"
    });
  }

  if (error instanceof Error && error.message === "FORK_TARGET_PROVIDER_NOT_SUPPORTED") {
    return new AppError({
      statusCode: 400,
      errorCode: "FORK_TARGET_PROVIDER_NOT_SUPPORTED",
      detail: "目标 provider 当前还不支持跨供应商分叉"
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

  if (error instanceof Error && error.message === "FORK_SOURCE_MESSAGE_NOT_FOUND") {
    return new AppError({
      statusCode: 404,
      errorCode: "FORK_SOURCE_MESSAGE_NOT_FOUND",
      detail: "未找到指定的 fork 来源消息",
      field: "sourceMessageId"
    });
  }

  if (error instanceof Error && error.message === "FORK_SOURCE_MESSAGE_ID_REQUIRED") {
    return new AppError({
      statusCode: 400,
      errorCode: "FORK_SOURCE_MESSAGE_ID_REQUIRED",
      detail: "按消息派生时必须提供 sourceMessageId",
      field: "sourceMessageId"
    });
  }

  if (error instanceof Error && error.message === "CODEX_RECONSTRUCTED_MESSAGE_FORK_NOT_SUPPORTED") {
    return new AppError({
      statusCode: 400,
      errorCode: "CODEX_RECONSTRUCTED_MESSAGE_FORK_NOT_SUPPORTED",
      detail: "Codex 当前只支持原生消息级派生，不支持重建型消息 fork"
    });
  }

  if (error instanceof Error && error.message === "CODEX_FORK_TRANSPORT_NOT_CONFIGURED") {
    return new AppError({
      statusCode: 503,
      errorCode: "CODEX_FORK_TRANSPORT_NOT_CONFIGURED",
      detail: "Codex fork helper 未配置，暂时无法执行会话分叉"
    });
  }

  if (error instanceof Error && error.message === "CODEX_THREAD_HISTORY_MISSING") {
    return new AppError({
      statusCode: 502,
      errorCode: "PROVIDER_IO_ERROR",
      detail: "Codex thread/read 没有返回可用于消息级派生的历史数据"
    });
  }

  if (error instanceof Error && error.message === "CODEX_FORK_SOURCE_MESSAGE_UNMAPPABLE") {
    return new AppError({
      statusCode: 409,
      errorCode: "FORK_SOURCE_MESSAGE_NOT_FOUND",
      detail: "当前消息点无法映射到 Codex 原生历史，暂时不能从这里分叉",
      field: "sourceMessageId"
    });
  }

  if (error instanceof Error && error.message === "CODEX_FORK_HISTORY_EMPTY") {
    return new AppError({
      statusCode: 409,
      errorCode: "PROVIDER_IO_ERROR",
      detail: "Codex 返回的历史为空，当前会话暂时不能派生新分支"
    });
  }

  if (error instanceof Error && error.message === "CODEX_NATIVE_MESSAGE_FORK_DIRTY") {
    return new AppError({
      statusCode: 502,
      errorCode: "CODEX_NATIVE_MESSAGE_FORK_DIRTY",
      detail: "Codex 原生消息 fork 后，provider 子线程没有正确停在所选消息点，请重试或稍后再试"
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

  if (error instanceof Error && error.message === "OPENCODE_SESSION_DIRECTORY_MISMATCH") {
    return new AppError({
      statusCode: 409,
      errorCode: "OPENCODE_SESSION_DIRECTORY_MISMATCH",
      detail: "OpenCode 新建会话后返回了错误的工作区目录，已拒绝继续使用这个会话"
    });
  }

  if (error instanceof Error && error.message === "SESSION_BINDING_WORKSPACE_CONFLICT") {
    return new AppError({
      statusCode: 409,
      errorCode: "SESSION_BINDING_WORKSPACE_CONFLICT",
      detail: "provider 会话已经绑定到其他工作区，系统已拒绝把两个工作区的会话混在一起"
    });
  }

  if (error instanceof Error && error.message === "GEMINI_CHAT_NOT_FOUND") {
    return new AppError({
      statusCode: 404,
      errorCode: "GEMINI_CHAT_NOT_FOUND",
      detail: "未找到 Gemini 本地 chats 对应会话，请先确认 session id 和本地目录是否一致"
    });
  }

  if (error instanceof Error && error.message.startsWith("GEMINI_CHAT_SCHEMA_INVALID")) {
    return new AppError({
      statusCode: 422,
      errorCode: "GEMINI_CHAT_SCHEMA_INVALID",
      detail: error.message
    });
  }

  if (error instanceof Error && error.message.startsWith("KIMI_RUNTIME_FALLBACK_FAILED")) {
    return new AppError({
      statusCode: 503,
      errorCode: "KIMI_RUNTIME_FALLBACK_FAILED",
      detail: "Kimi wire 与命令模式 fallback 均不可用，请检查 CLI 版本和本地配置"
    });
  }

  if (error instanceof Error && error.message.startsWith("KIMI_WIRE_MODE_UNAVAILABLE")) {
    return new AppError({
      statusCode: 503,
      errorCode: "KIMI_WIRE_MODE_UNAVAILABLE",
      detail: "Kimi wire 模式暂不可用，系统已尝试 fallback"
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
