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
  app.delete("/api/assistant/terminals/:terminalId", assistantCapabilityController.closeTerminal);
  app.get("/api/assistant/workspaces", assistantCapabilityController.listWorkspaces);
  app.get("/api/assistant/workspaces/browse", assistantCapabilityController.browseWorkspaces);
  app.post("/api/assistant/workspaces/directories", assistantCapabilityController.createWorkspaceDirectory);
  app.post("/api/assistant/workspaces/import", assistantCapabilityController.importWorkspace);
  app.post("/api/assistant/workspaces/clone", assistantCapabilityController.cloneWorkspace);
  app.put("/api/assistant/workspaces/reorder", assistantCapabilityController.reorderWorkspaces);
  app.get("/api/assistant/workspaces/:workspaceId/management", assistantCapabilityController.getWorkspaceManagementSummary);
  app.put("/api/assistant/workspaces/:workspaceId/navigation-state", assistantCapabilityController.updateWorkspaceNavigationState);
  app.delete("/api/assistant/workspaces/:workspaceId", assistantCapabilityController.removeWorkspace);
  app.get("/api/assistant/worktrees/tree", assistantCapabilityController.getWorktreeTree);
  app.post("/api/assistant/worktrees", assistantCapabilityController.createWorktree);
  app.post("/api/assistant/worktrees/:workspaceId/merge-preview", assistantCapabilityController.getWorktreeMergePreview);
  app.post("/api/assistant/worktrees/:workspaceId/merge-into-parent", assistantCapabilityController.mergeWorktreeIntoParent);
  app.post("/api/assistant/worktrees/:workspaceId/cleanup", assistantCapabilityController.cleanupWorktree);
  app.get("/api/assistant/debug-targets/compatibility-matrix", assistantCapabilityController.getDebugCompatibilityMatrix);
  app.post("/api/assistant/debug-targets/analyze", assistantCapabilityController.analyzeDebugTarget);
  app.get("/api/assistant/debug-targets/:targetId/framework-analysis", assistantCapabilityController.getDebugFrameworkAnalysis);
  app.post(
    "/api/assistant/debug-targets/:targetId/framework-analysis/refresh",
    assistantCapabilityController.refreshDebugFrameworkAnalysis
  );
  app.post("/api/assistant/debug-targets/:targetId/launch-plan", assistantCapabilityController.createDebugLaunchPlan);
  app.post("/api/assistant/debug-targets/:targetId/run", assistantCapabilityController.runDebugTarget);
  app.get("/api/assistant/debug-targets/:targetId/runtime-latest", assistantCapabilityController.getLatestDebugRuntime);
  app.get("/api/assistant/debug-targets/:targetId/runtimes", assistantCapabilityController.listDebugRuntimes);
  app.get("/api/assistant/debug-runtimes/:runtimeId", assistantCapabilityController.getDebugRuntime);
}
