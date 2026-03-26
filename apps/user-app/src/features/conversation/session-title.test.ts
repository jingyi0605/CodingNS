import { describe, expect, it } from "vitest";

import { buildSessionTitlePresentation } from "./session-title";

describe("buildSessionTitlePresentation", () => {
  it("会把多行标题压成单行", () => {
    expect(buildSessionTitlePresentation("  第一行\n\n第二行\t第三行  ", "继续对话")).toEqual({
      fullTitle: "第一行 第二行 第三行",
      displayTitle: "第一行 第二行 第三行"
    });
  });

  it("会把超长标题裁到统一长度", () => {
    const title = "终端管理页面点击加号以后终端实际上加载成功但是页面没有刷新出终端窗口刷新页面后终端才显示";
    const presentation = buildSessionTitlePresentation(title, "继续对话");

    expect(presentation.fullTitle).toBe(title);
    expect(presentation.displayTitle).toBe(title.slice(0, 48));
  });
});
