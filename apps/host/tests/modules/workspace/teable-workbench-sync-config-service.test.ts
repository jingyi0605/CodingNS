import { describe, expect, it, vi } from "vitest";

import { TeableWorkbenchSyncConfigService } from "../../../src/modules/workspace/teable-workbench-sync-config-service.js";
import type { UserTeableWorkbenchSyncConfigRecord } from "../../../src/types/domain.js";

function createRepository(records: UserTeableWorkbenchSyncConfigRecord[] = []) {
  let current = [...records];
  return {
    listByUserId: vi.fn(() => current),
    replaceAllForUser: vi.fn((_userId: string, next: UserTeableWorkbenchSyncConfigRecord[]) => {
      current = [...next];
      return current;
    })
  };
}

describe("TeableWorkbenchSyncConfigService", () => {
  it("首次读取会补出三类默认配置，且默认都不推送", () => {
    const service = new TeableWorkbenchSyncConfigService(createRepository() as never);

    const configs = service.getConfigs("user-1");

    expect(configs.map((item) => item.sourceType)).toEqual(["tags", "sessions", "todos"]);
    expect(configs.every((item) => item.enabled === false)).toBe(true);
  });

  it("能保存部分更新，并保留未提交类型", () => {
    const service = new TeableWorkbenchSyncConfigService(createRepository() as never);

    const saved = service.saveConfigs("user-1", [
      {
        sourceType: "tags",
        enabled: true,
        scope: { mode: "manual_selection", includePaths: ["/客户/重点"] },
        targetTableId: "tbl_tags"
      }
    ]);

    expect(saved).toHaveLength(3);
    expect(saved.find((item) => item.sourceType === "tags")).toMatchObject({
      enabled: true,
      targetTableId: "tbl_tags",
      scope: { mode: "manual_selection", includePaths: ["/客户/重点"] }
    });
    expect(saved.find((item) => item.sourceType === "sessions")).toMatchObject({
      enabled: false,
      targetTableId: null
    });
  });

  it("会拒绝空提交", () => {
    const service = new TeableWorkbenchSyncConfigService(createRepository() as never);
    expect(() => service.saveConfigs("user-1", [])).toThrowError(/至少要提交一条/);
  });

  it("会拒绝重复 sourceType", () => {
    const service = new TeableWorkbenchSyncConfigService(createRepository() as never);
    expect(() => service.saveConfigs("user-1", [
      { sourceType: "tags", enabled: true },
      { sourceType: "tags", enabled: false }
    ])).toThrowError(/重复提交/);
  });
});
