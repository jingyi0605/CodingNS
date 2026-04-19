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
