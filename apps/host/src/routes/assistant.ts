import type { FastifyInstance } from "fastify";

import type { AssistantCapabilityController } from "../modules/assistant-capability/assistant-capability-controller.js";

export async function registerAssistantCapabilityRoutes(
  app: FastifyInstance,
  assistantCapabilityController: AssistantCapabilityController
): Promise<void> {
  app.get("/api/assistant/capabilities", assistantCapabilityController.listCapabilities);
  app.get("/api/assistant/projects", assistantCapabilityController.listProjects);
  app.get("/api/assistant/projects/:projectId", assistantCapabilityController.getProject);
  app.get("/api/assistant/projects/:projectId/sessions", assistantCapabilityController.listProjectSessions);
  app.get("/api/assistant/sessions/:sessionId", assistantCapabilityController.getSession);
  app.get("/api/assistant/sessions/:sessionId/messages", assistantCapabilityController.listSessionMessages);
  app.get("/api/assistant/sessions/:sessionId/runtime", assistantCapabilityController.getSessionRuntime);
  app.post("/api/assistant/sessions/:sessionId/messages", assistantCapabilityController.sendSessionMessage);
  app.post("/api/assistant/sessions/:sessionId/forks", assistantCapabilityController.forkSession);
  app.get("/api/assistant/terminals", assistantCapabilityController.listTerminals);
  app.get("/api/assistant/terminals/:terminalId/history", assistantCapabilityController.readTerminalHistory);
  app.post("/api/assistant/terminals/:terminalId/input", assistantCapabilityController.sendTerminalInput);
}
