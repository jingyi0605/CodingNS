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

  it("只要进入 expanded 宽屏就走桌面壳，medium 继续走移动壳", () => {
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

    expect(
      resolveWorkbenchShellMode({
        isDesktop: false,
        isWeb: false,
        viewportClass: "expanded"
      })
    ).toBe("desktop");
  });
});
