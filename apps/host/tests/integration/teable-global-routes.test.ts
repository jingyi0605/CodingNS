import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AffairsTagController } from "../../src/modules/workspace/affairs-tag-controller.js";
import type { AffairsLibraryController } from "../../src/modules/workspace/affairs-library-controller.js";
import type { TeableCatalogController } from "../../src/modules/workspace/teable-catalog-controller.js";
import type { TeableFieldMappingController } from "../../src/modules/workspace/teable-field-mapping-controller.js";
import type { TeableGlobalBindingController } from "../../src/modules/workspace/teable-global-binding-controller.js";
import type { TeableMirrorSyncController } from "../../src/modules/workspace/teable-mirror-sync-controller.js";
import type { TeableWorkbenchSyncConfigController } from "../../src/modules/workspace/teable-workbench-sync-config-controller.js";
import { registerAffairsRoutes } from "../../src/routes/affairs.js";
import { setErrorHandler } from "../../src/shared/http/error-handler.js";

describe("teable global routes", () => {
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
      getGlobalDashboardState: vi.fn(async (_request, reply) => reply.send({ dashboardState: {} })),
      updateGlobalDashboardState: vi.fn(async (_request, reply) => reply.send({ dashboardState: {} }))
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
      getMappings: vi.fn(async (_request, reply) => reply.send({ mappings: [], sourceFieldsByType: { tags: [], sessions: [], todos: [] } })),
      saveMappings: vi.fn(async (_request, reply) => reply.send([]))
    } as unknown as TeableFieldMappingController;

    const affairsTagController = {
      listGlobalTags: vi.fn(async (_request, reply) => reply.send({ items: [] }))
    } as unknown as AffairsTagController;

    await registerAffairsRoutes(
      app,
      affairsController,
      teableBindingController,
      teableMirrorSyncController,
      syncConfigController,
      teableCatalogController,
      teableFieldMappingController,
      affairsTagController
    );
    app.setErrorHandler(setErrorHandler);
    return { app, teableBindingController, teableMirrorSyncController, teableCatalogController, affairsTagController };
  }

  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      if (app) {
        await app.close();
      }
    }
  });

  it("会把 Teable 全局绑定请求转给独立 controller", async () => {
    const { app, teableBindingController, teableMirrorSyncController, teableCatalogController, affairsTagController } = await createApp();

    const getResponse = await app.inject({
      method: "GET",
      url: "/api/affairs/teable/global-binding"
    });
    expect(getResponse.statusCode).toBe(200);
    expect(teableBindingController.getGlobalBinding).toHaveBeenCalledTimes(1);

    const saveResponse = await app.inject({
      method: "PUT",
      url: "/api/affairs/teable/global-binding",
      payload: {
        baseUrl: "https://teable.example.com",
        spaceId: "space-1",
        baseId: "base-1",
        authRef: "secret://teable/token",
        enabled: true,
        mirrorMode: "manual"
      }
    });
    expect(saveResponse.statusCode).toBe(200);
    expect(teableBindingController.saveGlobalBinding).toHaveBeenCalledTimes(1);

    const overviewResponse = await app.inject({
      method: "GET",
      url: "/api/affairs/teable/overview"
    });
    expect(overviewResponse.statusCode).toBe(200);
    expect(teableMirrorSyncController.getOverview).toHaveBeenCalledTimes(1);

    const createFieldsResponse = await app.inject({
      method: "POST",
      url: "/api/affairs/teable/table-fields",
      payload: {
        tableId: "tbl-1",
        fields: [{ sourceField: "title", fieldName: "标题", fieldType: "singleLineText" }]
      }
    });
    expect(createFieldsResponse.statusCode).toBe(200);
    expect(teableCatalogController.createTableFields).toHaveBeenCalledTimes(1);

    const tableCatalogResponse = await app.inject({
      method: "GET",
      url: "/api/affairs/teable/table-catalog"
    });
    expect(tableCatalogResponse.statusCode).toBe(200);
    expect(teableCatalogController.getTableCatalog).toHaveBeenCalledTimes(1);

    const tagsResponse = await app.inject({
      method: "GET",
      url: "/api/affairs/tags?includeDisabled=true"
    });
    expect(tagsResponse.statusCode).toBe(200);
    expect(affairsTagController.listGlobalTags).toHaveBeenCalledTimes(1);
  });
});
