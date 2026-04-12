import type { FastifyInstance } from "fastify";

import type { WorktreeController } from "../modules/worktree/worktree-controller.js";

export async function registerWorktreeRoutes(
  app: FastifyInstance,
  worktreeController: WorktreeController
): Promise<void> {
  app.get("/api/worktrees/tree", worktreeController.getTree);
  app.post("/api/worktrees", worktreeController.create);
  app.post("/api/worktrees/:workspaceId/merge-preview", worktreeController.getMergePreview);
  app.post("/api/worktrees/:workspaceId/merge-into-parent", worktreeController.mergeIntoParent);
  app.post("/api/worktrees/:workspaceId/cleanup", worktreeController.cleanup);
}
