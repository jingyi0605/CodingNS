import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AffairsLibraryDirtyWatchService,
  type AffairsLibraryWatchDirtyEvent
} from "../../../src/modules/workspace/affairs-library-dirty-watch-service.js";
import * as affairsLibraryDebugLogModule from "../../../src/modules/workspace/affairs-library-debug-log.js";
import { AffairsLibraryService } from "../../../src/modules/workspace/affairs-library-service.js";
import { HOST_TASK_TYPES, type TaskSnapshot } from "../../../src/modules/tasks/task-types.js";
import type { WorkspaceNavigationStateRecord, Workspace } from "../../../src/types/domain.js";

const SNAPSHOT_CACHE_FILE_NAME = "codingns-affairs-snapshot-cache.json";

function createWorkspace(workspacePath: string): Workspace {
  return {
    id: "workspace-1",
    name: "事务工作区",
    path: workspacePath,
    createdAt: "2026-05-31T06:00:00.000Z",
    updatedAt: "2026-05-31T06:00:00.000Z",
    backgroundColor: null
  };
}

function createEnabledAffairsLibraryState(rootDir: string): WorkspaceNavigationStateRecord {
  return {
    workspaceId: "workspace-1",
    userId: "user-1",
    collapsed: false,
    backgroundColor: null,
    affairsLibraryRootPath: rootDir,
    affairsLibraryEnabled: true,
    affairsLibraryFavoritesJson: "[]",
    updatedAt: "2026-05-31T06:00:00.000Z"
  };
}

function createIndexerResult(command: "apply-config" | "index") {
  return {
    ok: true as const,
    command,
    message: `${command} done`,
    durationMs: 1,
    config: {
      rootDir: "/tmp/root",
      indexDir: "/tmp/root/.ai-index",
      dbPath: "/tmp/root/.ai-index/catalog.sqlite",
      exportDir: "/tmp/root/.ai-index/exports",
      configFilePath: "/tmp/root/.ai-index/doc-semantic-index.config.json"
    },
    result: command === "apply-config"
      ? { changed: false, addedExtensions: [], removedExtensions: [] }
      : { scannedCount: 1, indexedCount: 1, failedCount: 0, deletedCount: 0 }
  };
}

function seedExistingArtifacts(rootDir: string): void {
  const exportDir = path.join(rootDir, ".ai-index", "exports");
  fs.mkdirSync(exportDir, { recursive: true });
  fs.writeFileSync(
    path.join(exportDir, "status.json"),
    JSON.stringify({
      version: 2,
      format: "static-v2",
      exported_at: "2026-05-31T06:00:00.000Z",
      document_count: 1
    })
  );
  fs.writeFileSync(
    path.join(exportDir, "manifest.json"),
    JSON.stringify({
      generated_at: "2026-05-31T06:00:00.000Z",
      entries: {
        taxonomy: "taxonomy.json",
        bootstrap: "bootstrap.json"
      },
      meta_shards: []
    })
  );
}

function createService(options: {
  rootDir: string;
  listEnabledAffairsLibraries?: WorkspaceNavigationStateRecord[];
  findAnyEnabledAffairsLibraryByWorkspaceId?: () => WorkspaceNavigationStateRecord | null;
  findLatestAffairsLibraryByWorkspaceId?: () => WorkspaceNavigationStateRecord | null;
  findByWorkspaceIdAndUserId?: () => WorkspaceNavigationStateRecord | null;
  currentGlobalSetting?: {
    userId: string;
    rootDir: string | null;
    enabled: boolean;
    favoritesJson: string | null;
    lastWorkspaceId: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  peek?: (taskType: string, key: string) => TaskSnapshot | null;
  enqueue?: ReturnType<typeof vi.fn>;
  cancel?: ReturnType<typeof vi.fn>;
}) {
  return new AffairsLibraryService(
    {
      getWorkspaceOrThrow: vi.fn(() => createWorkspace(options.rootDir)),
      list: vi.fn(() => [createWorkspace(options.rootDir)])
    } as never,
    {
      findByWorkspaceIdAndUserId: vi.fn(
        options.findByWorkspaceIdAndUserId ?? (() => ({
          workspaceId: "workspace-1",
          userId: "user-1",
          collapsed: false,
          backgroundColor: null,
          affairsLibraryRootPath: options.rootDir,
          affairsLibraryEnabled: true,
          affairsLibraryFavoritesJson: "[]",
          updatedAt: "2026-05-31T06:00:00.000Z"
        }))
      ),
      listByUserId: vi.fn(() => []),
      upsert: vi.fn(),
      listEnabledAffairsLibraries: vi.fn(() => options.listEnabledAffairsLibraries ?? []),
      findAnyEnabledAffairsLibraryByWorkspaceId: vi.fn(
        options.findAnyEnabledAffairsLibraryByWorkspaceId ?? (() => ({
          workspaceId: "workspace-1",
          userId: "user-1",
          collapsed: false,
          backgroundColor: null,
          affairsLibraryRootPath: options.rootDir,
          affairsLibraryEnabled: true,
          affairsLibraryFavoritesJson: "[]",
          updatedAt: "2026-05-31T06:00:00.000Z"
        }))
      ),
      findLatestAffairsLibraryByWorkspaceId: vi.fn(
        options.findLatestAffairsLibraryByWorkspaceId ?? (() => ({
          workspaceId: "workspace-1",
          userId: "user-1",
          collapsed: false,
          backgroundColor: null,
          affairsLibraryRootPath: options.rootDir,
          affairsLibraryEnabled: true,
          affairsLibraryFavoritesJson: "[]",
          updatedAt: "2026-05-31T06:00:00.000Z"
        }))
      )
    } as never,
    {
      findByUserId: vi.fn(() => options.currentGlobalSetting ?? null),
      upsert: vi.fn((record) => record)
    } as never,
    {
      has: vi.fn(() => false),
      register: vi.fn(),
      enqueue: options.enqueue ?? vi.fn(() => ({
        taskId: "task-1",
        taskType: HOST_TASK_TYPES.affairsLibraryIndex,
        key: "workspace-1",
        executionLane: "helper_process",
        deduped: false,
        promise: Promise.resolve(createIndexerResult("index")),
        cancel: vi.fn()
      })),
      peek: vi.fn(options.peek ?? (() => null)),
      cancel: options.cancel ?? vi.fn()
    } as never,
    {
      info: vi.fn(),
      warn: vi.fn()
    } as never
  );
}

describe("AffairsLibraryService auto tasks", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).__codingnsTaskHelperPool__;
  });

  it("启动时会为已启用文档库排队一次自动刷新", async () => {
    vi.useFakeTimers();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-"));

    const enqueue = vi.fn(() => ({
      taskId: "task-1",
      taskType: HOST_TASK_TYPES.affairsLibraryIndex,
      key: "workspace-1",
      executionLane: "helper_process",
      deduped: false,
      promise: Promise.resolve(createIndexerResult("index")),
      cancel: vi.fn()
    }));

    const service = createService({
      rootDir,
      enqueue,
      listEnabledAffairsLibraries: [
        createEnabledAffairsLibraryState(rootDir)
      ]
    });

    await vi.advanceTimersByTimeAsync(810);

    expect(enqueue).toHaveBeenCalledWith(
      HOST_TASK_TYPES.affairsLibraryIndex,
      expect.objectContaining({
        key: "workspace-1",
        source: "affairs_library.auto_refresh",
        input: expect.objectContaining({
          workspaceId: "workspace-1",
          rootDir,
          reason: expect.stringContaining("startup_resume")
        })
      })
    );

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("启动时如果导出还是 fresh，就不会无脑补跑", async () => {
    vi.useFakeTimers();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-fresh-"));
    const exportDir = path.join(rootDir, ".ai-index", "exports");
    fs.mkdirSync(exportDir, { recursive: true });
    fs.writeFileSync(
      path.join(exportDir, "status.json"),
      JSON.stringify({
        version: 2,
        format: "static-v2",
        exported_at: new Date().toISOString(),
        document_count: 1
      })
    );
    fs.writeFileSync(
      path.join(exportDir, "manifest.json"),
      JSON.stringify({
        generated_at: new Date().toISOString(),
        entries: {
          taxonomy: "taxonomy.json",
          bootstrap: "bootstrap.json"
        },
        meta_shards: []
      })
    );

    const enqueue = vi.fn(() => ({
      taskId: "task-1",
      taskType: HOST_TASK_TYPES.affairsLibraryIndex,
      key: "workspace-1",
      executionLane: "helper_process",
      deduped: false,
      promise: Promise.resolve(createIndexerResult("index")),
      cancel: vi.fn()
    }));

    const service = createService({
      rootDir,
      enqueue,
      listEnabledAffairsLibraries: [
        createEnabledAffairsLibraryState(rootDir)
      ]
    });

    await vi.advanceTimersByTimeAsync(810);

    expect(enqueue).not.toHaveBeenCalled();

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("发现索引产物缺失时会强制走全量重建，不再沿用 targeted refresh", async () => {
    vi.useFakeTimers();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-missing-artifact-"));
    const enqueue = vi.fn(() => ({
      taskId: "task-1",
      taskType: HOST_TASK_TYPES.affairsLibraryIndex,
      key: "workspace-1",
      executionLane: "helper_process",
      deduped: false,
      promise: Promise.resolve(createIndexerResult("index")),
      cancel: vi.fn()
    }));

    const service = createService({ rootDir, enqueue });
    service.scheduleAutoRefresh("workspace-1", "watch:index_changed:notes/demo.md", "notes/demo.md");

    await vi.advanceTimersByTimeAsync(810);

    expect(enqueue).toHaveBeenCalledWith(
      HOST_TASK_TYPES.affairsLibraryIndex,
      expect.objectContaining({
        input: expect.objectContaining({
          workspaceId: "workspace-1",
          rootDir
        })
      })
    );
    const indexCall = enqueue.mock.calls.find((call) => call[0] === HOST_TASK_TYPES.affairsLibraryIndex);
    expect(indexCall?.[1]?.input).not.toHaveProperty("targetPath");
    expect(String(indexCall?.[1]?.input?.reason ?? "")).toContain("missing_index_artifact");

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("10 分钟巡检发现漂移时会走全库增量刷新，不直接全量重建", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T10:00:00.000Z"));
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-periodic-"));
    seedExistingArtifacts(rootDir);
    fs.mkdirSync(path.join(rootDir, "notes"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "notes", "fresh.md"), "# fresh\n");
    const enqueue = vi.fn(() => ({
      taskId: "task-1",
      taskType: HOST_TASK_TYPES.affairsLibraryIndex,
      key: "workspace-1",
      executionLane: "helper_process",
      deduped: false,
      promise: Promise.resolve(createIndexerResult("index")),
      cancel: vi.fn()
    }));

    const service = createService({
      rootDir,
      enqueue,
      listEnabledAffairsLibraries: [createEnabledAffairsLibraryState(rootDir)]
    });

    await vi.advanceTimersByTimeAsync(46_000);
    enqueue.mockClear();
    service.schedulePeriodicAudit("workspace-1", "periodic_audit");

    await vi.advanceTimersByTimeAsync(810);

    expect(enqueue).toHaveBeenCalledWith(
      HOST_TASK_TYPES.affairsLibraryIndex,
      expect.objectContaining({
        input: expect.objectContaining({
          workspaceId: "workspace-1",
          rootDir,
          reason: expect.stringContaining("periodic_audit:"),
          commandMode: "incremental"
        })
      })
    );
    expect(enqueue.mock.calls[0]?.[1]?.input).not.toHaveProperty("targetPath");

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("10 分钟巡检在状态健康时只记审计结果，不会默认补跑", async () => {
    vi.useFakeTimers();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-periodic-healthy-"));
    const exportDir = path.join(rootDir, ".ai-index", "exports");
    fs.mkdirSync(exportDir, { recursive: true });
    const futureExportedAt = new Date(Date.now() + 60_000).toISOString();
    fs.writeFileSync(
      path.join(exportDir, "status.json"),
      JSON.stringify({
        version: 2,
        format: "static-v2",
        exported_at: futureExportedAt,
        document_count: 1
      })
    );
    fs.writeFileSync(
      path.join(exportDir, "manifest.json"),
      JSON.stringify({
        generated_at: futureExportedAt,
        entries: {
          taxonomy: "taxonomy.json",
          bootstrap: "bootstrap.json"
        },
        meta_shards: []
      })
    );

    const enqueue = vi.fn(() => ({
      taskId: "task-1",
      taskType: HOST_TASK_TYPES.affairsLibraryIndex,
      key: "workspace-1",
      executionLane: "helper_process",
      deduped: false,
      promise: Promise.resolve(createIndexerResult("index")),
      cancel: vi.fn()
    }));

    const service = createService({
      rootDir,
      enqueue,
      listEnabledAffairsLibraries: [createEnabledAffairsLibraryState(rootDir)]
    });

    service.schedulePeriodicAudit("workspace-1", "periodic_audit");
    await vi.advanceTimersByTimeAsync(900);

    expect(enqueue).not.toHaveBeenCalled();

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("45 秒轻量对账发现最近目录 mtime 比导出新时，会补跑一次增量刷新", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T10:00:00.000Z"));
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-lightweight-reconcile-"));
    const exportDir = path.join(rootDir, ".ai-index", "exports");
    fs.mkdirSync(exportDir, { recursive: true });
    fs.mkdirSync(path.join(rootDir, "notes"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "notes", "fresh.md"), "# fresh\n");
    fs.writeFileSync(
      path.join(exportDir, "status.json"),
      JSON.stringify({
        version: 2,
        format: "static-v2",
        exported_at: "2026-06-03T09:58:00.000Z",
        document_count: 1
      })
    );
    fs.writeFileSync(
      path.join(exportDir, "manifest.json"),
      JSON.stringify({
        generated_at: "2026-06-03T09:58:00.000Z",
        entries: {
          taxonomy: "taxonomy.json",
          bootstrap: "bootstrap.json"
        },
        meta_shards: []
      })
    );

    let callCount = 0;
    const enqueue = vi.fn((taskType: string) => {
      callCount += 1;
      return {
        taskId: `task-${callCount}`,
        taskType,
        key: taskType === HOST_TASK_TYPES.affairsLibraryDirectoryHint ? "workspace-1::." : "workspace-1",
        executionLane: "helper_process",
        deduped: false,
        promise: Promise.resolve(
          taskType === HOST_TASK_TYPES.affairsLibraryDirectoryHint
            ? {
                directoryPath: ".",
                refreshedAt: new Date().toISOString(),
                source: "live" as const,
                itemCount: 0,
                changedPaths: [],
                items: []
              }
            : createIndexerResult("index")
        ),
        cancel: vi.fn()
      };
    });

    const service = createService({
      rootDir,
      enqueue,
      listEnabledAffairsLibraries: [createEnabledAffairsLibraryState(rootDir)]
    });

    await vi.advanceTimersByTimeAsync(46_000);

    const indexCall = enqueue.mock.calls.find((call) => call[0] === HOST_TASK_TYPES.affairsLibraryIndex);
    expect(indexCall).toBeTruthy();
    expect(indexCall?.[1]).toEqual(
      expect.objectContaining({
        key: "workspace-1",
        source: "affairs_library.auto_refresh",
        input: expect.objectContaining({
          workspaceId: "workspace-1",
          rootDir,
          commandMode: "incremental",
          reason: expect.stringContaining("lightweight_reconcile:recent_directory_mtime")
        })
      })
    );
    expect(indexCall?.[1]?.input).not.toHaveProperty("targetPath");

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("45 秒轻量对账在状态健康时不会额外补跑", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T10:00:00.000Z"));
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-lightweight-healthy-"));
    const exportDir = path.join(rootDir, ".ai-index", "exports");
    fs.mkdirSync(exportDir, { recursive: true });
    fs.mkdirSync(path.join(rootDir, "notes"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "notes", "stable.md"), "# stable\n");
    fs.writeFileSync(
      path.join(exportDir, "status.json"),
      JSON.stringify({
        version: 2,
        format: "static-v2",
        exported_at: "2026-06-03T10:00:00.000Z",
        document_count: 1
      })
    );
    fs.writeFileSync(
      path.join(exportDir, "manifest.json"),
      JSON.stringify({
        generated_at: "2026-06-03T10:00:00.000Z",
        entries: {
          taxonomy: "taxonomy.json",
          bootstrap: "bootstrap.json"
        },
        meta_shards: []
      })
    );
    const stableDirectoryTime = new Date("2026-06-03T09:59:30.000Z");
    fs.utimesSync(rootDir, stableDirectoryTime, stableDirectoryTime);

    const enqueue = vi.fn(() => ({
      taskId: "task-1",
      taskType: HOST_TASK_TYPES.affairsLibraryIndex,
      key: "workspace-1",
      executionLane: "helper_process",
      deduped: false,
      promise: Promise.resolve(createIndexerResult("index")),
      cancel: vi.fn()
    }));

    const service = createService({
      rootDir,
      enqueue,
      listEnabledAffairsLibraries: [createEnabledAffairsLibraryState(rootDir)]
    });

    await vi.advanceTimersByTimeAsync(46_000);

    expect(enqueue).not.toHaveBeenCalled();

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("config 变更会先排 apply-config，再补跑文件增量索引", async () => {
    vi.useFakeTimers();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-"));
    seedExistingArtifacts(rootDir);
    let callCount = 0;
    const enqueue = vi.fn((taskType: string) => {
      callCount += 1;
      return {
        taskId: `task-${callCount}`,
        taskType,
        key: "workspace-1",
        executionLane: "helper_process",
        deduped: false,
        promise: Promise.resolve(
          taskType === HOST_TASK_TYPES.affairsLibraryApplyConfig
            ? createIndexerResult("apply-config")
            : createIndexerResult("index")
        ),
        cancel: vi.fn()
      };
    });

    const service = createService({ rootDir, enqueue });
    service.scheduleAutoRefresh("workspace-1", "watch:index_changed:notes/a.md", "notes/a.md");
    service.scheduleAutoApplyConfig("workspace-1", "watch:config_changed");

    await vi.advanceTimersByTimeAsync(810);
    expect(enqueue).toHaveBeenCalledWith(
      HOST_TASK_TYPES.affairsLibraryApplyConfig,
      expect.objectContaining({
        input: expect.objectContaining({
          workspaceId: "workspace-1",
          rootDir,
          reason: "watch:config_changed"
        })
      })
    );

    await vi.advanceTimersByTimeAsync(60);
    expect(enqueue).toHaveBeenCalledWith(
      HOST_TASK_TYPES.affairsLibraryIndex,
      expect.objectContaining({
        input: expect.objectContaining({
          workspaceId: "workspace-1",
          rootDir,
          reason: "watch:index_changed:notes/a.md",
          targetPath: "notes/a.md"
        })
      })
    );

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("自动刷新遇到 orphan running 时，会先主动取消旧任务，再继续排新任务", async () => {
    vi.useFakeTimers();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-orphan-reconcile-auto-"));
    seedExistingArtifacts(rootDir);
    fs.mkdirSync(path.join(rootDir, ".ai-index", "runtime", "command.lock"), { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, ".ai-index", "runtime-status.json"),
      JSON.stringify({
        version: 1,
        status: "running",
        stage: "export",
        command: "index",
        taskId: "task-orphan",
        taskType: HOST_TASK_TYPES.affairsLibraryIndex,
        updatedAt: new Date(Date.now() - 120_000).toISOString()
      })
    );
    fs.writeFileSync(
      path.join(rootDir, ".ai-index", "runtime", "command.lock", "owner.json"),
      JSON.stringify({
        pid: 999999,
        command: "index",
        taskId: "task-orphan",
        taskType: HOST_TASK_TYPES.affairsLibraryIndex,
        acquiredAt: new Date(Date.now() - 180_000).toISOString()
      })
    );
    fs.writeFileSync(
      path.join(rootDir, ".ai-index", "runtime", "command.lock", "heartbeat.json"),
      JSON.stringify({
        ts: new Date(Date.now() - 180_000).toISOString()
      })
    );

    let runningSnapshot: TaskSnapshot | null = {
      taskId: "task-orphan",
      taskType: HOST_TASK_TYPES.affairsLibraryIndex,
      key: "workspace-1",
      executionLane: "helper_process",
      status: "running",
      source: "affairs_library.auto_refresh",
      attempt: 1,
      enqueuedAt: Date.now() - 240_000,
      startedAt: Date.now() - 235_000,
      finishedAt: null,
      timeoutMs: 15 * 60 * 1000
    };
    const cancel = vi.fn(() => {
      runningSnapshot = null;
    });
    const enqueue = vi.fn(() => ({
      taskId: "task-new",
      taskType: HOST_TASK_TYPES.affairsLibraryIndex,
      key: "workspace-1",
      executionLane: "helper_process",
      deduped: false,
      promise: Promise.resolve(createIndexerResult("index")),
      cancel: vi.fn()
    }));

    const service = createService({
      rootDir,
      peek: (taskType) => taskType === HOST_TASK_TYPES.affairsLibraryIndex ? runningSnapshot : null,
      enqueue,
      cancel
    });

    service.scheduleAutoRefresh("workspace-1", "watch:index_changed:notes/demo.md", "notes/demo.md");
    await vi.advanceTimersByTimeAsync(810);

    expect(cancel).toHaveBeenCalledWith(
      HOST_TASK_TYPES.affairsLibraryIndex,
      "workspace-1",
      expect.stringContaining("orphaned_helper_process:command_lock_owner_dead")
    );
    expect(enqueue).toHaveBeenCalledWith(
      HOST_TASK_TYPES.affairsLibraryIndex,
      expect.objectContaining({
        input: expect.objectContaining({
          workspaceId: "workspace-1",
          rootDir,
          reason: "watch:index_changed:notes/demo.md",
          targetPath: "notes/demo.md"
        })
      })
    );

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("手动刷新遇到 orphan running 时，不会一直被旧任务卡住", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-orphan-reconcile-manual-"));
    seedExistingArtifacts(rootDir);
    fs.mkdirSync(path.join(rootDir, ".ai-index", "runtime", "command.lock"), { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, ".ai-index", "runtime-status.json"),
      JSON.stringify({
        version: 1,
        status: "running",
        stage: "export",
        command: "index",
        taskId: "task-orphan",
        taskType: HOST_TASK_TYPES.affairsLibraryIndex,
        updatedAt: new Date(Date.now() - 120_000).toISOString()
      })
    );
    fs.writeFileSync(
      path.join(rootDir, ".ai-index", "runtime", "command.lock", "owner.json"),
      JSON.stringify({
        pid: 999999,
        command: "index",
        taskId: "task-orphan",
        taskType: HOST_TASK_TYPES.affairsLibraryIndex,
        acquiredAt: new Date(Date.now() - 180_000).toISOString()
      })
    );
    fs.writeFileSync(
      path.join(rootDir, ".ai-index", "runtime", "command.lock", "heartbeat.json"),
      JSON.stringify({
        ts: new Date(Date.now() - 180_000).toISOString()
      })
    );

    let runningSnapshot: TaskSnapshot | null = {
      taskId: "task-orphan",
      taskType: HOST_TASK_TYPES.affairsLibraryIndex,
      key: "workspace-1",
      executionLane: "helper_process",
      status: "running",
      source: "affairs_library.refresh",
      attempt: 1,
      enqueuedAt: Date.now() - 240_000,
      startedAt: Date.now() - 235_000,
      finishedAt: null,
      timeoutMs: 15 * 60 * 1000
    };
    const cancel = vi.fn(() => {
      runningSnapshot = null;
    });
    const enqueue = vi.fn(() => ({
      taskId: "task-manual-new",
      taskType: HOST_TASK_TYPES.affairsLibraryIndex,
      key: "workspace-1",
      executionLane: "helper_process",
      deduped: false,
      promise: Promise.resolve(createIndexerResult("index")),
      cancel: vi.fn()
    }));

    const service = createService({
      rootDir,
      peek: (taskType) => taskType === HOST_TASK_TYPES.affairsLibraryIndex ? runningSnapshot : null,
      enqueue,
      cancel
    });

    const refresh = service.requestRefresh("workspace-1", "user-1", "manual_refresh");

    expect(cancel).toHaveBeenCalledWith(
      HOST_TASK_TYPES.affairsLibraryIndex,
      "workspace-1",
      expect.stringContaining("orphaned_helper_process:command_lock_owner_dead")
    );
    expect(enqueue).toHaveBeenCalledWith(
      HOST_TASK_TYPES.affairsLibraryIndex,
      expect.objectContaining({
        input: expect.objectContaining({
          workspaceId: "workspace-1",
          rootDir,
          reason: "manual_refresh"
        })
      })
    );
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(enqueue.mock.invocationCallOrder[0]);
    expect(refresh.taskId).toBe("task-manual-new");

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("刚启动不久的 running 任务不会被误判成 orphan 并取消", async () => {
    vi.useFakeTimers();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-orphan-grace-"));
    seedExistingArtifacts(rootDir);

    const recentRunningSnapshot: TaskSnapshot = {
      taskId: "task-recent",
      taskType: HOST_TASK_TYPES.affairsLibraryIndex,
      key: "workspace-1",
      executionLane: "helper_process",
      status: "running",
      source: "affairs_library.auto_refresh",
      attempt: 1,
      enqueuedAt: Date.now() - 5_000,
      startedAt: Date.now() - 4_000,
      finishedAt: null,
      timeoutMs: 15 * 60 * 1000
    };
    const cancel = vi.fn();
    const enqueue = vi.fn(() => ({
      taskId: "task-new",
      taskType: HOST_TASK_TYPES.affairsLibraryIndex,
      key: "workspace-1",
      executionLane: "helper_process",
      deduped: false,
      promise: Promise.resolve(createIndexerResult("index")),
      cancel: vi.fn()
    }));

    const service = createService({
      rootDir,
      peek: (taskType) => taskType === HOST_TASK_TYPES.affairsLibraryIndex ? recentRunningSnapshot : null,
      enqueue,
      cancel
    });

    service.scheduleAutoRefresh("workspace-1", "watch:index_changed:notes/demo.md", "notes/demo.md");
    await vi.advanceTimersByTimeAsync(810);

    expect(cancel).not.toHaveBeenCalled();
    expect(enqueue.mock.calls.some((call) => call[0] === HOST_TASK_TYPES.affairsLibraryIndex)).toBe(false);

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("应用内文件写入会把文档库内的文件改动收口成 targeted refresh", async () => {
    vi.useFakeTimers();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-touch-"));
    fs.mkdirSync(path.join(rootDir, "notes"), { recursive: true });
    seedExistingArtifacts(rootDir);
    const enqueue = vi.fn((taskType: string) => ({
      taskId: `task-${taskType}`,
      taskType,
      key: "workspace-1",
      executionLane: "helper_process",
      deduped: false,
      promise: Promise.resolve(createIndexerResult(taskType === HOST_TASK_TYPES.affairsLibraryApplyConfig ? "apply-config" : "index")),
      cancel: vi.fn()
    }));

    const service = createService({ rootDir, enqueue });
    service.notifyWorkspaceFileMutation("workspace-1", {
      absolutePath: path.join(rootDir, "notes", "demo.md"),
      kind: "upsert"
    });

    await vi.advanceTimersByTimeAsync(810);

    expect(enqueue).toHaveBeenCalledWith(
      HOST_TASK_TYPES.affairsLibraryIndex,
      expect.objectContaining({
        input: expect.objectContaining({
          workspaceId: "workspace-1",
          rootDir,
          reason: "app_upsert:notes/demo.md",
          targetPath: "notes/demo.md"
        })
      })
    );

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("应用内改到配置文件时会改走 apply-config，而不是普通索引刷新", async () => {
    vi.useFakeTimers();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-config-touch-"));
    fs.mkdirSync(path.join(rootDir, ".ai-index"), { recursive: true });
    const enqueue = vi.fn((taskType: string) => ({
      taskId: `task-${taskType}`,
      taskType,
      key: "workspace-1",
      executionLane: "helper_process",
      deduped: false,
      promise: Promise.resolve(createIndexerResult("apply-config")),
      cancel: vi.fn()
    }));

    const service = createService({ rootDir, enqueue });
    service.notifyWorkspaceFileMutation("workspace-1", {
      absolutePath: path.join(rootDir, ".ai-index", "doc-semantic-index.config.json"),
      kind: "upsert"
    });

    await vi.advanceTimersByTimeAsync(810);

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      HOST_TASK_TYPES.affairsLibraryApplyConfig,
      expect.objectContaining({
        input: expect.objectContaining({
          workspaceId: "workspace-1",
          rootDir,
          reason: "app_write:.ai-index/doc-semantic-index.config.json"
        })
      })
    );

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("索引产物缺失时会保留最近一次可读快照", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-cache-"));
    const exportDir = path.join(rootDir, ".ai-index", "exports");
    fs.mkdirSync(exportDir, { recursive: true });
    fs.writeFileSync(
      path.join(exportDir, "status.json"),
      JSON.stringify({
        version: 2,
        format: "static-v2",
        exported_at: "2026-05-31T08:00:00.000Z",
        document_count: 1
      })
    );
    fs.writeFileSync(
      path.join(exportDir, SNAPSHOT_CACHE_FILE_NAME),
      JSON.stringify({
        schemaVersion: 2,
        signature: "stale-cache",
        generatedAt: "2026-05-31T08:00:00.000Z",
        documents: [
          {
            documentId: "doc-1",
            path: "notes/demo.md",
            title: "demo",
            summary: "cached",
            updatedAt: "2026-05-31T08:00:00.000Z",
            createdAt: "2026-05-31T07:00:00.000Z",
            sizeBytes: 128,
            tags: ["项目/演示"],
            derivedTags: [],
            isFavorite: false
          }
        ],
        tags: [
          {
            path: "项目/演示",
            name: "演示",
            rootType: "project",
            parentPath: "项目",
            depth: 1,
            documentCount: 1
          }
        ],
        folders: [
          {
            path: "notes",
            name: "notes",
            parentPath: null,
            directDocumentCount: 1,
            documentCount: 1,
            createdAt: "2026-05-31T06:00:00.000Z",
            updatedAt: "2026-05-31T08:00:00.000Z"
          }
        ]
      })
    );

    const service = createService({ rootDir });
    const snapshot = service.getSnapshot("workspace-1", "user-1");
    const documentList = service.listDocuments("workspace-1", "user-1", {
      browseMode: "folder",
      selectedFolderPath: "notes"
    });

    expect(snapshot.status.state).toBe("stale");
    expect(snapshot.status.dirtyReasons).toContain("missing_export_manifest");
    expect(snapshot.status.lastCompletedAt).toBe("2026-05-31T08:00:00.000Z");
    expect(snapshot.documentCount).toBe(1);
    expect(snapshot.tags).toHaveLength(1);
    expect(documentList.total).toBe(1);
    expect(documentList.items[0]?.path).toBe("notes/demo.md");
    expect(documentList.items[0]?.createdAt).toBe("2026-05-31T07:00:00.000Z");
    expect(documentList.items[0]?.sizeBytes).toBe(128);

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("列文档时会补齐文件大小和创建时间", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-list-meta-"));
    const exportDir = path.join(rootDir, ".ai-index", "exports");
    fs.mkdirSync(path.join(rootDir, "notes"), { recursive: true });
    fs.mkdirSync(exportDir, { recursive: true });

    const filePath = path.join(rootDir, "notes", "demo.txt");
    fs.writeFileSync(filePath, "hello affairs");
    fs.writeFileSync(
      path.join(exportDir, "manifest.json"),
      JSON.stringify({
        generated_at: "2026-05-31T06:00:00.000Z",
        entries: {
          taxonomy: "taxonomy.json",
          bootstrap: "bootstrap.json"
        },
        meta_shards: [{ path: "documents-0.json" }]
      })
    );
    fs.writeFileSync(path.join(exportDir, "taxonomy.json"), JSON.stringify({ nodes: [] }));
    fs.writeFileSync(
      path.join(exportDir, "bootstrap.json"),
      JSON.stringify({
        folders: [
          {
            path: "notes",
            name: "notes",
            parent_path: null,
            direct_document_count: 1,
            document_count: 1
          }
        ]
      })
    );
    fs.writeFileSync(
      path.join(exportDir, "documents-0.json"),
      JSON.stringify({
        documents: [
          {
            document_id: "doc-1",
            path: "notes/demo.txt",
            title: "demo",
            summary: "hello",
            mtime: "2026-05-31T08:00:00.000Z",
            direct_tags: [],
            derived_tags: []
          }
        ]
      })
    );

    const service = createService({ rootDir });
    const documentList = service.listDocuments("workspace-1", "user-1", {
      browseMode: "folder",
      selectedFolderPath: "notes"
    });

    expect(documentList.items[0]?.sizeBytes).toBe(Buffer.byteLength("hello affairs"));
    expect(documentList.items[0]?.createdAt).toMatch(/^20/);

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("配置里放行的 hidden 文件会进入当前目录实时列表", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-hidden-live-"));
    fs.mkdirSync(path.join(rootDir, "notes"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, ".ai-index"), { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, ".ai-index", "doc-semantic-index.config.json"),
      JSON.stringify({
        includedHiddenPaths: ["notes/.draft.md"]
      })
    );
    fs.writeFileSync(path.join(rootDir, "notes", ".draft.md"), "hello hidden");

    const service = createService({ rootDir });
    const documentList = service.listDocuments("workspace-1", "user-1", {
      browseMode: "folder",
      selectedFolderPath: "notes"
    });

    expect(documentList.items.some((item) => item.path === "notes/.draft.md")).toBe(true);

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("运行中的索引任务会优先显示 helper 正式上报的内部阶段", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-runtime-stage-"));
    fs.mkdirSync(path.join(rootDir, ".ai-index", "runtime", "command.lock"), { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, ".ai-index", "runtime-status.json"),
      JSON.stringify({
        version: 1,
        status: "running",
        stage: "sqlite",
        command: "index",
        taskId: "task-1",
        taskType: HOST_TASK_TYPES.affairsLibraryIndex,
        updatedAt: new Date().toISOString()
      })
    );
    fs.writeFileSync(
      path.join(rootDir, ".ai-index", "runtime", "command.lock", "owner.json"),
      JSON.stringify({
        pid: process.pid,
        command: "index",
        taskId: "task-1",
        taskType: HOST_TASK_TYPES.affairsLibraryIndex,
        acquiredAt: new Date().toISOString()
      })
    );
    fs.writeFileSync(
      path.join(rootDir, ".ai-index", "runtime", "command.lock", "heartbeat.json"),
      JSON.stringify({
        ts: new Date().toISOString()
      })
    );
    const now = Date.now();
    const service = createService({
      rootDir,
      peek: (taskType, key) => taskType === HOST_TASK_TYPES.affairsLibraryIndex && key === "workspace-1"
        ? ({
            taskId: "task-1",
            taskType,
            key,
            executionLane: "helper_process",
            status: "running",
            source: "affairs_library.auto_refresh",
            attempt: 1,
            enqueuedAt: now - 5_000,
            startedAt: now - 4_500,
            finishedAt: null,
            timeoutMs: 15 * 60 * 1000
          } satisfies TaskSnapshot)
        : null
    });

    const snapshot = service.getSnapshot("workspace-1", "user-1");

    expect(snapshot.status.state).toBe("running");
    expect(snapshot.status.runningStage).toBe("sqlite");

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("按时间窗口标签筛选时只返回该窗口命中的文档，计数也准确", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-time-tags-"));
    const exportDir = path.join(rootDir, ".ai-index", "exports");
    fs.mkdirSync(exportDir, { recursive: true });

    fs.writeFileSync(
      path.join(exportDir, "manifest.json"),
      JSON.stringify({
        generated_at: "2026-05-31T06:00:00.000Z",
        entries: {
          taxonomy: "taxonomy.json",
          bootstrap: "bootstrap.json"
        },
        meta_shards: [{ path: "documents-0.json" }]
      })
    );
    fs.writeFileSync(
      path.join(exportDir, "taxonomy.json"),
      JSON.stringify({
        nodes: [
          { path: "时间", name: "时间", root_type: "时间", parent_path: null, depth: 0 },
          { path: "时间/最近3天", name: "最近3天", root_type: "时间", parent_path: "时间", depth: 1 },
          { path: "时间/最近7天", name: "最近7天", root_type: "时间", parent_path: "时间", depth: 1 },
          { path: "时间/最近30天", name: "最近30天", root_type: "时间", parent_path: "时间", depth: 1 }
        ]
      })
    );
    fs.writeFileSync(path.join(exportDir, "bootstrap.json"), JSON.stringify({ folders: [] }));
    fs.writeFileSync(
      path.join(exportDir, "documents-0.json"),
      JSON.stringify({
        documents: [
          {
            document_id: "doc-3",
            path: "recent-3.txt",
            title: "recent-3",
            summary: "recent-3",
            mtime: "2026-05-16T08:00:00.000Z",
            direct_tags: [],
            derived_tags: ["时间/最近3天", "时间/最近7天", "时间/最近30天"]
          },
          {
            document_id: "doc-7",
            path: "recent-7.txt",
            title: "recent-7",
            summary: "recent-7",
            mtime: "2026-05-12T08:00:00.000Z",
            direct_tags: [],
            derived_tags: ["时间/最近7天", "时间/最近30天"]
          },
          {
            document_id: "doc-30",
            path: "recent-30.txt",
            title: "recent-30",
            summary: "recent-30",
            mtime: "2026-04-25T08:00:00.000Z",
            direct_tags: [],
            derived_tags: ["时间/最近30天"]
          }
        ]
      })
    );

    const service = createService({ rootDir });
    const snapshot = service.getSnapshot("workspace-1", "user-1");
    const recent3 = service.listDocuments("workspace-1", "user-1", {
      browseMode: "tag",
      selectedTagPath: "时间/最近3天"
    });
    const recent7 = service.listDocuments("workspace-1", "user-1", {
      browseMode: "tag",
      selectedTagPath: "时间/最近7天"
    });

    expect(snapshot.tags.find((item) => item.path === "时间/最近3天")?.documentCount).toBe(1);
    expect(snapshot.tags.find((item) => item.path === "时间/最近7天")?.documentCount).toBe(2);
    expect(snapshot.tags.find((item) => item.path === "时间/最近30天")?.documentCount).toBe(3);
    expect(recent3.total).toBe(1);
    expect(recent3.items.map((item) => item.path)).toEqual(["recent-3.txt"]);
    expect(recent7.total).toBe(2);
    expect(recent7.items.map((item) => item.path)).toEqual(["recent-3.txt", "recent-7.txt"]);
    const recent3And7 = service.listDocuments("workspace-1", "user-1", {
      browseMode: "tag",
      selectedTagPaths: ["时间/最近3天", "时间/最近7天"]
    });
    expect(recent3And7.total).toBe(1);
    expect(recent3And7.items.map((item) => item.path)).toEqual(["recent-3.txt"]);
    expect(recent3And7.tagFacetCounts?.["时间"]).toBe(1);
    expect(recent3And7.tagFacetCounts?.["时间/最近7天"]).toBe(1);

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("导出刷新后会丢掉旧快照缓存并读到新的根目录文档", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-refresh-cache-"));
    const exportDir = path.join(rootDir, ".ai-index", "exports");
    fs.mkdirSync(exportDir, { recursive: true });

    const writeExport = (input: {
      exportedAt: string;
      files: Array<{ id: string; path: string; title: string; mtime: string }>;
    }) => {
      fs.writeFileSync(
        path.join(exportDir, "status.json"),
        JSON.stringify({
          version: 2,
          format: "static-v2",
          exported_at: input.exportedAt,
          document_count: input.files.length
        })
      );
      fs.writeFileSync(
        path.join(exportDir, "manifest.json"),
        JSON.stringify({
          generated_at: input.exportedAt,
          entries: {
            taxonomy: "taxonomy.json",
            bootstrap: "bootstrap.json"
          },
          meta_shards: [{ path: "documents-0.json" }]
        })
      );
      fs.writeFileSync(path.join(exportDir, "taxonomy.json"), JSON.stringify({ nodes: [] }));
      fs.writeFileSync(
        path.join(exportDir, "bootstrap.json"),
        JSON.stringify({
          folders: [
            {
              path: ".",
              name: "资料库",
              parent_path: null,
              direct_document_count: input.files.length,
              document_count: input.files.length
            }
          ]
        })
      );
      fs.writeFileSync(
        path.join(exportDir, "documents-0.json"),
        JSON.stringify({
          documents: input.files.map((file) => ({
            document_id: file.id,
            path: file.path,
            title: file.title,
            summary: file.title,
            mtime: file.mtime,
            direct_tags: [],
            derived_tags: []
          }))
        })
      );
    };

    writeExport({
      exportedAt: "2026-05-31T10:00:00.000Z",
      files: [
        {
          id: "doc-agents",
          path: "AGENTS.md",
          title: "AGENTS",
          mtime: "2026-05-31T10:00:00.000Z"
        },
        {
          id: "doc-test",
          path: "TEST.MD",
          title: "TEST.MD",
          mtime: "2026-05-31T10:00:01.000Z"
        }
      ]
    });

    const enqueue = vi.fn(() => ({
      taskId: "task-1",
      taskType: HOST_TASK_TYPES.affairsLibraryIndex,
      key: "workspace-1",
      executionLane: "helper_process",
      deduped: false,
      promise: Promise.resolve(createIndexerResult("index")),
      cancel: vi.fn()
    }));
    const service = createService({ rootDir, enqueue });

    const firstList = service.listDocuments("workspace-1", "user-1", {
      browseMode: "folder",
      selectedFolderPath: null
    });
    expect(firstList.total).toBe(2);
    expect(firstList.items.map((item) => item.path)).toEqual(["TEST.MD", "AGENTS.md"]);

    writeExport({
      exportedAt: "2026-05-31T10:05:00.000Z",
      files: [
        {
          id: "doc-agents-copy",
          path: "AGENTS_副本.md",
          title: "AGENTS_副本",
          mtime: "2026-05-31T10:05:03.000Z"
        },
        {
          id: "doc-index",
          path: "index.html",
          title: "index",
          mtime: "2026-05-31T10:05:02.000Z"
        },
        {
          id: "doc-test",
          path: "TEST.MD",
          title: "TEST.MD",
          mtime: "2026-05-31T10:05:01.000Z"
        },
        {
          id: "doc-agents",
          path: "AGENTS.md",
          title: "AGENTS",
          mtime: "2026-05-31T10:05:00.000Z"
        }
      ]
    });

    const refresh = service.requestRefresh("workspace-1", "user-1", "manual_refresh");
    await enqueue.mock.results[0]?.value.promise;
    expect(refresh.taskId).toBe("task-1");

    const secondList = service.listDocuments("workspace-1", "user-1", {
      browseMode: "folder",
      selectedFolderPath: null
    });
    expect(secondList.total).toBe(4);
    expect(secondList.items.map((item) => item.path)).toEqual([
      "AGENTS_副本.md",
      "index.html",
      "TEST.MD",
      "AGENTS.md"
    ]);

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("索引卡住时，目录模式仍然能直接读到当前目录新增文件", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-live-folder-"));
    const exportDir = path.join(rootDir, ".ai-index", "exports");
    fs.mkdirSync(path.join(rootDir, "临时文件"), { recursive: true });
    fs.mkdirSync(exportDir, { recursive: true });

    fs.writeFileSync(
      path.join(exportDir, "status.json"),
      JSON.stringify({
        version: 2,
        format: "static-v2",
        exported_at: "2026-05-31T10:00:00.000Z",
        document_count: 1
      })
    );
    fs.writeFileSync(
      path.join(exportDir, "manifest.json"),
      JSON.stringify({
        generated_at: "2026-05-31T10:00:00.000Z",
        entries: {
          taxonomy: "taxonomy.json",
          bootstrap: "bootstrap.json"
        },
        meta_shards: [{ path: "documents-0.json" }]
      })
    );
    fs.writeFileSync(path.join(exportDir, "taxonomy.json"), JSON.stringify({ nodes: [] }));
    fs.writeFileSync(
      path.join(exportDir, "bootstrap.json"),
      JSON.stringify({
        folders: [
          {
            path: "临时文件",
            name: "临时文件",
            parent_path: null,
            direct_document_count: 1,
            document_count: 1
          }
        ]
      })
    );
    fs.writeFileSync(
      path.join(exportDir, "documents-0.json"),
      JSON.stringify({
        documents: [
          {
            document_id: "doc-old",
            path: "临时文件/账号.txt",
            title: "账号",
            summary: "账号",
            mtime: "2026-05-31T10:00:00.000Z",
            direct_tags: [],
            derived_tags: []
          }
        ]
      })
    );

    fs.writeFileSync(path.join(rootDir, "临时文件", "账号.txt"), "old\n");
    fs.writeFileSync(path.join(rootDir, "临时文件", "账号_副本.txt"), "new\n");

    const service = createService({
      rootDir,
      peek: () => ({
        taskId: "task-running",
        taskType: HOST_TASK_TYPES.affairsLibraryIndex,
        key: "workspace-1",
        executionLane: "helper_process",
        status: "running",
        source: "affairs_library.auto_refresh",
        attempt: 1,
        enqueuedAt: Date.now() - 60_000,
        startedAt: Date.now() - 59_000,
        finishedAt: null,
        timeoutMs: 15 * 60 * 1000
      })
    });

    const documentList = service.listDocuments("workspace-1", "user-1", {
      browseMode: "folder",
      selectedFolderPath: "临时文件"
    });

    expect(documentList.items.map((item) => item.path)).toEqual([
      "临时文件/账号_副本.txt",
      "临时文件/账号.txt"
    ]);

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("目录刷新只是 queued 时，仍然会直接读磁盘拿到最新修改时间", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-queued-live-folder-"));
    const exportDir = path.join(rootDir, ".ai-index", "exports");
    fs.mkdirSync(path.join(rootDir, "临时文件"), { recursive: true });
    fs.mkdirSync(exportDir, { recursive: true });

    fs.writeFileSync(
      path.join(exportDir, "status.json"),
      JSON.stringify({
        version: 2,
        format: "static-v2",
        exported_at: "2026-05-31T10:00:00.000Z",
        document_count: 1
      })
    );
    fs.writeFileSync(
      path.join(exportDir, "manifest.json"),
      JSON.stringify({
        generated_at: "2026-05-31T10:00:00.000Z",
        entries: {
          taxonomy: "taxonomy.json",
          bootstrap: "bootstrap.json"
        },
        meta_shards: [{ path: "documents-0.json" }]
      })
    );
    fs.writeFileSync(path.join(exportDir, "taxonomy.json"), JSON.stringify({ nodes: [] }));
    fs.writeFileSync(
      path.join(exportDir, "bootstrap.json"),
      JSON.stringify({
        folders: [
          {
            path: "临时文件",
            name: "临时文件",
            parent_path: null,
            direct_document_count: 1,
            document_count: 1
          }
        ]
      })
    );
    fs.writeFileSync(
      path.join(exportDir, "documents-0.json"),
      JSON.stringify({
        documents: [
          {
            document_id: "doc-old",
            path: "临时文件/账号.txt",
            title: "账号",
            summary: "账号",
            mtime: "2026-05-31T10:00:00.000Z",
            direct_tags: [],
            derived_tags: []
          }
        ]
      })
    );

    const filePath = path.join(rootDir, "临时文件", "账号.txt");
    fs.writeFileSync(filePath, "old\n");
    const freshMtime = new Date("2026-06-03T13:14:15.000Z");
    fs.utimesSync(filePath, freshMtime, freshMtime);

    const service = createService({
      rootDir,
      peek: (taskType, key) => taskType === HOST_TASK_TYPES.affairsLibraryDirectoryHint
        && key === "workspace-1::临时文件"
        ? ({
            taskId: "task-dir-queued",
            taskType,
            key,
            executionLane: "helper_process",
            status: "queued",
            source: "affairs_library.directory_hint",
            attempt: 0,
            enqueuedAt: Date.now() - 1_000,
            startedAt: null,
            finishedAt: null,
            timeoutMs: 30_000
          } satisfies TaskSnapshot)
        : null
    });

    const documentList = service.listDocuments("workspace-1", "user-1", {
      browseMode: "folder",
      selectedFolderPath: "临时文件"
    });

    expect(documentList.items).toHaveLength(1);
    expect(documentList.items[0]?.updatedAt).toBe(freshMtime.toISOString());
    expect(documentList.directoryStatus?.state).toBe("queued");

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("目录列表会打出结果来源日志，区分 live cache snapshot", () => {
    const writeDebugLog = vi.spyOn(affairsLibraryDebugLogModule, "writeAffairsLibraryDebugLog").mockImplementation(() => {});
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-folder-source-log-"));
    const exportDir = path.join(rootDir, ".ai-index", "exports");
    fs.mkdirSync(path.join(rootDir, "临时文件"), { recursive: true });
    fs.mkdirSync(exportDir, { recursive: true });
    fs.writeFileSync(
      path.join(exportDir, "status.json"),
      JSON.stringify({
        version: 2,
        format: "static-v2",
        exported_at: "2026-05-31T10:00:00.000Z",
        document_count: 1
      })
    );
    fs.writeFileSync(
      path.join(exportDir, "manifest.json"),
      JSON.stringify({
        generated_at: "2026-05-31T10:00:00.000Z",
        entries: {
          taxonomy: "taxonomy.json",
          bootstrap: "bootstrap.json"
        },
        meta_shards: [{ path: "documents-0.json" }]
      })
    );
    fs.writeFileSync(path.join(exportDir, "taxonomy.json"), JSON.stringify({ nodes: [] }));
    fs.writeFileSync(path.join(exportDir, "bootstrap.json"), JSON.stringify({ folders: [] }));
    fs.writeFileSync(
      path.join(exportDir, "documents-0.json"),
      JSON.stringify({
        documents: [
          {
            document_id: "doc-old",
            path: "临时文件/账号.txt",
            title: "账号",
            summary: "账号",
            mtime: "2026-05-31T10:00:00.000Z",
            direct_tags: [],
            derived_tags: []
          }
        ]
      })
    );
    fs.writeFileSync(path.join(rootDir, "临时文件", "账号.txt"), "old\n");
    const service = createService({ rootDir });

    service.listDocuments("workspace-1", "user-1", {
      browseMode: "folder",
      selectedFolderPath: "临时文件"
    });

    const payloads = writeDebugLog.mock.calls
      .map(([payload]) => payload)
      .filter((payload) => payload && typeof payload === "object" && (payload as { event?: string }).event === "folder_list_served");
    expect(payloads.length).toBeGreaterThan(0);
    expect((payloads[0] as { details?: { resultSource?: string } }).details?.resultSource).toBe("mixed");

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("索引状态会带出当前 rootDir worker 的健康信息", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-worker-health-"));
    seedExistingArtifacts(rootDir);
    (globalThis as Record<string, unknown>).__codingnsTaskHelperPool__ = {
      getWorkerHealth: vi.fn(() => ({
        workerKey: `rootDir:${rootDir}`,
        rootDir,
        state: "running",
        pid: 4321,
        inflightLocalCount: 1,
        inflightRemoteRequestCount: 2,
        startedAt: "2026-06-03T10:00:00.000Z",
        lastHeartbeatAt: "2026-06-03T10:00:05.000Z",
        lastStartedAt: "2026-06-03T10:00:01.000Z",
        lastCompletedAt: "2026-06-03T10:00:02.000Z",
        lastFailedAt: null,
        lastSoftCancelRequestedAt: null,
        lastHardKillAt: null,
        lastExitAt: null,
        lastTerminationReason: null
      }))
    };

    const service = createService({ rootDir });
    const snapshot = service.getSnapshot("workspace-1", "user-1");

    expect(snapshot.status.workerHealth).toMatchObject({
      pid: 4321,
      inflightLocalCount: 1,
      inflightRemoteRequestCount: 2,
      lastHeartbeatAt: "2026-06-03T10:00:05.000Z"
    });

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("大目录列表会先返回 stale_fallback，并把 live scan 下沉到 helper 目录 hint", () => {
    const writeDebugLog = vi.spyOn(affairsLibraryDebugLogModule, "writeAffairsLibraryDebugLog").mockImplementation(() => {});
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-large-folder-"));
    const exportDir = path.join(rootDir, ".ai-index", "exports");
    fs.mkdirSync(path.join(rootDir, "临时文件"), { recursive: true });
    fs.mkdirSync(exportDir, { recursive: true });
    fs.writeFileSync(
      path.join(exportDir, "status.json"),
      JSON.stringify({
        version: 2,
        format: "static-v2",
        exported_at: "2026-06-03T10:00:00.000Z",
        document_count: 250
      })
    );
    fs.writeFileSync(
      path.join(exportDir, "manifest.json"),
      JSON.stringify({
        generated_at: "2026-06-03T10:00:00.000Z",
        entries: {
          taxonomy: "taxonomy.json",
          bootstrap: "bootstrap.json"
        },
        meta_shards: [{ path: "documents-0.json" }]
      })
    );
    fs.writeFileSync(path.join(exportDir, "taxonomy.json"), JSON.stringify({ nodes: [] }));
    fs.writeFileSync(
      path.join(exportDir, "bootstrap.json"),
      JSON.stringify({
        folders: [
          {
            path: "临时文件",
            name: "临时文件",
            parent_path: null,
            direct_document_count: 250,
            document_count: 250
          }
        ]
      })
    );
    fs.writeFileSync(
      path.join(exportDir, "documents-0.json"),
      JSON.stringify({
        documents: [
          {
            document_id: "doc-old",
            path: "临时文件/账号.txt",
            title: "账号",
            summary: "账号",
            mtime: "2026-06-03T10:00:00.000Z",
            direct_tags: [],
            derived_tags: []
          }
        ]
      })
    );
    fs.writeFileSync(path.join(rootDir, "临时文件", "账号.txt"), "old\n");
    fs.writeFileSync(path.join(rootDir, "临时文件", "账号_副本.txt"), "new\n");

    const enqueue = vi.fn((taskType: string) => ({
      taskId: taskType === HOST_TASK_TYPES.affairsLibraryDirectoryHint ? "task-dir-1" : "task-1",
      taskType,
      key: taskType === HOST_TASK_TYPES.affairsLibraryDirectoryHint ? "workspace-1::临时文件" : "workspace-1",
      executionLane: "helper_process",
      deduped: false,
      promise: Promise.resolve(taskType === HOST_TASK_TYPES.affairsLibraryDirectoryHint
        ? {
            directoryPath: "临时文件",
            refreshedAt: "2026-06-03T10:00:10.000Z",
            source: "mixed" as const,
            itemCount: 2,
            changedPaths: ["临时文件/账号.txt", "临时文件/账号_副本.txt"],
            items: [],
            generatedAt: "2026-06-03T10:00:00.000Z",
            filesystemObservedAt: "2026-06-03T10:00:10.000Z"
          }
        : createIndexerResult("index")),
      cancel: vi.fn()
    }));

    const service = createService({ rootDir, enqueue });
    const documentList = service.listDocuments("workspace-1", "user-1", {
      browseMode: "folder",
      selectedFolderPath: "临时文件"
    });

    expect(documentList.items.map((item) => item.path)).toEqual(["临时文件/账号.txt"]);
    expect(documentList.directoryStatus?.source).toBe("stale_fallback");
    expect(documentList.directoryStatus?.staleReason).toBe("large_directory:250");
    expect(documentList.directoryStatus?.generatedAt).toBe("2026-06-03T10:00:00.000Z");
    expect(enqueue).toHaveBeenCalledWith(
      HOST_TASK_TYPES.affairsLibraryDirectoryHint,
      expect.objectContaining({
        input: expect.objectContaining({
          directoryPath: "临时文件",
          reason: "large_directory_live_scan"
        })
      })
    );

    const deferredPayloads = writeDebugLog.mock.calls
      .map(([payload]) => payload)
      .filter((payload) => payload && typeof payload === "object" && (payload as { event?: string }).event === "directory_live_scan_deferred");
    expect(deferredPayloads.length).toBeGreaterThan(0);

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("任务快照还挂着 running，但导出时间已经更新后，状态会按完成显示", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-status-reconcile-"));
    const exportDir = path.join(rootDir, ".ai-index", "exports");
    fs.mkdirSync(exportDir, { recursive: true });
    fs.writeFileSync(
      path.join(exportDir, "status.json"),
      JSON.stringify({
        version: 2,
        format: "static-v2",
        exported_at: new Date(Date.now() - 1_000).toISOString(),
        document_count: 3
      })
    );
    fs.writeFileSync(
      path.join(exportDir, "manifest.json"),
      JSON.stringify({
        generated_at: new Date(Date.now() - 1_000).toISOString(),
        entries: {
          taxonomy: "taxonomy.json",
          bootstrap: "bootstrap.json"
        },
        meta_shards: []
      })
    );
    fs.writeFileSync(path.join(exportDir, "taxonomy.json"), JSON.stringify({ nodes: [] }));
    fs.writeFileSync(path.join(exportDir, "bootstrap.json"), JSON.stringify({ folders: [] }));

    const now = Date.now();
    const service = createService({
      rootDir,
      peek: () => ({
        taskId: "9ffe0f50-94a3-4522-a47c-d89b1dadff4f",
        taskType: HOST_TASK_TYPES.affairsLibraryIndex,
        key: "workspace-1",
        executionLane: "helper_process",
        status: "running",
        source: "affairs_library.auto_refresh",
        attempt: 1,
        enqueuedAt: now - 90_000,
        startedAt: now - 89_000,
        finishedAt: null,
        timeoutMs: 15 * 60 * 1000
      })
    });

    const snapshot = service.getSnapshot("workspace-1", "user-1");

    expect(snapshot.status.state).toBe("cooldown");
    expect(snapshot.status.runningTaskId).toBeNull();
    expect(snapshot.status.lastCompletedAt).not.toBeNull();
    expect(snapshot.status.dirtyReasons).toEqual([]);

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("索引任务如果在 Host 队列里等待超时，状态会明确显示 queue_timeout", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-queue-timeout-"));
    seedExistingArtifacts(rootDir);

    const now = Date.now();
    const service = createService({
      rootDir,
      peek: () => ({
        taskId: "task-queue-timeout",
        taskType: HOST_TASK_TYPES.affairsLibraryIndex,
        key: "workspace-1",
        executionLane: "helper_process",
        status: "queue_timeout",
        source: "affairs_library.auto_refresh",
        attempt: 0,
        enqueuedAt: now - 90_000,
        startedAt: null,
        finishedAt: now - 20_000,
        timeoutMs: 15 * 60 * 1000,
        errorMessage: "affairs.library_index:workspace-1 排队等待超过 60000ms 仍未开始执行",
        errorCode: "TASK_QUEUE_WAIT_TIMEOUT"
      })
    });

    const snapshot = service.getSnapshot("workspace-1", "user-1");

    expect(snapshot.status.state).toBe("queue_timeout");
    expect(snapshot.status.dirtyReasons).toContain("queue_timeout");
    expect(snapshot.status.errorSummary).toContain("排队等待超过");

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("task snapshot 还挂着 running，但 helper 进程已经消失时，会改判为 failed", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-orphan-running-"));
    fs.mkdirSync(path.join(rootDir, ".ai-index", "runtime", "command.lock"), { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, ".ai-index", "runtime-status.json"),
      JSON.stringify({
        version: 1,
        status: "running",
        stage: "export",
        command: "index",
        taskId: "task-orphan",
        taskType: HOST_TASK_TYPES.affairsLibraryIndex,
        updatedAt: new Date(Date.now() - 60_000).toISOString()
      })
    );
    fs.writeFileSync(
      path.join(rootDir, ".ai-index", "runtime", "command.lock", "owner.json"),
      JSON.stringify({
        pid: 999999,
        command: "index",
        taskId: "task-orphan",
        taskType: HOST_TASK_TYPES.affairsLibraryIndex,
        acquiredAt: new Date(Date.now() - 120_000).toISOString()
      })
    );
    fs.writeFileSync(
      path.join(rootDir, ".ai-index", "runtime", "command.lock", "heartbeat.json"),
      JSON.stringify({
        ts: new Date(Date.now() - 120_000).toISOString()
      })
    );

    const now = Date.now();
    const service = createService({
      rootDir,
      peek: () => ({
        taskId: "task-orphan",
        taskType: HOST_TASK_TYPES.affairsLibraryIndex,
        key: "workspace-1",
        executionLane: "helper_process",
        status: "running",
        source: "affairs_library.auto_refresh",
        attempt: 1,
        enqueuedAt: now - 180_000,
        startedAt: now - 175_000,
        finishedAt: null,
        timeoutMs: 15 * 60 * 1000
      })
    });

    const snapshot = service.getSnapshot("workspace-1", "user-1");

    expect(snapshot.status.state).toBe("failed");
    expect(snapshot.status.runningTaskId).toBeNull();
    expect(snapshot.status.runningStage).toBeNull();
    expect(snapshot.status.dirtyReasons).toContain("command_lock_owner_dead");
    expect(snapshot.status.errorSummary).toContain("helper 进程");

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("别的工作区的 queued 索引任务，不会把当前工作区的自动刷新卡死", async () => {
    vi.useFakeTimers();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-other-workspace-queued-"));
    seedExistingArtifacts(rootDir);

    const enqueue = vi.fn(() => ({
      taskId: "task-current-workspace",
      taskType: HOST_TASK_TYPES.affairsLibraryIndex,
      key: "workspace-1",
      executionLane: "helper_process",
      deduped: false,
      promise: Promise.resolve(createIndexerResult("index")),
      cancel: vi.fn()
    }));

    const service = createService({
      rootDir,
      peek: (taskType, key) => taskType === HOST_TASK_TYPES.affairsLibraryIndex && key === "workspace-1"
        ? null
        : taskType === HOST_TASK_TYPES.affairsLibraryIndex
          ? ({
              taskId: "task-other-workspace",
              taskType,
              key,
              executionLane: "helper_process",
              status: "queued",
              source: "affairs_library.auto_refresh",
              attempt: 0,
              enqueuedAt: Date.now() - 60_000,
              startedAt: null,
              finishedAt: null,
              timeoutMs: 15 * 60 * 1000
            } satisfies TaskSnapshot)
          : null,
      enqueue
    });

    service.scheduleAutoRefresh("workspace-1", "watch:index_changed:notes/demo.md", "notes/demo.md");
    await vi.advanceTimersByTimeAsync(810);

    expect(enqueue).toHaveBeenCalledWith(
      HOST_TASK_TYPES.affairsLibraryIndex,
      expect.objectContaining({
        key: "workspace-1",
        input: expect.objectContaining({
          workspaceId: "workspace-1",
          rootDir,
          targetPath: "notes/demo.md"
        })
      })
    );

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
});

describe("AffairsLibraryService export cache fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("失效内存缓存时不会删除磁盘快照缓存文件", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-cache-"));
    const exportDir = path.join(rootDir, ".ai-index", "exports");
    const cachePath = path.join(exportDir, SNAPSHOT_CACHE_FILE_NAME);
    fs.mkdirSync(exportDir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({
      schemaVersion: 2,
      signature: "demo-signature",
      generatedAt: "2026-06-03T12:00:00.000Z",
      documents: [],
      tags: [],
      folders: []
    }));

    try {
      const service = createService({ rootDir });
      (service as unknown as { invalidateExportCache(rootDir: string): void }).invalidateExportCache(rootDir);
      expect(fs.existsSync(cachePath)).toBe(true);
      service.dispose();
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

describe("AffairsLibraryDirtyWatchService", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("外部普通文档改动会触发 targeted refresh，配置文件仍走专用链路", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-watch-"));
    fs.mkdirSync(path.join(rootDir, ".ai-index"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, "notes"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, ".ai-index", "doc-semantic-index.config.json"), "{}\n");
    fs.writeFileSync(path.join(rootDir, "notes", "a.md"), "hello\n");

    const events: AffairsLibraryWatchDirtyEvent[] = [];
    const service = new AffairsLibraryDirtyWatchService(
      {
        listEnabledAffairsLibraries: vi.fn(() => []),
        findAnyEnabledAffairsLibraryByWorkspaceId: vi.fn(() => ({
          workspaceId: "workspace-1",
          userId: "user-1",
          collapsed: false,
          backgroundColor: null,
          affairsLibraryRootPath: rootDir,
          affairsLibraryEnabled: true,
          affairsLibraryFavoritesJson: "[]",
          updatedAt: "2026-05-31T06:00:00.000Z"
        }))
      } as never,
      (_workspaceId, event) => {
        events.push(event);
      },
      {
        info: vi.fn(),
        warn: vi.fn()
      }
    );

    service.syncWorkspace("workspace-1");
    await sleep(300);

    fs.writeFileSync(path.join(rootDir, ".ai-index", "doc-semantic-index.config.json"), '{"allowedExtensions":[".md"]}\n');
    fs.writeFileSync(path.join(rootDir, "notes", "a.md"), "hello world\n");

    await sleep(1300);

    expect(events).toHaveLength(2);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "config" }),
      expect.objectContaining({ kind: "index", targetPath: "notes/a.md" })
    ]));

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("常见临时文件不会触发外部自动刷新", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-watch-temp-"));
    fs.mkdirSync(path.join(rootDir, "notes"), { recursive: true });

    const events: AffairsLibraryWatchDirtyEvent[] = [];
    const service = new AffairsLibraryDirtyWatchService(
      {
        listEnabledAffairsLibraries: vi.fn(() => []),
        findAnyEnabledAffairsLibraryByWorkspaceId: vi.fn(() => ({
          workspaceId: "workspace-1",
          userId: "user-1",
          collapsed: false,
          backgroundColor: null,
          affairsLibraryRootPath: rootDir,
          affairsLibraryEnabled: true,
          affairsLibraryFavoritesJson: "[]",
          updatedAt: "2026-05-31T06:00:00.000Z"
        }))
      } as never,
      (_workspaceId, event) => {
        events.push(event);
      },
      {
        info: vi.fn(),
        warn: vi.fn()
      }
    );

    service.syncWorkspace("workspace-1");
    await sleep(300);

    fs.writeFileSync(path.join(rootDir, "notes", "demo.md.swp"), "temp\n");
    fs.writeFileSync(path.join(rootDir, "notes", "~$demo.md"), "temp\n");
    fs.writeFileSync(path.join(rootDir, "notes", ".goutputstream-XXXXXX"), "temp\n");

    await sleep(1300);

    expect(events).toEqual([]);

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("普通隐藏文件和隐藏目录默认不会触发外部自动刷新", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-watch-hidden-"));
    fs.mkdirSync(path.join(rootDir, "notes"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, ".obsidian"), { recursive: true });

    const events: AffairsLibraryWatchDirtyEvent[] = [];
    const service = new AffairsLibraryDirtyWatchService(
      {
        listEnabledAffairsLibraries: vi.fn(() => []),
        findAnyEnabledAffairsLibraryByWorkspaceId: vi.fn(() => ({
          workspaceId: "workspace-1",
          userId: "user-1",
          collapsed: false,
          backgroundColor: null,
          affairsLibraryRootPath: rootDir,
          affairsLibraryEnabled: true,
          affairsLibraryFavoritesJson: "[]",
          updatedAt: "2026-05-31T06:00:00.000Z"
        }))
      } as never,
      (_workspaceId, event) => {
        events.push(event);
      },
      {
        info: vi.fn(),
        warn: vi.fn()
      }
    );

    service.syncWorkspace("workspace-1");
    await sleep(300);

    fs.writeFileSync(path.join(rootDir, ".env"), "SECRET=1\n");
    fs.writeFileSync(path.join(rootDir, "notes", ".draft.md"), "hidden\n");
    fs.writeFileSync(path.join(rootDir, ".obsidian", "workspace.json"), "{}\n");

    await sleep(1300);

    expect(events).toEqual([]);

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("配置里手动放行 hidden 路径后，watcher 会正常上报这些路径", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-watch-hidden-include-"));
    fs.mkdirSync(path.join(rootDir, "notes"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, ".obsidian"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, ".ai-index"), { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, ".ai-index", "doc-semantic-index.config.json"),
      JSON.stringify({
        includedHiddenPaths: [".obsidian", "notes/.draft.md"]
      })
    );

    const events: AffairsLibraryWatchDirtyEvent[] = [];
    const service = new AffairsLibraryDirtyWatchService(
      {
        listEnabledAffairsLibraries: vi.fn(() => []),
        findAnyEnabledAffairsLibraryByWorkspaceId: vi.fn(() => ({
          workspaceId: "workspace-1",
          userId: "user-1",
          collapsed: false,
          backgroundColor: null,
          affairsLibraryRootPath: rootDir,
          affairsLibraryEnabled: true,
          affairsLibraryFavoritesJson: "[]",
          updatedAt: "2026-05-31T06:00:00.000Z"
        }))
      } as never,
      (_workspaceId, event) => {
        events.push(event);
      },
      {
        info: vi.fn(),
        warn: vi.fn()
      }
    );

    service.syncWorkspace("workspace-1");
    await sleep(300);

    fs.writeFileSync(path.join(rootDir, "notes", ".draft.md"), "hidden\n");
    fs.writeFileSync(path.join(rootDir, ".obsidian", "workspace.json"), "{}\n");

    await sleep(1300);

    expect(events.some((event) => event.kind === "index")).toBe(true);
    const indexEvent = events.find((event) => event.kind === "index");
    expect(indexEvent?.targetPath).toBeTruthy();
    expect(["notes/.draft.md", ".obsidian/workspace.json"]).toContain(indexEvent?.targetPath);

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("目录级模糊事件会补扫并归并到真实目标路径", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-watch-dir-"));
    fs.mkdirSync(path.join(rootDir, "notes"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "notes", "real.md"), "real\n");
    fs.writeFileSync(path.join(rootDir, "notes", "~$real.md"), "temp\n");

    const events: AffairsLibraryWatchDirtyEvent[] = [];
    const service = new AffairsLibraryDirtyWatchService(
      {
        listEnabledAffairsLibraries: vi.fn(() => []),
        findAnyEnabledAffairsLibraryByWorkspaceId: vi.fn(() => ({
          workspaceId: "workspace-1",
          userId: "user-1",
          collapsed: false,
          backgroundColor: null,
          affairsLibraryRootPath: rootDir,
          affairsLibraryEnabled: true,
          affairsLibraryFavoritesJson: "[]",
          updatedAt: "2026-05-31T06:00:00.000Z"
        }))
      } as never,
      (_workspaceId, event) => {
        events.push(event);
      },
      {
        info: vi.fn(),
        warn: vi.fn()
      }
    );

    (service as unknown as {
      handleFsWatchEvent: (
        workspaceId: string,
        rootDir: string,
        eventType: string,
        fileName: string
      ) => void;
    }).handleFsWatchEvent("workspace-1", rootDir, "rename", "notes");

    await sleep(1300);

    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "index",
        targetPath: "notes/real.md"
      })
    );

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("会按低频周期补一轮外部刷新兜底", async () => {
    vi.useFakeTimers();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-watch-periodic-"));
    const events: AffairsLibraryWatchDirtyEvent[] = [];
    const service = new AffairsLibraryDirtyWatchService(
      {
        listEnabledAffairsLibraries: vi.fn(() => []),
        findAnyEnabledAffairsLibraryByWorkspaceId: vi.fn(() => ({
          workspaceId: "workspace-1",
          userId: "user-1",
          collapsed: false,
          backgroundColor: null,
          affairsLibraryRootPath: rootDir,
          affairsLibraryEnabled: true,
          affairsLibraryFavoritesJson: "[]",
          updatedAt: "2026-05-31T06:00:00.000Z"
        }))
      } as never,
      (_workspaceId, event) => {
        events.push(event);
      },
      {
        info: vi.fn(),
        warn: vi.fn()
      }
    );

    service.syncWorkspace("workspace-1");
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 100);

    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "audit",
        reason: "periodic_audit"
      })
    );

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("删掉 .ai-index 后会提交重建脏标记", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-watch-missing-index-"));
    const exportDir = path.join(rootDir, ".ai-index", "exports");
    fs.mkdirSync(exportDir, { recursive: true });
    fs.writeFileSync(path.join(exportDir, "status.json"), "{}\n");
    fs.writeFileSync(path.join(exportDir, "manifest.json"), "{}\n");

    const events: AffairsLibraryWatchDirtyEvent[] = [];
    const service = new AffairsLibraryDirtyWatchService(
      {
        listEnabledAffairsLibraries: vi.fn(() => []),
        findAnyEnabledAffairsLibraryByWorkspaceId: vi.fn(() => ({
          workspaceId: "workspace-1",
          userId: "user-1",
          collapsed: false,
          backgroundColor: null,
          affairsLibraryRootPath: rootDir,
          affairsLibraryEnabled: true,
          affairsLibraryFavoritesJson: "[]",
          updatedAt: "2026-05-31T06:00:00.000Z"
        }))
      } as never,
      (_workspaceId, event) => {
        events.push(event);
      },
      {
        info: vi.fn(),
        warn: vi.fn()
      }
    );

    service.syncWorkspace("workspace-1");
    await sleep(300);
    fs.rmSync(path.join(rootDir, ".ai-index"), { recursive: true, force: true });

    await sleep(1300);

    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "index",
        reason: expect.stringContaining("missing_index_artifact")
      })
    );

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
});

describe("AffairsLibraryService global binding", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("当前用户没有全局配置时，会把旧 workspace 绑定迁到全局配置", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-binding-fallback-"));

    const service = createService({
      rootDir,
      findByWorkspaceIdAndUserId: () => null,
      findLatestAffairsLibraryByWorkspaceId: () => ({
        workspaceId: "workspace-1",
        userId: "desktop-user",
        collapsed: false,
        backgroundColor: null,
        affairsLibraryRootPath: rootDir,
        affairsLibraryEnabled: true,
        affairsLibraryFavoritesJson: "[{\"kind\":\"folder\",\"path\":\".\",\"label\":\"全部\"}]",
        updatedAt: "2026-06-03T02:00:00.000Z"
      })
    });

    expect(service.getBinding("workspace-1", "workspace-session-user")).toMatchObject({
      workspaceId: "workspace-1",
      rootDir,
      enabled: true
    });

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("切换启用状态时会更新用户级全局配置", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-binding-enable-fallback-"));
    const upsert = vi.fn();
    upsert.mockImplementation((record) => record);

    const service = new AffairsLibraryService(
      {
        getWorkspaceOrThrow: vi.fn(() => createWorkspace(rootDir)),
        list: vi.fn(() => [createWorkspace(rootDir)])
      } as never,
      {
        findByWorkspaceIdAndUserId: vi.fn(() => null),
        upsert,
        listEnabledAffairsLibraries: vi.fn(() => []),
        findAnyEnabledAffairsLibraryByWorkspaceId: vi.fn(() => ({
          workspaceId: "workspace-1",
          userId: "desktop-user",
          collapsed: false,
          backgroundColor: null,
          affairsLibraryRootPath: rootDir,
          affairsLibraryEnabled: true,
          affairsLibraryFavoritesJson: "[]",
          updatedAt: "2026-06-03T02:00:00.000Z"
        })),
        findLatestAffairsLibraryByWorkspaceId: vi.fn(() => ({
          workspaceId: "workspace-1",
          userId: "desktop-user",
          collapsed: false,
          backgroundColor: null,
          affairsLibraryRootPath: rootDir,
          affairsLibraryEnabled: true,
          affairsLibraryFavoritesJson: "[]",
          updatedAt: "2026-06-03T02:00:00.000Z"
        }))
      } as never,
      {
        findByUserId: vi.fn(() => ({
          userId: "workspace-session-user",
          rootDir,
          enabled: true,
          favoritesJson: "[]",
          lastWorkspaceId: "workspace-1",
          createdAt: "2026-06-03T02:00:00.000Z",
          updatedAt: "2026-06-03T02:00:00.000Z"
        })),
        upsert
      } as never,
      {
        has: vi.fn(() => false),
        register: vi.fn(),
        enqueue: vi.fn(() => ({
          taskId: "task-1",
          taskType: HOST_TASK_TYPES.affairsLibraryIndex,
          key: "workspace-1",
          executionLane: "helper_process",
          deduped: false,
          promise: Promise.resolve(createIndexerResult("index")),
          cancel: vi.fn()
        })),
        peek: vi.fn(() => null)
      } as never,
      {
        info: vi.fn(),
        warn: vi.fn()
      } as never
    );

    const binding = service.setEnabled("workspace-1", "workspace-session-user", false);

    expect(binding).toMatchObject({
      workspaceId: "workspace-1",
      rootDir,
      enabled: false
    });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      userId: "workspace-session-user",
      rootDir,
      enabled: false,
      lastWorkspaceId: "workspace-1"
    }));

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("全局绑定接口会优先复用用户级配置", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-global-binding-"));

    const service = createService({
      rootDir,
      currentGlobalSetting: {
        userId: "workspace-session-user",
        rootDir,
        enabled: true,
        favoritesJson: "[]",
        lastWorkspaceId: "workspace-1",
        createdAt: "2026-06-03T02:00:00.000Z",
        updatedAt: "2026-06-03T02:00:00.000Z"
      }
    });

    expect(service.getGlobalBinding("workspace-session-user")).toMatchObject({
      workspaceId: "workspace-1",
      rootDir,
      enabled: true
    });

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("全局收藏接口会更新用户级收藏并保持旧兼容镜像", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-global-favorites-"));
    const upsert = vi.fn((record) => record);
    const legacyUpsert = vi.fn();

    const service = new AffairsLibraryService(
      {
        getWorkspaceOrThrow: vi.fn(() => createWorkspace(rootDir)),
        list: vi.fn(() => [createWorkspace(rootDir)])
      } as never,
      {
        findByWorkspaceIdAndUserId: vi.fn(() => null),
        upsert: legacyUpsert,
        listEnabledAffairsLibraries: vi.fn(() => []),
        findAnyEnabledAffairsLibraryByWorkspaceId: vi.fn(() => null),
        findLatestAffairsLibraryByWorkspaceId: vi.fn(() => null),
        listByUserId: vi.fn(() => [])
      } as never,
      {
        findByUserId: vi.fn(() => ({
          userId: "workspace-session-user",
          rootDir,
          enabled: true,
          favoritesJson: "[]",
          lastWorkspaceId: "workspace-1",
          createdAt: "2026-06-03T02:00:00.000Z",
          updatedAt: "2026-06-03T02:00:00.000Z"
        })),
        upsert
      } as never,
      {
        has: vi.fn(() => false),
        register: vi.fn(),
        enqueue: vi.fn(() => ({
          taskId: "task-1",
          taskType: HOST_TASK_TYPES.affairsLibraryIndex,
          key: "workspace-1",
          executionLane: "helper_process",
          deduped: false,
          promise: Promise.resolve(createIndexerResult("index")),
          cancel: vi.fn()
        })),
        peek: vi.fn(() => null)
      } as never,
      {
        info: vi.fn(),
        warn: vi.fn()
      } as never
    );

    const favorites = service.updateGlobalFavorites("workspace-session-user", [
      {
        kind: "folder",
        path: "  .  ",
        label: "全部资料"
      }
    ]);

    expect(favorites).toEqual([
      {
        kind: "folder",
        path: ".",
        label: "全部资料"
      }
    ]);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      userId: "workspace-session-user",
      favoritesJson: JSON.stringify(favorites),
      lastWorkspaceId: "workspace-1"
    }));
    expect(legacyUpsert).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      userId: "workspace-session-user",
      affairsLibraryFavoritesJson: JSON.stringify(favorites)
    }));

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
