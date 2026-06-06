import { describe, expect, it, vi } from "vitest";

import { TeableMirrorSyncService } from "../../../src/modules/workspace/teable-mirror-sync-service.js";
import { TeableFieldMappingService } from "../../../src/modules/workspace/teable-field-mapping-service.js";
import { TeableApiClient } from "../../../src/modules/workspace/teable-api-client.js";
import type { AffairsLightweightSessionSummary } from "../../../src/modules/workspace/affairs-lightweight-session-service.js";

function createBindingRepository() {
  const bindings = new Map<string, any>();
  return {
    listByUserId: vi.fn((userId: string) => Array.from(bindings.values()).filter((item) => item.userId === userId)),
    findByUserIdAndMirrorType: vi.fn((userId: string, mirrorType: string) => bindings.get(`${userId}:${mirrorType}`) ?? null),
    upsert: vi.fn((record: any) => {
      bindings.set(`${record.userId}:${record.mirrorType}`, record);
      return record;
    })
  };
}

function createMappingRepository(initial: any[] = []) {
  let current = [...initial];
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

function createSession(title: string, sessionId: string): AffairsLightweightSessionSummary {
  return {
    sessionId,
    workspaceId: "workspace-1",
    provider: "codex",
    providerSessionId: `provider:${sessionId}`,
    rawStoreRef: `ref:${sessionId}`,
    title,
    messageCount: 3,
    lastMessageAt: "2026-06-05T06:00:00.000Z",
    createdAt: "2026-06-05T05:00:00.000Z",
    updatedAt: "2026-06-05T06:00:00.000Z",
    syncStatus: null,
    syncCursor: null,
    lastSyncAt: null,
    lastErrorCode: null,
    lastErrorDetail: null,
    resumedAt: null,
    runningState: "completed",
    activitySource: "runtime",
    lastEventAt: "2026-06-05T06:00:00.000Z",
    completedAt: "2026-06-05T06:00:00.000Z",
    lastSeenAt: "2026-06-05T06:00:00.000Z",
    activityState: "idle"
  };
}

describe("TeableMirrorSyncService runMirrorSync", () => {
  it("同步写入使用 Teable 字段 ID，字段改名后不会继续查旧字段名", async () => {
    const bindingRepository = createBindingRepository();
    const mappingRepository = createMappingRepository();
    const fieldMappingService = new TeableFieldMappingService({} as never, {} as never);
    const createRecords = vi
      .spyOn(TeableApiClient.prototype, "createRecords")
      .mockResolvedValueOnce({ records: [{ id: "rec_tag_1", fields: {} }] });

    const service = new TeableMirrorSyncService(
      bindingRepository as never,
      mappingRepository as never,
      {
        getGlobalBinding: vi.fn(() => ({
          baseUrl: "https://teable.example.com",
          spaceId: "space-1",
          baseId: "base-1",
          authRef: "secret://teable/main",
          enabled: true,
          mirrorMode: "manual",
          updatedAt: "2026-06-05T06:00:00.000Z"
        }))
      } as never,
      {
        loadToken: vi.fn(() => "token-123")
      } as never,
      {
        getConfigs: vi.fn(() => [{
          configId: "cfg-tags",
          sourceType: "tags",
          enabled: true,
          targetTableId: "tbl_tags",
          scope: { rootTagIds: ["tag-1"] },
          updatedAt: "2026-06-05T06:00:00.000Z"
        }])
      } as never,
      {
        listGlobalTags: vi.fn((_userId: string) => ({
          items: [{
            id: "tag-1",
            path: "客户/重点",
            name: "重点",
            rootType: "客户",
            parentId: null,
            parentPath: null,
            description: "重点客户",
            status: "active",
            documentCount: 3,
            createdAt: "2026-06-05T05:00:00.000Z",
            updatedAt: "2026-06-05T06:00:00.000Z",
            disabledAt: null
          }]
        }))
      } as never,
      {
        listSessions: vi.fn(async () => [])
      } as never,
      { list: vi.fn(() => []) } as never,
      { list: vi.fn(() => []) } as never,
      { list: vi.fn(() => []) } as never,
      {
        list: vi.fn(() => []),
        findById: vi.fn(() => null)
      } as never,
      {
        resolveMapping: vi.fn(() => ({
          mappingId: "mapping-tags",
          configId: "cfg-tags",
          sourceType: "tags",
          targetTableId: "tbl_tags",
          updatedAt: "2026-06-05T06:00:00.000Z",
          items: [{
            sourceField: "name",
            targetFieldId: "fld_customer_name",
            targetFieldName: "标签名称",
            required: true
          }]
        })),
        applyMapping: fieldMappingService.applyMapping.bind(fieldMappingService)
      } as never
    );

    (service as any).ensureMirrorTable = vi.fn(async () => {
      return { mirrorType: "tags", tableId: "tbl_tags", tableName: "cn_tags", readOnlyMode: "unknown", lastSyncedAt: null, updatedAt: "2026-06-05T06:00:00.000Z" };
    });

    const result = await service.runMirrorSync("user-1", {
      workspaceId: "workspace-1",
      mirrorTypes: ["tags"]
    });

    expect(result.state).toBe("succeeded");
    expect(createRecords).toHaveBeenCalledWith("tbl_tags", {
      fieldKeyType: "id",
      records: [{
        fields: {
          fld_customer_name: "重点"
        }
      }]
    });
    expect(createRecords.mock.calls[0]?.[1].records[0]?.fields).not.toHaveProperty("标签名称");

    createRecords.mockRestore();
  });

  it("会把已绑定目标表的镜像数据写入 Teable", async () => {
    const bindingRepository = createBindingRepository();
    const mappingRepository = createMappingRepository();
    const createRecords = vi.fn(async () => ({ records: [{ id: "rec_tag_1", fields: {} }] }));
    const workspaceRepository = {
      list: vi.fn(() => [{
        id: "workspace-1",
        name: "工作区一",
        path: "/workspace-1",
        repoRoot: null
      }]),
      findById: vi.fn((workspaceId: string) => workspaceId === "workspace-1" ? {
        id: "workspace-1",
        name: "工作区一",
        path: "/workspace-1",
        repoRoot: null
      } : null)
    };
    const fieldMappingService = {
      resolveMapping: vi.fn(() => ({
        mappingId: "mapping-tags",
        configId: "cfg-tags",
        sourceType: "tags",
        targetTableId: "tbl_tags",
        updatedAt: "2026-06-05T06:00:00.000Z",
        items: [{
          sourceField: "name",
          targetFieldId: "fld_name",
          targetFieldName: "名称",
          required: true
        }]
      })),
      applyMapping: vi.fn((_mapping, payload: Record<string, unknown>) => ({
        名称: payload.name
      }))
    };

    const service = new TeableMirrorSyncService(
      bindingRepository as never,
      mappingRepository as never,
      {
        getGlobalBinding: vi.fn(() => ({
          baseUrl: "https://teable.example.com",
          spaceId: "space-1",
          baseId: "base-1",
          authRef: "secret://teable/main",
          enabled: true,
          mirrorMode: "manual",
          updatedAt: "2026-06-05T06:00:00.000Z"
        }))
      } as never,
      {
        loadToken: vi.fn(() => "token-123")
      } as never,
      {
        getConfigs: vi.fn(() => [{
          configId: "cfg-tags",
          sourceType: "tags",
          enabled: true,
          targetTableId: "tbl_tags",
          scope: { rootTagIds: ["tag-1"] },
          updatedAt: "2026-06-05T06:00:00.000Z"
        }])
      } as never,
      {
        listGlobalTags: vi.fn((_userId: string) => ({
          items: [{
            id: "tag-1",
            path: "客户/重点",
            name: "重点",
            rootType: "客户",
            parentId: null,
            parentPath: null,
            description: "重点客户",
            status: "active",
            documentCount: 3,
            createdAt: "2026-06-05T05:00:00.000Z",
            updatedAt: "2026-06-05T06:00:00.000Z",
            disabledAt: null
          }]
        }))
      } as never,
      {
        listSessions: vi.fn(async () => [])
      } as never,
      { list: vi.fn(() => []) } as never,
      { list: vi.fn(() => []) } as never,
      { list: vi.fn(() => []) } as never,
      workspaceRepository as never,
      fieldMappingService as never
    );

    (service as any).ensureMirrorTable = vi.fn(async () => {
      return { mirrorType: "tags", tableId: "tbl_tags", tableName: "cn_tags", readOnlyMode: "unknown", lastSyncedAt: null, updatedAt: "2026-06-05T06:00:00.000Z" };
    });
    (service as any).syncMirrorRecords = vi.fn(async () => {
      await createRecords();
      return { created: 1, updated: 0, deleted: 0, skipped: 0 };
    });

    const result = await service.runMirrorSync("user-1", {
      workspaceId: "workspace-1",
      mirrorTypes: ["tags"]
    });

    expect(result.state).toBe("succeeded");
    expect(result.syncedMirrorTypes).toEqual(["tags"]);
    expect(result.counts.tags.created).toBe(1);
  });

  it("部分镜像类型失败时会返回 partial_failed", async () => {
    const workspaceRepository = {
      list: vi.fn(() => [{
        id: "workspace-1",
        name: "工作区一",
        path: "/workspace-1",
        repoRoot: null
      }]),
      findById: vi.fn((workspaceId: string) => workspaceId === "workspace-1" ? {
        id: "workspace-1",
        name: "工作区一",
        path: "/workspace-1",
        repoRoot: null
      } : null)
    };
    const fieldMappingService = {
      resolveMapping: vi.fn((_userId: string, configId: string) => ({
        mappingId: `mapping-${configId}`,
        configId,
        sourceType: configId === "cfg-tags" ? "tags" : "sessions",
        targetTableId: configId === "cfg-tags" ? "tbl_tags" : "tbl_sessions",
        updatedAt: "2026-06-05T06:00:00.000Z",
        items: [{
          sourceField: "title",
          targetFieldId: "fld_title",
          targetFieldName: "标题",
          required: true
        }]
      })),
      applyMapping: vi.fn((_mapping, payload: Record<string, unknown>) => ({
        标题: payload.title
      }))
    };
    const service = new TeableMirrorSyncService(
      createBindingRepository() as never,
      createMappingRepository() as never,
      {
        getGlobalBinding: vi.fn(() => ({
          baseUrl: "https://teable.example.com",
          spaceId: "space-1",
          baseId: "base-1",
          authRef: "secret://teable/main",
          enabled: true,
          mirrorMode: "manual",
          updatedAt: "2026-06-05T06:00:00.000Z"
        }))
      } as never,
      {
        loadToken: vi.fn(() => "token-123")
      } as never,
      {
        getConfigs: vi.fn(() => [
          {
            configId: "cfg-tags",
            sourceType: "tags",
            enabled: true,
            targetTableId: "tbl_tags",
            scope: { rootTagIds: ["tag-1"] },
            updatedAt: "2026-06-05T06:00:00.000Z"
          },
          {
            configId: "cfg-sessions",
            sourceType: "sessions",
            enabled: true,
            targetTableId: "tbl_sessions",
            scope: { mode: "all_workspaces" },
            updatedAt: "2026-06-05T06:00:00.000Z"
          }
        ])
      } as never,
      { listGlobalTags: vi.fn(() => ({ items: [] })) } as never,
      { listSessions: vi.fn(async () => [createSession("会话A", "session-1")]) } as never,
      { list: vi.fn(() => []) } as never,
      { list: vi.fn(() => []) } as never,
      { list: vi.fn(() => []) } as never,
      workspaceRepository as never,
      fieldMappingService as never
    );

    (service as any).ensureMirrorTable = vi.fn(async (_client: unknown, _userId: string, _baseId: string, config: { sourceType: string }) => {
      if (config.sourceType === "tags") {
        throw new Error("建表失败");
      }
      return { mirrorType: "sessions", tableId: "tbl_sessions", tableName: "cn_sessions", readOnlyMode: "unknown", lastSyncedAt: null, updatedAt: "2026-06-05T06:00:00.000Z" };
    });
    (service as any).syncMirrorRecords = vi.fn(async () => ({ created: 1, updated: 0, deleted: 0, skipped: 0 }));

    const result = await service.runMirrorSync("user-1", {
      workspaceId: "workspace-1",
      mirrorTypes: ["tags", "sessions"]
    });

    expect(result.state).toBe("partial_failed");
    expect(result.syncedMirrorTypes).toEqual(["sessions"]);
    expect(result.failedMirrorTypes).toHaveLength(1);
    expect(result.failedMirrorTypes[0].mirrorType).toBe("tags");
  });
});
