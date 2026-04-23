import type { FastifyInstance } from "fastify";

import type { ParallelSessionController } from "../modules/parallel-sessions/parallel-session-controller.js";

export async function registerParallelGroupRoutes(
  app: FastifyInstance,
  parallelSessionController: ParallelSessionController
): Promise<void> {
  app.post(
    "/api/sessions/:sessionId/parallel-groups",
    parallelSessionController.createFromSession
  );
  app.post(
    "/api/workspaces/:workspaceId/parallel-groups",
    parallelSessionController.createFromWorkspace
  );
  app.post(
    "/api/parallel-groups/:groupId/members",
    parallelSessionController.appendMembers
  );
  app.get("/api/parallel-groups/:groupId", parallelSessionController.getDetail);
  app.delete("/api/parallel-groups/:groupId", parallelSessionController.deleteGroup);
  app.post(
    "/api/session-isolated-workspaces/:id/promote",
    parallelSessionController.promoteIsolatedWorkspace
  );
}
