import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ButlerControlActionService } from "../../src/modules/butler/butler-control-action-service.js";
import type { ButlerControlSessionService } from "../../src/modules/butler/butler-control-session-service.js";
import type { ButlerControlTimerService } from "../../src/modules/butler/butler-control-timer-service.js";
import type { ButlerContextAggregator } from "../../src/modules/butler/context-aggregator.js";
import type { ButlerFollowUpService } from "../../src/modules/butler/butler-follow-up-service.js";
import type { ButlerInboxService } from "../../src/modules/butler/butler-inbox-service.js";
import type { ButlerNotificationService } from "../../src/modules/butler/butler-notification-service.js";
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

describe("butler control-timer routes", () => {
  const apps: FastifyInstance[] = [];

  async function createButlerApp(
    butlerControlTimerService: ButlerControlTimerService
  ): Promise<FastifyInstance> {
    const controller = new ButlerController(
      {} as ButlerProfileService,
      {} as ButlerControlSessionService,
      {} as ButlerControlActionService,
      {} as ButlerContextAggregator,
      {} as ButlerFollowUpService,
      {} as ButlerInboxService,
      {} as ButlerNotificationService,
      {} as ButlerProjectService,
      {} as ButlerSessionService,
      {} as ProjectMemoryService,
      {} as PatrolPlanService,
      {} as PatrolRunService,
      {} as PatrolExecutionService,
      {} as VerificationRunService,
      undefined,
      butlerControlTimerService
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

  it("control-timer list|get|create|cancel 路由会正确透传计时器结果", async () => {
    const timerRecord = {
      id: "timer-1",
      controlSessionId: "control-1",
      sessionId: "session-1",
      userId: "user-1",
      projectId: "project-1",
      targetSessionId: "session-target-1",
      title: "5 分钟后继续",
      content: "5 分钟后继续跟进真实会话",
      dueAt: "2026-04-16T08:05:00.000Z",
      status: "active" as const,
      triggeredAt: null,
      lastError: null,
      createdAt: "2026-04-16T08:00:00.000Z",
      updatedAt: "2026-04-16T08:00:00.000Z",
      cancelledAt: null,
      controlSession: {
        id: "control-1",
        providerId: "codex" as const,
        sessionId: "session-1",
        purpose: "chat" as const,
        title: "当前控制会话",
        sourceItemId: null,
        model: "gpt-5.4",
        reasoningLevel: "medium",
        permissionMode: "default",
        status: "running" as const,
        lastContextVersion: null,
        lastSummary: null,
        createdAt: "2026-04-16T08:00:00.000Z",
        updatedAt: "2026-04-16T08:00:00.000Z",
        session: {
          sessionId: "session-1",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "provider-session-1",
          rawStoreRef: "raw-1",
          parentSessionId: null,
          isSubagent: false,
          subagentLabel: null,
          isArchived: false,
          isFavorite: false,
          title: "当前控制会话",
          messageCount: 1,
          lastMessageAt: "2026-04-16T08:00:00.000Z",
          createdAt: "2026-04-16T08:00:00.000Z",
          updatedAt: "2026-04-16T08:00:00.000Z",
          syncStatus: "idle",
          syncCursor: null,
          lastSyncAt: "2026-04-16T08:00:00.000Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          runningState: "running",
          activitySource: "runtime",
          activityResolutionSource: "authoritative_runtime",
          activityConfidence: "authoritative",
          runId: null,
          lastEventAt: "2026-04-16T08:00:00.000Z",
          completedAt: null,
          lastSeenAt: null,
          watchdogTriggeredAt: null,
          activityState: "running"
        }
      }
    };
    const butlerControlTimerService = {
      listTimers: vi.fn(() => [timerRecord]),
      getTimer: vi.fn(() => timerRecord),
      createTimer: vi.fn(() => timerRecord),
      cancelTimer: vi.fn(() => ({
        ...timerRecord,
        status: "cancelled" as const,
        updatedAt: "2026-04-16T08:01:00.000Z",
        cancelledAt: "2026-04-16T08:01:00.000Z"
      }))
    } as unknown as ButlerControlTimerService;

    const app = await createButlerApp(butlerControlTimerService);

    const listed = await app.inject({
      method: "GET",
      url: "/api/butler/control-timers?status=active&controlSessionId=control-1&limit=5"
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items[0].id).toBe("timer-1");
    expect((butlerControlTimerService.listTimers as any)).toHaveBeenCalledWith({
      userId: "user-1",
      statuses: ["active"],
      controlSessionId: "control-1",
      limit: 5
    });

    const detail = await app.inject({
      method: "GET",
      url: "/api/butler/control-timers/timer-1"
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().timer.content).toBe("5 分钟后继续跟进真实会话");

    const created = await app.inject({
      method: "POST",
      url: "/api/butler/control-timers",
      payload: {
        controlSessionId: "control-1",
        title: "5 分钟后继续",
        content: "5 分钟后继续跟进真实会话",
        afterSeconds: 300
      }
    });
    expect(created.statusCode).toBe(201);
    expect((butlerControlTimerService.createTimer as any)).toHaveBeenCalledWith({
      userId: "user-1",
      controlSessionId: "control-1",
      projectId: undefined,
      targetSessionId: undefined,
      title: "5 分钟后继续",
      content: "5 分钟后继续跟进真实会话",
      dueAt: undefined,
      afterSeconds: 300
    });

    const cancelled = await app.inject({
      method: "POST",
      url: "/api/butler/control-timers/timer-1/cancel",
      payload: {}
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().timer.status).toBe("cancelled");
    expect((butlerControlTimerService.cancelTimer as any)).toHaveBeenCalledWith("timer-1", "user-1");
  });
});
