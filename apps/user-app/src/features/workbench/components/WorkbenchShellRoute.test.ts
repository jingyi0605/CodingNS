import { describe, expect, it } from "vitest";

import { resolveWorkbenchShellMode } from "./WorkbenchShellRoute";

describe("WorkbenchShellRoute", () => {
  it("desktop runtime 永远走桌面壳", () => {
    expect(
      resolveWorkbenchShellMode({
        isDesktop: true,
        isWeb: false,
        viewportClass: "compact"
      })
    ).toBe("desktop");
  });

  it("web expanded 走桌面壳，web medium 改走移动壳", () => {
    expect(
      resolveWorkbenchShellMode({
        isDesktop: false,
        isWeb: true,
        viewportClass: "expanded"
      })
    ).toBe("desktop");

    expect(
      resolveWorkbenchShellMode({
        isDesktop: false,
        isWeb: true,
        viewportClass: "medium"
      })
    ).toBe("mobile");
  });

  it("原生移动 runtime 即使更宽也保留移动壳", () => {
    expect(
      resolveWorkbenchShellMode({
        isDesktop: false,
        isWeb: false,
        viewportClass: "expanded"
      })
    ).toBe("mobile");
  });
});
