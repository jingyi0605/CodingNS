import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ButlerControlSessionService } from "../../src/modules/butler/butler-control-session-service.js";
import type { ButlerControlActionService } from "../../src/modules/butler/butler-control-action-service.js";
import type { ButlerFollowUpService } from "../../src/modules/butler/butler-follow-up-service.js";
import type { ButlerInboxService } from "../../src/modules/butler/butler-inbox-service.js";
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
import { AppError } from "../../src/shared/errors/app-error.js";
import { setErrorHandler } from "../../src/shared/http/error-handler.js";

describe("butler routes patrol runtime", () => {
  const apps: FastifyInstance[] = [];

  async function createButlerApp(
    patrolRunService: PatrolRunService,
    patrolExecutionService: PatrolExecutionService
  ): Promise<FastifyInstance> {
    const controller = new ButlerController(
      {} as ButlerProfileService,
      {} as ButlerControlSessionService,
      {} as ButlerControlActionService,
      {} as ButlerContextAggregator,
      {} as ButlerFollowUpService,
      {} as ButlerInboxService,
      {} as ButlerProjectService,
      {} as ButlerSessionService,
      {} as ProjectMemoryService,
      {} as PatrolPlanService,
      patrolRunService,
      patrolExecutionService,
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

  it("patrol-runs start|list|get 路由会返回巡视闭环结果", async () => {
    const patrolRunService = {
      startRun: vi.fn(() => ({
        id: "run-1",
        projectId: "project-1",
        planId: "plan-1",
        triggeredBy: "user",
        triggerRef: "manual:test",
        butlerSessionId: null,
        status: "queued",
        summary: null,
        riskLevel: null,
        suggestions: ["先检查只读审计"],
        startedAt: null,
        finishedAt: null,
        createdAt: "2026-04-03T02:00:00.000Z"
      })),
      listRuns: vi.fn(() => [
        {
          id: "run-1",
          projectId: "project-1",
          planId: "plan-1",
          triggeredBy: "user",
          triggerRef: "manual:test",
          butlerSessionId: "butler-session-1",
          status: "failed",
          summary: "只读巡视违反约束：检测到文件写入 src/runtime.ts。原巡视结论：主流程正常",
          riskLevel: "high",
          suggestions: ["检查并回滚本次只读巡视产生的文件改动"],
          startedAt: "2026-04-03T02:00:01.000Z",
          finishedAt: "2026-04-03T02:00:20.000Z",
          createdAt: "2026-04-03T02:00:00.000Z"
        }
      ]),
      getRun: vi.fn(() => ({
        id: "run-1",
        projectId: "project-1",
        planId: "plan-1",
        triggeredBy: "user",
        triggerRef: "manual:test",
        butlerSessionId: "butler-session-1",
        status: "failed",
        summary: "只读巡视违反约束：检测到文件写入 src/runtime.ts。原巡视结论：主流程正常",
        riskLevel: "high",
        suggestions: ["检查并回滚本次只读巡视产生的文件改动"],
        startedAt: "2026-04-03T02:00:01.000Z",
        finishedAt: "2026-04-03T02:00:20.000Z",
        createdAt: "2026-04-03T02:00:00.000Z"
      }))
    } as unknown as PatrolRunService;
    const patrolExecutionService = {
      executeQueuedRun: vi.fn(async () => ({
        id: "run-1",
        projectId: "project-1",
        planId: "plan-1",
        triggeredBy: "user",
        triggerRef: "manual:test",
        butlerSessionId: "butler-session-1",
        status: "failed",
        summary: "只读巡视违反约束：检测到文件写入 src/runtime.ts。原巡视结论：主流程正常",
        riskLevel: "high",
        suggestions: ["检查并回滚本次只读巡视产生的文件改动"],
        startedAt: "2026-04-03T02:00:01.000Z",
        finishedAt: "2026-04-03T02:00:20.000Z",
        createdAt: "2026-04-03T02:00:00.000Z"
      }))
    } as unknown as PatrolExecutionService;

    const app = await createButlerApp(patrolRunService, patrolExecutionService);

    const started = await app.inject({
      method: "POST",
      url: "/api/butler/projects/project-1/patrol-runs/start",
      payload: {
        planId: "plan-1",
        triggeredBy: "user",
        triggerRef: "manual:test",
        suggestions: ["先检查只读审计"]
      }
    });
    expect(started.statusCode).toBe(201);
    expect(started.json().run).toMatchObject({
      status: "failed",
      riskLevel: "high"
    });
    expect((patrolRunService as unknown as { startRun: ReturnType<typeof vi.fn> }).startRun).toHaveBeenCalledWith(
      "project-1",
      {
        planId: "plan-1",
        triggeredBy: "user",
        triggerRef: "manual:test",
        butlerSessionId: null,
        suggestions: ["先检查只读审计"]
      }
    );
    expect((patrolExecutionService as unknown as { executeQueuedRun: ReturnType<typeof vi.fn> }).executeQueuedRun).toHaveBeenCalledWith("run-1");

    const listed = await app.inject({
      method: "GET",
      url: "/api/butler/projects/project-1/patrol-runs?status=failed"
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toHaveLength(1);
    expect((patrolRunService as unknown as { listRuns: ReturnType<typeof vi.fn> }).listRuns).toHaveBeenCalledWith(
      "project-1",
      {
        status: "failed"
      }
    );

    const detail = await app.inject({
      method: "GET",
      url: "/api/butler/projects/project-1/patrol-runs/run-1"
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().run.summary).toContain("只读巡视违反约束");
    expect((patrolRunService as unknown as { getRun: ReturnType<typeof vi.fn> }).getRun).toHaveBeenCalledWith(
      "project-1",
      "run-1"
    );
  });

  it("patrol-runs/start 会透传 PATROL_PLAN_NOT_FOUND", async () => {
    const patrolRunService = {
      startRun: vi.fn(() => {
        throw new AppError({
          statusCode: 404,
          errorCode: "PATROL_PLAN_NOT_FOUND",
          detail: "关联巡视计划不存在"
        });
      })
    } as unknown as PatrolRunService;
    const patrolExecutionService = {
      executeQueuedRun: vi.fn(async () => {
        throw new Error("should not execute");
      })
    } as unknown as PatrolExecutionService;

    const app = await createButlerApp(patrolRunService, patrolExecutionService);
    const response = await app.inject({
      method: "POST",
      url: "/api/butler/projects/project-1/patrol-runs/start",
      payload: {
        planId: "plan-missing"
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error_code: "PATROL_PLAN_NOT_FOUND",
      detail: "关联巡视计划不存在"
    });
  });
});
