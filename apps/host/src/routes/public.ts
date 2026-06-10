import type { FastifyInstance } from "fastify";

import type { BootstrapController } from "../modules/bootstrap/bootstrap-controller.js";
import type { ChannelGatewayController } from "../modules/channels/channel-gateway-controller.js";
import type { HostHandshakeController } from "../modules/peer-host/host-handshake-controller.js";

export async function registerPublicRoutes(
  app: FastifyInstance,
  bootstrapController: BootstrapController,
  channelGatewayController: ChannelGatewayController,
  hostHandshakeController: HostHandshakeController
): Promise<void> {
  app.get("/api/public/bootstrap-status", bootstrapController.getStatus);
  app.get("/api/public/host-handshake", hostHandshakeController.getHandshake);
  app.post("/api/public/setup", bootstrapController.setup);
  app.get("/api/public/channel-gateways/:accountId/webhook", channelGatewayController.handleWebhook);
  app.post("/api/public/channel-gateways/:accountId/webhook", channelGatewayController.handleWebhook);
}
