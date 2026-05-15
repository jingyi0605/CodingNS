import type { FastifyInstance } from "fastify";

import type { BrowserRuntimeController } from "../modules/browser-runtime/browser-runtime-controller.js";

export async function registerBrowserRuntimeRoutes(
  app: FastifyInstance,
  browserRuntimeController: BrowserRuntimeController
): Promise<void> {
  app.get("/api/office/browser/profiles", browserRuntimeController.listProfiles);
  app.post("/api/office/browser/profiles", browserRuntimeController.createProfile);
  app.get("/api/office/browser/profiles/:profileId", browserRuntimeController.getProfile);
  app.post("/api/office/browser/tasks", browserRuntimeController.createTask);
  app.post("/api/office/browser/tasks/:taskId/execute", browserRuntimeController.executeTask);
  app.get("/api/office/browser/tasks/:taskId/execution", browserRuntimeController.getExecution);
  app.post("/api/office/browser/tasks/:taskId/execution/cancel", browserRuntimeController.cancelExecution);
  app.post("/api/office/browser/cdp/attach", browserRuntimeController.attachCdp);
}
