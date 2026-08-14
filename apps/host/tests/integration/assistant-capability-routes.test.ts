import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ASSISTANT_CALLER_KIND_HEADER,
  ASSISTANT_CLI_REQUEST_SOURCE,
  BUTLER_UI_REQUEST_SOURCE,
  createAuthGuard
} from "../../src/middlewares/auth-guard.js";
import { AssistantCapabilityController } from "../../src/modules/assistant-capability/assistant-capability-controller.js";
import type { AssistantCapabilityService } from "../../src/modules/assistant-capability/assistant-capability-service.js";
import type { AuthService } from "../../src/modules/auth/auth-service.js";
import { registerAssistantCapabilityRoutes } from "../../src/routes/assistant.js";
import { AppError } from "../../src/shared/errors/app-error.js";
import { setErrorHandler } from "../../src/shared/http/error-handler.js";

describe("assistant capability routes", () => {
  const apps: FastifyInstance[] = [];

  function createProviderDisabledError(providerId = "codex"): AppError {
    return new AppError({
      statusCode: 409,
      errorCode: "PROVIDER_DISABLED",
      detail: `CLI provider ${providerId} 已被禁用`,
      data: {
        providerId
      }
    });
  }

  async function createAssistantApp(
    assistantCapabilityService: Partial<AssistantCapabilityService>
  ): Promise<FastifyInstance> {
    const service = {
      assertExecutionAllowed: vi.fn(),
      ...assistantCapabilityService
    };
    const controller = new AssistantCapabilityController(
      service as AssistantCapabilityService
    );
    const app = Fastify({ logger: false });
    apps.push(app);
    app.addHook("onRequest", async (request) => {
      (request as any).auth = {
        accessToken: "token",
        callerKind: "interactive_user",
        user: {
          userId: "user-1",
          username: "admin",
          role: "admin"
        }
      };
    });
    await registerAssistantCapabilityRoutes(app, controller);
    app.setErrorHandler(setErrorHandler);
    return app;
  }

  async function createAssistantAppWithAuthGuard(input: {
    assistantCapabilityService: Partial<AssistantCapabilityService>;
    authService?: Partial<AuthService>;
  }): Promise<FastifyInstance> {
    const service = {
      assertExecutionAllowed: vi.fn(),
      ...input.assistantCapabilityService
    };
    const controller = new AssistantCapabilityController(
      service as AssistantCapabilityService
    );
    const app = Fastify({ logger: false });
    apps.push(app);
    app.addHook("onRequest", createAuthGuard({
      ensureInitialized: vi.fn(),
      authenticateAccessToken: input.authService?.authenticateAccessToken
        ?? vi.fn((accessToken: string) => ({
          accessToken,
          callerKind: accessToken.startsWith("butler_") ? "assistant_runtime" : "interactive_user",
          user: {
            userId: "user-1",
            username: "admin",
            role: "admin"
          }
        }))
    } as unknown as AuthService));
    await registerAssistantCapabilityRoutes(app, controller);
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

  it("capabilities 路由会返回统一回执", async () => {
    const assistantCapabilityService = {
      listCapabilities: vi.fn(() => ({
        ok: true,
        capability: "capabilities.list",
        auditId: "audit-1",
        timestamp: "2026-04-14T10:00:00.000Z",
        targetRef: {
          kind: "none",
          id: null
        },
        payload: {
          version: "2026-04-14",
          items: [
            {
              name: "projects.list",
              mode: "read",
              enabled: true,
              summary: "列出项目"
            }
          ]
        }
      }))
    };

    const app = await createAssistantApp(assistantCapabilityService);
    const response = await app.inject({
      method: "GET",
      url: "/api/assistant/capabilities"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      capability: "capabilities.list",
      auditId: "audit-1",
      payload: {
        version: "2026-04-14"
      }
    });
    expect(assistantCapabilityService.listCapabilities).toHaveBeenCalledTimes(1);
  });

  it("助手运行时 token 访问能力面时会透传 callerKind", async () => {
    const assistantCapabilityService = {
      listCapabilities: vi.fn(() => ({
        ok: true,
        capability: "capabilities.list",
        auditId: "audit-runtime-1",
        timestamp: "2026-04-18T10:00:00.000Z",
        targetRef: {
          kind: "none",
          id: null
        },
        payload: {
          version: "2026-04-18",
          items: []
        }
      }))
    };

    const app = await createAssistantAppWithAuthGuard({
      assistantCapabilityService
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/assistant/capabilities",
      headers: {
        authorization: "Bearer butler_runtime_token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers[ASSISTANT_CALLER_KIND_HEADER]).toBe("assistant_runtime");
    expect(response.json()).toMatchObject({
      callerKind: "assistant_runtime"
    });
  });

  it("Butler 页面来源的交互式请求会被放行并标记 interactive_user", async () => {
    const assistantCapabilityService = {
      listCapabilities: vi.fn(() => ({
        ok: true,
        capability: "capabilities.list",
        auditId: "audit-ui-1",
        timestamp: "2026-04-18T10:01:00.000Z",
        targetRef: {
          kind: "none",
          id: null
        },
        payload: {
          version: "2026-04-18",
          items: []
        }
      }))
    };

    const app = await createAssistantAppWithAuthGuard({
      assistantCapabilityService
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/assistant/capabilities",
      headers: {
        authorization: "Bearer interactive_token",
        "x-codingns-assistant-source": BUTLER_UI_REQUEST_SOURCE
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers[ASSISTANT_CALLER_KIND_HEADER]).toBe("interactive_user");
    expect(response.json()).toMatchObject({
      callerKind: "interactive_user"
    });
  });

  it("工作区会话通过 assistant-cli 读取能力面时会被放行并标记 workspace_session", async () => {
    const assistantCapabilityService = {
      listCapabilities: vi.fn(() => ({
        ok: true,
        capability: "capabilities.list",
        auditId: "audit-workspace-session-1",
        timestamp: "2026-05-16T12:30:00.000Z",
        targetRef: {
          kind: "none",
          id: null
        },
        payload: {
          version: "2026-05-16",
          items: []
        }
      }))
    };

    const app = await createAssistantAppWithAuthGuard({
      assistantCapabilityService,
      authService: {
        authenticateAccessToken: vi.fn((accessToken: string) => ({
          accessToken,
          callerKind: "workspace_session",
          user: {
            userId: "user-1",
            username: "admin",
            role: "admin"
          }
        }))
      }
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/assistant/capabilities",
      headers: {
        authorization: "Bearer workspace_session_token",
        "x-codingns-assistant-source": ASSISTANT_CLI_REQUEST_SOURCE
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers[ASSISTANT_CALLER_KIND_HEADER]).toBe("workspace_session");
    expect(response.json()).toMatchObject({
      callerKind: "workspace_session",
      payload: {
        version: "2026-05-16"
      }
    });
    expect(assistantCapabilityService.listCapabilities).toHaveBeenCalledTimes(1);
  });

  it("缺少 Bearer token 时会直接返回 401，不会继续执行助手路由", async () => {
    const assistantCapabilityService = {
      listCapabilities: vi.fn(() => ({
        ok: true,
        capability: "capabilities.list",
        auditId: "should-not-run",
        timestamp: "2026-05-31T06:30:00.000Z",
        targetRef: {
          kind: "none",
          id: null
        },
        payload: {
          version: "2026-05-31",
          items: []
        }
      }))
    };

    const app = await createAssistantAppWithAuthGuard({
      assistantCapabilityService
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/assistant/capabilities"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error_code: "UNAUTHORIZED",
      field: "authorization"
    });
    expect(assistantCapabilityService.listCapabilities).not.toHaveBeenCalled();
  });

  it("普通登录态直接读取助手能力面时会被放行", async () => {
    const assistantCapabilityService = {
      listCapabilities: vi.fn(() => ({
        ok: true,
        capability: "capabilities.list",
        auditId: "audit-readonly-1",
        timestamp: "2026-04-19T15:10:00.000Z",
        targetRef: {
          kind: "none",
          id: null
        },
        payload: {
          version: "2026-04-19",
          items: []
        }
      }))
    };

    const app = await createAssistantAppWithAuthGuard({
      assistantCapabilityService
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/assistant/capabilities",
      headers: {
        authorization: "Bearer interactive_token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers[ASSISTANT_CALLER_KIND_HEADER]).toBe("interactive_user");
    expect(response.json()).toMatchObject({
      callerKind: "interactive_user",
      payload: {
        version: "2026-04-19"
      }
    });
    expect(assistantCapabilityService.listCapabilities).toHaveBeenCalledTimes(1);
  });

  it("普通登录态直接写助手能力面时仍会被拒绝", async () => {
    const assistantCapabilityService = {
      startSession: vi.fn()
    };

    const app = await createAssistantAppWithAuthGuard({
      assistantCapabilityService
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/assistant/sessions/start",
      headers: {
        authorization: "Bearer interactive_token"
      },
      payload: {
        content: "继续跟进"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error_code: "ASSISTANT_CALLER_NOT_ALLOWED",
      data: {
        callerKind: "interactive_user",
        requestSource: null
      }
    });
    expect(assistantCapabilityService.startSession).not.toHaveBeenCalled();
  });

  it("项目与消息窗口路由会把用户和分页参数传给服务", async () => {
    const assistantCapabilityService = {
      getProject: vi.fn(async () => ({
        ok: true,
        capability: "projects.get",
        auditId: "audit-project",
        timestamp: "2026-04-14T10:01:00.000Z",
        targetRef: {
          kind: "project",
          id: "project-1"
        },
        payload: {
          project: {
            id: "project-1",
            workspaceId: "workspace-1"
          },
          overview: {
            sessionCount: 2
          },
          sessions: []
        }
      })),
      listSessionMessages: vi.fn(async () => ({
        ok: true,
        capability: "sessions.messages.list",
        auditId: "audit-history",
        timestamp: "2026-04-14T10:02:00.000Z",
        targetRef: {
          kind: "session",
          id: "session-1"
        },
        payload: {
          page: {
            items: [],
            nextCursor: null
          }
        }
      }))
    };

    const app = await createAssistantApp(assistantCapabilityService);

    const projectResponse = await app.inject({
      method: "GET",
      url: "/api/assistant/projects/project-1"
    });
    expect(projectResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.getProject).toHaveBeenCalledWith("project-1", "user-1");

    const messagesResponse = await app.inject({
      method: "GET",
      url: "/api/assistant/sessions/session-1/messages?cursor=cursor-1&limit=25&direction=backward"
    });
    expect(messagesResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.listSessionMessages).toHaveBeenCalledWith({
      sessionId: "session-1",
      userId: "user-1",
      cursor: "cursor-1",
      limit: 25,
      direction: "backward"
    });
  });

  it("新建项目会话和计时器路由会做参数清洗", async () => {
    const assistantCapabilityService = {
      startProjectSession: vi.fn(async () => ({
        ok: true,
        capability: "projects.sessions.start",
        auditId: "audit-session-start",
        timestamp: "2026-04-16T12:00:00.000Z",
        targetRef: {
          kind: "project",
          id: "project-1"
        },
        payload: {
          session: {
            id: "butler-session-1",
            sessionId: "session-1"
          }
        }
      })),
      createTimer: vi.fn(() => ({
        ok: true,
        capability: "timers.create",
        auditId: "audit-timer-create",
        timestamp: "2026-04-16T12:01:00.000Z",
        targetRef: {
          kind: "timer",
          id: "timer-1"
        },
        payload: {
          timer: {
            id: "timer-1",
            dueAt: "2026-04-16T12:06:00.000Z"
          }
        }
      }))
    };

    const app = await createAssistantApp(assistantCapabilityService);

    const startResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/projects/project-1/sessions",
      payload: {
        content: "  请在新会话里继续修复这个问题  ",
        providerId: "  codex  ",
        model: "  gpt-5.4  ",
        reasoningLevel: "  high  ",
        permissionMode: "  acceptEdits  "
      }
    });
    expect(startResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.startProjectSession).toHaveBeenCalledWith({
      projectId: "project-1",
      userId: "user-1",
      content: "请在新会话里继续修复这个问题",
      providerId: "codex",
      model: "gpt-5.4",
      reasoningLevel: "high",
      permissionMode: "acceptEdits"
    });

    const timerResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/timers",
      payload: {
        content: "  5 分钟后检查这个真实会话的新回复  ",
        title: "  等待真实会话  ",
        afterSeconds: "300",
        projectId: "  project-1  ",
        targetSessionId: "  session-1  "
      }
    });
    expect(timerResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.createTimer).toHaveBeenCalledWith({
      userId: "user-1",
      controlSessionId: null,
      projectId: "project-1",
      targetSessionId: "session-1",
      title: "等待真实会话",
      content: "5 分钟后检查这个真实会话的新回复",
      dueAt: null,
      afterSeconds: 300
    });
  });

  it("通用 sessions.start 路由会校验目标并清洗参数", async () => {
    const assistantCapabilityService = {
      startSession: vi.fn(async () => ({
        ok: true,
        capability: "sessions.start",
        auditId: "audit-session-start-generic",
        timestamp: "2026-04-17T02:00:00.000Z",
        targetRef: {
          kind: "workspace",
          id: "workspace-1"
        },
        payload: {
          session: {
            sessionId: "session-2"
          },
          target: {
            kind: "workspace",
            id: "workspace-1",
            workspaceId: "workspace-1"
          }
        }
      }))
    };
    const app = await createAssistantApp(assistantCapabilityService);

    const response = await app.inject({
      method: "POST",
      url: "/api/assistant/sessions/start",
      payload: {
        workspaceId: "  workspace-1  ",
        content: "  先在这个工作区里排查问题  ",
        providerId: "  codex  ",
        model: "  gpt-5.4  "
      }
    });

    expect(response.statusCode).toBe(200);
    expect(assistantCapabilityService.startSession).toHaveBeenCalledWith({
      target: {
        kind: "workspace",
        workspaceId: "workspace-1"
      },
      userId: "user-1",
      content: "先在这个工作区里排查问题",
      providerId: "codex",
      model: "gpt-5.4",
      reasoningLevel: null,
      permissionMode: null
    });
  });

  it("通用 sessions.start 在没有显式 target 时会直接返回参数错误", async () => {
    const assistantCapabilityService = {
      startSession: vi.fn()
    };

    const app = await createAssistantApp(assistantCapabilityService);

    const response = await app.inject({
      method: "POST",
      url: "/api/assistant/sessions/start",
      payload: {
        content: "请继续处理这个问题，但我没指定项目或工作区"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error_code: "INVALID_INPUT",
      detail: "启动真实会话必须提供 projectId 或 workspaceId"
    });
    expect(assistantCapabilityService.startSession).not.toHaveBeenCalled();
  });

  it("provider 被禁用时，助手会话 start|send|fork 和 follow-up create 路由会统一返回 PROVIDER_DISABLED", async () => {
    const assistantCapabilityService = {
      startSession: vi.fn(async () => {
        throw createProviderDisabledError();
      }),
      sendSessionMessage: vi.fn(async () => {
        throw createProviderDisabledError();
      }),
      forkSession: vi.fn(async () => {
        throw createProviderDisabledError();
      }),
      createFollowUp: vi.fn(async () => {
        throw createProviderDisabledError();
      })
    };
    const app = await createAssistantApp(assistantCapabilityService);

    const startResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/sessions/start",
      payload: {
        workspaceId: "workspace-1",
        content: "开始助手会话",
        providerId: "codex"
      }
    });
    expect(startResponse.statusCode).toBe(409);
    expect(startResponse.json()).toMatchObject({
      error_code: "PROVIDER_DISABLED",
      data: {
        providerId: "codex"
      }
    });

    const sendResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/sessions/session-disabled/messages",
      payload: {
        content: "继续"
      }
    });
    expect(sendResponse.statusCode).toBe(409);
    expect(sendResponse.json()).toMatchObject({
      error_code: "PROVIDER_DISABLED"
    });

    const forkResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/sessions/session-disabled/forks",
      payload: {}
    });
    expect(forkResponse.statusCode).toBe(409);
    expect(forkResponse.json()).toMatchObject({
      error_code: "PROVIDER_DISABLED"
    });

    const followUpResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/follow-ups",
      payload: {
        projectId: "project-1",
        butlerSessionId: "butler-session-1",
        providerId: "codex",
        objective: "继续推进"
      }
    });
    expect(followUpResponse.statusCode).toBe(409);
    expect(followUpResponse.json()).toMatchObject({
      error_code: "PROVIDER_DISABLED",
      data: {
        providerId: "codex"
      }
    });
  });

  it("自动化路由会把查询和创建参数清洗后传给服务", async () => {
    const assistantCapabilityService = {
      listAutomations: vi.fn(() => ({
        ok: true,
        capability: "automations.list",
        auditId: "audit-automation-list",
        timestamp: "2026-04-17T01:00:00.000Z",
        targetRef: {
          kind: "none",
          id: null
        },
        payload: {
          items: []
        }
      })),
      createAutomation: vi.fn(() => ({
        ok: true,
        capability: "automations.create",
        auditId: "audit-automation-create",
        timestamp: "2026-04-17T01:01:00.000Z",
        targetRef: {
          kind: "automation",
          id: "automation-1"
        },
        payload: {
          automation: {
            id: "automation-1"
          }
        }
      }))
    };

    const app = await createAssistantApp(assistantCapabilityService);

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/assistant/automations?status=active&controlSessionId=%20control-1%20"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.listAutomations).toHaveBeenCalledWith({
      userId: "user-1",
      status: "active",
      controlSessionId: "control-1",
      limit: null
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/automations",
      payload: {
        content: "  一小时后检查 codingns 新 tag  ",
        title: "  CodingNS 巡检  ",
        afterSeconds: "3600",
        projectId: "  project-1  ",
        targetSessionId: "  session-1  "
      }
    });
    expect(createResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.createAutomation).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      controlSessionId: null,
      projectId: "project-1",
      targetSessionId: "session-1",
      title: "CodingNS 巡检",
      content: "一小时后检查 codingns 新 tag",
      dueAt: null,
      afterSeconds: 3600
    }));
  });

  it("自动化等待跳过路由会把 automationId 和 userId 传给服务", async () => {
    const assistantCapabilityService = {
      skipAutomationWait: vi.fn(() => ({
        ok: true,
        capability: "automations.wait.skip",
        auditId: "audit-automation-skip-wait",
        timestamp: "2026-04-17T01:02:00.000Z",
        targetRef: {
          kind: "automation",
          id: "automation-2"
        },
        payload: {
          automation: {
            id: "automation-2",
            status: "active"
          }
        }
      }))
    };

    const app = await createAssistantApp(assistantCapabilityService);
    const response = await app.inject({
      method: "POST",
      url: "/api/assistant/automations/automation-2/skip-wait",
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    expect(assistantCapabilityService.skipAutomationWait).toHaveBeenCalledWith(
      "automation-2",
      "user-1"
    );
  });

  it("自动化更新路由会把补丁参数清洗后传给服务", async () => {
    const assistantCapabilityService = {
      updateAutomation: vi.fn(() => ({
        ok: true,
        capability: "automations.update",
        auditId: "audit-automation-update",
        timestamp: "2026-04-17T01:03:00.000Z",
        targetRef: {
          kind: "automation",
          id: "automation-1"
        },
        payload: {
          automation: {
            id: "automation-1",
            title: "夜间巡视升级版"
          }
        }
      }))
    };

    const app = await createAssistantApp(assistantCapabilityService);
    const response = await app.inject({
      method: "PATCH",
      url: "/api/assistant/automations/automation-1",
      payload: {
        title: "  夜间巡视升级版  ",
        content: "  执行项目巡视并补充摘要  ",
        includeTriggerContext: true,
        everyMinutes: "45",
        stopAt: " 2026-04-17T02:00:00.000Z "
      }
    });

    expect(response.statusCode).toBe(200);
    expect(assistantCapabilityService.updateAutomation).toHaveBeenCalledWith({
      automationId: "automation-1",
      userId: "user-1",
      title: "夜间巡视升级版",
      content: "执行项目巡视并补充摘要",
      includeTriggerContext: true,
      dueAt: undefined,
      everySeconds: undefined,
      everyMinutes: 45,
      everyHours: undefined,
      stopAt: "2026-04-17T02:00:00.000Z",
      cronMinute: undefined,
      cronHour: undefined,
      cronDaysOfWeek: undefined,
      pollIntervalSeconds: undefined,
      expiresAt: undefined,
      maxChecks: undefined
    });
  });

  it("最近自动化运行路由会把筛选参数传给服务", async () => {
    const assistantCapabilityService = {
      listRecentAutomationRuns: vi.fn(() => ({
        ok: true,
        capability: "automations.runs.recent",
        auditId: "audit-automation-runs-recent",
        timestamp: "2026-04-17T01:05:00.000Z",
        targetRef: {
          kind: "none",
          id: null
        },
        payload: {
          items: []
        }
      }))
    };

    const app = await createAssistantApp(assistantCapabilityService);
    const response = await app.inject({
      method: "GET",
      url: "/api/assistant/automations/runs/recent?controlSessionId=%20control-1%20&limit=20"
    });

    expect(response.statusCode).toBe(200);
    expect(assistantCapabilityService.listRecentAutomationRuns).toHaveBeenCalledWith({
      userId: "user-1",
      controlSessionId: "control-1",
      limit: 20
    });
  });

  it("发送会话消息和终端输入时会做基础参数清洗", async () => {
    const assistantCapabilityService = {
      sendSessionMessage: vi.fn(async () => ({
        ok: true,
        capability: "sessions.message.send",
        auditId: "audit-send",
        timestamp: "2026-04-14T10:03:00.000Z",
        targetRef: {
          kind: "session",
          id: "session-1"
        },
        payload: {
          result: {
            queueItemId: "queue-1",
            acceptedAt: "2026-04-14T10:03:00.000Z"
          }
        }
      })),
      sendTerminalInput: vi.fn(async () => ({
        ok: true,
        capability: "terminals.input.send",
        auditId: "audit-terminal",
        timestamp: "2026-04-14T10:04:00.000Z",
        targetRef: {
          kind: "terminal",
          id: "terminal-1"
        },
        payload: {
          result: {
            accepted: true
          }
        }
      }))
    };

    const app = await createAssistantApp(assistantCapabilityService);

    const sendMessageResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/sessions/session-1/messages",
      payload: {
        content: "  请继续检查构建错误  ",
        clientRequestId: "  request-1  ",
        model: "  gpt-5.4  ",
        reasoningLevel: "  high  ",
        permissionMode: "  read-only  "
      }
    });
    expect(sendMessageResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.sendSessionMessage).toHaveBeenCalledWith({
      sessionId: "session-1",
      userId: "user-1",
      content: "请继续检查构建错误",
      clientRequestId: "request-1",
      model: "gpt-5.4",
      reasoningLevel: "high",
      permissionMode: "read-only"
    });

    const terminalResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/terminals/terminal-1/input",
      payload: {
        content: "npm test\n"
      }
    });
    expect(terminalResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.sendTerminalInput).toHaveBeenCalledWith({
      terminalId: "terminal-1",
      content: "npm test"
    });
  });

  it("办公文档路由会把 create/update/export/task.get 参数清洗后传给服务", async () => {
    const assistantCapabilityService = {
      createOfficeDocument: vi.fn(() => ({
        ok: true,
        capability: "office.document.create",
        auditId: "audit-office-doc-create",
        timestamp: "2026-05-15T10:00:00.000Z",
        targetRef: {
          kind: "workspace",
          id: "workspace-1"
        },
        payload: {
          document: {
            id: "document-1",
            title: "周报"
          }
        }
      })),
      updateOfficeDocument: vi.fn(() => ({
        ok: true,
        capability: "office.document.update",
        auditId: "audit-office-doc-update",
        timestamp: "2026-05-15T10:01:00.000Z",
        targetRef: {
          kind: "workspace",
          id: "workspace-1"
        },
        payload: {
          document: {
            id: "document-1",
            title: "周报-更新"
          }
        }
      })),
      exportOfficeDocument: vi.fn(async () => ({
        ok: true,
        capability: "office.document.export",
        auditId: "audit-office-doc-export",
        timestamp: "2026-05-15T10:02:00.000Z",
        targetRef: {
          kind: "workspace",
          id: "workspace-1"
        },
        payload: {
          task: {
            id: "task-1",
            status: "ready"
          },
          execution: {
            taskId: "task-1",
            executionTaskId: "exec-1",
            deduped: false
          }
        }
      })),
      getOfficeDocumentTask: vi.fn(() => ({
        ok: true,
        capability: "office.document.task.get",
        auditId: "audit-office-doc-task",
        timestamp: "2026-05-15T10:03:00.000Z",
        targetRef: {
          kind: "workspace",
          id: "workspace-1"
        },
        payload: {
          task: {
            id: "task-1",
            status: "succeeded"
          }
        }
      }))
    };

    const app = await createAssistantApp(assistantCapabilityService);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/office/documents",
      payload: {
        workspaceId: "  workspace-1  ",
        title: "  周报  ",
        templateKey: "  team.doct.weekly  ",
        summary: "  本周完成事项  ",
        content: {
          sections: []
        }
      }
    });
    expect(createResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.createOfficeDocument).toHaveBeenCalledWith({
      userId: "user-1",
      workspaceId: "workspace-1",
      title: "周报",
      templateId: null,
      templateKey: "team.doct.weekly",
      content: {
        sections: []
      },
      outline: undefined,
      summary: "本周完成事项"
    });

    const updateResponse = await app.inject({
      method: "PATCH",
      url: "/api/assistant/office/documents/document-1",
      payload: {
        title: "  周报-更新  ",
        summary: "  补充风险说明  ",
        status: "reviewing"
      }
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.updateOfficeDocument).toHaveBeenCalledWith({
      userId: "user-1",
      documentId: "document-1",
      title: "周报-更新",
      templateId: null,
      content: undefined,
      outline: undefined,
      summary: "补充风险说明",
      status: "reviewing"
    });

    const exportResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/office/documents/document-1/export",
      payload: {
        workspaceId: "  workspace-1  ",
        format: "pdf",
        riskLevel: "medium",
        execute: true
      }
    });
    expect(exportResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.exportOfficeDocument).toHaveBeenCalledWith({
      userId: "user-1",
      documentId: "document-1",
      workspaceId: "workspace-1",
      format: "pdf",
      riskLevel: "medium",
      execute: true
    });

    const taskResponse = await app.inject({
      method: "GET",
      url: "/api/assistant/office/document-tasks/task-1"
    });
    expect(taskResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.getOfficeDocumentTask).toHaveBeenCalledWith(
      "task-1",
      "user-1"
    );
  });

  it("缺少终端筛选条件时会返回结构化错误", async () => {
    const assistantCapabilityService = {
      listTerminals: vi.fn()
    };

    const app = await createAssistantApp(assistantCapabilityService);
    const response = await app.inject({
      method: "GET",
      url: "/api/assistant/terminals"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error_code: "INVALID_INPUT",
      field: "projectId",
      detail: "查询终端必须提供 projectId 或 workspaceId"
    });
    expect(assistantCapabilityService.listTerminals).not.toHaveBeenCalled();
  });

  it("读取 assistant 终端历史时会把超上限 limit 收敛到 100", async () => {
    const assistantCapabilityService = {
      readTerminalHistory: vi.fn(async () => ({
        ok: true,
        capability: "terminals.history.read",
        auditId: "audit-terminal-history",
        timestamp: "2026-04-16T08:00:00.000Z",
        targetRef: {
          kind: "terminal",
          id: "terminal-1"
        },
        payload: {
          page: {
            terminalId: "terminal-1",
            content: "",
            lineCount: 0,
            anchorLine: 0,
            hasMore: false,
            nextBeforeSeq: null
          }
        }
      }))
    };

    const app = await createAssistantApp(assistantCapabilityService);
    const response = await app.inject({
      method: "GET",
      url: "/api/assistant/terminals/terminal-1/history?beforeSeq=20&limit=200"
    });

    expect(response.statusCode).toBe(200);
    expect(assistantCapabilityService.readTerminalHistory).toHaveBeenCalledWith({
      terminalId: "terminal-1",
      beforeSeq: 20,
      limit: 100
    });
  });

  it("fork 路由默认按 session sourceType 调服务", async () => {
    const assistantCapabilityService = {
      forkSession: vi.fn(async () => ({
        ok: true,
        capability: "sessions.fork",
        auditId: "audit-fork",
        timestamp: "2026-04-14T10:05:00.000Z",
        targetRef: {
          kind: "session",
          id: "session-1"
        },
        payload: {
          session: {
            id: "session-2"
          }
        }
      }))
    };

    const app = await createAssistantApp(assistantCapabilityService);
    const response = await app.inject({
      method: "POST",
      url: "/api/assistant/sessions/session-1/forks",
      payload: {
        targetProvider: " codex "
      }
    });

    expect(response.statusCode).toBe(200);
    expect(assistantCapabilityService.forkSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      userId: "user-1",
      sourceType: "session",
      sourceMessageId: null,
      strategy: undefined,
      targetProvider: "codex"
    });
  });

  it("工作区与工作树路由会把参数清洗后传给服务", async () => {
    const assistantCapabilityService = {
      browseWorkspaces: vi.fn(() => ({
        ok: true,
        capability: "workspaces.browse",
        auditId: "audit-browse",
        timestamp: "2026-04-16T12:00:00.000Z",
        targetRef: {
          kind: "none",
          id: null
        },
        payload: {
          result: {
            currentPath: "/tmp",
            parentPath: "/",
            roots: [],
            items: []
          }
        }
      })),
      createWorkspaceDirectory: vi.fn(() => ({
        ok: true,
        capability: "workspaces.directory.create",
        auditId: "audit-mkdir",
        timestamp: "2026-04-16T12:01:00.000Z",
        targetRef: {
          kind: "none",
          id: null
        },
        payload: {
          result: {
            path: "/tmp/demo",
            name: "demo"
          }
        }
      })),
      updateWorkspaceNavigationState: vi.fn(() => ({
        ok: true,
        capability: "workspaces.navigation-state.update",
        auditId: "audit-nav",
        timestamp: "2026-04-16T12:02:00.000Z",
        targetRef: {
          kind: "workspace",
          id: "workspace-1"
        },
        payload: {
          state: {
            workspaceId: "workspace-1",
            userId: "user-1",
            collapsed: true,
            backgroundColor: "#112233",
            updatedAt: "2026-04-16T12:02:00.000Z"
          }
        }
      })),
      getWorktreeTree: vi.fn(async () => ({
        ok: true,
        capability: "worktrees.tree",
        auditId: "audit-tree",
        timestamp: "2026-04-16T12:03:00.000Z",
        targetRef: {
          kind: "workspace",
          id: "workspace-1"
        },
        payload: {
          rootWorkspaceId: "workspace-1",
          items: []
        }
      })),
      cleanupWorktree: vi.fn(async () => ({
        ok: true,
        capability: "worktrees.cleanup",
        auditId: "audit-cleanup",
        timestamp: "2026-04-16T12:04:00.000Z",
        targetRef: {
          kind: "worktree",
          id: "workspace-2"
        },
        payload: {
          result: {
            workspaceId: "workspace-2",
            removed: true
          }
        }
      }))
    };

    const app = await createAssistantApp(assistantCapabilityService);

    const browseResponse = await app.inject({
      method: "GET",
      url: "/api/assistant/workspaces/browse?path=%20/tmp/demo%20"
    });
    expect(browseResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.browseWorkspaces).toHaveBeenCalledWith("/tmp/demo");

    const mkdirResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/workspaces/directories",
      payload: {
        parentPath: " /tmp ",
        directoryName: " demo "
      }
    });
    expect(mkdirResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.createWorkspaceDirectory).toHaveBeenCalledWith({
      parentPath: "/tmp",
      directoryName: "demo"
    });

    const navStateResponse = await app.inject({
      method: "PUT",
      url: "/api/assistant/workspaces/workspace-1/navigation-state",
      payload: {
        collapsed: true,
        backgroundColor: " #112233 "
      }
    });
    expect(navStateResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.updateWorkspaceNavigationState).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userId: "user-1",
      collapsed: true,
      backgroundColor: " #112233 "
    });

    const treeResponse = await app.inject({
      method: "GET",
      url: "/api/assistant/worktrees/tree?rootWorkspaceId=workspace-1"
    });
    expect(treeResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.getWorktreeTree).toHaveBeenCalledWith("workspace-1");

    const cleanupResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/worktrees/workspace-2/cleanup",
      payload: {
        deleteBranch: true
      }
    });
    expect(cleanupResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.cleanupWorktree).toHaveBeenCalledWith(
      "workspace-2",
      "user-1",
      {
        deleteBranch: true
      }
    );
  });

  it("终端关闭路由会把确认后的关闭请求传给服务", async () => {
    const assistantCapabilityService = {
      closeTerminal: vi.fn(async () => ({
        ok: true,
        capability: "terminals.close",
        auditId: "audit-close",
        timestamp: "2026-04-16T12:10:00.000Z",
        targetRef: {
          kind: "terminal",
          id: "terminal-1"
        },
        payload: {
          result: {
            success: true
          }
        }
      }))
    };

    const app = await createAssistantApp(assistantCapabilityService);

    const closeResponse = await app.inject({
      method: "DELETE",
      url: "/api/assistant/terminals/terminal-1",
      payload: {
        confirm: true
      }
    });
    expect(closeResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.closeTerminal).toHaveBeenCalledWith("terminal-1");
  });

  it("缺少 rootWorkspaceId 时会拒绝查询工作树", async () => {
    const assistantCapabilityService = {
      getWorktreeTree: vi.fn()
    };

    const app = await createAssistantApp(assistantCapabilityService);
    const response = await app.inject({
      method: "GET",
      url: "/api/assistant/worktrees/tree"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error_code: "INVALID_INPUT",
      field: "rootWorkspaceId",
      detail: "查询工作树必须提供 rootWorkspaceId"
    });
    expect(assistantCapabilityService.getWorktreeTree).not.toHaveBeenCalled();
  });

  it("follow-ups continue 路由会把结构化字段转发给能力服务", async () => {
    const assistantCapabilityService = {
      continueFollowUp: vi.fn(async () => ({
        ok: true,
        capability: "follow-ups.continue",
        auditId: "audit-follow-up-1",
        timestamp: "2026-04-20T10:00:00.000Z",
        targetRef: {
          kind: "follow_up",
          id: "follow-up-1"
        },
        payload: {
          task: {
            id: "follow-up-1",
            status: "active"
          }
        }
      }))
    };
    const app = await createAssistantApp(assistantCapabilityService);
    const response = await app.inject({
      method: "POST",
      url: "/api/assistant/follow-ups/follow-up-1/continue",
      payload: {
        summary: "目标还没完成，已经补发继续推进消息。",
        continuePrompt: "继续补齐剩余实现，不要停在总结。"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(assistantCapabilityService.continueFollowUp).toHaveBeenCalledWith({
      userId: "user-1",
      taskId: "follow-up-1",
      summary: "目标还没完成，已经补发继续推进消息。",
      continuePrompt: "继续补齐剩余实现，不要停在总结。"
    });
  });
});
