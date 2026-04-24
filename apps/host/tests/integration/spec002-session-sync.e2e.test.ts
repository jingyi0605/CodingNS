import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import WebSocket from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveHostConfig } from "../../src/config/env.js";
import { SessionActivityAuthorityService } from "../../src/modules/sessions/session-activity-authority-service.js";
import { SessionChangedFileService } from "../../src/modules/sessions/session-changed-file-service.js";
import { SessionHistoryService } from "../../src/modules/sessions/session-history-service.js";
import { SessionMessageAttachmentService } from "../../src/modules/sessions/session-message-attachment-service.js";
import { nowIso } from "../../src/shared/utils/time.js";
import { SessionBindingRepository } from "../../src/storage/repositories/session-binding-repository.js";
import { SessionChangedFileRepository } from "../../src/storage/repositories/session-changed-file-repository.js";
import { SessionIndexRepository } from "../../src/storage/repositories/session-index-repository.js";
import { SessionMessageAttachmentRepository } from "../../src/storage/repositories/session-message-attachment-repository.js";
import { SessionStateRepository } from "../../src/storage/repositories/session-state-repository.js";
import { SessionStatusSnapshotRepository } from "../../src/storage/repositories/session-status-snapshot-repository.js";
import { WorkspaceRepository } from "../../src/storage/repositories/workspace-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

import {
  createEmptyFixture,
  createProviderFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture,
  type ProviderFixture
} from "../helpers/test-app.js";

function workspaceSlugForTest(workspacePath: string): string {
  const trimmed = workspacePath.replace(/[\\/]+$/, "");
  const normalizedDriveLetter = trimmed.replace(/^[A-Z](?=:)/, (value) => value.toLowerCase());

  return normalizedDriveLetter
    .replaceAll(":", "-")
    .replaceAll("\\", "-")
    .replaceAll("/", "-");
}

const activeClosers: Array<() => Promise<void> | void> = [];
const activeFixtures: ProviderFixture[] = [];
const activeEmptyFixtures: EmptyFixture[] = [];

function createWsMessageQueue(socket: WebSocket) {
  const pending: string[] = [];
  const waiters: Array<(value: string) => void> = [];

  socket.on("message", (raw) => {
    const text = raw.toString();
    const waiter = waiters.shift();

    if (waiter) {
      waiter(text);
      return;
    }

    pending.push(text);
  });

  return {
    async next(timeoutMs = 2000): Promise<string> {
      if (pending.length > 0) {
        return pending.shift()!;
      }

      return await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.indexOf(resolve);

          if (index >= 0) {
            waiters.splice(index, 1);
          }

          reject(new Error(`等待 WebSocket 消息超时: ${timeoutMs}ms`));
        }, timeoutMs);

        waiters.push((value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
    }
  };
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

  while (activeEmptyFixtures.length > 0) {
    const fixture = activeEmptyFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }
});

describe("spec002 会话同步核心", () => {
  it("authority 已判定本轮完成时，会清掉上一轮失败残留，避免列表继续显示失败", () => {
    const fixture = createEmptyFixture();
    const config = resolveHostConfig({
      databasePath: ":memory:",
      claudeCodeHomeDir: fixture.claudeHomeDir,
      codexHomeDir: fixture.codexHomeDir
    });
    const database = createDatabaseClient(":memory:");
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
    const sessionActivityAuthorityService = new SessionActivityAuthorityService();
    const sessionHistoryService = new SessionHistoryService(
      database.db,
      workspaceRepository,
      sessionBindingRepository,
      sessionChangedFileService,
      sessionIndexRepository,
      sessionMessageAttachmentService,
      sessionStateRepository,
      sessionStatusSnapshotRepository,
      config,
      sessionActivityAuthorityService
    );

    activeEmptyFixtures.push(fixture);
    activeClosers.push(() => database.close());

    workspaceRepository.create({
      id: "workspace-1",
      name: "Fixture Workspace",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: "2026-04-01T08:00:00.000Z",
      updatedAt: "2026-04-01T08:00:00.000Z",
      removedAt: null
    });
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
        "2026-04-01T08:00:00.000Z",
        "2026-04-01T08:00:00.000Z"
      );

    sessionBindingRepository.upsert({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "opencode",
      providerSessionId: "opencode-session-1",
      rawStoreRef: "opencode://session/opencode-session-1",
      createdAt: "2026-04-01T08:00:00.000Z",
      updatedAt: "2026-04-01T08:00:00.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "opencode",
      title: "OpenCode 样本会话",
      messageCount: 4,
      isArchived: false,
      lastMessageAt: "2026-04-01T08:12:00.000Z",
      createdAt: "2026-04-01T08:00:00.000Z",
      updatedAt: "2026-04-01T08:12:00.000Z"
    });
    sessionStateRepository.upsert({
      sessionId: "session-1",
      userId: "user-1",
      runningState: "failed",
      activitySource: "runtime",
      favorite: false,
      lastEventAt: "2026-04-01T08:05:00.000Z",
      completedAt: "2026-04-01T08:05:00.000Z",
      lastSeenAt: null,
      updatedAt: "2026-04-01T08:05:00.000Z"
    });
    sessionStatusSnapshotRepository.upsert({
      sessionId: "session-1",
      syncStatus: "error",
      syncCursor: null,
      lastSyncAt: "2026-04-01T08:05:00.000Z",
      lastErrorCode: "OPENCODE_SESSION_ERROR",
      lastErrorDetail: "OpenCode session failed",
      resumedAt: null,
      updatedAt: "2026-04-01T08:05:00.000Z"
    });

    sessionActivityAuthorityService.observe({
      sessionId: "session-1",
      runId: "runtime:session-1:2026-04-01T08:10:00.000Z",
      runningState: "completed",
      source: "authoritative_runtime",
      confidence: "strong",
      detail: "OpenCode 本轮输出已结束",
      errorCode: null,
      observedAt: "2026-04-01T08:12:00.000Z"
    });

    const sessions = sessionHistoryService.listWorkspaceSessions("workspace-1", "user-1");

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: "session-1",
      runningState: "completed",
      syncStatus: "idle",
      lastErrorCode: null,
      lastErrorDetail: null
    });
  });

  it("Claude 新建会话的 pending 绑定回填真 ID 时会并回后台发现的重复记录", async () => {
    const fixture = createEmptyFixture();
    const config = resolveHostConfig({
      databasePath: ":memory:",
      claudeCodeHomeDir: fixture.claudeHomeDir,
      codexHomeDir: fixture.codexHomeDir
    });
    const database = createDatabaseClient(":memory:");
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
    const sessionHistoryService = new SessionHistoryService(
      database.db,
      workspaceRepository,
      sessionBindingRepository,
      sessionChangedFileService,
      sessionIndexRepository,
      sessionMessageAttachmentService,
      sessionStateRepository,
      sessionStatusSnapshotRepository,
      config
    );
    const runtimeSessionId = "runtime-session";
    const duplicateSessionId = "discovered-session";
    const providerSessionId = "claude-session-1";
    const rawStoreRef = path.join(
      fixture.claudeHomeDir,
      "projects",
      "fixture-workspace",
      `${providerSessionId}.jsonl`
    );

    activeEmptyFixtures.push(fixture);
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
        "2026-03-28T09:00:00.000Z",
        "2026-03-28T09:00:00.000Z"
      );

    workspaceRepository.create({
      id: "workspace-1",
      name: "Fixture Workspace",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: "2026-03-28T09:00:00.000Z",
      updatedAt: "2026-03-28T09:00:00.000Z",
      removedAt: null
    });

    sessionBindingRepository.upsert({
      sessionId: runtimeSessionId,
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "pending://claude-code/runtime-session",
      rawStoreRef: "pending://claude-code/runtime-session",
      createdAt: "2026-03-28T09:00:01.000Z",
      updatedAt: "2026-03-28T09:00:01.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: runtimeSessionId,
      workspaceId: "workspace-1",
      provider: "claude-code",
      title: "请帮我检查绑定冲突",
      messageCount: 1,
      isArchived: false,
      lastMessageAt: "2026-03-28T09:00:02.000Z",
      createdAt: "2026-03-28T09:00:01.000Z",
      updatedAt: "2026-03-28T09:00:02.000Z"
    });
    sessionStateRepository.upsert({
      sessionId: runtimeSessionId,
      userId: "user-1",
      runningState: "running",
      activitySource: "runtime",
      favorite: false,
      lastEventAt: "2026-03-28T09:00:03.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-03-28T09:00:03.000Z"
    });
    sessionStatusSnapshotRepository.upsert({
      sessionId: runtimeSessionId,
      syncStatus: "idle",
      syncCursor: null,
      lastSyncAt: "2026-03-28T09:00:03.000Z",
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      updatedAt: "2026-03-28T09:00:03.000Z"
    });

    sessionBindingRepository.upsert({
      sessionId: duplicateSessionId,
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId,
      rawStoreRef,
      createdAt: "2026-03-28T09:00:04.000Z",
      updatedAt: "2026-03-28T09:00:04.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: duplicateSessionId,
      workspaceId: "workspace-1",
      provider: "claude-code",
      title: "扫描发现的 Claude 会话",
      messageCount: 5,
      isArchived: false,
      lastMessageAt: "2026-03-28T09:00:05.000Z",
      createdAt: "2026-03-28T09:00:04.000Z",
      updatedAt: "2026-03-28T09:00:05.000Z"
    });
    sessionStateRepository.upsert({
      sessionId: duplicateSessionId,
      userId: "user-1",
      runningState: "completed",
      activitySource: "inferred",
      favorite: true,
      lastEventAt: "2026-03-28T09:00:02.500Z",
      completedAt: "2026-03-28T09:00:05.000Z",
      lastSeenAt: "2026-03-28T09:00:05.500Z",
      updatedAt: "2026-03-28T09:00:05.500Z"
    });
    sessionStatusSnapshotRepository.upsert({
      sessionId: duplicateSessionId,
      syncStatus: "error",
      syncCursor: "cursor-1",
      lastSyncAt: "2026-03-28T09:00:05.000Z",
      lastErrorCode: "CLAUDE_SYNC_FAILED",
      lastErrorDetail: "sync failed",
      resumedAt: "2026-03-28T09:00:04.500Z",
      updatedAt: "2026-03-28T09:00:05.500Z"
    });
    sessionChangedFileRepository.upsertMany([
      {
        sessionId: duplicateSessionId,
        workspaceId: "workspace-1",
        path: "src/runtime/claude.ts",
        firstDetectedAt: "2026-03-28T09:00:04.200Z",
        lastDetectedAt: "2026-03-28T09:00:04.900Z",
        lastToolName: "apply_patch"
      }
    ]);
    sessionChangedFileRepository.upsertIndexState({
      sessionId: duplicateSessionId,
      indexedAt: "2026-03-28T09:00:05.000Z",
      updatedAt: "2026-03-28T09:00:05.000Z"
    });
    database.db
      .prepare(
        `INSERT INTO session_send_queue (
           id,
           session_id,
           user_id,
           content,
           client_request_id,
           model,
           reasoning_level,
           permission_mode,
           status,
           order_index,
           error_detail,
           created_at,
           updated_at,
           dispatched_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "queue-1",
        duplicateSessionId,
        "user-1",
        "继续输出",
        null,
        null,
        null,
        null,
        "queued",
        1,
        null,
        "2026-03-28T09:00:04.100Z",
        "2026-03-28T09:00:04.100Z",
        null
      );

    sessionHistoryService.persistSessionBinding(runtimeSessionId, "workspace-1", {
      provider: "claude-code",
      providerSessionId,
      rawStoreRef
    });

    expect(sessionBindingRepository.findBySessionId(duplicateSessionId)).toEqual(
      expect.objectContaining({
        sessionId: duplicateSessionId,
        providerSessionId: `alias://claude-code/${runtimeSessionId}/${duplicateSessionId}`,
        rawStoreRef: `alias://claude-code/${runtimeSessionId}/${duplicateSessionId}`
      })
    );
    expect(sessionIndexRepository.findIndexRecordBySessionId(duplicateSessionId)).toEqual(
      expect.objectContaining({
        sessionId: duplicateSessionId
      })
    );
    expect(sessionStateRepository.findBySessionAndUser(duplicateSessionId, "user-1")).toBeNull();
    expect(sessionHistoryService.getBindingOrThrow(duplicateSessionId)).toEqual(
      expect.objectContaining({
        sessionId: runtimeSessionId,
        providerSessionId,
        rawStoreRef
      })
    );
    expect(sessionBindingRepository.findByProviderSession("claude-code", providerSessionId)).toEqual(
      expect.objectContaining({
        sessionId: runtimeSessionId,
        providerSessionId,
        rawStoreRef
      })
    );
    expect(sessionIndexRepository.findIndexRecordBySessionId(runtimeSessionId)).toEqual(
      expect.objectContaining({
        title: "请帮我检查绑定冲突",
        messageCount: 5,
        lastMessageAt: "2026-03-28T09:00:05.000Z"
      })
    );
    expect(sessionStatusSnapshotRepository.findBySessionId(runtimeSessionId)).toEqual(
      expect.objectContaining({
        syncStatus: "error",
        syncCursor: "cursor-1",
        lastErrorCode: "CLAUDE_SYNC_FAILED"
      })
    );
    expect(sessionStateRepository.findBySessionAndUser(runtimeSessionId, "user-1")).toEqual(
      expect.objectContaining({
        runningState: "running",
        activitySource: "runtime",
        favorite: true
      })
    );
    expect(sessionChangedFileRepository.listBySessionId(runtimeSessionId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/runtime/claude.ts",
          lastToolName: "apply_patch"
        })
      ])
    );
    expect(
      database.db
        .prepare("SELECT session_id FROM session_send_queue WHERE id = ?")
        .get("queue-1")
    ).toEqual({
      session_id: runtimeSessionId
    });
  });

  it("Claude runtime 已回填真 ID 后再次持久化同一个 binding 时，仍会并回同工作区重复记录", async () => {
    const fixture = createEmptyFixture();
    const config = resolveHostConfig({
      databasePath: ":memory:",
      claudeCodeHomeDir: fixture.claudeHomeDir,
      codexHomeDir: fixture.codexHomeDir
    });
    const database = createDatabaseClient(":memory:");
    const workspaceRepository = new WorkspaceRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const sessionStateRepository = new SessionStateRepository(database.db);
    const sessionStatusSnapshotRepository = new SessionStatusSnapshotRepository(database.db);
    const sessionChangedFileService = new SessionChangedFileService(
      new SessionChangedFileRepository(database.db)
    );
    const sessionMessageAttachmentService = new SessionMessageAttachmentService(
      new SessionMessageAttachmentRepository(database.db),
      config
    );
    const sessionHistoryService = new SessionHistoryService(
      database.db,
      workspaceRepository,
      sessionBindingRepository,
      sessionChangedFileService,
      sessionIndexRepository,
      sessionMessageAttachmentService,
      sessionStateRepository,
      sessionStatusSnapshotRepository,
      config
    );
    const runtimeSessionId = "runtime-session-real";
    const duplicateSessionId = "duplicate-session-real";
    const providerSessionId = "claude-session-real";
    const oldProviderSessionId = "claude-session-old";
    const rawStoreRef = path.join(
      fixture.claudeHomeDir,
      "projects",
      "fixture-workspace",
      `${providerSessionId}.jsonl`
    );
    const oldRawStoreRef = path.join(
      fixture.claudeHomeDir,
      "projects",
      "fixture-workspace",
      `${oldProviderSessionId}.jsonl`
    );

    activeEmptyFixtures.push(fixture);
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
        "2026-03-28T10:00:00.000Z",
        "2026-03-28T10:00:00.000Z"
      );

    workspaceRepository.create({
      id: "workspace-1",
      name: "Fixture Workspace",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: "2026-03-28T10:00:00.000Z",
      updatedAt: "2026-03-28T10:00:00.000Z",
      removedAt: null
    });

    sessionBindingRepository.upsert({
      sessionId: runtimeSessionId,
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: oldProviderSessionId,
      rawStoreRef: oldRawStoreRef,
      createdAt: "2026-03-28T10:00:01.000Z",
      updatedAt: "2026-03-28T10:00:02.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: runtimeSessionId,
      workspaceId: "workspace-1",
      provider: "claude-code",
      title: "继续当前运行中的会话",
      messageCount: 2,
      isArchived: false,
      lastMessageAt: "2026-03-28T10:00:03.000Z",
      createdAt: "2026-03-28T10:00:01.000Z",
      updatedAt: "2026-03-28T10:00:03.000Z"
    });
    sessionStateRepository.upsert({
      sessionId: runtimeSessionId,
      userId: "user-1",
      runningState: "running",
      activitySource: "runtime",
      favorite: false,
      lastEventAt: "2026-03-28T10:00:03.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-03-28T10:00:03.000Z"
    });

    sessionBindingRepository.upsert({
      sessionId: duplicateSessionId,
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId,
      rawStoreRef,
      createdAt: "2026-03-28T10:00:04.000Z",
      updatedAt: "2026-03-28T10:00:04.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: duplicateSessionId,
      workspaceId: "workspace-1",
      provider: "claude-code",
      title: "后台发现出来的重复记录",
      messageCount: 6,
      isArchived: false,
      lastMessageAt: "2026-03-28T10:00:05.000Z",
      createdAt: "2026-03-28T10:00:04.000Z",
      updatedAt: "2026-03-28T10:00:05.000Z"
    });
    sessionStateRepository.upsert({
      sessionId: duplicateSessionId,
      userId: "user-1",
      runningState: "idle",
      activitySource: "none",
      favorite: true,
      lastEventAt: "2026-03-28T10:00:05.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-03-28T10:00:05.000Z"
    });

    sessionHistoryService.persistSessionBinding(runtimeSessionId, "workspace-1", {
      provider: "claude-code",
      providerSessionId,
      rawStoreRef
    });

    expect(sessionBindingRepository.findBySessionId(duplicateSessionId)).toEqual(
      expect.objectContaining({
        sessionId: duplicateSessionId,
        providerSessionId: `alias://claude-code/${runtimeSessionId}/${duplicateSessionId}`,
        rawStoreRef: `alias://claude-code/${runtimeSessionId}/${duplicateSessionId}`
      })
    );
    expect(sessionIndexRepository.findIndexRecordBySessionId(duplicateSessionId)).toEqual(
      expect.objectContaining({
        sessionId: duplicateSessionId
      })
    );
    expect(sessionHistoryService.getBindingOrThrow(duplicateSessionId)).toEqual(
      expect.objectContaining({
        sessionId: runtimeSessionId,
        providerSessionId,
        rawStoreRef
      })
    );
    expect(sessionBindingRepository.findByProviderSession("claude-code", providerSessionId)).toEqual(
      expect.objectContaining({
        sessionId: runtimeSessionId,
        providerSessionId,
        rawStoreRef
      })
    );
    expect(sessionIndexRepository.findIndexRecordBySessionId(runtimeSessionId)).toEqual(
      expect.objectContaining({
        title: "继续当前运行中的会话",
        messageCount: 6,
        lastMessageAt: "2026-03-28T10:00:05.000Z"
      })
    );
    expect(sessionStateRepository.findBySessionAndUser(runtimeSessionId, "user-1")).toEqual(
      expect.objectContaining({
        runningState: "running",
        activitySource: "runtime",
        favorite: true
      })
    );
  });

  it("Claude 新会话首次回填真 binding 时，目标 binding 和 index 尚未存在也会接管重复记录", () => {
    const fixture = createEmptyFixture();
    const config = resolveHostConfig({
      databasePath: ":memory:",
      claudeCodeHomeDir: fixture.claudeHomeDir,
      codexHomeDir: fixture.codexHomeDir
    });
    const database = createDatabaseClient(":memory:");
    const workspaceRepository = new WorkspaceRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const sessionStateRepository = new SessionStateRepository(database.db);
    const sessionStatusSnapshotRepository = new SessionStatusSnapshotRepository(database.db);
    const sessionChangedFileService = new SessionChangedFileService(
      new SessionChangedFileRepository(database.db)
    );
    const sessionMessageAttachmentService = new SessionMessageAttachmentService(
      new SessionMessageAttachmentRepository(database.db),
      config
    );
    const sessionHistoryService = new SessionHistoryService(
      database.db,
      workspaceRepository,
      sessionBindingRepository,
      sessionChangedFileService,
      sessionIndexRepository,
      sessionMessageAttachmentService,
      sessionStateRepository,
      sessionStatusSnapshotRepository,
      config
    );
    const runtimeSessionId = "runtime-session-first-bind";
    const duplicateSessionId = "duplicate-session-first-bind";
    const providerSessionId = "claude-session-first-bind";
    const rawStoreRef = path.join(
      fixture.claudeHomeDir,
      "projects",
      "fixture-workspace",
      `${providerSessionId}.jsonl`
    );

    activeEmptyFixtures.push(fixture);
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
        "2026-03-28T10:00:00.000Z",
        "2026-03-28T10:00:00.000Z"
      );

    workspaceRepository.create({
      id: "workspace-1",
      name: "Fixture Workspace",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: "2026-03-28T10:00:00.000Z",
      updatedAt: "2026-03-28T10:00:00.000Z",
      removedAt: null
    });

    sessionBindingRepository.upsert({
      sessionId: duplicateSessionId,
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId,
      rawStoreRef,
      createdAt: "2026-03-28T10:00:04.000Z",
      updatedAt: "2026-03-28T10:00:04.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: duplicateSessionId,
      workspaceId: "workspace-1",
      provider: "claude-code",
      title: "后台发现出来的重复记录",
      messageCount: 6,
      isArchived: false,
      lastMessageAt: "2026-03-28T10:00:05.000Z",
      createdAt: "2026-03-28T10:00:04.000Z",
      updatedAt: "2026-03-28T10:00:05.000Z"
    });
    sessionStateRepository.upsert({
      sessionId: duplicateSessionId,
      userId: "user-1",
      runningState: "idle",
      activitySource: "none",
      favorite: true,
      lastEventAt: "2026-03-28T10:00:05.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-03-28T10:00:05.000Z"
    });
    sessionStatusSnapshotRepository.upsert({
      sessionId: duplicateSessionId,
      syncStatus: "error",
      syncCursor: "cursor-1",
      lastSyncAt: "2026-03-28T10:00:05.000Z",
      lastErrorCode: "CLAUDE_SYNC_FAILED",
      lastErrorDetail: "后台发现记录同步失败",
      resumedAt: null,
      updatedAt: "2026-03-28T10:00:05.000Z"
    });

    expect(() =>
      sessionHistoryService.persistSessionBinding(runtimeSessionId, "workspace-1", {
        provider: "claude-code",
        providerSessionId,
        rawStoreRef
      })
    ).not.toThrow();

    expect(sessionBindingRepository.findBySessionId(runtimeSessionId)).toEqual(
      expect.objectContaining({
        sessionId: runtimeSessionId,
        provider: "claude-code",
        providerSessionId,
        rawStoreRef
      })
    );
    expect(sessionIndexRepository.findIndexRecordBySessionId(runtimeSessionId)).toEqual(
      expect.objectContaining({
        sessionId: runtimeSessionId,
        title: "后台发现出来的重复记录",
        messageCount: 6,
        lastMessageAt: "2026-03-28T10:00:05.000Z"
      })
    );
    expect(sessionStatusSnapshotRepository.findBySessionId(runtimeSessionId)).toEqual(
      expect.objectContaining({
        sessionId: runtimeSessionId,
        syncStatus: "error",
        syncCursor: "cursor-1",
        lastErrorCode: "CLAUDE_SYNC_FAILED"
      })
    );
    expect(sessionBindingRepository.findBySessionId(duplicateSessionId)).toEqual(
      expect.objectContaining({
        sessionId: duplicateSessionId,
        providerSessionId: `alias://claude-code/${runtimeSessionId}/${duplicateSessionId}`,
        rawStoreRef: `alias://claude-code/${runtimeSessionId}/${duplicateSessionId}`
      })
    );
    expect(sessionHistoryService.getBindingOrThrow(duplicateSessionId)).toEqual(
      expect.objectContaining({
        sessionId: runtimeSessionId,
        providerSessionId,
        rawStoreRef
      })
    );
  });

  it("Codex 新会话首次回填真 binding 时，目标 binding 和 index 尚未存在也会接管重复记录", () => {
    const fixture = createEmptyFixture();
    const config = resolveHostConfig({
      databasePath: ":memory:",
      claudeCodeHomeDir: fixture.claudeHomeDir,
      codexHomeDir: fixture.codexHomeDir
    });
    const database = createDatabaseClient(":memory:");
    const workspaceRepository = new WorkspaceRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const sessionStateRepository = new SessionStateRepository(database.db);
    const sessionStatusSnapshotRepository = new SessionStatusSnapshotRepository(database.db);
    const sessionChangedFileService = new SessionChangedFileService(
      new SessionChangedFileRepository(database.db)
    );
    const sessionMessageAttachmentService = new SessionMessageAttachmentService(
      new SessionMessageAttachmentRepository(database.db),
      config
    );
    const sessionHistoryService = new SessionHistoryService(
      database.db,
      workspaceRepository,
      sessionBindingRepository,
      sessionChangedFileService,
      sessionIndexRepository,
      sessionMessageAttachmentService,
      sessionStateRepository,
      sessionStatusSnapshotRepository,
      config
    );
    const runtimeSessionId = "runtime-session-codex-first-bind";
    const duplicateSessionId = "duplicate-session-codex-first-bind";
    const providerSessionId = "codex-session-first-bind";
    const rawStoreRef = writeCodexSessionFile({
      codexHomeDir: fixture.codexHomeDir,
      workspaceDir: fixture.workspaceDir,
      fileName: providerSessionId,
      timestamps: [
        "2026-03-23T09:00:00.000Z",
        "2026-03-23T09:00:01.000Z",
        "2026-03-23T09:00:02.000Z"
      ]
    });

    activeEmptyFixtures.push(fixture);
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
        "2026-03-28T11:00:00.000Z",
        "2026-03-28T11:00:00.000Z"
      );

    workspaceRepository.create({
      id: "workspace-1",
      name: "Fixture Workspace",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: "2026-03-28T11:00:00.000Z",
      updatedAt: "2026-03-28T11:00:00.000Z",
      removedAt: null
    });

    sessionBindingRepository.upsert({
      sessionId: duplicateSessionId,
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId,
      rawStoreRef,
      createdAt: "2026-03-28T11:00:04.000Z",
      updatedAt: "2026-03-28T11:00:04.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: duplicateSessionId,
      workspaceId: "workspace-1",
      provider: "codex",
      title: "后台发现出来的 Codex 会话",
      messageCount: 6,
      isArchived: false,
      lastMessageAt: "2026-03-28T11:00:05.000Z",
      createdAt: "2026-03-28T11:00:04.000Z",
      updatedAt: "2026-03-28T11:00:05.000Z"
    });
    sessionStateRepository.upsert({
      sessionId: duplicateSessionId,
      userId: "user-1",
      runningState: "idle",
      activitySource: "none",
      favorite: true,
      lastEventAt: "2026-03-28T11:00:05.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-03-28T11:00:05.000Z"
    });
    sessionStatusSnapshotRepository.upsert({
      sessionId: duplicateSessionId,
      syncStatus: "error",
      syncCursor: "cursor-codex-1",
      lastSyncAt: "2026-03-28T11:00:05.000Z",
      lastErrorCode: "CODEX_SYNC_FAILED",
      lastErrorDetail: "Codex 后台发现记录同步失败",
      resumedAt: null,
      updatedAt: "2026-03-28T11:00:05.000Z"
    });

    expect(() =>
      sessionHistoryService.persistSessionBinding(runtimeSessionId, "workspace-1", {
        provider: "codex",
        providerSessionId,
        rawStoreRef
      })
    ).not.toThrow();

    expect(sessionBindingRepository.findBySessionId(runtimeSessionId)).toEqual(
      expect.objectContaining({
        sessionId: runtimeSessionId,
        provider: "codex",
        providerSessionId,
        rawStoreRef
      })
    );
    expect(sessionIndexRepository.findIndexRecordBySessionId(runtimeSessionId)).toEqual(
      expect.objectContaining({
        sessionId: runtimeSessionId,
        title: "后台发现出来的 Codex 会话",
        messageCount: 6,
        lastMessageAt: "2026-03-28T11:00:05.000Z"
      })
    );
    expect(sessionStatusSnapshotRepository.findBySessionId(runtimeSessionId)).toEqual(
      expect.objectContaining({
        sessionId: runtimeSessionId,
        syncStatus: "error",
        syncCursor: "cursor-codex-1",
        lastErrorCode: "CODEX_SYNC_FAILED"
      })
    );
    expect(sessionBindingRepository.findBySessionId(duplicateSessionId)).toEqual(
      expect.objectContaining({
        sessionId: duplicateSessionId,
        providerSessionId: `alias://codex/${runtimeSessionId}/${duplicateSessionId}`,
        rawStoreRef: `alias://codex/${runtimeSessionId}/${duplicateSessionId}`
      })
    );
    expect(sessionHistoryService.getBindingOrThrow(duplicateSessionId)).toEqual(
      expect.objectContaining({
        sessionId: runtimeSessionId,
        providerSessionId,
        rawStoreRef
      })
    );
  });

  it("persistSessionBinding 会在事务开始前出现重复 binding 时重新接管，避免撞上 provider 唯一约束", () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "session-binding-race.sqlite");
    const config = resolveHostConfig({
      databasePath,
      claudeCodeHomeDir: fixture.claudeHomeDir,
      codexHomeDir: fixture.codexHomeDir
    });
    const database = createDatabaseClient(databasePath);
    const workspaceRepository = new WorkspaceRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const sessionStateRepository = new SessionStateRepository(database.db);
    const sessionStatusSnapshotRepository = new SessionStatusSnapshotRepository(database.db);
    const sessionChangedFileService = new SessionChangedFileService(
      new SessionChangedFileRepository(database.db)
    );
    const sessionMessageAttachmentService = new SessionMessageAttachmentService(
      new SessionMessageAttachmentRepository(database.db),
      config
    );
    const sessionHistoryService = new SessionHistoryService(
      database.db,
      workspaceRepository,
      sessionBindingRepository,
      sessionChangedFileService,
      sessionIndexRepository,
      sessionMessageAttachmentService,
      sessionStateRepository,
      sessionStatusSnapshotRepository,
      config
    );
    const runtimeSessionId = "runtime-session-race";
    const duplicateSessionId = "duplicate-session-race";
    const providerSessionId = "codex-session-race";
    const oldProviderSessionId = "codex-session-old";
    const rawStoreRef = path.join(
      fixture.codexHomeDir,
      "sessions",
      `${providerSessionId}.jsonl`
    );
    const oldRawStoreRef = path.join(
      fixture.codexHomeDir,
      "sessions",
      `${oldProviderSessionId}.jsonl`
    );

    activeEmptyFixtures.push(fixture);
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
        "2026-04-15T10:00:00.000Z",
        "2026-04-15T10:00:00.000Z"
      );

    workspaceRepository.create({
      id: "workspace-1",
      name: "Fixture Workspace",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: "2026-04-15T10:00:00.000Z",
      updatedAt: "2026-04-15T10:00:00.000Z",
      removedAt: null
    });

    sessionBindingRepository.upsert({
      sessionId: runtimeSessionId,
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: oldProviderSessionId,
      rawStoreRef: oldRawStoreRef,
      createdAt: "2026-04-15T10:00:01.000Z",
      updatedAt: "2026-04-15T10:00:02.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: runtimeSessionId,
      workspaceId: "workspace-1",
      provider: "codex",
      title: "继续当前运行中的会话",
      messageCount: 2,
      isArchived: false,
      lastMessageAt: "2026-04-15T10:00:03.000Z",
      createdAt: "2026-04-15T10:00:01.000Z",
      updatedAt: "2026-04-15T10:00:03.000Z"
    });
    sessionStateRepository.upsert({
      sessionId: runtimeSessionId,
      userId: "user-1",
      runningState: "running",
      activitySource: "runtime",
      favorite: false,
      lastEventAt: "2026-04-15T10:00:03.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-04-15T10:00:03.000Z"
    });

    const originalTransaction = database.db.transaction.bind(database.db);
    let injectedDuplicate = false;
    const transactionSpy = vi.spyOn(database.db, "transaction").mockImplementation(((fn: (...args: unknown[]) => unknown) => {
      const wrapped = originalTransaction(fn as Parameters<typeof originalTransaction>[0]);

      return ((...args: unknown[]) => {
        if (!injectedDuplicate) {
          injectedDuplicate = true;
          sessionBindingRepository.upsert({
            sessionId: duplicateSessionId,
            workspaceId: "workspace-1",
            provider: "codex",
            providerSessionId,
            rawStoreRef,
            createdAt: "2026-04-15T10:00:04.000Z",
            updatedAt: "2026-04-15T10:00:04.000Z"
          });
          sessionIndexRepository.upsert({
            sessionId: duplicateSessionId,
            workspaceId: "workspace-1",
            provider: "codex",
            title: "后台发现出来的 Codex 会话",
            messageCount: 6,
            isArchived: false,
            lastMessageAt: "2026-04-15T10:00:05.000Z",
            createdAt: "2026-04-15T10:00:04.000Z",
            updatedAt: "2026-04-15T10:00:05.000Z"
          });
          sessionStateRepository.upsert({
            sessionId: duplicateSessionId,
            userId: "user-1",
            runningState: "idle",
            activitySource: "none",
            favorite: true,
            lastEventAt: "2026-04-15T10:00:05.000Z",
            completedAt: null,
            lastSeenAt: null,
            updatedAt: "2026-04-15T10:00:05.000Z"
          });
        }

        return wrapped(...args);
      }) as ReturnType<typeof originalTransaction>;
    }) as typeof database.db.transaction);

    try {
      expect(() =>
        sessionHistoryService.persistSessionBinding(runtimeSessionId, "workspace-1", {
          provider: "codex",
          providerSessionId,
          rawStoreRef
        })
      ).not.toThrow();
    } finally {
      transactionSpy.mockRestore();
    }

    expect(sessionBindingRepository.findBySessionId(runtimeSessionId)).toEqual(
      expect.objectContaining({
        sessionId: runtimeSessionId,
        provider: "codex",
        providerSessionId,
        rawStoreRef
      })
    );
    expect(sessionBindingRepository.findBySessionId(duplicateSessionId)).toEqual(
      expect.objectContaining({
        sessionId: duplicateSessionId,
        providerSessionId: `alias://codex/${runtimeSessionId}/${duplicateSessionId}`,
        rawStoreRef: `alias://codex/${runtimeSessionId}/${duplicateSessionId}`
      })
    );
    expect(sessionIndexRepository.findIndexRecordBySessionId(runtimeSessionId)).toEqual(
      expect.objectContaining({
        title: "继续当前运行中的会话",
        messageCount: 6,
        lastMessageAt: "2026-04-15T10:00:05.000Z"
      })
    );
    expect(sessionStateRepository.findBySessionAndUser(runtimeSessionId, "user-1")).toEqual(
      expect.objectContaining({
        runningState: "running",
        favorite: true
      })
    );
  });

  it("markSessionError 遇到已失效 session 时会直接跳过，不再触发外键异常", () => {
    const fixture = createEmptyFixture();
    const config = resolveHostConfig({
      databasePath: ":memory:",
      claudeCodeHomeDir: fixture.claudeHomeDir,
      codexHomeDir: fixture.codexHomeDir
    });
    const database = createDatabaseClient(":memory:");
    const workspaceRepository = new WorkspaceRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const sessionStateRepository = new SessionStateRepository(database.db);
    const sessionStatusSnapshotRepository = new SessionStatusSnapshotRepository(database.db);
    const sessionChangedFileService = new SessionChangedFileService(
      new SessionChangedFileRepository(database.db)
    );
    const sessionMessageAttachmentService = new SessionMessageAttachmentService(
      new SessionMessageAttachmentRepository(database.db),
      config
    );
    const sessionHistoryService = new SessionHistoryService(
      database.db,
      workspaceRepository,
      sessionBindingRepository,
      sessionChangedFileService,
      sessionIndexRepository,
      sessionMessageAttachmentService,
      sessionStateRepository,
      sessionStatusSnapshotRepository,
      config
    );

    activeEmptyFixtures.push(fixture);
    activeClosers.push(() => database.close());

    expect(() =>
      (sessionHistoryService as unknown as { markSessionError: (sessionId: string, errorCode: string, error: unknown) => void })
        .markSessionError("missing-session", "RESUME_FAILED", new Error("boom"))
    ).not.toThrow();
    expect(sessionStatusSnapshotRepository.findBySessionId("missing-session")).toBeNull();
  });

  it("getSession 会把只有 alias binding 的旧 sessionId 解析到真实 session", () => {
    const fixture = createEmptyFixture();
    const config = resolveHostConfig({
      databasePath: ":memory:",
      claudeCodeHomeDir: fixture.claudeHomeDir,
      codexHomeDir: fixture.codexHomeDir
    });
    const database = createDatabaseClient(":memory:");
    const workspaceRepository = new WorkspaceRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const sessionStateRepository = new SessionStateRepository(database.db);
    const sessionStatusSnapshotRepository = new SessionStatusSnapshotRepository(database.db);
    const sessionChangedFileService = new SessionChangedFileService(
      new SessionChangedFileRepository(database.db)
    );
    const sessionMessageAttachmentService = new SessionMessageAttachmentService(
      new SessionMessageAttachmentRepository(database.db),
      config
    );
    const sessionHistoryService = new SessionHistoryService(
      database.db,
      workspaceRepository,
      sessionBindingRepository,
      sessionChangedFileService,
      sessionIndexRepository,
      sessionMessageAttachmentService,
      sessionStateRepository,
      sessionStatusSnapshotRepository,
      config
    );

    activeEmptyFixtures.push(fixture);
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
        "2026-04-15T10:00:00.000Z",
        "2026-04-15T10:00:00.000Z"
      );
    workspaceRepository.create({
      id: "workspace-1",
      name: "Fixture Workspace",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: "2026-04-15T10:00:00.000Z",
      updatedAt: "2026-04-15T10:00:00.000Z",
      removedAt: null
    });
    sessionBindingRepository.upsert({
      sessionId: "session-target",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-target",
      rawStoreRef: "raw-target",
      createdAt: "2026-04-15T10:00:00.000Z",
      updatedAt: "2026-04-15T10:00:00.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: "session-target",
      workspaceId: "workspace-1",
      provider: "codex",
      title: "真实会话",
      messageCount: 6,
      isArchived: false,
      lastMessageAt: "2026-04-15T10:05:00.000Z",
      createdAt: "2026-04-15T10:00:00.000Z",
      updatedAt: "2026-04-15T10:05:00.000Z"
    });
    sessionStateRepository.upsert({
      sessionId: "session-target",
      userId: "user-1",
      runningState: "running",
      activitySource: "runtime",
      favorite: false,
      lastEventAt: "2026-04-15T10:05:00.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-04-15T10:05:00.000Z"
    });
    sessionBindingRepository.upsert({
      sessionId: "session-alias",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "alias://codex/session-target/session-alias",
      rawStoreRef: "alias://codex/session-target/session-alias",
      createdAt: "2026-04-15T10:00:00.000Z",
      updatedAt: "2026-04-15T10:05:01.000Z"
    });

    expect(sessionHistoryService.getSession("session-alias", "user-1")).toEqual(
      expect.objectContaining({
        sessionId: "session-target",
        title: "真实会话",
        providerSessionId: "provider-session-target"
      })
    );
  });

  it("pending 绑定回填真 ID 时如果撞上其他工作区的会话，会直接拒绝跨工作区合并", async () => {
    const fixture = createEmptyFixture();
    const config = resolveHostConfig({
      databasePath: ":memory:",
      claudeCodeHomeDir: fixture.claudeHomeDir,
      codexHomeDir: fixture.codexHomeDir
    });
    const database = createDatabaseClient(":memory:");
    const workspaceRepository = new WorkspaceRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const sessionStateRepository = new SessionStateRepository(database.db);
    const sessionStatusSnapshotRepository = new SessionStatusSnapshotRepository(database.db);
    const sessionChangedFileService = new SessionChangedFileService(
      new SessionChangedFileRepository(database.db)
    );
    const sessionMessageAttachmentService = new SessionMessageAttachmentService(
      new SessionMessageAttachmentRepository(database.db),
      config
    );
    const sessionHistoryService = new SessionHistoryService(
      database.db,
      workspaceRepository,
      sessionBindingRepository,
      sessionChangedFileService,
      sessionIndexRepository,
      sessionMessageAttachmentService,
      sessionStateRepository,
      sessionStatusSnapshotRepository,
      config
    );
    const runtimeSessionId = "runtime-session-cross-workspace";
    const discoveredSessionId = "discovered-session-cross-workspace";
    const providerSessionId = "claude-session-cross-workspace";
    const rawStoreRef = path.join(
      fixture.claudeHomeDir,
      "projects",
      "workspace-b",
      `${providerSessionId}.jsonl`
    );
    const workspaceBPath = path.join(fixture.rootDir, "workspace-b");
    const timestamp = "2026-03-28T11:00:00.000Z";

    activeEmptyFixtures.push(fixture);
    activeClosers.push(() => database.close());

    mkdirSync(workspaceBPath, { recursive: true });

    database.db
      .prepare(
        `INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("user-1", "tester", "hash", "admin", timestamp, timestamp);

    workspaceRepository.create({
      id: "workspace-1",
      name: "Workspace A",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      removedAt: null
    });
    workspaceRepository.create({
      id: "workspace-2",
      name: "Workspace B",
      path: workspaceBPath,
      repoRoot: workspaceBPath,
      favorite: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      removedAt: null
    });

    sessionBindingRepository.upsert({
      sessionId: runtimeSessionId,
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "pending://claude-code/runtime-session-cross-workspace",
      rawStoreRef: "pending://claude-code/runtime-session-cross-workspace",
      createdAt: "2026-03-28T11:00:01.000Z",
      updatedAt: "2026-03-28T11:00:01.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: runtimeSessionId,
      workspaceId: "workspace-1",
      provider: "claude-code",
      title: "工作区 A 的 pending 会话",
      messageCount: 1,
      isArchived: false,
      lastMessageAt: "2026-03-28T11:00:02.000Z",
      createdAt: "2026-03-28T11:00:01.000Z",
      updatedAt: "2026-03-28T11:00:02.000Z"
    });

    sessionBindingRepository.upsert({
      sessionId: discoveredSessionId,
      workspaceId: "workspace-2",
      provider: "claude-code",
      providerSessionId,
      rawStoreRef,
      createdAt: "2026-03-28T11:00:03.000Z",
      updatedAt: "2026-03-28T11:00:03.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: discoveredSessionId,
      workspaceId: "workspace-2",
      provider: "claude-code",
      title: "工作区 B 的真实会话",
      messageCount: 4,
      isArchived: false,
      lastMessageAt: "2026-03-28T11:00:04.000Z",
      createdAt: "2026-03-28T11:00:03.000Z",
      updatedAt: "2026-03-28T11:00:04.000Z"
    });

    expect(() =>
      sessionHistoryService.persistSessionBinding(runtimeSessionId, "workspace-1", {
        provider: "claude-code",
        providerSessionId,
        rawStoreRef
      })
    ).toThrowError("SESSION_BINDING_WORKSPACE_CONFLICT");

    expect(sessionBindingRepository.findBySessionId(runtimeSessionId)).toEqual(
      expect.objectContaining({
        workspaceId: "workspace-1",
        providerSessionId: "pending://claude-code/runtime-session-cross-workspace"
      })
    );
    expect(sessionBindingRepository.findBySessionId(discoveredSessionId)).toEqual(
      expect.objectContaining({
        workspaceId: "workspace-2",
        providerSessionId
      })
    );
    expect(sessionIndexRepository.findIndexRecordBySessionId(runtimeSessionId)).toEqual(
      expect.objectContaining({
        workspaceId: "workspace-1",
        title: "工作区 A 的 pending 会话"
      })
    );
    expect(sessionIndexRepository.findIndexRecordBySessionId(discoveredSessionId)).toEqual(
      expect.objectContaining({
        workspaceId: "workspace-2",
        title: "工作区 B 的真实会话"
      })
    );
  });

  it("工作区扫描发现撞上其他工作区已有会话时，不会把旧会话重绑到当前工作区", async () => {
    const fixture = createEmptyFixture();
    const config = resolveHostConfig({
      databasePath: ":memory:",
      claudeCodeHomeDir: fixture.claudeHomeDir,
      codexHomeDir: fixture.codexHomeDir
    });
    const database = createDatabaseClient(":memory:");
    const workspaceRepository = new WorkspaceRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const sessionStateRepository = new SessionStateRepository(database.db);
    const sessionStatusSnapshotRepository = new SessionStatusSnapshotRepository(database.db);
    const sessionChangedFileService = new SessionChangedFileService(
      new SessionChangedFileRepository(database.db)
    );
    const sessionMessageAttachmentService = new SessionMessageAttachmentService(
      new SessionMessageAttachmentRepository(database.db),
      config
    );
    const sessionHistoryService = new SessionHistoryService(
      database.db,
      workspaceRepository,
      sessionBindingRepository,
      sessionChangedFileService,
      sessionIndexRepository,
      sessionMessageAttachmentService,
      sessionStateRepository,
      sessionStatusSnapshotRepository,
      config
    );
    const workspaceBPath = path.join(fixture.rootDir, "workspace-b");
    const timestamp = "2026-03-28T12:00:00.000Z";

    activeEmptyFixtures.push(fixture);
    activeClosers.push(() => database.close());

    mkdirSync(workspaceBPath, { recursive: true });

    database.db
      .prepare(
        `INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("user-1", "tester", "hash", "admin", timestamp, timestamp);

    workspaceRepository.create({
      id: "workspace-1",
      name: "Workspace A",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      removedAt: null
    });
    workspaceRepository.create({
      id: "workspace-2",
      name: "Workspace B",
      path: workspaceBPath,
      repoRoot: workspaceBPath,
      favorite: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      removedAt: null
    });

    sessionBindingRepository.upsert({
      sessionId: "existing-workspace-b-session",
      workspaceId: "workspace-2",
      provider: "opencode",
      providerSessionId: "opencode-cross-workspace-session",
      rawStoreRef: "opencode://session/opencode-cross-workspace-session",
      createdAt: "2026-03-28T12:00:01.000Z",
      updatedAt: "2026-03-28T12:00:01.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: "existing-workspace-b-session",
      workspaceId: "workspace-2",
      provider: "opencode",
      title: "Workspace B 已有会话",
      messageCount: 3,
      isArchived: false,
      lastMessageAt: "2026-03-28T12:00:02.000Z",
      createdAt: "2026-03-28T12:00:01.000Z",
      updatedAt: "2026-03-28T12:00:02.000Z"
    });

    const discoverMock = vi.fn().mockResolvedValue({
      sessions: [
        {
          provider: "opencode",
          providerSessionId: "opencode-cross-workspace-session",
          rawStoreRef: "opencode://session/opencode-cross-workspace-session",
          workspacePath: fixture.workspaceDir,
          title: "Workspace A 扫描结果",
          messageCount: 1,
          lastMessageAt: "2026-03-28T12:00:03.000Z",
          createdAt: "2026-03-28T12:00:03.000Z",
          updatedAt: "2026-03-28T12:00:03.000Z",
          isArchived: false,
          metadata: {}
        }
      ],
      isComplete: true
    });

    (
      sessionHistoryService as unknown as {
        sessionSyncService: {
          discoverWorkspaceSessions: typeof discoverMock;
        };
      }
    ).sessionSyncService = {
      discoverWorkspaceSessions: discoverMock
    };

    const items = await sessionHistoryService.discoverWorkspaceSessions("workspace-1", "user-1", {
      force: true,
      refreshStateMode: "deferred"
    });

    expect(items).toEqual([]);
    expect(sessionBindingRepository.findBySessionId("existing-workspace-b-session")).toEqual(
      expect.objectContaining({
        workspaceId: "workspace-2",
        providerSessionId: "opencode-cross-workspace-session"
      })
    );
    expect(sessionIndexRepository.listByWorkspace("workspace-1", "user-1")).toEqual([]);
    expect(sessionIndexRepository.listByWorkspace("workspace-2", "user-1")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: "existing-workspace-b-session",
          workspaceId: "workspace-2",
          title: "Workspace B 已有会话"
        })
      ])
    );
  });

  it("Claude 后台扫描发现真实 transcript 时，会直接复用同标题的 pending 运行时会话", async () => {
    const fixture = createEmptyFixture();
    const config = resolveHostConfig({
      databasePath: ":memory:",
      claudeCodeHomeDir: fixture.claudeHomeDir,
      codexHomeDir: fixture.codexHomeDir
    });
    const database = createDatabaseClient(":memory:");
    const workspaceRepository = new WorkspaceRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const sessionStateRepository = new SessionStateRepository(database.db);
    const sessionStatusSnapshotRepository = new SessionStatusSnapshotRepository(database.db);
    const sessionChangedFileService = new SessionChangedFileService(
      new SessionChangedFileRepository(database.db)
    );
    const sessionMessageAttachmentService = new SessionMessageAttachmentService(
      new SessionMessageAttachmentRepository(database.db),
      config
    );
    const sessionHistoryService = new SessionHistoryService(
      database.db,
      workspaceRepository,
      sessionBindingRepository,
      sessionChangedFileService,
      sessionIndexRepository,
      sessionMessageAttachmentService,
      sessionStateRepository,
      sessionStatusSnapshotRepository,
      config
    );
    const runtimeSessionId = "runtime-pending-session";
    const providerSessionId = "claude-session-real-1";
    const title = "再次对话测试";
    const claudeProjectDir = path.join(
      fixture.claudeHomeDir,
      "projects",
      workspaceSlugForTest(fixture.workspaceDir)
    );
    const rawStoreRef = path.join(claudeProjectDir, `${providerSessionId}.jsonl`);

    activeEmptyFixtures.push(fixture);
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
        "2026-03-29T09:00:00.000Z",
        "2026-03-29T09:00:00.000Z"
      );

    workspaceRepository.create({
      id: "workspace-1",
      name: "Fixture Workspace",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: "2026-03-29T09:00:00.000Z",
      updatedAt: "2026-03-29T09:00:00.000Z",
      removedAt: null
    });

    sessionBindingRepository.upsert({
      sessionId: runtimeSessionId,
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "pending://claude-code/runtime-pending-session",
      rawStoreRef: path.join(claudeProjectDir, `.pending-${runtimeSessionId}.jsonl`),
      createdAt: "2026-03-29T09:00:01.000Z",
      updatedAt: "2026-03-29T09:00:01.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: runtimeSessionId,
      workspaceId: "workspace-1",
      provider: "claude-code",
      title,
      messageCount: 1,
      isArchived: false,
      lastMessageAt: "2026-03-29T09:00:02.000Z",
      createdAt: "2026-03-29T09:00:01.000Z",
      updatedAt: "2026-03-29T09:00:02.000Z"
    });
    sessionStateRepository.upsert({
      sessionId: runtimeSessionId,
      userId: "user-1",
      runningState: "running",
      activitySource: "runtime",
      favorite: false,
      lastEventAt: "2026-03-29T09:00:02.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-03-29T09:00:02.000Z"
    });

    mkdirSync(claudeProjectDir, { recursive: true });
    writeFileSync(
      rawStoreRef,
      [
        JSON.stringify({
          type: "user",
          sessionId: providerSessionId,
          cwd: fixture.workspaceDir,
          timestamp: "2026-03-29T09:00:02.000Z",
          message: {
            role: "user",
            content: [{ type: "text", text: title }]
          }
        }),
        JSON.stringify({
          type: "assistant",
          sessionId: providerSessionId,
          cwd: fixture.workspaceDir,
          timestamp: "2026-03-29T09:00:04.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "好的，我在这里。有什么需要帮助的吗？" }]
          }
        }),
        JSON.stringify({
          type: "ai-title",
          sessionId: providerSessionId,
          aiTitle: title
        })
      ].join("\n"),
      "utf8"
    );

    const items = await sessionHistoryService.discoverWorkspaceSessions(
      "workspace-1",
      "user-1",
      {
        force: true,
        refreshStateMode: "deferred"
      }
    );

    const claudeItems = items.filter((item) => item.provider === "claude-code");

    expect(claudeItems).toHaveLength(1);
    expect(claudeItems[0]).toMatchObject({
      sessionId: runtimeSessionId,
      providerSessionId,
      title
    });
    expect(sessionBindingRepository.findByProviderSession("claude-code", providerSessionId)).toEqual(
      expect.objectContaining({
        sessionId: runtimeSessionId,
        rawStoreRef
      })
    );
  });

  it("Claude 后台扫描发现真实 transcript 时，会复用唯一活跃的 pending 运行时会话，即使标题已经变化", async () => {
    const fixture = createEmptyFixture();
    const config = resolveHostConfig({
      databasePath: ":memory:",
      claudeCodeHomeDir: fixture.claudeHomeDir,
      codexHomeDir: fixture.codexHomeDir
    });
    const database = createDatabaseClient(":memory:");
    const workspaceRepository = new WorkspaceRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const sessionStateRepository = new SessionStateRepository(database.db);
    const sessionStatusSnapshotRepository = new SessionStatusSnapshotRepository(database.db);
    const sessionChangedFileService = new SessionChangedFileService(
      new SessionChangedFileRepository(database.db)
    );
    const sessionMessageAttachmentService = new SessionMessageAttachmentService(
      new SessionMessageAttachmentRepository(database.db),
      config
    );
    const sessionHistoryService = new SessionHistoryService(
      database.db,
      workspaceRepository,
      sessionBindingRepository,
      sessionChangedFileService,
      sessionIndexRepository,
      sessionMessageAttachmentService,
      sessionStateRepository,
      sessionStatusSnapshotRepository,
      config
    );
    const runtimeSessionId = "runtime-pending-active-session";
    const providerSessionId = "claude-session-real-2";
    const claudeProjectDir = path.join(
      fixture.claudeHomeDir,
      "projects",
      workspaceSlugForTest(fixture.workspaceDir)
    );
    const rawStoreRef = path.join(claudeProjectDir, `${providerSessionId}.jsonl`);

    activeEmptyFixtures.push(fixture);
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
        "2026-03-29T10:00:00.000Z",
        "2026-03-29T10:00:00.000Z"
      );

    workspaceRepository.create({
      id: "workspace-1",
      name: "Fixture Workspace",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: "2026-03-29T10:00:00.000Z",
      updatedAt: "2026-03-29T10:00:00.000Z",
      removedAt: null
    });

    sessionBindingRepository.upsert({
      sessionId: runtimeSessionId,
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "pending://claude-code/runtime-pending-active-session",
      rawStoreRef: "pending://claude-code/runtime-pending-active-session",
      createdAt: "2026-03-29T10:00:01.000Z",
      updatedAt: "2026-03-29T10:00:01.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: runtimeSessionId,
      workspaceId: "workspace-1",
      provider: "claude-code",
      title: "启动中的临时标题",
      messageCount: 1,
      isArchived: false,
      lastMessageAt: "2026-03-29T10:00:02.000Z",
      createdAt: "2026-03-29T10:00:01.000Z",
      updatedAt: "2026-03-29T10:00:02.000Z"
    });
    sessionStateRepository.upsert({
      sessionId: runtimeSessionId,
      userId: "user-1",
      runningState: "running",
      activitySource: "runtime",
      favorite: false,
      lastEventAt: "2026-03-29T10:00:02.500Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-03-29T10:00:02.500Z"
    });

    mkdirSync(claudeProjectDir, { recursive: true });
    writeFileSync(
      rawStoreRef,
      [
        JSON.stringify({
          type: "user",
          sessionId: providerSessionId,
          cwd: fixture.workspaceDir,
          timestamp: "2026-03-29T10:00:02.000Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "帮我把这次会话接起来" }]
          }
        }),
        JSON.stringify({
          type: "assistant",
          sessionId: providerSessionId,
          cwd: fixture.workspaceDir,
          timestamp: "2026-03-29T10:00:04.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "已经接上，会继续输出。" }]
          }
        }),
        JSON.stringify({
          type: "ai-title",
          sessionId: providerSessionId,
          aiTitle: "真正标题已经变了"
        })
      ].join("\n"),
      "utf8"
    );

    const items = await sessionHistoryService.discoverWorkspaceSessions(
      "workspace-1",
      "user-1",
      {
        force: true,
        refreshStateMode: "deferred"
      }
    );

    const claudeItems = items.filter((item) => item.provider === "claude-code");

    expect(claudeItems).toHaveLength(1);
    expect(claudeItems[0]).toMatchObject({
      sessionId: runtimeSessionId,
      providerSessionId,
      title: "真正标题已经变了"
    });
    expect(sessionBindingRepository.findByProviderSession("claude-code", providerSessionId)).toEqual(
      expect.objectContaining({
        sessionId: runtimeSessionId,
        rawStoreRef
      })
    );
  });

  it("Claude pending 运行时会话在真 transcript 落盘前读取/订阅历史不会把 pending 标识当文件路径", async () => {
    const fixture = createEmptyFixture();
    const config = resolveHostConfig({
      databasePath: ":memory:",
      claudeCodeHomeDir: fixture.claudeHomeDir,
      codexHomeDir: fixture.codexHomeDir
    });
    const database = createDatabaseClient(":memory:");
    const workspaceRepository = new WorkspaceRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const sessionStateRepository = new SessionStateRepository(database.db);
    const sessionStatusSnapshotRepository = new SessionStatusSnapshotRepository(database.db);
    const sessionChangedFileService = new SessionChangedFileService(
      new SessionChangedFileRepository(database.db)
    );
    const sessionMessageAttachmentService = new SessionMessageAttachmentService(
      new SessionMessageAttachmentRepository(database.db),
      config
    );
    const sessionHistoryService = new SessionHistoryService(
      database.db,
      workspaceRepository,
      sessionBindingRepository,
      sessionChangedFileService,
      sessionIndexRepository,
      sessionMessageAttachmentService,
      sessionStateRepository,
      sessionStatusSnapshotRepository,
      config
    );
    const sessionId = "runtime-pending-read-session";
    const pendingRef = "pending://claude-code/runtime-pending-read-session";

    activeEmptyFixtures.push(fixture);
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
        "2026-03-29T11:00:00.000Z",
        "2026-03-29T11:00:00.000Z"
      );

    workspaceRepository.create({
      id: "workspace-1",
      name: "Fixture Workspace",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: "2026-03-29T11:00:00.000Z",
      updatedAt: "2026-03-29T11:00:00.000Z",
      removedAt: null
    });

    sessionBindingRepository.upsert({
      sessionId,
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: pendingRef,
      rawStoreRef: pendingRef,
      createdAt: "2026-03-29T11:00:01.000Z",
      updatedAt: "2026-03-29T11:00:01.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId,
      workspaceId: "workspace-1",
      provider: "claude-code",
      title: "临时会话",
      messageCount: 0,
      isArchived: false,
      lastMessageAt: null,
      createdAt: "2026-03-29T11:00:01.000Z",
      updatedAt: "2026-03-29T11:00:01.000Z"
    });
    sessionStateRepository.upsert({
      sessionId,
      userId: "user-1",
      runningState: "running",
      activitySource: "runtime",
      favorite: false,
      lastEventAt: "2026-03-29T11:00:01.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-03-29T11:00:01.000Z"
    });

    const page = await sessionHistoryService.readSessionHistory(
      sessionId,
      null,
      20,
      "forward",
      "user-1"
    );
    const delivered: Array<{ type: string; messages: number }> = [];
    const subscription = await sessionHistoryService.subscribeSession(
      sessionId,
      null,
      20,
      (envelope) => {
        delivered.push({
          type: envelope.type,
          messages: envelope.messages.length
        });
      }
    );

    subscription.close();

    expect(page.messages).toEqual([]);
    expect(delivered).toEqual([]);
  });

  it("host 会把 opencode 已知会话传给发现链路，并把不完整发现视为未完成刷新", async () => {
    const fixture = createEmptyFixture();
    const config = resolveHostConfig({
      databasePath: ":memory:",
      claudeCodeHomeDir: fixture.claudeHomeDir,
      codexHomeDir: fixture.codexHomeDir
    });
    const database = createDatabaseClient(":memory:");
    const workspaceRepository = new WorkspaceRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const sessionStateRepository = new SessionStateRepository(database.db);
    const sessionStatusSnapshotRepository = new SessionStatusSnapshotRepository(database.db);
    const sessionChangedFileService = new SessionChangedFileService(
      new SessionChangedFileRepository(database.db)
    );
    const sessionMessageAttachmentService = new SessionMessageAttachmentService(
      new SessionMessageAttachmentRepository(database.db),
      config
    );
    const sessionHistoryService = new SessionHistoryService(
      database.db,
      workspaceRepository,
      sessionBindingRepository,
      sessionChangedFileService,
      sessionIndexRepository,
      sessionMessageAttachmentService,
      sessionStateRepository,
      sessionStatusSnapshotRepository,
      config
    );
    const timestamp = nowIso();

    activeEmptyFixtures.push(fixture);
    activeClosers.push(() => database.close());

    database.db
      .prepare(
        `INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("user-1", "tester", "hash", "admin", timestamp, timestamp);

    workspaceRepository.create({
      id: "workspace-1",
      name: "Fixture Workspace",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      removedAt: null
    });
    sessionBindingRepository.upsert({
      sessionId: "host-session-1",
      workspaceId: "workspace-1",
      provider: "opencode",
      providerSessionId: "op-s-1",
      rawStoreRef: "opencode://session/op-s-1",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    sessionIndexRepository.upsert({
      sessionId: "host-session-1",
      workspaceId: "workspace-1",
      provider: "opencode",
      title: "OpenCode Session",
      messageCount: 3,
      isArchived: false,
      lastMessageAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    const discoverMock = vi
      .fn()
      .mockResolvedValueOnce({
        sessions: [],
        isComplete: false
      })
      .mockResolvedValueOnce({
        sessions: [],
        isComplete: true
      });

    (
      sessionHistoryService as unknown as {
        providerDiscoveryHelperClient: {
          discoverWorkspaceSessions: typeof discoverMock;
        };
      }
    ).providerDiscoveryHelperClient = {
      discoverWorkspaceSessions: discoverMock
    };

    await sessionHistoryService.discoverWorkspaceSessions("workspace-1", "user-1", {
      force: true
    });

    const firstCallOptions = discoverMock.mock.calls[0]?.[0];
    expect(firstCallOptions?.knownSessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "opencode",
          providerSessionId: "op-s-1",
          rawStoreRef: "opencode://session/op-s-1"
        })
      ])
    );
    expect(sessionHistoryService.needsWorkspaceDiscovery("workspace-1", 15_000)).toBe(true);

    await sessionHistoryService.discoverWorkspaceSessions("workspace-1", "user-1", {
      force: true
    });

    expect(sessionHistoryService.needsWorkspaceDiscovery("workspace-1", 15_000)).toBe(false);
  });

  it("首次订阅会话时只回填最近一页，而不是从最旧消息开始扫全量", async () => {
    const fixture = createEmptyFixture();
    const config = resolveHostConfig({
      databasePath: ":memory:",
      claudeCodeHomeDir: fixture.claudeHomeDir,
      codexHomeDir: fixture.codexHomeDir
    });
    const database = createDatabaseClient(":memory:");
    const workspaceRepository = new WorkspaceRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const sessionStateRepository = new SessionStateRepository(database.db);
    const sessionStatusSnapshotRepository = new SessionStatusSnapshotRepository(database.db);
    const sessionChangedFileService = new SessionChangedFileService(
      new SessionChangedFileRepository(database.db)
    );
    const sessionMessageAttachmentService = new SessionMessageAttachmentService(
      new SessionMessageAttachmentRepository(database.db),
      config
    );
    const sessionHistoryService = new SessionHistoryService(
      database.db,
      workspaceRepository,
      sessionBindingRepository,
      sessionChangedFileService,
      sessionIndexRepository,
      sessionMessageAttachmentService,
      sessionStateRepository,
      sessionStatusSnapshotRepository,
      config
    );
    const timestamp = "2026-03-29T12:00:00.000Z";
    const sessionId = "session-recent-backfill";
    const providerSessionId = "codex-session-recent";
    const rawStoreRef = writeCodexSessionFile({
      codexHomeDir: fixture.codexHomeDir,
      workspaceDir: fixture.workspaceDir,
      fileName: providerSessionId,
      timestamps: [
        "2026-03-23T09:00:00.000Z",
        "2026-03-23T09:00:01.000Z",
        "2026-03-23T09:00:02.000Z"
      ]
    });

    appendFileSync(
      rawStoreRef,
      `\n${JSON.stringify({
        timestamp: "2026-03-23T09:00:03.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "第三条消息"
        }
      })}\n${JSON.stringify({
        timestamp: "2026-03-23T09:00:04.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "第四条消息"
        }
      })}\n${JSON.stringify({
        timestamp: "2026-03-23T09:00:05.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "第五条消息"
        }
      })}`,
      "utf8"
    );

    activeEmptyFixtures.push(fixture);
    activeClosers.push(() => database.close());

    database.db
      .prepare(
        `INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("user-1", "tester", "hash", "admin", timestamp, timestamp);

    workspaceRepository.create({
      id: "workspace-1",
      name: "Fixture Workspace",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      removedAt: null
    });
    sessionBindingRepository.upsert({
      sessionId,
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId,
      rawStoreRef,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    sessionIndexRepository.upsert({
      sessionId,
      workspaceId: "workspace-1",
      provider: "codex",
      title: "recent backfill test",
      messageCount: 5,
      isArchived: false,
      lastMessageAt: "2026-03-23T09:00:05.000Z",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    sessionStateRepository.upsert({
      sessionId,
      userId: "user-1",
      runningState: "idle",
      activitySource: "none",
      favorite: false,
      lastEventAt: "2026-03-23T09:00:05.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: timestamp
    });

    const delivered: Array<{ type: string; messages: string[]; cursor: string | null }> = [];
    const subscription = await sessionHistoryService.subscribeSession(
      sessionId,
      null,
      2,
      (envelope) => {
        delivered.push({
          type: envelope.type,
          messages: envelope.messages.map((message) => message.content),
          cursor: envelope.cursor
        });
      }
    );

    subscription.close();

    expect(delivered).toEqual([
      {
        type: "session.backfill",
        messages: ["第四条消息", "第五条消息"],
        cursor: expect.any(String)
      }
    ]);
  });

  it("Codex 订阅空 delta 时会重读尾部，修正运行中回写的消息位置", async () => {
    const fixture = createEmptyFixture();
    const config = resolveHostConfig({
      databasePath: ":memory:",
      claudeCodeHomeDir: fixture.claudeHomeDir,
      codexHomeDir: fixture.codexHomeDir
    });
    const database = createDatabaseClient(":memory:");
    const workspaceRepository = new WorkspaceRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const sessionStateRepository = new SessionStateRepository(database.db);
    const sessionStatusSnapshotRepository = new SessionStatusSnapshotRepository(database.db);
    const sessionChangedFileService = new SessionChangedFileService(
      new SessionChangedFileRepository(database.db)
    );
    const sessionMessageAttachmentService = new SessionMessageAttachmentService(
      new SessionMessageAttachmentRepository(database.db),
      config
    );
    const sessionHistoryService = new SessionHistoryService(
      database.db,
      workspaceRepository,
      sessionBindingRepository,
      sessionChangedFileService,
      sessionIndexRepository,
      sessionMessageAttachmentService,
      sessionStateRepository,
      sessionStatusSnapshotRepository,
      config
    );
    const timestamp = "2026-03-29T12:10:00.000Z";
    const sessionId = "session-codex-tail-refresh";
    const providerSessionId = "codex-session-tail-refresh";
    const rawStoreRef = writeCodexSessionFile({
      codexHomeDir: fixture.codexHomeDir,
      workspaceDir: fixture.workspaceDir,
      fileName: providerSessionId,
      timestamps: [
        "2026-03-23T10:00:00.000Z",
        "2026-03-23T10:00:01.000Z",
        "2026-03-23T10:00:02.000Z"
      ]
    });

    activeEmptyFixtures.push(fixture);
    activeClosers.push(() => database.close());

    database.db
      .prepare(
        `INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("user-1", "tester", "hash", "admin", timestamp, timestamp);

    workspaceRepository.create({
      id: "workspace-1",
      name: "Fixture Workspace",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      removedAt: null
    });
    sessionBindingRepository.upsert({
      sessionId,
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId,
      rawStoreRef,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    sessionIndexRepository.upsert({
      sessionId,
      workspaceId: "workspace-1",
      provider: "codex",
      title: "tail refresh test",
      messageCount: 2,
      isArchived: false,
      lastMessageAt: "2026-03-23T10:00:02.000Z",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    sessionStateRepository.upsert({
      sessionId,
      userId: "user-1",
      runningState: "running",
      activitySource: "runtime",
      favorite: false,
      lastEventAt: "2026-03-23T10:00:02.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: timestamp
    });

    const delivered: Array<{ type: string; messages: string[] }> = [];
    const subscription = await sessionHistoryService.subscribeSession(
      sessionId,
      null,
      2,
      (envelope) => {
        delivered.push({
          type: envelope.type,
          messages: envelope.messages.map((message) => message.content)
        });
      }
    );
    activeClosers.push(() => subscription.close());

    expect(delivered).toEqual([
      {
        type: "session.backfill",
        messages: [
          `${providerSessionId} user message`,
          `${providerSessionId} assistant message`
        ]
      }
    ]);

    writeFileSync(
      rawStoreRef,
      readFileSync(rawStoreRef, "utf8").replace(
        `${providerSessionId} assistant message`,
        "Codex 尾部消息已被真实历史修正"
      ),
      "utf8"
    );

    await waitForDeliveredMessage(
      delivered,
      "Codex 尾部消息已被真实历史修正"
    );

    expect(delivered).toContainEqual({
      type: "session.delta",
      messages: ["Codex 尾部消息已被真实历史修正"]
    });
  });

  it("本地已归档的 opencode 会话不会被后续发现结果重新放回普通列表", async () => {
    const fixture = createEmptyFixture();
    const config = resolveHostConfig({
      databasePath: ":memory:",
      claudeCodeHomeDir: fixture.claudeHomeDir,
      codexHomeDir: fixture.codexHomeDir
    });
    const database = createDatabaseClient(":memory:");
    const workspaceRepository = new WorkspaceRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const sessionStateRepository = new SessionStateRepository(database.db);
    const sessionStatusSnapshotRepository = new SessionStatusSnapshotRepository(database.db);
    const sessionChangedFileService = new SessionChangedFileService(
      new SessionChangedFileRepository(database.db)
    );
    const sessionMessageAttachmentService = new SessionMessageAttachmentService(
      new SessionMessageAttachmentRepository(database.db),
      config
    );
    const sessionHistoryService = new SessionHistoryService(
      database.db,
      workspaceRepository,
      sessionBindingRepository,
      sessionChangedFileService,
      sessionIndexRepository,
      sessionMessageAttachmentService,
      sessionStateRepository,
      sessionStatusSnapshotRepository,
      config
    );
    const timestamp = nowIso();

    activeEmptyFixtures.push(fixture);
    activeClosers.push(() => database.close());

    database.db
      .prepare(
        `INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("user-1", "tester", "hash", "admin", timestamp, timestamp);

    workspaceRepository.create({
      id: "workspace-1",
      name: "Fixture Workspace",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      removedAt: null
    });
    sessionBindingRepository.upsert({
      sessionId: "host-session-archived",
      workspaceId: "workspace-1",
      provider: "opencode",
      providerSessionId: "op-archived-1",
      rawStoreRef: "opencode://session/op-archived-1",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    sessionIndexRepository.upsert({
      sessionId: "host-session-archived",
      workspaceId: "workspace-1",
      provider: "opencode",
      title: "Archived OpenCode Session",
      messageCount: 3,
      isArchived: true,
      lastMessageAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    const discoverMock = vi.fn().mockResolvedValue({
      sessions: [
        {
          provider: "opencode",
          providerSessionId: "op-archived-1",
          title: "Archived OpenCode Session",
          workspacePath: fixture.workspaceDir,
          rawStoreRef: "opencode://session/op-archived-1",
          isArchived: false,
          lastMessageAt: timestamp,
          messageCount: 3
        }
      ],
      isComplete: true
    });

    (
      sessionHistoryService as unknown as {
        sessionSyncService: {
          discoverWorkspaceSessions: typeof discoverMock;
        };
      }
    ).sessionSyncService = {
      discoverWorkspaceSessions: discoverMock
    };

    const items = await sessionHistoryService.discoverWorkspaceSessions("workspace-1", "user-1", {
      force: true
    });

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: "host-session-archived",
          provider: "opencode",
          isArchived: true
        })
      ])
    );
    expect(
      sessionIndexRepository.findIndexRecordBySessionId("host-session-archived")?.isArchived
    ).toBe(true);
  });

  it("本地已恢复的 opencode 会话不会被后续发现结果重新刷回归档列表", async () => {
    const fixture = createEmptyFixture();
    const config = resolveHostConfig({
      databasePath: ":memory:",
      claudeCodeHomeDir: fixture.claudeHomeDir,
      codexHomeDir: fixture.codexHomeDir
    });
    const database = createDatabaseClient(":memory:");
    const workspaceRepository = new WorkspaceRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const sessionStateRepository = new SessionStateRepository(database.db);
    const sessionStatusSnapshotRepository = new SessionStatusSnapshotRepository(database.db);
    const sessionChangedFileService = new SessionChangedFileService(
      new SessionChangedFileRepository(database.db)
    );
    const sessionMessageAttachmentService = new SessionMessageAttachmentService(
      new SessionMessageAttachmentRepository(database.db),
      config
    );
    const sessionHistoryService = new SessionHistoryService(
      database.db,
      workspaceRepository,
      sessionBindingRepository,
      sessionChangedFileService,
      sessionIndexRepository,
      sessionMessageAttachmentService,
      sessionStateRepository,
      sessionStatusSnapshotRepository,
      config
    );
    const timestamp = nowIso();

    activeEmptyFixtures.push(fixture);
    activeClosers.push(() => database.close());

    database.db
      .prepare(
        `INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("user-1", "tester", "hash", "admin", timestamp, timestamp);

    workspaceRepository.create({
      id: "workspace-1",
      name: "Fixture Workspace",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      removedAt: null
    });
    sessionBindingRepository.upsert({
      sessionId: "host-session-restored",
      workspaceId: "workspace-1",
      provider: "opencode",
      providerSessionId: "op-restored-1",
      rawStoreRef: "opencode://session/op-restored-1",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    sessionIndexRepository.upsert({
      sessionId: "host-session-restored",
      workspaceId: "workspace-1",
      provider: "opencode",
      title: "Restored OpenCode Session",
      messageCount: 3,
      isArchived: false,
      lastMessageAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    const discoverMock = vi.fn().mockResolvedValue({
      sessions: [
        {
          provider: "opencode",
          providerSessionId: "op-restored-1",
          title: "Restored OpenCode Session",
          workspacePath: fixture.workspaceDir,
          rawStoreRef: "opencode://session/op-restored-1",
          isArchived: true,
          lastMessageAt: timestamp,
          messageCount: 3
        }
      ],
      isComplete: true
    });

    (
      sessionHistoryService as unknown as {
        sessionSyncService: {
          discoverWorkspaceSessions: typeof discoverMock;
        };
      }
    ).sessionSyncService = {
      discoverWorkspaceSessions: discoverMock
    };

    const items = await sessionHistoryService.discoverWorkspaceSessions("workspace-1", "user-1", {
      force: true
    });

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: "host-session-restored",
          provider: "opencode",
          isArchived: false
        })
      ])
    );
    expect(
      sessionIndexRepository.findIndexRecordBySessionId("host-session-restored")?.isArchived
    ).toBe(false);
  });

  it("打通 bootstrap、导入工作区、发现会话、历史读取、能力查询、续接和新建会话", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const bootstrapStatus = await hosted.app.inject({
      method: "GET",
      url: "/api/public/bootstrap-status"
    });
    expect(bootstrapStatus.statusCode).toBe(200);
    expect(bootstrapStatus.json()).toEqual({ initialized: false });

    const setup = await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    expect(setup.statusCode).toBe(201);

    const login = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    expect(login.statusCode).toBe(200);
    const accessToken = login.json().accessToken;

    const unauthorized = await hosted.app.inject({
      method: "GET",
      url: "/api/providers/claude-code/capabilities"
    });
    expect(unauthorized.statusCode).toBe(401);

    const unsupportedProvider = await hosted.app.inject({
      method: "GET",
      url: "/api/providers/openai/capabilities",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(unsupportedProvider.statusCode).toBe(400);
    expect(unsupportedProvider.json().error_code).toBe("PROVIDER_NOT_SUPPORTED");

    const imported = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: fixture.workspaceDir,
        name: "Fixture Workspace"
      }
    });
    expect(imported.statusCode).toBe(201);
    const workspaceId = imported.json().id;

    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessions.statusCode).toBe(200);
    expect(sessions.json().items).toHaveLength(2);

    const sessionItems = sessions.json().items;
    const claudeSession = sessionItems.find(
      (item: { provider: string }) => item.provider === "claude-code"
    );
    const codexSession = sessionItems.find((item: { provider: string }) => item.provider === "codex");

    expect(claudeSession?.title).toBe("Claude 样本会话");
    expect(codexSession).toBeTruthy();

    const favoriteUpdated = await hosted.app.inject({
      method: "PATCH",
      url: `/api/sessions/${codexSession.sessionId}/favorite`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        favorite: true
      }
    });
    expect(favoriteUpdated.statusCode).toBe(200);
    expect(favoriteUpdated.json()).toMatchObject({
      sessionId: codexSession.sessionId,
      isFavorite: true
    });

    const sessionsAfterFavorite = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessionsAfterFavorite.statusCode).toBe(200);
    expect(
      sessionsAfterFavorite
        .json()
        .items.find((item: { sessionId: string }) => item.sessionId === codexSession.sessionId)
    ).toMatchObject({
      sessionId: codexSession.sessionId,
      isFavorite: true
    });

    const workbenchAfterFavorite = await hosted.app.inject({
      method: "GET",
      url: "/api/workbench",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(workbenchAfterFavorite.statusCode).toBe(200);
    expect(
      workbenchAfterFavorite
        .json()
        .items
        .flatMap((item: { sessions?: Array<{ sessionId: string; isFavorite?: boolean }> }) =>
          Array.isArray(item.sessions) ? item.sessions : []
        )
        .find((item: { sessionId: string }) => item.sessionId === codexSession.sessionId)
    ).toMatchObject({
      sessionId: codexSession.sessionId,
      isFavorite: true
    });

    const firstHistory = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions/${claudeSession.sessionId}/messages?limit=1`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(firstHistory.statusCode).toBe(200);
    expect(firstHistory.json().messages).toHaveLength(1);
    expect(firstHistory.json().messages[0].rawRef).toContain("claude-code://");
    expect(firstHistory.json().nextCursor).toBeTruthy();

    const nextHistory = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions/${claudeSession.sessionId}/messages?limit=10&cursor=${encodeURIComponent(firstHistory.json().nextCursor)}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(nextHistory.statusCode).toBe(200);
    expect(nextHistory.json().messages).toHaveLength(3);
    expect(nextHistory.json().messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool_call",
          role: "tool",
          toolCall: expect.objectContaining({
            callId: "toolu_fixture_1",
            name: "Read",
            input: expect.stringContaining("README.md"),
            status: "running"
          })
        }),
        expect.objectContaining({
          kind: "tool_result",
          role: "tool",
          toolCall: expect.objectContaining({
            callId: "toolu_fixture_1",
            name: "Read",
            output: "README fixture content",
            status: "completed"
          })
        })
      ])
    );

    const codexHistory = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions/${codexSession.sessionId}/messages?limit=10`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(codexHistory.statusCode).toBe(200);
    expect(codexHistory.json().messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool_call",
          role: "tool",
          toolCall: expect.objectContaining({
            callId: "call-shell-1",
            name: "shell_command",
            input: "{\n  \"command\": \"git status --short\"\n}",
            status: "running"
          })
        }),
        expect.objectContaining({
          kind: "tool_result",
          role: "tool",
          toolCall: expect.objectContaining({
            callId: "call-shell-1",
            name: "shell_command",
            output: expect.stringContaining("M src/main.ts"),
            status: "completed"
          })
        })
      ])
    );

    const providerCapability = await hosted.app.inject({
      method: "GET",
      url: "/api/providers/claude-code/capabilities",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(providerCapability.statusCode).toBe(200);
    expect(providerCapability.json()).toMatchObject({
      provider: "claude-code",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      supportsSubagents: true
    });

    const detail = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions/${claudeSession.sessionId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      sessionId: claudeSession.sessionId,
      provider: "claude-code"
    });

    const sessionCapability = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions/${codexSession.sessionId}/capabilities`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessionCapability.statusCode).toBe(200);
    expect(sessionCapability.json()).toMatchObject({
      provider: "codex",
      supportsInterrupt: true
    });

    const resumed = await hosted.app.inject({
      method: "POST",
      url: `/api/sessions/${codexSession.sessionId}/resume`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().provider).toBe("codex");

    const sent = await hosted.app.inject({
      method: "POST",
      url: `/api/sessions/${codexSession.sessionId}/messages`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        content: "把前端主链路先接上",
        clientRequestId: "client-request-1"
      }
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({
      sessionId: codexSession.sessionId,
      clientRequestId: "client-request-1",
      message: {
        role: "user",
        content: "把前端主链路先接上"
      }
    });

    const started = await hosted.app.inject({
      method: "POST",
      url: "/api/sessions/start",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        provider: "codex",
        initialPrompt: "新建一个最小主链路"
      }
    });
    expect(started.statusCode).toBe(409);
    expect(started.json()).toMatchObject({
      error_code: "SESSION_START_DEFERRED"
    });

    const schemaTables = hosted.services.database.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(schemaTables.map((item) => item.name)).toContain("session_bindings");
    expect(schemaTables.map((item) => item.name)).toContain("session_indices");
    expect(schemaTables.map((item) => item.name)).toContain("session_states");
    expect(schemaTables.map((item) => item.name)).toContain("session_status_snapshots");

    const bindingColumns = hosted.services.database.db
      .prepare("PRAGMA table_info(session_bindings)")
      .all() as Array<{ name: string }>;
    expect(bindingColumns.map((column) => column.name)).not.toContain("content");
    expect(bindingColumns.map((column) => column.name)).not.toContain("raw_message");

    const sessionStateColumns = hosted.services.database.db
      .prepare("PRAGMA table_info(session_states)")
      .all() as Array<{ name: string }>;
    expect(sessionStateColumns.map((column) => column.name)).not.toContain("is_archived");
  });

  it("发现工作区会话时会忽略 Claude 顶层 Warmup sidechain 调试会话", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);
    writeFileSync(
      path.join(
        fixture.claudeHomeDir,
        "projects",
        "c--Fixtures-Workspace",
        "agent-a18af649.jsonl"
      ),
      [
        JSON.stringify({
          parentUuid: null,
          isSidechain: true,
          userType: "external",
          cwd: fixture.workspaceDir,
          sessionId: "claude-session-1",
          agentId: "a18af649",
          type: "user",
          message: {
            role: "user",
            content: "Warmup"
          },
          uuid: "warmup-user-1",
          timestamp: "2026-03-26T00:00:01.000Z"
        }),
        JSON.stringify({
          parentUuid: "warmup-user-1",
          isSidechain: true,
          userType: "external",
          cwd: fixture.workspaceDir,
          sessionId: "claude-session-1",
          agentId: "a18af649",
          type: "assistant",
          message: {
            id: "msg-warmup-1",
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "调试 warmup 回复" }]
          },
          uuid: "warmup-assistant-1",
          timestamp: "2026-03-26T00:00:02.000Z"
        })
      ].join("\n"),
      "utf8"
    );

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    const login = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    const accessToken = login.json().accessToken;
    const imported = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: fixture.workspaceDir,
        name: "Fixture Workspace"
      }
    });
    const workspaceId = imported.json().id;

    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(sessions.statusCode).toBe(200);
    expect(sessions.json().items).toHaveLength(2);
    expect(
      sessions
        .json()
        .items.some(
          (item: { provider: string; providerSessionId: string; title: string }) =>
            item.provider === "claude-code" &&
            item.providerSessionId === "agent-a18af649"
        )
    ).toBe(false);
  });

  it("发现工作区会话时会把 Claude 顶层 Task 子代理 transcript 识别为子会话", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);
    const parentSessionId = "claude-task-parent";
    const childAgentId = "ec4ca8be";
    const childFileName = `agent-${childAgentId}`;

    writeFileSync(
      path.join(
        fixture.claudeHomeDir,
        "projects",
        "c--Fixtures-Workspace",
        `${parentSessionId}.jsonl`
      ),
      [
        JSON.stringify({
          type: "user",
          sessionId: parentSessionId,
          cwd: fixture.workspaceDir,
          timestamp: "2026-04-02T04:31:04.111Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "帮我修改 GLM MCP 配置" }]
          }
        }),
        JSON.stringify({
          type: "assistant",
          sessionId: parentSessionId,
          cwd: fixture.workspaceDir,
          timestamp: "2026-04-02T04:31:42.963Z",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "我先让子代理去搜索 MCP 配置。" },
              {
                type: "tool_use",
                id: "call_task_1",
                name: "Task",
                input: {
                  description: "查找GLM MCP配置文件",
                  prompt: "搜索 MCP 相关配置",
                  subagent_type: "Explore"
                }
              }
            ]
          }
        }),
        JSON.stringify({
          type: "user",
          sessionId: parentSessionId,
          cwd: fixture.workspaceDir,
          timestamp: "2026-04-02T04:35:27.713Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "call_task_1",
                content: [{ type: "text", text: "查找完成" }]
              }
            ]
          },
          toolUseResult: {
            status: "completed",
            agentId: childAgentId
          }
        }),
        JSON.stringify({
          type: "ai-title",
          sessionId: parentSessionId,
          aiTitle: "Claude 主会话"
        })
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      path.join(
        fixture.claudeHomeDir,
        "projects",
        "c--Fixtures-Workspace",
        `${childFileName}.jsonl`
      ),
      [
        JSON.stringify({
          parentUuid: null,
          isSidechain: true,
          userType: "external",
          cwd: fixture.workspaceDir,
          sessionId: parentSessionId,
          agentId: childAgentId,
          type: "user",
          message: {
            role: "user",
            content: "搜索 MCP 相关配置"
          },
          uuid: "child-user-1",
          timestamp: "2026-04-02T04:31:43.451Z"
        }),
        JSON.stringify({
          parentUuid: "child-user-1",
          isSidechain: true,
          userType: "external",
          cwd: fixture.workspaceDir,
          sessionId: parentSessionId,
          agentId: childAgentId,
          type: "assistant",
          message: {
            id: "msg-child-1",
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "我来查找 MCP 配置。" }]
          },
          uuid: "child-assistant-1",
          timestamp: "2026-04-02T04:31:44.000Z"
        })
      ].join("\n"),
      "utf8"
    );

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);
    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(sessions.statusCode).toBe(200);

    const items = sessions.json().items as Array<{
      sessionId: string;
      provider: string;
      providerSessionId: string;
      rawStoreRef: string;
      parentSessionId?: string | null;
      isSubagent?: boolean;
      subagentLabel?: string | null;
    }>;
    const parentSession = items.find((item) => item.providerSessionId === parentSessionId);
    const childSession = items.find(
      (item) => item.providerSessionId === `${parentSessionId}::${childFileName}`
    );

    expect(parentSession).toBeTruthy();
    expect(childSession).toMatchObject({
      parentSessionId: parentSession?.sessionId,
      isSubagent: true,
      subagentLabel: "explore · 查找GLM MCP配置文件"
    });
  });

  it("继续 Claude 现有会话时会优先认领本次请求之后的新用户消息", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);
    appendFileSync(
      fixture.claudeSessionFile,
      `\n${JSON.stringify({
        type: "user",
        sessionId: "claude-session-1",
        cwd: fixture.workspaceDir,
        timestamp: "2026-03-26T00:00:01.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "重复内容" }]
        }
      })}`
    );

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);
    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const claudeSession = sessions
      .json()
      .items.find((item: { provider: string }) => item.provider === "claude-code");

    if (!claudeSession) {
      throw new Error("Claude 会话没有按预期加载出来");
    }

    appendFileSync(
      fixture.claudeSessionFile,
      `\n${JSON.stringify({
        type: "user",
        sessionId: "claude-session-1",
        cwd: fixture.workspaceDir,
        timestamp: "2026-03-26T00:00:05.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "重复内容" }]
        }
      })}`
    );

    const matched = await hosted.services.modules.sessionHistoryService.findLatestUserMessage(
      claudeSession.sessionId,
      "重复内容",
      1,
      "2026-03-26T00:00:04.000Z"
    );

    expect(matched).toBeTruthy();
    expect(matched?.timestamp).toBe("2026-03-26T00:00:05.000Z");
    expect(matched?.sequence).toBeGreaterThan(4);
  });

  it("会跳过 Codex 规则消息标题，并支持手动重命名回写原始记录", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    writeFileSync(
      fixture.codexSessionFile,
      [
        JSON.stringify({
          timestamp: "2026-03-23T09:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "codex-session-1",
            timestamp: "2026-03-23T09:00:00.000Z",
            cwd: fixture.workspaceDir,
            originator: "Codex",
            source: "test"
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-23T09:00:05.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message:
              "# AGENTS.md instructions for C:\\\\Code\\\\CodingNS\\n\\n<INSTRUCTIONS>\\n规则正文\\n</INSTRUCTIONS>"
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-23T09:00:08.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "真正的用户需求标题"
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-23T09:00:12.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "已经开始处理"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const codexStateDbPath = path.join(fixture.codexHomeDir, "state_999.sqlite");
    const codexStateDb = new DatabaseSync(codexStateDbPath);
    codexStateDb.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        title TEXT,
        cwd TEXT,
        created_at INTEGER,
        first_user_message TEXT,
        agent_nickname TEXT,
        agent_role TEXT
      );
    `);
    codexStateDb
      .prepare(
        `INSERT INTO threads (id, title, cwd, created_at, first_user_message, agent_nickname, agent_role)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "codex-session-1",
        null,
        fixture.workspaceDir,
        Math.floor(Date.parse("2026-03-23T09:00:00.000Z") / 1000),
        "# AGENTS.md instructions for C:\\Code\\CodingNS\n\n<INSTRUCTIONS>\n规则正文\n</INSTRUCTIONS>",
        null,
        null
      );
    codexStateDb.close();

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessions.statusCode).toBe(200);

    const sessionItems = sessions.json().items;
    const codexSession = sessionItems.find((item: { provider: string }) => item.provider === "codex");
    const claudeSession = sessionItems.find(
      (item: { provider: string }) => item.provider === "claude-code"
    );

    if (!codexSession || !claudeSession) {
      throw new Error("测试会话没有按预期加载出来");
    }

    expect(codexSession?.title).toBe("真正的用户需求标题");
    expect(claudeSession).toBeTruthy();

    const renamedCodexTitle = "重命名后的 Codex 会话";
    const renamedCodex = await hosted.app.inject({
      method: "PATCH",
      url: `/api/sessions/${codexSession.sessionId}/title`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        title: renamedCodexTitle
      }
    });
    expect(renamedCodex.statusCode).toBe(200);
    expect(renamedCodex.json().title).toBe(renamedCodexTitle);

    const codexIndexLines = readFileSync(path.join(fixture.codexHomeDir, "session_index.jsonl"), "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as { id?: string; thread_name?: string });
    expect(codexIndexLines.at(-1)).toEqual({
      id: "codex-session-1",
      thread_name: renamedCodexTitle
    });

    const renamedCodexDb = new DatabaseSync(codexStateDbPath, { readOnly: true });
    const codexThreadRow = renamedCodexDb
      .prepare("SELECT title FROM threads WHERE id = ?")
      .get("codex-session-1") as { title: string | null } | undefined;
    renamedCodexDb.close();
    expect(codexThreadRow?.title).toBe(renamedCodexTitle);

    const renamedClaudeTitle = "重命名后的 Claude 会话";
    const renamedClaude = await hosted.app.inject({
      method: "PATCH",
      url: `/api/sessions/${claudeSession.sessionId}/title`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        title: renamedClaudeTitle
      }
    });
    expect(renamedClaude.statusCode).toBe(200);
    expect(renamedClaude.json().title).toBe(renamedClaudeTitle);

    const claudeLines = readFileSync(fixture.claudeSessionFile, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as { type?: string; aiTitle?: string });
    expect(claudeLines.at(-1)).toEqual({
      type: "ai-title",
      sessionId: "claude-session-1",
      aiTitle: renamedClaudeTitle
    });
  });

  it("已有的 Codex 脏标题缓存会在源文件未变化时被重新解析修正", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    const rulesMessage =
      "# AGENTS.md instructions for C:\\\\Code\\\\CodingNS\\n\\n<INSTRUCTIONS>\\n规则正文\\n</INSTRUCTIONS>";
    const realUserTitle = "真正的用户需求标题";

    writeFileSync(
      fixture.codexSessionFile,
      [
        JSON.stringify({
          timestamp: "2026-03-23T09:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "codex-session-1",
            timestamp: "2026-03-23T09:00:00.000Z",
            cwd: fixture.workspaceDir,
            originator: "Codex",
            source: "test"
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-23T09:00:05.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: rulesMessage
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-23T09:00:08.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: realUserTitle
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-23T09:00:12.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "已经开始处理"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const codexStateDbPath = path.join(fixture.codexHomeDir, "state_999.sqlite");
    const codexStateDb = new DatabaseSync(codexStateDbPath);
    codexStateDb.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        title TEXT,
        cwd TEXT,
        created_at INTEGER,
        first_user_message TEXT,
        agent_nickname TEXT,
        agent_role TEXT
      );
    `);
    codexStateDb
      .prepare(
        `INSERT INTO threads (id, title, cwd, created_at, first_user_message, agent_nickname, agent_role)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "codex-session-1",
        realUserTitle,
        fixture.workspaceDir,
        Math.floor(Date.parse("2026-03-23T09:00:00.000Z") / 1000),
        realUserTitle,
        null,
        null
      );
    codexStateDb.close();

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);
    const staleSessionId = "stale-codex-host-session";
    const staleUpdatedAt = "2026-03-23T09:00:12.000Z";

    hosted.services.database.db
      .prepare(
        `INSERT INTO session_bindings (
           session_id,
           workspace_id,
           provider,
           provider_session_id,
           raw_store_ref,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        staleSessionId,
        workspaceId,
        "codex",
        "codex-session-1",
        fixture.codexSessionFile,
        staleUpdatedAt,
        staleUpdatedAt
      );
    hosted.services.database.db
      .prepare(
        `INSERT INTO session_indices (
           session_id,
           workspace_id,
           provider,
           title,
           message_count,
           last_message_at,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        staleSessionId,
        workspaceId,
        "codex",
        rulesMessage.slice(0, 48),
        2,
        staleUpdatedAt,
        staleUpdatedAt,
        staleUpdatedAt
      );

    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessions.statusCode).toBe(200);

    const codexSession = sessions
      .json()
      .items.find((item: { provider: string }) => item.provider === "codex");

    expect(codexSession).toBeTruthy();
    expect(codexSession.sessionId).toBe(staleSessionId);
    expect(codexSession.title).toBe(realUserTitle);

    const corrected = hosted.services.database.db
      .prepare("SELECT title FROM session_indices WHERE session_id = ?")
      .get(staleSessionId) as { title: string };
    expect(corrected.title).toBe(realUserTitle);
  });

  it("支持 WebSocket 订阅、增量推送和鉴权拒绝", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    await hosted.app.ready();

    await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "password123"
      }
    });

    const login = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    const accessToken = login.json().accessToken;

    const imported = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: fixture.workspaceDir,
        name: "Fixture Workspace"
      }
    });
    const workspaceId = imported.json().id;

    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const codexSessionId = sessions.json().items.find(
      (item: { provider: string }) => item.provider === "codex"
    ).sessionId;

    await hosted.app.listen({
      host: "127.0.0.1",
      port: 0
    });
    activeClosers.push(() => hosted.app.close());

    const address = hosted.app.server.address();

    if (!address || typeof address === "string") {
      throw new Error("测试服务器地址异常");
    }

    const okSocket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?access_token=${accessToken}`);
    activeClosers.push(() => okSocket.close());
    const okMessages = createWsMessageQueue(okSocket);

    expect(JSON.parse(await okMessages.next()).type).toBe("system.connected");

    okSocket.send(
      JSON.stringify({
        type: "session.subscribe",
        sessionId: codexSessionId,
        limit: 20
      })
    );

    let subscribed = false;
    let backfillReceived = false;

    for (let index = 0; index < 3; index += 1) {
      const payload = JSON.parse(await okMessages.next()) as { type: string; messages?: unknown[] };

      if (payload.type === "session.subscribed") {
        subscribed = true;
      }

      if (payload.type === "session.backfill") {
        backfillReceived = true;
        expect(payload.messages?.length).toBeGreaterThan(0);
      }

      if (subscribed && backfillReceived) {
        break;
      }
    }

    expect(subscribed).toBe(true);
    expect(backfillReceived).toBe(true);

    appendFileSync(
      fixture.codexSessionFile,
      `\n${JSON.stringify({
        timestamp: "2026-03-23T09:00:20.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "WebSocket 增量消息到了。"
        }
      })}`,
      "utf8"
    );

    let deltaPayload: null | { messages: Array<{ content: string }> } = null;
    let deltaCursor: string | null = null;

    for (let index = 0; index < 4; index += 1) {
      const payload = JSON.parse(await okMessages.next()) as {
        type: string;
        cursor?: string | null;
        messages?: Array<{ content: string }>;
      };

      if (payload.type === "session.delta" && payload.messages) {
        deltaPayload = {
          messages: payload.messages
        };
        deltaCursor = payload.cursor ?? null;
        break;
      }
    }

    expect(deltaPayload).not.toBeNull();
    expect(deltaPayload?.messages.length).toBeGreaterThan(0);
    expect(deltaPayload?.messages[0].content).toBe("WebSocket 增量消息到了。");
    expect(deltaCursor).toBeTruthy();

    okSocket.close();

    appendFileSync(
      fixture.codexSessionFile,
      `\n${JSON.stringify({
        timestamp: "2026-03-23T09:00:25.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "断线重连后的补齐消息"
        }
      })}`,
      "utf8"
    );

    const reconnectSocket = new WebSocket(
      `ws://127.0.0.1:${address.port}/ws?access_token=${accessToken}`
    );
    activeClosers.push(() => reconnectSocket.close());
    const reconnectMessages = createWsMessageQueue(reconnectSocket);

    expect(JSON.parse(await reconnectMessages.next()).type).toBe("system.connected");

    reconnectSocket.send(
      JSON.stringify({
        type: "session.subscribe",
        sessionId: codexSessionId,
        cursor: deltaCursor,
        limit: 20
      })
    );

    let reconnectSubscribed = false;
    let reconnectBackfill: null | { messages: Array<{ content: string }> } = null;

    for (let index = 0; index < 6; index += 1) {
      const payload = JSON.parse(await reconnectMessages.next()) as {
        type: string;
        messages?: Array<{ content: string }>;
      };

      if (payload.type === "session.subscribed") {
        reconnectSubscribed = true;
      }

      if (payload.type === "session.backfill" && payload.messages) {
        reconnectBackfill = {
          messages: payload.messages
        };
      }

      if (reconnectSubscribed && reconnectBackfill) {
        break;
      }
    }

    expect(reconnectSubscribed).toBe(true);
    expect(reconnectBackfill).not.toBeNull();
    expect(reconnectBackfill?.messages).toHaveLength(1);
    expect(reconnectBackfill?.messages[0].content).toBe("断线重连后的补齐消息");

    await expect(
      new Promise((resolve, reject) => {
        const badSocket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?access_token=bad-token`);
        badSocket.once("open", () => reject(new Error("不应该连上")));
        badSocket.once("error", () => resolve(true));
        badSocket.once("unexpected-response", () => resolve(true));
        badSocket.once("close", () => resolve(true));
      })
    ).resolves.toBe(true);
  }, 15_000);

  it("支持通过 WebSocket 继续加载更早的会话消息", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    await hosted.app.ready();

    await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "password123"
      }
    });

    const login = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    const accessToken = login.json().accessToken;

    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const codexSessionId = sessions
      .json()
      .items.find((item: { provider: string }) => item.provider === "codex")?.sessionId as string | undefined;

    expect(codexSessionId).toBeTruthy();

    await hosted.app.listen({
      host: "127.0.0.1",
      port: 0
    });

    const address = hosted.app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("未获取到监听端口");
    }

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?access_token=${accessToken}`);
    activeClosers.push(() => socket.close());
    const messages = createWsMessageQueue(socket);

    expect(JSON.parse(await messages.next()).type).toBe("system.connected");

    socket.send(
      JSON.stringify({
        type: "session.subscribe",
        sessionId: codexSessionId,
        limit: 2
      })
    );

    let initialBackfill: null | {
      cursor: string | null;
      olderCursor: string | null;
      messages: Array<{ sequence: number }>;
    } = null;

    for (let index = 0; index < 3; index += 1) {
      const payload = JSON.parse(await messages.next()) as {
        type: string;
        cursor?: string | null;
        olderCursor?: string | null;
        messages?: Array<{ sequence: number }>;
      };

      if (payload.type === "session.backfill" && payload.messages) {
        initialBackfill = {
          cursor: payload.cursor ?? null,
          olderCursor: payload.olderCursor ?? null,
          messages: payload.messages
        };
        break;
      }
    }

    expect(initialBackfill).not.toBeNull();
    expect(initialBackfill?.messages).toHaveLength(2);
    expect(initialBackfill?.olderCursor).toBeTruthy();

    socket.send(
      JSON.stringify({
        type: "session.load_older",
        sessionId: codexSessionId,
        cursor: initialBackfill?.olderCursor,
        limit: 2
      })
    );

    let olderPage: null | {
      olderCursor: string | null;
      messages: Array<{ sequence: number }>;
    } = null;

    for (let index = 0; index < 2; index += 1) {
      const payload = JSON.parse(await messages.next()) as {
        type: string;
        olderCursor?: string | null;
        messages?: Array<{ sequence: number }>;
      };

      if (payload.type === "session.history_older" && payload.messages) {
        olderPage = {
          olderCursor: payload.olderCursor ?? null,
          messages: payload.messages
        };
        break;
      }
    }

    expect(olderPage).not.toBeNull();
    expect(olderPage?.messages).toHaveLength(2);
    expect(olderPage?.olderCursor).toBeNull();
    expect(olderPage?.messages.at(-1)?.sequence).toBeLessThan(
      initialBackfill?.messages[0]?.sequence ?? Number.POSITIVE_INFINITY
    );
  });

  it("claude-code 会在消息推送时同步刷新会话列表标题", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessions.statusCode).toBe(200);

    const claudeSessionId = sessions
      .json()
      .items.find((item: { provider: string }) => item.provider === "claude-code")?.sessionId;
    expect(claudeSessionId).toBeTruthy();

    await hosted.app.listen({
      host: "127.0.0.1",
      port: 0
    });
    activeClosers.push(() => hosted.app.close());

    const address = hosted.app.server.address();

    if (!address || typeof address === "string") {
      throw new Error("测试服务器地址异常");
    }

    const workbenchSocket = new WebSocket(
      `ws://127.0.0.1:${address.port}/ws?access_token=${accessToken}`
    );
    activeClosers.push(() => workbenchSocket.close());
    const workbenchMessages = createWsMessageQueue(workbenchSocket);
    expect(JSON.parse(await workbenchMessages.next()).type).toBe("system.connected");
    workbenchSocket.send(JSON.stringify({ type: "workbench.subscribe" }));

    const initialSnapshot = await nextWorkbenchSnapshot(workbenchMessages);
    expect(findWorkbenchSession(initialSnapshot, claudeSessionId!)?.title).toBe("Claude 样本会话");

    const sessionSocket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?access_token=${accessToken}`);
    activeClosers.push(() => sessionSocket.close());
    const sessionMessages = createWsMessageQueue(sessionSocket);
    expect(JSON.parse(await sessionMessages.next()).type).toBe("system.connected");
    sessionSocket.send(
      JSON.stringify({
        type: "session.subscribe",
        sessionId: claudeSessionId,
        limit: 20
      })
    );

    for (let index = 0; index < 3; index += 1) {
      const payload = JSON.parse(await sessionMessages.next()) as { type: string };

      if (payload.type === "session.backfill") {
        break;
      }
    }

    appendFileSync(
      fixture.claudeSessionFile,
      `\n${JSON.stringify({
        type: "ai-title",
        sessionId: "claude-session-1",
        aiTitle: "Claude 新标题"
      })}\n${JSON.stringify({
        type: "assistant",
        sessionId: "claude-session-1",
        cwd: fixture.workspaceDir,
        timestamp: "2026-03-23T08:00:20.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Claude 标题已经更新。" }]
        }
      })}`,
      "utf8"
    );

    const delta = await waitForSessionDelta(sessionMessages);
    expect(delta.messages[0]?.content).toBe("Claude 标题已经更新。");

    const refreshedSessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(refreshedSessions.statusCode).toBe(200);
    expect(
      refreshedSessions
        .json()
        .items.find((item: { sessionId: string }) => item.sessionId === claudeSessionId)?.title
    ).toBe("Claude 新标题");

    await waitForWorkbenchSessionTitle(workbenchMessages, claudeSessionId!, "Claude 新标题");
  }, 15_000);

  it("codex 会在消息推送时同步刷新会话列表标题", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    const codexStateDbPath = path.join(fixture.codexHomeDir, "state_999.sqlite");
    const initialDb = new DatabaseSync(codexStateDbPath);
    initialDb.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        title TEXT,
        cwd TEXT,
        created_at INTEGER,
        archived INTEGER,
        first_user_message TEXT,
        agent_nickname TEXT,
        agent_role TEXT,
        rollout_path TEXT
      );
    `);
    initialDb
      .prepare(
        `INSERT INTO threads (
           id,
           title,
           cwd,
           created_at,
           archived,
           first_user_message,
           agent_nickname,
           agent_role,
           rollout_path
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "codex-session-1",
        "旧 Codex 标题",
        fixture.workspaceDir,
        Math.floor(Date.parse("2026-03-23T09:00:00.000Z") / 1000),
        0,
        "继续实现 spec002",
        null,
        null,
        fixture.codexSessionFile
      );
    initialDb.close();

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessions.statusCode).toBe(200);

    const codexSessionId = sessions
      .json()
      .items.find((item: { provider: string }) => item.provider === "codex")?.sessionId;
    expect(codexSessionId).toBeTruthy();

    await hosted.app.listen({
      host: "127.0.0.1",
      port: 0
    });
    activeClosers.push(() => hosted.app.close());

    const address = hosted.app.server.address();

    if (!address || typeof address === "string") {
      throw new Error("测试服务器地址异常");
    }

    const workbenchSocket = new WebSocket(
      `ws://127.0.0.1:${address.port}/ws?access_token=${accessToken}`
    );
    activeClosers.push(() => workbenchSocket.close());
    const workbenchMessages = createWsMessageQueue(workbenchSocket);
    expect(JSON.parse(await workbenchMessages.next()).type).toBe("system.connected");
    workbenchSocket.send(JSON.stringify({ type: "workbench.subscribe" }));

    const initialSnapshot = await nextWorkbenchSnapshot(workbenchMessages);
    expect(findWorkbenchSession(initialSnapshot, codexSessionId!)?.title).toBe("旧 Codex 标题");

    const sessionSocket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?access_token=${accessToken}`);
    activeClosers.push(() => sessionSocket.close());
    const sessionMessages = createWsMessageQueue(sessionSocket);
    expect(JSON.parse(await sessionMessages.next()).type).toBe("system.connected");
    sessionSocket.send(
      JSON.stringify({
        type: "session.subscribe",
        sessionId: codexSessionId,
        limit: 20
      })
    );

    for (let index = 0; index < 3; index += 1) {
      const payload = JSON.parse(await sessionMessages.next()) as { type: string };

      if (payload.type === "session.backfill") {
        break;
      }
    }

    const updatedDb = new DatabaseSync(codexStateDbPath);
    updatedDb.prepare("UPDATE threads SET title = ? WHERE id = ?").run("新 Codex 标题", "codex-session-1");
    updatedDb.close();

    appendFileSync(
      fixture.codexSessionFile,
      `\n${JSON.stringify({
        timestamp: "2026-03-23T09:00:20.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "Codex 标题已经刷新。"
        }
      })}`,
      "utf8"
    );

    const delta = await waitForSessionDelta(sessionMessages);
    expect(delta.messages[0]?.content).toBe("Codex 标题已经刷新。");

    await waitForWorkbenchSessionTitle(workbenchMessages, codexSessionId!, "新 Codex 标题");
  });

  it("session_state 涓夋€佹祦杞」", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);
    writeFileSync(fixture.claudeSessionFile, "", "utf8");
    writeCodexSessionFile({
      codexHomeDir: fixture.codexHomeDir,
      workspaceDir: fixture.workspaceDir,
      fileName: "codex-session-1",
      timestamps: [
        "2026-03-23T09:00:00.000Z",
        "2026-03-23T09:00:05.000Z",
        "2026-03-23T09:00:08.000Z"
      ],
      includeToolCall: true
    });

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const firstList = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(firstList.statusCode).toBe(200);

    const runningSession = firstList
      .json()
      .items.find((item: { provider: string }) => item.provider === "codex");
    expect(runningSession).toMatchObject({
      runningState: "running",
      activityState: "running"
    });

    appendFileSync(
      fixture.codexSessionFile,
      `\n${JSON.stringify({
        timestamp: "2026-03-23T09:00:10.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-shell-1",
          output: "Exit code: 0\nOutput:\nall good"
        }
      })}\n${JSON.stringify({
        timestamp: "2026-03-23T09:00:11.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete"
        }
      })}`,
      "utf8"
    );

    const unreadList = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(unreadList.statusCode).toBe(200);

    const unreadSession = unreadList
      .json()
      .items.find((item: { provider: string }) => item.provider === "codex");
    expect(unreadSession.runningState).toBe("idle");
    expect(unreadSession.activityState).toBe("completed_unread");
    expect(unreadSession.completedAt).toBe("2026-03-23T09:00:11.000Z");
    expect(unreadSession.lastSeenAt).toBeNull();

    const seen = await hosted.app.inject({
      method: "POST",
      url: `/api/sessions/${unreadSession.sessionId}/seen`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(seen.statusCode).toBe(204);

    const idleList = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(idleList.statusCode).toBe(200);

    const idleSession = idleList
      .json()
      .items.find((item: { provider: string }) => item.provider === "codex");
    expect(idleSession.activityState).toBe("idle");
    expect(idleSession.lastSeenAt).toBeTruthy();

    const archive = await hosted.app.inject({
      method: "PATCH",
      url: `/api/sessions/${idleSession.sessionId}/archive`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        archived: true
      }
    });
    expect(archive.statusCode).toBe(200);
    expect(archive.json().isArchived).toBe(true);

    const archivedList = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(archivedList.statusCode).toBe(200);

    const archivedSession = archivedList
      .json()
      .items.find((item: { sessionId: string }) => item.sessionId === idleSession.sessionId);
    expect(archivedSession?.isArchived).toBe(true);

    const unarchive = await hosted.app.inject({
      method: "PATCH",
      url: `/api/sessions/${idleSession.sessionId}/archive`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        archived: false
      }
    });
    expect(unarchive.statusCode).toBe(200);
    expect(unarchive.json().isArchived).toBe(false);
  });

  it("Claude 会话在 progress end_turn 后会显示 completed_unread，并在标记已读后回到 idle", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);
    writeFileSync(fixture.codexSessionFile, "", "utf8");

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    appendFileSync(
      fixture.claudeSessionFile,
      `\n${JSON.stringify({
        type: "progress",
        sessionId: "claude-session-1",
        cwd: fixture.workspaceDir,
        timestamp: "2026-03-23T08:00:20.000Z",
        data: {
          type: "agent_progress",
          message: {
            type: "assistant",
            timestamp: "2026-03-23T08:00:20.000Z",
            message: {
              role: "assistant",
              stop_reason: "end_turn",
              content: [{ type: "text", text: "这轮已经结束。" }]
            }
          }
        }
      })}`,
      "utf8"
    );

    const unreadList = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(unreadList.statusCode).toBe(200);

    const unreadSession = unreadList
      .json()
      .items.find((item: { provider: string }) => item.provider === "claude-code");
    expect(unreadSession.runningState).toBe("idle");
    expect(unreadSession.activityState).toBe("completed_unread");
    expect(unreadSession.completedAt).toBe("2026-03-23T08:00:20.000Z");
    expect(unreadSession.lastSeenAt).toBeNull();

    const seen = await hosted.app.inject({
      method: "POST",
      url: `/api/sessions/${unreadSession.sessionId}/seen`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(seen.statusCode).toBe(204);

    const idleList = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(idleList.statusCode).toBe(200);

    const idleSession = idleList
      .json()
      .items.find((item: { provider: string }) => item.provider === "claude-code");
    expect(idleSession.activityState).toBe("idle");
    expect(idleSession.lastSeenAt).toBeTruthy();
  });

  it("鍙埛鏂版渶杩?10 鏉′細璇濈姸鎬?", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);
    writeFileSync(fixture.claudeSessionFile, "", "utf8");

    for (let index = 0; index < 12; index += 1) {
      const minute = String(index).padStart(2, "0");
      writeCodexSessionFile({
        codexHomeDir: fixture.codexHomeDir,
        workspaceDir: fixture.workspaceDir,
        fileName: `codex-session-${index + 1}`,
        timestamps: [
          `2026-03-23T09:${minute}:00.000Z`,
          `2026-03-23T09:${minute}:10.000Z`,
          `2026-03-23T09:${minute}:20.000Z`
        ]
      });
    }

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const list = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(12);

    const stateRows = hosted.services.database.db
      .prepare("SELECT session_id FROM session_states ORDER BY updated_at DESC")
      .all() as Array<{ session_id: string }>;
    expect(stateRows).toHaveLength(10);
    expect(stateRows.map((row) => row.session_id).sort()).toEqual(
      list
        .json()
        .items.slice(0, 10)
        .map((item: { sessionId: string }) => item.sessionId)
        .sort()
    );
    expect(list.json().items[10].runningState).toBeNull();
    expect(list.json().items[11].runningState).toBeNull();
  });
  it("会把历史工具写文件结果回填为正式会话索引，并把绝对路径归一成工作区相对路径", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    appendFileSync(
      fixture.codexSessionFile,
      `\n${JSON.stringify({
        timestamp: "2026-03-23T09:00:14.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-apply-patch-1",
          name: "apply_patch",
          arguments: `*** Begin Patch\n*** Update File: ${fixture.workspaceDir.replace(/\\/g, "/")}/.gitignore\n*** End Patch`
        }
      })}`,
      "utf8"
    );

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessions.statusCode).toBe(200);

    const codexSession = sessions
      .json()
      .items.find((item: { provider: string }) => item.provider === "codex");
    expect(codexSession).toBeTruthy();

    const changedFiles = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions/${codexSession.sessionId}/changed-files`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(changedFiles.statusCode).toBe(200);
    expect(changedFiles.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ".gitignore",
          lastToolName: "apply_patch"
        })
      ])
    );

    const storedFiles = hosted.services.database.db
      .prepare(
        "SELECT path, last_tool_name FROM session_changed_files WHERE session_id = ? ORDER BY path"
      )
      .all(codexSession.sessionId) as Array<{ path: string; last_tool_name: string | null }>;
    expect(storedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ".gitignore",
          last_tool_name: "apply_patch"
        })
      ])
    );

    const indexState = hosted.services.database.db
      .prepare("SELECT indexed_at FROM session_changed_file_states WHERE session_id = ?")
      .get(codexSession.sessionId) as { indexed_at: string } | undefined;
    expect(indexState?.indexed_at).toBeTruthy();
  });

  it("claude-code 归档只认 session_indices，discover 和 workbench 订阅都不会把它刷回未归档", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessions.statusCode).toBe(200);

    const claudeSession = sessions
      .json()
      .items.find((item: { provider: string }) => item.provider === "claude-code");

    if (!claudeSession) {
      throw new Error("未找到 claude-code 测试会话");
    }

    await hosted.app.listen({
      host: "127.0.0.1",
      port: 0
    });

    const address = hosted.app.server.address();

    if (!address || typeof address === "string") {
      throw new Error("测试服务地址异常");
    }

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?access_token=${accessToken}`);
    activeClosers.push(() => socket.close());
    const queue = createWsMessageQueue(socket);

    expect(JSON.parse(await queue.next()).type).toBe("system.connected");

    socket.send(
      JSON.stringify({
        type: "workbench.subscribe"
      })
    );

    const initialSnapshot = await nextWorkbenchSnapshot(queue);
    expect(findWorkbenchSession(initialSnapshot, claudeSession.sessionId)?.isArchived).toBe(false);

    const archive = await hosted.app.inject({
      method: "PATCH",
      url: `/api/sessions/${claudeSession.sessionId}/archive`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        archived: true
      }
    });
    expect(archive.statusCode).toBe(200);
    expect(archive.json().isArchived).toBe(true);

    const storedFlags = hosted.services.database.db
      .prepare(
        `SELECT indices.is_archived AS index_archived
         FROM session_indices indices
         WHERE indices.session_id = ?`
      )
      .get(claudeSession.sessionId) as {
      index_archived: number;
    };
    expect(storedFlags.index_archived).toBe(1);

    const sessionStateColumns = hosted.services.database.db
      .prepare("PRAGMA table_info(session_states)")
      .all() as Array<{ name: string }>;
    expect(sessionStateColumns.map((column) => column.name)).not.toContain("is_archived");

    const archivedList = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(archivedList.statusCode).toBe(200);

    const archivedClaudeSession = archivedList
      .json()
      .items.find((item: { sessionId: string }) => item.sessionId === claudeSession.sessionId);
    expect(archivedClaudeSession?.isArchived).toBe(true);

    socket.send(
      JSON.stringify({
        type: "workbench.subscribe"
      })
    );

    const archivedSnapshot = await nextWorkbenchSnapshot(queue);
    expect(findWorkbenchSession(archivedSnapshot, claudeSession.sessionId)?.isArchived).toBe(true);
  });

  it("Codex 会话只要文件已经进入 archived_sessions，就必须判定为已归档", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    const archivedDir = path.join(fixture.codexHomeDir, "archived_sessions");
    const archivedFile = path.join(archivedDir, "codex-session-1.jsonl");
    mkdirSync(archivedDir, { recursive: true });
    renameSync(fixture.codexSessionFile, archivedFile);

    const codexStateDbPath = path.join(fixture.codexHomeDir, "state_999.sqlite");
    const codexStateDb = new DatabaseSync(codexStateDbPath);
    codexStateDb.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        title TEXT,
        cwd TEXT,
        created_at INTEGER,
        archived INTEGER,
        first_user_message TEXT,
        agent_nickname TEXT,
        agent_role TEXT,
        rollout_path TEXT
      );
    `);
    codexStateDb
      .prepare(
        `INSERT INTO threads (
           id,
           title,
           cwd,
           created_at,
           archived,
           first_user_message,
           agent_nickname,
           agent_role,
           rollout_path
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "codex-session-1",
        "已经归档的 Codex 会话",
        fixture.workspaceDir,
        Math.floor(Date.parse("2026-03-23T09:00:00.000Z") / 1000),
        0,
        "继续实现 spec002",
        null,
        null,
        fixture.codexSessionFile
      );
    codexStateDb.close();

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessions.statusCode).toBe(200);

    const codexSession = sessions
      .json()
      .items.find((item: { provider: string }) => item.provider === "codex");

    expect(codexSession).toBeTruthy();
    expect(codexSession.rawStoreRef).toBe(archivedFile);
    expect(codexSession.isArchived).toBe(true);
  });

  it("Host 重启后，/api/workbench 仍然能返回 Codex 子 Agent 的父子关系", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    appendFileSync(
      fixture.codexSessionFile,
      `\n${JSON.stringify({
        timestamp: "2026-03-23T09:00:15.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-spawn-1",
          name: "spawn_agent",
          arguments: {
            message: "请只做代码库探索"
          }
        }
      })}`,
      "utf8"
    );

    const workerSessionFile = path.join(
      fixture.codexHomeDir,
      "sessions",
      "2026",
      "03",
      "23",
      "worker-thread-1.jsonl"
    );
    writeFileSync(
      workerSessionFile,
      [
        JSON.stringify({
          timestamp: "2026-03-23T09:00:16.000Z",
          type: "session_meta",
          payload: {
            id: "worker-thread-1",
            cwd: fixture.workspaceDir,
            originator: "Codex",
            source: "test"
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-23T09:00:16.500Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "请只做代码库探索"
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-23T09:00:18.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "我会先扫描代码结构。"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const codexStateDbPath = path.join(fixture.codexHomeDir, "state_999.sqlite");
    const codexStateDb = new DatabaseSync(codexStateDbPath);
    codexStateDb.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        title TEXT,
        cwd TEXT,
        created_at INTEGER,
        archived INTEGER,
        first_user_message TEXT,
        agent_nickname TEXT,
        agent_role TEXT,
        rollout_path TEXT
      );
    `);
    codexStateDb
      .prepare(
        `INSERT INTO threads (
           id,
           title,
           cwd,
           created_at,
           archived,
           first_user_message,
           agent_nickname,
           agent_role,
           rollout_path
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "codex-session-1",
        "主会话",
        fixture.workspaceDir,
        Math.floor(Date.parse("2026-03-23T09:00:00.000Z") / 1000),
        0,
        "继续实现 spec002",
        null,
        null,
        fixture.codexSessionFile
      );
    codexStateDb
      .prepare(
        `INSERT INTO threads (
           id,
           title,
           cwd,
           created_at,
           archived,
           first_user_message,
           agent_nickname,
           agent_role,
           rollout_path
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "worker-thread-1",
        "代码库探索子代理",
        fixture.workspaceDir,
        Math.floor(Date.parse("2026-03-23T09:00:16.000Z") / 1000),
        0,
        "请只做代码库探索",
        "Dewey",
        "worker",
        workerSessionFile
      );
    codexStateDb.close();

    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    let firstHostClosed = false;
    const firstHosted = createTestApp(fixture, { databasePath });
    activeClosers.push(async () => {
      if (!firstHostClosed) {
        firstHostClosed = true;
        await firstHosted.app.close();
      }
    });
    await firstHosted.app.ready();

    const accessToken = await bootstrapAndLogin(firstHosted);
    const workspaceId = await importWorkspace(firstHosted, accessToken, fixture.workspaceDir);
    const discovered = await firstHosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(discovered.statusCode).toBe(200);

    const discoveredItems = discovered.json().items as Array<{
      sessionId: string;
      providerSessionId: string;
      parentSessionId?: string | null;
      isSubagent?: boolean;
      subagentLabel?: string | null;
    }>;
    const rootSession = discoveredItems.find((item) => item.providerSessionId === "codex-session-1");
    const workerSession = discoveredItems.find((item) => item.providerSessionId === "worker-thread-1");

    expect(rootSession).toBeTruthy();
    expect(workerSession).toMatchObject({
      parentSessionId: rootSession?.sessionId,
      isSubagent: true,
      subagentLabel: "worker · Dewey"
    });

    firstHostClosed = true;
    await firstHosted.app.close();

    const secondHosted = createTestApp(fixture, { databasePath });
    activeClosers.push(() => secondHosted.app.close());
    await secondHosted.app.ready();

    const relogin = await secondHosted.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    expect(relogin.statusCode).toBe(200);
    const secondAccessToken = relogin.json().accessToken as string;

    const workbench = await secondHosted.app.inject({
      method: "GET",
      url: "/api/workbench",
      headers: {
        authorization: `Bearer ${secondAccessToken}`
      }
    });
    expect(workbench.statusCode).toBe(200);

    const workbenchSession = workbench
      .json()
      .items.flatMap((item: { workspace: { id: string }; sessions: Array<Record<string, unknown>> }) =>
        item.workspace.id === workspaceId ? item.sessions : []
      )
      .find(
        (item: { providerSessionId?: string }) => item.providerSessionId === "worker-thread-1"
      ) as
      | {
          parentSessionId?: string | null;
          isSubagent?: boolean;
          subagentLabel?: string | null;
        }
      | undefined;

    expect(workbenchSession).toMatchObject({
      parentSessionId: rootSession?.sessionId,
      isSubagent: true,
      subagentLabel: "worker · Dewey"
    });
  });
});

async function bootstrapAndLogin(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "admin",
      password: "password123"
    }
  });

  const login = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "password123"
    }
  });

  return login.json().accessToken as string;
}

async function importWorkspace(
  hosted: ReturnType<typeof createTestApp>,
  accessToken: string,
  workspacePath: string
): Promise<string> {
  const imported = await hosted.app.inject({
    method: "POST",
    url: "/api/workspaces/import",
    headers: {
      authorization: `Bearer ${accessToken}`
    },
    payload: {
      path: workspacePath,
      name: "Fixture Workspace"
    }
  });

  expect(imported.statusCode).toBe(201);
  return imported.json().id as string;
}

async function nextWorkbenchSnapshot(
  queue: ReturnType<typeof createWsMessageQueue>,
  timeoutMs = 2000
): Promise<{
  items: Array<{
    workspace: { id: string };
    sessions: Array<{ sessionId: string; isArchived: boolean; title?: string }>;
  }>;
}> {
  while (true) {
    const payload = JSON.parse(await queue.next(timeoutMs)) as {
      type: string;
      snapshot?: {
        items: Array<{
          workspace: { id: string };
          sessions: Array<{ sessionId: string; isArchived: boolean; title?: string }>;
        }>;
      };
    };

    if (payload.type === "workbench.snapshot" && payload.snapshot) {
      return payload.snapshot;
    }
  }
}

function findWorkbenchSession(
  snapshot: {
    items: Array<{
      sessions: Array<{ sessionId: string; isArchived: boolean; title?: string }>;
    }>;
  },
  sessionId: string
): { sessionId: string; isArchived: boolean; title?: string } | undefined {
  return snapshot.items
    .flatMap((item) => item.sessions)
    .find((session) => session.sessionId === sessionId);
}

async function waitForSessionDelta(
  queue: ReturnType<typeof createWsMessageQueue>,
  timeoutMs = 2500
): Promise<{
  sessionId: string;
  cursor: string | null;
  messages: Array<{ content: string }>;
}> {
  while (true) {
    const payload = JSON.parse(await queue.next(timeoutMs)) as {
      type: string;
      sessionId?: string;
      cursor?: string | null;
      messages?: Array<{ content: string }>;
    };

    if (payload.type === "session.delta" && payload.sessionId && payload.messages) {
      return {
        sessionId: payload.sessionId,
        cursor: payload.cursor ?? null,
        messages: payload.messages
      };
    }
  }
}

async function waitForDeliveredMessage(
  delivered: Array<{ messages: string[] }>,
  expectedContent: string,
  timeoutMs = 2500
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (delivered.some((envelope) => envelope.messages.includes(expectedContent))) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`等待会话消息回流超时: ${expectedContent}`);
}

async function waitForWorkbenchSessionTitle(
  queue: ReturnType<typeof createWsMessageQueue>,
  sessionId: string,
  expectedTitle: string,
  timeoutMs = 2500
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const snapshot = await nextWorkbenchSnapshot(queue, Math.max(50, deadline - Date.now()));

    if (findWorkbenchSession(snapshot, sessionId)?.title === expectedTitle) {
      return;
    }
  }

  throw new Error(`等待 workbench 标题更新超时: ${expectedTitle}`);
}

function writeCodexSessionFile(input: {
  codexHomeDir: string;
  workspaceDir: string;
  fileName: string;
  timestamps: [string, string, string];
  includeToolCall?: boolean;
}): string {
  const sessionDir = path.join(input.codexHomeDir, "sessions", "2026", "03", "23");
  const sessionFile = path.join(sessionDir, `${input.fileName}.jsonl`);
  mkdirSync(sessionDir, { recursive: true });

  const lines = [
    JSON.stringify({
      timestamp: input.timestamps[0],
      type: "session_meta",
      payload: {
        id: input.fileName,
        timestamp: input.timestamps[0],
        cwd: input.workspaceDir,
        originator: "Codex",
        source: "test"
      }
    }),
    JSON.stringify({
      timestamp: input.timestamps[1],
      type: "event_msg",
      payload: {
        type: "user_message",
        message: `${input.fileName} user message`
      }
    }),
    JSON.stringify({
      timestamp: input.timestamps[2],
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: `${input.fileName} assistant message`
      }
    })
  ];

  if (input.includeToolCall) {
    lines.push(
      JSON.stringify({
        timestamp: "2026-03-23T09:00:09.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-shell-1",
          name: "shell_command",
          arguments: {
            command: "git status --short"
          }
        }
      })
    );
  }

  writeFileSync(sessionFile, lines.join("\n"), "utf8");
  return sessionFile;
}
