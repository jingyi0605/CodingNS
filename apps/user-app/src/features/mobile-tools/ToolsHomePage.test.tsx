import { describe, expect, it } from "vitest";

import {
  resolvePrimaryToolAfterSwipe,
  resolvePrimaryToolFromSearch
} from "./ToolsHomePage";

describe("ToolsHomePage", () => {
  it("默认优先使用 URL 指定的主工具，否则回退到持久化结果", () => {
    expect(resolvePrimaryToolFromSearch("files", "git")).toBe("files");
    expect(resolvePrimaryToolFromSearch("git", "files")).toBe("git");
    expect(resolvePrimaryToolFromSearch(null, "files")).toBe("files");
  });

  it("水平滑动会在文件和 Git 主工具之间切换", () => {
    expect(
      resolvePrimaryToolAfterSwipe("files", { x: 240, y: 80 }, { x: 120, y: 88 })
    ).toBe("git");
    expect(
      resolvePrimaryToolAfterSwipe("git", { x: 120, y: 88 }, { x: 240, y: 80 })
    ).toBe("files");
  });

  it("垂直手势或位移过小不应该切换主工具", () => {
    expect(
      resolvePrimaryToolAfterSwipe("files", { x: 240, y: 80 }, { x: 210, y: 84 })
    ).toBe("files");
    expect(
      resolvePrimaryToolAfterSwipe("files", { x: 240, y: 80 }, { x: 200, y: 160 })
    ).toBe("files");
    expect(resolvePrimaryToolAfterSwipe("files", null, { x: 120, y: 88 })).toBe("files");
  });
});
