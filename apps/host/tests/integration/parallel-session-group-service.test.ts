import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveHostConfig } from "../../src/config/env.js";
import { ParallelSessionGroupService } from "../../src/modules/parallel-sessions/parallel-session-group-service.js";
import { ParallelSessionGroupRepository } from "../../src/storage/repositories/parallel-session-group-repository.js";
import { ParallelSessionMemberRepository } from "../../src/storage/repositories/parallel-session-member-repository.js";
import { SessionIsolatedWorkspaceRepository } from "../../src/storage/repositories/session-isolated-workspace-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";
import type { SessionListItem } from "../../src/types/domain.js";

const tempDirs: string[] = [];

describe("ParallelSessionGroupService", () => {
  afterEach(() => {
    vi.restoreAllMocks();

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();

      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("可以从工作区创建并行组，并保持成员都是根会话", async () => {
    const harness = createHarness();
    const result = await harness.service.createFromWorkspace({
      workspaceId: "workspace-1",
      sharedPrompt: "同一个问题，分别给三种方向",
      permissionMode: "bypassPermissions",
      members: [
        {
          provider: "codex",
          model: "gpt-5.1",
          providerConfigMode: "cc-switch-preset",
          providerPresetId: "preset-team-a"
        },
        { provider: "claude-code", model: "sonnet-4" }
      ],
      userId: "user-1"
    });

    expect(result.group.sourceType).toBe("new");
    expect(result.group.anchorSessionId).toBe("session-1");
    expect(result.members).toHaveLength(2);
    expect(result.members.map((item) => item.member.role)).toEqual(["anchor", "member"]);
    expect(result.members.map((item) => item.session.parentSessionId)).toEqual([null, null]);
    expect(harness.startLiveSessionMock).toHaveBeenCalledTimes(2);
    expect(harness.startLiveSessionMock.mock.calls.map(([input]) => input.runtimeOptions?.model)).toEqual([
      "gpt-5.1",
      "sonnet-4"
    ]);
    expect(harness.startLiveSessionMock.mock.calls[0]?.[0].providerConfigMode).toBe("cc-switch-preset");
    expect(harness.startLiveSessionMock.mock.calls[0]?.[0].providerPresetId).toBe("preset-team-a");
    expect(
      harness.startLiveSessionMock.mock.calls.map(([input]) => input.runtimeOptions?.permissionMode)
    ).toEqual(["bypassPermissions", "bypassPermissions"]);
    expect(
      harness.memberRepository.listByGroupId(result.group.id).map((item) => item.sessionId)
    ).toEqual(["session-1", "session-2"]);
  });

  it("从现有会话创建并行组时会保留真实 fork 关系，并记录失败项而不伪造成员", async () => {
    const harness = createHarness();
    harness.forkSessionMock
      .mockImplementationOnce(async ({ targetProvider }) => {
        const session = buildSession({
          sessionId: "fork-1",
          workspaceId: "workspace-1",
          provider: targetProvider ?? "codex",
          parentSessionId: "source-session"
        });
        harness.sessions.set(session.sessionId, session);
        return session;
      })
      .mockImplementationOnce(async () => {
        throw new Error("fork failed");
      })
      .mockImplementationOnce(async ({ targetProvider }) => {
        const session = buildSession({
          sessionId: "fork-2",
          workspaceId: "workspace-1",
          provider: targetProvider ?? "claude-code",
          parentSessionId: "source-session"
        });
        harness.sessions.set(session.sessionId, session);
        return session;
      });

    const result = await harness.service.createFromSession({
      sourceSessionId: "source-session",
      sourceMessageId: "msg-1",
      sharedPrompt: "在分叉后继续推进这个问题",
      permissionMode: "acceptEdits",
      members: [
        {
          provider: "codex",
          model: "gpt-5.1",
          providerConfigMode: "cc-switch-preset",
          providerPresetId: "preset-team-a"
        },
        { provider: "claude-code", model: "sonnet-4" },
        { provider: "opencode", model: "open-1" }
      ],
      userId: "user-1"
    });

    expect(result.group.sourceType).toBe("fork");
    expect(result.group.sourceSessionId).toBe("source-session");
    expect(result.members).toHaveLength(2);
    expect(result.memberFailures).toHaveLength(1);
    expect(result.memberFailures[0]).toMatchObject({
      ordinal: 1,
      errorCode: "PARALLEL_MEMBER_CREATE_FAILED"
    });
    expect(result.members.map((item) => item.session.parentSessionId)).toEqual([
      "source-session",
      "source-session"
    ]);
    expect(harness.sendLiveMessageMock).toHaveBeenCalledTimes(2);
    expect(harness.sendLiveMessageMock.mock.calls.map(([input]) => input.runtimeOptions?.model)).toEqual([
      "gpt-5.1",
      "open-1"
    ]);
    expect(harness.sendLiveMessageMock.mock.calls[0]?.[0].providerConfigMode).toBe("cc-switch-preset");
    expect(harness.sendLiveMessageMock.mock.calls[0]?.[0].providerPresetId).toBe("preset-team-a");
    expect(
      harness.sendLiveMessageMock.mock.calls.map(([input]) => input.runtimeOptions?.permissionMode)
    ).toEqual(["acceptEdits", "acceptEdits"]);
    expect(
      harness.memberRepository.listByGroupId(result.group.id).map((item) => item.sessionId)
    ).toEqual(["fork-1", "fork-2"]);
  });

  it("锚点成员删除后会自动重选，下一个成员顶上", async () => {
    const harness = createHarness();
    harness.groupRepository.create({
      id: "group-1",
      workspaceId: "workspace-1",
      sourceType: "new",
      sourceSessionId: null,
      sourceMessageId: null,
      sharedPrompt: "test",
      requestedCount: 2,
      anchorSessionId: "session-1",
      status: "active",
      createdByUserId: "user-1",
      createdAt: "2026-04-23T10:00:00.000Z",
      updatedAt: "2026-04-23T10:00:00.000Z",
      deletedAt: null
    });
    harness.memberRepository.create({
      groupId: "group-1",
      sessionId: "session-1",
      ordinal: 0,
      role: "anchor",
      provider: "codex",
      model: null,
      memberPrompt: null,
      workspaceIsolationMode: "none",
      temporaryWorkspaceId: null,
      createdAt: "2026-04-23T10:00:01.000Z",
      updatedAt: "2026-04-23T10:00:01.000Z",
      deletedAt: null
    });
    harness.memberRepository.create({
      groupId: "group-1",
      sessionId: "session-2",
      ordinal: 1,
      role: "member",
      provider: "claude-code",
      model: null,
      memberPrompt: null,
      workspaceIsolationMode: "none",
      temporaryWorkspaceId: null,
      createdAt: "2026-04-23T10:00:02.000Z",
      updatedAt: "2026-04-23T10:00:02.000Z",
      deletedAt: null
    });

    await harness.deleteObserver({
      sessionId: "session-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      remainingWorkspaceSessionCount: 1
    });

    expect(harness.groupRepository.findById("group-1")?.anchorSessionId).toBe("session-2");
    expect(harness.memberRepository.findBySessionId("session-1")?.deletedAt).not.toBeNull();
    expect(harness.memberRepository.findBySessionId("session-2")?.role).toBe("anchor");
  });

  it("创建启用隔离的并行成员时，会把临时工作区记录回填到成员上", async () => {
    const harness = createHarness();
    const result = await harness.service.createFromWorkspace({
      workspaceId: "workspace-1",
      sharedPrompt: "分别给出两种实现方案",
      members: [
        { provider: "codex", workspaceIsolationMode: "temporary_worktree" },
        { provider: "claude-code", workspaceIsolationMode: "none" }
      ],
      userId: "user-1"
    });

    expect(result.members).toHaveLength(2);
    expect(result.members[0]?.sessionIsolatedWorkspace?.id).toBe("isolated-1");
    expect(result.members[0]?.member.temporaryWorkspaceId).toBe("isolated-1");
    expect(result.members[1]?.sessionIsolatedWorkspace).toBeNull();
    expect(harness.createIsolatedWorkspaceForMemberMock).toHaveBeenCalledTimes(1);
    expect(harness.memberRepository.findBySessionId("session-1")?.temporaryWorkspaceId).toBe("isolated-1");
  });

  it("可以给已有并行组追加成员，并沿用原始来源继续创建", async () => {
    const harness = createHarness();
    harness.forkSessionMock.mockImplementationOnce(async ({ targetProvider, sourceMessageId }) => {
      expect(sourceMessageId).toBe("msg-1");
      const session = buildSession({
        sessionId: "fork-3",
        workspaceId: "workspace-1",
        provider: targetProvider ?? "opencode",
        parentSessionId: "source-session"
      });
      harness.sessions.set(session.sessionId, session);
      return session;
    });

    harness.groupRepository.create({
      id: "group-append",
      workspaceId: "workspace-1",
      sourceType: "fork",
      sourceSessionId: "source-session",
      sourceMessageId: "msg-1",
      sharedPrompt: "继续从同一个用户问题出发",
      requestedCount: 2,
      anchorSessionId: "fork-1",
      status: "active",
      createdByUserId: "user-1",
      createdAt: "2026-04-23T10:00:00.000Z",
      updatedAt: "2026-04-23T10:00:00.000Z",
      deletedAt: null
    });
    harness.sessions.set(
      "fork-1",
      buildSession({
        sessionId: "fork-1",
        workspaceId: "workspace-1",
        provider: "codex",
        parentSessionId: "source-session"
      })
    );
    harness.sessions.set(
      "fork-2",
      buildSession({
        sessionId: "fork-2",
        workspaceId: "workspace-1",
        provider: "claude-code",
        parentSessionId: "source-session"
      })
    );
    harness.memberRepository.create({
      groupId: "group-append",
      sessionId: "fork-1",
      ordinal: 0,
      role: "anchor",
      provider: "codex",
      model: null,
      memberPrompt: "先看结构",
      workspaceIsolationMode: "none",
      temporaryWorkspaceId: null,
      createdAt: "2026-04-23T10:00:01.000Z",
      updatedAt: "2026-04-23T10:00:01.000Z",
      deletedAt: null
    });
    harness.memberRepository.create({
      groupId: "group-append",
      sessionId: "fork-2",
      ordinal: 1,
      role: "member",
      provider: "claude-code",
      model: null,
      memberPrompt: "再看样式",
      workspaceIsolationMode: "none",
      temporaryWorkspaceId: null,
      createdAt: "2026-04-23T10:00:02.000Z",
      updatedAt: "2026-04-23T10:00:02.000Z",
      deletedAt: null
    });

    const result = await harness.service.appendMembers({
      groupId: "group-append",
      members: [
        { provider: "opencode", model: "open-1", memberPrompt: "补一个偏工程化方案" }
      ],
      userId: "user-1"
    });

    expect(result.group.requestedCount).toBe(3);
    expect(result.group.anchorSessionId).toBe("fork-1");
    expect(result.members).toHaveLength(3);
    expect(result.members.map((item) => item.member.role)).toEqual(["anchor", "member", "member"]);
    expect(result.members[2]?.member.ordinal).toBe(2);
    expect(result.members[2]?.session.sessionId).toBe("fork-3");
    expect(harness.sendLiveMessageMock).toHaveBeenCalledTimes(1);
    expect(harness.sendLiveMessageMock.mock.calls[0]?.[0].runtimeOptions?.model).toBe("open-1");
  });

  it("追加成员时不能超过并行上限", async () => {
    const harness = createHarness();
    harness.groupRepository.create({
      id: "group-full",
      workspaceId: "workspace-1",
      sourceType: "new",
      sourceSessionId: null,
      sourceMessageId: null,
      sharedPrompt: "保持同题并行",
      requestedCount: 4,
      anchorSessionId: "session-full-1",
      status: "active",
      createdByUserId: "user-1",
      createdAt: "2026-04-23T10:00:00.000Z",
      updatedAt: "2026-04-23T10:00:00.000Z",
      deletedAt: null
    });

    for (const [index, provider] of ["codex", "claude-code", "opencode", "codex"].entries()) {
      const sessionId = `session-full-${index + 1}`;
      harness.sessions.set(
        sessionId,
        buildSession({
          sessionId,
          workspaceId: "workspace-1",
          provider: provider as SessionListItem["provider"],
          parentSessionId: null
        })
      );
      harness.memberRepository.create({
        groupId: "group-full",
        sessionId,
        ordinal: index,
        role: index === 0 ? "anchor" : "member",
        provider: provider as SessionListItem["provider"],
        model: null,
        memberPrompt: null,
        workspaceIsolationMode: "none",
        temporaryWorkspaceId: null,
        createdAt: "2026-04-23T10:00:01.000Z",
        updatedAt: "2026-04-23T10:00:01.000Z",
        deletedAt: null
      });
    }

    await expect(
      harness.service.appendMembers({
        groupId: "group-full",
        members: [{ provider: "codex" }],
        userId: "user-1"
      })
    ).rejects.toMatchObject({
      errorCode: "INVALID_INPUT"
    });
  });
});

function createHarness() {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-parallel-service-"));
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

  resolveHostConfig({
    databasePath: ":memory:",
    claudeCodeHomeDir,
    codexHomeDir,
    geminiHomeDir,
    kimiHomeDir,
    opencodeDataDir,
    opencodeDbPath: join(opencodeDataDir, "opencode.db")
  });
  const database = createDatabaseClient(":memory:");
  seedUser(database.db, "user-1");
  seedWorkspace(database.db, "workspace-1", workspacePath);

  const groupRepository = new ParallelSessionGroupRepository(database.db);
  const memberRepository = new ParallelSessionMemberRepository(database.db);
  const isolatedWorkspaceRepository = new SessionIsolatedWorkspaceRepository(database.db);
  const sessions = new Map<string, SessionListItem>();
  let sessionSequence = 0;
  let deleteObserver: Parameters<
    Pick<{ registerSessionDeletedObserver: (observer: (input: unknown) => unknown) => void }, "registerSessionDeletedObserver">["registerSessionDeletedObserver"]
  >[0] = () => {
    return;
  };
  const forkSessionMock = vi.fn();
  const startLiveSessionMock = vi.fn(async (input: {
    workspaceId: string;
    provider: string;
    providerConfigMode?: "global-default" | "cc-switch-preset";
    providerPresetId?: string | null;
    runtimeOptions?: { model?: string | null; permissionMode?: string | null };
  }) => {
    sessionSequence += 1;
    const session = buildSession({
      sessionId: `session-${sessionSequence}`,
      workspaceId: input.workspaceId,
      provider: input.provider,
      parentSessionId: null
    });
    sessions.set(session.sessionId, session);
    return {
      sessionId: session.sessionId,
      provider: session.provider,
      providerSessionId: session.providerSessionId,
      acceptedAt: session.createdAt,
      clientRequestId: null,
      message: {
        messageId: `msg-${session.sessionId}`,
        provider: session.provider,
        providerSessionId: session.providerSessionId,
        role: "user",
        kind: "text",
        content: "hello",
        timestamp: session.createdAt,
        sequence: 1,
        rawRef: session.rawStoreRef
      },
      session
    };
  });
  const sendLiveMessageMock = vi.fn(async (_input?: {
    providerConfigMode?: "global-default" | "cc-switch-preset";
    providerPresetId?: string | null;
    runtimeOptions?: { model?: string | null; permissionMode?: string | null };
  }) => ({
    acceptedAt: "2026-04-23T10:00:00.000Z"
  }));
  const createIsolatedWorkspaceForMemberMock = vi.fn(async (input: {
    groupId: string;
    sourceWorkspaceId: string;
    createSession: (workspaceId: string) => Promise<SessionListItem>;
  }) => {
    const workspaceId = `isolated-workspace-${createIsolatedWorkspaceForMemberMock.mock.calls.length + 1}`;
    seedWorkspace(database.db, workspaceId, join(rootDir, workspaceId));
    const session = await input.createSession(workspaceId);
    const record = isolatedWorkspaceRepository.create({
      id: `isolated-${createIsolatedWorkspaceForMemberMock.mock.calls.length}`,
      groupId: input.groupId,
      ownerSessionId: session.sessionId,
      workspaceId,
      sourceWorkspaceId: input.sourceWorkspaceId,
      branchName: `parallel/test-${createIsolatedWorkspaceForMemberMock.mock.calls.length}`,
      baseRef: "main",
      baseCommit: "commit-1",
      headCommit: "commit-1",
      lifecycleStatus: "active",
      promotedAt: null,
      removedAt: null,
      createdAt: "2026-04-23T10:00:00.000Z",
      updatedAt: "2026-04-23T10:00:00.000Z"
    });

    return {
      session,
      workspace: {
        id: workspaceId,
        name: workspaceId,
        path: `/tmp/${workspaceId}`,
        repoRoot: `/tmp/${workspaceId}`,
        favorite: false,
        sortOrder: 0,
        createdAt: "2026-04-23T10:00:00.000Z",
        updatedAt: "2026-04-23T10:00:00.000Z",
        removedAt: null
      },
      record
    };
  });
  const cleanupByOwnerSessionIdMock = vi.fn(async () => null);
  const promoteIsolatedWorkspaceMock = vi.fn();

  sessions.set(
    "source-session",
    buildSession({
      sessionId: "source-session",
      workspaceId: "workspace-1",
      provider: "codex",
      parentSessionId: null
    })
  );

  const service = new ParallelSessionGroupService(
    groupRepository,
    memberRepository,
    isolatedWorkspaceRepository,
    {
      getSession: (sessionId: string) => {
        const session = sessions.get(sessionId);

        if (!session) {
          throw new Error(`missing session: ${sessionId}`);
        }

        return session;
      },
      forkSession: forkSessionMock,
      deleteSession: async (sessionId: string, userId: string) => {
        sessions.delete(sessionId);
        await deleteObserver({
          sessionId,
          userId,
          workspaceId: "workspace-1",
          remainingWorkspaceSessionCount: [...sessions.values()]
            .filter((session) => session.workspaceId === "workspace-1").length
        });
      },
      registerSessionDeletedObserver: (observer) => {
        deleteObserver = observer;
        return {
          close() {
            return;
          }
        };
      }
    } as never,
    {
      startLiveSession: startLiveSessionMock,
      sendLiveMessage: sendLiveMessageMock
    } as never,
    {
      createForMember: createIsolatedWorkspaceForMemberMock,
      cleanupByOwnerSessionId: cleanupByOwnerSessionIdMock,
      promote: promoteIsolatedWorkspaceMock
    } as never
  );

  return {
    service,
    sessions,
    groupRepository,
    memberRepository,
    forkSessionMock,
    startLiveSessionMock,
    sendLiveMessageMock,
    createIsolatedWorkspaceForMemberMock,
    cleanupByOwnerSessionIdMock,
    get deleteObserver() {
      return deleteObserver;
    }
  };
}

function buildSession(input: {
  sessionId: string;
  workspaceId: string;
  provider: SessionListItem["provider"];
  parentSessionId: string | null;
}): SessionListItem {
  return {
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    provider: input.provider,
    providerSessionId: `${input.sessionId}-provider`,
    rawStoreRef: `/tmp/${input.sessionId}.jsonl`,
    parentSessionId: input.parentSessionId,
    sessionKind: "default",
    annotationSourceMessageId: null,
    annotationSourceText: null,
    forkMethod: input.parentSessionId ? "native_session_fork" : null,
    forkSourceType: input.parentSessionId ? "session" : null,
    forkSourceSessionId: input.parentSessionId,
    forkSourceMessageId: null,
    inheritedPrefixMessageCount: null,
    isSubagent: false,
    subagentLabel: null,
    isArchived: false,
    isFavorite: false,
    title: input.sessionId,
    messageCount: 1,
    lastMessageAt: "2026-04-23T10:00:00.000Z",
    createdAt: "2026-04-23T10:00:00.000Z",
    updatedAt: "2026-04-23T10:00:00.000Z",
    syncStatus: "idle",
    syncCursor: null,
    lastSyncAt: "2026-04-23T10:00:00.000Z",
    lastErrorCode: null,
    lastErrorDetail: null,
    resumedAt: null,
    runningState: "idle",
    activitySource: "none",
    lastEventAt: null,
    completedAt: null,
    lastSeenAt: null,
    activityState: "idle",
    parallelGroup: null,
    displayParentSessionId: null,
    sessionIsolatedWorkspace: null
  };
}

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
