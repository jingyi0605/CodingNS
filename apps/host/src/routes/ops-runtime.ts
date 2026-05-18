import type { FastifyInstance } from "fastify";

import type { OpsRuntimeController } from "../modules/ops-runtime/ops-runtime-controller.js";

export async function registerOpsRuntimeRoutes(
  app: FastifyInstance,
  opsRuntimeController: OpsRuntimeController
): Promise<void> {
  app.get("/api/office/ops/targets", opsRuntimeController.listTargets);
  app.post("/api/office/ops/targets", opsRuntimeController.createTarget);
  app.get("/api/office/ops/targets/:targetId", opsRuntimeController.getTarget);
  app.patch("/api/office/ops/targets/:targetId", opsRuntimeController.updateTarget);
  app.post("/api/office/ops/ssh/tasks", opsRuntimeController.createSshTask);
  app.post("/api/office/ops/ssh/tasks/:taskId/execute", opsRuntimeController.executeSshTask);
  app.get("/api/office/ops/ssh/tasks/:taskId/execution", opsRuntimeController.getSshExecution);
  app.post("/api/office/ops/ssh/tasks/:taskId/execution/cancel", opsRuntimeController.cancelSshExecution);
  app.post("/api/office/ops/browser/tasks", opsRuntimeController.createBrowserTask);
  app.post("/api/office/ops/browser-tasks", opsRuntimeController.createBrowserTask);
}
