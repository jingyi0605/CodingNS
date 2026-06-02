import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveHostConfig } from "../../src/config/env.js";
import { SessionChangedFileService } from "../../src/modules/sessions/session-changed-file-service.js";
import { SessionHistoryService } from "../../src/modules/sessions/session-history-service.js";
import { SessionMessageAttachmentService } from "../../src/modules/sessions/session-message-attachment-service.js";
import { createTaskManager } from "../../src/modules/tasks/task-manager.js";
import { HOST_TASK_TYPES } from "../../src/modules/tasks/task-types.js";
import { ProviderControlRepository } from "../../src/storage/repositories/provider-control-repository.js";
import { SessionBindingRepository } from "../../src/storage/repositories/session-binding-repository.js";
import { SessionChangedFileRepository } from "../../src/storage/repositories/session-changed-file-repository.js";
import { SessionIndexRepository } from "../../src/storage/repositories/session-index-repository.js";
import { SessionMessageAttachmentRepository } from "../../src/storage/repositories/session-message-attachment-repository.js";
import { SessionStateRepository } from "../../src/storage/repositories/session-state-repository.js";
import { SessionStatusSnapshotRepository } from "../../src/storage/repositories/session-status-snapshot-repository.js";
import { WorkspaceRepository } from "../../src/storage/repositories/workspace-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

const tempDirs: string[] = [];

describe("provider control in SessionHistoryService", { timeout: 30_000 }, () => {
  afterEach(() => {
    vi.restoreAllMocks();

    while (tempDirs.length > 0) {
      const target = tempDirs.pop();

      if (target) {
        rmSync(target, { recursive: true, force: true });
      }
    }
  });

  it("后台发现任务只会把启用的 provider 传给 helper", async () => {
    let capturedEnabledProviders: string[] | null = null;
    const taskManager = createTaskManager(null, {
      helper_process: {
        execute: async (definition, input, context) => {
          if (definition.taskType === HOST_TASK_TYPES.workspaceDiscoveryScan) {
            capturedEnabledProviders = [...(input as { enabledProviders: string[] }).enabledProviders];
            return {
              sessions: [],
              isComplete: true,
              providerDiagnostics: []
            };
          }

          return await definition.run(input, context);
        }
      }
    });
    const service = createSessionHistoryHarness({}, taskManager);
    seedWorkspace(service.workspaceRepository, service.database.db, service.workspacePath);
    service.providerControlRepository.upsert({
      providerId: "codex",
      enabled: false,
      updatedAt: "2026-04-26T10:00:00.000Z"
    });

    const sessions = await service.instance.discoverWorkspaceSessions("workspace-1", "user-1", {
      force: true
    });

    expect(sessions).toEqual([]);
    expect(capturedEnabledProviders).not.toBeNull();
    expect(capturedEnabledProviders).not.toContain("codex");
    expect(capturedEnabledProviders).toContain("claude-code");

    service.dispose();
  });

  it("禁用 provider 后，会话列表会隐藏旧会话", () => {
    const service = createSessionHistoryHarness();
    seedWorkspace(service.workspaceRepository, service.database.db, service.workspacePath);
    seedSession(service.database.db, {
      sessionId: "session-codex",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "codex-session-1",
      rawStoreRef: "codex://session-1",
      title: "Codex Session",
      messageCount: 3,
      lastMessageAt: "2026-04-26T09:00:00.000Z",
      createdAt: "2026-04-26T09:00:00.000Z",
      updatedAt: "2026-04-26T09:00:00.000Z"
    });
    seedSession(service.database.db, {
      sessionId: "session-claude",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      rawStoreRef: "claude://session-1",
      title: "Claude Session",
      messageCount: 4,
      lastMessageAt: "2026-04-26T09:10:00.000Z",
      createdAt: "2026-04-26T09:10:00.000Z",
      updatedAt: "2026-04-26T09:10:00.000Z"
    });
    service.providerControlRepository.upsert({
      providerId: "codex",
      enabled: false,
      updatedAt: "2026-04-26T10:00:00.000Z"
    });

    const sessions = service.instance.listWorkspaceSessions("workspace-1", "user-1");

    expect(sessions.map((item) => item.sessionId)).toEqual(["session-claude"]);

    service.dispose();
  });

  it("事务轻量会话不会出现在工作区会话列表里，但仍然可以按 id 读取", () => {
    const service = createSessionHistoryHarness();
    seedWorkspace(service.workspaceRepository, service.database.db, service.workspacePath);
    seedSession(service.database.db, {
      sessionId: "session-lightweight",
      workspaceId: "workspace-1",
      provider: "gemini",
      providerSessionId: "gemini-session-1",
      rawStoreRef: "synthetic://gemini/session-lightweight",
      title: "事务轻量会话",
      messageCount: 1,
      lastMessageAt: "2026-06-02T10:00:00.000Z",
      createdAt: "2026-06-02T10:00:00.000Z",
      updatedAt: "2026-06-02T10:00:00.000Z",
      sessionVisibility: "affairs_lightweight"
    });
    seedSession(service.database.db, {
      sessionId: "session-workspace",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      rawStoreRef: "claude://session-workspace",
      title: "普通工作区会话",
      messageCount: 1,
      lastMessageAt: "2026-06-02T10:01:00.000Z",
      createdAt: "2026-06-02T10:01:00.000Z",
      updatedAt: "2026-06-02T10:01:00.000Z"
    });

    const sessions = service.instance.listWorkspaceSessions("workspace-1", "user-1");
    const hiddenSession = service.instance.getSession("session-lightweight", "user-1");

    expect(sessions.map((item) => item.sessionId)).toEqual(["session-workspace"]);
    expect(hiddenSession.sessionId).toBe("session-lightweight");
    expect(hiddenSession.sessionVisibility).toBe("affairs_lightweight");

    service.dispose();
  });

  it("Codex 会话列表会同时显示原生会话和旧私有 runtime 会话", () => {
    const service = createSessionHistoryHarness();
    seedWorkspace(service.workspaceRepository, service.database.db, service.workspacePath);
    seedSession(service.database.db, {
      sessionId: "session-native",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "codex-native-1",
      rawStoreRef: "/Users/test/.codex/sessions/2026/04/29/rollout-native-1.jsonl",
      title: "Native Codex Session",
      messageCount: 3,
      lastMessageAt: "2026-04-29T09:10:00.000Z",
      createdAt: "2026-04-29T09:10:00.000Z",
      updatedAt: "2026-04-29T09:10:00.000Z"
    });
    seedSession(service.database.db, {
      sessionId: "session-stale-runtime",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "codex-runtime-1",
      rawStoreRef:
        "/Users/test/.codingns/session-provider-runtime/codex/runtime-1/sessions/2026/04/29/rollout-runtime-1.jsonl",
      title: "Stale Runtime Codex Session",
      messageCount: 2,
      lastMessageAt: "2026-04-29T09:20:00.000Z",
      createdAt: "2026-04-29T09:20:00.000Z",
      updatedAt: "2026-04-29T09:20:00.000Z"
    });

    const sessions = service.instance.listWorkspaceSessions("workspace-1", "user-1");

    expect(sessions.map((item) => item.sessionId)).toEqual([
      "session-stale-runtime",
      "session-native"
    ]);

    service.dispose();
  });

  it("工作区发现传给 helper 的 knownSessions 会保留旧私有 runtime 会话用于兼容显示", async () => {
    let capturedKnownSessions:
      | Array<{ provider: string; providerSessionId: string; rawStoreRef: string }>
      | null = null;
    const taskManager = createTaskManager(null, {
      helper_process: {
        execute: async (definition, input, context) => {
          if (definition.taskType === HOST_TASK_TYPES.workspaceDiscoveryScan) {
            capturedKnownSessions = [
              ...((input as {
                knownSessions: Array<{
                  provider: string;
                  providerSessionId: string;
                  rawStoreRef: string;
                }>;
              }).knownSessions)
            ];
            return {
              sessions: [],
              isComplete: true,
              providerDiagnostics: []
            };
          }

          return await definition.run(input, context);
        }
      }
    });
    const service = createSessionHistoryHarness({}, taskManager);
    seedWorkspace(service.workspaceRepository, service.database.db, service.workspacePath);
    seedSession(service.database.db, {
      sessionId: "session-native",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "codex-native-1",
      rawStoreRef: "/Users/test/.codex/sessions/2026/04/29/rollout-native-1.jsonl",
      title: "Native Codex Session",
      messageCount: 3,
      lastMessageAt: "2026-04-29T09:10:00.000Z",
      createdAt: "2026-04-29T09:10:00.000Z",
      updatedAt: "2026-04-29T09:10:00.000Z"
    });
    seedSession(service.database.db, {
      sessionId: "session-stale-runtime",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "codex-runtime-1",
      rawStoreRef:
        "/Users/test/.codingns/session-provider-runtime/codex/runtime-1/sessions/2026/04/29/rollout-runtime-1.jsonl",
      title: "Stale Runtime Codex Session",
      messageCount: 2,
      lastMessageAt: "2026-04-29T09:20:00.000Z",
      createdAt: "2026-04-29T09:20:00.000Z",
      updatedAt: "2026-04-29T09:20:00.000Z"
    });

    await service.instance.discoverWorkspaceSessions("workspace-1", "user-1", {
      force: true
    });

    expect(capturedKnownSessions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: "codex",
        providerSessionId: "codex-native-1",
        rawStoreRef: "/Users/test/.codex/sessions/2026/04/29/rollout-native-1.jsonl"
      }),
      expect.objectContaining({
        provider: "codex",
        providerSessionId: "codex-runtime-1",
        rawStoreRef:
          "/Users/test/.codingns/session-provider-runtime/codex/runtime-1/sessions/2026/04/29/rollout-runtime-1.jsonl"
      })
    ]));
    expect(capturedKnownSessions).toHaveLength(2);

    service.dispose();
  });

  it("工作区发现会把只有 fork 父子关系的 Codex 会话从旧 subagent 误标记纠正回来", async () => {
    let workspacePath = "";
    const taskManager = createTaskManager(null, {
      helper_process: {
        execute: async (definition, input, context) => {
          if (definition.taskType === HOST_TASK_TYPES.workspaceDiscoveryScan) {
            return {
              sessions: [
                {
                  provider: "codex",
                  providerSessionId: "codex-fork-1",
                  title: "Fork Codex Session",
                  workspacePath,
                  rawStoreRef: "/Users/test/.codex/sessions/2026/04/29/rollout-fork-1.jsonl",
                  lastMessageAt: "2026-04-29T09:30:00.000Z",
                  messageCount: 3,
                  isArchived: false,
                  parentProviderSessionId: "codex-parent-1",
                  isSubagent: false,
                  subagentLabel: null
                }
              ],
              isComplete: true,
              providerDiagnostics: []
            };
          }

          return await definition.run(input, context);
        }
      }
    });
    const service = createSessionHistoryHarness({}, taskManager);
    workspacePath = service.workspacePath;
    seedWorkspace(service.workspaceRepository, service.database.db, service.workspacePath);
    seedSession(service.database.db, {
      sessionId: "session-fork",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "codex-fork-1",
      rawStoreRef:
        "/Users/test/.codingns/session-provider-runtime/codex/runtime-1/sessions/2026/04/28/rollout-fork-1.jsonl",
      title: "Fork Codex Session",
      messageCount: 2,
      lastMessageAt: "2026-04-28T09:20:00.000Z",
      createdAt: "2026-04-28T09:20:00.000Z",
      updatedAt: "2026-04-28T09:20:00.000Z",
      isSubagent: true,
      subagentLabel: "worker · stale"
    });

    await service.instance.discoverWorkspaceSessions("workspace-1", "user-1", {
      force: true
    });

    const sessions = service.instance.listWorkspaceSessions("workspace-1", "user-1");
    const correctedSession = sessions.find((item) => item.sessionId === "session-fork");

    expect(correctedSession).toMatchObject({
      sessionId: "session-fork",
      rawStoreRef: "/Users/test/.codex/sessions/2026/04/29/rollout-fork-1.jsonl",
      isSubagent: false,
      subagentLabel: null
    });

    service.dispose();
  });

  it("禁用 provider 后，start/resume/send/fork 都会统一返回 PROVIDER_DISABLED", async () => {
    const service = createSessionHistoryHarness({
      codexCliPath: join(serviceTempRoot(tempDirs), "missing-codex")
    });
    seedWorkspace(service.workspaceRepository, service.database.db, service.workspacePath);
    seedSession(service.database.db, {
      sessionId: "session-disabled",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "codex-session-1",
      rawStoreRef: "codex://session-1",
      title: "Disabled Codex Session",
      messageCount: 1,
      lastMessageAt: "2026-04-26T09:00:00.000Z",
      createdAt: "2026-04-26T09:00:00.000Z",
      updatedAt: "2026-04-26T09:00:00.000Z"
    });
    service.providerControlRepository.upsert({
      providerId: "codex",
      enabled: false,
      updatedAt: "2026-04-26T10:00:00.000Z"
    });

    await expect(service.instance.startSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "codex"
    })).rejects.toMatchObject({
      errorCode: "PROVIDER_DISABLED"
    });

    await expect(service.instance.resumeSession("session-disabled")).rejects.toMatchObject({
      errorCode: "PROVIDER_DISABLED"
    });

    await expect(service.instance.sendMessage("session-disabled", "继续", null)).rejects.toMatchObject({
      errorCode: "PROVIDER_DISABLED"
    });

    await expect(service.instance.forkSession({
      sessionId: "session-disabled",
      userId: "user-1",
      sourceType: "session"
    })).rejects.toMatchObject({
      errorCode: "PROVIDER_DISABLED"
    });

    service.dispose();
  });
});

function createSessionHistoryHarness(
  overrides: Partial<ReturnType<typeof resolveHostConfig>> = {},
  taskManager = createTaskManager()
) {
  const rootDir = serviceTempRoot(tempDirs);
  const workspacePath = join(rootDir, "workspace");
  const claudeCodeHomeDir = join(rootDir, "claude-home");
  const legnaCodeHomeDir = join(rootDir, "legna-home");
  const codexHomeDir = join(rootDir, "codex-home");
  const geminiHomeDir = join(rootDir, "gemini-home");
  const kimiHomeDir = join(rootDir, "kimi-home");
  const opencodeDataDir = join(rootDir, "opencode-data");

  [
    workspacePath,
    claudeCodeHomeDir,
    legnaCodeHomeDir,
    codexHomeDir,
    geminiHomeDir,
    kimiHomeDir,
    opencodeDataDir
  ].forEach((dir) => mkdirSync(dir, { recursive: true }));

  const config = resolveHostConfig({
    databasePath: ":memory:",
    claudeCodeHomeDir,
    legnaCodeHomeDir,
    codexHomeDir,
    geminiHomeDir,
    kimiHomeDir,
    opencodeDataDir,
    opencodeDbPath: join(opencodeDataDir, "opencode.db"),
    ...overrides
  });
  const database = createDatabaseClient(":memory:");
  const workspaceRepository = new WorkspaceRepository(database.db);
  const providerControlRepository = new ProviderControlRepository(database.db);
  const instance = new SessionHistoryService(
    database.db,
    workspaceRepository,
    new SessionBindingRepository(database.db),
    new SessionChangedFileService(new SessionChangedFileRepository(database.db)),
    new SessionIndexRepository(database.db),
    new SessionMessageAttachmentService(
      new SessionMessageAttachmentRepository(database.db),
      config
    ),
    new SessionStateRepository(database.db),
    new SessionStatusSnapshotRepository(database.db),
    config,
    undefined,
    null,
    null,
    {},
    taskManager,
    null,
    null,
    null,
    null,
    providerControlRepository
  );

  return {
    instance,
    database,
    workspaceRepository,
    providerControlRepository,
    workspacePath,
    dispose() {
      database.close();
    }
  };
}

function seedWorkspace(
  workspaceRepository: WorkspaceRepository,
  db: ReturnType<typeof createDatabaseClient>["db"],
  workspacePath: string
): void {
  db.prepare(
    `INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    "user-1",
    "tester",
    "hash",
    "admin",
    "2026-04-26T08:00:00.000Z",
    "2026-04-26T08:00:00.000Z"
  );

  workspaceRepository.create({
    id: "workspace-1",
    name: "Workspace 1",
    path: workspacePath,
    repoRoot: workspacePath,
    favorite: false,
    createdAt: "2026-04-26T08:00:00.000Z",
    updatedAt: "2026-04-26T08:00:00.000Z",
    removedAt: null
  });
}

function seedSession(
  db: ReturnType<typeof createDatabaseClient>["db"],
  input: {
    sessionId: string;
    workspaceId: string;
    provider: string;
    providerSessionId: string;
    rawStoreRef: string;
    title: string;
    messageCount: number;
    lastMessageAt: string | null;
    createdAt: string;
    updatedAt: string;
    isSubagent?: boolean;
    subagentLabel?: string | null;
    sessionVisibility?: "workspace" | "affairs_lightweight";
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
    input.providerSessionId,
    input.rawStoreRef,
    input.createdAt,
    input.updatedAt
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
       session_visibility,
       is_subagent,
       subagent_label,
       title,
       message_count,
       is_archived,
       last_message_at,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.sessionId,
    input.workspaceId,
    input.provider,
    null,
    "default",
    null,
    null,
    input.sessionVisibility ?? "workspace",
    input.isSubagent ? 1 : 0,
    input.subagentLabel ?? null,
    input.title,
    input.messageCount,
    0,
    input.lastMessageAt,
    input.createdAt,
    input.updatedAt
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
    null,
    null,
    null,
    null,
    input.updatedAt
  );
}

function serviceTempRoot(targets: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "codingns-provider-control-session-history-"));
  targets.push(dir);
  return dir;
}
