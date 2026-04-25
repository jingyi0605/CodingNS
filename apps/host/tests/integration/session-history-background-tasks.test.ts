import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { ProviderCapabilities } from "@codingns/session-sync-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveHostConfig } from "../../src/config/env.js";
import { createTaskManager, type TaskManager } from "../../src/modules/tasks/task-manager.js";
import { HOST_TASK_TYPES } from "../../src/modules/tasks/task-types.js";
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

describe("SessionHistoryService background tasks", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();

      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("workspace discovery 会进入统一任务管理器并按工作区去重", async () => {
    const discoverDeferred = createDeferred<{ sessions: []; isComplete: true }>();
    const discoverMock = vi.fn(async () => discoverDeferred.promise);
    const taskManager = createTaskManager(null, {
      helper_process: {
        execute: async (definition, input, context) => {
          if (definition.taskType === HOST_TASK_TYPES.workspaceDiscoveryScan) {
            return await discoverMock(input, context.signal);
          }

          return await definition.run(input, context);
        }
      }
    });
    const service = createSessionHistoryService(taskManager);
    seedWorkspace(service.workspaceRepository, service.database.db, service.workspacePath);

    service.instance.requestWorkspaceDiscovery("workspace-1", "user-1", { force: true });
    service.instance.requestWorkspaceDiscovery("workspace-1", "user-1", { force: true });

    expect(discoverMock).toHaveBeenCalledTimes(1);

    const metricsBeforeFinish = service.instance.observeBackgroundTaskMetrics();
    expect(metricsBeforeFinish.taskTypes[HOST_TASK_TYPES.workspaceDiscovery]?.counters.enqueue).toBe(2);
    expect(metricsBeforeFinish.taskTypes[HOST_TASK_TYPES.workspaceDiscovery]?.counters.dedupe).toBe(1);
    expect(metricsBeforeFinish.taskTypes[HOST_TASK_TYPES.workspaceDiscovery]?.counters.started).toBe(1);

    discoverDeferred.resolve({
      sessions: [],
      isComplete: true
    });
    await flushMicrotasks();

    const cached = await service.instance.discoverWorkspaceSessions("workspace-1", "user-1", {
      maxAgeMs: 60_000
    });

    expect(cached).toEqual([]);

    const metrics = service.instance.observeBackgroundTaskMetrics();
    expect(metrics.taskTypes[HOST_TASK_TYPES.workspaceDiscovery]?.counters.finished).toBe(1);
    expect(metrics.taskTypes[HOST_TASK_TYPES.workspaceDiscovery]?.counters.cache_hit).toBe(1);

    service.dispose();
  });

  it("workspace discovery scan 同时最多只放 2 个 helper 并发，其余任务进入排队", async () => {
    const scanDeferredByPath = new Map<string, ReturnType<typeof createDeferred<{
      sessions: [];
      isComplete: true;
      providerDiagnostics: [];
    }>>>();
    const startedPaths: string[] = [];
    let activeScanCount = 0;
    let maxActiveScanCount = 0;
    const taskManager = createTaskManager(null, {
      helper_process: {
        execute: async (definition, input, context) => {
          if (definition.taskType !== HOST_TASK_TYPES.workspaceDiscoveryScan) {
            return await definition.run(input, context);
          }

          const workspacePath = String((input as { workspacePath: string }).workspacePath);
          const deferred = scanDeferredByPath.get(workspacePath);

          if (!deferred) {
            throw new Error(`missing deferred for ${workspacePath}`);
          }

          startedPaths.push(workspacePath);
          activeScanCount += 1;
          maxActiveScanCount = Math.max(maxActiveScanCount, activeScanCount);

          try {
            return await deferred.promise;
          } finally {
            activeScanCount = Math.max(0, activeScanCount - 1);
          }
        }
      }
    });
    const service = createSessionHistoryService(taskManager);
    seedWorkspace(service.workspaceRepository, service.database.db, service.workspacePath);

    const workspacePaths = [
      service.workspacePath,
      join(dirname(service.workspacePath), "workspace-2"),
      join(dirname(service.workspacePath), "workspace-3")
    ];

    for (const workspacePath of workspacePaths) {
      mkdirSync(workspacePath, { recursive: true });
      scanDeferredByPath.set(workspacePath, createDeferred());
    }

    service.workspaceRepository.create({
      id: "workspace-2",
      name: "Workspace 2",
      path: workspacePaths[1],
      repoRoot: workspacePaths[1],
      favorite: false,
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:00:00.000Z",
      removedAt: null
    });
    service.workspaceRepository.create({
      id: "workspace-3",
      name: "Workspace 3",
      path: workspacePaths[2],
      repoRoot: workspacePaths[2],
      favorite: false,
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:00:00.000Z",
      removedAt: null
    });

    const firstPromise = service.instance.discoverWorkspaceSessions("workspace-1", "user-1", {
      force: true,
      refreshStateMode: "deferred"
    });
    const secondPromise = service.instance.discoverWorkspaceSessions("workspace-2", "user-1", {
      force: true,
      refreshStateMode: "deferred"
    });
    const thirdPromise = service.instance.discoverWorkspaceSessions("workspace-3", "user-1", {
      force: true,
      refreshStateMode: "deferred"
    });

    await flushMicrotasks();

    expect(startedPaths).toHaveLength(2);
    expect(maxActiveScanCount).toBe(2);
    expect(activeScanCount).toBe(2);

    scanDeferredByPath.get(workspacePaths[0])?.resolve({
      sessions: [],
      isComplete: true,
      providerDiagnostics: []
    });
    await flushMicrotasks();

    expect(startedPaths).toHaveLength(3);
    expect(maxActiveScanCount).toBe(2);

    scanDeferredByPath.get(workspacePaths[1])?.resolve({
      sessions: [],
      isComplete: true,
      providerDiagnostics: []
    });
    scanDeferredByPath.get(workspacePaths[2])?.resolve({
      sessions: [],
      isComplete: true,
      providerDiagnostics: []
    });

    await expect(firstPromise).resolves.toEqual([]);
    await expect(secondPromise).resolves.toEqual([]);
    await expect(thirdPromise).resolves.toEqual([]);

    service.dispose();
  });

  it("provider capability refresh 会进入统一任务管理器，并记录去重和缓存命中", async () => {
    const service = createSessionHistoryService();
    const privateService = service.instance as unknown as {
      enrichProviderCapabilities: (
        capabilities: ProviderCapabilities,
        workspacePath: string | null
      ) => Promise<ProviderCapabilities>;
    };
    const refreshDeferred = createDeferred<ProviderCapabilities>();
    const enrichMock = vi.fn(async () => refreshDeferred.promise);

    privateService.enrichProviderCapabilities = enrichMock;

    const first = await service.instance.getProviderCapabilities("claude-code");
    const second = await service.instance.getProviderCapabilities("claude-code");

    expect(first.provider).toBe("claude-code");
    expect(second.provider).toBe("claude-code");
    expect(enrichMock).toHaveBeenCalledTimes(1);

    const metricsBeforeFinish = service.instance.observeBackgroundTaskMetrics();
    expect(
      metricsBeforeFinish.taskTypes[HOST_TASK_TYPES.providerCapabilityRefresh]?.counters.enqueue
    ).toBe(2);
    expect(
      metricsBeforeFinish.taskTypes[HOST_TASK_TYPES.providerCapabilityRefresh]?.counters.dedupe
    ).toBe(1);

    refreshDeferred.resolve(first);
    await flushMicrotasks();

    await service.instance.getProviderCapabilities("claude-code");

    const metrics = service.instance.observeBackgroundTaskMetrics();
    expect(
      metrics.taskTypes[HOST_TASK_TYPES.providerCapabilityRefresh]?.counters.finished
    ).toBe(1);
    expect(
      metrics.taskTypes[HOST_TASK_TYPES.providerCapabilityRefresh]?.counters.cache_hit
    ).toBe(1);

    service.dispose();
  });

  it("Gemini 运行中但本地 chats 尚未落盘时，订阅不会直接报错", async () => {
    const service = createSessionHistoryService();
    seedWorkspace(service.workspaceRepository, service.database.db, service.workspacePath);
    seedSession(service.database.db, {
      sessionId: "session-gemini-runtime",
      workspaceId: "workspace-1",
      provider: "gemini",
      providerSessionId: "gemini-session-runtime",
      rawStoreRef: "gemini://session/gemini-session-runtime",
      title: "Gemini 运行中会话",
      messageCount: 0,
      lastMessageAt: null,
      createdAt: "2026-04-25T10:00:00.000Z",
      updatedAt: "2026-04-25T10:00:00.000Z"
    });
    service.database.db
      .prepare(
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
      )
      .run(
        "session-gemini-runtime",
        "user-1",
        "running",
        "runtime",
        0,
        "2026-04-25T10:00:01.000Z",
        null,
        null,
        "2026-04-25T10:00:01.000Z"
      );

    const envelopes: unknown[] = [];
    const subscription = await service.instance.subscribeSession(
      "session-gemini-runtime",
      null,
      20,
      async (envelope) => {
        envelopes.push(envelope);
      }
    );

    await waitForDuration(50);

    const snapshot = service.database.db
      .prepare(
        `SELECT sync_status, last_error_code, last_error_detail
         FROM session_status_snapshots
         WHERE session_id = ?`
      )
      .get("session-gemini-runtime") as
      | {
          sync_status: string;
          last_error_code: string | null;
          last_error_detail: string | null;
        }
      | undefined;

    expect(envelopes).toEqual([]);
    expect(snapshot).toMatchObject({
      sync_status: "syncing",
      last_error_code: null,
      last_error_detail: null
    });

    subscription.close();
    service.dispose();
  });

  it("Gemini 非运行中会话缺少本地 chats 时仍然会报错", async () => {
    const service = createSessionHistoryService();
    seedWorkspace(service.workspaceRepository, service.database.db, service.workspacePath);
    seedSession(service.database.db, {
      sessionId: "session-gemini-missing",
      workspaceId: "workspace-1",
      provider: "gemini",
      providerSessionId: "gemini-session-missing",
      rawStoreRef: "gemini://session/gemini-session-missing",
      title: "Gemini 缺失会话",
      messageCount: 0,
      lastMessageAt: null,
      createdAt: "2026-04-25T10:10:00.000Z",
      updatedAt: "2026-04-25T10:10:00.000Z"
    });

    await expect(
      service.instance.subscribeSession("session-gemini-missing", null, 20, async () => {
        return;
      })
    ).rejects.toMatchObject({
      errorCode: "GEMINI_CHAT_NOT_FOUND"
    });

    service.dispose();
  });

  it("workspace discovery 任务取消后会把 AbortSignal 传给 provider helper", async () => {
    let receivedSignal: AbortSignal | null = null;
    const taskManager = createTaskManager(null, {
      helper_process: {
        execute: async (definition, input, context) => {
          if (definition.taskType !== HOST_TASK_TYPES.workspaceDiscoveryScan) {
            return await definition.run(input, context);
          }

          receivedSignal = context.signal;
          return await new Promise<never>((_resolve, reject) => {
            if (context.signal.aborted) {
              reject(context.signal.reason ?? new Error("aborted"));
              return;
            }

            context.signal.addEventListener("abort", () => {
              reject(context.signal.reason ?? new Error("aborted"));
            }, { once: true });
          });
        }
      }
    });
    const service = createSessionHistoryService(taskManager);
    seedWorkspace(service.workspaceRepository, service.database.db, service.workspacePath);

    service.instance.requestWorkspaceDiscovery("workspace-1", "user-1", { force: true });
    await flushMicrotasks();

    expect(receivedSignal).not.toBeNull();
    expect(receivedSignal?.aborted).toBe(false);

    taskManager.cancel(HOST_TASK_TYPES.workspaceDiscovery, "workspace-1", "manual abort");
    await flushMicrotasks();

    expect(receivedSignal?.aborted).toBe(true);
    expect(
      service.instance.observeBackgroundTaskMetrics().taskTypes[HOST_TASK_TYPES.workspaceDiscovery]?.counters
        .cancelled
    ).toBe(1);
    expect(
      service.instance.observeBackgroundTaskMetrics().taskTypes[HOST_TASK_TYPES.workspaceDiscoveryScan]?.counters
        .cancelled
    ).toBe(1);

    service.dispose();
  });

  it("工作区状态补刷在运行中会合并脏请求，并在冷却后只补跑一次", async () => {
    const service = createSessionHistoryService();
    const privateService = service.instance as unknown as {
      scheduleWorkspaceStateRefresh: (
        workspaceId: string,
        userId: string,
        sessions: Array<{ sessionId: string }>
      ) => void;
      refreshSessionState: (sessionId: string, userId: string) => Promise<void>;
      workspaceStateRefreshStatuses: Map<string, {
        phase: string;
        pendingSessions: Map<string, { sessionId: string }>;
      }>;
    };
    const firstRefreshDeferred = createDeferred<void>();
    const refreshedSessionIds: string[] = [];
    let firstRun = true;

    privateService.refreshSessionState = vi.fn(async (sessionId: string) => {
      refreshedSessionIds.push(sessionId);

      if (firstRun) {
        firstRun = false;
        await firstRefreshDeferred.promise;
      }
    });

    privateService.scheduleWorkspaceStateRefresh("workspace-1", "user-1", [
      { sessionId: "session-1" } as never
    ]);
    await flushMicrotasks();

    expect(refreshedSessionIds).toEqual(["session-1"]);

    privateService.scheduleWorkspaceStateRefresh("workspace-1", "user-1", [
      { sessionId: "session-2" } as never
    ]);
    await flushMicrotasks();

    expect(refreshedSessionIds).toEqual(["session-1"]);
    expect(
      privateService.workspaceStateRefreshStatuses.get("workspace-1:user-1")?.pendingSessions.size
    ).toBe(1);

    firstRefreshDeferred.resolve();
    await flushMicrotasks();

    expect(refreshedSessionIds).toEqual(["session-1"]);

    await waitForDuration(1_400);
    expect(refreshedSessionIds).toEqual(["session-1"]);

    await waitForDuration(250);
    expect(refreshedSessionIds).toEqual(["session-1", "session-2"]);

    service.dispose();
  });

  it("工作区状态补刷失败后会进入冷却，冷却结束前不会立刻重试", async () => {
    const service = createSessionHistoryService();
    const privateService = service.instance as unknown as {
      scheduleWorkspaceStateRefresh: (
        workspaceId: string,
        userId: string,
        sessions: Array<{ sessionId: string }>
      ) => void;
      refreshSessionState: (sessionId: string, userId: string) => Promise<void>;
      workspaceStateRefreshStatuses: Map<string, {
        phase: string;
      }>;
    };
    const refreshSessionState = vi
      .fn<Parameters<(sessionId: string, userId: string) => Promise<void>>, Promise<void>>()
      .mockRejectedValueOnce(new Error("refresh failed"))
      .mockResolvedValueOnce();

    privateService.refreshSessionState = refreshSessionState;

    privateService.scheduleWorkspaceStateRefresh("workspace-1", "user-1", [
      { sessionId: "session-1" } as never
    ]);
    await flushMicrotasks();

    expect(refreshSessionState).toHaveBeenCalledTimes(1);
    expect(privateService.workspaceStateRefreshStatuses.get("workspace-1:user-1")?.phase).toBe("failed");

    privateService.scheduleWorkspaceStateRefresh("workspace-1", "user-1", [
      { sessionId: "session-2" } as never
    ]);
    await flushMicrotasks();

    expect(refreshSessionState).toHaveBeenCalledTimes(1);

    await waitForDuration(1_400);
    expect(refreshSessionState).toHaveBeenCalledTimes(1);

    await waitForDuration(250);
    expect(refreshSessionState).toHaveBeenCalledTimes(2);
    expect(refreshSessionState).toHaveBeenLastCalledWith("session-2", "user-1");

    service.dispose();
  });

  it("workspace discovery 遇到未变化的会话不会重复刷新索引 updated_at", async () => {
    const taskManager = createTaskManager(null, {
      helper_process: {
        execute: async (definition, input, context) => {
          if (definition.taskType !== HOST_TASK_TYPES.workspaceDiscoveryScan) {
            return await definition.run(input, context);
          }

          return {
            sessions: [
              {
                provider: "codex",
                providerSessionId: "provider-session-1",
                rawStoreRef: join(String((input as { workspacePath: string }).workspacePath), ".codex", "session-1.json"),
                workspacePath: String((input as { workspacePath: string }).workspacePath),
                title: "现有会话",
                messageCount: 3,
                lastMessageAt: "2026-04-12T10:00:00.000Z",
                createdAt: "2026-04-12T10:00:00.000Z",
                updatedAt: "2026-04-12T10:00:00.000Z",
                isArchived: false,
                metadata: {}
              }
            ],
            isComplete: true,
            providerDiagnostics: []
          };
        }
      }
    });
    const service = createSessionHistoryService(taskManager);
    seedWorkspace(service.workspaceRepository, service.database.db, service.workspacePath);
    seedSession(service.database.db, {
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-1",
      rawStoreRef: join(service.workspacePath, ".codex", "session-1.json"),
      title: "现有会话",
      messageCount: 3,
      lastMessageAt: "2026-04-12T10:00:00.000Z",
      createdAt: "2026-04-12T10:00:00.000Z",
      updatedAt: "2026-04-12T10:00:00.000Z"
    });

    await service.instance.discoverWorkspaceSessions("workspace-1", "user-1", {
      force: true,
      refreshStateMode: "deferred"
    });

    const indexUpdatedAt = service.database.db
      .prepare("SELECT updated_at FROM session_indices WHERE session_id = ?")
      .get("session-1") as { updated_at: string };
    const bindingUpdatedAt = service.database.db
      .prepare("SELECT updated_at FROM session_bindings WHERE session_id = ?")
      .get("session-1") as { updated_at: string };
    const snapshotUpdatedAt = service.database.db
      .prepare("SELECT updated_at FROM session_status_snapshots WHERE session_id = ?")
      .get("session-1") as { updated_at: string };

    expect(indexUpdatedAt.updated_at).toBe("2026-04-12T10:00:00.000Z");
    expect(bindingUpdatedAt.updated_at).toBe("2026-04-12T10:00:00.000Z");
    expect(snapshotUpdatedAt.updated_at).toBe("2026-04-12T10:00:00.000Z");

    service.dispose();
  });

  it("workspace discovery 持久化遇到 SQLITE_BUSY 会退避重试而不是直接失败", async () => {
    const taskManager = createTaskManager(null, {
      helper_process: {
        execute: async (definition, input, context) => {
          if (definition.taskType !== HOST_TASK_TYPES.workspaceDiscoveryScan) {
            return await definition.run(input, context);
          }

          return {
            sessions: [
              {
                provider: "codex",
                providerSessionId: "provider-session-2",
                rawStoreRef: join(String((input as { workspacePath: string }).workspacePath), ".codex", "session-2.json"),
                workspacePath: String((input as { workspacePath: string }).workspacePath),
                title: "新的会话",
                messageCount: 1,
                lastMessageAt: "2026-04-12T11:00:00.000Z",
                createdAt: "2026-04-12T11:00:00.000Z",
                updatedAt: "2026-04-12T11:00:00.000Z",
                isArchived: false,
                metadata: {}
              }
            ],
            isComplete: true,
            providerDiagnostics: []
          };
        }
      }
    });
    const service = createSessionHistoryService(taskManager);
    seedWorkspace(service.workspaceRepository, service.database.db, service.workspacePath);

    const originalTransaction = service.database.db.transaction.bind(service.database.db);
    let shouldThrowBusy = true;
    vi.spyOn(service.database.db, "transaction").mockImplementation(((fn: (...args: unknown[]) => unknown) => {
      const wrapped = originalTransaction(fn as Parameters<typeof originalTransaction>[0]);

      return ((...args: unknown[]) => {
        if (shouldThrowBusy) {
          shouldThrowBusy = false;
          const error = new Error("database is locked") as Error & { code: string };
          error.code = "SQLITE_BUSY";
          throw error;
        }

        return wrapped(...args);
      }) as ReturnType<typeof originalTransaction>;
    }) as typeof service.database.db.transaction);

    await expect(
      service.instance.discoverWorkspaceSessions("workspace-1", "user-1", {
        force: true,
        refreshStateMode: "deferred"
      })
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerSessionId: "provider-session-2"
        })
      ])
    );

    service.dispose();
  });

  function createSessionHistoryService(taskManager?: TaskManager) {
    const rootDir = createTempRoot();
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
      taskManager
    );

    return {
      instance,
      database,
      workspaceRepository,
      workspacePath,
      dispose() {
        database.close();
      }
    };
  }

  function createTempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), "codingns-session-history-task-"));
    tempDirs.push(dir);
    return dir;
  }
});

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
    "2026-04-12T00:00:00.000Z",
    "2026-04-12T00:00:00.000Z"
  );

  workspaceRepository.create({
    id: "workspace-1",
    name: "Workspace 1",
    path: workspacePath,
    repoRoot: workspacePath,
    favorite: false,
    createdAt: "2026-04-12T00:00:00.000Z",
    updatedAt: "2026-04-12T00:00:00.000Z",
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
    null,
    "default",
    null,
    null,
    0,
    null,
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

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForDuration(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}
