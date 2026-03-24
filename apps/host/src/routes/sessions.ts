import type { FastifyInstance } from "fastify";

import type { SessionController } from "../modules/sessions/session-controller.js";

export async function registerSessionRoutes(
  app: FastifyInstance,
  sessionController: SessionController
): Promise<void> {
  app.get("/api/sessions", sessionController.list);
  app.get("/api/sessions/:sessionId", sessionController.getDetail);
  app.get("/api/sessions/:sessionId/messages", sessionController.readMessages);
  app.get("/api/sessions/:sessionId/capabilities", sessionController.getCapabilities);
  app.get("/api/sessions/:sessionId/runtime", sessionController.getRuntime);
  app.post("/api/sessions/:sessionId/messages", sessionController.sendMessage);
  app.post("/api/sessions/:sessionId/messages/live", sessionController.sendLiveMessage);
  app.post("/api/sessions/:sessionId/interrupt", sessionController.interrupt);
  app.post("/api/sessions/:sessionId/seen", sessionController.markSeen);
  app.post("/api/sessions/:sessionId/resume", sessionController.resume);
  app.post("/api/sessions/start", sessionController.start);
  app.post("/api/sessions/start-live", sessionController.startLive);
}
