import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DeepSeekHarnessAdapter, type ProviderAdapter } from "@codingns/session-sync-core";

import { resolveHostConfig } from "../../src/config/env.js";
import { SessionActivityAuthorityService } from "../../src/modules/sessions/session-activity-authority-service.js";
import { SessionChangedFileService } from "../../src/modules/sessions/session-changed-file-service.js";
import { SessionHistoryService } from "../../src/modules/sessions/session-history-service.js";
import { SessionMessageAttachmentService } from "../../src/modules/sessions/session-message-attachment-service.js";
import { createTaskManager } from "../../src/modules/tasks/task-manager.js";
import { HOST_TASK_TYPES } from "../../src/modules/tasks/task-types.js";
import { SessionBindingRepository } from "../../src/storage/repositories/session-binding-repository.js";
import { SessionChangedFileRepository } from "../../src/storage/repositories/session-changed-file-repository.js";
import { SessionIndexRepository } from "../../src/storage/repositories/session-index-repository.js";
import { SessionMessageAttachmentRepository } from "../../src/storage/repositories/session-message-attachment-repository.js";
import { SessionMessageOriginRepository } from "../../src/storage/repositories/session-message-origin-repository.js";
import { SessionStateRepository } from "../../src/storage/repositories/session-state-repository.js";
import { SessionStatusSnapshotRepository } from "../../src/storage/repositories/session-status-snapshot-repository.js";
import { WorkspaceRepository } from "../../src/storage/repositories/workspace-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";
import { destroyFixture, createEmptyFixture, type EmptyFixture } from "../helpers/test-app.js";

const activeFixtures: EmptyFixture[] = [];
const activeClosers: Array<() => Promise<void> | void> = [];

function createHarness(options: {
  additionalAdapters?: ProviderAdapter[];
  discoveryResult?: { sessions: []; isComplete: true };
} = {}) {
  const fixture = createEmptyFixture();
  const database = createDatabaseClient(":memory:");
  const config = resolveHostConfig({
    databasePath: ":memory:",
    claudeCodeHomeDir: fixture.claudeHomeDir,
    codexHomeDir: fixture.codexHomeDir
  });
  const workspaceRepository = new WorkspaceRepository(database.db);
  const sessionBindingRepository = new SessionBindingRepository(database.db);
  const sessionIndexRepository = new SessionIndexRepository(database.db);
  const sessionStateRepository = new SessionStateRepository(database.db);
  const sessionStatusSnapshotRepository = new SessionStatusSnapshotRepository(database.db);
  const sessionMessageOriginRepository = new SessionMessageOriginRepository(database.db);
  const sessionChangedFileService = new SessionChangedFileService(
    new SessionChangedFileRepository(database.db)
  );
  const sessionMessageAttachmentService = new SessionMessageAttachmentService(
    new SessionMessageAttachmentRepository(database.db),
    config
  );
  const taskManager = createTaskManager(null, {
    helper_process: {
      execute: async (definition, input, context) => {
        if (
          definition.taskType === HOST_TASK_TYPES.workspaceDiscoveryScan
          && options.discoveryResult
        ) {
          return options.discoveryResult;
        }

        return await definition.run(input, context);
      }
    }
  });
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
    sessionMessageOriginRepository,
    null,
    { additionalAdapters: options.additionalAdapters ?? [] },
    taskManager
  );

  activeFixtures.push(fixture);
  activeClosers.push(() => database.close());

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
      "2026-04-16T08:00:00.000Z",
      "2026-04-16T08:00:00.000Z"
    );
  workspaceRepository.create({
    id: "workspace-1",
    ownerUserId: "user-1",
    name: "Fixture Workspace",
    path: fixture.workspaceDir,
    repoRoot: fixture.workspaceDir,
    favorite: false,
    createdAt: "2026-04-16T08:00:00.000Z",
    updatedAt: "2026-04-16T08:00:00.000Z",
    removedAt: null
  });

  return {
    fixture,
    database,
    service,
    workspaceRepository,
    sessionBindingRepository,
    sessionIndexRepository,
    sessionStateRepository,
    sessionStatusSnapshotRepository,
    sessionMessageOriginRepository
  };
}

function createDeepSeekHarnessActivityAdapter(input: {
  reasonKind: "completed" | "failed" | "interrupted";
  detail?: string;
}): DeepSeekHarnessAdapter {
  return new DeepSeekHarnessAdapter({
    transport: {
      call: async <T,>(method: string): Promise<T> => {
        if (method === "session.list") {
          return {
            items: [{
              sessionId: "harness-1",
              cwd: "/tmp/workspace-1",
              running: false,
              updatedAt: "2026-08-15T02:22:31.000Z"
            }]
          } as T;
        }

        if (method === "session.history") {
          return {
            events: [{
              event: {
                type: "turn/end",
                seq: 12,
                time: "2026-08-15T02:22:33.000Z",
                data: {
                  turn: 5,
                  reason: {
                    kind: input.reasonKind,
                    ...(input.detail ? { message: input.detail } : {})
                  }
                }
              }
            }]
          } as T;
        }

        return { accepted: true } as T;
      },
      subscribe: () => ({ close() {} })
    }
  });
}

afterEach(async () => {
  while (activeClosers.length > 0) {
    const close = activeClosers.pop();
    await close?.();
  }

  while (activeFixtures.length > 0) {
    const fixture = activeFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }
});

describe("SessionHistoryService 恢复缺失索引", () => {
  it("刷新 DeepSeek Harness 历史会写回真实终态，并清除旧订阅错误", async () => {
    const cases = [
      { reasonKind: "completed" as const, expectedState: "completed", detail: undefined },
      { reasonKind: "failed" as const, expectedState: "failed", detail: "模型执行失败" },
      { reasonKind: "interrupted" as const, expectedState: "interrupted", detail: undefined }
    ];

    for (const testCase of cases) {
      const {
        service,
        sessionBindingRepository,
        sessionIndexRepository,
        sessionStateRepository,
        sessionStatusSnapshotRepository
      } = createHarness({
        additionalAdapters: [createDeepSeekHarnessActivityAdapter(testCase)]
      });
      const sessionId = `session-harness-${testCase.reasonKind}`;

      sessionBindingRepository.upsert({
        sessionId,
        userId: "user-1",
        workspaceId: "workspace-1",
        provider: "deepseek-harness",
        providerSessionId: "harness-1",
        rawStoreRef: "harness://harness-1",
        providerConfigMode: "global-default",
        providerPresetId: null,
        runtimeHomeDir: null,
        createdAt: "2026-08-15T02:20:00.000Z",
        updatedAt: "2026-08-15T02:20:00.000Z"
      });
      sessionIndexRepository.upsert({
        sessionId,
        workspaceId: "workspace-1",
        provider: "deepseek-harness",
        title: "Harness 历史会话",
        messageCount: 2,
        isArchived: false,
        lastMessageAt: "2026-08-15T02:22:31.000Z",
        createdAt: "2026-08-15T02:20:00.000Z",
        updatedAt: "2026-08-15T02:22:31.000Z"
      });
      sessionStateRepository.upsert({
        sessionId,
        userId: "user-1",
        runningState: "idle",
        activitySource: "none",
        favorite: false,
        lastEventAt: null,
        completedAt: null,
        lastSeenAt: null,
        updatedAt: "2026-08-15T02:22:31.000Z"
      });
      sessionStatusSnapshotRepository.upsert({
        sessionId,
        syncStatus: "error",
        syncCursor: null,
        lastSyncAt: "2026-08-15T02:22:31.000Z",
        lastErrorCode: "SUBSCRIBE_FAILED",
        lastErrorDetail: "PROVIDER_NOT_SUPPORTED",
        resumedAt: null,
        updatedAt: "2026-08-15T02:22:31.000Z"
      });

      const session = await service.refreshRuntimeFallbackSession(sessionId, "user-1");
      const state = sessionStateRepository.findBySessionAndUser(sessionId, "user-1");
      const snapshot = sessionStatusSnapshotRepository.findBySessionId(sessionId);

      expect(session).toMatchObject({
        runningState: testCase.expectedState,
        activitySource: "runtime",
        completedAt: "2026-08-15T02:22:33.000Z"
      });
      expect(state).toMatchObject({
        runningState: testCase.expectedState,
        activitySource: "runtime",
        completedAt: "2026-08-15T02:22:33.000Z"
      });

      if (testCase.expectedState === "failed") {
        expect(snapshot).toMatchObject({
          syncStatus: "error",
          lastErrorCode: "HARNESS_TURN_FAILED",
          lastErrorDetail: "模型执行失败"
        });
      } else {
        expect(snapshot).toMatchObject({
          syncStatus: "idle",
          lastErrorCode: null,
          lastErrorDetail: null
        });
      }
    }
  });

  it("完成的 DeepSeek Harness 会话不会被后续不支持的历史订阅改写为失败", async () => {
    const {
      service,
      sessionBindingRepository,
      sessionIndexRepository,
      sessionStateRepository,
      sessionStatusSnapshotRepository
    } = createHarness();
    const sessionId = "session-harness-completed-subscribe";
    const cursor = "eyJzZXF1ZW5jZSI6MTJ9";

    sessionBindingRepository.upsert({
      sessionId,
      userId: "user-1",
      workspaceId: "workspace-1",
      provider: "deepseek-harness",
      providerSessionId: "harness-1",
      rawStoreRef: "harness://harness-1",
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: "2026-08-15T04:08:00.000Z",
      updatedAt: "2026-08-15T04:08:00.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId,
      workspaceId: "workspace-1",
      provider: "deepseek-harness",
      title: "Harness 完成会话",
      messageCount: 4,
      isArchived: false,
      lastMessageAt: "2026-08-15T04:08:15.000Z",
      createdAt: "2026-08-15T04:08:00.000Z",
      updatedAt: "2026-08-15T04:08:15.000Z"
    });
    sessionStateRepository.upsert({
      sessionId,
      userId: "user-1",
      runningState: "completed",
      activitySource: "runtime",
      favorite: false,
      lastEventAt: "2026-08-15T04:08:15.000Z",
      completedAt: "2026-08-15T04:08:15.000Z",
      lastSeenAt: null,
      updatedAt: "2026-08-15T04:08:15.000Z"
    });
    sessionStatusSnapshotRepository.upsert({
      sessionId,
      syncStatus: "idle",
      syncCursor: cursor,
      lastSyncAt: "2026-08-15T04:08:15.000Z",
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      updatedAt: "2026-08-15T04:08:15.000Z"
    });

    const subscription = await service.subscribeSession(sessionId, cursor, 20, vi.fn(), "user-1");
    const snapshot = sessionStatusSnapshotRepository.findBySessionId(sessionId);

    expect(snapshot).toMatchObject({
      syncStatus: "idle",
      syncCursor: cursor,
      lastErrorCode: null,
      lastErrorDetail: null
    });
    subscription.close();
  });

  it("读取 Claude 历史时会修复被 0 字节占位文件挡住的真实 transcript", async () => {
    const {
      fixture,
      service,
      sessionBindingRepository,
      sessionIndexRepository
    } = createHarness();
    const sessionId = "session-claude-empty-shadow";
    const providerSessionId = "21f1a267-0bd5-42d8-9f29-5120e68d193a";
    const predictedProjectDir = join(fixture.claudeHomeDir, "projects", "-Users-jackson-Code-头脑风暴");
    const actualProjectDir = join(fixture.claudeHomeDir, "projects", "-Users-jackson-Code-----");
    const predictedRawStoreRef = join(predictedProjectDir, `${providerSessionId}.jsonl`);
    const actualRawStoreRef = join(actualProjectDir, `${providerSessionId}.jsonl`);

    mkdirSync(predictedProjectDir, { recursive: true });
    mkdirSync(actualProjectDir, { recursive: true });
    writeFileSync(predictedRawStoreRef, "", "utf8");
    writeFileSync(
      actualRawStoreRef,
      [
        JSON.stringify({
          type: "user",
          uuid: "message-1",
          timestamp: "2026-06-07T02:20:00.000Z",
          cwd: "/Users/jackson/Code/头脑风暴",
          sessionId: providerSessionId,
          message: {
            role: "user",
            content: [{ type: "text", text: "分析当前仓库文件" }]
          }
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "message-2",
          timestamp: "2026-06-07T02:21:00.000Z",
          cwd: "/Users/jackson/Code/头脑风暴",
          sessionId: providerSessionId,
          message: {
            role: "assistant",
            content: [{ type: "text", text: "真实历史内容" }]
          }
        })
      ].join("\n"),
      "utf8"
    );

    sessionBindingRepository.upsert({
      sessionId,
      userId: "user-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId,
      rawStoreRef: predictedRawStoreRef,
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: "2026-06-07T02:19:00.000Z",
      updatedAt: "2026-06-07T02:19:00.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId,
      workspaceId: "workspace-1",
      provider: "claude-code",
      title: "分析当前仓库文件",
      messageCount: 2,
      isArchived: false,
      lastMessageAt: "2026-06-07T02:21:00.000Z",
      createdAt: "2026-06-07T02:19:00.000Z",
      updatedAt: "2026-06-07T02:21:00.000Z"
    });

    const page = await service.readSessionHistory(sessionId, null, 20, "backward", "user-1");

    expect(page.messages.map((message) => message.content)).toEqual([
      "分析当前仓库文件",
      "真实历史内容"
    ]);
    expect(sessionBindingRepository.findBySessionId(sessionId)?.rawStoreRef).toBe(actualRawStoreRef);
  });

  it("binding 仍在时，getSession 会补建缺失的 index、snapshot 和 state", () => {
    const {
      service,
      sessionBindingRepository,
      sessionIndexRepository,
      sessionStateRepository,
      sessionStatusSnapshotRepository
    } = createHarness();

    sessionBindingRepository.upsert({
      sessionId: "session-missing-index",
      userId: "user-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "pending://codex/session-missing-index",
      rawStoreRef: "pending://codex/session-missing-index",
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: "2026-04-16T08:01:00.000Z",
      updatedAt: "2026-04-16T08:01:00.000Z"
    });

    const session = service.getSession("session-missing-index", "user-1");

    expect(session.sessionId).toBe("session-missing-index");
    expect(session.provider).toBe("codex");
    expect(session.title).toBe("新会话");
    expect(session.runningState).toBe("starting");
    expect(session.activitySource).toBe("runtime");
    expect(sessionIndexRepository.findIndexRecordBySessionId("session-missing-index")).toMatchObject({
      sessionId: "session-missing-index",
      workspaceId: "workspace-1",
      provider: "codex",
      title: "新会话",
      messageCount: 0,
      isArchived: false
    });
    expect(
      sessionStatusSnapshotRepository.findBySessionId("session-missing-index")
    ).toMatchObject({
      sessionId: "session-missing-index",
      syncStatus: "idle"
    });
    expect(
      sessionStateRepository.findBySessionAndUser("session-missing-index", "user-1")
    ).toMatchObject({
      sessionId: "session-missing-index",
      userId: "user-1",
      runningState: "starting",
      activitySource: "runtime"
    });
  });

  it("未回填 messageId 的代理来源不会再按内容误命中手动用户消息", () => {
    const { service, sessionBindingRepository, sessionIndexRepository, sessionMessageOriginRepository } =
      createHarness();

    sessionBindingRepository.upsert({
      sessionId: "session-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-1",
      rawStoreRef: "pending://codex/session-1",
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: "2026-04-16T08:00:30.000Z",
      updatedAt: "2026-04-16T08:00:30.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      title: "真实会话",
      messageCount: 0,
      isArchived: false,
      lastMessageAt: null,
      createdAt: "2026-04-16T08:00:30.000Z",
      updatedAt: "2026-04-16T08:00:30.000Z"
    });

    sessionMessageOriginRepository.upsert({
      sessionId: "session-1",
      clientRequestId: "assistant-origin:test-unresolved",
      messageId: null,
      origin: "butler_proxy",
      originRef: "control-1",
      content: "继续推进",
      createdAt: "2026-04-16T08:01:00.000Z",
      updatedAt: "2026-04-16T08:01:00.000Z"
    });

    const resolved = service.resolveMessageOrigin("session-1", {
      messageId: "message-1",
      role: "user",
      content: "继续推进",
      timestamp: "2026-04-16T08:01:05.000Z",
      sequence: 1,
      attachments: []
    });

    expect(resolved.origin).toBeNull();
    expect(resolved.originRef).toBeNull();
    expect(
      sessionMessageOriginRepository.listBySessionAndMessageIds("session-1", ["message-1"])
    ).toEqual([]);
  });

  it("拿到真实 messageId 后会按 clientRequestId 回填代理来源绑定", () => {
    const { service, sessionBindingRepository, sessionIndexRepository, sessionMessageOriginRepository } =
      createHarness();

    sessionBindingRepository.upsert({
      sessionId: "session-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-1",
      rawStoreRef: "pending://codex/session-1",
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: "2026-04-16T08:00:30.000Z",
      updatedAt: "2026-04-16T08:00:30.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      title: "真实会话",
      messageCount: 0,
      isArchived: false,
      lastMessageAt: null,
      createdAt: "2026-04-16T08:00:30.000Z",
      updatedAt: "2026-04-16T08:00:30.000Z"
    });

    sessionMessageOriginRepository.upsert({
      sessionId: "session-1",
      clientRequestId: "assistant-origin:test-unresolved",
      messageId: null,
      origin: "butler_proxy",
      originRef: "control-1",
      content: "继续推进",
      createdAt: "2026-04-16T08:01:00.000Z",
      updatedAt: "2026-04-16T08:01:00.000Z"
    });

    service.resolveMessageOriginByClientRequestId(
      "session-1",
      "assistant-origin:test-unresolved",
      "message-1",
      "2026-04-16T08:01:05.000Z"
    );

    expect(
      sessionMessageOriginRepository.listBySessionAndMessageIds("session-1", ["message-1"])
    ).toEqual([
      expect.objectContaining({
        sessionId: "session-1",
        clientRequestId: "assistant-origin:test-unresolved",
        messageId: "message-1",
        origin: "butler_proxy",
        originRef: "control-1",
        content: "继续推进",
        updatedAt: "2026-04-16T08:01:05.000Z"
      })
    ]);
  });

  it("discoverWorkspaceSessions 不会删除刚创建且尚未回填真实路径的 Codex synthetic session", async () => {
    const { service, sessionBindingRepository, sessionIndexRepository } = createHarness({
      discoveryResult: { sessions: [], isComplete: true }
    });
    const recentTimestamp = new Date().toISOString();
    const syntheticRawStoreRef = `${process.cwd()}/.tmp/runtime/codex/recent-missing.stream`;

    sessionBindingRepository.upsert({
      sessionId: "session-recent-synthetic",
      userId: "user-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-recent",
      rawStoreRef: syntheticRawStoreRef,
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: recentTimestamp,
      updatedAt: recentTimestamp
    });
    sessionIndexRepository.upsert({
      sessionId: "session-recent-synthetic",
      workspaceId: "workspace-1",
      provider: "codex",
      title: "新建中的 Codex 会话",
      messageCount: 0,
      isArchived: false,
      lastMessageAt: null,
      createdAt: recentTimestamp,
      updatedAt: recentTimestamp
    });

    const sessions = await service.discoverWorkspaceSessions("workspace-1", "user-1", {
      force: true,
      refreshStateMode: "deferred"
    });

    expect(sessions.map((session) => session.sessionId)).toContain("session-recent-synthetic");
    expect(service.getSession("session-recent-synthetic", "user-1").sessionId).toBe(
      "session-recent-synthetic"
    );
  });

  it("discoverWorkspaceSessions 仍会清理超出宽限期的失效 Codex synthetic session", async () => {
    const { service, sessionBindingRepository, sessionIndexRepository } = createHarness({
      discoveryResult: { sessions: [], isComplete: true }
    });
    const staleTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const syntheticRawStoreRef = `${process.cwd()}/.tmp/runtime/codex/stale-missing.stream`;

    sessionBindingRepository.upsert({
      sessionId: "session-stale-synthetic",
      userId: "user-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-stale",
      rawStoreRef: syntheticRawStoreRef,
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: staleTimestamp,
      updatedAt: staleTimestamp
    });
    sessionIndexRepository.upsert({
      sessionId: "session-stale-synthetic",
      workspaceId: "workspace-1",
      provider: "codex",
      title: "陈旧的 Codex synthetic 会话",
      messageCount: 0,
      isArchived: false,
      lastMessageAt: null,
      createdAt: staleTimestamp,
      updatedAt: staleTimestamp
    });

    const sessions = await service.discoverWorkspaceSessions("workspace-1", "user-1", {
      force: true,
      refreshStateMode: "deferred"
    });

    expect(sessions.map((session) => session.sessionId)).not.toContain("session-stale-synthetic");
    expect(sessionBindingRepository.findBySessionId("session-stale-synthetic")).toBeNull();
    expect(sessionIndexRepository.findIndexRecordBySessionId("session-stale-synthetic")).toBeNull();
  });

  it("discoverWorkspaceSessions 不会清理已被 butler_sessions 引用的 stale hidden session", async () => {
    const {
      fixture,
      database,
      service,
      sessionBindingRepository,
      sessionIndexRepository
    } = createHarness({
      discoveryResult: { sessions: [], isComplete: true }
    });
    const staleTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const archivedSessionDir = `${fixture.codexHomeDir}/archived_sessions`;
    const rolloutFilePath = `${archivedSessionDir}/rollout-2026-04-11T09-11-20.543Z-test.jsonl`;

    mkdirSync(archivedSessionDir, { recursive: true });
    writeFileSync(
      rolloutFilePath,
      `${JSON.stringify({
        timestamp: staleTimestamp,
        type: "session_meta",
        payload: {
          id: "rollout-2026-04-11T09-11-20.543Z-test",
          timestamp: staleTimestamp,
          cwd: fixture.workspaceDir,
          originator: "CodingNS Host",
          source: "codingns"
        }
      })}\n`,
      "utf8"
    );

    sessionBindingRepository.upsert({
      sessionId: "session-stale-hidden-butler",
      userId: "user-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "rollout-2026-04-11T09-11-20.543Z-test",
      rawStoreRef: rolloutFilePath,
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: staleTimestamp,
      updatedAt: staleTimestamp
    });
    sessionIndexRepository.upsert({
      sessionId: "session-stale-hidden-butler",
      workspaceId: "workspace-1",
      provider: "codex",
      title: "已纳管的历史 rollout 会话",
      messageCount: 0,
      isArchived: true,
      lastMessageAt: null,
      createdAt: staleTimestamp,
      updatedAt: staleTimestamp
    });
    database.db
      .prepare(
        `INSERT INTO butler_projects (
           id,
           user_id,
           workspace_id,
           name,
           repo_root,
           default_provider,
           instruction_profile_id,
           approval_mode,
           lifecycle_status,
           risk_level,
           config_json,
           last_patrol_at,
           last_verification_at,
           created_at,
           updated_at,
           archived_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "butler-project-1",
        "user-1",
        "workspace-1",
        "Fixture Workspace",
        fixture.workspaceDir,
        "codex",
        null,
        "controlled",
        "active",
        "low",
        "{}",
        null,
        null,
        staleTimestamp,
        staleTimestamp,
        null
      );
    database.db
      .prepare(
        `INSERT INTO butler_sessions (
           id,
           user_id,
           project_id,
           session_id,
           role,
           ownership_mode,
           status,
           last_summary,
           last_checkpoint_at,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "butler-session-1",
        "user-1",
        "butler-project-1",
        "session-stale-hidden-butler",
        "adhoc",
        "observed",
        "idle",
        "已有摘要",
        staleTimestamp,
        staleTimestamp,
        staleTimestamp
      );

    const sessions = await service.discoverWorkspaceSessions("workspace-1", "user-1", {
      force: true,
      refreshStateMode: "deferred"
    });

    expect(sessions.map((session) => session.sessionId)).toContain("session-stale-hidden-butler");
    expect(sessionBindingRepository.findBySessionId("session-stale-hidden-butler")).toMatchObject({
      sessionId: "session-stale-hidden-butler"
    });
    expect(sessionIndexRepository.findIndexRecordBySessionId("session-stale-hidden-butler")).toMatchObject({
      sessionId: "session-stale-hidden-butler"
    });
  });

  it("syncSessionTitle 会用 provider 原始标题覆盖首条用户消息生成的临时标题", async () => {
    const { service, sessionBindingRepository, sessionIndexRepository } = createHarness();
    const provisionalTitle = "请帮我修复 Claude 会话标题读取异常";
    const providerTitle = "修复 Claude Code 会话标题读取异常";

    sessionBindingRepository.upsert({
      sessionId: "session-title-sync",
      userId: "user-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "provider-session-title-sync",
      rawStoreRef: "/tmp/.claude/projects/workspace/provider-session-title-sync.jsonl",
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: "2026-04-16T08:00:30.000Z",
      updatedAt: "2026-04-16T08:00:30.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: "session-title-sync",
      workspaceId: "workspace-1",
      provider: "claude-code",
      title: provisionalTitle,
      messageCount: 2,
      isArchived: false,
      lastMessageAt: "2026-04-16T08:01:30.000Z",
      createdAt: "2026-04-16T08:00:30.000Z",
      updatedAt: "2026-04-16T08:01:30.000Z"
    });

    const readSessionTitle = vi.fn(async () => providerTitle);
    const readHistory = vi.fn(async () => ({
      messages: [
        {
          messageId: "msg-1",
          role: "user",
          content: provisionalTitle,
          timestamp: "2026-04-16T08:01:00.000Z",
          sequence: 1,
          attachments: []
        }
      ],
      cursor: null,
      nextCursor: null,
      total: 1
    }));

    Object.defineProperty(service, "providerDiscoveryHelperClient", {
      value: {
        readSessionTitle
      },
      configurable: true
    });
    Object.defineProperty(service, "sessionSyncService", {
      value: {
        readHistory
      },
      configurable: true
    });

    await service.syncSessionTitle("session-title-sync");

    expect(readHistory).toHaveBeenCalledTimes(1);
    expect(readSessionTitle).toHaveBeenCalledTimes(1);
    expect(sessionIndexRepository.findIndexRecordBySessionId("session-title-sync")).toMatchObject({
      title: providerTitle
    });
  });

  it("syncSessionTitle 不会用 provider 标题覆盖手动改过的标题", async () => {
    const { service, sessionBindingRepository, sessionIndexRepository } = createHarness();
    const manualTitle = "我手动改过的标题";
    const firstUserMessage = "请把 OpenCode 会话标题修好，不要再显示第一条用户消息";

    sessionBindingRepository.upsert({
      sessionId: "session-title-manual",
      userId: "user-1",
      workspaceId: "workspace-1",
      provider: "opencode",
      providerSessionId: "provider-session-title-manual",
      rawStoreRef: "opencode://session/provider-session-title-manual",
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: "2026-04-16T08:00:30.000Z",
      updatedAt: "2026-04-16T08:00:30.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: "session-title-manual",
      workspaceId: "workspace-1",
      provider: "opencode",
      title: manualTitle,
      messageCount: 3,
      isArchived: false,
      lastMessageAt: "2026-04-16T08:01:30.000Z",
      createdAt: "2026-04-16T08:00:30.000Z",
      updatedAt: "2026-04-16T08:01:30.000Z"
    });

    const readSessionTitle = vi.fn(async () => "OpenCode 原始标题");
    const readHistory = vi.fn(async () => ({
      messages: [
        {
          messageId: "msg-1",
          role: "user",
          content: firstUserMessage,
          timestamp: "2026-04-16T08:01:00.000Z",
          sequence: 1,
          attachments: []
        }
      ],
      cursor: null,
      nextCursor: null,
      total: 1
    }));

    Object.defineProperty(service, "providerDiscoveryHelperClient", {
      value: {
        readSessionTitle
      },
      configurable: true
    });
    Object.defineProperty(service, "sessionSyncService", {
      value: {
        readHistory
      },
      configurable: true
    });

    await service.syncSessionTitle("session-title-manual");

    expect(readHistory).toHaveBeenCalledTimes(1);
    expect(readSessionTitle).not.toHaveBeenCalled();
    expect(sessionIndexRepository.findIndexRecordBySessionId("session-title-manual")).toMatchObject({
      title: manualTitle
    });
  });
});
