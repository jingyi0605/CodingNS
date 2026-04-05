import { describe, expect, it, vi } from "vitest";

import type { ButlerProject } from "../../src/types/domain.js";
import type { ButlerProjectRepository } from "../../src/storage/repositories/butler-project-repository.js";
import type {
  PatrolPlanRecord,
  PatrolPlanRepository
} from "../../src/storage/repositories/patrol-plan-repository.js";
import { PatrolPlanService } from "../../src/modules/butler/patrol-plan-service.js";

describe("PatrolPlanService", () => {
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

  it("can create a patrol plan", () => {
    const repository: Partial<PatrolPlanRepository> = {
      listByProject: vi.fn(() => []),
      create: vi.fn((record: PatrolPlanRecord) => record)
    };
    const service = new PatrolPlanService(
      {
        findById: vi.fn(() => project)
      } satisfies Pick<ButlerProjectRepository, "findById">,
      repository as PatrolPlanRepository
    );

    const plan = service.createPlan(project.id, {
      name: "daily",
      triggerType: "interval",
      triggerConfig: { minutes: 15 },
      executionMode: "readonly",
      patrolScope: { includeTests: true },
      enabled: true
    });

    expect(plan.projectId).toBe(project.id);
    expect(plan.triggerType).toBe("interval");
    expect(plan.enabled).toBe(true);
    expect(plan.nextRunAt).not.toBeNull();
    expect(repository.create).toHaveBeenCalled();
  });

  it("can update a patrol plan", () => {
    const record: PatrolPlanRecord = {
      id: "plan-1",
      projectId: project.id,
      name: "daily",
      triggerType: "interval",
      triggerConfigJson: "{}",
      executionMode: "readonly",
      patrolScopeJson: "{}",
      enabled: 1,
      lastScheduledAt: null,
      nextRunAt: null,
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z"
    };
    const repository: Partial<PatrolPlanRepository> = {
      listByProject: vi.fn(() => [record]),
      findById: vi.fn(() => record),
      update: vi.fn((input: PatrolPlanRecord) => input)
    };

    const service = new PatrolPlanService(
      {
        findById: vi.fn(() => project)
      } satisfies Pick<ButlerProjectRepository, "findById">,
      repository as PatrolPlanRepository
    );

    const updated = service.updatePlan(project.id, record.id, {
      name: "weekly",
      enabled: false
    });

    expect(updated.name).toBe("weekly");
    expect(updated.enabled).toBe(false);
    expect(repository.update).toHaveBeenCalled();
  });
});
