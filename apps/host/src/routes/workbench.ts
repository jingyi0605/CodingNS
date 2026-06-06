import type { FastifyInstance } from "fastify";

import type { WorkbenchController } from "../modules/workbench/workbench-controller.js";
import { AFFAIRS_GLOBAL_WORKSPACE_ID } from "../modules/workspace/affairs-library-service.js";

export async function registerWorkbenchRoutes(
  app: FastifyInstance,
  workbenchController: WorkbenchController
): Promise<void> {
  app.get("/api/workbench", workbenchController.getSnapshot);
  app.get("/api/affairs/assistant-sessions", async (request, reply) => {
    request.params = {
      ...((request.params ?? {}) as Record<string, string>),
      workspaceId: AFFAIRS_GLOBAL_WORKSPACE_ID
    };
    await workbenchController.getAffairsAssistantSessions(request as any, reply);
  });
  app.get(
    "/api/workspaces/:workspaceId/affairs/assistant-sessions",
    async (request, reply) => {
      request.params = {
        ...((request.params ?? {}) as Record<string, string>),
        workspaceId: AFFAIRS_GLOBAL_WORKSPACE_ID
      };
      await workbenchController.getAffairsAssistantSessions(request as any, reply);
    }
  );
}
