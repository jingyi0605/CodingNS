import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ButlerProjectService } from "../../src/modules/butler/butler-project-service.js";
import type { ButlerSessionService } from "../../src/modules/butler/butler-session-service.js";
import type { PatrolExecutionService } from "../../src/modules/butler/patrol-execution-service.js";
import type { PatrolPlanService } from "../../src/modules/butler/patrol-plan-service.js";
import type { PatrolRunService } from "../../src/modules/butler/patrol-run-service.js";
import { ButlerController } from "../../src/modules/butler/butler-controller.js";
import type { ProjectMemoryService } from "../../src/modules/butler/project-memory-service.js";
import type { VerificationRunService } from "../../src/modules/butler/verification-run-service.js";
import { registerButlerRoutes } from "../../src/routes/butler.js";
import { AppError } from "../../src/shared/errors/app-error.js";
import { setErrorHandler } from "../../src/shared/http/error-handler.js";

describe("butler routes session lifecycle", () => {
  const apps: FastifyInstance[] = [];

  async function createButlerApp(butlerSessionService: ButlerSessionService): Promise<FastifyInstance> {
    const controller = new ButlerController(
      {} as ButlerProjectService,
      butlerSessionService,
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

  it("sessions/start|resume|snapshot 路由会调用 butler 会话服务并返回结果", async () => {
    const butlerSessionService = {
      startSession: vi.fn(async () => ({
        id: "butler-session-1",
        projectId: "project-1",
        sessionId: "session-1",
        provider: "codex",
        title: null,
        role: "adhoc",
        ownershipMode: "managed",
        status: "running",
        runningState: "running",
        lastSummary: "已创建并启动托管会话，provider=codex",
        lastCheckpointAt: "2026-04-03T01:00:00.000Z",
        createdAt: "2026-04-03T01:00:00.000Z",
        updatedAt: "2026-04-03T01:00:00.000Z"
      })),
      resumeSession: vi.fn(async () => ({
        resumedAt: "2026-04-03T01:10:00.000Z",
        provider: "codex",
        providerSessionId: "provider-session-1",
        session: {
          id: "butler-session-1",
          projectId: "project-1",
          sessionId: "session-1",
          provider: "codex",
          title: null,
          role: "adhoc",
          ownershipMode: "managed",
          status: "running",
          runningState: "running",
          lastSummary: "会话「巡检会话」状态快照：running",
          lastCheckpointAt: "2026-04-03T01:10:00.000Z",
          createdAt: "2026-04-03T01:00:00.000Z",
          updatedAt: "2026-04-03T01:10:00.000Z"
        }
      })),
      captureSessionSnapshot: vi.fn(() => ({
        id: "butler-session-1",
        projectId: "project-1",
        sessionId: "session-1",
        provider: "codex",
        title: "巡检会话",
        role: "adhoc",
        ownershipMode: "managed",
        status: "running",
        runningState: "running",
        lastSummary: "会话「巡检会话」状态快照：running",
        lastCheckpointAt: "2026-04-03T01:12:00.000Z",
        createdAt: "2026-04-03T01:00:00.000Z",
        updatedAt: "2026-04-03T01:12:00.000Z"
      }))
    } as unknown as ButlerSessionService;

    const app = await createButlerApp(butlerSessionService);

    const started = await app.inject({
      method: "POST",
      url: "/api/butler/projects/project-1/sessions/start",
      payload: {
        providerId: "codex",
        role: "adhoc",
        ownershipMode: "managed",
        content: "请先检查项目进展",
        model: "gpt-5",
        reasoningLevel: "medium",
        permissionMode: "acceptEdits"
      }
    });
    expect(started.statusCode).toBe(201);
    expect(started.json().session.sessionId).toBe("session-1");
    expect((butlerSessionService as unknown as { startSession: ReturnType<typeof vi.fn> }).startSession).toHaveBeenCalledWith(
      "project-1",
      {
        providerId: "codex",
        role: "adhoc",
        ownershipMode: "managed",
        content: "请先检查项目进展",
        model: "gpt-5",
        reasoningLevel: "medium",
        permissionMode: "acceptEdits"
      },
      "user-1"
    );

    const resumed = await app.inject({
      method: "POST",
      url: "/api/butler/projects/project-1/sessions/butler-session-1/resume"
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().providerSessionId).toBe("provider-session-1");
    expect((butlerSessionService as unknown as { resumeSession: ReturnType<typeof vi.fn> }).resumeSession).toHaveBeenCalledWith(
      "project-1",
      "butler-session-1",
      "user-1"
    );

    const snapshot = await app.inject({
      method: "POST",
      url: "/api/butler/projects/project-1/sessions/butler-session-1/snapshot",
      payload: {
        sourceKind: "manual"
      }
    });
    expect(snapshot.statusCode).toBe(201);
    expect(snapshot.json().session.lastCheckpointAt).toBe("2026-04-03T01:12:00.000Z");
    expect((butlerSessionService as unknown as { captureSessionSnapshot: ReturnType<typeof vi.fn> }).captureSessionSnapshot).toHaveBeenCalledWith(
      "project-1",
      "butler-session-1",
      "user-1",
      {
        sourceKind: "manual"
      }
    );
  });

  it("sessions/start 参数非法时会返回 INVALID_INPUT 错误", async () => {
    const butlerSessionService = {
      startSession: vi.fn(async () => {
        throw new AppError({
          statusCode: 400,
          errorCode: "INVALID_INPUT",
          detail: "providerId 不支持",
          field: "providerId"
        });
      })
    } as unknown as ButlerSessionService;

    const app = await createButlerApp(butlerSessionService);
    const response = await app.inject({
      method: "POST",
      url: "/api/butler/projects/project-1/sessions/start",
      payload: {
        providerId: "unknown-provider",
        content: "test"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error_code: "INVALID_INPUT",
      detail: "providerId 不支持",
      field: "providerId"
    });
  });

  it("sessions/:butlerSessionId/resume 会透传 BUTLER_SESSION_NOT_FOUND", async () => {
    const butlerSessionService = {
      resumeSession: vi.fn(async () => {
        throw new AppError({
          statusCode: 404,
          errorCode: "BUTLER_SESSION_NOT_FOUND",
          detail: "当前项目下不存在该会话",
          field: "butlerSessionId"
        });
      })
    } as unknown as ButlerSessionService;

    const app = await createButlerApp(butlerSessionService);
    const response = await app.inject({
      method: "POST",
      url: "/api/butler/projects/project-1/sessions/butler-session-missing/resume"
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error_code: "BUTLER_SESSION_NOT_FOUND",
      detail: "当前项目下不存在该会话",
      field: "butlerSessionId"
    });
  });

  it("sessions/:butlerSessionId/snapshot 会透传 BUTLER_SESSION_NOT_FOUND", async () => {
    const butlerSessionService = {
      captureSessionSnapshot: vi.fn(() => {
        throw new AppError({
          statusCode: 404,
          errorCode: "BUTLER_SESSION_NOT_FOUND",
          detail: "当前项目下不存在该会话",
          field: "butlerSessionId"
        });
      })
    } as unknown as ButlerSessionService;

    const app = await createButlerApp(butlerSessionService);
    const response = await app.inject({
      method: "POST",
      url: "/api/butler/projects/project-1/sessions/butler-session-missing/snapshot",
      payload: {
        sourceKind: "manual"
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error_code: "BUTLER_SESSION_NOT_FOUND",
      detail: "当前项目下不存在该会话",
      field: "butlerSessionId"
    });
  });

  it("sessions/start 会透传 BUTLER_SESSION_START_UNAVAILABLE", async () => {
    const butlerSessionService = {
      startSession: vi.fn(async () => {
        throw new AppError({
          statusCode: 500,
          errorCode: "BUTLER_SESSION_START_UNAVAILABLE",
          detail: "当前环境未启用 butler 会话创建能力"
        });
      })
    } as unknown as ButlerSessionService;

    const app = await createButlerApp(butlerSessionService);
    const response = await app.inject({
      method: "POST",
      url: "/api/butler/projects/project-1/sessions/start",
      payload: {
        providerId: "codex",
        content: "test"
      }
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error_code: "BUTLER_SESSION_START_UNAVAILABLE",
      detail: "当前环境未启用 butler 会话创建能力"
    });
  });

  it("sessions/:butlerSessionId/resume 会透传 BUTLER_SESSION_RESUME_UNAVAILABLE", async () => {
    const butlerSessionService = {
      resumeSession: vi.fn(async () => {
        throw new AppError({
          statusCode: 500,
          errorCode: "BUTLER_SESSION_RESUME_UNAVAILABLE",
          detail: "当前环境未启用 butler 会话续接能力"
        });
      })
    } as unknown as ButlerSessionService;

    const app = await createButlerApp(butlerSessionService);
    const response = await app.inject({
      method: "POST",
      url: "/api/butler/projects/project-1/sessions/butler-session-1/resume"
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error_code: "BUTLER_SESSION_RESUME_UNAVAILABLE",
      detail: "当前环境未启用 butler 会话续接能力"
    });
  });
});
