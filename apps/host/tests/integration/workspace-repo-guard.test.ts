import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceRepoGuard } from "../../src/modules/git/workspace-repo-guard.js";
import type { GitCommandRunner } from "../../src/modules/git/git-command-runner.js";
import type { WorkspaceService } from "../../src/modules/workspace/workspace-service.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("WorkspaceRepoGuard", () => {
  it("会缓存短时间内的仓库根目录解析结果", async () => {
    const workspacePath = mkdtempSync(path.join(os.tmpdir(), "codingns-workspace-repo-guard-"));
    tempDirs.push(workspacePath);

    const workspace = {
      id: "workspace-1",
      name: "缓存仓库",
      path: workspacePath,
      repoRoot: workspacePath,
      favorite: false,
      createdAt: "2026-03-27T00:00:00.000Z",
      updatedAt: "2026-03-27T00:00:00.000Z",
      removedAt: null
    };
    const workspaceService = {
      getWorkspaceOrThrow: vi.fn(() => workspace)
    } satisfies Pick<WorkspaceService, "getWorkspaceOrThrow">;
    const gitCommandRunner = {
      run: vi.fn(async () => ({
        stdout: `${workspacePath}\n`,
        stderr: "",
        exitCode: 0
      }))
    } satisfies Pick<GitCommandRunner, "run">;

    const guard = new WorkspaceRepoGuard(
      workspaceService as unknown as WorkspaceService,
      gitCommandRunner as unknown as GitCommandRunner
    );

    await expect(guard.resolve(workspace.id)).resolves.toMatchObject({
      repoRoot: workspacePath
    });
    await expect(guard.resolve(workspace.id)).resolves.toMatchObject({
      repoRoot: workspacePath
    });

    expect(gitCommandRunner.run).toHaveBeenCalledTimes(1);
    expect(workspaceService.getWorkspaceOrThrow).toHaveBeenCalledTimes(2);
  });
});
