import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AffairsLibraryController } from "../../src/modules/workspace/affairs-library-controller.js";
import { registerAffairsRoutes } from "../../src/routes/affairs.js";
import { setErrorHandler } from "../../src/shared/http/error-handler.js";

describe("affairs library global routes", () => {
  const apps: FastifyInstance[] = [];

  async function createApp() {
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

    const controller = {
      getGlobalBinding: vi.fn(async (_request, reply) => {
        reply.send({
          workspaceId: null,
          rootDir: "/Users/jackson/WorkFile",
          enabled: true,
          mirrorRoot: null,
          allowedExtensions: [".md"],
          includedHiddenPaths: [],
          configRelativePath: ".ai-index/doc-semantic-index.config.json",
          exportMode: "v2",
          updatedAt: "2026-06-03T08:00:00.000Z"
        });
      }),
      saveGlobalBinding: vi.fn(async (_request, reply) => {
        reply.send({ ok: true });
      }),
      setGlobalEnabled: vi.fn(async (_request, reply) => {
        reply.send({ ok: true });
      }),
      updateGlobalFavorites: vi.fn(async (_request, reply) => {
        reply.send({ items: [] });
      }),
      getGlobalDashboardState: vi.fn(async (_request, reply) => {
        reply.send({ dashboardState: { workspaceId: "affairs-global", tabs: [] } });
      }),
      updateGlobalDashboardState: vi.fn(async (_request, reply) => {
        reply.send({ dashboardState: { workspaceId: "affairs-global", tabs: [] } });
      }),
      getSnapshot: vi.fn(async (request, reply) => {
        reply.send({ workspaceId: (request.params as any).workspaceId });
      }),
      listDocuments: vi.fn(async (request, reply) => {
        reply.send({ workspaceId: (request.params as any).workspaceId, items: [] });
      })
    } as unknown as AffairsLibraryController;

    await registerAffairsRoutes(app, controller);
    app.setErrorHandler(setErrorHandler);
    return { app, controller };
  }

  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      if (app) {
        await app.close();
      }
    }
  });

  it("会把全局事务文档库请求转给独立 controller", async () => {
    const { app, controller } = await createApp();

    const getResponse = await app.inject({
      method: "GET",
      url: "/api/affairs/library-binding"
    });
    expect(getResponse.statusCode).toBe(200);
    expect(controller.getGlobalBinding).toHaveBeenCalledTimes(1);

    const saveResponse = await app.inject({
      method: "PUT",
      url: "/api/affairs/library-binding",
      payload: {
        rootDir: "/Users/jackson/WorkFile"
      }
    });
    expect(saveResponse.statusCode).toBe(200);
    expect(controller.saveGlobalBinding).toHaveBeenCalledTimes(1);

    const enabledResponse = await app.inject({
      method: "PUT",
      url: "/api/affairs/library-enabled",
      payload: {
        enabled: true
      }
    });
    expect(enabledResponse.statusCode).toBe(200);
    expect(controller.setGlobalEnabled).toHaveBeenCalledTimes(1);

    const favoritesResponse = await app.inject({
      method: "PUT",
      url: "/api/affairs/library-favorites",
      payload: {
        favorites: []
      }
    });
    expect(favoritesResponse.statusCode).toBe(200);
    expect(controller.updateGlobalFavorites).toHaveBeenCalledTimes(1);

    const dashboardStateResponse = await app.inject({
      method: "GET",
      url: "/api/affairs/dashboard-state"
    });
    expect(dashboardStateResponse.statusCode).toBe(200);
    expect(controller.getGlobalDashboardState).toHaveBeenCalledTimes(1);

    const updateDashboardStateResponse = await app.inject({
      method: "PUT",
      url: "/api/affairs/dashboard-state",
      payload: {
        dashboardState: {
          workspaceId: "affairs-global",
          tabs: []
        }
      }
    });
    expect(updateDashboardStateResponse.statusCode).toBe(200);
    expect(controller.updateGlobalDashboardState).toHaveBeenCalledTimes(1);

    const snapshotResponse = await app.inject({
      method: "GET",
      url: "/api/affairs/library-snapshot"
    });
    expect(snapshotResponse.statusCode).toBe(200);
    expect(controller.getSnapshot).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ workspaceId: "affairs-global" })
      }),
      expect.anything()
    );

    const documentsResponse = await app.inject({
      method: "GET",
      url: "/api/affairs/library-documents?browseMode=folder"
    });
    expect(documentsResponse.statusCode).toBe(200);
    expect(controller.listDocuments).toHaveBeenCalledTimes(1);
    expect(controller.listDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ workspaceId: "affairs-global" })
      }),
      expect.anything()
    );
  });
});
