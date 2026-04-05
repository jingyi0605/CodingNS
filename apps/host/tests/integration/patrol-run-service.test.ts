import { describe, expect, it, vi } from "vitest";

import type { ButlerProject } from "../../src/types/domain.js";
import type { ButlerProjectRepository } from "../../src/storage/repositories/butler-project-repository.js";
import type { PatrolPlanRepository } from "../../src/storage/repositories/patrol-plan-repository.js";
import type {
  PatrolRunRecord,
  PatrolRunRepository
} from "../../src/storage/repositories/patrol-run-repository.js";
import { PatrolRunService } from "../../src/modules/butler/patrol-run-service.js";

describe("PatrolRunService", () => {
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

  it("can start a patrol run", () => {
    const planRepo: Partial<PatrolPlanRepository> = {
      findById: vi.fn(() => ({ id: "plan-1", projectId: project.id } as const))
    };
    const runRepo: Partial<PatrolRunRepository> = {
      listByProject: vi.fn(() => []),
      create: vi.fn((record: PatrolRunRecord) => record),
      findById: vi.fn(() => null)
    };

    const service = new PatrolRunService(
      {
        findById: vi.fn(() => project)
      } satisfies Pick<ButlerProjectRepository, "findById">,
      planRepo as PatrolPlanRepository,
      runRepo as PatrolRunRepository
    );

    const run = service.startRun(project.id, {
      planId: "plan-1",
      suggestions: ["fix tests"]
    });

    expect(run.projectId).toBe(project.id);
    expect(run.status).toBe("queued");
    expect(run.startedAt).toBeNull();
    expect(run.suggestions).toEqual(["fix tests"]);
    expect(runRepo.create).toHaveBeenCalled();
  });

  it("can list and get patrol runs", () => {
    const runRecord: PatrolRunRecord = {
      id: "run-1",
      projectId: project.id,
      planId: "plan-1",
      triggeredBy: "user",
      triggerRef: null,
      butlerSessionId: null,
      status: "queued",
      summary: null,
      riskLevel: null,
      suggestionsJson: "[]",
      startedAt: null,
      finishedAt: null,
      createdAt: "2026-04-02T00:00:00.000Z"
    };
    const planRepo: Partial<PatrolPlanRepository> = {
      findById: vi.fn(() => ({ id: "plan-1", projectId: project.id } as const))
    };
    const runRepo: Partial<PatrolRunRepository> = {
      listByProject: vi.fn(() => [runRecord]),
      findById: vi.fn(() => runRecord)
    };

    const service = new PatrolRunService(
      {
        findById: vi.fn(() => project)
      } satisfies Pick<ButlerProjectRepository, "findById">,
      planRepo as PatrolPlanRepository,
      runRepo as PatrolRunRepository
    );

    const runs = service.listRuns(project.id);
    expect(runs).toHaveLength(1);
    expect(service.getRun(project.id, runRecord.id).id).toBe(runRecord.id);
  });

  it("can mark run running and complete it", () => {
    const runRecord: PatrolRunRecord = {
      id: "run-1",
      projectId: project.id,
      planId: "plan-1",
      triggeredBy: "user",
      triggerRef: null,
      butlerSessionId: null,
      status: "queued",
      summary: null,
      riskLevel: null,
      suggestionsJson: "[]",
      startedAt: null,
      finishedAt: null,
      createdAt: "2026-04-02T00:00:00.000Z"
    };
    let persisted = runRecord;
    const service = new PatrolRunService(
      {
        findById: vi.fn(() => project)
      } satisfies Pick<ButlerProjectRepository, "findById">,
      {
        findById: vi.fn(() => ({ id: "plan-1", projectId: project.id } as const))
      } as PatrolPlanRepository,
      {
        findById: vi.fn(() => persisted),
        update: vi.fn((record: PatrolRunRecord) => {
          persisted = record;
          return record;
        }),
        listRunningByProject: vi.fn(() => [])
      } as unknown as PatrolRunRepository
    );

    const running = service.markRunRunning(runRecord.id, {
      butlerSessionId: "butler-session-1",
      startedAt: "2026-04-02T00:01:00.000Z"
    });
    const completed = service.completeRun(runRecord.id, {
      status: "succeeded",
      summary: "巡视完成",
      riskLevel: "low",
      suggestions: ["继续推进集成测试"],
      finishedAt: "2026-04-02T00:02:00.000Z"
    });

    expect(running.status).toBe("running");
    expect(running.butlerSessionId).toBe("butler-session-1");
    expect(completed.status).toBe("succeeded");
    expect(completed.summary).toBe("巡视完成");
    expect(completed.suggestions).toEqual(["继续推进集成测试"]);
  });

  it("can expire stale running runs", () => {
    const staleRun: PatrolRunRecord = {
      id: "run-stale",
      projectId: project.id,
      planId: "plan-1",
      triggeredBy: "scheduler",
      triggerRef: "patrol-scheduler:test",
      butlerSessionId: "butler-session-1",
      status: "running",
      summary: null,
      riskLevel: null,
      suggestionsJson: "[]",
      startedAt: "2026-04-02T00:00:00.000Z",
      finishedAt: null,
      createdAt: "2026-04-02T00:00:00.000Z"
    };
    let persisted = staleRun;
    const service = new PatrolRunService(
      {
        findById: vi.fn(() => project)
      } satisfies Pick<ButlerProjectRepository, "findById">,
      {
        findById: vi.fn(() => ({ id: "plan-1", projectId: project.id } as const))
      } as PatrolPlanRepository,
      {
        findById: vi.fn(() => persisted),
        update: vi.fn((record: PatrolRunRecord) => {
          persisted = record;
          return record;
        }),
        listRunningByProject: vi.fn(() => [persisted])
      } as unknown as PatrolRunRepository
    );

    const expired = service.expireStaleRunningRuns(project.id, {
      referenceAt: "2026-04-02T00:30:00.000Z",
      staleTimeoutMs: 5 * 60_000
    });

    expect(expired).toHaveLength(1);
    expect(expired[0]?.status).toBe("failed");
    expect(expired[0]?.summary).toContain("自动回收");
    expect(expired[0]?.riskLevel).toBe("high");
  });

  it("does not override run after terminal status is reached", () => {
    const terminalRun: PatrolRunRecord = {
      id: "run-terminal",
      projectId: project.id,
      planId: "plan-1",
      triggeredBy: "scheduler",
      triggerRef: "patrol-scheduler:test",
      butlerSessionId: "butler-session-1",
      status: "failed",
      summary: "first failure",
      riskLevel: "high",
      suggestionsJson: JSON.stringify(["check logs"]),
      startedAt: "2026-04-02T00:00:00.000Z",
      finishedAt: "2026-04-02T00:10:00.000Z",
      createdAt: "2026-04-02T00:00:00.000Z"
    };
    const updateSpy = vi.fn();

    const service = new PatrolRunService(
      {
        findById: vi.fn(() => project)
      } satisfies Pick<ButlerProjectRepository, "findById">,
      {
        findById: vi.fn(() => ({ id: "plan-1", projectId: project.id } as const))
      } as PatrolPlanRepository,
      {
        findById: vi.fn(() => terminalRun),
        update: updateSpy
      } as unknown as PatrolRunRepository
    );

    const completed = service.completeRun(terminalRun.id, {
      status: "succeeded",
      summary: "late success",
      riskLevel: "low",
      suggestions: ["should be ignored"],
      finishedAt: "2026-04-02T00:11:00.000Z"
    });

    expect(completed.status).toBe("failed");
    expect(completed.summary).toBe("first failure");
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
