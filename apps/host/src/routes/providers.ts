import type { FastifyInstance } from "fastify";

import type { ProviderController } from "../modules/provider/provider-controller.js";

export async function registerProviderRoutes(
  app: FastifyInstance,
  providerController: ProviderController
): Promise<void> {
  app.get("/api/providers/:provider/capabilities", providerController.getCapabilities);
}
