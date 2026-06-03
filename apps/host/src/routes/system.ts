import type { FastifyInstance } from "fastify";

import type { HostResourceController } from "../modules/system/host-resource-controller.js";
import type { ModelSwitchController } from "../modules/model-switch/model-switch-controller.js";
import type { RelayTunnelController } from "../modules/relay-tunnel/relay-tunnel-controller.js";
import type { TailscaleController } from "../modules/tailscale/tailscale-controller.js";

export async function registerSystemRoutes(
  app: FastifyInstance,
  tailscaleController: TailscaleController,
  relayTunnelController: RelayTunnelController,
  modelSwitchController: ModelSwitchController,
  hostResourceController: HostResourceController
): Promise<void> {
  app.get("/api/system/tailscale/status", tailscaleController.getStatus);
  app.put("/api/system/tailscale/config", tailscaleController.updateConfig);
  app.post("/api/system/tailscale/enable", tailscaleController.enable);
  app.post("/api/system/tailscale/disable", tailscaleController.disable);
  app.post("/api/system/tailscale/login", tailscaleController.login);
  app.post("/api/system/tailscale/logout", tailscaleController.logout);
  app.get("/api/system/relay-tunnel/status", relayTunnelController.getStatus);
  app.post("/api/system/relay-tunnel/identity/ensure", relayTunnelController.ensureIdentity);
  app.put("/api/system/relay-tunnel/config", relayTunnelController.updateConfig);
  app.post("/api/system/relay-tunnel/control/login", relayTunnelController.loginControl);
  app.post("/api/system/relay-tunnel/control/logout", relayTunnelController.logoutControl);
  app.get(
    "/api/system/relay-tunnel/control/host-label-availability",
    relayTunnelController.checkHostLabelAvailability
  );
  app.post("/api/system/relay-tunnel/control/bind", relayTunnelController.bindControlHost);
  app.get("/api/system/relay-tunnel/control/wallet", relayTunnelController.getTrafficWallet);
  app.post("/api/system/relay-tunnel/bind", relayTunnelController.bind);
  app.post("/api/system/relay-tunnel/unbind", relayTunnelController.unbind);
  app.post("/api/system/relay-tunnel/enable", relayTunnelController.enable);
  app.post("/api/system/relay-tunnel/disable", relayTunnelController.disable);
  app.get("/api/system/model-switch", modelSwitchController.getSnapshot);
  app.post("/api/system/model-switch", modelSwitchController.switchPreset);
  app.get("/api/system/host/resources", hostResourceController.getSnapshot);
}
