import type { FastifyInstance } from "fastify";

import type { ButlerController } from "../modules/butler/butler-controller.js";

export async function registerButlerRoutes(
  app: FastifyInstance,
  butlerController: ButlerController
): Promise<void> {
  app.get("/api/butler/profile", butlerController.getProfile);
  app.post("/api/butler/profile/init", butlerController.initProfile);
  app.patch("/api/butler/profile", butlerController.updateProfile);
  app.get("/api/butler/control-session", butlerController.getCurrentControlSession);
  app.get("/api/butler/control-sessions", butlerController.listControlSessions);
  app.get("/api/butler/control-sessions/:controlSessionId", butlerController.getControlSession);
  app.get("/api/butler/control-session/events", butlerController.listControlSessionEvents);
  app.post("/api/butler/control-session/reset", butlerController.resetControlSession);
  app.post("/api/butler/control-session/start", butlerController.startControlSession);
  app.post("/api/butler/control-session/resume", butlerController.resumeControlSession);
  app.post("/api/butler/control-session/messages", butlerController.sendControlMessage);
  app.get("/api/butler/overview", butlerController.getOverview);
  app.get("/api/butler/follow-up-tasks", butlerController.listFollowUpTasks);
  app.get("/api/butler/follow-up-tasks/:taskId", butlerController.getFollowUpTask);
  app.post("/api/butler/follow-up-tasks", butlerController.createFollowUpTask);
  app.post("/api/butler/follow-up-tasks/:taskId/cancel", butlerController.cancelFollowUpTask);
  app.get("/api/butler/inbox", butlerController.listInboxItems);
  app.post("/api/butler/inbox", butlerController.createInboxItem);
  app.patch("/api/butler/inbox/:itemId", butlerController.updateInboxItem);
  app.post("/api/butler/inbox/:itemId/analyze", butlerController.analyzeInboxItem);
  app.post("/api/butler/inbox/:itemId/start-session", butlerController.startInboxItemSession);
  app.delete("/api/butler/inbox/:itemId", butlerController.deleteInboxItem);
  app.get("/api/butler/notifications/archives", butlerController.listNotificationArchives);
  app.patch("/api/butler/notifications/archives/:notificationId", butlerController.updateNotificationArchive);
  app.get("/api/butler/context-snapshot", butlerController.getContextSnapshot);
  app.get("/api/butler/search", butlerController.searchSummaries);
  app.get("/api/butler/session-target", butlerController.getSessionTarget);
  app.get("/api/butler/session-action-context", butlerController.getSessionActionContext);
  app.post("/api/butler/actions/open-project", butlerController.openProjectAction);
  app.post("/api/butler/actions/resume-session", butlerController.resumeProjectSessionAction);
  app.post("/api/butler/actions/start-patrol", butlerController.startPatrolAction);
  app.post("/api/butler/actions/start-verification", butlerController.startVerificationAction);
  app.get("/api/butler/projects", butlerController.listProjects);
  app.post("/api/butler/projects", butlerController.createProject);
  app.get("/api/butler/projects/:projectId", butlerController.getProject);
  app.patch("/api/butler/projects/:projectId", butlerController.updateProject);
  app.get("/api/butler/projects/:projectId/context", butlerController.getProjectContext);
  app.get("/api/butler/projects/:projectId/overview", butlerController.getProjectOverview);
  app.get("/api/butler/projects/:projectId/sessions", butlerController.listProjectSessions);
  app.post("/api/butler/projects/:projectId/sessions/start", butlerController.startProjectSession);
  app.post("/api/butler/projects/:projectId/sessions/import", butlerController.importProjectSession);
  app.post(
    "/api/butler/projects/:projectId/sessions/:butlerSessionId/resume",
    butlerController.resumeProjectSession
  );
  app.post(
    "/api/butler/projects/:projectId/sessions/:butlerSessionId/snapshot",
    butlerController.captureProjectSessionSnapshot
  );
  app.get("/api/butler/projects/:projectId/memories", butlerController.listProjectMemories);
  app.post("/api/butler/projects/:projectId/memories", butlerController.createProjectMemory);
  app.patch("/api/butler/projects/:projectId/memories/:memoryId", butlerController.updateProjectMemory);
  app.get("/api/butler/projects/:projectId/patrol-plans", butlerController.listPatrolPlans);
  app.post("/api/butler/projects/:projectId/patrol-plans", butlerController.createPatrolPlan);
  app.patch("/api/butler/projects/:projectId/patrol-plans/:planId", butlerController.updatePatrolPlan);
  app.get("/api/butler/projects/:projectId/patrol-runs", butlerController.listPatrolRuns);
  app.post("/api/butler/projects/:projectId/patrol-runs/start", butlerController.startPatrolRun);
  app.get("/api/butler/projects/:projectId/patrol-runs/:runId", butlerController.getPatrolRun);
  app.get("/api/butler/projects/:projectId/verifications", butlerController.listVerificationRuns);
  app.post("/api/butler/projects/:projectId/verifications", butlerController.startVerificationRun);
  app.get(
    "/api/butler/projects/:projectId/verifications/:verificationId",
    butlerController.getVerificationRun
  );
}
