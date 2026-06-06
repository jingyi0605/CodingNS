import { describe, expect, it } from "vitest";

import type { TeableRuntimeFieldDto } from "../api/teable-runtime-api";
import { extractSelectOptions, resolveTeableCellDisplay } from "./teable-field-utils";

function createField(input: Partial<TeableRuntimeFieldDto>): TeableRuntimeFieldDto {
  return {
    fieldId: "fld_test",
    fieldName: "测试字段",
    fieldType: "singleLineText",
    isPrimary: false,
    isComputed: false,
    isLookup: false,
    isMultipleCellValue: false,
    recordRead: true,
    recordCreate: true,
    recordUpdate: true,
    options: {},
    linkOptions: null,
    ...input
  };
}

describe("teable-field-utils", () => {
  it("下拉选项会稳定解析成彩色标签需要的数据", () => {
    const field = createField({
      fieldType: "singleSelect",
      options: {
        choices: [
          { id: "todo", name: "未开始", color: "red" },
          { id: "doing", name: "进行中", color: "orange" },
          { id: "done", name: "已完成", color: "green" }
        ]
      }
    });

    expect(extractSelectOptions(field)).toEqual([
      { value: "todo", label: "未开始", tone: "red" },
      { value: "doing", label: "进行中", tone: "orange" },
      { value: "done", label: "已完成", tone: "green" }
    ]);
  });

  it("多选值会渲染成多个标签，而不是塞成一段纯文本", () => {
    const field = createField({
      fieldType: "multipleSelect",
      isMultipleCellValue: true,
      options: {
        choices: ["华东区", "华南区"]
      }
    });

    const display = resolveTeableCellDisplay(field, ["华东区", "华南区"]);

    expect(display.kind).toBe("select");
    expect(display.text).toBe("华东区、华南区");
    expect(display.tokens).toHaveLength(2);
    expect(display.tokens.map((token) => token.label)).toEqual(["华东区", "华南区"]);
  });

  it("数字字段保留数字类型，方便表格右对齐", () => {
    const field = createField({ fieldType: "number" });

    expect(resolveTeableCellDisplay(field, 10000)).toMatchObject({
      kind: "number",
      text: "10000",
      tokens: []
    });
  });
});
