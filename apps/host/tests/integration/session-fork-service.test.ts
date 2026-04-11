import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type CodexForkTransport
} from "@codingns/session-sync-core";

import { resolveHostConfig } from "../../src/config/env.js";
import { SessionActivityAuthorityService } from "../../src/modules/sessions/session-activity-authority-service.js";
import { SessionChangedFileService } from "../../src/modules/sessions/session-changed-file-service.js";
import { SessionHistoryService } from "../../src/modules/sessions/session-history-service.js";
import { SessionMessageAttachmentService } from "../../src/modules/sessions/session-message-attachment-service.js";
import { AppError } from "../../src/shared/errors/app-error.js";
import { SessionBindingRepository } from "../../src/storage/repositories/session-binding-repository.js";
import { SessionChangedFileRepository } from "../../src/storage/repositories/session-changed-file-repository.js";
import { SessionIndexRepository } from "../../src/storage/repositories/session-index-repository.js";
import { SessionMessageAttachmentRepository } from "../../src/storage/repositories/session-message-attachment-repository.js";
import { SessionForkRepository } from "../../src/storage/repositories/session-fork-repository.js";
import { SessionStateRepository } from "../../src/storage/repositories/session-state-repository.js";
import { SessionStatusSnapshotRepository } from "../../src/storage/repositories/session-status-snapshot-repository.js";
import { WorkspaceRepository } from "../../src/storage/repositories/workspace-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

import {
  createEmptyFixture,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";

const activeFixtures: EmptyFixture[] = [];
const activeClosers: Array<() => void> = [];

afterEach(() => {
  while (activeClosers.length > 0) {
    activeClosers.pop()?.();
  }

  while (activeFixtures.length > 0) {
    const fixture = activeFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }
});

describe("SessionHistoryService forkSession", () => {
  it("会话级 fork 成功后会写入父子关系和 fork 元数据，并允许子会话继续发送消息", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const sourceFile = createCodexSessionFile(
      fixture.codexHomeDir,
      fixture.workspaceDir,
      "source-thread",
      [
        ["user", "父会话第一条"],
        ["assistant", "父会话回复"]
      ]
    );
    const childFile = createCodexSessionFile(
      fixture.codexHomeDir,
      fixture.workspaceDir,
      "child-thread",
      [
        ["user", "父会话第一条"],
        ["assistant", "父会话回复"]
      ]
    );
    let forkCount = 0;
    const transportFactory = vi.fn<() => CodexForkTransport>(() => ({
      initialize: vi.fn(async () => {}),
      forkThread: vi.fn(async () => {
        forkCount += 1;
        return {
        providerSessionId: `child-thread-${forkCount}`,
        rawStoreRef: childFile
      };
      }),
      readThread: vi.fn(async () => ({ history: [] })),
      rollbackThread: vi.fn(async () => ({
        providerSessionId: "child-thread",
        rawStoreRef: childFile
      })),
      resumeThreadFromHistory: vi.fn(async () => ({
        providerSessionId: "unused",
        rawStoreRef: null
      })),
      close: vi.fn()
    }));
    const {
      service,
      sessionForkRepository,
      sessionIndexRepository,
      repos
    } = createSessionHistoryHarness(fixture, transportFactory);

    seedSourceSession(repos, sourceFile, 2);

    const forked = await service.forkSession({
      sessionId: "source-session",
      userId: "user-1",
      sourceType: "session",
      strategy: "auto"
    });

    expect(forked.parentSessionId).toBe("source-session");
    expect(forked.forkMethod).toBe("native_session_fork");
    expect(forked.forkSourceType).toBe("session");
    expect(forked.forkSourceMessageId).toBeNull();
    expect(sessionIndexRepository.findIndexRecordBySessionId(forked.sessionId)?.parentSessionId).toBe("source-session");
    expect(sessionForkRepository.findBySessionId(forked.sessionId)).toMatchObject({
      sessionId: forked.sessionId,
      parentSessionId: "source-session",
      forkSourceType: "session",
      forkSourceSessionId: "source-session",
      forkSourceMessageId: null,
      inheritedPrefixMessageCount: 2,
      providerParentSessionId: "source-thread",
      forkMethod: "native_session_fork"
    });

    const accepted = await service.sendMessage(forked.sessionId, "子会话继续说话", null);

    expect(accepted.sessionId).toBe(forked.sessionId);
    expect(accepted.message.content).toBe("子会话继续说话");
  });

  it("消息级 fork 成功后会写入消息锚点元数据", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const sourceFile = createCodexSessionFile(
      fixture.codexHomeDir,
      fixture.workspaceDir,
      "source-thread",
      [
        ["user", "第一轮问题"],
        ["assistant", "第一轮回答"],
        ["user", "第二轮问题"]
      ]
    );
    const childFile = createCodexSessionFile(
      fixture.codexHomeDir,
      fixture.workspaceDir,
      "child-message-thread",
      [
        ["user", "第一轮问题"],
        ["assistant", "第一轮回答"]
      ]
    );
    let resumedHistory: unknown[] = [];
    const transportFactory = vi.fn<() => CodexForkTransport>(() => ({
      initialize: vi.fn(async () => {}),
      forkThread: vi.fn(async () => ({
        providerSessionId: "child-message-thread",
        rawStoreRef: childFile
      })),
      readThread: vi.fn(async () => ({
        thread: {
          id: "source-thread",
          turns: [
            {
              id: "turn-1",
              items: [
                {
                  type: "userMessage",
                  id: "item-1",
                  content: [{ type: "input_text", text: "第一轮问题" }]
                },
                {
                  type: "agentMessage",
                  id: "item-2",
                  text: "第一轮回答",
                  phase: "final_answer"
                }
              ]
            },
            {
              id: "turn-2",
              items: [
                {
                  type: "userMessage",
                  id: "item-3",
                  content: [{ type: "input_text", text: "第二轮问题" }]
                }
              ]
            }
          ]
        }
      })),
      rollbackThread: vi.fn(async (providerSessionId, numTurns) => {
        expect(providerSessionId).toBe("child-message-thread");
        expect(numTurns).toBe(1);
        return {
          providerSessionId: "child-message-thread",
          rawStoreRef: childFile
        };
      }),
      resumeThreadFromHistory: vi.fn(async (input) => {
        resumedHistory = input.history;
        return {
          providerSessionId: "child-message-thread",
          rawStoreRef: childFile
        };
      }),
      close: vi.fn()
    }));
    const {
      service,
      sessionForkRepository,
      repos
    } = createSessionHistoryHarness(fixture, transportFactory);

    seedSourceSession(repos, sourceFile, 3);
    const page = await service.readSessionHistory("source-session", null, 50, "forward", "user-1");
    const anchorMessageId = page.messages[1]?.messageId;

    expect(anchorMessageId).toBeTruthy();

    const forked = await service.forkSession({
      sessionId: "source-session",
      userId: "user-1",
      sourceType: "message",
      sourceMessageId: anchorMessageId,
      strategy: "auto"
    });

    expect(resumedHistory).toHaveLength(0);
    expect(forked.parentSessionId).toBe("source-session");
    expect(forked.forkMethod).toBe("native_message_fork");
    expect(forked.forkSourceType).toBe("message");
    expect(forked.forkSourceMessageId).toBe(anchorMessageId);
    expect(sessionForkRepository.findBySessionId(forked.sessionId)).toMatchObject({
      sessionId: forked.sessionId,
      parentSessionId: "source-session",
      forkSourceType: "message",
      forkSourceMessageId: anchorMessageId,
      inheritedPrefixMessageCount: 2,
      providerParentSessionId: "source-thread",
      forkMethod: "native_message_fork"
    });
  });

  it("跨 provider fork 会走重建链路，并把子会话绑定到目标 provider", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const sourceFile = createCodexSessionFile(
      fixture.codexHomeDir,
      fixture.workspaceDir,
      "source-thread",
      [
        ["user", "先整理当前实现的风险点。"],
        ["assistant", "已经列出三类风险。"],
        ["user", "换个 provider 继续拆方案。"]
      ]
    );
    const {
      service,
      sessionForkRepository,
      repos
    } = createSessionHistoryHarness(fixture, () => ({
      initialize: vi.fn(async () => {}),
      forkThread: vi.fn(async () => {
        throw new Error("should not use native transport");
      }),
      readThread: vi.fn(async () => ({ history: [] })),
      rollbackThread: vi.fn(async () => {
        throw new Error("should not use native transport");
      }),
      resumeThreadFromHistory: vi.fn(async () => {
        throw new Error("should not use native transport");
      }),
      close: vi.fn()
    }));

    seedSourceSession(repos, sourceFile, 3);
    const page = await service.readSessionHistory("source-session", null, 50, "forward", "user-1");
    const anchorMessageId = page.messages[1]?.messageId;

    expect(anchorMessageId).toBeTruthy();

    const forked = await service.forkSession({
      sessionId: "source-session",
      userId: "user-1",
      sourceType: "message",
      sourceMessageId: anchorMessageId,
      strategy: "auto",
      targetProvider: "claude-code"
    });

    expect(forked.provider).toBe("claude-code");
    expect(forked.parentSessionId).toBe("source-session");
    expect(forked.forkMethod).toBe("reconstructed_message_fork");
    expect(sessionForkRepository.findBySessionId(forked.sessionId)).toMatchObject({
      sessionId: forked.sessionId,
      parentSessionId: "source-session",
      provider: "claude-code",
      forkSourceType: "message",
      forkSourceMessageId: anchorMessageId,
      inheritedPrefixMessageCount: 2,
      providerParentSessionId: "source-thread",
      forkMethod: "reconstructed_message_fork"
    });

    const accepted = await service.sendMessage(forked.sessionId, "在这条新分支里继续展开。", null);

    expect(accepted.sessionId).toBe(forked.sessionId);
    expect(accepted.message.provider).toBe("claude-code");
    expect(accepted.message.content).toBe("在这条新分支里继续展开。");
  });

  it("workspace discover 刷新后仍会保留 fork 子会话的本地父子关系和标题", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const sourceFile = createCodexSessionFile(
      fixture.codexHomeDir,
      fixture.workspaceDir,
      "source-thread",
      [
        ["user", "父会话问题"],
        ["assistant", "父会话回答"]
      ]
    );
    const childActualFile = createNamedCodexSessionFile(
      fixture.codexHomeDir,
      fixture.workspaceDir,
      "rollout-2026-04-11T11-09-16-019d7a83-e12a-.jsonl",
      "child-thread",
      []
    );
    const transportFactory = vi.fn<() => CodexForkTransport>(() => ({
      initialize: vi.fn(async () => {}),
      forkThread: vi.fn(async () => ({
        providerSessionId: "child-thread",
        rawStoreRef: childActualFile
      })),
      readThread: vi.fn(async () => ({
        thread: {
          id: "source-thread",
          turns: [
            {
              id: "turn-1",
              items: [
                {
                  type: "userMessage",
                  id: "user-item-1",
                  content: [{ type: "text", text: "父会话问题" }]
                },
                {
                  type: "agentMessage",
                  id: "assistant-item-1",
                  text: "父会话回答",
                  phase: "final_answer"
                }
              ]
            }
          ]
        }
      })),
      rollbackThread: vi.fn(async (providerSessionId, numTurns) => {
        expect(providerSessionId).toBe("child-thread");
        expect(numTurns).toBe(0);
        return {
          providerSessionId: "child-thread",
          rawStoreRef: childActualFile
        };
      }),
      resumeThreadFromHistory: vi.fn(async () => ({
        providerSessionId: "child-thread",
        rawStoreRef: path.join(fixture.codexHomeDir, "runtime", "codex", "missing-child.jsonl")
      })),
      close: vi.fn()
    }));
    const {
      service,
      repos
    } = createSessionHistoryHarness(fixture, transportFactory);

    seedSourceSession(repos, sourceFile, 2);
    const page = await service.readSessionHistory("source-session", null, 50, "forward", "user-1");
    const anchorMessageId = page.messages[1]?.messageId;

    expect(anchorMessageId).toBeTruthy();
    expect(childActualFile).toContain("rollout-2026-04-11T11-09-16-019d7a83-e12a-.jsonl");

    const forked = await service.forkSession({
      sessionId: "source-session",
      userId: "user-1",
      sourceType: "message",
      sourceMessageId: anchorMessageId,
      strategy: "auto"
    });

    expect(forked.parentSessionId).toBe("source-session");
    expect(forked.title).toBe("父会话问题");

    vi.spyOn(
      (service as unknown as {
        sessionSyncService: {
          discoverWorkspaceSessions: (
            workspacePath: string,
            options?: unknown
          ) => Promise<{
            sessions: Array<{
              provider: string;
              providerSessionId: string;
              rawStoreRef: string;
              title: string;
              workspacePath: string;
              lastMessageAt: string;
              messageCount: number;
              isArchived: boolean;
              parentProviderSessionId?: string | null;
            }>;
            isComplete: boolean;
          }>;
        };
      }).sessionSyncService,
      "discoverWorkspaceSessions"
    ).mockResolvedValue({
      isComplete: true,
      sessions: [
        {
          provider: "codex",
          providerSessionId: "source-thread",
          rawStoreRef: sourceFile,
          title: "父会话问题",
          workspacePath: fixture.workspaceDir,
          lastMessageAt: "2026-04-10T08:00:10.000Z",
          messageCount: 2,
          isArchived: false,
          parentProviderSessionId: null
        },
        {
          provider: "codex",
          providerSessionId: "child-thread",
          rawStoreRef: childActualFile,
          title: "rollout-2026-04-11T11-09-16-019d7a83-e12a-",
          workspacePath: fixture.workspaceDir,
          lastMessageAt: "2026-04-11T11:09:16.000Z",
          messageCount: 0,
          isArchived: false,
          parentProviderSessionId: null
        }
      ]
    });

    const discovered = await service.discoverWorkspaceSessions("workspace-1", "user-1", {
      force: true
    });
    const discoveredFork = discovered.find((item) => item.sessionId === forked.sessionId);

    expect(discoveredFork).toMatchObject({
      sessionId: forked.sessionId,
      parentSessionId: "source-session",
      forkSourceType: "message",
      title: "父会话问题",
      isSubagent: false
    });

    const accepted = await service.sendMessage(forked.sessionId, "帮我继续改写成正式版本", null);
    const updatedFork = service.getSession(forked.sessionId, "user-1");

    expect(accepted.message.content).toBe("帮我继续改写成正式版本");
    expect(updatedFork.title).toBe("帮我继续改写成正式版本");
  });

  it("fork 会话深度超过 4 级时会拒绝继续分叉", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const sourceFile = createCodexSessionFile(
      fixture.codexHomeDir,
      fixture.workspaceDir,
      "source-thread",
      [
        ["user", "父会话第一条"],
        ["assistant", "父会话回复"]
      ]
    );
    const childFile = createCodexSessionFile(
      fixture.codexHomeDir,
      fixture.workspaceDir,
      "child-thread",
      [
        ["user", "父会话第一条"],
        ["assistant", "父会话回复"]
      ]
    );
    let forkCount = 0;
    const transportFactory = vi.fn<() => CodexForkTransport>(() => ({
      initialize: vi.fn(async () => {}),
      forkThread: vi.fn(async () => {
        forkCount += 1;
        return {
          providerSessionId: `child-thread-${forkCount}`,
          rawStoreRef: childFile
        };
      }),
      readThread: vi.fn(async () => ({ history: [] })),
      rollbackThread: vi.fn(async () => ({
        providerSessionId: `child-thread-${forkCount}`,
        rawStoreRef: childFile
      })),
      resumeThreadFromHistory: vi.fn(async () => ({
        providerSessionId: "unused",
        rawStoreRef: null
      })),
      close: vi.fn()
    }));
    const {
      service,
      repos
    } = createSessionHistoryHarness(fixture, transportFactory);

    seedSourceSession(repos, sourceFile, 2);

    const level2 = await service.forkSession({
      sessionId: "source-session",
      userId: "user-1",
      sourceType: "session",
      strategy: "auto"
    });
    const level3 = await service.forkSession({
      sessionId: level2.sessionId,
      userId: "user-1",
      sourceType: "session",
      strategy: "auto"
    });
    const level4 = await service.forkSession({
      sessionId: level3.sessionId,
      userId: "user-1",
      sourceType: "session",
      strategy: "auto"
    });

    await expect(
      service.forkSession({
        sessionId: level4.sessionId,
        userId: "user-1",
        sourceType: "session",
        strategy: "auto"
      })
    ).rejects.toMatchObject<AppError>({
      statusCode: 409,
      errorCode: "FORK_DEPTH_LIMIT_EXCEEDED"
    });
  });
});

function createSessionHistoryHarness(
  fixture: EmptyFixture,
  codexForkTransportFactory: () => CodexForkTransport
) {
  const config = resolveHostConfig({
    databasePath: ":memory:",
    claudeCodeHomeDir: fixture.claudeHomeDir,
    codexHomeDir: fixture.codexHomeDir,
    geminiHomeDir: fixture.geminiHomeDir,
    kimiHomeDir: fixture.kimiHomeDir
  });
  const database = createDatabaseClient(":memory:");
  activeClosers.push(() => database.close());

  const workspaceRepository = new WorkspaceRepository(database.db);
  const sessionBindingRepository = new SessionBindingRepository(database.db);
  const sessionIndexRepository = new SessionIndexRepository(database.db);
  const sessionStateRepository = new SessionStateRepository(database.db);
  const sessionStatusSnapshotRepository = new SessionStatusSnapshotRepository(database.db);
  const sessionChangedFileRepository = new SessionChangedFileRepository(database.db);
  const sessionChangedFileService = new SessionChangedFileService(sessionChangedFileRepository);
  const sessionMessageAttachmentService = new SessionMessageAttachmentService(
    new SessionMessageAttachmentRepository(database.db),
    config
  );
  const sessionForkRepository = new SessionForkRepository(database.db);
  const service = new SessionHistoryService(
    database.db,
    workspaceRepository,
    sessionBindingRepository,
    sessionChangedFileService,
    sessionIndexRepository,
    sessionMessageAttachmentService,
    sessionStateRepository,
    sessionStatusSnapshotRepository,
    config,
    new SessionActivityAuthorityService(),
    null,
    sessionForkRepository,
    {
      codexForkTransportFactory
    }
  );

  database.db
    .prepare(
      `INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      "user-1",
      "tester",
      "hash",
      "admin",
      "2026-04-10T08:00:00.000Z",
      "2026-04-10T08:00:00.000Z"
    );
  workspaceRepository.create({
    id: "workspace-1",
    name: "Fixture Workspace",
    path: fixture.workspaceDir,
    repoRoot: fixture.workspaceDir,
    favorite: false,
    createdAt: "2026-04-10T08:00:00.000Z",
    updatedAt: "2026-04-10T08:00:00.000Z",
    removedAt: null
  });

  return {
    service,
    sessionForkRepository,
    sessionIndexRepository,
    repos: {
      sessionBindingRepository,
      sessionIndexRepository,
      sessionStateRepository,
      sessionStatusSnapshotRepository
    }
  };
}

function seedSourceSession(
  repos: {
    sessionBindingRepository?: SessionBindingRepository;
    sessionIndexRepository?: SessionIndexRepository;
    sessionStateRepository?: SessionStateRepository;
    sessionStatusSnapshotRepository?: SessionStatusSnapshotRepository;
  },
  rawStoreRef: string,
  messageCount: number
) {
  repos.sessionBindingRepository?.upsert({
    sessionId: "source-session",
    workspaceId: "workspace-1",
    provider: "codex",
    providerSessionId: "source-thread",
    rawStoreRef,
    createdAt: "2026-04-10T08:00:00.000Z",
    updatedAt: "2026-04-10T08:00:00.000Z"
  });
  repos.sessionIndexRepository?.upsert({
    sessionId: "source-session",
    workspaceId: "workspace-1",
    provider: "codex",
    title: "源会话",
    messageCount,
    isArchived: false,
    lastMessageAt: "2026-04-10T08:00:10.000Z",
    createdAt: "2026-04-10T08:00:00.000Z",
    updatedAt: "2026-04-10T08:00:10.000Z"
  });
  repos.sessionStateRepository?.upsert({
    sessionId: "source-session",
    userId: "user-1",
    runningState: "idle",
    activitySource: "none",
    favorite: false,
    lastEventAt: "2026-04-10T08:00:10.000Z",
    completedAt: null,
    lastSeenAt: null,
    updatedAt: "2026-04-10T08:00:10.000Z"
  });
  repos.sessionStatusSnapshotRepository?.upsert({
    sessionId: "source-session",
    syncStatus: "idle",
    syncCursor: null,
    lastSyncAt: "2026-04-10T08:00:10.000Z",
    lastErrorCode: null,
    lastErrorDetail: null,
    resumedAt: null,
    updatedAt: "2026-04-10T08:00:10.000Z"
  });
}

function createCodexSessionFile(
  codexHomeDir: string,
  workspaceDir: string,
  threadId: string,
  messages: Array<["user" | "assistant", string]>
) {
  return createNamedCodexSessionFile(
    codexHomeDir,
    workspaceDir,
    `${threadId}.jsonl`,
    threadId,
    messages
  );
}

function createNamedCodexSessionFile(
  codexHomeDir: string,
  workspaceDir: string,
  fileName: string,
  threadId: string,
  messages: Array<["user" | "assistant", string]>
) {
  const sessionDir = path.join(codexHomeDir, "sessions", "2026", "04", "10");
  const filePath = path.join(sessionDir, fileName);
  mkdirSync(sessionDir, { recursive: true });
  const lines = [
    JSON.stringify({
      timestamp: "2026-04-10T08:00:00.000Z",
      type: "session_meta",
      payload: {
        id: threadId,
        timestamp: "2026-04-10T08:00:00.000Z",
        cwd: workspaceDir,
        originator: "CodingNS Test",
        source: "test"
      }
    }),
    ...messages.map(([role, content], index) =>
      JSON.stringify({
        timestamp: `2026-04-10T08:00:${String(index + 1).padStart(2, "0")}.000Z`,
        type: "event_msg",
        payload: {
          type: role === "user" ? "user_message" : "agent_message",
          message: content
        }
      })
    )
  ];

  writeFileSync(filePath, lines.join("\n"), "utf8");
  return filePath;
}
