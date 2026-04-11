import { describe, expect, it, vi } from "vitest";

import {
  registerSessionRoutes,
  SESSION_MESSAGE_BODY_LIMIT_BYTES
} from "../../src/routes/sessions.js";

function createRouteAppMock() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn()
  };
}

function createSessionControllerMock() {
  return {
    list: vi.fn(),
    getDetail: vi.fn(),
    getChangedFiles: vi.fn(),
    readMessages: vi.fn(),
    readAttachment: vi.fn(),
    getCapabilities: vi.fn(),
    listPermissionRequests: vi.fn(),
    listQueue: vi.fn(),
    getRuntime: vi.fn(),
    renameTitle: vi.fn(),
    updateArchiveState: vi.fn(),
    updateFavoriteState: vi.fn(),
    fork: vi.fn(),
    sendMessage: vi.fn(),
    sendLiveMessage: vi.fn(),
    replyPermissionRequest: vi.fn(),
    enqueueLiveMessage: vi.fn(),
    steerQueuedMessage: vi.fn(),
    interrupt: vi.fn(),
    markSeen: vi.fn(),
    resume: vi.fn(),
    start: vi.fn(),
    startLive: vi.fn(),
    deleteQueuedMessage: vi.fn()
  };
}

describe("session routes", () => {
  it("图片相关消息路由应该显式放宽 bodyLimit", async () => {
    const app = createRouteAppMock();
    const controller = createSessionControllerMock();

    await registerSessionRoutes(app as never, controller as never);

    expect(app.post).toHaveBeenCalledWith(
      "/api/sessions/:sessionId/messages/live",
      {
        bodyLimit: SESSION_MESSAGE_BODY_LIMIT_BYTES
      },
      controller.sendLiveMessage
    );
    expect(app.post).toHaveBeenCalledWith(
      "/api/sessions/:sessionId/queue",
      {
        bodyLimit: SESSION_MESSAGE_BODY_LIMIT_BYTES
      },
      controller.enqueueLiveMessage
    );
    expect(app.post).toHaveBeenCalledWith(
      "/api/sessions/start-live",
      {
        bodyLimit: SESSION_MESSAGE_BODY_LIMIT_BYTES
      },
      controller.startLive
    );
  });

  it("应该注册 fork 路由", async () => {
    const app = createRouteAppMock();
    const controller = createSessionControllerMock();

    await registerSessionRoutes(app as never, controller as never);

    expect(app.post).toHaveBeenCalledWith(
      "/api/sessions/:sessionId/forks",
      controller.fork
    );
  });
});
