import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ButlerControlActionService } from "../../src/modules/butler/butler-control-action-service.js";
import type { ButlerControlSessionService } from "../../src/modules/butler/butler-control-session-service.js";
import { ButlerController } from "../../src/modules/butler/butler-controller.js";
import type { ButlerContextAggregator } from "../../src/modules/butler/context-aggregator.js";
import type { ButlerFollowUpService } from "../../src/modules/butler/butler-follow-up-service.js";
import type { ButlerInboxService } from "../../src/modules/butler/butler-inbox-service.js";
import type { ButlerNotificationService } from "../../src/modules/butler/butler-notification-service.js";
import type { ButlerProfileService } from "../../src/modules/butler/butler-profile-service.js";
import type { ButlerProjectService } from "../../src/modules/butler/butler-project-service.js";
import type { ButlerSessionService } from "../../src/modules/butler/butler-session-service.js";
import type { PatrolExecutionService } from "../../src/modules/butler/patrol-execution-service.js";
import type { PatrolPlanService } from "../../src/modules/butler/patrol-plan-service.js";
import type { PatrolRunService } from "../../src/modules/butler/patrol-run-service.js";
import type { ProjectMemoryService } from "../../src/modules/butler/project-memory-service.js";
import type { VerificationRunService } from "../../src/modules/butler/verification-run-service.js";
import { registerButlerRoutes } from "../../src/routes/butler.js";
import { setErrorHandler } from "../../src/shared/http/error-handler.js";

describe("butler notification routes", () => {
  const apps: FastifyInstance[] = [];

  async function createButlerApp(
    butlerNotificationService: ButlerNotificationService
  ): Promise<FastifyInstance> {
    const controller = new ButlerController(
      {} as ButlerProfileService,
      {} as ButlerControlSessionService,
      {} as ButlerControlActionService,
      {} as ButlerContextAggregator,
      {} as ButlerFollowUpService,
      {} as ButlerInboxService,
      butlerNotificationService,
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

  it("支持列出、归档和移除归档通知", async () => {
    const butlerNotificationService = {
      listArchivedNotifications: vi.fn(() => [
        {
          notificationId: "follow-up-failed:task-1",
          archivedAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z"
        }
      ]),
      setArchived: vi.fn((userId, notificationId, archived) =>
        archived
          ? {
              notificationId,
              archivedAt: "2026-04-08T01:00:00.000Z",
              updatedAt: "2026-04-08T01:00:00.000Z"
            }
          : null
      )
    } as unknown as ButlerNotificationService;

    const app = await createButlerApp(butlerNotificationService);

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/butler/notifications/archives"
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().items[0].notificationId).toBe("follow-up-failed:task-1");
    expect((butlerNotificationService.listArchivedNotifications as any).mock.calls[0][0]).toBe("user-1");

    const archiveResponse = await app.inject({
      method: "PATCH",
      url: "/api/butler/notifications/archives/follow-up-failed%3Atask-2",
      payload: {
        archived: true
      }
    });

    expect(archiveResponse.statusCode).toBe(200);
    expect(archiveResponse.json().item.notificationId).toBe("follow-up-failed:task-2");
    expect((butlerNotificationService.setArchived as any).mock.calls[0]).toEqual([
      "user-1",
      "follow-up-failed:task-2",
      true
    ]);

    const unarchiveResponse = await app.inject({
      method: "PATCH",
      url: "/api/butler/notifications/archives/follow-up-failed%3Atask-2",
      payload: {
        archived: false
      }
    });

    expect(unarchiveResponse.statusCode).toBe(200);
    expect(unarchiveResponse.json().item).toBeNull();
    expect((butlerNotificationService.setArchived as any).mock.calls[1]).toEqual([
      "user-1",
      "follow-up-failed:task-2",
      false
    ]);
  });
});
