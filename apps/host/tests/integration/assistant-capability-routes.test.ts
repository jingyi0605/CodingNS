import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ASSISTANT_CALLER_KIND_HEADER,
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

  it("通用 sessions.start 在没有显式 target 时会交给服务自动落到沙箱", async () => {
    const assistantCapabilityService = {
      startSession: vi.fn(async () => ({
        ok: true,
        capability: "sessions.start",
        auditId: "audit-session-start-auto-sandbox",
        timestamp: "2026-04-17T02:05:00.000Z",
        targetRef: {
          kind: "sandbox",
          id: "sandbox-auto-1"
        },
        payload: {
          session: {
            sessionId: "session-auto-1"
          },
          target: {
            kind: "sandbox",
            id: "sandbox-auto-1",
            workspaceId: "workspace-sandbox-auto-1"
          }
        }
      })),
      createSandbox: vi.fn()
    };

    const app = await createAssistantApp(assistantCapabilityService);

    const response = await app.inject({
      method: "POST",
      url: "/api/assistant/sessions/start",
      payload: {
        content: "请继续处理这个问题，但我没指定项目或工作区"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(assistantCapabilityService.startSession).toHaveBeenCalledWith({
      target: null,
      userId: "user-1",
      content: "请继续处理这个问题，但我没指定项目或工作区",
      providerId: null,
      model: null,
      reasoningLevel: null,
      permissionMode: null
    });
    expect(assistantCapabilityService.createSandbox).not.toHaveBeenCalled();
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

  it("沙箱路由会把创建和晋升参数清洗后传给服务", async () => {
    const assistantCapabilityService = {
      createSandbox: vi.fn(async () => ({
        ok: true,
        capability: "sandboxes.create",
        auditId: "audit-sandbox-create",
        timestamp: "2026-04-17T02:10:00.000Z",
        targetRef: {
          kind: "sandbox",
          id: "sandbox-1"
        },
        payload: {
          sandbox: {
            id: "sandbox-1"
          }
        }
      })),
      promoteSandbox: vi.fn(() => ({
        ok: true,
        capability: "sandboxes.promote",
        auditId: "audit-sandbox-promote",
        timestamp: "2026-04-17T02:11:00.000Z",
        targetRef: {
          kind: "sandbox",
          id: "sandbox-1"
        },
        payload: {
          sandbox: {
            id: "sandbox-1"
          }
        }
      }))
    };
    const app = await createAssistantApp(assistantCapabilityService);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/sandboxes",
      payload: {
        title: "  CodingNS 临时沙箱  ",
        purpose: "  验证新自动化链路  ",
        sourceKind: "clone",
        repositoryUrl: "  https://github.com/jingyi0605/codingns.git  ",
        directoryName: "  codingns-sbx  "
      }
    });
    expect(createResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.createSandbox).toHaveBeenCalledWith({
      userId: "user-1",
      title: "CodingNS 临时沙箱",
      description: null,
      purpose: "验证新自动化链路",
      expiresAt: null,
      sourceKind: "clone",
      repositoryUrl: "https://github.com/jingyi0605/codingns.git",
      directoryName: "codingns-sbx",
      auth: undefined
    });

    const promoteResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/sandboxes/sandbox-1/promote",
      payload: {
        mode: "project",
        projectName: "  CodingNS 沙箱项目  ",
        defaultProvider: "  codex  "
      }
    });
    expect(promoteResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.promoteSandbox).toHaveBeenCalledWith({
      sandboxId: "sandbox-1",
      userId: "user-1",
      mode: "project",
      projectName: "CodingNS 沙箱项目",
      defaultProvider: "codex"
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

  it("办公浏览器路由会把 profile 与 task 参数清洗后传给服务", async () => {
    const assistantCapabilityService = {
      listOfficeBrowserProfiles: vi.fn(() => ({
        ok: true,
        capability: "office.browser.profile.list",
        auditId: "audit-office-browser-profile-list",
        timestamp: "2026-05-15T11:00:00.000Z",
        targetRef: { kind: "workspace", id: "workspace-1" },
        payload: { items: [] }
      })),
      createOfficeBrowserProfile: vi.fn(() => ({
        ok: true,
        capability: "office.browser.profile.create",
        auditId: "audit-office-browser-profile-create",
        timestamp: "2026-05-15T11:01:00.000Z",
        targetRef: { kind: "workspace", id: "workspace-1" },
        payload: { profile: { id: "profile-1" } }
      })),
      getOfficeBrowserProfile: vi.fn(() => ({
        ok: true,
        capability: "office.browser.profile.get",
        auditId: "audit-office-browser-profile-get",
        timestamp: "2026-05-15T11:02:00.000Z",
        targetRef: { kind: "workspace", id: "workspace-1" },
        payload: { profile: { id: "profile-1" } }
      })),
      createOfficeBrowserTask: vi.fn(async () => ({
        ok: true,
        capability: "office.browser.task.create",
        auditId: "audit-office-browser-task-create",
        timestamp: "2026-05-15T11:03:00.000Z",
        targetRef: { kind: "workspace", id: "workspace-1" },
        payload: { task: { id: "task-browser-1" }, execution: null }
      })),
      getOfficeBrowserTask: vi.fn(() => ({
        ok: true,
        capability: "office.browser.task.get",
        auditId: "audit-office-browser-task-get",
        timestamp: "2026-05-15T11:04:00.000Z",
        targetRef: { kind: "workspace", id: "workspace-1" },
        payload: { task: { id: "task-browser-1" } }
      }))
    };
    const app = await createAssistantApp(assistantCapabilityService);

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/assistant/office/browser/profiles?workspaceId=%20workspace-1%20"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.listOfficeBrowserProfiles).toHaveBeenCalledWith(
      "user-1",
      "workspace-1"
    );

    const createProfileResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/office/browser/profiles",
      payload: {
        workspaceId: "  workspace-1  ",
        engine: "chrome",
        mode: "cdp_attached",
        displayName: "  办公 Chrome  ",
        ownershipScope: "workspace",
        cdpEndpoint: "  http://127.0.0.1:9222  "
      }
    });
    expect(createProfileResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.createOfficeBrowserProfile).toHaveBeenCalledWith({
      userId: "user-1",
      workspaceId: "workspace-1",
      engine: "chrome",
      mode: "cdp_attached",
      displayName: "办公 Chrome",
      ownershipScope: "workspace",
      cdpEndpoint: "http://127.0.0.1:9222"
    });

    const getProfileResponse = await app.inject({
      method: "GET",
      url: "/api/assistant/office/browser/profiles/profile-1"
    });
    expect(getProfileResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.getOfficeBrowserProfile).toHaveBeenCalledWith(
      "profile-1",
      "user-1"
    );

    const createTaskResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/office/browser/tasks",
      payload: {
        workspaceId: "  workspace-1  ",
        title: "  浏览器巡检  ",
        profileId: "  profile-1  ",
        riskLevel: "medium",
        execute: true,
        input: {
          startUrl: "https://example.invalid",
          actions: [{ type: "read_dom" }]
        }
      }
    });
    expect(createTaskResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.createOfficeBrowserTask).toHaveBeenCalledWith({
      userId: "user-1",
      workspaceId: "workspace-1",
      title: "浏览器巡检",
      profileId: "profile-1",
      riskLevel: "medium",
      input: {
        startUrl: "https://example.invalid",
        actions: [{ type: "read_dom" }]
      },
      execute: true
    });

    const getTaskResponse = await app.inject({
      method: "GET",
      url: "/api/assistant/office/browser/tasks/task-browser-1"
    });
    expect(getTaskResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.getOfficeBrowserTask).toHaveBeenCalledWith(
      "task-browser-1",
      "user-1"
    );
  });

  it("办公运维路由会把 target 与 task 参数清洗后传给服务", async () => {
    const assistantCapabilityService = {
      listOfficeOpsTargets: vi.fn(() => ({
        ok: true,
        capability: "office.ops.target.list",
        auditId: "audit-office-ops-target-list",
        timestamp: "2026-05-15T11:10:00.000Z",
        targetRef: { kind: "none", id: null },
        payload: { items: [] }
      })),
      createOfficeOpsTarget: vi.fn(() => ({
        ok: true,
        capability: "office.ops.target.create",
        auditId: "audit-office-ops-target-create",
        timestamp: "2026-05-15T11:11:00.000Z",
        targetRef: { kind: "none", id: "target-1" },
        payload: { target: { id: "target-1" } }
      })),
      getOfficeOpsTarget: vi.fn(() => ({
        ok: true,
        capability: "office.ops.target.get",
        auditId: "audit-office-ops-target-get",
        timestamp: "2026-05-15T11:12:00.000Z",
        targetRef: { kind: "none", id: "target-1" },
        payload: { target: { id: "target-1" } }
      })),
      createOfficeOpsSshTask: vi.fn(() => ({
        ok: true,
        capability: "office.ops.ssh-task.create",
        auditId: "audit-office-ops-ssh-task",
        timestamp: "2026-05-15T11:13:00.000Z",
        targetRef: { kind: "none", id: "target-1" },
        payload: { task: { id: "task-ssh-1" }, execution: null }
      })),
      executeOfficeOpsTask: vi.fn(() => ({
        ok: true,
        capability: "office.ops.task.execute",
        auditId: "audit-office-ops-task-execute",
        timestamp: "2026-05-15T11:13:30.000Z",
        targetRef: { kind: "none", id: "target-1" },
        payload: {
          task: { id: "task-ssh-1" },
          execution: { taskId: "task-ssh-1", executionTaskId: "exec-1", deduped: false }
        }
      })),
      replyOfficeTaskApproval: vi.fn(() => ({
        ok: true,
        capability: "office.task.approval.reply",
        auditId: "audit-office-task-approval-reply",
        timestamp: "2026-05-15T11:13:40.000Z",
        targetRef: { kind: "none", id: "target-1" },
        payload: {
          approval: { id: "approval-1", status: "approved" },
          task: { id: "task-ssh-1" }
        }
      })),
      createOfficeOpsBrowserTask: vi.fn(() => ({
        ok: true,
        capability: "office.ops.browser-task.create",
        auditId: "audit-office-ops-browser-task",
        timestamp: "2026-05-15T11:14:00.000Z",
        targetRef: { kind: "none", id: "target-2" },
        payload: { task: { id: "task-ops-browser-1" } }
      })),
      getOfficeOpsTask: vi.fn(() => ({
        ok: true,
        capability: "office.ops.task.get",
        auditId: "audit-office-ops-task-get",
        timestamp: "2026-05-15T11:15:00.000Z",
        targetRef: { kind: "none", id: "target-1" },
        payload: { task: { id: "task-ssh-1" } }
      }))
    };
    const app = await createAssistantApp(assistantCapabilityService);

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/assistant/office/ops/targets?kind=ssh_host&status=active"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.listOfficeOpsTargets).toHaveBeenCalledWith(
      "user-1",
      null,
      "ssh_host",
      "active"
    );

    const createTargetResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/office/ops/targets",
      payload: {
        kind: "ssh_host",
        displayName: "  生产 SSH  ",
        environment: "  prod  ",
        config: {
          host: "10.0.0.8",
          username: "root"
        },
        credentialRef: "  cred-1  "
      }
    });
    expect(createTargetResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.createOfficeOpsTarget).toHaveBeenCalledWith({
      userId: "user-1",
      workspaceId: null,
      kind: "ssh_host",
      displayName: "生产 SSH",
      environment: "prod",
      config: {
        host: "10.0.0.8",
        username: "root"
      },
      credentialRef: "cred-1"
    });

    const getTargetResponse = await app.inject({
      method: "GET",
      url: "/api/assistant/office/ops/targets/target-1"
    });
    expect(getTargetResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.getOfficeOpsTarget).toHaveBeenCalledWith(
      "target-1",
      "user-1"
    );

    const createSshTaskResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/office/ops/ssh-tasks",
      payload: {
        title: "  检查磁盘  ",
        targetId: "  target-1  ",
        riskLevel: "medium",
        input: {
          command: "df -h"
        },
        execute: true,
        confirm: true
      }
    });
    expect(createSshTaskResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.createOfficeOpsSshTask).toHaveBeenCalledWith({
      userId: "user-1",
      title: "检查磁盘",
      targetId: "target-1",
      riskLevel: "medium",
      input: {
        command: "df -h"
      },
      execute: true
    });

    const executeTaskResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/office/ops/tasks/task-ssh-1/execute",
      payload: {
        confirm: true
      }
    });
    expect(executeTaskResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.executeOfficeOpsTask).toHaveBeenCalledWith({
      userId: "user-1",
      taskId: "task-ssh-1"
    });

    const replyApprovalResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/office/task-approvals/approval-1/reply",
      payload: {
        status: "approved",
        decisionNote: "  可以执行  "
      }
    });
    expect(replyApprovalResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.replyOfficeTaskApproval).toHaveBeenCalledWith({
      userId: "user-1",
      approvalId: "approval-1",
      status: "approved",
      decisionNote: "可以执行"
    });

    const createBrowserTaskResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/office/ops/browser-tasks",
      payload: {
        title: "  控制台巡检  ",
        targetId: "  target-2  ",
        profileId: "  profile-9  ",
        riskLevel: "high",
        input: {
          actions: [{ type: "click", selector: "#refresh" }]
        }
      }
    });
    expect(createBrowserTaskResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.createOfficeOpsBrowserTask).toHaveBeenCalledWith({
      userId: "user-1",
      title: "控制台巡检",
      targetId: "target-2",
      profileId: "profile-9",
      riskLevel: "high",
      input: {
        actions: [{ type: "click", selector: "#refresh" }]
      }
    });

    const getTaskResponse = await app.inject({
      method: "GET",
      url: "/api/assistant/office/ops/tasks/task-ssh-1"
    });
    expect(getTaskResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.getOfficeOpsTask).toHaveBeenCalledWith(
      "task-ssh-1",
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

  it("调试目标与终端关闭路由会把显式端口请求和运行参数传给服务", async () => {
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
      })),
      getDebugCompatibilityMatrix: vi.fn(() => ({
        ok: true,
        capability: "debug-targets.compatibility-matrix.get",
        auditId: "audit-matrix",
        timestamp: "2026-04-16T12:11:00.000Z",
        targetRef: {
          kind: "none",
          id: null
        },
        payload: {
          matrix: {
            version: "2026-04-13",
            items: []
          }
        }
      })),
      analyzeDebugTarget: vi.fn(() => ({
        ok: true,
        capability: "debug-targets.analyze",
        auditId: "audit-analyze",
        timestamp: "2026-04-16T12:12:00.000Z",
        targetRef: {
          kind: "debug_target",
          id: "target-1"
        },
        payload: {
          result: {
            target: {
              id: "target-1"
            },
            services: [],
            analyses: [],
            autoInjectionEligible: true
          }
        }
      })),
      createDebugLaunchPlan: vi.fn(async () => ({
        ok: true,
        capability: "debug-targets.launch-plan.create",
        auditId: "audit-plan",
        timestamp: "2026-04-16T12:13:00.000Z",
        targetRef: {
          kind: "debug_target",
          id: "target-1"
        },
        payload: {
          plan: {
            runtimeSession: {
              id: "runtime-1"
            },
            targetId: "target-1",
            autoStartAllowed: true,
            services: []
          }
        }
      })),
      runDebugTarget: vi.fn(async () => ({
        ok: true,
        capability: "debug-targets.run",
        auditId: "audit-run",
        timestamp: "2026-04-16T12:14:00.000Z",
        targetRef: {
          kind: "debug_target",
          id: "target-1"
        },
        payload: {
          result: {
            runtimeSession: {
              id: "runtime-1"
            },
            services: []
          }
        }
      })),
      getLatestDebugRuntime: vi.fn(async () => ({
        ok: true,
        capability: "debug-targets.runtime-latest.get",
        auditId: "audit-runtime-latest",
        timestamp: "2026-04-16T12:15:00.000Z",
        targetRef: {
          kind: "debug_target",
          id: "target-1"
        },
        payload: {
          runtime: null
        }
      })),
      listDebugRuntimes: vi.fn(async () => ({
        ok: true,
        capability: "debug-targets.runtimes.list",
        auditId: "audit-runtime-history",
        timestamp: "2026-04-16T12:16:00.000Z",
        targetRef: {
          kind: "debug_target",
          id: "target-1"
        },
        payload: {
          history: {
            targetId: "target-1",
            items: []
          }
        }
      })),
      getDebugRuntime: vi.fn(async () => ({
        ok: true,
        capability: "debug-runtimes.get",
        auditId: "audit-runtime",
        timestamp: "2026-04-16T12:17:00.000Z",
        targetRef: {
          kind: "debug_runtime",
          id: "runtime-1"
        },
        payload: {
          runtime: {
            runtimeSession: {
              id: "runtime-1"
            },
            services: []
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

    const matrixResponse = await app.inject({
      method: "GET",
      url: "/api/assistant/debug-targets/compatibility-matrix"
    });
    expect(matrixResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.getDebugCompatibilityMatrix).toHaveBeenCalledTimes(1);

    const analyzeResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/debug-targets/analyze",
      payload: {
        workspaceId: " workspace-1 ",
        rootPath: " /tmp/repo ",
        commandHints: [" pnpm dev ", 42, "node server.js"],
        confirm: true
      }
    });
    expect(analyzeResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.analyzeDebugTarget).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      rootPath: "/tmp/repo",
      commandHints: ["pnpm dev", "node server.js"]
    });

    const launchPlanResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/debug-targets/target-1/launch-plan",
      payload: {
        portRequests: [
          {
            role: " backend ",
            cwd: " apps/api ",
            command: " node ",
            port: "44123"
          }
        ],
        confirm: true
      }
    });
    expect(launchPlanResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.createDebugLaunchPlan).toHaveBeenCalledWith({
      targetId: "target-1",
      userId: "user-1",
      portRequests: [
        {
          serviceId: null,
          role: "backend",
          cwd: "apps/api",
          name: null,
          command: "node",
          port: 44123
        }
      ]
    });

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/debug-targets/target-1/run",
      payload: {
        shell: " zsh ",
        runtimeType: " tmux ",
        portRequests: [
          {
            role: "frontend",
            cwd: ".",
            port: 43001
          }
        ],
        confirm: true
      }
    });
    expect(runResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.runDebugTarget).toHaveBeenCalledWith({
      targetId: "target-1",
      userId: "user-1",
      shell: "zsh",
      runtimeType: "tmux",
      portRequests: [
        {
          serviceId: null,
          role: "frontend",
          cwd: ".",
          name: null,
          command: null,
          port: 43001
        }
      ]
    });

    const runtimeLatestResponse = await app.inject({
      method: "GET",
      url: "/api/assistant/debug-targets/target-1/runtime-latest"
    });
    expect(runtimeLatestResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.getLatestDebugRuntime).toHaveBeenCalledWith("target-1");

    const runtimesResponse = await app.inject({
      method: "GET",
      url: "/api/assistant/debug-targets/target-1/runtimes?limit=12"
    });
    expect(runtimesResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.listDebugRuntimes).toHaveBeenCalledWith({
      targetId: "target-1",
      limit: 12
    });

    const runtimeResponse = await app.inject({
      method: "GET",
      url: "/api/assistant/debug-runtimes/runtime-1"
    });
    expect(runtimeResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.getDebugRuntime).toHaveBeenCalledWith("runtime-1");
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
