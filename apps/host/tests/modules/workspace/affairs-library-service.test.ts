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
    expect(enqueue.mock.calls[0]?.[1]?.input).not.toHaveProperty("targetPath");
    expect(String(enqueue.mock.calls[0]?.[1]?.input?.reason ?? "")).toContain("missing_index_artifact");

    service.dispose();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("周期兜底在产物齐全时走全库增量刷新，不直接全量重建", async () => {
    vi.useFakeTimers();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-lib-periodic-"));
    seedExistingArtifacts(rootDir);
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
    service.scheduleAutoRefresh("workspace-1", "periodic_refresh");

    await vi.advanceTimersByTimeAsync(810);

    expect(enqueue).toHaveBeenCalledWith(
      HOST_TASK_TYPES.affairsLibraryIndex,
      expect.objectContaining({
        input: expect.objectContaining({
          workspaceId: "workspace-1",
          rootDir,
          reason: "periodic_refresh",
          commandMode: "incremental"
        })
      })
    );
    expect(enqueue.mock.calls[0]?.[1]?.input).not.toHaveProperty("targetPath");

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
    expect(firstList.items.map((item) => item.path)).toEqual(["AGENTS.md", "TEST.MD"]);

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
        kind: "index",
        reason: "periodic_refresh"
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
