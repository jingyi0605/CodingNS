import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { GeminiAdapter, KimiAdapter } from "@codingns/session-sync-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveHostConfig } from "../../src/config/env.js";
import { SessionChangedFileService } from "../../src/modules/sessions/session-changed-file-service.js";
import { SessionHistoryService } from "../../src/modules/sessions/session-history-service.js";
import { SessionMessageAttachmentService } from "../../src/modules/sessions/session-message-attachment-service.js";
import { SessionBindingRepository } from "../../src/storage/repositories/session-binding-repository.js";
import { SessionChangedFileRepository } from "../../src/storage/repositories/session-changed-file-repository.js";
import { SessionIndexRepository } from "../../src/storage/repositories/session-index-repository.js";
import { SessionMessageAttachmentRepository } from "../../src/storage/repositories/session-message-attachment-repository.js";
import { SessionStateRepository } from "../../src/storage/repositories/session-state-repository.js";
import { SessionStatusSnapshotRepository } from "../../src/storage/repositories/session-status-snapshot-repository.js";
import { WorkspaceRepository } from "../../src/storage/repositories/workspace-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";
import { createEmptyFixture } from "../helpers/test-app.js";

const cleanupTargets: string[] = [];
const closers: Array<() => void> = [];

describe("provider session delete", () => {
  afterEach(() => {
    while (closers.length > 0) {
      closers.pop()?.();
    }

    while (cleanupTargets.length > 0) {
      const target = cleanupTargets.pop();

      if (target) {
        rmSync(target, { recursive: true, force: true });
      }
    }

    vi.restoreAllMocks();
  });

  it("Gemini adapter 会删除本地 chat 文件并暴露删除能力", async () => {
    const rootDir = createTempDir("codingns-gemini-delete-");
    const geminiHomeDir = path.join(rootDir, "gemini-home");
    const chatDir = path.join(geminiHomeDir, "tmp", "fixture", "chats");
    const chatPath = path.join(chatDir, "gemini-session-1.json");

    mkdirSync(chatDir, { recursive: true });
    writeFileSync(
      chatPath,
      JSON.stringify({
        sessionId: "gemini-session-1",
        title: "Gemini 删除样本",
        messages: []
      }),
      "utf8"
    );

    const adapter = new GeminiAdapter({ homeDir: geminiHomeDir });
    await adapter.deleteSession("gemini-session-1", "");

    expect(existsSync(chatPath)).toBe(false);
    expect(adapter.getProviderCapabilities().supportsSessionDelete).toBe(true);
  });

  it("Kimi adapter 会删除整个会话目录并暴露删除能力", async () => {
    const rootDir = createTempDir("codingns-kimi-delete-");
    const kimiHomeDir = path.join(rootDir, "kimi-home");
    const sessionDir = path.join(kimiHomeDir, "sessions", "hash-1", "kimi-session-1");

    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      path.join(sessionDir, "state.json"),
      JSON.stringify({
        sessionId: "kimi-session-1",
        title: "Kimi 删除样本"
      }),
      "utf8"
    );

    const adapter = new KimiAdapter({ homeDir: kimiHomeDir });
    await adapter.deleteSession("kimi-session-1", "");

    expect(existsSync(sessionDir)).toBe(false);
    expect(adapter.getProviderCapabilities().supportsSessionDelete).toBe(true);
  });

  it("SessionHistoryService 删除会话时会调用 CLI 传输层并清理本地索引", async () => {
    const fixture = createEmptyFixture();
    cleanupTargets.push(fixture.rootDir);
    const cliDelete = {
      deleteSession: vi.fn(async () => {})
    };
    const context = createServiceContext(fixture, cliDelete);

    seedSession(context, {
      sessionId: "session-1",
      provider: "gemini",
      providerSessionId: "gemini-session-1",
      rawStoreRef: "gemini://session/gemini-session-1",
      runningState: "idle"
    });

    await context.service.deleteSession("session-1", "user-1");

    expect(cliDelete.deleteSession).toHaveBeenCalledTimes(1);
    expect(cliDelete.deleteSession).toHaveBeenCalledWith({
      provider: "gemini",
      providerSessionId: "gemini-session-1",
      rawStoreRef: "gemini://session/gemini-session-1"
    });
    expect(context.sessionBindingRepository.findBySessionId("session-1")).toBeNull();
    expect(context.sessionIndexRepository.findIndexRecordBySessionId("session-1")).toBeNull();
    expect(context.sessionStateRepository.findBySessionAndUser("session-1", "user-1")).toBeNull();
  });

  it("底层 provider 会话已经不存在时，SessionHistoryService 仍会删除本地索引", async () => {
    const fixture = createEmptyFixture();
    cleanupTargets.push(fixture.rootDir);
    const cliDelete = {
      deleteSession: vi.fn(async () => {
        throw new Error("PROVIDER_SESSION_NOT_FOUND");
      })
    };
    const context = createServiceContext(fixture, cliDelete);

    seedSession(context, {
      sessionId: "session-404",
      provider: "kimi",
      providerSessionId: "kimi-session-404",
      rawStoreRef: "kimi://session/kimi-session-404",
      runningState: "idle"
    });

    await expect(
      context.service.deleteSession("session-404", "user-1")
    ).resolves.toBeUndefined();

    expect(cliDelete.deleteSession).toHaveBeenCalledTimes(1);
    expect(context.sessionBindingRepository.findBySessionId("session-404")).toBeNull();
    expect(context.sessionIndexRepository.findIndexRecordBySessionId("session-404")).toBeNull();
  });

  it("删除会话时会通知已注册的删除观察器", async () => {
    const fixture = createEmptyFixture();
    cleanupTargets.push(fixture.rootDir);
    const cliDelete = {
      deleteSession: vi.fn(async () => {})
    };
    const context = createServiceContext(fixture, cliDelete);
    const observer = vi.fn(async () => {});

    seedSession(context, {
      sessionId: "session-observer-1",
      provider: "gemini",
      providerSessionId: "gemini-session-observer-1",
      rawStoreRef: "gemini://session/gemini-session-observer-1",
      runningState: "idle"
    });

    context.service.registerSessionDeletedObserver(observer);
    await context.service.deleteSession("session-observer-1", "user-1");

    expect(observer).toHaveBeenCalledWith({
      sessionId: "session-observer-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      remainingWorkspaceSessionCount: 0
    });
  });

  it("删除会话时会先解绑渠道历史里的 control session 引用", async () => {
    const fixture = createEmptyFixture();
    cleanupTargets.push(fixture.rootDir);
    const cliDelete = {
      deleteSession: vi.fn(async () => {})
    };
    const context = createServiceContext(fixture, cliDelete);

    seedSession(context, {
      sessionId: "session-channel-1",
      provider: "codex",
      providerSessionId: "codex-session-channel-1",
      rawStoreRef: "codex://session/codex-session-channel-1",
      runningState: "idle"
    });

    context.db.exec(`
      INSERT INTO butler_control_sessions (
        id,
        provider_id,
        session_id,
        purpose,
        title,
        source_item_id,
        model,
        reasoning_level,
        permission_mode,
        status,
        last_context_version,
        last_summary,
        created_at,
        updated_at
      ) VALUES (
        'control-channel-1',
        'codex',
        'session-channel-1',
        'chat',
        '渠道控制会话',
        NULL,
        'gpt-5.4',
        'high',
        'default',
        'idle',
        NULL,
        NULL,
        '2026-04-19T10:00:00.000Z',
        '2026-04-19T10:00:00.000Z'
      );

      INSERT INTO channel_accounts (
        id,
        user_id,
        platform_code,
        display_name,
        provider_id,
        connection_mode,
        status,
        config_json,
        runtime_state_json,
        last_inbound_at,
        last_outbound_at,
        last_error,
        created_at,
        updated_at
      ) VALUES (
        'channel-account-1',
        'user-1',
        'wechat-claw',
        '测试渠道',
        'codex',
        'bridge',
        'active',
        '{}',
        '{}',
        NULL,
        NULL,
        NULL,
        '2026-04-19T10:00:00.000Z',
        '2026-04-19T10:00:00.000Z'
      );

      INSERT INTO channel_threads (
        id,
        channel_account_id,
        external_conversation_key,
        external_user_id,
        external_thread_key,
        control_session_id,
        session_id,
        title,
        status,
        last_inbound_at,
        last_outbound_at,
        last_transport_context_json,
        created_at,
        updated_at
      ) VALUES (
        'channel-thread-1',
        'channel-account-1',
        'conversation-1',
        'external-user-1',
        'thread-1',
        'control-channel-1',
        'session-channel-1',
        '历史线程',
        'active',
        '2026-04-19T10:00:01.000Z',
        '2026-04-19T10:00:02.000Z',
        '{}',
        '2026-04-19T10:00:00.000Z',
        '2026-04-19T10:00:02.000Z'
      );

      INSERT INTO channel_inbound_events (
        id,
        channel_account_id,
        external_event_id,
        external_conversation_key,
        external_user_id,
        control_session_id,
        session_id,
        text_content,
        payload_json,
        status,
        error_message,
        received_at,
        processed_at
      ) VALUES (
        'channel-inbound-1',
        'channel-account-1',
        'event-1',
        'conversation-1',
        'external-user-1',
        'control-channel-1',
        'session-channel-1',
        '用户发来一条消息',
        '{}',
        'replied',
        NULL,
        '2026-04-19T10:00:03.000Z',
        '2026-04-19T10:00:04.000Z'
      );

      INSERT INTO channel_deliveries (
        id,
        channel_account_id,
        thread_id,
        inbound_event_id,
        control_session_id,
        session_id,
        text_content,
        provider_message_ref,
        status,
        error_message,
        created_at,
        updated_at
      ) VALUES (
        'channel-delivery-1',
        'channel-account-1',
        'channel-thread-1',
        'channel-inbound-1',
        'control-channel-1',
        'session-channel-1',
        '助手回了一条消息',
        'provider-message-1',
        'sent',
        NULL,
        '2026-04-19T10:00:05.000Z',
        '2026-04-19T10:00:05.000Z'
      );
    `);

    await expect(
      context.service.deleteSession("session-channel-1", "user-1")
    ).resolves.toBeUndefined();

    expect(
      context.db.prepare("SELECT COUNT(*) AS count FROM butler_control_sessions WHERE session_id = ?")
        .get("session-channel-1")
    ).toEqual({ count: 0 });
    expect(
      context.db.prepare(
        "SELECT control_session_id, session_id FROM channel_threads WHERE id = ?"
      ).get("channel-thread-1")
    ).toEqual({
      control_session_id: null,
      session_id: null
    });
    expect(
      context.db.prepare(
        "SELECT control_session_id, session_id FROM channel_inbound_events WHERE id = ?"
      ).get("channel-inbound-1")
    ).toEqual({
      control_session_id: null,
      session_id: null
    });
    expect(
      context.db.prepare(
        "SELECT control_session_id, session_id FROM channel_deliveries WHERE id = ?"
      ).get("channel-delivery-1")
    ).toEqual({
      control_session_id: null,
      session_id: null
    });
  });

  it("运行态会话如果回刷后已结束，删除接口不应继续误拦", async () => {
    const fixture = createEmptyFixture();
    cleanupTargets.push(fixture.rootDir);
    const cliDelete = {
      deleteSession: vi.fn(async () => {})
    };
    const context = createServiceContext(fixture, cliDelete);
    const transcriptPath = path.join(fixture.rootDir, "claude-finished.jsonl");

    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [{ type: "text", text: "复刻首页" }]
          },
          timestamp: "2026-04-19T10:00:01.000Z",
          sessionId: "claude-session-finished"
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "已经结束" }],
            stop_reason: "end_turn"
          },
          timestamp: "2026-04-19T10:00:05.000Z",
          sessionId: "claude-session-finished"
        })
      ].join("\n"),
      "utf8"
    );

    seedSession(context, {
      sessionId: "session-stale-running",
      provider: "claude-code",
      providerSessionId: "claude-session-finished",
      rawStoreRef: transcriptPath,
      runningState: "running"
    });

    await expect(
      context.service.deleteSession("session-stale-running", "user-1")
    ).resolves.toBeUndefined();

    expect(cliDelete.deleteSession).toHaveBeenCalledWith({
      provider: "claude-code",
      providerSessionId: "claude-session-finished",
      rawStoreRef: transcriptPath
    });
    expect(context.sessionBindingRepository.findBySessionId("session-stale-running")).toBeNull();
  });

  it("运行态会话如果 transcript 已经明确 end_turn，回刷后应从 running 收口", async () => {
    const fixture = createEmptyFixture();
    cleanupTargets.push(fixture.rootDir);
    const cliDelete = {
      deleteSession: vi.fn(async () => {})
    };
    const context = createServiceContext(fixture, cliDelete);
    const transcriptPath = path.join(fixture.rootDir, "claude-end-turn.jsonl");

    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [{ type: "text", text: "做一个首页" }]
          },
          timestamp: "2026-04-19T10:00:01.000Z",
          sessionId: "claude-session-2"
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "处理完成" }],
            stop_reason: "end_turn"
          },
          timestamp: "2026-04-19T10:00:05.000Z",
          sessionId: "claude-session-2"
        })
      ].join("\n"),
      "utf8"
    );

    seedSession(context, {
      sessionId: "session-ended",
      provider: "claude-code",
      providerSessionId: "claude-session-2",
      rawStoreRef: transcriptPath,
      runningState: "running"
    });

    const refreshed = await context.service.refreshRuntimeFallbackSession("session-ended", "user-1");

    expect(refreshed.runningState).toBe("idle");
    expect(refreshed.activitySource).toBe("inferred");
    expect(refreshed.completedAt).toBe("2026-04-19T10:00:05.000Z");
  });
});

function createTempDir(prefix: string): string {
  const rootDir = path.join(os.tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(rootDir, { recursive: true });
  cleanupTargets.push(rootDir);
  return rootDir;
}

function createServiceContext(
  fixture: ReturnType<typeof createEmptyFixture>,
  providerSessionDeleteCli: {
    deleteSession: ReturnType<typeof vi.fn>;
  }
) {
  const config = resolveHostConfig({
    databasePath: ":memory:",
    claudeCodeHomeDir: fixture.claudeHomeDir,
    codexHomeDir: fixture.codexHomeDir,
    geminiHomeDir: fixture.geminiHomeDir,
    kimiHomeDir: fixture.kimiHomeDir
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
    undefined,
    null,
    null,
    {
      providerSessionDeleteCli
    }
  );

  closers.push(() => database.close());

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
      "2026-04-19T10:00:00.000Z",
      "2026-04-19T10:00:00.000Z"
    );
  workspaceRepository.create({
    id: "workspace-1",
    name: "Fixture Workspace",
    path: fixture.workspaceDir,
    repoRoot: fixture.workspaceDir,
    favorite: false,
    createdAt: "2026-04-19T10:00:00.000Z",
    updatedAt: "2026-04-19T10:00:00.000Z",
    removedAt: null
  });

  return {
    db: database.db,
    service,
    sessionBindingRepository,
    sessionIndexRepository,
    sessionStateRepository,
    workspaceRepository
  };
}

function seedSession(
  context: ReturnType<typeof createServiceContext>,
  input: {
    sessionId: string;
    provider: string;
    providerSessionId: string;
    rawStoreRef: string;
    runningState: "idle" | "running" | "starting" | "completed" | "interrupted" | "failed";
  }
): void {
  context.sessionBindingRepository.upsert({
    sessionId: input.sessionId,
    workspaceId: "workspace-1",
    provider: input.provider,
    providerSessionId: input.providerSessionId,
    rawStoreRef: input.rawStoreRef,
    providerConfigMode: "global-default",
    providerPresetId: null,
    runtimeHomeDir: null,
    createdAt: "2026-04-19T10:00:01.000Z",
    updatedAt: "2026-04-19T10:00:01.000Z"
  });
  context.sessionIndexRepository.upsert({
    sessionId: input.sessionId,
    workspaceId: "workspace-1",
    provider: input.provider,
    title: "待删除会话",
    messageCount: 3,
    isArchived: false,
    lastMessageAt: "2026-04-19T10:00:05.000Z",
    createdAt: "2026-04-19T10:00:01.000Z",
    updatedAt: "2026-04-19T10:00:01.000Z",
    parentSessionId: null,
    sessionKind: "default",
    annotationSourceMessageId: null,
    annotationSourceText: null,
    isSubagent: false,
    subagentLabel: null
  });
  context.sessionStateRepository.upsert({
    sessionId: input.sessionId,
    userId: "user-1",
    runningState: input.runningState,
    activitySource: "none",
    favorite: false,
    lastEventAt: "2026-04-19T10:00:05.000Z",
    completedAt: null,
    lastSeenAt: "2026-04-19T10:00:05.000Z",
    updatedAt: "2026-04-19T10:00:05.000Z"
  });
}
