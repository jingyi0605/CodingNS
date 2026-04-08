import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ButlerControlActionService } from "../../src/modules/butler/butler-control-action-service.js";
import type { ButlerControlSessionService } from "../../src/modules/butler/butler-control-session-service.js";
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
import { setErrorHandler } from "../../src/shared/http/error-handler.js";

describe("butler session target routes", () => {
  const apps: FastifyInstance[] = [];

  async function createButlerApp(
    butlerProjectService: ButlerProjectService,
    butlerSessionService: ButlerSessionService
  ): Promise<FastifyInstance> {
    const controller = new ButlerController(
      {} as ButlerProfileService,
      {} as ButlerControlSessionService,
      {} as ButlerControlActionService,
      {} as ButlerContextAggregator,
      {} as ButlerFollowUpService,
      {} as ButlerInboxService,
      butlerProjectService,
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

  it("会返回当前 session 对应的 Butler 项目和 Butler 会话", async () => {
    const butlerProjectService = {
      resolveWorkspaceActionProject: vi.fn(() => ({
        id: "project-1",
        workspaceId: "workspace-1",
        name: "项目甲",
        repoRoot: "/tmp/project-a",
        defaultProvider: "codex",
        instructionProfileId: null,
        approvalMode: "controlled",
        lifecycleStatus: "active",
        riskLevel: "low",
        config: {
          managedBy: "workspace-auto"
        },
        lastPatrolAt: null,
        lastVerificationAt: null,
        createdAt: "2026-04-07T00:00:00.000Z",
        updatedAt: "2026-04-07T00:00:00.000Z",
        archivedAt: null
      }))
    } as unknown as ButlerProjectService;
    const butlerSessionService = {
      getSessionWorkspaceId: vi.fn(() => "workspace-1"),
      resolveActionTarget: vi.fn(async () => ({
        workspaceId: "workspace-1",
        session: {
          id: "butler-session-1",
          projectId: "project-1",
          sessionId: "session-1",
          provider: "codex",
          title: "登录页开发",
          role: "adhoc",
          ownershipMode: "observed",
          status: "running",
          runningState: "running",
          lastSummary: "正在推进登录页开发",
          lastCheckpointAt: "2026-04-07T00:05:00.000Z",
          createdAt: "2026-04-07T00:00:00.000Z",
          updatedAt: "2026-04-07T00:05:00.000Z"
        }
      }))
    } as unknown as ButlerSessionService;

    const app = await createButlerApp(butlerProjectService, butlerSessionService);
    const response = await app.inject({
      method: "GET",
      url: "/api/butler/session-target?sessionId=session-1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().target.project.id).toBe("project-1");
    expect(response.json().target.session.id).toBe("butler-session-1");
    expect((butlerSessionService.getSessionWorkspaceId as any).mock.calls[0][0]).toBe("session-1");
  });
});
