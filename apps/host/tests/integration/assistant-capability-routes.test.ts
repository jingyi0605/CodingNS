import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistantCapabilityController } from "../../src/modules/assistant-capability/assistant-capability-controller.js";
import type { AssistantCapabilityService } from "../../src/modules/assistant-capability/assistant-capability-service.js";
import { registerAssistantCapabilityRoutes } from "../../src/routes/assistant.js";
import { setErrorHandler } from "../../src/shared/http/error-handler.js";

describe("assistant capability routes", () => {
  const apps: FastifyInstance[] = [];

  async function createAssistantApp(
    assistantCapabilityService: Partial<AssistantCapabilityService>
  ): Promise<FastifyInstance> {
    const controller = new AssistantCapabilityController(
      assistantCapabilityService as AssistantCapabilityService
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
});
