import type { FastifyInstance } from "fastify";

import type { SessionCleanupController } from "../modules/session-cleanup/session-cleanup-controller.js";

export async function registerSessionCleanupRoutes(
  app: FastifyInstance,
  sessionCleanupController: SessionCleanupController
): Promise<void> {
  app.get("/api/settings/session-cleanup/scans/latest", sessionCleanupController.readLatestScan);
  app.post("/api/settings/session-cleanup/scans", sessionCleanupController.triggerScan);
  app.post("/api/settings/session-cleanup/backups", sessionCleanupController.triggerBackup);
  app.post("/api/settings/session-cleanup/backup-inspections", sessionCleanupController.inspectBackup);
  app.post("/api/settings/session-cleanup/restores", sessionCleanupController.triggerRestore);
  app.post("/api/settings/session-cleanup/deletions", sessionCleanupController.triggerDelete);
  app.get("/api/settings/session-cleanup/tasks/latest-delete", sessionCleanupController.readLatestDeleteTask);
  app.get("/api/settings/session-cleanup/tasks/delete-detail", sessionCleanupController.readDeleteTaskDetail);
  app.post("/api/settings/session-cleanup/butler-residue/purge", sessionCleanupController.purgeButlerResidue);
}
