import { describe, expect, it, vi } from "vitest";

import { TeableCatalogService } from "../../../src/modules/workspace/teable-catalog-service.js";
import type { TeableCredentialService } from "../../../src/modules/workspace/teable-credential-service.js";
import type { TeableGlobalBindingService } from "../../../src/modules/workspace/teable-global-binding-service.js";

describe("TeableCatalogService", () => {
  it("读取当前 Base 的表目录", async () => {
    const client = createMockTeableClient();
    const service = createCatalogService(client);

    const tables = await service.listTables("user-1");

    expect(client.listTables).toHaveBeenCalledWith("base-1");
    expect(tables).toEqual([{ tableId: "tbl-1", tableName: "客户表" }]);
  });

  it("读取指定表的字段目录", async () => {
    const client = createMockTeableClient();
    const service = createCatalogService(client);

    const fields = await service.listFields("user-1", "tbl-1");

    expect(client.listFields).toHaveBeenCalledWith("tbl-1");
    expect(fields).toEqual([{
      fieldId: "fld-1",
      fieldName: "标题",
      fieldType: "singleLineText",
      isPrimary: true
    }]);
  });

  it("自动创建缺失字段并返回可直接保存的映射", async () => {
    const client = createMockTeableClient();
    const service = createCatalogService(client);

    const fields = await service.createFields("user-1", "tbl-1", [
      { sourceField: "title", fieldName: "标题", fieldType: "singleLineText", required: true },
      { sourceField: "summary", fieldName: "摘要", fieldType: "longText" }
    ]);

    expect(client.createField).toHaveBeenCalledWith("tbl-1", { name: "摘要", type: "longText" });
    expect(fields).toEqual([
      { sourceField: "title", targetFieldId: "fld-1", targetFieldName: "标题", required: true, fieldType: "singleLineText" },
      { sourceField: "summary", targetFieldId: "fld-created", targetFieldName: "摘要", required: false, fieldType: "longText" }
    ]);
  });
});

function createCatalogService(client: ReturnType<typeof createMockTeableClient>) {
  return new TeableCatalogService(
    {
      getGlobalBinding: vi.fn(() => ({
        baseUrl: "http://teable.local",
        spaceId: "spc-1",
        baseId: "base-1",
        authRef: "main",
        enabled: true,
        mirrorMode: "manual",
        updatedAt: "2026-06-06T00:00:00.000Z"
      }))
    } as unknown as TeableGlobalBindingService,
    {
      loadToken: vi.fn(() => "teable-token")
    } as unknown as TeableCredentialService,
    "preview-secret",
    () => client as never
  );
}

function createMockTeableClient() {
  return {
    listTables: vi.fn(async () => [{ id: "tbl-1", name: "客户表" }]),
    listFields: vi.fn(async () => [{ id: "fld-1", name: "标题", type: "singleLineText", isPrimary: true }]),
    createField: vi.fn(async (_tableId: string, input: { name: string; type: string }) => ({
      id: "fld-created",
      name: input.name,
      type: input.type,
      isPrimary: false
    }))
  };
}
