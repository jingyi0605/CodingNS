import type { FastifyInstance } from "fastify";

import type { PluginController } from "../modules/plugins/plugin-controller.js";

export async function registerPluginPublicRoutes(
  app: FastifyInstance,
  pluginController: PluginController
): Promise<void> {
  app.get("/preview/plugins/runtime-sdk.js", pluginController.publicRuntimeSdk);
  app.get("/preview/plugins/:pluginId/frontend/*", pluginController.publicFrontendAsset);
}
