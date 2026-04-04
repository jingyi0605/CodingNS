import { describe, expect, it } from "vitest";

import { createWindowBounds, createWindowDescriptor } from "./window-descriptor";

describe("window-descriptor", () => {
  it("createWindowBounds 会提供稳定默认值", () => {
    expect(createWindowBounds()).toEqual({
      x: null,
      y: null,
      width: 1200,
      height: 780,
      minWidth: 720,
      minHeight: 480
    });
  });

  it("createWindowBounds 会保留显式传入的边界字段", () => {
    expect(
      createWindowBounds({
        x: 100,
        y: 40,
        width: 980,
        minWidth: 640
      })
    ).toEqual({
      x: 100,
      y: 40,
      width: 980,
      height: 780,
      minWidth: 640,
      minHeight: 480
    });
  });

  it("createWindowDescriptor 默认填充最小窗口描述结构", () => {
    expect(
      createWindowDescriptor({
        windowId: "window-chat-1",
        kind: "chat"
      })
    ).toEqual({
      windowId: "window-chat-1",
      kind: "chat",
      workspaceId: null,
      sessionId: null,
      mode: "docked",
      bounds: {
        x: null,
        y: null,
        width: 1200,
        height: 780,
        minWidth: 720,
        minHeight: 480
      },
      focusOwner: null
    });
  });

  it("createWindowDescriptor 支持覆盖 mode 与上下文字段", () => {
    expect(
      createWindowDescriptor({
        windowId: "window-files-1",
        kind: "files",
        workspaceId: "workspace-1",
        sessionId: "session-1",
        mode: "external",
        bounds: {
          width: 1440,
          height: 900
        },
        focusOwner: "window-files-1"
      })
    ).toEqual({
      windowId: "window-files-1",
      kind: "files",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      mode: "external",
      bounds: {
        x: null,
        y: null,
        width: 1440,
        height: 900,
        minWidth: 720,
        minHeight: 480
      },
      focusOwner: "window-files-1"
    });
  });
});
