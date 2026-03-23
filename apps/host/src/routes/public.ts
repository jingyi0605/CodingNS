import type { FastifyInstance } from "fastify";

import type { BootstrapController } from "../modules/bootstrap/bootstrap-controller.js";

export async function registerPublicRoutes(
  app: FastifyInstance,
  bootstrapController: BootstrapController
): Promise<void> {
  app.get("/api/public/bootstrap-status", bootstrapController.getStatus);
  app.post("/api/public/setup", bootstrapController.setup);
}
