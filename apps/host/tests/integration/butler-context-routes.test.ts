import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ButlerControlSessionService } from "../../src/modules/butler/butler-control-session-service.js";
import type { ButlerControlActionService } from "../../src/modules/butler/butler-control-action-service.js";
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

describe("butler context routes", () => {
  const apps: FastifyInstance[] = [];

  async function createButlerApp(
    butlerContextAggregator: ButlerContextAggregator
  ): Promise<FastifyInstance> {
    const controller = new ButlerController(
      {} as ButlerProfileService,
      {} as ButlerControlSessionService,
      {} as ButlerControlActionService,
      butlerContextAggregator,
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

  it("overview/context-snapshot/project-context 路由会返回聚合摘要", async () => {
    const butlerContextAggregator = {
      getOverview: vi.fn(async () => ({
        version: "ctx-1",
        generatedAt: "2026-04-05T02:00:00.000Z",
        global: {
          projectCount: 1,
          activeProjectCount: 1,
          blockedProjectCount: 1,
          highRiskProjectCount: 1,
          topRisks: ["控制台项目阻塞"],
          nextActions: ["先修复类型错误"]
        },
        projects: [
          {
            id: "project-1",
            workspaceId: "workspace-1",
            name: "控制台",
            repoRoot: "/tmp/control-app",
            lifecycleStatus: "active",
            riskLevel: "high",
            activeSessionCount: 1,
            sessionCount: 1,
            memoryCount: 1,
            failedPatrolCount: 1,
            failedVerificationCount: 1,
            latestSessionSummary: "构建卡住",
            latestPatrolSummary: "巡视失败",
            latestVerificationSummary: "验证失败",
            topRisks: ["控制台项目阻塞"],
            nextActions: ["先修复类型错误"],
            lastActivityAt: "2026-04-05T02:00:00.000Z",
            updatedAt: "2026-04-05T02:00:00.000Z"
          }
        ],
        sessions: [],
        patrols: [],
        verifications: []
      })),
      getSnapshot: vi.fn(async () => ({
        version: "ctx-2",
        generatedAt: "2026-04-05T02:01:00.000Z",
        global: {
          projectCount: 1,
          activeProjectCount: 1,
          blockedProjectCount: 1,
          highRiskProjectCount: 1,
          topRisks: ["控制台项目阻塞"],
          nextActions: ["先修复类型错误"]
        },
        projects: [],
        sessions: [],
        memories: [],
        patrols: [],
        verifications: []
      })),
      getProjectContext: vi.fn(async () => ({
        version: "ctx-3",
        generatedAt: "2026-04-05T02:02:00.000Z",
        project: {
          id: "project-1",
          workspaceId: "workspace-1",
          name: "控制台",
          repoRoot: "/tmp/control-app",
          lifecycleStatus: "active",
          riskLevel: "high",
          activeSessionCount: 1,
          sessionCount: 1,
          memoryCount: 1,
          failedPatrolCount: 1,
          failedVerificationCount: 1,
          latestSessionSummary: "构建卡住",
          latestPatrolSummary: "巡视失败",
          latestVerificationSummary: "验证失败",
          topRisks: ["控制台项目阻塞"],
          nextActions: ["先修复类型错误"],
          lastActivityAt: "2026-04-05T02:02:00.000Z",
          updatedAt: "2026-04-05T02:02:00.000Z"
        },
        sessions: [],
        memories: [],
        patrols: [],
        verifications: [],
        topRisks: ["控制台项目阻塞"],
        nextActions: ["先修复类型错误"]
      }))
      ,
      searchSummaries: vi.fn(async () => ({
        version: "ctx-search-1",
        generatedAt: "2026-04-05T02:01:30.000Z",
        query: "类型错误",
        items: [
          {
            kind: "session",
            id: "butler-session-1",
            sessionId: "session-1",
            projectId: "project-1",
            workspaceId: "workspace-1",
            title: "修复控制台",
            summary: "构建被类型错误卡住",
            score: 12,
            updatedAt: "2026-04-05T02:01:00.000Z",
            isArchived: true
          }
        ]
      }))
    } as unknown as ButlerContextAggregator;

    const app = await createButlerApp(butlerContextAggregator);

    const overview = await app.inject({
      method: "GET",
      url: "/api/butler/overview"
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().overview.version).toBe("ctx-1");

    const snapshot = await app.inject({
      method: "GET",
      url: "/api/butler/context-snapshot"
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json().snapshot.version).toBe("ctx-2");

    const projectContext = await app.inject({
      method: "GET",
      url: "/api/butler/projects/project-1/context"
    });
    expect(projectContext.statusCode).toBe(200);
    expect(projectContext.json().context.project.id).toBe("project-1");
    expect(
      (butlerContextAggregator as unknown as { getProjectContext: ReturnType<typeof vi.fn> }).getProjectContext
    ).toHaveBeenCalledWith("project-1", "user-1");

    const search = await app.inject({
      method: "GET",
      url: "/api/butler/search?q=%E7%B1%BB%E5%9E%8B%E9%94%99%E8%AF%AF&projectId=project-1&includeArchived=true"
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().result.version).toBe("ctx-search-1");
    expect(search.json().result.items[0].kind).toBe("session");
    expect(
      (butlerContextAggregator as unknown as { searchSummaries: ReturnType<typeof vi.fn> }).searchSummaries
    ).toHaveBeenCalledWith("user-1", "类型错误", {
      projectId: "project-1",
      includeArchived: true
    });
  });
});
