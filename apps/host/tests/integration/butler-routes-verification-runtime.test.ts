import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ButlerControlSessionService } from "../../src/modules/butler/butler-control-session-service.js";
import type { ButlerControlActionService } from "../../src/modules/butler/butler-control-action-service.js";
import type { ButlerFollowUpService } from "../../src/modules/butler/butler-follow-up-service.js";
import type { ButlerInboxService } from "../../src/modules/butler/butler-inbox-service.js";
import type { ButlerNotificationService } from "../../src/modules/butler/butler-notification-service.js";
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

describe("butler routes verification runtime", () => {
  const apps: FastifyInstance[] = [];

  async function createButlerApp(verificationRunService: VerificationRunService): Promise<FastifyInstance> {
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
      verificationRunService
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

  it("verifications create|list|get 路由会返回验证结果", async () => {
    const verificationRunService = {
      startRun: vi.fn(async () => ({
        id: "verification-1",
        projectId: "project-1",
        butlerSessionId: "butler-session-1",
        sourcePatrolRunId: "run-1",
        verificationType: "test",
        status: "running",
        targetRef: null,
        spec: {
          command: "pnpm",
          args: ["test"]
        },
        artifactRefs: [
          {
            kind: "stdout",
            preview: "all green"
          }
        ],
        result: {
          accepted: true
        },
        summary: null,
        startedAt: "2026-04-03T03:00:00.000Z",
        finishedAt: null,
        createdAt: "2026-04-03T03:00:00.000Z"
      })),
      cancelRun: vi.fn(() => ({
        id: "verification-1",
        projectId: "project-1",
        butlerSessionId: "butler-session-1",
        sourcePatrolRunId: "run-1",
        verificationType: "test",
        status: "cancelled",
        targetRef: null,
        spec: {
          command: "pnpm",
          args: ["test"]
        },
        artifactRefs: [],
        result: {
          cancelledBy: "user"
        },
        summary: "已手动结束当前会话验证，并停止关联自动化执行。",
        startedAt: "2026-04-03T03:00:00.000Z",
        finishedAt: "2026-04-03T03:00:02.000Z",
        createdAt: "2026-04-03T03:00:00.000Z"
      })),
      listRuns: vi.fn(() => [
        {
          id: "verification-1",
          projectId: "project-1",
          butlerSessionId: "butler-session-1",
          sourcePatrolRunId: "run-1",
          verificationType: "test",
          status: "passed",
          targetRef: null,
          spec: {
            command: "pnpm",
            args: ["test"]
          },
          artifactRefs: [],
          result: {
            exitCode: 0
          },
          summary: "测试验证通过：命令以退出码 0 结束",
          startedAt: "2026-04-03T03:00:00.000Z",
          finishedAt: "2026-04-03T03:00:05.000Z",
          createdAt: "2026-04-03T03:00:00.000Z"
        }
      ]),
      getRun: vi.fn(() => ({
        id: "verification-1",
        projectId: "project-1",
        butlerSessionId: "butler-session-1",
        sourcePatrolRunId: "run-1",
        verificationType: "test",
        status: "passed",
        targetRef: null,
        spec: {
          command: "pnpm",
          args: ["test"]
        },
        artifactRefs: [],
        result: {
          exitCode: 0
        },
        summary: "测试验证通过：命令以退出码 0 结束",
        startedAt: "2026-04-03T03:00:00.000Z",
        finishedAt: "2026-04-03T03:00:05.000Z",
        createdAt: "2026-04-03T03:00:00.000Z"
      }))
    } as unknown as VerificationRunService;

    const app = await createButlerApp(verificationRunService);

    const created = await app.inject({
      method: "POST",
      url: "/api/butler/projects/project-1/verifications",
      payload: {
        verificationType: "test",
        butlerSessionId: "butler-session-1",
        sourcePatrolRunId: "run-1",
        spec: {
          command: "pnpm",
          args: ["test"]
        }
      }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().run.status).toBe("running");
    expect((verificationRunService as unknown as { startRun: ReturnType<typeof vi.fn> }).startRun).toHaveBeenCalledWith(
      "project-1",
      {
        verificationType: "test",
        targetRef: null,
        butlerSessionId: "butler-session-1",
        sourcePatrolRunId: "run-1",
        spec: {
          command: "pnpm",
          args: ["test"]
        }
      }
    );

    const listed = await app.inject({
      method: "GET",
      url: "/api/butler/projects/project-1/verifications?status=passed&verificationType=test"
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toHaveLength(1);

    const detail = await app.inject({
      method: "GET",
      url: "/api/butler/projects/project-1/verifications/verification-1"
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().run.summary).toContain("测试验证通过");

    const cancelled = await app.inject({
      method: "POST",
      url: "/api/butler/projects/project-1/verifications/verification-1/cancel"
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().run.status).toBe("cancelled");
    expect((verificationRunService as unknown as { cancelRun: ReturnType<typeof vi.fn> }).cancelRun).toHaveBeenCalledWith(
      "project-1",
      "verification-1"
    );
  });

  it("verifications 会透传 VERIFICATION_TYPE_UNSUPPORTED", async () => {
    const verificationRunService = {
      startRun: vi.fn(async () => {
        throw new AppError({
          statusCode: 400,
          errorCode: "VERIFICATION_TYPE_UNSUPPORTED",
          detail: "当前阶段暂不支持 browser 验证"
        });
      })
    } as unknown as VerificationRunService;

    const app = await createButlerApp(verificationRunService);
    const response = await app.inject({
      method: "POST",
      url: "/api/butler/projects/project-1/verifications",
      payload: {
        verificationType: "browser",
        targetRef: "http://127.0.0.1:3000"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error_code: "VERIFICATION_TYPE_UNSUPPORTED",
      detail: "当前阶段暂不支持 browser 验证"
    });
  });
});
