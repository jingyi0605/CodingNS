import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import chokidar from "chokidar";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceFileWatcher } from "../../src/modules/workbench/workspace-file-watcher.js";
import type { WorkspaceService } from "../../src/modules/workspace/workspace-service.js";

vi.mock("chokidar", () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn(),
      close: vi.fn()
    }))
  }
}));

describe("WorkspaceFileWatcher", () => {
  let tempRoot: string | null = null;

  afterEach(() => {
    vi.clearAllMocks();

    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it("Git watcher 只监听必要元数据，不会递归盯住 .git/objects", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codingns-git-watcher-"));
    fs.mkdirSync(path.join(tempRoot, ".git", "refs", "heads"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, ".git", "refs", "remotes", "origin"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, ".git", "logs"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, ".git", "objects", "aa"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, ".git", "HEAD"), "ref: refs/heads/main\n");
    fs.writeFileSync(path.join(tempRoot, ".git", "index"), "");
    fs.writeFileSync(path.join(tempRoot, ".git", "packed-refs"), "");
    fs.writeFileSync(path.join(tempRoot, ".git", "logs", "HEAD"), "");
    fs.writeFileSync(path.join(tempRoot, ".git", "refs", "heads", "main"), "");
    fs.writeFileSync(path.join(tempRoot, ".git", "refs", "remotes", "origin", "main"), "");
    fs.writeFileSync(path.join(tempRoot, ".git", "objects", "aa", "deadbeef"), "");

    const workspaceService = {
      getWorkspaceOrThrow: vi.fn(() => ({
        id: "workspace-1",
        path: tempRoot!,
        repoRoot: tempRoot!
      }))
    } satisfies Pick<WorkspaceService, "getWorkspaceOrThrow">;
    const watcher = new WorkspaceFileWatcher(workspaceService as WorkspaceService);

    watcher.subscribeGit("workspace-1");

    const watchedTargets = vi.mocked(chokidar.watch).mock.calls.map(([target]) => String(target));

    expect(watchedTargets).toContain(path.join(tempRoot, ".git", "HEAD"));
    expect(watchedTargets).toContain(path.join(tempRoot, ".git", "index"));
    expect(watchedTargets).toContain(path.join(tempRoot, ".git", "packed-refs"));
    expect(watchedTargets).toContain(path.join(tempRoot, ".git", "logs", "HEAD"));
    expect(watchedTargets).toContain(path.join(tempRoot, ".git", "refs", "heads"));
    expect(watchedTargets).toContain(path.join(tempRoot, ".git", "refs", "remotes"));
    expect(watchedTargets).not.toContain(path.join(tempRoot, ".git"));
    expect(watchedTargets).not.toContain(path.join(tempRoot, ".git", "objects"));
    expect(watchedTargets.some((target) => target.includes(`${path.sep}.git${path.sep}objects${path.sep}`))).toBe(false);
  });
});
