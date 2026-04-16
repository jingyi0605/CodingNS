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

describe("butler control-session routes", () => {
  const apps: FastifyInstance[] = [];

  async function createButlerApp(
    butlerControlSessionService: ButlerControlSessionService
  ): Promise<FastifyInstance> {
    const controller = new ButlerController(
      {} as ButlerProfileService,
      butlerControlSessionService,
      {} as ButlerControlActionService,
      {} as ButlerContextAggregator,
      {} as ButlerFollowUpService,
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

  it("control-session start|reset|resume|messages 路由会返回独立控制会话结果", async () => {
    const controlSessionRecord = {
      id: "control-1",
      providerId: "codex",
      sessionId: "session-1",
      purpose: "chat" as const,
      title: "代码助手",
      sourceItemId: null,
      model: "gpt-5.4",
      reasoningLevel: "medium",
      permissionMode: "default",
      status: "running" as const,
      lastContextVersion: null,
      lastSummary: "请先介绍当前职责",
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:05.000Z",
      session: {
        sessionId: "session-1",
        workspaceId: "workspace-butler",
        provider: "codex",
        providerSessionId: "provider-session-1",
        rawStoreRef: "raw-1",
        parentSessionId: null,
        isSubagent: false,
        subagentLabel: null,
        isArchived: false,
        isFavorite: false,
        title: "代码助手",
        messageCount: 1,
        lastMessageAt: "2026-04-05T00:00:05.000Z",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:05.000Z",
        syncStatus: "idle",
        syncCursor: null,
        lastSyncAt: "2026-04-05T00:00:05.000Z",
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "running",
        activitySource: "runtime",
        activityResolutionSource: "authoritative_runtime",
        activityConfidence: "authoritative",
        runId: null,
        lastEventAt: "2026-04-05T00:00:05.000Z",
        completedAt: null,
        lastSeenAt: null,
        watchdogTriggeredAt: null,
        activityState: "running"
      }
    };
    const butlerControlSessionService = {
      getCurrentSession: vi.fn(() => null),
      listSessions: vi.fn(() => [controlSessionRecord]),
      getSession: vi.fn(() => controlSessionRecord),
      resetCurrentSession: vi.fn(() => undefined),
      startSession: vi.fn(async () => controlSessionRecord),
      resumeCurrentSession: vi.fn(async () => ({
        ...controlSessionRecord,
        updatedAt: "2026-04-05T00:01:00.000Z",
        resumedAt: "2026-04-05T00:01:00.000Z",
        provider: "codex",
        providerSessionId: "provider-session-1",
        session: {
          ...controlSessionRecord.session,
          lastMessageAt: "2026-04-05T00:01:00.000Z",
          updatedAt: "2026-04-05T00:01:00.000Z",
          lastSyncAt: "2026-04-05T00:01:00.000Z",
          resumedAt: "2026-04-05T00:01:00.000Z",
          lastEventAt: "2026-04-05T00:01:00.000Z"
        }
      })),
      sendMessage: vi.fn(async () => ({
        controlSession: {
          ...controlSessionRecord,
          lastSummary: "继续汇总当前风险",
          updatedAt: "2026-04-05T00:01:05.000Z",
          session: {
            ...controlSessionRecord.session,
            messageCount: 2,
            lastMessageAt: "2026-04-05T00:01:05.000Z",
            updatedAt: "2026-04-05T00:01:05.000Z",
            lastSyncAt: "2026-04-05T00:01:05.000Z",
            resumedAt: "2026-04-05T00:01:00.000Z",
            lastEventAt: "2026-04-05T00:01:05.000Z",
            activityState: "running"
          }
        },
        sessionId: "session-1",
        provider: "codex",
        providerSessionId: "provider-session-1",
        acceptedAt: "2026-04-05T00:01:05.000Z",
        clientRequestId: "req-1",
        message: {
          messageId: "msg-2",
          role: "user",
          content: "继续汇总当前风险",
          timestamp: "2026-04-05T00:01:05.000Z",
          sequence: 2,
          attachments: []
        }
      }))
    } as unknown as ButlerControlSessionService;

    const app = await createButlerApp(butlerControlSessionService);

    const current = await app.inject({
      method: "GET",
      url: "/api/butler/control-session"
    });
    expect(current.statusCode).toBe(200);
    expect(current.json()).toEqual({
      controlSession: null
    });

    const listed = await app.inject({
      method: "GET",
      url: "/api/butler/control-sessions"
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items[0].purpose).toBe("chat");

    const detail = await app.inject({
      method: "GET",
      url: "/api/butler/control-sessions/control-1"
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().controlSession.id).toBe("control-1");

    const reset = await app.inject({
      method: "POST",
      url: "/api/butler/control-session/reset"
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toEqual({
      controlSession: null
    });

    const started = await app.inject({
      method: "POST",
      url: "/api/butler/control-session/start",
      payload: {
        content: "请先介绍当前职责"
      }
    });
    expect(started.statusCode).toBe(201);
    expect(started.json().controlSession.sessionId).toBe("session-1");

    const resumed = await app.inject({
      method: "POST",
      url: "/api/butler/control-session/resume"
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().providerSessionId).toBe("provider-session-1");

    const sent = await app.inject({
      method: "POST",
      url: "/api/butler/control-session/messages",
      payload: {
        content: "继续汇总当前风险",
        clientRequestId: "req-1"
      }
    });
    expect(sent.statusCode).toBe(202);
    expect(sent.json().sessionId).toBe("session-1");
  });

  it("未初始化时会透传 BUTLER_PROFILE_NOT_INITIALIZED", async () => {
    const butlerControlSessionService = {
      startSession: vi.fn(async () => {
        throw new AppError({
          statusCode: 409,
          errorCode: "BUTLER_PROFILE_NOT_INITIALIZED",
          detail: "代码助手尚未完成初始化，不能启动控制会话"
        });
      })
    } as unknown as ButlerControlSessionService;

    const app = await createButlerApp(butlerControlSessionService);
    const response = await app.inject({
      method: "POST",
      url: "/api/butler/control-session/start",
      payload: {
        content: "test"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error_code: "BUTLER_PROFILE_NOT_INITIALIZED"
    });
  });

  it("start 路由缺少首条消息时会返回 INVALID_INPUT", async () => {
    const butlerControlSessionService = {
      startSession: vi.fn(async () => {
        throw new AppError({
          statusCode: 400,
          errorCode: "INVALID_INPUT",
          detail: "发送控制会话消息必须提供 content",
          field: "content"
        });
      })
    } as unknown as ButlerControlSessionService;

    const app = await createButlerApp(butlerControlSessionService);
    const response = await app.inject({
      method: "POST",
      url: "/api/butler/control-session/start",
      payload: {}
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error_code: "INVALID_INPUT",
      field: "content"
    });
  });
});
