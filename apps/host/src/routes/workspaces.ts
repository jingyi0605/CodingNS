import type { FastifyInstance } from "fastify";

import type { AffairsLibraryController } from "../modules/workspace/affairs-library-controller.js";
import type { WorkspaceController } from "../modules/workspace/workspace-controller.js";

export async function registerWorkspaceRoutes(
  app: FastifyInstance,
  workspaceController: WorkspaceController,
  affairsLibraryController: AffairsLibraryController
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
  app.get("/api/workspaces/:workspaceId/management", workspaceController.getManagementSummary);
  app.delete("/api/workspaces/:workspaceId", workspaceController.remove);
}
