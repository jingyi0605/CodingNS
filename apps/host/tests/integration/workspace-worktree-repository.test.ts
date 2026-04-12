import { describe, expect, it } from "vitest";

import { WorkspaceWorktreeRepository } from "../../src/storage/repositories/workspace-worktree-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

describe("工作树元数据仓储", () => {
  it("可以创建并按根工作区读取工作树记录", () => {
    const database = createDatabaseClient(":memory:");
    const repository = new WorkspaceWorktreeRepository(database.db);

    seedWorkspace(database.db, "workspace-root", "/tmp/root");
    seedWorkspace(database.db, "workspace-child-a", "/tmp/worktrees/child-a");
    seedWorkspace(database.db, "workspace-child-b", "/tmp/worktrees/child-b");

    repository.create({
      workspaceId: "workspace-child-a",
      rootWorkspaceId: "workspace-root",
      parentWorkspaceId: "workspace-root",
      sourceWorkspaceId: "workspace-root",
      mergeTargetWorkspaceId: "workspace-root",
      branchName: "feat/a",
      baseRef: "main",
      baseCommit: "abc123",
      headCommit: "abc456",
      displayName: "feat/a",
      depth: 1,
      lifecycleStatus: "active",
      mergedAt: null,
      removedAt: null,
      createdAt: "2026-04-12T10:00:00.000Z",
      updatedAt: "2026-04-12T10:10:00.000Z"
    });
    repository.create({
      workspaceId: "workspace-child-b",
      rootWorkspaceId: "workspace-root",
      parentWorkspaceId: "workspace-child-a",
      sourceWorkspaceId: "workspace-child-a",
      mergeTargetWorkspaceId: "workspace-child-a",
      branchName: "feat/b",
      baseRef: "feat/a",
      baseCommit: "abc456",
      headCommit: null,
      displayName: "feat/b",
      depth: 2,
      lifecycleStatus: "active",
      mergedAt: null,
      removedAt: null,
      createdAt: "2026-04-12T10:20:00.000Z",
      updatedAt: "2026-04-12T10:30:00.000Z"
    });

    expect(repository.findByWorkspaceId("workspace-child-a")).toEqual({
      workspaceId: "workspace-child-a",
      rootWorkspaceId: "workspace-root",
      parentWorkspaceId: "workspace-root",
      sourceWorkspaceId: "workspace-root",
      mergeTargetWorkspaceId: "workspace-root",
      branchName: "feat/a",
      baseRef: "main",
      baseCommit: "abc123",
      headCommit: "abc456",
      displayName: "feat/a",
      depth: 1,
      lifecycleStatus: "active",
      mergedAt: null,
      removedAt: null,
      createdAt: "2026-04-12T10:00:00.000Z",
      updatedAt: "2026-04-12T10:10:00.000Z"
    });
    expect(repository.listByRootWorkspaceId("workspace-root").map((item) => item.workspaceId)).toEqual([
      "workspace-child-a",
      "workspace-child-b"
    ]);
    expect(repository.listByParentWorkspaceId("workspace-root").map((item) => item.workspaceId)).toEqual([
      "workspace-child-a"
    ]);

    database.close();
  });

  it("可以回写工作树状态", () => {
    const database = createDatabaseClient(":memory:");
    const repository = new WorkspaceWorktreeRepository(database.db);

    seedWorkspace(database.db, "workspace-root", "/tmp/root");
    seedWorkspace(database.db, "workspace-child", "/tmp/worktrees/child");

    repository.create({
      workspaceId: "workspace-child",
      rootWorkspaceId: "workspace-root",
      parentWorkspaceId: "workspace-root",
      sourceWorkspaceId: "workspace-root",
      mergeTargetWorkspaceId: "workspace-root",
      branchName: "feat/merge-me",
      baseRef: "main",
      baseCommit: "abc123",
      headCommit: null,
      displayName: "feat/merge-me",
      depth: 1,
      lifecycleStatus: "active",
      mergedAt: null,
      removedAt: null,
      createdAt: "2026-04-12T10:00:00.000Z",
      updatedAt: "2026-04-12T10:00:00.000Z"
    });

    const updated = repository.update({
      workspaceId: "workspace-child",
      rootWorkspaceId: "workspace-root",
      parentWorkspaceId: "workspace-root",
      sourceWorkspaceId: "workspace-root",
      mergeTargetWorkspaceId: "workspace-root",
      branchName: "feat/merge-me",
      baseRef: "main",
      baseCommit: "abc123",
      headCommit: "def789",
      displayName: "feat/merge-me",
      depth: 1,
      lifecycleStatus: "merged",
      mergedAt: "2026-04-12T11:00:00.000Z",
      removedAt: null,
      createdAt: "2026-04-12T10:00:00.000Z",
      updatedAt: "2026-04-12T11:00:00.000Z"
    });

    expect(updated?.lifecycleStatus).toBe("merged");
    expect(updated?.headCommit).toBe("def789");
    expect(updated?.mergedAt).toBe("2026-04-12T11:00:00.000Z");

    repository.deleteByWorkspaceId("workspace-child");
    expect(repository.findByWorkspaceId("workspace-child")).toBeNull();

    database.close();
  });
});

function seedWorkspace(
  db: ReturnType<typeof createDatabaseClient>["db"],
  workspaceId: string,
  workspacePath: string
): void {
  db.prepare(
    `INSERT INTO workspaces (
       id,
       name,
       path,
       repo_root,
       favorite,
       sort_order,
       created_at,
       updated_at,
       removed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    workspaceId,
    workspaceId,
    workspacePath,
    workspacePath,
    0,
    0,
    "2026-04-12T09:00:00.000Z",
    "2026-04-12T09:00:00.000Z",
    null
  );
}
