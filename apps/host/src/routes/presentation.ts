import type { FastifyInstance } from "fastify";

import type { PresentationController } from "../modules/presentation/presentation-controller.js";

export async function registerPresentationRoutes(
  app: FastifyInstance,
  presentationController: PresentationController
): Promise<void> {
  app.post("/api/presentation-exports", presentationController.createExportTask);
  app.get("/api/presentation-exports/:taskId", presentationController.getExportTask);
}
