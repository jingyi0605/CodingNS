import type { FastifyInstance } from "fastify";

import type { ModelSwitchController } from "../modules/model-switch/model-switch-controller.js";
import type { TailscaleController } from "../modules/tailscale/tailscale-controller.js";

export async function registerSystemRoutes(
  app: FastifyInstance,
  tailscaleController: TailscaleController,
  modelSwitchController: ModelSwitchController
): Promise<void> {
  app.get("/api/system/tailscale/status", tailscaleController.getStatus);
  app.put("/api/system/tailscale/config", tailscaleController.updateConfig);
  app.post("/api/system/tailscale/enable", tailscaleController.enable);
  app.post("/api/system/tailscale/disable", tailscaleController.disable);
  app.post("/api/system/tailscale/login", tailscaleController.login);
  app.post("/api/system/tailscale/logout", tailscaleController.logout);
  app.get("/api/system/model-switch", modelSwitchController.getSnapshot);
  app.post("/api/system/model-switch", modelSwitchController.switchPreset);
}
