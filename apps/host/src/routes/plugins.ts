import type { FastifyInstance } from "fastify";

import type { PluginController } from "../modules/plugins/plugin-controller.js";

export async function registerPluginRoutes(
  app: FastifyInstance,
  pluginController: PluginController
): Promise<void> {
  app.get("/api/plugins", pluginController.list);
  app.get("/api/plugins/:pluginId", pluginController.get);
  app.post("/api/plugins/:pluginId/runtime-sessions", pluginController.createRuntimeSession);
  app.post("/api/plugins/:pluginId/runtime-sessions/:runtimeSessionId/close", pluginController.closeRuntimeSession);
  app.post("/api/plugins/:pluginId/enable", pluginController.enable);
  app.post("/api/plugins/:pluginId/disable", pluginController.disable);
  app.post("/api/plugins/:pluginId/actions/:actionId", pluginController.callAction);
  app.get("/api/plugins/:pluginId/runs", pluginController.listRuns);
  app.post("/api/plugins/:pluginId/desktop/open-file", pluginController.desktopOpenFile);
  app.post("/api/plugins/:pluginId/desktop/reveal-in-file-manager", pluginController.desktopRevealInFileManager);
}
