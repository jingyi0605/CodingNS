import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ButlerControlActionService } from "../../src/modules/butler/butler-control-action-service.js";
import type { ButlerControlSessionService } from "../../src/modules/butler/butler-control-session-service.js";
import type { ButlerContextAggregator } from "../../src/modules/butler/context-aggregator.js";
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

describe("butler control action routes", () => {
  const apps: FastifyInstance[] = [];

  async function createButlerApp(
    butlerControlActionService: ButlerControlActionService
  ): Promise<FastifyInstance> {
    const controller = new ButlerController(
      {} as ButlerProfileService,
      {} as ButlerControlSessionService,
      butlerControlActionService,
      {} as ButlerContextAggregator,
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

  it("控制动作与事件列表路由会返回结构化结果", async () => {
    const butlerControlActionService = {
      listCurrentEvents: vi.fn(() => [
        {
          id: "event-1",
          controlSessionId: "control-1",
          kind: "action",
          actionType: "resume-session",
          status: "succeeded",
          title: "已续接项目会话",
          content: "已续接项目会话。",
          relatedRefs: [],
          createdAt: "2026-04-05T00:10:00.000Z"
        }
      ]),
      openProject: vi.fn(() => ({
        event: {
          id: "event-2",
          controlSessionId: "control-1",
          kind: "action",
          actionType: "open-project",
          status: "succeeded",
          title: "已打开项目：控制台",
          content: "项目已打开",
          relatedRefs: [],
          createdAt: "2026-04-05T00:11:00.000Z"
        },
        context: {
          version: "ctx-1",
          generatedAt: "2026-04-05T00:11:00.000Z",
          project: {
            id: "project-1",
            workspaceId: "workspace-1",
            name: "控制台",
            repoRoot: "/tmp/control-app",
            lifecycleStatus: "active",
            riskLevel: "high",
            activeSessionCount: 1,
            sessionCount: 1,
            memoryCount: 0,
            failedPatrolCount: 0,
            failedVerificationCount: 0,
            latestSessionSummary: null,
            latestPatrolSummary: null,
            latestVerificationSummary: null,
            topRisks: [],
            nextActions: [],
            lastActivityAt: "2026-04-05T00:11:00.000Z",
            updatedAt: "2026-04-05T00:11:00.000Z"
          },
          sessions: [],
          memories: [],
          patrols: [],
          verifications: [],
          topRisks: [],
          nextActions: []
        }
      })),
      resumeProjectSession: vi.fn(async () => ({
        event: {
          id: "event-3",
          controlSessionId: "control-1",
          kind: "action",
          actionType: "resume-session",
          status: "succeeded",
          title: "已续接项目会话",
          content: "已续接项目会话。",
          relatedRefs: [],
          createdAt: "2026-04-05T00:12:00.000Z"
        },
        resumed: {
          session: {
            id: "butler-session-1",
            projectId: "project-1",
            sessionId: "session-1",
            provider: "codex",
            title: "修复控制台",
            role: "execution",
            ownershipMode: "managed",
            status: "running",
            runningState: "running",
            lastSummary: null,
            lastCheckpointAt: null,
            createdAt: "2026-04-05T00:00:00.000Z",
            updatedAt: "2026-04-05T00:12:00.000Z"
          },
          resumedAt: "2026-04-05T00:12:00.000Z",
          provider: "codex",
          providerSessionId: "provider-session-1"
        }
      })),
      startPatrol: vi.fn(async () => ({
        event: {
          id: "event-4",
          controlSessionId: "control-1",
          kind: "action",
          actionType: "start-patrol",
          status: "succeeded",
          title: "已发起巡视",
          content: "巡视已发起。",
          relatedRefs: [],
          createdAt: "2026-04-05T00:13:00.000Z"
        },
        run: {
          id: "run-1",
          projectId: "project-1",
          planId: null,
          triggeredBy: "user",
          triggerRef: "butler:control-action",
          butlerSessionId: null,
          status: "running",
          summary: "巡视已开始",
          riskLevel: null,
          suggestions: [],
          startedAt: "2026-04-05T00:13:00.000Z",
          finishedAt: null,
          createdAt: "2026-04-05T00:13:00.000Z"
        }
      })),
      startVerification: vi.fn(async () => ({
        event: {
          id: "event-5",
          controlSessionId: "control-1",
          kind: "action",
          actionType: "start-verification",
          status: "succeeded",
          title: "已发起验证",
          content: "验证已发起。",
          relatedRefs: [],
          createdAt: "2026-04-05T00:14:00.000Z"
        },
        run: {
          id: "verification-1",
          projectId: "project-1",
          butlerSessionId: null,
          sourcePatrolRunId: null,
          verificationType: "test",
          status: "passed",
          targetRef: "apps/host",
          spec: {},
          artifactRefs: [],
          result: {},
          summary: "验证通过",
          startedAt: "2026-04-05T00:14:00.000Z",
          finishedAt: "2026-04-05T00:14:05.000Z",
          createdAt: "2026-04-05T00:14:00.000Z"
        }
      }))
    } as unknown as ButlerControlActionService;

    const app = await createButlerApp(butlerControlActionService);

    const eventsResponse = await app.inject({
      method: "GET",
      url: "/api/butler/control-session/events"
    });
    expect(eventsResponse.statusCode).toBe(200);
    expect(eventsResponse.json().items).toHaveLength(1);

    const openProjectResponse = await app.inject({
      method: "POST",
      url: "/api/butler/actions/open-project",
      payload: {
        projectId: "project-1"
      }
    });
    expect(openProjectResponse.statusCode).toBe(200);
    expect(openProjectResponse.json().result.context.project.id).toBe("project-1");

    const resumeResponse = await app.inject({
      method: "POST",
      url: "/api/butler/actions/resume-session",
      payload: {
        projectId: "project-1",
        butlerSessionId: "butler-session-1"
      }
    });
    expect(resumeResponse.statusCode).toBe(200);
    expect(resumeResponse.json().result.resumed.session.sessionId).toBe("session-1");

    const patrolResponse = await app.inject({
      method: "POST",
      url: "/api/butler/actions/start-patrol",
      payload: {
        projectId: "project-1"
      }
    });
    expect(patrolResponse.statusCode).toBe(201);
    expect(patrolResponse.json().result.run.id).toBe("run-1");

    const verificationResponse = await app.inject({
      method: "POST",
      url: "/api/butler/actions/start-verification",
      payload: {
        projectId: "project-1",
        verificationType: "test"
      }
    });
    expect(verificationResponse.statusCode).toBe(201);
    expect(verificationResponse.json().result.run.id).toBe("verification-1");
  });
});
