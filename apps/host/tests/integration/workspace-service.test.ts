import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceService } from "../../src/modules/workspace/workspace-service.js";
import { AppError } from "../../src/shared/errors/app-error.js";
import type { GitCommandRunner } from "../../src/modules/git/git-command-runner.js";
import type { WorkspaceRepository } from "../../src/storage/repositories/workspace-repository.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("WorkspaceService", () => {
  it("读取工作区管理摘要时会把 Git 超时降级为可展示错误", async () => {
    const workspacePath = mkdtempSync(path.join(os.tmpdir(), "codingns-workspace-service-"));
    tempDirs.push(workspacePath);

    const workspace = {
      id: "workspace-1",
      name: "慢仓库",
      path: workspacePath,
      repoRoot: workspacePath,
      favorite: false,
      sortOrder: 0,
      createdAt: "2026-03-27T00:00:00.000Z",
      updatedAt: "2026-03-27T00:00:00.000Z",
      removedAt: null
    };

    const workspaceRepository = {
      findById: vi.fn(() => workspace)
    } satisfies Pick<WorkspaceRepository, "findById">;

    const gitCommandRunner = {
      run: vi.fn(async () => {
        throw new AppError({
          statusCode: 504,
          errorCode: "GIT_COMMAND_TIMEOUT",
          detail: "Git 命令执行超时：git rev-parse --show-toplevel"
        });
      })
    } satisfies Pick<GitCommandRunner, "run">;

    const service = new WorkspaceService(
      workspaceRepository as unknown as WorkspaceRepository,
      gitCommandRunner as unknown as GitCommandRunner,
      {
        upsert: vi.fn()
      } as never
    );

    await expect(service.getManagementSummary(workspace.id)).resolves.toMatchObject({
      workspaceId: workspace.id,
      git: {
        isRepository: false,
        repoRoot: null,
        currentBranch: null,
        commitCount: null,
        remotes: [],
        error: "Git 信息读取超时，请稍后重试"
      },
      codeComposition: {
        error: null
      }
    });
  });
});
