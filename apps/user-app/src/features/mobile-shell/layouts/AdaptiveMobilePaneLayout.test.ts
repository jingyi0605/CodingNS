import { describe, expect, it } from "vitest";

import {
  resolveAdaptiveMobilePaneLayout,
  shouldDockAuxiliaryPanel,
  shouldDockNavigationPanel
} from "./AdaptiveMobilePaneLayout";

describe("AdaptiveMobilePaneLayout", () => {
  it("compact 保持单栏，不停靠任何侧面板", () => {
    const mode = resolveAdaptiveMobilePaneLayout({
      viewportClass: "compact",
      activeEntry: "sessions",
      hasNavigationPanel: true,
      hasAuxiliaryPanel: true
    });

    expect(mode).toBe("compact");
    expect(shouldDockNavigationPanel(mode)).toBe(false);
    expect(shouldDockAuxiliaryPanel(mode)).toBe(false);
  });

  it("medium 会在会话页停靠导航面板，在终端入口页停靠辅助面板", () => {
    const sessionsMode = resolveAdaptiveMobilePaneLayout({
      viewportClass: "medium",
      activeEntry: "sessions",
      hasNavigationPanel: true,
      hasAuxiliaryPanel: true
    });
    const toolsMode = resolveAdaptiveMobilePaneLayout({
      viewportClass: "medium",
      activeEntry: "butler",
      hasNavigationPanel: true,
      hasAuxiliaryPanel: true
    });

    expect(sessionsMode).toBe("medium-navigation");
    expect(shouldDockNavigationPanel(sessionsMode)).toBe(true);
    expect(shouldDockAuxiliaryPanel(sessionsMode)).toBe(false);

    expect(toolsMode).toBe("medium-auxiliary");
    expect(shouldDockNavigationPanel(toolsMode)).toBe(false);
    expect(shouldDockAuxiliaryPanel(toolsMode)).toBe(true);
  });

  it("原生移动端竖屏即使是 medium，也强制保持单栏", () => {
    const mode = resolveAdaptiveMobilePaneLayout({
      viewportClass: "medium",
      activeEntry: "sessions",
      hasNavigationPanel: true,
      hasAuxiliaryPanel: true,
      preferCompactLayout: true
    });

    expect(mode).toBe("compact");
    expect(shouldDockNavigationPanel(mode)).toBe(false);
    expect(shouldDockAuxiliaryPanel(mode)).toBe(false);
  });

  it("expanded 允许前后双停靠，但不改移动端入口语义", () => {
    const mode = resolveAdaptiveMobilePaneLayout({
      viewportClass: "expanded",
      activeEntry: "settings",
      hasNavigationPanel: true,
      hasAuxiliaryPanel: true
    });

    expect(mode).toBe("expanded");
    expect(shouldDockNavigationPanel(mode)).toBe(true);
    expect(shouldDockAuxiliaryPanel(mode)).toBe(true);
  });
});
