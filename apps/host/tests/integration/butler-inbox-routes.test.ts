import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ButlerControlActionService } from "../../src/modules/butler/butler-control-action-service.js";
import type { ButlerControlSessionService } from "../../src/modules/butler/butler-control-session-service.js";
import type { ButlerContextAggregator } from "../../src/modules/butler/context-aggregator.js";
import type { ButlerFollowUpService } from "../../src/modules/butler/butler-follow-up-service.js";
import type { ButlerInboxService } from "../../src/modules/butler/butler-inbox-service.js";
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

describe("butler inbox routes", () => {
  const apps: FastifyInstance[] = [];

  async function createButlerApp(butlerInboxService: ButlerInboxService): Promise<FastifyInstance> {
    const controller = new ButlerController(
      {} as ButlerProfileService,
      {} as ButlerControlSessionService,
      {} as ButlerControlActionService,
      {} as ButlerContextAggregator,
      {} as ButlerFollowUpService,
      butlerInboxService,
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

  it("支持列出、新增、更新和删除收件箱代办", async () => {
    const butlerInboxService = {
      listItems: vi.fn(() => [
        {
          id: "todo-1",
          projectId: "project-1",
          projectName: "项目甲",
          workspaceId: "workspace-1",
          itemType: "task",
          title: "跟进登录验证码",
          content: "继续推动验证码收尾。",
          priority: "medium",
          status: "pending",
          createdAt: "2026-04-07T00:00:00.000Z",
          updatedAt: "2026-04-07T00:00:00.000Z",
          closedAt: null
        }
      ]),
      createItem: vi.fn((input) => ({
        id: "todo-2",
        projectId: input.projectId,
        projectName: "项目甲",
        workspaceId: "workspace-1",
        itemType: input.itemType,
        title: input.title,
        content: input.content,
        priority: input.priority,
        status: input.status,
        createdAt: "2026-04-07T00:01:00.000Z",
        updatedAt: "2026-04-07T00:01:00.000Z",
        closedAt: null
      })),
      updateItem: vi.fn((itemId, input) => ({
        id: itemId,
        projectId: input.projectId ?? "project-1",
        projectName: "项目甲",
        workspaceId: "workspace-1",
        itemType: input.itemType ?? "task",
        title: input.title ?? "跟进登录验证码",
        content: input.content ?? "继续推动验证码收尾。",
        priority: input.priority ?? "medium",
        status: input.status ?? "closed",
        createdAt: "2026-04-07T00:00:00.000Z",
        updatedAt: "2026-04-07T00:02:00.000Z",
        closedAt: "2026-04-07T00:02:00.000Z"
      })),
      deleteItem: vi.fn()
    } as unknown as ButlerInboxService;

    const app = await createButlerApp(butlerInboxService);

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/butler/inbox?workspaceId=workspace-1"
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().items[0].title).toBe("跟进登录验证码");
    expect((butlerInboxService.listItems as any).mock.calls[0][0]).toMatchObject({
      workspaceId: "workspace-1"
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/butler/inbox",
      payload: {
        projectId: "project-1",
        itemType: "task",
        title: "补一条代办",
        content: "继续收尾登录验证码。",
        priority: "medium",
        status: "pending"
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json().item.title).toBe("补一条代办");
    expect((butlerInboxService.createItem as any).mock.calls[0][0]).toMatchObject({
      projectId: "project-1",
      title: "补一条代办"
    });

    const updateResponse = await app.inject({
      method: "PATCH",
      url: "/api/butler/inbox/todo-1",
      payload: {
        status: "closed"
      }
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json().item.status).toBe("closed");
    expect((butlerInboxService.updateItem as any).mock.calls[0][0]).toBe("todo-1");

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/api/butler/inbox/todo-1"
    });

    expect(deleteResponse.statusCode).toBe(204);
    expect((butlerInboxService.deleteItem as any).mock.calls[0][0]).toBe("todo-1");
  });
});
