import type { FastifyInstance } from "fastify";

import type { ProviderController } from "../modules/provider/provider-controller.js";

export async function registerProviderRoutes(
  app: FastifyInstance,
  providerController: ProviderController
): Promise<void> {
  app.get("/api/providers/catalog", providerController.listCatalog);
  app.put("/api/providers/catalog/:provider", providerController.updateCatalogEntry);
  app.get("/api/providers/:provider/capabilities", providerController.getCapabilities);
  app.get("/api/providers/:provider/hook-bridge", providerController.getClaudeHookBridgeConfig);
  app.post("/api/providers/:provider/hook-bridge/events", providerController.receiveClaudeHookEvent);
}
