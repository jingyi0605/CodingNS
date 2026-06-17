import { describe, expect, it, vi } from "vitest";

import { AppError } from "../../src/shared/errors/app-error.js";
import { setErrorHandler } from "../../src/shared/http/error-handler.js";

describe("setErrorHandler", () => {
  it("401 鉴权错误只记 warning，不输出整段 host-error", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reply = createReply();
    const request = createRequest("/api/client/runtime-config?platform=desktop", {
      authorization: "Bearer stale-access-token-1"
    });
    const error = new AppError({
      statusCode: 401,
      errorCode: "UNAUTHORIZED",
      detail: "access token 无效"
    });

    setErrorHandler(error, request, reply);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[host-warning]",
      expect.objectContaining({
        timestamp: expect.any(String),
        method: "GET",
        url: "/api/client/runtime-config?platform=desktop",
        statusCode: 401,
        errorCode: "UNAUTHORIZED"
      })
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(request.log.warn).toHaveBeenCalledTimes(1);
    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        error_code: "UNAUTHORIZED",
        detail: "access token 无效"
      })
    );
  });

  it("同一个失效 token 的连续 401 warning 会短时去重", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const firstReply = createReply();
    const secondReply = createReply();
    const firstRequest = createRequest("/api/client/runtime-config?platform=desktop", {
      authorization: "Bearer stale-access-token-2"
    });
    const secondRequest = createRequest("/api/providers/catalog", {
      authorization: "Bearer stale-access-token-2"
    });
    const error = new AppError({
      statusCode: 401,
      errorCode: "UNAUTHORIZED",
      detail: "access token 无效"
    });

    setErrorHandler(error, firstRequest, firstReply);
    setErrorHandler(error, secondRequest, secondReply);

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(firstRequest.log.warn).toHaveBeenCalledTimes(1);
    expect(secondRequest.log.warn).not.toHaveBeenCalled();
    expect(firstReply.status).toHaveBeenCalledWith(401);
    expect(secondReply.status).toHaveBeenCalledWith(401);
  });

  it("非预期错误仍然输出 host-error", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reply = createReply();
    const request = createRequest("/api/demo");
    const error = new Error("boom");

    setErrorHandler(error, request, reply);

    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[host-error]",
      expect.objectContaining({
        timestamp: expect.any(String),
        method: "GET",
        url: "/api/demo",
        errorName: "Error",
        errorMessage: "boom"
      }),
      error
    );
    expect(request.log.error).toHaveBeenCalledWith(error);
    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        error_code: "INTERNAL_ERROR"
      })
    );
  });

  it("请求体超出上限时返回明确原因和限制说明", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reply = createReply();
    const request = createRequest(
      "/api/sessions/session-1/messages/live",
      {},
      {},
      {
        url: "/api/sessions/:sessionId/messages/live"
      }
    );
    const error = Object.assign(new Error("Request body is too large"), {
      name: "FastifyError",
      code: "FST_ERR_CTP_BODY_TOO_LARGE",
      statusCode: 413
    });

    setErrorHandler(error, request, reply);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[host-warning]",
      expect.objectContaining({
        method: "GET",
        url: "/api/sessions/session-1/messages/live",
        statusCode: 413,
        errorCode: "REQUEST_BODY_TOO_LARGE"
      })
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(reply.status).toHaveBeenCalledWith(413);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        error_code: "REQUEST_BODY_TOO_LARGE",
        field: "body",
        detail: expect.stringContaining("64 MiB"),
        data: expect.objectContaining({
          routeUrl: "/api/sessions/:sessionId/messages/live",
          bodyLimitBytes: 67108864
        })
      })
    );
  });

  it("响应已经发出时不会再次写 header", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reply = createReply({
      sent: true,
      raw: {
        headersSent: true
      }
    });
    const request = createRequest("/api/demo");
    const error = new Error("boom-after-send");

    setErrorHandler(error, request, reply);

    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(request.log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "响应已发送，跳过重复错误回写",
        method: "GET",
        url: "/api/demo",
        errorName: "Error",
        errorMessage: "boom-after-send"
      })
    );
    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it("附件不存在只记简化 warning，不输出整段 host-error", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reply = createReply();
    const request = createRequest(
      "/api/sessions/session-1/attachments/attachment-1/content",
      {},
      {
        sessionId: "session-1",
        attachmentId: "attachment-1"
      }
    );
    const error = new AppError({
      statusCode: 404,
      errorCode: "ATTACHMENT_NOT_FOUND",
      detail: "未找到对应的附件",
      field: "attachmentId"
    });

    setErrorHandler(error, request, reply);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[host-warning]",
      expect.objectContaining({
        timestamp: expect.any(String),
        method: "GET",
        url: "/api/sessions/session-1/attachments/attachment-1/content",
        statusCode: 404,
        errorCode: "ATTACHMENT_NOT_FOUND",
        sessionId: "session-1",
        attachmentId: "attachment-1"
      })
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(request.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "ATTACHMENT_NOT_FOUND",
        sessionId: "session-1",
        attachmentId: "attachment-1"
      })
    );
  });

  it("文档库未启用的预览请求不输出 host-error 和 warning", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reply = createReply();
    const request = createRequest("/api/affairs/library-preview?path=demo.html");
    const error = new AppError({
      statusCode: 409,
      errorCode: "AFFAIRS_LIBRARY_DISABLED",
      detail: "文档库功能还没有启用，启用后才会启动内置索引服务。"
    });

    setErrorHandler(error, request, reply);

    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(request.log.warn).not.toHaveBeenCalled();
    expect(request.log.error).not.toHaveBeenCalled();
    expect(reply.status).toHaveBeenCalledWith(409);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        error_code: "AFFAIRS_LIBRARY_DISABLED"
      })
    );
  });
});

function createReply(overrides: Partial<{
  sent: boolean;
  raw: {
    headersSent: boolean;
  };
}> = {}) {
  return {
    sent: false,
    raw: {
      headersSent: false
    },
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    ...overrides
  } as unknown as {
    sent: boolean;
    raw: {
      headersSent: boolean;
    };
    status: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
}

function createRequest(
  url: string,
  headers: Record<string, string> = {},
  params: Record<string, string> = {},
  routeOptions: Record<string, unknown> = {}
) {
  return {
    method: "GET",
    url,
    headers,
    params,
    routeOptions,
    log: {
      warn: vi.fn(),
      error: vi.fn()
    }
  } as const;
}
