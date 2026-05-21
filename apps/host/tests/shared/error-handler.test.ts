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
});

function createReply() {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis()
  } as unknown as {
    status: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
}

function createRequest(
  url: string,
  headers: Record<string, string> = {},
  params: Record<string, string> = {}
) {
  return {
    method: "GET",
    url,
    headers,
    params,
    log: {
      warn: vi.fn(),
      error: vi.fn()
    }
  } as const;
}
