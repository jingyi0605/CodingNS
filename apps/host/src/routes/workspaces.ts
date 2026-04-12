import type { FastifyInstance } from "fastify";

import type { WorkspaceController } from "../modules/workspace/workspace-controller.js";

export async function registerWorkspaceRoutes(
  app: FastifyInstance,
  workspaceController: WorkspaceController
): Promise<void> {
  app.get("/api/workspaces", workspaceController.list);
  app.get("/api/workspaces/browse", workspaceController.browse);
  app.post("/api/workspaces/directories", workspaceController.createDirectory);
  app.post("/api/workspaces/import", workspaceController.import);
  app.post("/api/workspaces/clone", workspaceController.clone);
  app.put("/api/workspaces/reorder", workspaceController.reorder);
  app.put("/api/workspaces/:workspaceId/navigation-state", workspaceController.updateNavigationState);
  app.get("/api/workspaces/:workspaceId/management", workspaceController.getManagementSummary);
  app.delete("/api/workspaces/:workspaceId", workspaceController.remove);
}
