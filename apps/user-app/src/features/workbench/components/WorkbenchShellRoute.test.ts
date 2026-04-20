import { describe, expect, it } from "vitest";

import { resolveWorkbenchShellMode } from "./workbench-shell-mode";

describe("WorkbenchShellRoute", () => {
  it("desktop runtime 永远走桌面壳", () => {
    expect(
      resolveWorkbenchShellMode({
        isDesktop: true,
        viewportClass: "compact"
      })
    ).toBe("desktop");
  });

  it("只要进入 expanded 宽屏就走桌面壳，medium 继续走移动壳", () => {
    expect(
      resolveWorkbenchShellMode({
        isDesktop: false,
        viewportClass: "expanded"
      })
    ).toBe("desktop");

    expect(
      resolveWorkbenchShellMode({
        isDesktop: false,
        viewportClass: "medium"
      })
    ).toBe("mobile");

    expect(
      resolveWorkbenchShellMode({
        isDesktop: false,
        viewportClass: "expanded"
      })
    ).toBe("desktop");
  });
});
