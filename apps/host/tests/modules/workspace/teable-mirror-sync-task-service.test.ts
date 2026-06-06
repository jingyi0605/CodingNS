import { afterEach, describe, expect, it, vi } from "vitest";

import { createTaskManager } from "../../../src/modules/tasks/task-manager.js";
import { HOST_TASK_TYPES } from "../../../src/modules/tasks/task-types.js";
import { TeableMirrorSyncService } from "../../../src/modules/workspace/teable-mirror-sync-service.js";

function createBindingRepository(records: any[] = []) {
  let current = [...records];
  return {
    listByUserId: vi.fn((userId: string) => current.filter((item) => item.userId === userId)),
    findByUserIdAndMirrorType: vi.fn((userId: string, mirrorType: string) => current.find((item) => item.userId === userId && item.mirrorType === mirrorType) ?? null),
    upsert: vi.fn((record: any) => {
      current = current.filter((item) => !(item.userId === record.userId && item.mirrorType === record.mirrorType));
      current.push(record);
      return record;
    })
  };
}

function createMappingRepository(records: any[] = []) {
  let current = [...records];
  return {
    listByUserIdAndMirrorType: vi.fn((userId: string, mirrorType: string) => current.filter((item) => item.userId === userId && item.mirrorType === mirrorType)),
    findByUserIdAndMirrorTypeAndLocalId: vi.fn((userId: string, mirrorType: string, localId: string) => current.find((item) => item.userId === userId && item.mirrorType === mirrorType && item.localId === localId) ?? null),
    upsert: vi.fn((record: any) => {
      current = current.filter((item) => !(item.userId === record.userId && item.mirrorType === record.mirrorType && item.localId === record.localId));
      current.push(record);
      return record;
    })
  };
}

function createSyncLogRepository(records: any[] = []) {
  let current = [...records];
  return {
    listByUserId: vi.fn((userId: string, input: { state?: string; triggerType?: string; limit?: number } = {}) => current
      .filter((item) => item.userId === userId)
      .filter((item) => !input.state || item.state === input.state)
      .filter((item) => !input.triggerType || item.triggerType === input.triggerType)
      .slice(0, input.limit ?? 50)),
    create: vi.fn((record: any) => {
      current.push(record);
      return record;
    }),
    update: vi.fn((record: any) => {
      current = current.filter((item) => !(item.userId === record.userId && item.logId === record.logId));
      current.push(record);
      return record;
    }),
    findById: vi.fn((userId: string, logId: string) => current.find((item) => item.userId === userId && item.logId === logId) ?? null),
    records: () => current
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TeableMirrorSyncService task integration", () => {
  it("会注册正式后台任务并支持入队", async () => {
    const taskManager = createTaskManager();
    const service = new TeableMirrorSyncService(
      createBindingRepository() as never,
      createMappingRepository() as never,
      taskManager,
      {
        getOverview: vi.fn(() => ({
          binding: {
            baseUrl: "https://teable.example.com",
            spaceId: "space-1",
            baseId: "base-1",
            authRef: "secret://teable/main",
            enabled: true,
            mirrorMode: "manual",
            updatedAt: "2026-06-05T08:00:00.000Z"
          },
          status: "ready",
          summary: "ready",
          updatedAt: "2026-06-05T08:00:00.000Z"
        })),
        getGlobalBinding: vi.fn(() => ({
          baseUrl: "https://teable.example.com",
          spaceId: "space-1",
          baseId: "base-1",
          authRef: "secret://teable/main",
          enabled: true,
          mirrorMode: "manual",
          updatedAt: "2026-06-05T08:00:00.000Z"
        }))
      } as never,
      {
        loadToken: vi.fn(() => "token-123")
      } as never,
      {
        getConfigs: vi.fn(() => [
          { sourceType: "tags", enabled: true, scope: { mode: "manual_selection" }, targetTableId: null, configId: "cfg-1", updatedAt: "2026-06-05T08:00:00.000Z" },
          { sourceType: "sessions", enabled: false, scope: { mode: "recent" }, targetTableId: null, configId: "cfg-2", updatedAt: "2026-06-05T08:00:00.000Z" },
          { sourceType: "todos", enabled: false, scope: { mode: "open_only" }, targetTableId: null, configId: "cfg-3", updatedAt: "2026-06-05T08:00:00.000Z" }
        ])
      } as never,
      { listGlobalTags: vi.fn(() => ({ items: [] })) } as never,
      { listSessions: vi.fn(async () => []) } as never,
      { list: vi.fn(() => []) } as never,
      { list: vi.fn(() => []) } as never
    );

    expect(taskManager.has(HOST_TASK_TYPES.teableMirrorSync)).toBe(true);

    const request = service.requestMirrorSync("user-1", {
      workspaceId: "workspace-1",
      mirrorTypes: ["tags"]
    });

    expect(request.state).toBe("queued");
    expect(request.taskType).toBe("mirror_sync");

    const snapshot = service.getMirrorSyncTaskSnapshot("user-1", undefined, "workspace-1");
    expect(snapshot?.taskId).toBe(request.taskId);
    expect(["queued", "running", "succeeded"]).toContain(snapshot?.state);
  });

  it("overview 会带出绑定、推送配置、镜像表和最近任务", async () => {
    const taskManager = createTaskManager();
    const bindingRepo = createBindingRepository([
      {
        bindingId: "binding-tags",
        userId: "user-1",
        mirrorType: "tags",
        tableId: "tbl_tags",
        tableName: "cn_tags",
        readOnlyMode: "unknown",
        lastSyncedAt: "2026-06-05T08:10:00.000Z",
        createdAt: "2026-06-05T08:00:00.000Z",
        updatedAt: "2026-06-05T08:10:00.000Z"
      }
    ]);
    const service = new TeableMirrorSyncService(
      bindingRepo as never,
      createMappingRepository() as never,
      taskManager,
      {
        getOverview: vi.fn(() => ({ binding: null, status: "unbound", summary: "未绑定", updatedAt: null })),
        getGlobalBinding: vi.fn(() => null)
      } as never,
      { loadToken: vi.fn(() => null) } as never,
      {
        getConfigs: vi.fn(() => [
          { sourceType: "tags", enabled: true, scope: { mode: "manual_selection" }, targetTableId: "tbl_tags", configId: "cfg-1", updatedAt: "2026-06-05T08:00:00.000Z" },
          { sourceType: "sessions", enabled: false, scope: { mode: "recent" }, targetTableId: null, configId: "cfg-2", updatedAt: "2026-06-05T08:00:00.000Z" },
          { sourceType: "todos", enabled: false, scope: { mode: "open_only" }, targetTableId: null, configId: "cfg-3", updatedAt: "2026-06-05T08:00:00.000Z" }
        ])
      } as never,
      undefined,
      undefined,
      undefined,
      undefined
    );

    const request = service.requestMirrorSync("user-1", {
      workspaceId: "workspace-1",
      mirrorTypes: ["tags"]
    });

    const overview = service.getOverview("user-1", undefined, "workspace-1");
    expect(overview.binding.status).toBe("unbound");
    expect(overview.syncConfigs).toHaveLength(3);
    expect(overview.mirrorBindings).toHaveLength(1);
    expect(overview.latestMirrorSyncTask?.taskId).toBe(request.taskId);
  });

  it("本地变化只会在自动同步模式下入队并写入同步日志", async () => {
    const taskManager = createTaskManager();
    const syncLogRepo = createSyncLogRepository();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
      { id: "tbl_tags", name: "cn_tags" }
    ]), {
      status: 200,
      statusText: "OK"
    })));
    const getGlobalBinding = vi.fn(() => ({
      baseUrl: "https://teable.example.com",
      spaceId: "space-1",
      baseId: "base-1",
      authRef: "secret://teable/main",
      enabled: true,
      mirrorMode: "manual",
      updatedAt: "2026-06-05T08:00:00.000Z"
    }));
    const getConfigs = vi.fn(() => [
      { sourceType: "tags", enabled: true, scope: { rootTagIds: ["tag-root"] }, targetTableId: "tbl_tags", configId: "cfg-1", updatedAt: "2026-06-05T08:00:00.000Z" },
      { sourceType: "sessions", enabled: false, scope: { mode: "all_workspaces" }, targetTableId: "tbl_sessions", configId: "cfg-2", updatedAt: "2026-06-05T08:00:00.000Z" },
      { sourceType: "todos", enabled: false, scope: { mode: "all_workspaces" }, targetTableId: "tbl_todos", configId: "cfg-3", updatedAt: "2026-06-05T08:00:00.000Z" }
    ]);
    const service = new TeableMirrorSyncService(
      createBindingRepository() as never,
      createMappingRepository() as never,
      taskManager,
      {
        getOverview: vi.fn(),
        getGlobalBinding
      } as never,
      { loadToken: vi.fn(() => "token-123") } as never,
      { getConfigs } as never,
      {
        listGlobalTags: vi.fn(() => ({
          items: [
            {
              id: "tag-root",
              name: "根标签",
              path: "根标签",
              parentId: null,
              parentPath: null,
              rootType: "manual",
              status: "enabled",
              description: "",
              documentCount: 0,
              updatedAt: "2026-06-05T08:00:00.000Z"
            }
          ]
        }))
      } as never,
      { listSessions: vi.fn(async () => []) } as never,
      { list: vi.fn(() => []) } as never,
      { list: vi.fn(() => []) } as never,
      { list: vi.fn(() => []) } as never,
      { list: vi.fn(() => []), findById: vi.fn(() => null) } as never,
      { resolveMapping: vi.fn(() => ({ configId: "cfg-1", sourceType: "tags", targetTableId: "tbl_tags", items: [] })), applyMapping: vi.fn(() => ({})) } as never,
      syncLogRepo as never
    );

    expect(service.requestLocalChangeMirrorSync("user-1", { mirrorTypes: ["tags"], reason: "tag_definition_saved:tag-root" })).toBeNull();
    expect(syncLogRepo.records()).toHaveLength(0);

    getGlobalBinding.mockReturnValue({
      baseUrl: "https://teable.example.com",
      spaceId: "space-1",
      baseId: "base-1",
      authRef: "secret://teable/main",
      enabled: true,
      mirrorMode: "event_driven",
      updatedAt: "2026-06-05T08:00:00.000Z"
    });

    const request = service.requestLocalChangeMirrorSync("user-1", {
      mirrorTypes: ["tags"],
      reason: "tag_definition_saved:tag-root"
    });

    expect(request?.state).toBe("queued");
    expect(syncLogRepo.records()[0]?.triggerType).toBe("local_change");
    expect(syncLogRepo.records()[0]?.reason).toBe("tag_definition_saved:tag-root");
    await vi.waitFor(() => {
      expect(service.getMirrorSyncTaskSnapshot("user-1")?.state).toBe("succeeded");
    });
    expect(service.listSyncLogs("user-1")[0]?.state).toBe("succeeded");
  });
});
