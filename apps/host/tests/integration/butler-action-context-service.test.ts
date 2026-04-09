import { beforeEach, describe, expect, it, vi } from "vitest";

import { ButlerActionContextService } from "../../src/modules/butler/butler-action-context-service.js";

describe("ButlerActionContextService", () => {
  const project = {
    id: "project-1",
    workspaceId: "workspace-1",
    name: "项目甲",
    repoRoot: "/tmp/project-a",
    lifecycleStatus: "active",
    riskLevel: "low"
  };
  const session = {
    id: "butler-session-1",
    projectId: "project-1",
    sessionId: "session-1",
    provider: "codex",
    title: "登录页开发",
    isArchived: false,
    role: "adhoc",
    ownershipMode: "observed",
    status: "running",
    runningState: "running",
    lastSummary: "正在推进",
    lastCheckpointAt: "2026-04-07T00:05:00.000Z",
    createdAt: "2026-04-07T00:00:00.000Z",
    updatedAt: "2026-04-07T00:05:00.000Z"
  };
  const latestFollowUpTask = {
    id: "follow-up-1",
    projectId: "project-1",
    projectName: "项目甲",
    workspaceId: "workspace-1",
    butlerSessionId: "butler-session-1",
    sessionId: "session-1",
    sessionTitle: "登录页开发",
    objective: "帮我把这个会话的功能真正做完",
    completionCriteria: "完成当前功能",
    maxAutoContinueCount: 5,
    status: "waiting_user",
    checkIntervalSeconds: 300,
    lastCheckedAt: null,
    nextCheckAt: null,
    lastObservedRunningState: "completed",
    lastObservedMessageAt: null,
    lastObservedMessageCount: 12,
    lastAutomationSummary: "需要你确认失败策略。",
    lastAutomationAt: null,
    autoContinueCount: 1,
    waitingReason: "需要你确认失败策略。",
    rounds: [],
    createdAt: "2026-04-07T00:00:00.000Z",
    updatedAt: "2026-04-07T00:05:00.000Z",
    completedAt: null
  };

  let butlerProjectService: {
    resolveWorkspaceActionProject: ReturnType<typeof vi.fn>;
  };
  let butlerSessionService: {
    getSessionWorkspaceId: ReturnType<typeof vi.fn>;
    resolveActionTarget: ReturnType<typeof vi.fn>;
  };
  let butlerFollowUpService: {
    listTasks: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    butlerProjectService = {
      resolveWorkspaceActionProject: vi.fn(() => project)
    };
    butlerSessionService = {
      getSessionWorkspaceId: vi.fn(() => "workspace-1"),
      resolveActionTarget: vi.fn(async () => ({
        workspaceId: "workspace-1",
        session
      }))
    };
    butlerFollowUpService = {
      listTasks: vi.fn(() => [latestFollowUpTask])
    };
  });

  it("会聚合当前会话的助手动作上下文", async () => {
    const service = new ButlerActionContextService(
      butlerProjectService as never,
      butlerSessionService as never,
      butlerFollowUpService as never
    );

    const context = await service.getSessionActionContext("session-1", "user-1");

    expect(context.workspaceId).toBe("workspace-1");
    expect(context.project.id).toBe("project-1");
    expect(context.session.id).toBe("butler-session-1");
    expect(context.latestFollowUpTask?.id).toBe("follow-up-1");
    expect(butlerFollowUpService.listTasks).toHaveBeenCalledWith({
      sessionId: "session-1",
      limit: 1
    });
  });

  it("会复用预热中的上下文构建，避免同一会话重复慢查询", async () => {
    let resolveTarget: ((value: { workspaceId: string; session: typeof session }) => void) | null = null;
    const targetPromise = new Promise<{ workspaceId: string; session: typeof session }>((resolve) => {
      resolveTarget = resolve;
    });

    butlerSessionService.resolveActionTarget.mockReturnValue(targetPromise);

    const service = new ButlerActionContextService(
      butlerProjectService as never,
      butlerSessionService as never,
      butlerFollowUpService as never
    );

    service.preloadSessionActionContext("session-1", "user-1");
    const contextPromise = service.getSessionActionContext("session-1", "user-1");

    expect(butlerSessionService.resolveActionTarget).toHaveBeenCalledTimes(1);

    resolveTarget?.({
      workspaceId: "workspace-1",
      session
    });

    const context = await contextPromise;

    expect(context.session.sessionId).toBe("session-1");
    expect(butlerFollowUpService.listTasks).toHaveBeenCalledTimes(1);
  });

  it("失效后会重新构建上下文", async () => {
    const service = new ButlerActionContextService(
      butlerProjectService as never,
      butlerSessionService as never,
      butlerFollowUpService as never
    );

    await service.getSessionActionContext("session-1", "user-1");
    service.invalidateSessionActionContext("session-1");
    await service.getSessionActionContext("session-1", "user-1");

    expect(butlerSessionService.resolveActionTarget).toHaveBeenCalledTimes(2);
  });
});
