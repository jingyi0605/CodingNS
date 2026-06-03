import type { FastifyInstance } from "fastify";

import type { AffairsLibraryController } from "../modules/workspace/affairs-library-controller.js";
import type { AffairsLightweightSessionController } from "../modules/workspace/affairs-lightweight-session-controller.js";
import type { AffairsTagController } from "../modules/workspace/affairs-tag-controller.js";
import type { WorkspaceController } from "../modules/workspace/workspace-controller.js";

export async function registerWorkspaceRoutes(
  app: FastifyInstance,
  workspaceController: WorkspaceController,
  affairsLibraryController: AffairsLibraryController,
  affairsLightweightSessionController?: AffairsLightweightSessionController,
  affairsTagController?: AffairsTagController,
): Promise<void> {
  app.get("/api/workspaces", workspaceController.list);
  app.get("/api/workspaces/browse", workspaceController.browse);
  app.post("/api/workspaces/directories", workspaceController.createDirectory);
  app.post("/api/workspaces/import", workspaceController.import);
  app.post("/api/workspaces/clone", workspaceController.clone);
  app.put("/api/workspaces/reorder", workspaceController.reorder);
  app.put("/api/workspaces/:workspaceId/navigation-state", workspaceController.updateNavigationState);
  app.get("/api/workspaces/:workspaceId/affairs/library-binding", affairsLibraryController.getBinding);
  app.put("/api/workspaces/:workspaceId/affairs/library-binding", affairsLibraryController.saveBinding);
  app.put("/api/workspaces/:workspaceId/affairs/library-enabled", affairsLibraryController.setEnabled);
  app.get("/api/workspaces/:workspaceId/affairs/library-config", affairsLibraryController.getConfig);
  app.put("/api/workspaces/:workspaceId/affairs/library-config", affairsLibraryController.saveConfig);
  app.get("/api/workspaces/:workspaceId/affairs/library-snapshot", affairsLibraryController.getSnapshot);
  app.get("/api/workspaces/:workspaceId/affairs/library-documents", affairsLibraryController.listDocuments);
  app.get("/api/workspaces/:workspaceId/affairs/library-preview", affairsLibraryController.previewDocument);
  app.get("/api/workspaces/:workspaceId/affairs/library-download", affairsLibraryController.downloadFile);
  app.post("/api/workspaces/:workspaceId/affairs/library-ops", affairsLibraryController.operateFile);
  app.post("/api/workspaces/:workspaceId/affairs/library-refresh", affairsLibraryController.requestRefresh);
  app.put("/api/workspaces/:workspaceId/affairs/library-favorites", affairsLibraryController.updateFavorites);
  if (affairsLightweightSessionController) {
    app.get("/api/workspaces/:workspaceId/affairs/lightweight-sessions", affairsLightweightSessionController.listSessions);
    app.post("/api/workspaces/:workspaceId/affairs/lightweight-sessions", affairsLightweightSessionController.startSession);
    app.post("/api/workspaces/:workspaceId/affairs/lightweight-sessions/stream", affairsLightweightSessionController.startSessionStream);
    app.get("/api/workspaces/:workspaceId/affairs/lightweight-sessions/:sessionId", affairsLightweightSessionController.getSession);
    app.get("/api/workspaces/:workspaceId/affairs/lightweight-sessions/:sessionId/messages", affairsLightweightSessionController.readMessages);
    app.post("/api/workspaces/:workspaceId/affairs/lightweight-sessions/:sessionId/seen", affairsLightweightSessionController.markSeen);
    app.patch("/api/workspaces/:workspaceId/affairs/lightweight-sessions/:sessionId/title", affairsLightweightSessionController.renameTitle);
    app.patch("/api/workspaces/:workspaceId/affairs/lightweight-sessions/:sessionId/archive", affairsLightweightSessionController.updateArchiveState);
    app.patch("/api/workspaces/:workspaceId/affairs/lightweight-sessions/:sessionId/favorite", affairsLightweightSessionController.updateFavoriteState);
    app.delete("/api/workspaces/:workspaceId/affairs/lightweight-sessions/:sessionId", affairsLightweightSessionController.deleteSession);
    app.post("/api/workspaces/:workspaceId/affairs/lightweight-sessions/:sessionId/messages", affairsLightweightSessionController.sendMessage);
    app.post("/api/workspaces/:workspaceId/affairs/lightweight-sessions/:sessionId/messages/stream", affairsLightweightSessionController.sendMessageStream);
  }
  if (affairsTagController) {
    app.get("/api/workspaces/:workspaceId/affairs/tags", affairsTagController.listTags);
    app.post("/api/workspaces/:workspaceId/affairs/tags", affairsTagController.createTag);
    app.post("/api/workspaces/:workspaceId/affairs/tags/ensure", affairsTagController.ensureTag);
    app.get("/api/workspaces/:workspaceId/affairs/tags/:tagId", affairsTagController.getTagDetail);
    app.put("/api/workspaces/:workspaceId/affairs/tags/:tagId", affairsTagController.updateTag);
    app.delete("/api/workspaces/:workspaceId/affairs/tags/:tagId", affairsTagController.deleteTag);
    app.post("/api/workspaces/:workspaceId/affairs/tags/recompute", affairsTagController.requestFullTagRecompute);
    app.get("/api/workspaces/:workspaceId/affairs/tags/recompute-task", affairsTagController.getFullTagRecomputeTask);
    app.post("/api/workspaces/:workspaceId/affairs/tags/recovery/recompute", affairsTagController.requestTagRecoveryRecompute);
    app.get("/api/workspaces/:workspaceId/affairs/tags/recovery/status", affairsTagController.getTagRecoveryStatus);
    app.get("/api/workspaces/:workspaceId/affairs/documents/:documentId/tag-details", affairsTagController.getDocumentTagDetails);
    app.get("/api/workspaces/:workspaceId/affairs/documents/:documentId/tag-task", affairsTagController.getDocumentTagTask);
    app.put("/api/workspaces/:workspaceId/affairs/documents/:documentId/tags", affairsTagController.saveDocumentTags);
    app.get("/api/workspaces/:workspaceId/affairs/folders/tag-details", affairsTagController.getFolderTagDetails);
    app.get("/api/workspaces/:workspaceId/affairs/folders/tag-task", affairsTagController.getFolderTagTask);
    app.put("/api/workspaces/:workspaceId/affairs/folders/tags", affairsTagController.saveFolderTags);
  }
  app.get("/api/workspaces/:workspaceId/management", workspaceController.getManagementSummary);
  app.delete("/api/workspaces/:workspaceId", workspaceController.remove);
}
