import { describe, expect, it, vi } from "vitest";

import type { AuthUserRepository } from "../../src/storage/repositories/auth-user-repository.js";
import type { ButlerProjectRepository } from "../../src/storage/repositories/butler-project-repository.js";
import type { ButlerSessionRepository } from "../../src/storage/repositories/butler-session-repository.js";
import type { PatrolPlanRecord, PatrolPlanRepository } from "../../src/storage/repositories/patrol-plan-repository.js";
import type { ProjectMemoryRepository } from "../../src/storage/repositories/project-memory-repository.js";
import type { SessionCheckpointRepository } from "../../src/storage/repositories/session-checkpoint-repository.js";
import type { ButlerProject, ButlerSession } from "../../src/types/domain.js";
import { PatrolExecutionService } from "../../src/modules/butler/patrol-execution-service.js";
import type { InstructionAdapter } from "../../src/modules/butler/instruction-adapter.js";
import type { ProviderAdapterRegistry } from "../../src/modules/butler/provider-adapter-registry.js";
import type { PatrolRunService, PatrolRunView } from "../../src/modules/butler/patrol-run-service.js";

describe("PatrolExecutionService", () => {
  it("会启动 provider 巡视会话，并在完成后回写 run、project、checkpoint", async () => {
    const project: ButlerProject = {
      id: "project-1",
      workspaceId: "workspace-1",
      name: "repo-a",
      repoRoot: "/tmp/repo-a",
      defaultProvider: "codex",
      instructionProfileId: null,
      approvalMode: "controlled",
      lifecycleStatus: "active",
      riskLevel: "low",
      config: {},
      lastPatrolAt: null,
      lastVerificationAt: null,
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
      archivedAt: null
    };
    const plan: PatrolPlanRecord = {
      id: "plan-1",
      projectId: project.id,
      name: "daily",
      triggerType: "interval",
      triggerConfigJson: JSON.stringify({ minutes: 30 }),
      executionMode: "readonly",
      patrolScopeJson: JSON.stringify({ include: ["src"] }),
      enabled: 1,
      lastScheduledAt: null,
      nextRunAt: "2026-04-02T00:30:00.000Z",
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z"
    };

    let currentRun: PatrolRunView = {
      id: "run-1",
      projectId: project.id,
      planId: plan.id,
      triggeredBy: "scheduler",
      triggerRef: null,
      butlerSessionId: null,
      status: "queued",
      summary: null,
      riskLevel: null,
      suggestions: [],
      startedAt: null,
      finishedAt: null,
      createdAt: "2026-04-02T00:00:00.000Z"
    };
    let butlerSession: ButlerSession | null = null;
    const checkpoints: Array<{ summary: string; progressState: string }> = [];
    const projectUpdates: ButlerProject[] = [];

    const patrolRunService = {
      getRunById: vi.fn(() => currentRun),
      markRunRunning: vi.fn((runId: string, input: { butlerSessionId?: string | null; startedAt?: string | null }) => {
        currentRun = {
          ...currentRun,
          id: runId,
          status: "running",
          butlerSessionId: input.butlerSessionId ?? null,
          startedAt: input.startedAt ?? null
        };
        return currentRun;
      }),
      completeRun: vi.fn((runId: string, input: { status: "succeeded" | "failed" | "cancelled"; summary: string | null; riskLevel: "low" | "medium" | "high" | null; suggestions: string[]; finishedAt?: string | null }) => {
        currentRun = {
          ...currentRun,
          id: runId,
          status: input.status,
          summary: input.summary,
          riskLevel: input.riskLevel,
          suggestions: input.suggestions,
          finishedAt: input.finishedAt ?? null
        };
        return currentRun;
      })
    } satisfies Pick<PatrolRunService, "getRunById" | "markRunRunning" | "completeRun">;

    const providerAdapter = {
      providerId: "codex" as const,
      startPatrolSession: vi.fn(async () => ({
        sessionId: "session-1",
        provider: "codex",
        providerSessionId: "provider-session-1",
        acceptedAt: "2026-04-02T00:01:00.000Z"
      })),
      waitForSessionTerminal: vi.fn(async () => {}),
      readPatrolResult: vi.fn(async () => ({
        assistantMessages: ["巡视结论\n```json\n{\n  \"summary\": \"测试通过\",\n  \"riskLevel\": \"medium\",\n  \"suggestions\": [\"补一条 e2e\"],\n  \"progressState\": \"working\",\n  \"riskFlags\": [\"缺少端到端覆盖\"],\n  \"nextActions\": [\"补充巡视回归测试\"]\n}\n```"],
        latestAssistantMessage: "巡视结论\n```json\n{\n  \"summary\": \"测试通过\",\n  \"riskLevel\": \"medium\",\n  \"suggestions\": [\"补一条 e2e\"],\n  \"progressState\": \"working\",\n  \"riskFlags\": [\"缺少端到端覆盖\"],\n  \"nextActions\": [\"补充巡视回归测试\"]\n}\n```",
        structured: {
          summary: "测试通过",
          riskLevel: "medium" as const,
          suggestions: ["补一条 e2e"],
          progressState: "working" as const,
          riskFlags: ["缺少端到端覆盖"],
          nextActions: ["补充巡视回归测试"],
          rawJson: "{}"
        }
      }))
    };

    const service = new PatrolExecutionService(
      {
        findById: vi.fn(() => project),
        update: vi.fn((record: ButlerProject) => {
          projectUpdates.push(record);
          return record;
        })
      } satisfies Pick<ButlerProjectRepository, "findById" | "update"> as ButlerProjectRepository,
      {
        findBySessionId: vi.fn(() => butlerSession),
        create: vi.fn((record: ButlerSession) => {
          butlerSession = record;
          return record;
        }),
        update: vi.fn((record: ButlerSession) => {
          butlerSession = record;
          return record;
        })
      } satisfies Pick<ButlerSessionRepository, "findBySessionId" | "create" | "update"> as ButlerSessionRepository,
      {
        getLatestSeq: vi.fn(() => checkpoints.length),
        create: vi.fn((record) => {
          checkpoints.push({ summary: record.summary, progressState: record.progressState });
          return record;
        })
      } satisfies Pick<SessionCheckpointRepository, "getLatestSeq" | "create"> as SessionCheckpointRepository,
      {
        findById: vi.fn(() => plan)
      } satisfies Pick<PatrolPlanRepository, "findById"> as PatrolPlanRepository,
      patrolRunService as PatrolRunService,
      {
        listByProject: vi.fn(() => [])
      } satisfies Pick<ProjectMemoryRepository, "listByProject"> as ProjectMemoryRepository,
      {
        listIds: vi.fn(() => ["user-1"])
      } satisfies Pick<AuthUserRepository, "listIds"> as AuthUserRepository,
      {
        get: vi.fn(() => providerAdapter)
      } satisfies Pick<ProviderAdapterRegistry, "get"> as ProviderAdapterRegistry,
      {
        buildPatrolInstruction: vi.fn(() => ({
          providerId: "codex",
          outputContractVersion: "butler-patrol-v1",
          title: "代码管家巡视",
          prompt: "请执行巡视",
          metadata: {
            projectId: project.id,
            projectName: project.name,
            runId: currentRun.id,
            planId: plan.id,
            executionMode: "readonly" as const
          }
        }))
      } satisfies Pick<InstructionAdapter, "buildPatrolInstruction"> as InstructionAdapter
    );

    const running = await service.executeQueuedRun(currentRun.id);

    expect(running.status).toBe("running");
    expect(providerAdapter.startPatrolSession).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => {
      expect(patrolRunService.completeRun).toHaveBeenCalledTimes(1);
    });

    expect(currentRun.status).toBe("succeeded");
    expect(currentRun.summary).toBe("测试通过");
    expect(currentRun.riskLevel).toBe("medium");
    expect(currentRun.suggestions).toEqual(["补一条 e2e", "补充巡视回归测试"]);
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints.at(-1)).toEqual({
      summary: "测试通过",
      progressState: "working"
    });
    expect(projectUpdates.at(-1)?.riskLevel).toBe("medium");
    expect(projectUpdates.at(-1)?.lastPatrolAt).toBe(currentRun.finishedAt);
  });

  it("provider 等待超时时会把 run 回写为 failed，避免长期挂起", async () => {
    const project: ButlerProject = {
      id: "project-2",
      workspaceId: "workspace-1",
      name: "repo-b",
      repoRoot: "/tmp/repo-b",
      defaultProvider: "codex",
      instructionProfileId: null,
      approvalMode: "readonly",
      lifecycleStatus: "active",
      riskLevel: "low",
      config: {},
      lastPatrolAt: null,
      lastVerificationAt: null,
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
      archivedAt: null
    };

    let currentRun: PatrolRunView = {
      id: "run-timeout",
      projectId: project.id,
      planId: null,
      triggeredBy: "scheduler",
      triggerRef: null,
      butlerSessionId: null,
      status: "queued",
      summary: null,
      riskLevel: null,
      suggestions: [],
      startedAt: null,
      finishedAt: null,
      createdAt: "2026-04-02T00:00:00.000Z"
    };
    let butlerSession: ButlerSession | null = null;
    const checkpoints: Array<{ summary: string; progressState: string }> = [];

    const patrolRunService = {
      getRunById: vi.fn(() => currentRun),
      markRunRunning: vi.fn((runId: string, input: { butlerSessionId?: string | null; startedAt?: string | null }) => {
        currentRun = {
          ...currentRun,
          id: runId,
          status: "running",
          butlerSessionId: input.butlerSessionId ?? null,
          startedAt: input.startedAt ?? null
        };
        return currentRun;
      }),
      completeRun: vi.fn((runId: string, input: { status: "succeeded" | "failed" | "cancelled"; summary: string | null; riskLevel: "low" | "medium" | "high" | null; suggestions: string[]; finishedAt?: string | null }) => {
        currentRun = {
          ...currentRun,
          id: runId,
          status: input.status,
          summary: input.summary,
          riskLevel: input.riskLevel,
          suggestions: input.suggestions,
          finishedAt: input.finishedAt ?? null
        };
        return currentRun;
      })
    } satisfies Pick<PatrolRunService, "getRunById" | "markRunRunning" | "completeRun">;

    const providerAdapter = {
      providerId: "codex" as const,
      startPatrolSession: vi.fn(async () => ({
        sessionId: "session-timeout",
        provider: "codex",
        providerSessionId: "provider-session-timeout",
        acceptedAt: "2026-04-02T00:01:00.000Z"
      })),
      waitForSessionTerminal: vi.fn(async () => {
        throw new Error("PATROL_SESSION_WAIT_TIMEOUT:session-timeout");
      }),
      readPatrolResult: vi.fn(async () => {
        throw new Error("should not read result on timeout");
      })
    };

    const service = new PatrolExecutionService(
      {
        findById: vi.fn(() => project),
        update: vi.fn((record: ButlerProject) => record)
      } satisfies Pick<ButlerProjectRepository, "findById" | "update"> as ButlerProjectRepository,
      {
        findBySessionId: vi.fn(() => butlerSession),
        create: vi.fn((record: ButlerSession) => {
          butlerSession = record;
          return record;
        }),
        update: vi.fn((record: ButlerSession) => {
          butlerSession = record;
          return record;
        })
      } satisfies Pick<ButlerSessionRepository, "findBySessionId" | "create" | "update"> as ButlerSessionRepository,
      {
        getLatestSeq: vi.fn(() => checkpoints.length),
        create: vi.fn((record) => {
          checkpoints.push({ summary: record.summary, progressState: record.progressState });
          return record;
        })
      } satisfies Pick<SessionCheckpointRepository, "getLatestSeq" | "create"> as SessionCheckpointRepository,
      {
        findById: vi.fn(() => null)
      } satisfies Pick<PatrolPlanRepository, "findById"> as PatrolPlanRepository,
      patrolRunService as PatrolRunService,
      {
        listByProject: vi.fn(() => [])
      } satisfies Pick<ProjectMemoryRepository, "listByProject"> as ProjectMemoryRepository,
      {
        listIds: vi.fn(() => ["user-1"])
      } satisfies Pick<AuthUserRepository, "listIds"> as AuthUserRepository,
      {
        get: vi.fn(() => providerAdapter)
      } satisfies Pick<ProviderAdapterRegistry, "get"> as ProviderAdapterRegistry,
      {
        buildPatrolInstruction: vi.fn(() => ({
          providerId: "codex",
          outputContractVersion: "butler-patrol-v1",
          title: "代码管家巡视",
          prompt: "请执行巡视",
          metadata: {
            projectId: project.id,
            projectName: project.name,
            runId: currentRun.id,
            planId: null,
            executionMode: "readonly" as const
          }
        }))
      } satisfies Pick<InstructionAdapter, "buildPatrolInstruction"> as InstructionAdapter
    );

    const running = await service.executeQueuedRun(currentRun.id);
    expect(running.status).toBe("running");

    await vi.waitFor(() => {
      expect(currentRun.status).toBe("failed");
    });

    expect(currentRun.summary).toContain("PATROL_SESSION_WAIT_TIMEOUT");
    expect(currentRun.riskLevel).toBe("high");
    expect(checkpoints.at(-1)).toMatchObject({
      progressState: "blocked"
    });
  });
});
