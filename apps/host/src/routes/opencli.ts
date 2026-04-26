import type { FastifyInstance } from "fastify";

import type { OpenCliController } from "../modules/opencli/opencli-controller.js";

export async function registerOpenCliRoutes(
  app: FastifyInstance,
  openCliController: OpenCliController
): Promise<void> {
  app.get("/api/opencli/overview", openCliController.getOverview);
  app.get("/api/opencli/catalog", openCliController.getCatalog);
  app.post("/api/opencli/check", openCliController.check);
  app.post("/api/opencli/config", openCliController.updateConfig);
}
