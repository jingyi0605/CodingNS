import type { FastifyInstance } from "fastify";

import type { WorkspaceController } from "../modules/workspace/workspace-controller.js";

export async function registerWorkspaceRoutes(
  app: FastifyInstance,
  workspaceController: WorkspaceController
): Promise<void> {
  app.get("/api/workspaces", workspaceController.list);
  app.post("/api/workspaces/import", workspaceController.import);
}
