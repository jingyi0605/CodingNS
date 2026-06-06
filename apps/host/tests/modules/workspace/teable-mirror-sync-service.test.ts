import { describe, expect, it, vi } from "vitest";

import { TeableMirrorSyncService } from "../../../src/modules/workspace/teable-mirror-sync-service.js";
import type {
  UserTeableMirrorRecordMappingRecord,
  UserTeableMirrorTableBindingRecord
} from "../../../src/types/domain.js";

function createBindingRepository(records: UserTeableMirrorTableBindingRecord[] = []) {
  let current = [...records];
  return {
    listByUserId: vi.fn(() => current),
    findByUserIdAndMirrorType: vi.fn((userId: string, mirrorType: string) => current.find((item) => item.userId === userId && item.mirrorType === mirrorType) ?? null),
    upsert: vi.fn((record: UserTeableMirrorTableBindingRecord) => {
      current = current.filter((item) => !(item.userId === record.userId && item.mirrorType === record.mirrorType));
      current.push(record);
      return record;
    })
  };
}

function createMappingRepository(records: UserTeableMirrorRecordMappingRecord[] = []) {
  let current = [...records];
  return {
    listByUserIdAndMirrorType: vi.fn((userId: string, mirrorType: string) => current.filter((item) => item.userId === userId && item.mirrorType === mirrorType)),
    findByUserIdAndMirrorTypeAndLocalId: vi.fn((userId: string, mirrorType: string, localId: string) => current.find((item) => item.userId === userId && item.mirrorType === mirrorType && item.localId === localId) ?? null),
    upsert: vi.fn((record: UserTeableMirrorRecordMappingRecord) => {
      current = current.filter((item) => !(item.userId === record.userId && item.mirrorType === record.mirrorType && item.localId === record.localId));
      current.push(record);
      return record;
    })
  };
}

describe("TeableMirrorSyncService", () => {
  it("能保存并读取镜像表绑定", () => {
    const service = new TeableMirrorSyncService(
      createBindingRepository() as never,
      createMappingRepository() as never
    );

    const saved = service.saveMirrorTableBinding("user-1", {
      mirrorType: "tags",
      tableId: "tbl_tags",
      tableName: "cn_tags",
      readOnlyMode: "role_based"
    });

    expect(saved).toMatchObject({
      mirrorType: "tags",
      tableId: "tbl_tags",
      tableName: "cn_tags",
      readOnlyMode: "role_based"
    });
    expect(service.listMirrorTableBindings("user-1")).toHaveLength(1);
  });

  it("能保存并读取本地到 teable 的记录映射", () => {
    const service = new TeableMirrorSyncService(
      createBindingRepository() as never,
      createMappingRepository() as never
    );

    const saved = service.saveMirrorRecordMapping("user-1", {
      mirrorType: "sessions",
      localId: "session-1",
      teableRecordId: "rec_001",
      fingerprint: "sha256:abc"
    });

    expect(saved).toMatchObject({
      mirrorType: "sessions",
      localId: "session-1",
      teableRecordId: "rec_001",
      fingerprint: "sha256:abc",
      deletedAt: null
    });
    expect(service.listMirrorRecordMappings("user-1", "sessions")).toHaveLength(1);
  });

  it("会拒绝非法镜像类型", () => {
    const service = new TeableMirrorSyncService(
      createBindingRepository() as never,
      createMappingRepository() as never
    );

    expect(() => service.saveMirrorTableBinding("user-1", {
      mirrorType: "unknown" as any,
      tableId: "tbl_x",
      tableName: "cn_x"
    })).toThrowError(/mirrorType/);
  });

  it("会保留删除标记，支撑后续增量删除处理", () => {
    const service = new TeableMirrorSyncService(
      createBindingRepository() as never,
      createMappingRepository() as never
    );

    const saved = service.saveMirrorRecordMapping("user-1", {
      mirrorType: "todos",
      localId: "todo-1",
      teableRecordId: "rec_todo_1",
      fingerprint: "sha256:todo",
      deletedAt: "2026-06-05T04:00:00.000Z"
    });

    expect(saved.deletedAt).toBe("2026-06-05T04:00:00.000Z");
  });
});
