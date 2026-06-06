import { describe, expect, it, vi } from "vitest";

import { AppError } from "../../../src/shared/errors/app-error.js";
import { TeableRuntimeService } from "../../../src/modules/workspace/teable-runtime-service.js";
import type { TeableCredentialService } from "../../../src/modules/workspace/teable-credential-service.js";
import type { TeableGlobalBindingService } from "../../../src/modules/workspace/teable-global-binding-service.js";

function createService(client = createMockTeableClient()) {
  const service = new TeableRuntimeService(
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
    () => client as never
  );
  return { service, client };
}

describe("TeableRuntimeService", () => {
  it("读取表、视图、字段和记录时只返回前端需要的 DTO", async () => {
    const { service, client } = createService();

    await expect(service.listTables("user-1")).resolves.toEqual({
      tables: [{ tableId: "tbl-1", tableName: "客户表" }]
    });
    await expect(service.listViews("user-1", "tbl-1")).resolves.toEqual({
      views: [{
        viewId: "viw-1",
        viewName: "主表格",
        viewType: "grid",
        options: { density: "compact" },
        columnMeta: { fld_title: { width: 180 } },
        filter: undefined,
        orderBy: undefined,
        group: undefined
      }]
    });
    const fieldResult = await service.listFields("user-1", "tbl-1");
    expect(fieldResult.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldId: "fld_title", fieldName: "标题", fieldType: "singleLineText", isPrimary: true, recordCreate: true, recordUpdate: true }),
      expect.objectContaining({ fieldId: "fld_formula", fieldName: "得分", fieldType: "formula", isComputed: true, recordCreate: false, recordUpdate: false }),
      expect.objectContaining({ fieldId: "fld_link", fieldName: "客户", fieldType: "link", linkOptions: { foreignTableId: "tbl_customer", multiple: true } })
    ]));
    await expect(service.listRecords("user-1", "tbl-1", { viewId: "viw-1", take: 20, skip: 5, search: "客户" })).resolves.toEqual({
      records: [{ recordId: "rec-1", fields: { fld_title: "跟进 A", fld_formula: 12 } }],
      total: 1,
      skip: 5,
      take: 20
    });
    expect(client.listRecords).toHaveBeenLastCalledWith("tbl-1", {
      fieldKeyType: "id",
      cellFormat: "json",
      viewId: "viw-1",
      take: 20,
      skip: 5,
      search: "客户"
    });
  });

  it("创建和更新记录时使用字段 ID，并拒绝计算字段写入", async () => {
    const { service, client } = createService();

    await expect(service.createRecord("user-1", "tbl-1", {
      fields: { fld_title: "新客户" }
    })).resolves.toEqual({ record: { recordId: "rec-created", fields: { fld_title: "新客户" } } });
    expect(client.createRecords).toHaveBeenCalledWith("tbl-1", {
      fieldKeyType: "id",
      records: [{ fields: { fld_title: "新客户" } }]
    });

    await expect(service.updateRecord("user-1", "tbl-1", "rec-1", {
      fields: { fld_title: "已更新" }
    })).resolves.toEqual({ record: { recordId: "rec-1", fields: { fld_title: "已更新" } } });
    expect(client.updateRecords).toHaveBeenCalledWith("tbl-1", {
      fieldKeyType: "id",
      records: [{ id: "rec-1", fields: { fld_title: "已更新" } }]
    });

    await expect(service.updateRecord("user-1", "tbl-1", "rec-1", {
      fields: { fld_formula: 99 }
    })).rejects.toMatchObject({
      errorCode: "TEABLE_FIELD_NOT_WRITABLE",
      field: "fld_formula"
    } satisfies Partial<AppError>);
  });

  it("删除记录时要求 recordIds 非空", async () => {
    const { service, client } = createService();

    await expect(service.deleteRecords("user-1", "tbl-1", ["rec-1", "rec-2"])).resolves.toEqual({
      deletedRecordIds: ["rec-1", "rec-2"]
    });
    expect(client.deleteRecords).toHaveBeenCalledWith("tbl-1", ["rec-1", "rec-2"]);

    await expect(service.deleteRecords("user-1", "tbl-1", [])).rejects.toMatchObject({
      errorCode: "INVALID_INPUT",
      field: "recordIds"
    } satisfies Partial<AppError>);
  });

  it("读取关联字段候选记录，显示关联表主字段", async () => {
    const { service, client } = createService();

    await expect(service.listLinkedRecordOptions("user-1", "tbl-1", "fld_link", {
      search: "张",
      take: 10,
      skip: 0
    })).resolves.toEqual({
      options: [{ recordId: "cust-1", title: "张三", subtitle: undefined }],
      skip: 0,
      take: 10,
      hasMore: false
    });
    expect(client.listRecords).toHaveBeenLastCalledWith("tbl_customer", {
      fieldKeyType: "id",
      cellFormat: "json",
      take: 10,
      skip: 0,
      search: "张"
    });
  });

  it("关联字段缺少关联表配置时给明确错误", async () => {
    const { service, client } = createService();
    client.listFields.mockResolvedValueOnce([{ id: "fld_bad_link", name: "坏关联", type: "link", options: {} }]);

    await expect(service.listLinkedRecordOptions("user-1", "tbl-1", "fld_bad_link")).rejects.toMatchObject({
      errorCode: "TEABLE_LINK_FIELD_REQUIRED",
      field: "fieldId"
    } satisfies Partial<AppError>);
  });
});

function createMockTeableClient() {
  return {
    listTables: vi.fn(async () => [{ id: "tbl-1", name: "客户表" }]),
    listViews: vi.fn(async () => [{
      id: "viw-1",
      name: "主表格",
      type: "grid",
      options: { density: "compact" },
      columnMeta: { fld_title: { width: 180 } }
    }]),
    listFields: vi.fn(async (tableId: string) => {
      if (tableId === "tbl_customer") {
        return [
          { id: "fld_customer_name", name: "客户名", type: "singleLineText", isPrimary: true }
        ];
      }
      return [
        { id: "fld_title", name: "标题", type: "singleLineText", isPrimary: true },
        { id: "fld_formula", name: "得分", type: "formula" },
        { id: "fld_lookup", name: "查找", type: "lookup" },
        { id: "fld_link", name: "客户", type: "link", options: { foreignTableId: "tbl_customer", multiple: true } }
      ];
    }),
    listRecords: vi.fn(async (tableId: string) => {
      if (tableId === "tbl_customer") {
        return { records: [{ id: "cust-1", fields: { fld_customer_name: "张三" } }], total: 1 };
      }
      return { records: [{ id: "rec-1", fields: { fld_title: "跟进 A", fld_formula: 12 } }], total: 1 };
    }),
    createRecords: vi.fn(async (_tableId: string, input: { records: Array<{ fields: Record<string, unknown> }> }) => ({
      records: [{ id: "rec-created", fields: input.records[0].fields }]
    })),
    updateRecords: vi.fn(async (_tableId: string, input: { records: Array<{ id: string; fields: Record<string, unknown> }> }) => ([
      { id: input.records[0].id, fields: input.records[0].fields }
    ])),
    deleteRecords: vi.fn(async () => undefined)
  };
}
