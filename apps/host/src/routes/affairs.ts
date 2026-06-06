import type { FastifyInstance } from "fastify";

import type { AffairsTagController } from "../modules/workspace/affairs-tag-controller.js";
import type { AffairsLibraryController } from "../modules/workspace/affairs-library-controller.js";
import type { AffairsLightweightSessionController } from "../modules/workspace/affairs-lightweight-session-controller.js";
import { AFFAIRS_GLOBAL_WORKSPACE_ID } from "../modules/workspace/affairs-library-service.js";

export async function registerAffairsRoutes(
  app: FastifyInstance,
  affairsLibraryController: AffairsLibraryController,
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
  app.get("/api/affairs/dashboard-state", affairsLibraryController.getGlobalDashboardState);
  app.put("/api/affairs/dashboard-state", affairsLibraryController.updateGlobalDashboardState);

  if (affairsTagController) {
    app.get("/api/affairs/tags", withGlobalWorkspace(affairsTagController.listTags));
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
}
