import type { FastifyInstance } from "fastify";

import type { OfficeController } from "../modules/office/office-controller.js";

export async function registerOfficeRoutes(
  app: FastifyInstance,
  officeController: OfficeController
): Promise<void> {
  app.get("/api/office/tasks", officeController.listTasks);
  app.post("/api/office/tasks", officeController.createTask);
  app.get("/api/office/tasks/:taskId", officeController.getTask);
  app.get("/api/office/artifacts/:artifactId/preview-link", officeController.createArtifactPreviewLink);
  app.get("/api/office/artifacts/:artifactId/content", officeController.readArtifactContent);
  app.get("/api/office/tasks/:taskId/files/:fileName/preview-link", officeController.createTaskFilePreviewLink);
  app.get("/api/office/tasks/:taskId/files/:fileName/content", officeController.readArtifactFileContent);
  app.get("/preview/office/artifacts/*", officeController.readArtifactPreview);
  app.get("/preview/office/tasks/*", officeController.readArtifactTaskFilePreview);
  app.post("/api/office/tasks/:taskId/cancel", officeController.cancelTask);
  app.post("/api/office/tasks/:taskId/retry", officeController.retryTask);
  app.get("/api/office/connectors", officeController.listConnectors);
  app.post("/api/office/approvals/:approvalId/reply", officeController.replyApproval);
}
