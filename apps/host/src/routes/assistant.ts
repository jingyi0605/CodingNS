import type { FastifyInstance } from "fastify";

import type { AssistantCapabilityController } from "../modules/assistant-capability/assistant-capability-controller.js";
import type {
  AssistantCapabilityReceipt,
  AssistantCapabilityService
} from "../modules/assistant-capability/assistant-capability-service.js";

export async function registerAssistantCapabilityRoutes(
  app: FastifyInstance,
  assistantCapabilityController: AssistantCapabilityController,
  assistantCapabilityService?: AssistantCapabilityService
): Promise<void> {
  app.addHook("preSerialization", async (request, _reply, payload) => {
    const routePath = request.url.split("?")[0] ?? request.url;

    if (!routePath.startsWith("/api/assistant/")) {
      return payload;
    }

    if (!request.auth?.callerKind || !isAssistantCapabilityReceipt(payload)) {
      return payload;
    }

    return {
      ...payload,
      callerKind: request.auth.callerKind
    };
  });

  void assistantCapabilityService;
  app.get("/api/assistant/capabilities", assistantCapabilityController.listCapabilities);
  app.get("/api/assistant/projects", assistantCapabilityController.listProjects);
  app.get("/api/assistant/projects/:projectId", assistantCapabilityController.getProject);
  app.get("/api/assistant/projects/:projectId/sessions", assistantCapabilityController.listProjectSessions);
  app.post("/api/assistant/projects/:projectId/sessions", assistantCapabilityController.startProjectSession);
  app.post("/api/assistant/sessions/start", assistantCapabilityController.startSession);
  app.get("/api/assistant/sessions/:sessionId", assistantCapabilityController.getSession);
  app.delete("/api/assistant/sessions/:sessionId", assistantCapabilityController.deleteSession);
  app.get("/api/assistant/sessions/:sessionId/messages", assistantCapabilityController.listSessionMessages);
  app.get("/api/assistant/sessions/:sessionId/runtime", assistantCapabilityController.getSessionRuntime);
  app.post("/api/assistant/sessions/:sessionId/messages", assistantCapabilityController.sendSessionMessage);
  app.post("/api/assistant/sessions/:sessionId/forks", assistantCapabilityController.forkSession);
  app.get("/api/assistant/automations", assistantCapabilityController.listAutomations);
  app.get("/api/assistant/automations/runs/recent", assistantCapabilityController.listRecentAutomationRuns);
  app.get("/api/assistant/automations/:automationId", assistantCapabilityController.getAutomation);
  app.post("/api/assistant/automations", assistantCapabilityController.createAutomation);
  app.patch("/api/assistant/automations/:automationId", assistantCapabilityController.updateAutomation);
  app.post("/api/assistant/automations/:automationId/cancel", assistantCapabilityController.cancelAutomation);
  app.post("/api/assistant/automations/:automationId/skip-wait", assistantCapabilityController.skipAutomationWait);
  app.get("/api/assistant/automations/:automationId/runs", assistantCapabilityController.listAutomationRuns);
  app.get("/api/assistant/timers", assistantCapabilityController.listTimers);
  app.get("/api/assistant/timers/:timerId", assistantCapabilityController.getTimer);
  app.post("/api/assistant/timers", assistantCapabilityController.createTimer);
  app.post("/api/assistant/timers/:timerId/cancel", assistantCapabilityController.cancelTimer);
  app.get("/api/assistant/follow-ups", assistantCapabilityController.listFollowUps);
  app.get("/api/assistant/follow-ups/:taskId", assistantCapabilityController.getFollowUp);
  app.post("/api/assistant/follow-ups", assistantCapabilityController.createFollowUp);
  app.post("/api/assistant/follow-ups/:taskId/continue", assistantCapabilityController.continueFollowUp);
  app.post("/api/assistant/follow-ups/:taskId/waiting-user", assistantCapabilityController.markFollowUpWaitingUser);
  app.post("/api/assistant/follow-ups/:taskId/complete", assistantCapabilityController.completeFollowUp);
  app.post("/api/assistant/follow-ups/:taskId/fail", assistantCapabilityController.failFollowUp);
  app.post("/api/assistant/terminals", assistantCapabilityController.createTerminal);
  app.get("/api/assistant/terminals", assistantCapabilityController.listTerminals);
  app.get("/api/assistant/terminals/:terminalId/history", assistantCapabilityController.readTerminalHistory);
  app.post("/api/assistant/terminals/:terminalId/input", assistantCapabilityController.sendTerminalInput);
  app.delete("/api/assistant/terminals/:terminalId", assistantCapabilityController.closeTerminal);
  app.post("/api/assistant/office/documents", assistantCapabilityController.createOfficeDocument);
  app.patch("/api/assistant/office/documents/:documentId", assistantCapabilityController.updateOfficeDocument);
  app.post("/api/assistant/office/documents/:documentId/export", assistantCapabilityController.exportOfficeDocument);
  app.get("/api/assistant/office/document-tasks/:taskId", assistantCapabilityController.getOfficeDocumentTask);
  app.post("/api/assistant/office/task-approvals/:approvalId/reply", assistantCapabilityController.replyOfficeTaskApproval);
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

function isAssistantCapabilityReceipt(payload: unknown): payload is AssistantCapabilityReceipt<unknown> {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as Partial<AssistantCapabilityReceipt<unknown>>;
  return (
    candidate.ok === true
    && typeof candidate.capability === "string"
    && typeof candidate.auditId === "string"
  );
}
