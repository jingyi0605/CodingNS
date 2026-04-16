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
      url: "/api/assistant/terminals/terminal-1"
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
        commandHints: [" pnpm dev ", 42, "node server.js"]
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
        ]
      }
    });
    expect(launchPlanResponse.statusCode).toBe(200);
    expect(assistantCapabilityService.createDebugLaunchPlan).toHaveBeenCalledWith({
      targetId: "target-1",
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
        ]
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
});
