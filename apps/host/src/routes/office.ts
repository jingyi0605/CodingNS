import type { FastifyInstance } from "fastify";

import type { OfficeController } from "../modules/office/office-controller.js";

export async function registerOfficeRoutes(
  app: FastifyInstance,
  officeController: OfficeController
): Promise<void> {
  app.get("/api/office/tasks", officeController.listTasks);
  app.post("/api/office/tasks", officeController.createTask);
  app.get("/api/office/tasks/:taskId", officeController.getTask);
  app.post("/api/office/tasks/:taskId/cancel", officeController.cancelTask);
  app.post("/api/office/tasks/:taskId/retry", officeController.retryTask);
  app.get("/api/office/connectors", officeController.listConnectors);
  app.post("/api/office/approvals/:approvalId/reply", officeController.replyApproval);
}
