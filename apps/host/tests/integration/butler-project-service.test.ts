import { mkdtempSync, rmSync } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ButlerProject, ButlerSession, Workspace } from "../../src/types/domain.js";
import type { ButlerProjectRepository } from "../../src/storage/repositories/butler-project-repository.js";
import type { ButlerSessionRepository } from "../../src/storage/repositories/butler-session-repository.js";
import type { WorkspaceRepository } from "../../src/storage/repositories/workspace-repository.js";
import { ButlerProjectService } from "../../src/modules/butler/butler-project-service.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("ButlerProjectService", () => {
  it("可以在工作区内创建代码管家项目", () => {
    const workspacePath = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-project-"));
    tempDirs.push(workspacePath);
    const repoRoot = path.join(workspacePath, "repo-a");
    fs.mkdirSync(repoRoot);

    const workspace: Workspace = {
      id: "workspace-1",
      name: "workspace-1",
      path: workspacePath,
      repoRoot: workspacePath,
      favorite: false,
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
      removedAt: null
    };
    const createdProjects: ButlerProject[] = [];

    const butlerProjectRepository = {
      list: vi.fn(() => createdProjects),
      create: vi.fn((record: ButlerProject) => {
        createdProjects.push(record);
        return record;
      })
    } satisfies Pick<ButlerProjectRepository, "list" | "create">;
    const butlerSessionRepository = {} satisfies Pick<ButlerSessionRepository, never>;
    const workspaceRepository = {
      findById: vi.fn(() => workspace)
    } satisfies Pick<WorkspaceRepository, "findById">;

    const service = new ButlerProjectService(
      butlerProjectRepository as unknown as ButlerProjectRepository,
      butlerSessionRepository as unknown as ButlerSessionRepository,
      workspaceRepository as unknown as WorkspaceRepository
    );

    const project = service.create({
      workspaceId: workspace.id,
      name: "repo-a",
      repoRoot,
      defaultProvider: "codex",
      approvalMode: "controlled",
      config: {
        branch: "main"
      }
    });

    expect(project.workspaceId).toBe(workspace.id);
    expect(project.repoRoot).toBe(repoRoot);
    expect(project.defaultProvider).toBe("codex");
    expect(project.lifecycleStatus).toBe("active");
    expect(createdProjects).toHaveLength(1);
  });
});
