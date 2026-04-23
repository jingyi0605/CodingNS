import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ParallelSessionGroupRepository } from "../../src/storage/repositories/parallel-session-group-repository.js";
import { ParallelSessionMemberRepository } from "../../src/storage/repositories/parallel-session-member-repository.js";
import { SessionIsolatedWorkspaceRepository } from "../../src/storage/repositories/session-isolated-workspace-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

describe("并行会话仓储", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();

      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("可以持久化并读取并行组、成员和临时隔离工作区", () => {
    const database = createDatabaseClient(":memory:");
    seedUser(database.db, "user-1");
    seedWorkspace(database.db, "workspace-1", "/tmp/workspace-1");
    seedWorkspace(database.db, "workspace-2", "/tmp/workspace-2");

    const groupRepository = new ParallelSessionGroupRepository(database.db);
    const memberRepository = new ParallelSessionMemberRepository(database.db);
    const isolatedWorkspaceRepository = new SessionIsolatedWorkspaceRepository(database.db);

    groupRepository.create({
      id: "group-1",
      workspaceId: "workspace-1",
      sourceType: "fork",
      sourceSessionId: "session-source",
      sourceMessageId: "msg-1",
      sharedPrompt: "对比三种方案",
      requestedCount: 2,
      anchorSessionId: "session-a",
      status: "active",
      createdByUserId: "user-1",
      createdAt: "2026-04-23T09:00:00.000Z",
      updatedAt: "2026-04-23T09:05:00.000Z",
      deletedAt: null
    });
    memberRepository.create({
      groupId: "group-1",
      sessionId: "session-a",
      ordinal: 0,
      role: "anchor",
      provider: "codex",
      model: "gpt-5.1",
      memberPrompt: "先给最保守方案",
      workspaceIsolationMode: "none",
      temporaryWorkspaceId: null,
      createdAt: "2026-04-23T09:00:10.000Z",
      updatedAt: "2026-04-23T09:00:10.000Z",
      deletedAt: null
    });
    memberRepository.create({
      groupId: "group-1",
      sessionId: "session-b",
      ordinal: 1,
      role: "member",
      provider: "claude-code",
      model: null,
      memberPrompt: "偏激进一点",
      workspaceIsolationMode: "temporary_worktree",
      temporaryWorkspaceId: "isolated-1",
      createdAt: "2026-04-23T09:00:11.000Z",
      updatedAt: "2026-04-23T09:00:11.000Z",
      deletedAt: null
    });
    isolatedWorkspaceRepository.create({
      id: "isolated-1",
      groupId: "group-1",
      ownerSessionId: "session-b",
      workspaceId: "workspace-2",
      sourceWorkspaceId: "workspace-1",
      branchName: "parallel/session-b",
      baseRef: "main",
      baseCommit: "abc123",
      headCommit: "def456",
      lifecycleStatus: "active",
      promotedAt: null,
      removedAt: null,
      createdAt: "2026-04-23T09:01:00.000Z",
      updatedAt: "2026-04-23T09:01:00.000Z"
    });

    expect(groupRepository.findById("group-1")).toMatchObject({
      id: "group-1",
      anchorSessionId: "session-a",
      requestedCount: 2
    });
    expect(memberRepository.listByGroupId("group-1").map((item) => item.sessionId)).toEqual([
      "session-a",
      "session-b"
    ]);
    expect(memberRepository.listByGroupIds(["group-1"]).map((item) => item.ordinal)).toEqual([0, 1]);
    expect(isolatedWorkspaceRepository.findByOwnerSessionId("session-b")).toMatchObject({
      id: "isolated-1",
      workspaceId: "workspace-2",
      lifecycleStatus: "active"
    });

    database.close();
  });

  it("重开数据库后仍然可以恢复并行组关系", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "codingns-parallel-repo-"));
    tempDirs.push(tempDir);
    const databasePath = join(tempDir, "host.sqlite");

    const firstDatabase = createDatabaseClient(databasePath);
    seedUser(firstDatabase.db, "user-1");
    seedWorkspace(firstDatabase.db, "workspace-1", join(tempDir, "workspace-1"));
    const firstGroupRepository = new ParallelSessionGroupRepository(firstDatabase.db);
    const firstMemberRepository = new ParallelSessionMemberRepository(firstDatabase.db);

    firstGroupRepository.create({
      id: "group-1",
      workspaceId: "workspace-1",
      sourceType: "new",
      sourceSessionId: null,
      sourceMessageId: null,
      sharedPrompt: "同题并行",
      requestedCount: 2,
      anchorSessionId: "session-a",
      status: "active",
      createdByUserId: "user-1",
      createdAt: "2026-04-23T10:00:00.000Z",
      updatedAt: "2026-04-23T10:00:00.000Z",
      deletedAt: null
    });
    firstMemberRepository.create({
      groupId: "group-1",
      sessionId: "session-a",
      ordinal: 0,
      role: "anchor",
      provider: "codex",
      model: null,
      memberPrompt: null,
      workspaceIsolationMode: "none",
      temporaryWorkspaceId: null,
      createdAt: "2026-04-23T10:00:10.000Z",
      updatedAt: "2026-04-23T10:00:10.000Z",
      deletedAt: null
    });
    firstDatabase.close();

    const secondDatabase = createDatabaseClient(databasePath);
    const secondGroupRepository = new ParallelSessionGroupRepository(secondDatabase.db);
    const secondMemberRepository = new ParallelSessionMemberRepository(secondDatabase.db);

    expect(secondGroupRepository.findById("group-1")).toMatchObject({
      id: "group-1",
      sourceType: "new",
      anchorSessionId: "session-a"
    });
    expect(secondMemberRepository.findBySessionId("session-a")).toMatchObject({
      groupId: "group-1",
      role: "anchor"
    });

    secondDatabase.close();
  });
});

function seedUser(db: ReturnType<typeof createDatabaseClient>["db"], userId: string): void {
  db.prepare(
    `INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    userId,
    "hash",
    "admin",
    "2026-04-23T08:00:00.000Z",
    "2026-04-23T08:00:00.000Z"
  );
}

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
    "2026-04-23T08:00:00.000Z",
    "2026-04-23T08:00:00.000Z",
    null
  );
}
