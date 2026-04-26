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
});
