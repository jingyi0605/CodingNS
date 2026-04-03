import { describe, expect, it, vi } from "vitest";

import type { ButlerProject, ProjectMemory } from "../../src/types/domain.js";
import type { ButlerProjectRepository } from "../../src/storage/repositories/butler-project-repository.js";
import type { ProjectMemoryRepository } from "../../src/storage/repositories/project-memory-repository.js";
import { ProjectMemoryService } from "../../src/modules/butler/project-memory-service.js";

describe("ProjectMemoryService", () => {
  it("创建记忆时会校验项目存在与内容完整", () => {
    const project: ButlerProject = {
      id: "project-1",
      workspaceId: "workspace-1",
      name: "repo",
      repoRoot: "/tmp/repo",
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

    const projectRepository = {
      findById: vi.fn(() => project)
    } satisfies Pick<ButlerProjectRepository, "findById">;

    const created: ProjectMemory[] = [];

    const memoryRepository = {
      listByProject: vi.fn(() => created),
      create: vi.fn((record: ProjectMemory) => {
        created.push(record);
        return record;
      }),
      findById: vi.fn(() => created[0] ?? null),
      update: vi.fn((record: ProjectMemory) => record)
    } satisfies Pick<ProjectMemoryRepository, "listByProject" | "create" | "findById" | "update">;

    const service = new ProjectMemoryService(
      projectRepository as unknown as ButlerProjectRepository,
      memoryRepository as unknown as ProjectMemoryRepository
    );

    const memory = service.createMemory(project.id, {
      title: "规则",
      content: "需要跑测试",
      confidence: 0.7
    });

    expect(memory.title).toBe("规则");
    expect(memory.confidence).toBe(0.7);
    expect(memoryRepository.create).toHaveBeenCalled();
  });
});
