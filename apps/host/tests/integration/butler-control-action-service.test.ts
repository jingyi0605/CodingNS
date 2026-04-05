import { describe, expect, it, vi } from "vitest";

import { ButlerControlActionService } from "../../src/modules/butler/butler-control-action-service.js";
import type { ButlerControlEvent, ButlerControlSession, ButlerProfile } from "../../src/types/domain.js";
import type { ButlerProfileService } from "../../src/modules/butler/butler-profile-service.js";
import type { ButlerControlSessionRepository } from "../../src/storage/repositories/butler-control-session-repository.js";
import type { ButlerControlEventRepository } from "../../src/storage/repositories/butler-control-event-repository.js";
import type { ButlerProjectService } from "../../src/modules/butler/butler-project-service.js";
import type { ButlerSessionService } from "../../src/modules/butler/butler-session-service.js";
import type { PatrolRunService } from "../../src/modules/butler/patrol-run-service.js";
import type { PatrolExecutionService } from "../../src/modules/butler/patrol-execution-service.js";
import type { VerificationRunService } from "../../src/modules/butler/verification-run-service.js";
import type { ButlerContextAggregator } from "../../src/modules/butler/context-aggregator.js";
import { AppError } from "../../src/shared/errors/app-error.js";

describe("ButlerControlActionService", () => {
  const profile: ButlerProfile = {
    id: "default",
    providerId: "codex",
    workspacePath: "/tmp/butler",
    agentsMode: "inline",
    agentsFilePath: null,
    agentsContent: "# AGENTS.md",
    persona: {
      tone: "direct",
      language: "zh-CN",
      summaryStyle: "brief"
    },
    focus: {
      projectIds: [],
      riskPreference: "conservative",
      reportPriority: ["risk"]
    },
    initializedAt: "2026-04-05T00:00:00.000Z",
    updatedAt: "2026-04-05T00:00:00.000Z"
  };
  const currentControlSession: ButlerControlSession = {
    id: "control-1",
    providerId: "codex",
    sessionId: "session-1",
    status: "running",
    lastContextVersion: "ctx-1",
    lastSummary: null,
    createdAt: "2026-04-05T00:00:00.000Z",
    updatedAt: "2026-04-05T00:00:00.000Z"
  };

  it("成功执行动作后会落 Butler 事件并附带关联对象", async () => {
    const createdEvents: ButlerControlEvent[] = [];
    const updatedSessions: ButlerControlSession[] = [];
    const service = new ButlerControlActionService(
      {
        ensureInitialized: vi.fn(() => profile)
      } as unknown as Pick<ButlerProfileService, "ensureInitialized">,
      {
        findLatestByProvider: vi.fn(() => currentControlSession),
        update: vi.fn((record: ButlerControlSession) => {
          updatedSessions.push(record);
          return record;
        })
      } as unknown as Pick<ButlerControlSessionRepository, "findLatestByProvider" | "update">,
      {
        create: vi.fn((record: ButlerControlEvent) => {
          createdEvents.push(record);
          return record;
        }),
        listByControlSessionId: vi.fn(() => createdEvents)
      } as unknown as Pick<ButlerControlEventRepository, "create" | "listByControlSessionId">,
      {
        getById: vi.fn(() => ({
          id: "project-1",
          workspaceId: "workspace-1",
          name: "控制台",
          repoRoot: "/tmp/control-app",
          defaultProvider: "codex",
          instructionProfileId: null,
          approvalMode: "controlled",
          lifecycleStatus: "active",
          riskLevel: "high",
          config: {},
          lastPatrolAt: null,
          lastVerificationAt: null,
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:00:00.000Z",
          archivedAt: null
        }))
      } as unknown as Pick<ButlerProjectService, "getById">,
      {
        resumeSession: vi.fn(async () => ({
          session: {
            id: "butler-session-1",
            projectId: "project-1",
            sessionId: "raw-session-1",
            provider: "codex",
            title: "修复类型错误",
            role: "execution",
            ownershipMode: "managed",
            status: "running",
            runningState: "running",
            lastSummary: "已恢复",
            lastCheckpointAt: "2026-04-05T00:10:00.000Z",
            createdAt: "2026-04-05T00:00:00.000Z",
            updatedAt: "2026-04-05T00:10:00.000Z"
          },
          resumedAt: "2026-04-05T00:10:00.000Z",
          provider: "codex",
          providerSessionId: "provider-session-1"
        }))
      } as unknown as Pick<ButlerSessionService, "resumeSession">,
      {
        startRun: vi.fn()
      } as unknown as Pick<PatrolRunService, "startRun">,
      {
        executeQueuedRun: vi.fn()
      } as unknown as Pick<PatrolExecutionService, "executeQueuedRun">,
      {
        startRun: vi.fn()
      } as unknown as Pick<VerificationRunService, "startRun">,
      {
        getProjectContext: vi.fn()
      } as unknown as Pick<ButlerContextAggregator, "getProjectContext">
    );

    const result = await service.resumeProjectSession(
      {
        projectId: "project-1",
        butlerSessionId: "butler-session-1"
      },
      "user-1"
    );

    expect(result.event.actionType).toBe("resume-session");
    expect(result.event.status).toBe("succeeded");
    expect(result.event.relatedRefs.map((item) => item.kind)).toEqual([
      "project",
      "butler-session",
      "session"
    ]);
    expect(createdEvents).toHaveLength(1);
    expect(updatedSessions.at(-1)?.lastSummary).toContain("已续接项目会话");
  });

  it("动作失败时也会落 failed 事件，避免 Butler 时间线失忆", async () => {
    const createdEvents: ButlerControlEvent[] = [];
    const service = new ButlerControlActionService(
      {
        ensureInitialized: vi.fn(() => profile)
      } as unknown as Pick<ButlerProfileService, "ensureInitialized">,
      {
        findLatestByProvider: vi.fn(() => currentControlSession),
        update: vi.fn((record: ButlerControlSession) => record)
      } as unknown as Pick<ButlerControlSessionRepository, "findLatestByProvider" | "update">,
      {
        create: vi.fn((record: ButlerControlEvent) => {
          createdEvents.push(record);
          return record;
        }),
        listByControlSessionId: vi.fn(() => createdEvents)
      } as unknown as Pick<ButlerControlEventRepository, "create" | "listByControlSessionId">,
      {
        getById: vi.fn(() => ({
          id: "project-1",
          workspaceId: "workspace-1",
          name: "控制台",
          repoRoot: "/tmp/control-app",
          defaultProvider: "codex",
          instructionProfileId: null,
          approvalMode: "controlled",
          lifecycleStatus: "active",
          riskLevel: "high",
          config: {},
          lastPatrolAt: null,
          lastVerificationAt: null,
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:00:00.000Z",
          archivedAt: null
        }))
      } as unknown as Pick<ButlerProjectService, "getById">,
      {
        resumeSession: vi.fn(async () => {
          throw new AppError({
            statusCode: 404,
            errorCode: "BUTLER_SESSION_NOT_FOUND",
            detail: "当前项目下不存在该会话"
          });
        })
      } as unknown as Pick<ButlerSessionService, "resumeSession">,
      {
        startRun: vi.fn()
      } as unknown as Pick<PatrolRunService, "startRun">,
      {
        executeQueuedRun: vi.fn()
      } as unknown as Pick<PatrolExecutionService, "executeQueuedRun">,
      {
        startRun: vi.fn()
      } as unknown as Pick<VerificationRunService, "startRun">,
      {
        getProjectContext: vi.fn()
      } as unknown as Pick<ButlerContextAggregator, "getProjectContext">
    );

    await expect(
      service.resumeProjectSession(
        {
          projectId: "project-1",
          butlerSessionId: "missing"
        },
        "user-1"
      )
    ).rejects.toMatchObject({
      errorCode: "BUTLER_SESSION_NOT_FOUND"
    });

    expect(createdEvents).toHaveLength(1);
    expect(createdEvents[0]?.status).toBe("failed");
    expect(createdEvents[0]?.content).toContain("当前项目下不存在该会话");
  });
});
