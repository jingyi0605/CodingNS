import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AffairsLightweightSessionController } from "../../src/modules/workspace/affairs-lightweight-session-controller.js";
import type { AffairsLightweightSessionService } from "../../src/modules/workspace/affairs-lightweight-session-service.js";
import { WorkspaceController } from "../../src/modules/workspace/workspace-controller.js";
import type { AffairsLibraryController } from "../../src/modules/workspace/affairs-library-controller.js";
import type { WorkspaceService } from "../../src/modules/workspace/workspace-service.js";
import { registerWorkspaceRoutes } from "../../src/routes/workspaces.js";
import { setErrorHandler } from "../../src/shared/http/error-handler.js";

describe("affairs lightweight session routes", () => {
  const apps: FastifyInstance[] = [];

  async function createApp(serviceOverrides: Partial<AffairsLightweightSessionService>) {
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

    const workspaceController = new WorkspaceController({
      list: vi.fn(() => []),
      browseDirectories: vi.fn(() => ({ items: [] })),
      createDirectory: vi.fn(),
      importWorkspace: vi.fn(),
      cloneWorkspace: vi.fn(),
      getManagementSummary: vi.fn(),
      removeWorkspace: vi.fn(),
      reorderWorkspaces: vi.fn(() => []),
      updateNavigationState: vi.fn()
    } as unknown as WorkspaceService);
    const libraryController = {
      getBinding: vi.fn(),
      saveBinding: vi.fn(),
      setEnabled: vi.fn(),
      getConfig: vi.fn(),
      saveConfig: vi.fn(),
      getSnapshot: vi.fn(),
      listDocuments: vi.fn(),
      previewDocument: vi.fn(),
      downloadFile: vi.fn(),
      operateFile: vi.fn(),
      requestRefresh: vi.fn(),
      updateFavorites: vi.fn()
    } as unknown as AffairsLibraryController;
    const lightweightController = new AffairsLightweightSessionController({
      listSessions: vi.fn(async () => []),
      getSession: vi.fn(async () => null),
      readMessages: vi.fn(async () => ({ messages: [], cursor: null, nextCursor: null, total: 0 })),
      startSession: vi.fn(async () => null),
      sendMessage: vi.fn(async () => null),
      ...serviceOverrides
    } as unknown as AffairsLightweightSessionService);

    await registerWorkspaceRoutes(app, workspaceController, libraryController, lightweightController);
    app.setErrorHandler(setErrorHandler);
    return { app, lightweightController };
  }

  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      if (app) {
        await app.close();
      }
    }
  });

  it("会把事务轻量会话请求转给独立 controller", async () => {
    const service = {
      listSessions: vi.fn(async () => [{ sessionId: "light-1", title: "轻量对话" }]),
      startSession: vi.fn(async () => ({ session: { sessionId: "light-1" }, messages: [] })),
      sendMessage: vi.fn(async () => ({ session: { sessionId: "light-1" }, messages: [] })),
      getSession: vi.fn(async () => ({ sessionId: "light-1", title: "轻量对话" })),
      readMessages: vi.fn(async () => ({ messages: [], cursor: null, nextCursor: null, total: 0 }))
    };
    const { app } = await createApp(service);

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/workspaces/workspace-1/affairs/lightweight-sessions"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(service.listSessions).toHaveBeenCalledWith("workspace-1", "user-1");

    const startResponse = await app.inject({
      method: "POST",
      url: "/api/workspaces/workspace-1/affairs/lightweight-sessions",
      payload: {
        provider: "codex",
        content: "请总结今天的重点"
      }
    });
    expect(startResponse.statusCode).toBe(201);
    expect(service.startSession).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "codex",
      content: "请总结今天的重点"
    }));

    const sendResponse = await app.inject({
      method: "POST",
      url: "/api/workspaces/workspace-1/affairs/lightweight-sessions/light-1/messages",
      payload: {
        content: "继续"
      }
    });
    expect(sendResponse.statusCode).toBe(201);
    expect(service.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      sessionId: "light-1",
      userId: "user-1",
      content: "继续"
    }));
  });
});
