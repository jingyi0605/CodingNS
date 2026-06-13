import type { FastifyInstance } from "fastify";

import type { ClientController } from "../modules/client/client-controller.js";

export async function registerClientRoutes(
  app: FastifyInstance,
  clientController: ClientController
): Promise<void> {
  app.get("/api/client/runtime-config", clientController.getRuntimeConfig);
  app.get("/api/client/host-version", clientController.getHostVersion);
  app.get("/api/client/service-update", clientController.getServiceUpdate);
  app.post("/api/client/service-update/install", clientController.installServiceUpdate);
  app.get("/api/client/service-update/tasks/:taskId", clientController.getServiceUpdateTask);
  app.get("/api/client/release-manifest", clientController.getReleaseManifest);
}
