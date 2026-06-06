import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AffairsLibraryController } from "../../src/modules/workspace/affairs-library-controller.js";
import type { TeableRuntimeController } from "../../src/modules/workspace/teable-runtime-controller.js";
import { registerAffairsRoutes } from "../../src/routes/affairs.js";
import { setErrorHandler } from "../../src/shared/http/error-handler.js";

describe("teable runtime routes", () => {
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

    const runtimeController = {
      listTables: vi.fn(async (_request, reply) => reply.send({ tables: [] })),
      listViews: vi.fn(async (_request, reply) => reply.send({ views: [] })),
      listFields: vi.fn(async (_request, reply) => reply.send({ fields: [] })),
      listRecords: vi.fn(async (_request, reply) => reply.send({ records: [], skip: 0, take: 100 })),
      createRecord: vi.fn(async (_request, reply) => reply.send({ record: null })),
      updateRecord: vi.fn(async (_request, reply) => reply.send({ record: null })),
      deleteRecords: vi.fn(async (_request, reply) => reply.send({ deletedRecordIds: ["rec-1"] })),
      listLinkedRecordOptions: vi.fn(async (_request, reply) => reply.send({ options: [], skip: 0, take: 50, hasMore: false }))
    } as unknown as TeableRuntimeController;

    await registerAffairsRoutes(
      app,
      affairsController,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      runtimeController
    );
    app.setErrorHandler(setErrorHandler);
    return { app, runtimeController };
  }

  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      if (app) {
        await app.close();
      }
    }
  });

  it("把 runtime 读写请求转给 controller", async () => {
    const { app, runtimeController } = await createApp();

    const cases = [
      { method: "GET", url: "/api/affairs/teable/runtime/tables", handler: "listTables" },
      { method: "GET", url: "/api/affairs/teable/runtime/tables/tbl-1/views", handler: "listViews" },
      { method: "GET", url: "/api/affairs/teable/runtime/tables/tbl-1/fields", handler: "listFields" },
      { method: "GET", url: "/api/affairs/teable/runtime/tables/tbl-1/records?viewId=viw-1&take=20", handler: "listRecords" },
      { method: "POST", url: "/api/affairs/teable/runtime/tables/tbl-1/records", handler: "createRecord", payload: { fields: { fld_title: "新记录" } } },
      { method: "PATCH", url: "/api/affairs/teable/runtime/tables/tbl-1/records/rec-1", handler: "updateRecord", payload: { fields: { fld_title: "改名" } } },
      { method: "DELETE", url: "/api/affairs/teable/runtime/tables/tbl-1/records?recordIds=rec-1", handler: "deleteRecords" },
      { method: "GET", url: "/api/affairs/teable/runtime/tables/tbl-1/fields/fld_link/link-options?search=张", handler: "listLinkedRecordOptions" }
    ] as const;

    for (const item of cases) {
      const response = await app.inject({ method: item.method, url: item.url, payload: "payload" in item ? item.payload : undefined });
      expect(response.statusCode, `${item.method} ${item.url}`).toBe(200);
      expect(runtimeController[item.handler]).toHaveBeenCalledTimes(1);
    }
  });
});
