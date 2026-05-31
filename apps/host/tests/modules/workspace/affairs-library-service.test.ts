import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AffairsLibraryDirtyWatchService,
  type AffairsLibraryWatchDirtyEvent
} from "../../../src/modules/workspace/affairs-library-dirty-watch-service.js";
import { AffairsLibraryService } from "../../../src/modules/workspace/affairs-library-service.js";
import { HOST_TASK_TYPES, type TaskSnapshot } from "../../../src/modules/tasks/task-types.js";
import type { WorkspaceNavigationStateRecord, Workspace } from "../../../src/types/domain.js";

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

function createIndexerResult(command: "apply-config" | "index" | "recompute-tags") {
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

function createService(options: {
  rootDir: string;
  listEnabledAffairsLibraries?: WorkspaceNavigationStateRecord[];
  findAnyEnabledAffairsLibraryByWorkspaceId?: () => WorkspaceNavigationStateRecord | null;
  findByWorkspaceIdAndUserId?: () => WorkspaceNavigationStateRecord | null;
  peek?: (taskType: string, key: string) => TaskSnapshot | null;
  enqueue?: ReturnType<typeof vi.fn>;
}) {
  return new AffairsLibraryService(
    {
      getWorkspaceOrThrow: vi.fn(() => createWorkspace(options.rootDir))
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
      )
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
      peek: vi.fn(options.peek ?? (() => null))
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
        {
          workspaceId: "workspace-1",
          userId: "user-1",
          collapsed: false,
          backgroundColor: null,
          affairsLibraryRootPath: rootDir,
          affairsLibraryEnabled: true,
          affairsLibraryFavoritesJson: "[]",
          updatedAt: "2026-05-31T06:00:00.000Z"
        }
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
          reason: "startup_resume"
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
        {
          workspaceId: "workspace-1",
          userId: "user-1",
          collapsed: false,
          backgroundColor: null,
          affairsLibraryRootPath: rootDir,
          affairsLibraryEnabled: true,
          affairsLibraryFavoritesJson: "[]",
          updatedAt: "2026-05-31T06:00:00.000Z"
        }
      ]
    });

    await vi.advanceTimersByTimeAsync(810);

    expect(enqueue).not.toHaveBeenCalled();

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("config 变更会先排 apply-config，再补跑文件增量索引", async () => {
    vi.useFakeTimers();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-"));
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
    expect(enqueue).toHaveBeenNthCalledWith(
      1,
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
    expect(enqueue).toHaveBeenNthCalledWith(
      2,
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

  it("应用内文件写入会把文档库内的文件改动收口成 targeted refresh", async () => {
    vi.useFakeTimers();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-touch-"));
    fs.mkdirSync(path.join(rootDir, "notes"), { recursive: true });
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
});

describe("AffairsLibraryDirtyWatchService", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("外部普通文档改动会触发 targeted refresh，配置和标签规则仍走专用链路", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-watch-"));
    fs.mkdirSync(path.join(rootDir, ".ai-index"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, "notes"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, ".ai-index", "doc-semantic-index.config.json"), "{}\n");
    fs.writeFileSync(path.join(rootDir, ".ai-index", "tag-rules.json"), "{}\n");
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
    fs.writeFileSync(path.join(rootDir, ".ai-index", "tag-rules.json"), '{"rules":[]}\n');
    fs.writeFileSync(path.join(rootDir, "notes", "a.md"), "hello world\n");

    await sleep(1300);

    expect(events).toHaveLength(3);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "config" }),
      expect.objectContaining({ kind: "tag-rules" }),
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
        kind: "index",
        reason: "periodic_refresh"
      })
    );

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
