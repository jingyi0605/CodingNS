import type { FastifyInstance } from "fastify";

import type { TerminalController } from "../modules/terminal/terminal-controller.js";

export async function registerTerminalRoutes(
  app: FastifyInstance,
  terminalController: TerminalController
): Promise<void> {
  app.get("/api/terminals", terminalController.listTerminals);
  app.get("/api/terminals/shells", terminalController.listShellOptions);
  app.post("/api/terminals", terminalController.createTerminal);
  app.delete("/api/terminals/:terminalId", terminalController.closeTerminal);
  app.delete("/api/terminals/:terminalId/record", terminalController.deleteTerminal);
  app.post("/api/terminals/:terminalId/input", terminalController.writeInput);

  app.get("/api/terminals/templates", terminalController.listTemplates);
  app.get("/api/terminals/templates/runtime-status", terminalController.listTemplateRuntimeStatuses);
  app.post("/api/terminals/templates", terminalController.createTemplate);
  app.put("/api/terminals/templates/:templateId", terminalController.updateTemplate);
  app.delete("/api/terminals/templates/:templateId", terminalController.deleteTemplate);
  app.post("/api/terminals/templates/:templateId/run", terminalController.runTemplate);
  app.post("/api/terminals/templates/:templateId/stop", terminalController.stopTemplateRuntimeProcess);
}
