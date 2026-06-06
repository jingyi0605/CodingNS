import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AffairsLibraryController } from "../../src/modules/workspace/affairs-library-controller.js";
import type { TeableGlobalBindingController } from "../../src/modules/workspace/teable-global-binding-controller.js";
import type { TeableWorkbenchSyncConfigController } from "../../src/modules/workspace/teable-workbench-sync-config-controller.js";
import { registerAffairsRoutes } from "../../src/routes/affairs.js";
import { setErrorHandler } from "../../src/shared/http/error-handler.js";

describe("teable workbench sync config routes", () => {
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

    const affairsController = {
      getGlobalBinding: vi.fn(async (_request, reply) => reply.send({ ok: true })),
      saveGlobalBinding: vi.fn(async (_request, reply) => reply.send({ ok: true })),
      setGlobalEnabled: vi.fn(async (_request, reply) => reply.send({ ok: true })),
      updateGlobalFavorites: vi.fn(async (_request, reply) => reply.send({ items: [] }))
    } as unknown as AffairsLibraryController;

    const teableBindingController = {
      getGlobalBinding: vi.fn(async (_request, reply) => reply.send({ enabled: false })),
      saveGlobalBinding: vi.fn(async (_request, reply) => reply.send({ ok: true })),
      getOverview: vi.fn(async (_request, reply) => reply.send({ status: "unbound" }))
    } as unknown as TeableGlobalBindingController;

    const syncConfigController = {
      getConfigs: vi.fn(async (_request, reply) => reply.send([])),
      saveConfigs: vi.fn(async (_request, reply) => reply.send([]))
    } as unknown as TeableWorkbenchSyncConfigController;

    await registerAffairsRoutes(app, affairsController, teableBindingController, syncConfigController);
    app.setErrorHandler(setErrorHandler);
    return { app, syncConfigController };
  }

  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      if (app) {
        await app.close();
      }
    }
  });

  it("会把工作台推送配置请求转给独立 controller", async () => {
    const { app, syncConfigController } = await createApp();

    const getResponse = await app.inject({
      method: "GET",
      url: "/api/affairs/teable/workbench-sync-config"
    });
    expect(getResponse.statusCode).toBe(200);
    expect(syncConfigController.getConfigs).toHaveBeenCalledTimes(1);

    const saveResponse = await app.inject({
      method: "PUT",
      url: "/api/affairs/teable/workbench-sync-config",
      payload: {
        items: [
          {
            sourceType: "tags",
            enabled: true,
            scope: { mode: "manual_selection" },
            targetTableId: "tbl_tags"
          }
        ]
      }
    });
    expect(saveResponse.statusCode).toBe(200);
    expect(syncConfigController.saveConfigs).toHaveBeenCalledTimes(1);
  });
});
