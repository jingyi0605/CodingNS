import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ButlerControlActionService } from "../../src/modules/butler/butler-control-action-service.js";
import type { ButlerControlSessionService } from "../../src/modules/butler/butler-control-session-service.js";
import type { ButlerContextAggregator } from "../../src/modules/butler/context-aggregator.js";
import type { ButlerFollowUpService } from "../../src/modules/butler/butler-follow-up-service.js";
import type { ButlerInboxService } from "../../src/modules/butler/butler-inbox-service.js";
import type { ButlerProfileService } from "../../src/modules/butler/butler-profile-service.js";
import type { ButlerProjectService } from "../../src/modules/butler/butler-project-service.js";
import type { ButlerSessionService } from "../../src/modules/butler/butler-session-service.js";
import { ButlerController } from "../../src/modules/butler/butler-controller.js";
import type { PatrolExecutionService } from "../../src/modules/butler/patrol-execution-service.js";
import type { PatrolPlanService } from "../../src/modules/butler/patrol-plan-service.js";
import type { PatrolRunService } from "../../src/modules/butler/patrol-run-service.js";
import type { ProjectMemoryService } from "../../src/modules/butler/project-memory-service.js";
import type { VerificationRunService } from "../../src/modules/butler/verification-run-service.js";
import { registerButlerRoutes } from "../../src/routes/butler.js";
import { setErrorHandler } from "../../src/shared/http/error-handler.js";

describe("butler follow-up routes", () => {
  const apps: FastifyInstance[] = [];

  async function createButlerApp(
    butlerFollowUpService: ButlerFollowUpService
  ): Promise<FastifyInstance> {
    const controller = new ButlerController(
      {} as ButlerProfileService,
      {} as ButlerControlSessionService,
      {} as ButlerControlActionService,
      {} as ButlerContextAggregator,
      butlerFollowUpService,
      {} as ButlerInboxService,
      {} as ButlerProjectService,
      {} as ButlerSessionService,
      {} as ProjectMemoryService,
      {} as PatrolPlanService,
      {} as PatrolRunService,
      {} as PatrolExecutionService,
      {} as VerificationRunService
    );
    const app = Fastify({ logger: false });
    apps.push(app);
    app.addHook("onRequest", async (request) => {
      (request as any).auth = {
        accessToken: "token",
        user: {
          userId: "user-1",
          username: "admin",
          role: "admin"
        }
      };
    });
    await registerButlerRoutes(app, controller);
    app.setErrorHandler(setErrorHandler);
    return app;
  }

  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();

      if (app) {
        await app.close();
      }
    }
  });

  it("可以列出并创建会话跟进任务", async () => {
    const task = {
      id: "follow-up-1",
      projectId: "project-1",
      projectName: "项目甲",
      workspaceId: "workspace-1",
      butlerSessionId: "butler-session-1",
      sessionId: "session-1",
      sessionTitle: "登录页开发",
      objective: "把这个功能真正做完",
      status: "active",
      checkIntervalSeconds: 300,
      lastCheckedAt: "2026-04-07T00:05:00.000Z",
      nextCheckAt: "2026-04-07T00:10:00.000Z",
      lastObservedRunningState: "running",
      lastObservedMessageAt: "2026-04-07T00:05:00.000Z",
      lastObservedMessageCount: 12,
      lastAutomationSummary: "会话仍在运行，助手继续观察当前进度。",
      lastAutomationAt: null,
      autoContinueCount: 0,
      waitingReason: null,
      createdAt: "2026-04-07T00:00:00.000Z",
      updatedAt: "2026-04-07T00:05:00.000Z",
      completedAt: null
    };
    const butlerFollowUpService = {
      listTasks: vi.fn(() => [task]),
      createTask: vi.fn(async () => task)
    } as unknown as ButlerFollowUpService;
    const app = await createButlerApp(butlerFollowUpService);

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/butler/follow-up-tasks?status=active&sessionId=session-1"
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().items).toHaveLength(1);
    expect((butlerFollowUpService.listTasks as any).mock.calls[0][0]).toEqual({
      statuses: ["active"],
      projectId: undefined,
      sessionId: "session-1"
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/butler/follow-up-tasks",
      payload: {
        projectId: "project-1",
        butlerSessionId: "butler-session-1",
        objective: "把这个功能真正做完"
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json().task.id).toBe("follow-up-1");
    expect((butlerFollowUpService.createTask as any).mock.calls[0][0]).toEqual({
      projectId: "project-1",
      butlerSessionId: "butler-session-1",
      objective: "把这个功能真正做完"
    });
    expect((butlerFollowUpService.createTask as any).mock.calls[0][1]).toBe("user-1");
  });

  it("可以读取单条会话跟进任务详情", async () => {
    const task = {
      id: "follow-up-1",
      projectId: "project-1",
      projectName: "项目甲",
      workspaceId: "workspace-1",
      butlerSessionId: "butler-session-1",
      sessionId: "session-1",
      sessionTitle: "登录页开发",
      objective: "把这个功能真正做完",
      status: "waiting_user",
      checkIntervalSeconds: 300,
      lastCheckedAt: "2026-04-07T00:05:00.000Z",
      nextCheckAt: null,
      lastObservedRunningState: "completed",
      lastObservedMessageAt: "2026-04-07T00:05:00.000Z",
      lastObservedMessageCount: 12,
      lastAutomationSummary: "当前需要你确认验证码失败后是锁定账号还是只做重试限制。",
      lastAutomationAt: "2026-04-07T00:06:00.000Z",
      autoContinueCount: 1,
      waitingReason: "需要你确认失败策略。",
      createdAt: "2026-04-07T00:00:00.000Z",
      updatedAt: "2026-04-07T00:06:00.000Z",
      completedAt: null
    };
    const butlerFollowUpService = {
      listTasks: vi.fn(() => []),
      createTask: vi.fn(),
      getTask: vi.fn(() => task)
    } as unknown as ButlerFollowUpService;
    const app = await createButlerApp(butlerFollowUpService);

    const response = await app.inject({
      method: "GET",
      url: "/api/butler/follow-up-tasks/follow-up-1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().task.id).toBe("follow-up-1");
    expect((butlerFollowUpService.getTask as any).mock.calls[0][0]).toBe("follow-up-1");
  });
});
