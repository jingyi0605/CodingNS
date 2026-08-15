import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DeepSeekHarnessAdapter,
  type CodexForkTransport,
  type DeepSeekHarnessTransport,
  type ProviderAdapter
} from "@codingns/session-sync-core";

import { resolveHostConfig } from "../../src/config/env.js";
import { SessionActivityAuthorityService } from "../../src/modules/sessions/session-activity-authority-service.js";
import { SessionChangedFileService } from "../../src/modules/sessions/session-changed-file-service.js";
import { SessionHistoryService } from "../../src/modules/sessions/session-history-service.js";
import { SessionMessageAttachmentService } from "../../src/modules/sessions/session-message-attachment-service.js";
import { createTaskManager, type TaskManager } from "../../src/modules/tasks/task-manager.js";
import { HOST_TASK_TYPES } from "../../src/modules/tasks/task-types.js";
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
          providerSessionId: "child-thread",
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

    const accepted = await service.sendMessage(forked.sessionId, "user-1", "子会话继续说话", null);

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
      readThread: vi.fn(async (providerSessionId) => {
        if (providerSessionId === "child-message-thread") {
          return {
            thread: {
              id: "child-message-thread",
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
                }
              ]
            }
          };
        }

        return {
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
        };
      }),
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
        throw new Error(`UNEXPECTED_RESUME_THREAD_FROM_HISTORY:${JSON.stringify(input)}`);
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

  it("读取子会话历史时会剔除 fork 后误带入的父会话最新消息，并回写正确的继承前缀长度", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const sourceFile = createCodexSessionFile(
      fixture.codexHomeDir,
      fixture.workspaceDir,
      "source-thread",
      [
        ["user", "第一轮问题"],
        ["assistant", "第一轮回答"],
        ["user", "父会话最新问题"]
      ]
    );
    const childFile = createNamedCodexSessionFile(
      fixture.codexHomeDir,
      fixture.workspaceDir,
      "child-thread.jsonl",
      "child-thread",
      [
        ["user", "第一轮问题"],
        ["assistant", "第一轮回答"],
        ["user", "父会话最新问题"],
        ["user", "子会话自己的第一句"]
      ]
    );
    const {
      service,
      sessionForkRepository,
      repos
    } = createSessionHistoryHarness(fixture, () => ({
      initialize: vi.fn(async () => {}),
      forkThread: vi.fn(async () => {
        throw new Error("UNEXPECTED_FORK_THREAD");
      }),
      readThread: vi.fn(async () => ({ history: [] })),
      rollbackThread: vi.fn(async () => {
        throw new Error("UNEXPECTED_ROLLBACK_THREAD");
      }),
      resumeThreadFromHistory: vi.fn(async () => {
        throw new Error("UNEXPECTED_RESUME_THREAD_FROM_HISTORY");
      }),
      close: vi.fn()
    }));

    seedSourceSession(repos, sourceFile, 3);
    const sourcePage = await service.readSessionHistory("source-session", null, 50, "forward", "user-1");
    const anchorMessageId = sourcePage.messages[1]?.messageId;

    expect(anchorMessageId).toBeTruthy();

    repos.sessionBindingRepository?.upsert({
      sessionId: "child-session",
      userId: "user-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "child-thread",
      rawStoreRef: childFile,
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: "2026-04-10T08:00:03.500Z",
      updatedAt: "2026-04-10T08:00:03.500Z"
    });
    repos.sessionIndexRepository?.upsert({
      sessionId: "child-session",
      workspaceId: "workspace-1",
      provider: "codex",
      parentSessionId: "source-session",
      title: "子会话",
      messageCount: 4,
      isArchived: false,
      lastMessageAt: "2026-04-10T08:00:04.000Z",
      createdAt: "2026-04-10T08:00:03.500Z",
      updatedAt: "2026-04-10T08:00:04.000Z"
    });
    repos.sessionStateRepository?.upsert({
      sessionId: "child-session",
      userId: "user-1",
      runningState: "idle",
      activitySource: "none",
      favorite: false,
      lastEventAt: "2026-04-10T08:00:04.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-04-10T08:00:04.000Z"
    });
    repos.sessionStatusSnapshotRepository?.upsert({
      sessionId: "child-session",
      syncStatus: "idle",
      syncCursor: null,
      lastSyncAt: "2026-04-10T08:00:04.000Z",
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      updatedAt: "2026-04-10T08:00:04.000Z"
    });
    sessionForkRepository.upsert({
      sessionId: "child-session",
      parentSessionId: "source-session",
      provider: "codex",
      forkSourceType: "message",
      forkSourceSessionId: "source-session",
      forkSourceMessageId: anchorMessageId ?? null,
      inheritedPrefixMessageCount: 3,
      providerParentSessionId: "source-thread",
      providerSourceMessageId: null,
      forkMethod: "native_message_fork",
      createdAt: "2026-04-10T08:00:03.500Z"
    });

    const childPage = await service.readSessionHistory("child-session", null, 50, "forward", "user-1");

    expect(childPage.messages.map((message) => message.content)).toEqual([
      "第一轮问题",
      "第一轮回答",
      "子会话自己的第一句"
    ]);
    expect(sessionForkRepository.findBySessionId("child-session")).toMatchObject({
      inheritedPrefixMessageCount: 2
    });
  });

  it("父会话在 fork 之后新增消息时，读取子会话历史仍会剔除这段泄漏后缀", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const sourceFile = createCodexSessionFile(
      fixture.codexHomeDir,
      fixture.workspaceDir,
      "source-thread",
      [
        ["user", "第一轮问题"],
        ["assistant", "第一轮回答"],
        ["user", "父会话 fork 后新增的问题"]
      ]
    );
    const childFile = createNamedCodexSessionFile(
      fixture.codexHomeDir,
      fixture.workspaceDir,
      "child-thread-late-leak.jsonl",
      "child-thread",
      [
        ["user", "第一轮问题"],
        ["assistant", "第一轮回答"],
        ["user", "父会话 fork 后新增的问题"],
        ["assistant", "子会话自己的第一句回复"]
      ]
    );
    const {
      service,
      sessionForkRepository,
      repos
    } = createSessionHistoryHarness(fixture, () => ({
      initialize: vi.fn(async () => {}),
      forkThread: vi.fn(async () => {
        throw new Error("UNEXPECTED_FORK_THREAD");
      }),
      readThread: vi.fn(async () => ({ history: [] })),
      rollbackThread: vi.fn(async () => {
        throw new Error("UNEXPECTED_ROLLBACK_THREAD");
      }),
      resumeThreadFromHistory: vi.fn(async () => {
        throw new Error("UNEXPECTED_RESUME_THREAD_FROM_HISTORY");
      }),
      close: vi.fn()
    }));

    seedSourceSession(repos, sourceFile, 3);
    const sourcePage = await service.readSessionHistory("source-session", null, 50, "forward", "user-1");
    const anchorMessageId = sourcePage.messages[1]?.messageId;

    expect(anchorMessageId).toBeTruthy();

    repos.sessionBindingRepository?.upsert({
      sessionId: "child-session-late-leak",
      userId: "user-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "child-thread",
      rawStoreRef: childFile,
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: "2026-04-10T08:00:02.500Z",
      updatedAt: "2026-04-10T08:00:02.500Z"
    });
    repos.sessionIndexRepository?.upsert({
      sessionId: "child-session-late-leak",
      workspaceId: "workspace-1",
      provider: "codex",
      parentSessionId: "source-session",
      title: "子会话晚到泄漏",
      messageCount: 4,
      isArchived: false,
      lastMessageAt: "2026-04-10T08:00:04.000Z",
      createdAt: "2026-04-10T08:00:02.500Z",
      updatedAt: "2026-04-10T08:00:04.000Z"
    });
    repos.sessionStateRepository?.upsert({
      sessionId: "child-session-late-leak",
      userId: "user-1",
      runningState: "idle",
      activitySource: "none",
      favorite: false,
      lastEventAt: "2026-04-10T08:00:04.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-04-10T08:00:04.000Z"
    });
    repos.sessionStatusSnapshotRepository?.upsert({
      sessionId: "child-session-late-leak",
      syncStatus: "idle",
      syncCursor: null,
      lastSyncAt: "2026-04-10T08:00:04.000Z",
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      updatedAt: "2026-04-10T08:00:04.000Z"
    });
    sessionForkRepository.upsert({
      sessionId: "child-session-late-leak",
      parentSessionId: "source-session",
      provider: "codex",
      forkSourceType: "message",
      forkSourceSessionId: "source-session",
      forkSourceMessageId: anchorMessageId ?? null,
      inheritedPrefixMessageCount: 2,
      providerParentSessionId: "source-thread",
      providerSourceMessageId: null,
      forkMethod: "native_message_fork",
      createdAt: "2026-04-10T08:00:02.500Z"
    });

    const childPage = await service.readSessionHistory(
      "child-session-late-leak",
      null,
      50,
      "forward",
      "user-1"
    );

    expect(childPage.messages.map((message) => message.content)).toEqual([
      "第一轮问题",
      "第一轮回答",
      "子会话自己的第一句回复"
    ]);
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

    const accepted = await service.sendMessage(forked.sessionId, "user-1", "在这条新分支里继续展开。", null);

    expect(accepted.sessionId).toBe(forked.sessionId);
    expect(accepted.message.provider).toBe("claude-code");
    expect(accepted.message.content).toBe("在这条新分支里继续展开。");
  });

  it("Codex 会话可以重建分叉到 DeepSeek Harness，并把历史文本作为初始 prompt", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const sourceFile = createCodexSessionFile(
      fixture.codexHomeDir,
      fixture.workspaceDir,
      "source-thread",
      [
        ["user", "先整理当前实现的风险点。"],
        ["assistant", "已经列出三类风险。"],
        ["user", "只保留前两条风险。"]
      ]
    );
    const deepSeekHarness = createDeepSeekForkTransport("dsh-child");
    const {
      service,
      sessionForkRepository,
      repos
    } = createSessionHistoryHarness(fixture, createUnusedCodexForkTransport, {
      additionalAdapters: [
        new DeepSeekHarnessAdapter({
          transport: deepSeekHarness.transport,
          harnessVersion: "0.1.0-rc.5",
          dshHomeDir: path.join(fixture.rootDir, "dsh-home")
        })
      ]
    });

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
      targetProvider: "deepseek-harness"
    });

    expect(forked.provider).toBe("deepseek-harness");
    expect(forked.parentSessionId).toBe("source-session");
    expect(forked.forkMethod).toBe("reconstructed_message_fork");
    expect(repos.sessionBindingRepository.findBySessionId(forked.sessionId)).toMatchObject({
      provider: "deepseek-harness",
      providerSessionId: "dsh-child"
    });
    expect(sessionForkRepository.findBySessionId(forked.sessionId)).toMatchObject({
      provider: "deepseek-harness",
      forkSourceMessageId: anchorMessageId,
      inheritedPrefixMessageCount: 2,
      providerParentSessionId: "source-thread",
      forkMethod: "reconstructed_message_fork"
    });

    const promptCall = deepSeekHarness.calls.find((call) => call.method === "session.prompt");
    expect(promptCall).toMatchObject({
      method: "session.prompt",
      payload: {
        sessionId: "dsh-child",
        mode: "queue",
        content: [
          {
            type: "text",
            text: expect.stringContaining("[助手]\n已经列出三类风险。")
          }
        ]
      }
    });
    expect((promptCall?.payload as { content: Array<{ text: string }> }).content[0]?.text)
      .toContain("[用户]\n先整理当前实现的风险点。");
    expect((promptCall?.payload as { content: Array<{ text: string }> }).content[0]?.text)
      .not.toContain("只保留前两条风险。");
  });

  it("DeepSeek Harness 会话级 fork 会保留原生 session.fork 元数据", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const deepSeekHarness = createDeepSeekForkTransport("dsh-child");
    const {
      service,
      sessionForkRepository,
      repos
    } = createSessionHistoryHarness(fixture, createUnusedCodexForkTransport, {
      additionalAdapters: [
        new DeepSeekHarnessAdapter({
          transport: deepSeekHarness.transport,
          harnessVersion: "0.1.0-rc.5",
          dshHomeDir: path.join(fixture.rootDir, "dsh-home")
        })
      ]
    });

    seedSourceSession(
      repos,
      "harness://0.1.0-rc.5/dsh-source",
      2,
      { provider: "deepseek-harness", providerSessionId: "dsh-source" }
    );

    const forked = await service.forkSession({
      sessionId: "source-session",
      userId: "user-1",
      sourceType: "session",
      strategy: "auto"
    });

    expect(forked.provider).toBe("deepseek-harness");
    expect(forked.forkMethod).toBe("native_session_fork");
    expect(sessionForkRepository.findBySessionId(forked.sessionId)).toMatchObject({
      provider: "deepseek-harness",
      providerParentSessionId: "dsh-source",
      providerSourceMessageId: null,
      inheritedPrefixMessageCount: 0,
      forkMethod: "native_session_fork"
    });
    expect(deepSeekHarness.calls).toContainEqual({
      method: "session.fork",
      payload: { sessionId: "dsh-source" }
    });
    expect(deepSeekHarness.calls.find((call) => call.method === "session.fork")?.payload)
      .not.toHaveProperty("atSeq");
  });

  it("Claude 子会话发出首条新消息后会改用子会话标题，discover 刷新也不会再被父标题覆盖", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const sourceTitle = "主会话标题";
    const sourceFile = createClaudeSessionFile(
      fixture.claudeHomeDir,
      fixture.workspaceDir,
      "source-thread",
      sourceTitle,
      [
        ["user", sourceTitle],
        ["assistant", "主会话回复"]
      ]
    );
    const childFile = createClaudeSessionFile(
      fixture.claudeHomeDir,
      fixture.workspaceDir,
      "child-thread",
      sourceTitle,
      [
        ["user", sourceTitle],
        ["assistant", "主会话回复"]
      ]
    );
    const {
      service,
      sessionForkRepository,
      repos
    } = createSessionHistoryHarness(fixture, () => ({
      initialize: vi.fn(async () => {}),
      forkThread: vi.fn(async () => {
        throw new Error("should not use codex transport");
      }),
      readThread: vi.fn(async () => ({ history: [] })),
      rollbackThread: vi.fn(async () => {
        throw new Error("should not use codex transport");
      }),
      resumeThreadFromHistory: vi.fn(async () => {
        throw new Error("should not use codex transport");
      }),
      close: vi.fn()
    }));

    repos.sessionBindingRepository.upsert({
      sessionId: "source-session",
      userId: "user-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "source-thread",
      rawStoreRef: sourceFile,
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: "2026-04-10T08:00:00.000Z",
      updatedAt: "2026-04-10T08:00:00.000Z"
    });
    repos.sessionIndexRepository.upsert({
      sessionId: "source-session",
      workspaceId: "workspace-1",
      provider: "claude-code",
      title: sourceTitle,
      messageCount: 2,
      isArchived: false,
      lastMessageAt: "2026-04-10T08:00:10.000Z",
      createdAt: "2026-04-10T08:00:00.000Z",
      updatedAt: "2026-04-10T08:00:10.000Z"
    });
    repos.sessionBindingRepository.upsert({
      sessionId: "child-session",
      userId: "user-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "child-thread",
      rawStoreRef: childFile,
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: "2026-04-10T08:01:00.000Z",
      updatedAt: "2026-04-10T08:01:00.000Z"
    });
    repos.sessionIndexRepository.upsert({
      sessionId: "child-session",
      workspaceId: "workspace-1",
      provider: "claude-code",
      parentSessionId: "source-session",
      title: sourceTitle,
      messageCount: 2,
      isArchived: false,
      lastMessageAt: "2026-04-10T08:01:10.000Z",
      createdAt: "2026-04-10T08:01:00.000Z",
      updatedAt: "2026-04-10T08:01:10.000Z"
    });
    repos.sessionStateRepository.upsert({
      sessionId: "child-session",
      userId: "user-1",
      runningState: "idle",
      activitySource: "none",
      favorite: false,
      lastEventAt: "2026-04-10T08:01:10.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-04-10T08:01:10.000Z"
    });
    repos.sessionStatusSnapshotRepository.upsert({
      sessionId: "child-session",
      syncStatus: "idle",
      syncCursor: null,
      lastSyncAt: "2026-04-10T08:01:10.000Z",
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      updatedAt: "2026-04-10T08:01:10.000Z"
    });
    sessionForkRepository.upsert({
      sessionId: "child-session",
      parentSessionId: "source-session",
      provider: "claude-code",
      forkSourceType: "session",
      forkSourceSessionId: "source-session",
      forkSourceMessageId: null,
      inheritedPrefixMessageCount: 2,
      providerParentSessionId: "source-thread",
      providerSourceMessageId: null,
      forkMethod: "native_session_fork",
      createdAt: "2026-04-10T08:01:00.000Z"
    });

    const accepted = await service.sendMessage("child-session", "user-1", "子会话第一条消息", null);

    expect(accepted.message.provider).toBe("claude-code");
    expect(accepted.message.content).toBe("子会话第一条消息");
    expect(service.getSession("child-session", "user-1").title).toBe("子会话第一条消息");

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
          provider: "claude-code",
          providerSessionId: "source-thread",
          rawStoreRef: sourceFile,
          title: sourceTitle,
          workspacePath: fixture.workspaceDir,
          lastMessageAt: "2026-04-10T08:00:10.000Z",
          messageCount: 2,
          isArchived: false,
          parentProviderSessionId: null
        },
        {
          provider: "claude-code",
          providerSessionId: "child-thread",
          rawStoreRef: childFile,
          title: sourceTitle,
          workspacePath: fixture.workspaceDir,
          lastMessageAt: "2026-04-10T08:02:00.000Z",
          messageCount: 3,
          isArchived: false,
          parentProviderSessionId: null
        }
      ]
    });

    const discovered = await service.discoverWorkspaceSessions("workspace-1", "user-1", {
      force: true
    });
    const discoveredChild = discovered.find((item) => item.sessionId === "child-session");

    expect(discoveredChild?.title).toBe("子会话第一条消息");
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
    expect(forked.title).toBe("");

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
      title: "",
      isSubagent: false
    });

    const accepted = await service.sendMessage(forked.sessionId, "user-1", "帮我继续改写成正式版本", null);
    const updatedFork = service.getSession(forked.sessionId, "user-1");

    expect(accepted.message.content).toBe("帮我继续改写成正式版本");
    expect(updatedFork.title).toBe("帮我继续改写成正式版本");
  });

  it("Codex discover 会按 providerSessionId 修正历史上绑错到父会话 rawStoreRef 的子会话", async () => {
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
    const childActualFile = createCodexSessionFile(
      fixture.codexHomeDir,
      fixture.workspaceDir,
      "child-thread",
      [
        ["user", "子 agent 第一句"]
      ]
    );
    const taskManager = createTaskManager(null, {
      helper_process: {
        execute: async (definition, input, context) => {
          if (definition.taskType === HOST_TASK_TYPES.workspaceDiscoveryScan) {
            return {
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
                  title: "子 agent 第一句",
                  workspacePath: fixture.workspaceDir,
                  lastMessageAt: "2026-04-10T08:05:01.000Z",
                  messageCount: 1,
                  isArchived: false,
                  parentProviderSessionId: "source-thread",
                  isSubagent: true,
                  subagentLabel: "agent"
                }
              ]
            };
          }

          return await definition.run(input, context);
        }
      }
    });
    const {
      service,
      repos
    } = createSessionHistoryHarness(fixture, () => ({
      initialize: vi.fn(async () => {}),
      forkThread: vi.fn(async () => ({
        providerSessionId: "unused",
        rawStoreRef: null
      })),
      readThread: vi.fn(async () => ({ history: [] })),
      rollbackThread: vi.fn(async () => ({
        providerSessionId: "unused",
        rawStoreRef: null
      })),
      resumeThreadFromHistory: vi.fn(async () => ({
        providerSessionId: "unused",
        rawStoreRef: null
      })),
      close: vi.fn()
    }), { taskManager });

    seedSourceSession(repos, sourceFile, 2);
    repos.sessionBindingRepository?.upsert({
      sessionId: "child-session",
      userId: "user-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "child-thread",
      rawStoreRef: sourceFile,
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: "2026-04-10T08:05:00.000Z",
      updatedAt: "2026-04-10T08:05:00.000Z"
    });
    repos.sessionIndexRepository?.upsert({
      sessionId: "child-session",
      workspaceId: "workspace-1",
      provider: "codex",
      parentSessionId: "source-session",
      title: "旧的脏子会话",
      messageCount: 3,
      isArchived: false,
      lastMessageAt: "2026-04-10T08:05:01.000Z",
      createdAt: "2026-04-10T08:05:00.000Z",
      updatedAt: "2026-04-10T08:05:01.000Z",
      isSubagent: true,
      subagentLabel: "agent"
    });
    repos.sessionStateRepository?.upsert({
      sessionId: "child-session",
      userId: "user-1",
      runningState: "idle",
      activitySource: "none",
      favorite: false,
      lastEventAt: "2026-04-10T08:05:01.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-04-10T08:05:01.000Z"
    });
    repos.sessionStatusSnapshotRepository?.upsert({
      sessionId: "child-session",
      syncStatus: "idle",
      syncCursor: null,
      lastSyncAt: "2026-04-10T08:05:01.000Z",
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      updatedAt: "2026-04-10T08:05:01.000Z"
    });

    const discovered = await service.discoverWorkspaceSessions("workspace-1", "user-1", {
      force: true
    });
    const discoveredChild = discovered.find((item) => item.sessionId === "child-session");
    const repairedBinding = repos.sessionBindingRepository?.findBySessionId("child-session");

    expect(discoveredChild).toMatchObject({
      sessionId: "child-session",
      rawStoreRef: childActualFile,
      parentSessionId: "source-session",
      title: "子 agent 第一句",
      isSubagent: true
    });
    expect(repairedBinding?.rawStoreRef).toBe(childActualFile);
  });

  it("首次读取会话历史时会先修复 Codex 旧脏 binding，再返回子会话自己的消息", async () => {
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
    const childActualFile = createCodexSessionFile(
      fixture.codexHomeDir,
      fixture.workspaceDir,
      "child-thread",
      [
        ["user", "子会话自己的消息"]
      ]
    );
    const {
      service,
      repos
    } = createSessionHistoryHarness(fixture, () => ({
      initialize: vi.fn(async () => {}),
      forkThread: vi.fn(async () => ({
        providerSessionId: "unused",
        rawStoreRef: null
      })),
      readThread: vi.fn(async () => ({ history: [] })),
      rollbackThread: vi.fn(async () => ({
        providerSessionId: "unused",
        rawStoreRef: null
      })),
      resumeThreadFromHistory: vi.fn(async () => ({
        providerSessionId: "unused",
        rawStoreRef: null
      })),
      close: vi.fn()
    }));

    seedSourceSession(repos, sourceFile, 2);
    repos.sessionBindingRepository?.upsert({
      sessionId: "child-session",
      userId: "user-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "child-thread",
      rawStoreRef: sourceFile,
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: "2026-04-10T08:05:00.000Z",
      updatedAt: "2026-04-10T08:05:00.000Z"
    });
    repos.sessionIndexRepository?.upsert({
      sessionId: "child-session",
      workspaceId: "workspace-1",
      provider: "codex",
      parentSessionId: "source-session",
      title: "旧脏子会话",
      messageCount: 1,
      isArchived: false,
      lastMessageAt: "2026-04-10T08:05:01.000Z",
      createdAt: "2026-04-10T08:05:00.000Z",
      updatedAt: "2026-04-10T08:05:01.000Z"
    });
    repos.sessionStateRepository?.upsert({
      sessionId: "child-session",
      userId: "user-1",
      runningState: "idle",
      activitySource: "none",
      favorite: false,
      lastEventAt: "2026-04-10T08:05:01.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-04-10T08:05:01.000Z"
    });
    repos.sessionStatusSnapshotRepository?.upsert({
      sessionId: "child-session",
      syncStatus: "idle",
      syncCursor: null,
      lastSyncAt: "2026-04-10T08:05:01.000Z",
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      updatedAt: "2026-04-10T08:05:01.000Z"
    });

    const discoverSpy = vi.spyOn(service, "discoverWorkspaceSessions").mockImplementation(
      async () => {
        repos.sessionBindingRepository?.upsert({
          sessionId: "child-session",
          userId: "user-1",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "child-thread",
          rawStoreRef: childActualFile,
          providerConfigMode: "global-default",
          providerPresetId: null,
          runtimeHomeDir: null,
          createdAt: "2026-04-10T08:05:00.000Z",
          updatedAt: "2026-04-10T08:05:02.000Z"
        });

        return [];
      }
    );

    const childPage = await service.readSessionHistory(
      "child-session",
      null,
      50,
      "forward",
      "user-1"
    );
    const repairedBinding = repos.sessionBindingRepository?.findBySessionId("child-session");

    expect(discoverSpy).toHaveBeenCalledTimes(1);
    expect(childPage.messages.map((message) => message.content)).toEqual([
      "子会话自己的消息"
    ]);
    expect(repairedBinding?.rawStoreRef).toBe(childActualFile);
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
  codexForkTransportFactory: () => CodexForkTransport,
  options: { additionalAdapters?: ProviderAdapter[]; taskManager?: TaskManager } = {}
) {
  const config = resolveHostConfig({
    databasePath: ":memory:",
    claudeCodeHomeDir: fixture.claudeHomeDir,
    codexHomeDir: fixture.codexHomeDir,
    geminiHomeDir: fixture.geminiHomeDir,
    kimiHomeDir: fixture.kimiHomeDir,
    deepseekHarnessHomeDir: path.join(fixture.rootDir, "dsh-home")
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
      codexForkTransportFactory,
      additionalAdapters: options.additionalAdapters
    },
    options.taskManager
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
    ownerUserId: "user-1",
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
  messageCount: number,
  options: {
    provider?: "codex" | "deepseek-harness";
    providerSessionId?: string;
  } = {}
) {
  const provider = options.provider ?? "codex";
  const providerSessionId = options.providerSessionId ?? "source-thread";
  repos.sessionBindingRepository?.upsert({
    sessionId: "source-session",
    userId: "user-1",
    workspaceId: "workspace-1",
    provider,
    providerSessionId,
    rawStoreRef,
    providerConfigMode: "global-default",
    providerPresetId: null,
    runtimeHomeDir: null,
    createdAt: "2026-04-10T08:00:00.000Z",
    updatedAt: "2026-04-10T08:00:00.000Z"
  });
  repos.sessionIndexRepository?.upsert({
    sessionId: "source-session",
    workspaceId: "workspace-1",
    provider,
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

function createUnusedCodexForkTransport(): CodexForkTransport {
  return {
    initialize: vi.fn(async () => {}),
    forkThread: vi.fn(async () => {
      throw new Error("UNEXPECTED_CODEX_FORK");
    }),
    readThread: vi.fn(async () => ({ history: [] })),
    rollbackThread: vi.fn(async () => {
      throw new Error("UNEXPECTED_CODEX_ROLLBACK");
    }),
    resumeThreadFromHistory: vi.fn(async () => {
      throw new Error("UNEXPECTED_CODEX_RESUME");
    }),
    close: vi.fn()
  };
}

function createDeepSeekForkTransport(childSessionId: string): {
  calls: Array<{ method: string; payload: unknown }>;
  transport: DeepSeekHarnessTransport;
} {
  const calls: Array<{ method: string; payload: unknown }> = [];
  const transport: DeepSeekHarnessTransport = {
    call: async <T>(method: string, payload: unknown): Promise<T> => {
      calls.push({ method, payload });

      const result = method === "workspace.create"
        ? { workspace: { workspaceId: "dsh-workspace" } }
        : method === "session.create"
          ? { sessionId: childSessionId }
          : method === "session.fork"
            ? { sessionId: childSessionId }
            : method === "session.history"
              ? { events: [] }
              : { accepted: true };

      return result as T;
    },
    subscribe: () => ({ close() {} })
  };

  return { calls, transport };
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

function createClaudeSessionFile(
  claudeHomeDir: string,
  workspaceDir: string,
  sessionId: string,
  title: string,
  messages: Array<["user" | "assistant", string]>
) {
  const projectDir = path.join(claudeHomeDir, "projects", "-tmp-codingns-claude-fork");
  const filePath = path.join(projectDir, `${sessionId}.jsonl`);
  mkdirSync(projectDir, { recursive: true });

  const lines = [
    ...messages.map(([role, content], index) =>
      JSON.stringify({
        type: role,
        sessionId,
        cwd: workspaceDir,
        timestamp: `2026-04-10T08:01:${String(index).padStart(2, "0")}.000Z`,
        message:
          role === "user"
            ? {
                role: "user",
                content: [{ type: "text", text: content }]
              }
            : {
                id: `assistant-${index}`,
                role: "assistant",
                content: [{ type: "text", text: content }]
              }
      })
    ),
    JSON.stringify({
      type: "ai-title",
      sessionId,
      aiTitle: title
    })
  ];

  writeFileSync(filePath, lines.join("\n"), "utf8");
  return filePath;
}
