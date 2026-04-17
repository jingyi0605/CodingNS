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
  it("可以在工作区内创建代码助手项目", () => {
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

  it("会把普通工作区自动补成代码助手项目，并排除助手自己的工作目录", () => {
    const workspaceAPath = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-project-auto-a-"));
    const workspaceBPath = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-project-auto-b-"));
    tempDirs.push(workspaceAPath, workspaceBPath);
    const projects: ButlerProject[] = [];
    const workspaces: Workspace[] = [
      {
        id: "workspace-a",
        name: "项目 A",
        path: workspaceAPath,
        repoRoot: workspaceAPath,
        favorite: false,
        createdAt: "2026-04-02T00:00:00.000Z",
        updatedAt: "2026-04-02T00:00:00.000Z",
        removedAt: null
      },
      {
        id: "workspace-butler",
        name: "助手目录",
        path: workspaceBPath,
        repoRoot: workspaceBPath,
        favorite: false,
        createdAt: "2026-04-02T00:00:00.000Z",
        updatedAt: "2026-04-02T00:00:00.000Z",
        removedAt: null
      }
    ];
    const service = new ButlerProjectService(
      {
        list: vi.fn(() => projects),
        create: vi.fn((record: ButlerProject) => {
          projects.push(record);
          return record;
        })
      } satisfies Pick<ButlerProjectRepository, "list" | "create"> as ButlerProjectRepository,
      {} as ButlerSessionRepository,
      {
        list: vi.fn(() => workspaces)
      } satisfies Pick<WorkspaceRepository, "list"> as WorkspaceRepository,
      {
        getProfile: vi.fn(() => ({
          workspacePath: workspaceBPath
        }))
      } as never
    );

    const result = service.list();

    expect(result).toHaveLength(1);
    expect(result[0]?.workspaceId).toBe("workspace-a");
    expect(result[0]?.config.managedBy).toBe("workspace-auto");
  });

  it("会在工作区移除后自动归档自动纳管项目", () => {
    const archivedProject: ButlerProject = {
      id: "project-auto-1",
      workspaceId: "workspace-gone",
      name: "旧项目",
      repoRoot: "/tmp/old-project",
      defaultProvider: null,
      instructionProfileId: null,
      approvalMode: "controlled",
      lifecycleStatus: "active",
      riskLevel: "low",
      config: {
        managedBy: "workspace-auto"
      },
      lastPatrolAt: null,
      lastVerificationAt: null,
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
      archivedAt: null
    };
    const projects: ButlerProject[] = [archivedProject];
    const service = new ButlerProjectService(
      {
        list: vi.fn(() => projects),
        update: vi.fn((record: ButlerProject) => {
          projects[0] = record;
          return record;
        })
      } satisfies Pick<ButlerProjectRepository, "list" | "update"> as ButlerProjectRepository,
      {} as ButlerSessionRepository,
      {
        list: vi.fn(() => [])
      } satisfies Pick<WorkspaceRepository, "list"> as WorkspaceRepository
    );

    const result = service.list();

    expect(result[0]?.lifecycleStatus).toBe("archived");
    expect(result[0]?.archivedAt).not.toBeNull();
  });

  it("不会把助手沙箱工作区自动补成正式项目", () => {
    const workspacePath = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-project-sandbox-"));
    tempDirs.push(workspacePath);
    const workspaces: Workspace[] = [
      {
        id: "workspace-sandbox",
        name: "临时沙箱",
        path: workspacePath,
        repoRoot: workspacePath,
        favorite: false,
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
        removedAt: null
      }
    ];
    const projects: ButlerProject[] = [];
    const service = new ButlerProjectService(
      {
        list: vi.fn(() => projects),
        create: vi.fn((record: ButlerProject) => {
          projects.push(record);
          return record;
        })
      } satisfies Pick<ButlerProjectRepository, "list" | "create"> as ButlerProjectRepository,
      {} as ButlerSessionRepository,
      {
        list: vi.fn(() => workspaces)
      } satisfies Pick<WorkspaceRepository, "list"> as WorkspaceRepository,
      undefined,
      {
        listManagedWorkspaceIds: vi.fn(() => ["workspace-sandbox"])
      } as any
    );

    const result = service.list();

    expect(result).toHaveLength(0);
    expect(projects).toHaveLength(0);
  });
});
