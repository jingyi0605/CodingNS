import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveHostConfig } from "../../src/config/env.js";
import { SessionChangedFileService } from "../../src/modules/sessions/session-changed-file-service.js";
import { SessionHistoryService } from "../../src/modules/sessions/session-history-service.js";
import { SessionMessageAttachmentService } from "../../src/modules/sessions/session-message-attachment-service.js";
import { WorkbenchService } from "../../src/modules/workbench/workbench-service.js";
import { ParallelSessionGroupRepository } from "../../src/storage/repositories/parallel-session-group-repository.js";
import { ParallelSessionMemberRepository } from "../../src/storage/repositories/parallel-session-member-repository.js";
import { SessionBindingRepository } from "../../src/storage/repositories/session-binding-repository.js";
import { SessionChangedFileRepository } from "../../src/storage/repositories/session-changed-file-repository.js";
import { SessionForkRepository } from "../../src/storage/repositories/session-fork-repository.js";
import { SessionIndexRepository } from "../../src/storage/repositories/session-index-repository.js";
import { SessionIsolatedWorkspaceRepository } from "../../src/storage/repositories/session-isolated-workspace-repository.js";
import { SessionMessageAttachmentRepository } from "../../src/storage/repositories/session-message-attachment-repository.js";
import { SessionStateRepository } from "../../src/storage/repositories/session-state-repository.js";
import { SessionStatusSnapshotRepository } from "../../src/storage/repositories/session-status-snapshot-repository.js";
import { WorkspaceNavigationStateRepository } from "../../src/storage/repositories/workspace-navigation-state-repository.js";
import { WorkspaceRepository } from "../../src/storage/repositories/workspace-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

describe("并行会话 DTO 投影", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();

      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("SessionHistoryService 和 WorkbenchService 会补并行投影字段，但不改真实 parentSessionId", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "codingns-parallel-projection-"));
    tempDirs.push(rootDir);
    const workspacePath = join(rootDir, "workspace");
    const claudeCodeHomeDir = join(rootDir, "claude-home");
    const codexHomeDir = join(rootDir, "codex-home");
    const geminiHomeDir = join(rootDir, "gemini-home");
    const kimiHomeDir = join(rootDir, "kimi-home");
    const opencodeDataDir = join(rootDir, "opencode-data");

    [
      workspacePath,
      claudeCodeHomeDir,
      codexHomeDir,
      geminiHomeDir,
      kimiHomeDir,
      opencodeDataDir
    ].forEach((dir) => mkdirSync(dir, { recursive: true }));

    const config = resolveHostConfig({
      databasePath: ":memory:",
      claudeCodeHomeDir,
      codexHomeDir,
      geminiHomeDir,
      kimiHomeDir,
      opencodeDataDir,
      opencodeDbPath: join(opencodeDataDir, "opencode.db")
    });
    const database = createDatabaseClient(":memory:");
    const workspaceRepository = new WorkspaceRepository(database.db);
    const workspaceNavigationStateRepository = new WorkspaceNavigationStateRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionStateRepository = new SessionStateRepository(database.db);
    const sessionStatusSnapshotRepository = new SessionStatusSnapshotRepository(database.db);
    const parallelSessionGroupRepository = new ParallelSessionGroupRepository(database.db);
    const parallelSessionMemberRepository = new ParallelSessionMemberRepository(database.db);
    const sessionIsolatedWorkspaceRepository = new SessionIsolatedWorkspaceRepository(database.db);

    seedUser(database.db, "user-1");
    workspaceRepository.create({
      id: "workspace-1",
      name: "Workspace 1",
      path: workspacePath,
      repoRoot: workspacePath,
      favorite: false,
      createdAt: "2026-04-23T09:00:00.000Z",
      updatedAt: "2026-04-23T09:00:00.000Z",
      removedAt: null
    });
    workspaceRepository.create({
      id: "workspace-isolated",
      name: "Workspace Isolated",
      path: join(rootDir, "workspace-isolated"),
      repoRoot: join(rootDir, "workspace-isolated"),
      favorite: false,
      createdAt: "2026-04-23T09:05:00.000Z",
      updatedAt: "2026-04-23T09:05:00.000Z",
      removedAt: null
    });
    seedSession(database.db, {
      sessionId: "source-session",
      workspaceId: "workspace-1",
      provider: "codex",
      parentSessionId: null,
      title: "源会话"
    });
    seedSession(database.db, {
      sessionId: "parallel-a",
      workspaceId: "workspace-1",
      provider: "codex",
      parentSessionId: "source-session",
      title: "并行 A"
    });
    seedSession(database.db, {
      sessionId: "parallel-b",
      workspaceId: "workspace-1",
      provider: "claude-code",
      parentSessionId: "source-session",
      title: "并行 B"
    });
    seedSession(database.db, {
      sessionId: "parallel-isolated",
      workspaceId: "workspace-isolated",
      provider: "codex",
      parentSessionId: "source-session",
      title: "并行隔离"
    });

    parallelSessionGroupRepository.create({
      id: "group-1",
      workspaceId: "workspace-1",
      sourceType: "fork",
      sourceSessionId: "source-session",
      sourceMessageId: "msg-1",
      sharedPrompt: "继续讨论",
      requestedCount: 2,
      anchorSessionId: "parallel-a",
      status: "active",
      createdByUserId: "user-1",
      createdAt: "2026-04-23T09:10:00.000Z",
      updatedAt: "2026-04-23T09:10:00.000Z",
      deletedAt: null
    });
    parallelSessionMemberRepository.create({
      groupId: "group-1",
      sessionId: "parallel-a",
      ordinal: 0,
      role: "anchor",
      provider: "codex",
      model: "gpt-5.1",
      memberPrompt: null,
      workspaceIsolationMode: "none",
      temporaryWorkspaceId: null,
      createdAt: "2026-04-23T09:10:01.000Z",
      updatedAt: "2026-04-23T09:10:01.000Z",
      deletedAt: null
    });
    parallelSessionMemberRepository.create({
      groupId: "group-1",
      sessionId: "parallel-b",
      ordinal: 1,
      role: "member",
      provider: "claude-code",
      model: null,
      memberPrompt: null,
      workspaceIsolationMode: "none",
      temporaryWorkspaceId: null,
      createdAt: "2026-04-23T09:10:02.000Z",
      updatedAt: "2026-04-23T09:10:02.000Z",
      deletedAt: null
    });
    parallelSessionMemberRepository.create({
      groupId: "group-1",
      sessionId: "parallel-isolated",
      ordinal: 2,
      role: "member",
      provider: "codex",
      model: null,
      memberPrompt: null,
      workspaceIsolationMode: "temporary_worktree",
      temporaryWorkspaceId: "isolated-1",
      createdAt: "2026-04-23T09:10:03.000Z",
      updatedAt: "2026-04-23T09:10:03.000Z",
      deletedAt: null
    });
    sessionIsolatedWorkspaceRepository.create({
      id: "isolated-1",
      groupId: "group-1",
      ownerSessionId: "parallel-isolated",
      workspaceId: "workspace-isolated",
      sourceWorkspaceId: "workspace-1",
      branchName: "parallel/group-1/isolated",
      baseRef: "main",
      baseCommit: "abc123",
      headCommit: "abc123",
      lifecycleStatus: "active",
      promotedAt: null,
      removedAt: null,
      createdAt: "2026-04-23T09:10:03.000Z",
      updatedAt: "2026-04-23T09:10:03.000Z"
    });

    const sessionHistoryService = new SessionHistoryService(
      database.db,
      workspaceRepository,
      sessionBindingRepository,
      new SessionChangedFileService(new SessionChangedFileRepository(database.db)),
      sessionIndexRepository,
      new SessionMessageAttachmentService(new SessionMessageAttachmentRepository(database.db), config),
      sessionStateRepository,
      sessionStatusSnapshotRepository,
      config,
      undefined,
      null,
      new SessionForkRepository(database.db),
      {},
      undefined,
      parallelSessionGroupRepository,
      parallelSessionMemberRepository,
      sessionIsolatedWorkspaceRepository
    );

    const sessions = sessionHistoryService.listWorkspaceSessions("workspace-1", "user-1");
    const anchor = sessions.find((item) => item.sessionId === "parallel-a");
    const member = sessions.find((item) => item.sessionId === "parallel-b");
    const isolated = sessions.find((item) => item.sessionId === "parallel-isolated");

    expect(anchor?.parentSessionId).toBe("source-session");
    expect(anchor?.parallelGroup).toMatchObject({
      groupId: "group-1",
      role: "anchor",
      memberCount: 3
    });
    expect(anchor?.displayParentSessionId).toBe("source-session");
    expect(member?.parentSessionId).toBe("source-session");
    expect(member?.displayParentSessionId).toBe("parallel-a");
    expect(isolated?.workspaceId).toBe("workspace-isolated");
    expect(isolated?.sessionIsolatedWorkspace?.workspaceId).toBe("workspace-isolated");
    expect(isolated?.sessionIsolatedWorkspace?.sourceWorkspaceId).toBe("workspace-1");

    const workbenchService = new WorkbenchService(
      workspaceRepository,
      workspaceNavigationStateRepository,
      sessionHistoryService,
      {
        getProfile: vi.fn(() => null)
      } as never,
      {
        listSessionIds: vi.fn(() => [])
      } as never,
      undefined,
      undefined,
      sessionIsolatedWorkspaceRepository
    );
    const snapshot = workbenchService.getSnapshot("user-1");
    const projectedMember = snapshot.items[0]?.sessions.find((item) => item.sessionId === "parallel-b");
    const projectedIsolated = snapshot.items[0]?.sessions.find(
      (item) => item.sessionId === "parallel-isolated"
    );

    expect(projectedMember?.parallelGroup?.groupId).toBe("group-1");
    expect(projectedMember?.displayParentSessionId).toBe("parallel-a");
    expect(snapshot.items).toHaveLength(1);
    expect(projectedIsolated?.workspaceId).toBe("workspace-isolated");
    expect(projectedIsolated?.sessionIsolatedWorkspace?.sourceWorkspaceId).toBe("workspace-1");

    database.close();
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

function seedSession(
  db: ReturnType<typeof createDatabaseClient>["db"],
  input: {
    sessionId: string;
    workspaceId: string;
    provider: string;
    parentSessionId: string | null;
    title: string;
  }
): void {
  db.prepare(
    `INSERT INTO session_bindings (
       session_id,
       workspace_id,
       provider,
       provider_session_id,
       raw_store_ref,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.sessionId,
    input.workspaceId,
    input.provider,
    `${input.sessionId}-provider`,
    `/tmp/${input.sessionId}.jsonl`,
    "2026-04-23T09:00:00.000Z",
    "2026-04-23T09:00:00.000Z"
  );
  db.prepare(
    `INSERT INTO session_indices (
       session_id,
       workspace_id,
       provider,
       parent_session_id,
       session_kind,
       annotation_source_message_id,
       annotation_source_text,
       is_subagent,
       subagent_label,
       title,
       message_count,
       is_archived,
       last_message_at,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.sessionId,
    input.workspaceId,
    input.provider,
    input.parentSessionId,
    "default",
    null,
    null,
    0,
    null,
    input.title,
    1,
    0,
    "2026-04-23T09:00:00.000Z",
    "2026-04-23T09:00:00.000Z",
    "2026-04-23T09:00:00.000Z"
  );
  db.prepare(
    `INSERT INTO session_states (
       session_id,
       user_id,
       running_state,
       activity_source,
       favorite,
       last_event_at,
       completed_at,
       last_seen_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.sessionId,
    "user-1",
    "idle",
    "none",
    0,
    null,
    null,
    null,
    "2026-04-23T09:00:00.000Z"
  );
  db.prepare(
    `INSERT INTO session_status_snapshots (
       session_id,
       sync_status,
       sync_cursor,
       last_sync_at,
       last_error_code,
       last_error_detail,
       resumed_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.sessionId,
    "idle",
    null,
    "2026-04-23T09:00:00.000Z",
    null,
    null,
    null,
    "2026-04-23T09:00:00.000Z"
  );
}
