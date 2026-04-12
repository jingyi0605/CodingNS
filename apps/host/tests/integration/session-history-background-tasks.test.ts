import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProviderCapabilities } from "@codingns/session-sync-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveHostConfig } from "../../src/config/env.js";
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
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();

      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("workspace discovery 会进入统一任务管理器并按工作区去重", async () => {
    const service = createSessionHistoryService();
    seedWorkspace(service.workspaceRepository, service.database.db, service.workspacePath);
    const discoverDeferred = createDeferred<{ sessions: []; isComplete: true }>();
    const privateService = service.instance as unknown as {
      providerDiscoveryHelperClient: {
        discoverWorkspaceSessions: (input: unknown) => Promise<{ sessions: []; isComplete: true }>;
      };
    };
    const discoverMock = vi.fn(async () => discoverDeferred.promise);

    privateService.providerDiscoveryHelperClient = {
      discoverWorkspaceSessions: discoverMock
    };

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

  function createSessionHistoryService() {
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
      config
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

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
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
