import type { FastifyInstance } from "fastify";

import type { WorkbenchController } from "../modules/workbench/workbench-controller.js";

export async function registerWorkbenchRoutes(
  app: FastifyInstance,
  workbenchController: WorkbenchController
): Promise<void> {
  app.get("/api/workbench", workbenchController.getSnapshot);
}
