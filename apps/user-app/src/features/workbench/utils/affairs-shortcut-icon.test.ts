import { describe, expect, it } from "vitest";

import { resolveShortcutAppSmartIcon } from "./affairs-shortcut-icon";

describe("affairs-shortcut-icon", () => {
  it("会优先用中文标题生成快捷应用图标文字", () => {
    const icon = resolveShortcutAppSmartIcon({
      title: "会员管理",
      entryPath: "tools/member/index.html",
      sourceKind: "workspace"
    });

    expect(icon.text).toBe("会员");
    expect(icon.style.background).toContain("linear-gradient");
  });

  it("标题为空时会从入口路径生成图标文字", () => {
    const icon = resolveShortcutAppSmartIcon({
      title: " ",
      entryPath: "tools/report-center/index.html",
      sourceKind: "workspace"
    });

    expect(icon.text).toBe("RC");
  });
});
