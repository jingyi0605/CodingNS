import type { FastifyInstance } from "fastify";

import type { AffairsTagController } from "../modules/workspace/affairs-tag-controller.js";
import type { AffairsLibraryController } from "../modules/workspace/affairs-library-controller.js";
import type { AffairsLightweightSessionController } from "../modules/workspace/affairs-lightweight-session-controller.js";
import { AFFAIRS_GLOBAL_WORKSPACE_ID } from "../modules/workspace/affairs-library-service.js";
import type { TeableCatalogController } from "../modules/workspace/teable-catalog-controller.js";
import type { TeableFieldMappingController } from "../modules/workspace/teable-field-mapping-controller.js";
import type { TeableGlobalBindingController } from "../modules/workspace/teable-global-binding-controller.js";
import type { TeableMirrorSyncController } from "../modules/workspace/teable-mirror-sync-controller.js";
import type { TeableWorkbenchSyncConfigController } from "../modules/workspace/teable-workbench-sync-config-controller.js";

export async function registerAffairsRoutes(
  app: FastifyInstance,
  affairsLibraryController: AffairsLibraryController,
  teableGlobalBindingController?: TeableGlobalBindingController,
  teableMirrorSyncController?: TeableMirrorSyncController,
  teableWorkbenchSyncConfigController?: TeableWorkbenchSyncConfigController,
  teableCatalogController?: TeableCatalogController,
  teableFieldMappingController?: TeableFieldMappingController,
  affairsTagController?: AffairsTagController,
  affairsLightweightSessionController?: AffairsLightweightSessionController
): Promise<void> {
  const withGlobalWorkspace = <TRequest extends { params?: unknown }>(handler: (request: TRequest, reply: any) => Promise<void>) => {
    return async (request: TRequest, reply: any) => {
      (request as { params: Record<string, string> }).params = {
        ...((request.params ?? {}) as Record<string, string>),
        workspaceId: AFFAIRS_GLOBAL_WORKSPACE_ID
      };
      await handler(request, reply);
    };
  };

  const unavailableController = {
    getGlobalBinding: async (_request: any, reply: any) => reply.code(501).send({ detail: "当前事务接口没有注入 controller" }),
    saveGlobalBinding: async (_request: any, reply: any) => reply.code(501).send({ detail: "当前事务接口没有注入 controller" }),
    getOverview: async (_request: any, reply: any) => reply.code(501).send({ detail: "当前事务接口没有注入 controller" }),
    requestMirrorSync: async (_request: any, reply: any) => reply.code(501).send({ detail: "当前事务接口没有注入 controller" }),
    listSyncLogs: async (_request: any, reply: any) => reply.send([]),
    getConfigs: async (_request: any, reply: any) => reply.send([]),
    saveConfigs: async (_request: any, reply: any) => reply.send([]),
    getTableCatalog: async (_request: any, reply: any) => reply.send([]),
    getTableFields: async (_request: any, reply: any) => reply.send([]),
    createTableFields: async (_request: any, reply: any) => reply.code(501).send({ detail: "当前事务接口没有注入 controller" }),
    getMappings: async (_request: any, reply: any) => reply.send({ mappings: [], sourceFieldsByType: { tags: [], sessions: [], todos: [] } }),
    saveMappings: async (_request: any, reply: any) => reply.send([])
  };
  const legacySyncConfigController = teableMirrorSyncController && "getConfigs" in teableMirrorSyncController
    ? teableMirrorSyncController as unknown as TeableWorkbenchSyncConfigController
    : null;
  const normalizedTeableMirrorSyncController = legacySyncConfigController ? undefined : teableMirrorSyncController;
  const normalizedTeableWorkbenchSyncConfigController = legacySyncConfigController ?? teableWorkbenchSyncConfigController;
  const teableGlobal = teableGlobalBindingController ?? unavailableController as unknown as TeableGlobalBindingController;
  const teableMirror = normalizedTeableMirrorSyncController ?? unavailableController as unknown as TeableMirrorSyncController;
  const teableSyncConfig = normalizedTeableWorkbenchSyncConfigController ?? unavailableController as unknown as TeableWorkbenchSyncConfigController;
  const teableCatalog = teableCatalogController ?? unavailableController as unknown as TeableCatalogController;
  const teableFieldMapping = teableFieldMappingController ?? unavailableController as unknown as TeableFieldMappingController;

  app.get("/api/affairs/library-binding", affairsLibraryController.getGlobalBinding);
  app.put("/api/affairs/library-binding", affairsLibraryController.saveGlobalBinding);
  app.put("/api/affairs/library-enabled", affairsLibraryController.setGlobalEnabled);
  app.get("/api/affairs/library-config", withGlobalWorkspace(affairsLibraryController.getConfig));
  app.put("/api/affairs/library-config", withGlobalWorkspace(affairsLibraryController.saveConfig));
  app.get("/api/affairs/library-snapshot", withGlobalWorkspace(affairsLibraryController.getSnapshot));
  app.get("/api/affairs/library-documents", withGlobalWorkspace(affairsLibraryController.listDocuments));
  app.get("/api/affairs/library-files", withGlobalWorkspace(affairsLibraryController.listFiles));
  app.get("/api/affairs/library-preview", withGlobalWorkspace(affairsLibraryController.previewDocument));
  app.get("/api/affairs/library-download", withGlobalWorkspace(affairsLibraryController.downloadFile));
  app.post("/api/affairs/library-ops", withGlobalWorkspace(affairsLibraryController.operateFile));
  app.post("/api/affairs/library-refresh", withGlobalWorkspace(affairsLibraryController.requestRefresh));
  app.put("/api/affairs/library-favorites", affairsLibraryController.updateGlobalFavorites);
  app.get(
    "/api/affairs/dashboard-state",
    affairsLibraryController.getGlobalDashboardState ?? (async (_request, reply) => reply.send({ dashboardState: { workspaceId: AFFAIRS_GLOBAL_WORKSPACE_ID } }))
  );
  app.put(
    "/api/affairs/dashboard-state",
    affairsLibraryController.updateGlobalDashboardState ?? (async (_request, reply) => reply.send({ dashboardState: { workspaceId: AFFAIRS_GLOBAL_WORKSPACE_ID } }))
  );
  if (affairsTagController) {
    const listAffairsTagsHandler = typeof affairsTagController.listTags === "function"
      ? withGlobalWorkspace(affairsTagController.listTags)
      : affairsTagController.listGlobalTags;
    app.get("/api/affairs/tags", listAffairsTagsHandler);
    app.post("/api/affairs/tags", withGlobalWorkspace(affairsTagController.createTag));
    app.post("/api/affairs/tags/ensure", withGlobalWorkspace(affairsTagController.ensureTag));
    app.get("/api/affairs/tags/recompute-task", withGlobalWorkspace(affairsTagController.getFullTagRecomputeTask));
    app.post("/api/affairs/tags/recompute", withGlobalWorkspace(affairsTagController.requestFullTagRecompute));
    app.post("/api/affairs/tags/recovery/recompute", withGlobalWorkspace(affairsTagController.requestTagRecoveryRecompute));
    app.get("/api/affairs/tags/recovery/status", withGlobalWorkspace(affairsTagController.getTagRecoveryStatus));
    app.get("/api/affairs/tags/:tagId", withGlobalWorkspace(affairsTagController.getTagDetail));
    app.put("/api/affairs/tags/:tagId", withGlobalWorkspace(affairsTagController.updateTag));
    app.delete("/api/affairs/tags/:tagId", withGlobalWorkspace(affairsTagController.deleteTag));
    app.get("/api/affairs/documents/:documentId/tag-details", withGlobalWorkspace(affairsTagController.getDocumentTagDetails));
    app.get("/api/affairs/documents/:documentId/tag-task", withGlobalWorkspace(affairsTagController.getDocumentTagTask));
    app.put("/api/affairs/documents/:documentId/tags", withGlobalWorkspace(affairsTagController.saveDocumentTags));
    app.get("/api/affairs/folders/tag-details", withGlobalWorkspace(affairsTagController.getFolderTagDetails));
    app.get("/api/affairs/folders/tag-task", withGlobalWorkspace(affairsTagController.getFolderTagTask));
    app.put("/api/affairs/folders/tags", withGlobalWorkspace(affairsTagController.saveFolderTags));
  }
  if (affairsLightweightSessionController) {
    app.get("/api/affairs/lightweight-sessions", withGlobalWorkspace(affairsLightweightSessionController.listSessions));
    app.post("/api/affairs/lightweight-sessions", withGlobalWorkspace(affairsLightweightSessionController.startSession));
    app.post("/api/affairs/lightweight-sessions/stream", withGlobalWorkspace(affairsLightweightSessionController.startSessionStream));
    app.get("/api/affairs/lightweight-sessions/:sessionId", withGlobalWorkspace(affairsLightweightSessionController.getSession));
    app.get("/api/affairs/lightweight-sessions/:sessionId/messages", withGlobalWorkspace(affairsLightweightSessionController.readMessages));
    app.post("/api/affairs/lightweight-sessions/:sessionId/seen", withGlobalWorkspace(affairsLightweightSessionController.markSeen));
    app.patch("/api/affairs/lightweight-sessions/:sessionId/title", withGlobalWorkspace(affairsLightweightSessionController.renameTitle));
    app.patch("/api/affairs/lightweight-sessions/:sessionId/archive", withGlobalWorkspace(affairsLightweightSessionController.updateArchiveState));
    app.patch("/api/affairs/lightweight-sessions/:sessionId/favorite", withGlobalWorkspace(affairsLightweightSessionController.updateFavoriteState));
    app.delete("/api/affairs/lightweight-sessions/:sessionId", withGlobalWorkspace(affairsLightweightSessionController.deleteSession));
    app.post("/api/affairs/lightweight-sessions/:sessionId/messages", withGlobalWorkspace(affairsLightweightSessionController.sendMessage));
    app.post("/api/affairs/lightweight-sessions/:sessionId/messages/stream", withGlobalWorkspace(affairsLightweightSessionController.sendMessageStream));
  }
  app.get("/api/affairs/teable/global-binding", teableGlobal.getGlobalBinding);
  app.put("/api/affairs/teable/global-binding", teableGlobal.saveGlobalBinding);
  app.get("/api/affairs/teable/overview", teableMirror.getOverview);
  app.get("/api/affairs/teable/workbench-sync-config", teableSyncConfig.getConfigs);
  app.put("/api/affairs/teable/workbench-sync-config", teableSyncConfig.saveConfigs);
  app.get("/api/affairs/teable/table-catalog", teableCatalog.getTableCatalog);
  app.get("/api/affairs/teable/table-fields", teableCatalog.getTableFields);
  app.post("/api/affairs/teable/table-fields", teableCatalog.createTableFields);
  app.get("/api/affairs/teable/field-mappings", teableFieldMapping.getMappings);
  app.put("/api/affairs/teable/field-mappings", teableFieldMapping.saveMappings);
  app.post("/api/affairs/teable/mirror-sync", teableMirror.requestMirrorSync);
  app.get("/api/affairs/teable/sync-logs", teableMirror.listSyncLogs);
  app.get("/api/affairs/teable/forms", async (_request, reply) => {
    reply.code(410).send({
      detail: "这个旧接口已经废弃。CodingNS 不再使用 Teable 分享页或表单接入。"
    });
  });
  app.post("/api/affairs/teable/forms", async (_request, reply) => {
    reply.code(410).send({
      detail: "CodingNS 不再通过 Teable 分享页接入表单。后续请使用 CodingNS 自定义前端和 Teable API。"
    });
  });
}
