import type { FastifyInstance } from "fastify";

import type { DocumentRuntimeController } from "../modules/document-runtime/document-runtime-controller.js";

export async function registerDocumentRuntimeRoutes(
  app: FastifyInstance,
  documentRuntimeController: DocumentRuntimeController
): Promise<void> {
  app.get("/api/office/document-templates", documentRuntimeController.listTemplates);
  app.get("/api/office/document-templates/:templateId", documentRuntimeController.getTemplate);
  app.post("/api/office/document-templates", documentRuntimeController.createTemplate);
  app.post("/api/office/document-templates/import-file", documentRuntimeController.importTemplateFile);
  app.patch("/api/office/document-templates/:templateId", documentRuntimeController.updateTemplate);
  app.get("/api/office/documents", documentRuntimeController.listDocuments);
  app.post("/api/office/documents", documentRuntimeController.createDocument);
  app.get("/api/office/documents/:documentId", documentRuntimeController.getDocument);
  app.patch("/api/office/documents/:documentId", documentRuntimeController.updateDocument);
  app.post("/api/office/documents/:documentId/comments", documentRuntimeController.createComment);
  app.post("/api/office/documents/:documentId/comments/:commentId/resolve", documentRuntimeController.resolveComment);
  app.post("/api/office/documents/:documentId/export", documentRuntimeController.exportDocument);
  app.post("/api/office/document-tasks/:taskId/execute", documentRuntimeController.executeExportTask);
  app.get("/api/office/document-tasks/:taskId/execution", documentRuntimeController.getExportExecution);
  app.post("/api/office/document-tasks/:taskId/execution/cancel", documentRuntimeController.cancelExportExecution);
}
