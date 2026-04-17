import { mkdirSync, writeFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveHostConfig } from "../../src/config/env.js";
import { SessionActivityAuthorityService } from "../../src/modules/sessions/session-activity-authority-service.js";
import { SessionChangedFileService } from "../../src/modules/sessions/session-changed-file-service.js";
import { SessionHistoryService } from "../../src/modules/sessions/session-history-service.js";
import { SessionMessageAttachmentService } from "../../src/modules/sessions/session-message-attachment-service.js";
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

function createHarness() {
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
    sessionMessageOriginRepository
  );

  activeFixtures.push(fixture);
  activeClosers.push(() => database.close());

  workspaceRepository.create({
    id: "workspace-1",
    name: "Fixture Workspace",
    path: fixture.workspaceDir,
    repoRoot: fixture.workspaceDir,
    favorite: false,
    createdAt: "2026-04-16T08:00:00.000Z",
    updatedAt: "2026-04-16T08:00:00.000Z",
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
      "2026-04-16T08:00:00.000Z",
      "2026-04-16T08:00:00.000Z"
    );

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
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "pending://codex/session-missing-index",
      rawStoreRef: "pending://codex/session-missing-index",
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
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-1",
      rawStoreRef: "pending://codex/session-1",
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
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-1",
      rawStoreRef: "pending://codex/session-1",
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
    const { service, sessionBindingRepository, sessionIndexRepository } = createHarness();
    const recentTimestamp = new Date().toISOString();
    const syntheticRawStoreRef = `${process.cwd()}/.tmp/runtime/codex/recent-missing.stream`;

    sessionBindingRepository.upsert({
      sessionId: "session-recent-synthetic",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-recent",
      rawStoreRef: syntheticRawStoreRef,
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

    Object.defineProperty(service, "providerDiscoveryHelperClient", {
      value: {
        discoverWorkspaceSessions: vi.fn(async () => ({
          sessions: [],
          isComplete: true
        }))
      },
      configurable: true
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
    const { service, sessionBindingRepository, sessionIndexRepository } = createHarness();
    const staleTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const syntheticRawStoreRef = `${process.cwd()}/.tmp/runtime/codex/stale-missing.stream`;

    sessionBindingRepository.upsert({
      sessionId: "session-stale-synthetic",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-stale",
      rawStoreRef: syntheticRawStoreRef,
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

    Object.defineProperty(service, "providerDiscoveryHelperClient", {
      value: {
        discoverWorkspaceSessions: vi.fn(async () => ({
          sessions: [],
          isComplete: true
        }))
      },
      configurable: true
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
    } = createHarness();
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
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "rollout-2026-04-11T09-11-20.543Z-test",
      rawStoreRef: rolloutFilePath,
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
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "butler-project-1",
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
           project_id,
           session_id,
           role,
           ownership_mode,
           status,
           last_summary,
           last_checkpoint_at,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "butler-session-1",
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

    Object.defineProperty(service, "providerDiscoveryHelperClient", {
      value: {
        discoverWorkspaceSessions: vi.fn(async () => ({
          sessions: [],
          isComplete: true
        }))
      },
      configurable: true
    });

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
});
