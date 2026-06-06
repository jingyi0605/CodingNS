import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AffairsLibraryController } from "../../src/modules/workspace/affairs-library-controller.js";
import type { TeableCatalogController } from "../../src/modules/workspace/teable-catalog-controller.js";
import type { TeableFieldMappingController } from "../../src/modules/workspace/teable-field-mapping-controller.js";
import type { TeableGlobalBindingController } from "../../src/modules/workspace/teable-global-binding-controller.js";
import type { TeableMirrorSyncController } from "../../src/modules/workspace/teable-mirror-sync-controller.js";
import type { TeableWorkbenchSyncConfigController } from "../../src/modules/workspace/teable-workbench-sync-config-controller.js";
import { registerAffairsRoutes } from "../../src/routes/affairs.js";
import { setErrorHandler } from "../../src/shared/http/error-handler.js";

describe("teable mirror sync routes", () => {
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
      updateGlobalFavorites: vi.fn(async (_request, reply) => reply.send({ items: [] })),
      getGlobalDashboardState: vi.fn(async (_request, reply) => reply.send({ items: [] })),
      updateGlobalDashboardState: vi.fn(async (_request, reply) => reply.send({ items: [] }))
    } as unknown as AffairsLibraryController;

    const teableBindingController = {
      getGlobalBinding: vi.fn(async (_request, reply) => reply.send({ enabled: false })),
      saveGlobalBinding: vi.fn(async (_request, reply) => reply.send({ ok: true })),
      getOverview: vi.fn(async (_request, reply) => reply.send({ status: "unbound" }))
    } as unknown as TeableGlobalBindingController;

    const teableMirrorSyncController = {
      getOverview: vi.fn(async (_request, reply) => reply.send({ latestMirrorSyncTask: null })),
      requestMirrorSync: vi.fn(async (_request, reply) => reply.send({ taskId: "task-1", state: "queued" })),
      listSyncLogs: vi.fn(async (_request, reply) => reply.send([]))
    } as unknown as TeableMirrorSyncController;

    const syncConfigController = {
      getConfigs: vi.fn(async (_request, reply) => reply.send([])),
      saveConfigs: vi.fn(async (_request, reply) => reply.send([]))
    } as unknown as TeableWorkbenchSyncConfigController;

    const teableCatalogController = {
      getTableCatalog: vi.fn(async (_request, reply) => reply.send([])),
      getTableFields: vi.fn(async (_request, reply) => reply.send([])),
      createTableFields: vi.fn(async (_request, reply) => reply.send([])),
    } as unknown as TeableCatalogController;

    const teableFieldMappingController = {
      getMappings: vi.fn(async (_request, reply) => reply.send({ mappings: [], sourceFieldsByType: {} })),
      saveMappings: vi.fn(async (_request, reply) => reply.send([]))
    } as unknown as TeableFieldMappingController;

    await registerAffairsRoutes(
      app,
      affairsController,
      teableBindingController,
      teableMirrorSyncController,
      syncConfigController,
      teableCatalogController,
      teableFieldMappingController
    );
    app.setErrorHandler(setErrorHandler);
    return { app, teableMirrorSyncController };
  }

  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      if (app) {
        await app.close();
      }
    }
  });

  it("会把 Teable 总览和镜像同步请求转给独立 controller", async () => {
    const { app, teableMirrorSyncController } = await createApp();

    const overviewResponse = await app.inject({
      method: "GET",
      url: "/api/affairs/teable/overview?workspaceId=workspace-1"
    });
    expect(overviewResponse.statusCode).toBe(200);
    expect(teableMirrorSyncController.getOverview).toHaveBeenCalledTimes(1);

    const syncResponse = await app.inject({
      method: "POST",
      url: "/api/affairs/teable/mirror-sync",
      payload: {
        workspaceId: "workspace-1",
        mirrorTypes: ["tags"]
      }
    });
    expect(syncResponse.statusCode).toBe(200);
    expect(teableMirrorSyncController.requestMirrorSync).toHaveBeenCalledTimes(1);

    const logsResponse = await app.inject({
      method: "GET",
      url: "/api/affairs/teable/sync-logs?limit=10"
    });
    expect(logsResponse.statusCode).toBe(200);
    expect(teableMirrorSyncController.listSyncLogs).toHaveBeenCalledTimes(1);
  });
});
