import type { FastifyInstance } from "fastify";

import type { ProviderController } from "../modules/provider/provider-controller.js";

export async function registerProviderRoutes(
  app: FastifyInstance,
  providerController: ProviderController
): Promise<void> {
  app.get("/api/providers/:provider/capabilities", providerController.getCapabilities);
  app.get("/api/providers/claude-code/hook-bridge", providerController.getClaudeHookBridgeConfig);
  app.post("/api/providers/claude-code/hook-bridge/events", providerController.receiveClaudeHookEvent);
}
