import type { FastifyInstance } from "fastify";

import type { AffairsLibraryController } from "../modules/workspace/affairs-library-controller.js";
import type { AffairsLightweightSessionController } from "../modules/workspace/affairs-lightweight-session-controller.js";
import type { AffairsTagController } from "../modules/workspace/affairs-tag-controller.js";
import { AFFAIRS_GLOBAL_WORKSPACE_ID } from "../modules/workspace/affairs-library-service.js";
import type { WorkspaceController } from "../modules/workspace/workspace-controller.js";

function withGlobalAffairsWorkspace<TRequest extends { params?: unknown }>(
  handler: (request: TRequest, reply: any) => Promise<void>
) {
  return async (request: TRequest, reply: any) => {
    request.params = {
      ...((request.params ?? {}) as Record<string, string>),
      workspaceId: AFFAIRS_GLOBAL_WORKSPACE_ID
    };
    await handler(request, reply);
  };
}

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
  app.get("/api/workspaces/:workspaceId/affairs/library-binding", withGlobalAffairsWorkspace(affairsLibraryController.getBinding));
  app.put("/api/workspaces/:workspaceId/affairs/library-binding", withGlobalAffairsWorkspace(affairsLibraryController.saveBinding));
  app.put("/api/workspaces/:workspaceId/affairs/library-enabled", withGlobalAffairsWorkspace(affairsLibraryController.setEnabled));
  app.get("/api/workspaces/:workspaceId/affairs/library-config", withGlobalAffairsWorkspace(affairsLibraryController.getConfig));
  app.put("/api/workspaces/:workspaceId/affairs/library-config", withGlobalAffairsWorkspace(affairsLibraryController.saveConfig));
  app.get("/api/workspaces/:workspaceId/affairs/library-snapshot", withGlobalAffairsWorkspace(affairsLibraryController.getSnapshot));
  app.get("/api/workspaces/:workspaceId/affairs/library-documents", withGlobalAffairsWorkspace(affairsLibraryController.listDocuments));
  app.get("/api/workspaces/:workspaceId/affairs/library-files", withGlobalAffairsWorkspace(affairsLibraryController.listFiles));
  app.get("/api/workspaces/:workspaceId/affairs/library-preview", withGlobalAffairsWorkspace(affairsLibraryController.previewDocument));
  app.get("/api/workspaces/:workspaceId/affairs/library-download", withGlobalAffairsWorkspace(affairsLibraryController.downloadFile));
  app.post("/api/workspaces/:workspaceId/affairs/library-ops", withGlobalAffairsWorkspace(affairsLibraryController.operateFile));
  app.post("/api/workspaces/:workspaceId/affairs/library-refresh", withGlobalAffairsWorkspace(affairsLibraryController.requestRefresh));
  app.put("/api/workspaces/:workspaceId/affairs/library-favorites", withGlobalAffairsWorkspace(affairsLibraryController.updateFavorites));
  if (affairsLightweightSessionController) {
    app.get("/api/workspaces/:workspaceId/affairs/lightweight-sessions", withGlobalAffairsWorkspace(affairsLightweightSessionController.listSessions));
    app.post("/api/workspaces/:workspaceId/affairs/lightweight-sessions", withGlobalAffairsWorkspace(affairsLightweightSessionController.startSession));
    app.post("/api/workspaces/:workspaceId/affairs/lightweight-sessions/stream", withGlobalAffairsWorkspace(affairsLightweightSessionController.startSessionStream));
    app.get("/api/workspaces/:workspaceId/affairs/lightweight-sessions/:sessionId", withGlobalAffairsWorkspace(affairsLightweightSessionController.getSession));
    app.get("/api/workspaces/:workspaceId/affairs/lightweight-sessions/:sessionId/messages", withGlobalAffairsWorkspace(affairsLightweightSessionController.readMessages));
    app.post("/api/workspaces/:workspaceId/affairs/lightweight-sessions/:sessionId/seen", withGlobalAffairsWorkspace(affairsLightweightSessionController.markSeen));
    app.patch("/api/workspaces/:workspaceId/affairs/lightweight-sessions/:sessionId/title", withGlobalAffairsWorkspace(affairsLightweightSessionController.renameTitle));
    app.patch("/api/workspaces/:workspaceId/affairs/lightweight-sessions/:sessionId/archive", withGlobalAffairsWorkspace(affairsLightweightSessionController.updateArchiveState));
    app.patch("/api/workspaces/:workspaceId/affairs/lightweight-sessions/:sessionId/favorite", withGlobalAffairsWorkspace(affairsLightweightSessionController.updateFavoriteState));
    app.delete("/api/workspaces/:workspaceId/affairs/lightweight-sessions/:sessionId", withGlobalAffairsWorkspace(affairsLightweightSessionController.deleteSession));
    app.post("/api/workspaces/:workspaceId/affairs/lightweight-sessions/:sessionId/messages", withGlobalAffairsWorkspace(affairsLightweightSessionController.sendMessage));
    app.post("/api/workspaces/:workspaceId/affairs/lightweight-sessions/:sessionId/messages/stream", withGlobalAffairsWorkspace(affairsLightweightSessionController.sendMessageStream));
  }
  if (affairsTagController) {
    app.get("/api/workspaces/:workspaceId/affairs/tags", withGlobalAffairsWorkspace(affairsTagController.listTags));
    app.post("/api/workspaces/:workspaceId/affairs/tags", withGlobalAffairsWorkspace(affairsTagController.createTag));
    app.post("/api/workspaces/:workspaceId/affairs/tags/ensure", withGlobalAffairsWorkspace(affairsTagController.ensureTag));
    app.get("/api/workspaces/:workspaceId/affairs/tags/:tagId", withGlobalAffairsWorkspace(affairsTagController.getTagDetail));
    app.put("/api/workspaces/:workspaceId/affairs/tags/:tagId", withGlobalAffairsWorkspace(affairsTagController.updateTag));
    app.delete("/api/workspaces/:workspaceId/affairs/tags/:tagId", withGlobalAffairsWorkspace(affairsTagController.deleteTag));
    app.post("/api/workspaces/:workspaceId/affairs/tags/recompute", withGlobalAffairsWorkspace(affairsTagController.requestFullTagRecompute));
    app.get("/api/workspaces/:workspaceId/affairs/tags/recompute-task", withGlobalAffairsWorkspace(affairsTagController.getFullTagRecomputeTask));
    app.post("/api/workspaces/:workspaceId/affairs/tags/recovery/recompute", withGlobalAffairsWorkspace(affairsTagController.requestTagRecoveryRecompute));
    app.get("/api/workspaces/:workspaceId/affairs/tags/recovery/status", withGlobalAffairsWorkspace(affairsTagController.getTagRecoveryStatus));
    app.get("/api/workspaces/:workspaceId/affairs/documents/:documentId/tag-details", withGlobalAffairsWorkspace(affairsTagController.getDocumentTagDetails));
    app.get("/api/workspaces/:workspaceId/affairs/documents/:documentId/tag-task", withGlobalAffairsWorkspace(affairsTagController.getDocumentTagTask));
    app.put("/api/workspaces/:workspaceId/affairs/documents/:documentId/tags", withGlobalAffairsWorkspace(affairsTagController.saveDocumentTags));
    app.get("/api/workspaces/:workspaceId/affairs/folders/tag-details", withGlobalAffairsWorkspace(affairsTagController.getFolderTagDetails));
    app.get("/api/workspaces/:workspaceId/affairs/folders/tag-task", withGlobalAffairsWorkspace(affairsTagController.getFolderTagTask));
    app.put("/api/workspaces/:workspaceId/affairs/folders/tags", withGlobalAffairsWorkspace(affairsTagController.saveFolderTags));
  }
  app.get("/api/workspaces/:workspaceId/management", workspaceController.getManagementSummary);
  app.delete("/api/workspaces/:workspaceId", workspaceController.remove);
}
