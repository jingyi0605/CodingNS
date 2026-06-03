import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuthGuard } from "../../src/middlewares/auth-guard.js";
import type { AuthService } from "../../src/modules/auth/auth-service.js";
import { registerOfficeRoutes } from "../../src/routes/office.js";
import { setErrorHandler } from "../../src/shared/http/error-handler.js";

describe("auth guard public routes", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      if (app) {
        await app.close();
      }
    }
  });

  it("ONLYOFFICE callback 路由允许匿名访问", async () => {
    const authService = {
      ensureInitialized: vi.fn(),
      authenticateAccessToken: vi.fn()
    } as unknown as AuthService;
    const longToken = `${"a".repeat(180)}.${"b".repeat(43)}`;
    const callbackSpy = vi.fn(async () => ({ error: 0 as const }));

    const app = Fastify({ logger: false });
    apps.push(app);
    app.addHook("onRequest", createAuthGuard(authService));
    await registerOfficeRoutes(
      app,
      {
        getOnlyOfficeSettings: async () => undefined,
        updateOnlyOfficeSettings: async () => undefined,
        getOnlyOfficeStatus: async () => undefined,
        handleOnlyOfficeCallback: callbackSpy,
        listTasks: async () => undefined,
        createTask: async () => undefined,
        getTask: async () => undefined,
        createArtifactPreviewLink: async () => undefined,
        readArtifactContent: async () => undefined,
        createTaskFilePreviewLink: async () => undefined,
        readArtifactFileContent: async () => undefined,
        readArtifactPreview: async () => undefined,
        readArtifactTaskFilePreview: async () => undefined,
        cancelTask: async () => undefined,
        retryTask: async () => undefined,
        listConnectors: async () => undefined,
        replyApproval: async () => undefined
      } as never
    );
    app.setErrorHandler(setErrorHandler);

    const response = await app.inject({
      method: "POST",
      url: `/api/office/onlyoffice/callback/${longToken}`,
      payload: {
        status: 2,
        url: "https://example.com/result.docx"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ error: 0 });
    expect(callbackSpy).toHaveBeenCalledTimes(1);
    expect(authService.ensureInitialized).not.toHaveBeenCalled();
    expect(authService.authenticateAccessToken).not.toHaveBeenCalled();
  });
});
