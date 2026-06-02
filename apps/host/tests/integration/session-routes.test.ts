import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionController } from "../../src/modules/sessions/session-controller.js";
import type { SessionHistoryService } from "../../src/modules/sessions/session-history-service.js";
import type { SessionLiveRuntimeService } from "../../src/modules/sessions/session-live-runtime-service.js";
import { registerSessionRoutes } from "../../src/routes/sessions.js";
import { AppError } from "../../src/shared/errors/app-error.js";
import { setErrorHandler } from "../../src/shared/http/error-handler.js";

describe("session routes", () => {
  const apps: FastifyInstance[] = [];

  async function createSessionApp(input: {
    sessionHistoryService?: Partial<SessionHistoryService>;
    sessionLiveRuntimeService?: Partial<SessionLiveRuntimeService>;
  }): Promise<FastifyInstance> {
    const controller = new SessionController(
      input.sessionHistoryService as SessionHistoryService,
      input.sessionLiveRuntimeService as SessionLiveRuntimeService,
      {
        listSessionIds: vi.fn(() => [])
      }
    );
    const app = Fastify({ logger: false });
    apps.push(app);
    app.addHook("onRequest", async (request) => {
      (request as any).auth = {
        accessToken: "token",
        user: {
          userId: "user-1",
          username: "admin",
          role: "admin"
        }
      };
    });
    await registerSessionRoutes(app, controller);
    app.setErrorHandler(setErrorHandler);
    return app;
  }

  function createProviderDisabledError(providerId = "codex"): AppError {
    return new AppError({
      statusCode: 409,
      errorCode: "PROVIDER_DISABLED",
      detail: `CLI provider ${providerId} 已被禁用`,
      data: {
        providerId
      }
    });
  }

  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();

      if (app) {
        await app.close();
      }
    }
  });

  it("provider 被禁用时，start|resume|send|fork 会统一返回 PROVIDER_DISABLED", async () => {
    const sessionHistoryService = {
      startSession: vi.fn(async () => {
        throw createProviderDisabledError();
      }),
      resumeSession: vi.fn(async () => {
        throw createProviderDisabledError();
      }),
      sendMessage: vi.fn(async () => {
        throw createProviderDisabledError();
      }),
      forkSession: vi.fn(async () => {
        throw createProviderDisabledError();
      })
    };
    const app = await createSessionApp({
      sessionHistoryService
    });

    const startResponse = await app.inject({
      method: "POST",
      url: "/api/sessions/start",
      payload: {
        workspaceId: "workspace-1",
        provider: "codex",
        initialPrompt: "开始新的会话"
      }
    });
    expect(startResponse.statusCode).toBe(409);
    expect(startResponse.json()).toMatchObject({
      error_code: "PROVIDER_DISABLED",
      data: {
        providerId: "codex"
      }
    });

    const resumeResponse = await app.inject({
      method: "POST",
      url: "/api/sessions/session-disabled/resume"
    });
    expect(resumeResponse.statusCode).toBe(409);
    expect(resumeResponse.json()).toMatchObject({
      error_code: "PROVIDER_DISABLED"
    });

    const sendResponse = await app.inject({
      method: "POST",
      url: "/api/sessions/session-disabled/messages",
      payload: {
        content: "继续"
      }
    });
    expect(sendResponse.statusCode).toBe(409);
    expect(sendResponse.json()).toMatchObject({
      error_code: "PROVIDER_DISABLED"
    });

    const forkResponse = await app.inject({
      method: "POST",
      url: "/api/sessions/session-disabled/forks",
      payload: {}
    });
    expect(forkResponse.statusCode).toBe(409);
    expect(forkResponse.json()).toMatchObject({
      error_code: "PROVIDER_DISABLED"
    });
  });

  it("provider 被禁用时，start-live 也会统一返回 PROVIDER_DISABLED", async () => {
    const sessionLiveRuntimeService = {
      startLiveSession: vi.fn(async () => {
        throw createProviderDisabledError();
      })
    };
    const app = await createSessionApp({
      sessionHistoryService: {},
      sessionLiveRuntimeService
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/sessions/start-live",
      payload: {
        workspaceId: "workspace-1",
        provider: "codex",
        content: "开始实时会话"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error_code: "PROVIDER_DISABLED",
      data: {
        providerId: "codex"
      }
    });
  });

  it("start-live 会把事务轻量会话可见性透传给 runtime service", async () => {
    const sessionLiveRuntimeService = {
      startLiveSession: vi.fn(async () => ({
        sessionId: "session-1",
        provider: "gemini",
        providerSessionId: "gemini-session-1",
        acceptedAt: "2026-06-02T10:00:00.000Z",
        clientRequestId: "client-1",
        message: {
          messageId: "message-1",
          provider: "gemini",
          providerSessionId: "gemini-session-1",
          role: "user",
          kind: "text",
          content: "开始实时会话",
          timestamp: "2026-06-02T10:00:00.000Z",
          sequence: 1,
          rawRef: "synthetic://gemini/session-1/client-1"
        }
      }))
    };
    const app = await createSessionApp({
      sessionHistoryService: {},
      sessionLiveRuntimeService
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/sessions/start-live",
      payload: {
        workspaceId: "workspace-1",
        provider: "gemini",
        content: "开始实时会话",
        sessionVisibility: "affairs_lightweight"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(sessionLiveRuntimeService.startLiveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        provider: "gemini",
        sessionVisibility: "affairs_lightweight"
      })
    );
  });

  it("stale session 的只读接口会软降级，不再返回错误", async () => {
    const missingSessionError = new AppError({
      statusCode: 404,
      errorCode: "SESSION_NOT_FOUND",
      detail: "session 不存在"
    });
    const missingIndexError = new AppError({
      statusCode: 500,
      errorCode: "SESSION_INDEX_MISSING",
      detail: "session 索引缺失"
    });
    const sessionHistoryService = {
      getSessionCapabilities: vi.fn(async () => {
        throw missingSessionError;
      })
    };
    const sessionLiveRuntimeService = {
      listPermissionRequests: vi.fn(async () => {
        throw missingIndexError;
      }),
      listQueuedMessages: vi.fn(async () => {
        throw missingIndexError;
      }),
      getSessionRuntime: vi.fn(async () => {
        throw missingSessionError;
      })
    };
    const app = await createSessionApp({
      sessionHistoryService,
      sessionLiveRuntimeService
    });

    const capabilitiesResponse = await app.inject({
      method: "GET",
      url: "/api/sessions/session-stale-1/capabilities"
    });
    expect(capabilitiesResponse.statusCode).toBe(200);
    expect(capabilitiesResponse.json()).toMatchObject({
      provider: "codex",
      canStartSession: false,
      canResumeSession: false,
      canSendMessage: false,
      limitations: ["session 已删除或不存在"]
    });

    const permissionResponse = await app.inject({
      method: "GET",
      url: "/api/sessions/session-stale-1/permission-requests"
    });
    expect(permissionResponse.statusCode).toBe(200);
    expect(permissionResponse.json()).toEqual({
      items: []
    });

    const queueResponse = await app.inject({
      method: "GET",
      url: "/api/sessions/session-stale-1/queue"
    });
    expect(queueResponse.statusCode).toBe(200);
    expect(queueResponse.json()).toEqual({
      items: []
    });

    const runtimeResponse = await app.inject({
      method: "GET",
      url: "/api/sessions/session-stale-1/runtime"
    });
    expect(runtimeResponse.statusCode).toBe(200);
    expect(runtimeResponse.json()).toMatchObject({
      sessionId: "session-stale-1",
      runningState: "completed",
      hasActiveRun: false,
      canInterrupt: false,
      errorCode: "SESSION_NOT_FOUND",
      errorDetail: "session 已删除或不存在"
    });
  });
});
