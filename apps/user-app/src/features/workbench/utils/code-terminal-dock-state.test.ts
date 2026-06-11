import { describe, expect, it } from "vitest";

import {
  createDefaultCodeTerminalDockState,
  normalizeCodeTerminalDockState
} from "./code-terminal-dock-state";

describe("code-terminal-dock-state", () => {
  it("会在坏快照时回退默认值", () => {
    const state = normalizeCodeTerminalDockState("workspace-1", {
      open: "bad",
      orientation: "diagonal",
      verticalRatio: 2,
      horizontalRatio: -1
    });

    expect(state.workspaceId).toBe("workspace-1");
    expect(state.open).toBe(false);
    expect(state.orientation).toBe("vertical");
    expect(state.verticalRatio).toBe(0.8);
    expect(state.horizontalRatio).toBe(0.2);
  });

  it("会保留合法比例和方向", () => {
    const state = normalizeCodeTerminalDockState("workspace-2", {
      open: true,
      lastManualClosed: true,
      orientation: "horizontal",
      verticalRatio: 0.28,
      horizontalRatio: 0.55,
      updatedAt: "2026-06-10T00:00:00.000Z"
    });

    expect(state).toMatchObject({
      workspaceId: "workspace-2",
      open: true,
      lastManualClosed: true,
      orientation: "horizontal",
      verticalRatio: 0.28,
      horizontalRatio: 0.55,
      updatedAt: "2026-06-10T00:00:00.000Z"
    });
  });


  it("会保留打开状态和合法更新时间", () => {
    const state = normalizeCodeTerminalDockState("workspace-4", {
      open: true,
      lastManualClosed: false,
      orientation: "vertical",
      verticalRatio: 0.2,
      horizontalRatio: 0.8,
      updatedAt: "2026-06-11T00:00:00.000Z"
    });

    expect(state.open).toBe(true);
    expect(state.lastManualClosed).toBe(false);
    expect(state.verticalRatio).toBe(0.2);
    expect(state.horizontalRatio).toBe(0.8);
    expect(state.updatedAt).toBe("2026-06-11T00:00:00.000Z");
  });

  it("会把越界比例夹回安全范围", () => {
    const state = normalizeCodeTerminalDockState("workspace-5", {
      open: true,
      orientation: "horizontal",
      verticalRatio: 0.01,
      horizontalRatio: 0.99
    });

    expect(state.verticalRatio).toBe(0.2);
    expect(state.horizontalRatio).toBe(0.8);
  });
  it("默认状态是关闭并使用上下布局", () => {
    const state = createDefaultCodeTerminalDockState("workspace-3");

    expect(state.workspaceId).toBe("workspace-3");
    expect(state.open).toBe(false);
    expect(state.lastManualClosed).toBe(false);
    expect(state.orientation).toBe("vertical");
  });
});
