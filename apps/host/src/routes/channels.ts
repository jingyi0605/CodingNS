import type { FastifyInstance } from "fastify";

import type { ChannelController } from "../modules/channels/channel-controller.js";

export async function registerChannelRoutes(
  app: FastifyInstance,
  channelController: ChannelController
): Promise<void> {
  app.get("/api/channels/platforms", channelController.listPlatforms);
  app.get("/api/channels/accounts", channelController.listAccounts);
  app.post("/api/channels/accounts", channelController.createAccount);
  app.patch("/api/channels/accounts/:accountId", channelController.updateAccount);
  app.post("/api/channels/accounts/:accountId/probe", channelController.probeAccount);
  app.post("/api/channels/accounts/:accountId/poll", channelController.pollAccount);
  app.post("/api/channels/accounts/:accountId/wechat-claw/start-login", channelController.startWechatClawLogin);
  app.post("/api/channels/accounts/:accountId/wechat-claw/refresh-login", channelController.refreshWechatClawLogin);
  app.post("/api/channels/accounts/:accountId/wechat-claw/logout", channelController.logoutWechatClaw);
  app.get("/api/channels/accounts/:accountId/threads", channelController.listThreads);
  app.get("/api/channels/accounts/:accountId/events", channelController.listEvents);
  app.get("/api/channels/accounts/:accountId/deliveries", channelController.listDeliveries);
}
