import type { FastifyInstance } from "fastify";

import type { ButlerController } from "../modules/butler/butler-controller.js";

export async function registerButlerRoutes(
  app: FastifyInstance,
  butlerController: ButlerController
): Promise<void> {
  app.get("/api/butler/projects", butlerController.listProjects);
  app.post("/api/butler/projects", butlerController.createProject);
  app.get("/api/butler/projects/:projectId", butlerController.getProject);
  app.patch("/api/butler/projects/:projectId", butlerController.updateProject);
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
