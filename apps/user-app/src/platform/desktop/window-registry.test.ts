import { describe, expect, it, vi } from "vitest";

import { createWindowDescriptor } from "./window-descriptor";
import { createWindowRegistryStore } from "./window-registry";

function createDescriptor(windowId: string, kind: "chat" | "files" | "git" = "files") {
  return createWindowDescriptor({
    windowId,
    kind,
    workspaceId: "workspace-1",
    mode: "external"
  });
}

describe("window-registry", () => {
  it("默认状态为空，查询结果稳定", () => {
    const store = createWindowRegistryStore();

    expect(store.getState()).toEqual({
      descriptors: {},
      openWindowIds: [],
      lastActiveWindowId: null
    });
    expect(store.getDescriptor("missing-window")).toBeNull();
    expect(store.getWindows()).toEqual([]);
    expect(store.isWindowOpen("missing-window")).toBe(false);
  });

  it("支持注册 descriptor 并通过 windowId 查询", () => {
    const store = createWindowRegistryStore();
    const descriptor = createDescriptor("window-files-1");

    store.registerDescriptor(descriptor);

    expect(store.getDescriptor("window-files-1")).toEqual(descriptor);
    expect(store.getWindows()).toEqual([
      {
        descriptor,
        isOpen: false
      }
    ]);
  });

  it("同一个 windowId 重复注册时覆盖 descriptor，不产生重复项", () => {
    const store = createWindowRegistryStore();

    store.registerDescriptor(createDescriptor("window-shared", "files"));
    store.registerDescriptor(createDescriptor("window-shared", "git"));

    const windows = store.getWindows();

    expect(windows).toHaveLength(1);
    expect(windows[0]?.descriptor.kind).toBe("git");
    expect(windows[0]?.descriptor.windowId).toBe("window-shared");
  });

  it("支持 patch 更新 descriptor，并正确合并 bounds", () => {
    const store = createWindowRegistryStore();
    store.registerDescriptor(createDescriptor("window-chat-1", "chat"));

    const updated = store.updateDescriptor("window-chat-1", {
      mode: "floating",
      focusOwner: "window-chat-1",
      bounds: {
        width: 1600,
        minHeight: 520
      }
    });

    expect(updated).toEqual({
      ...createDescriptor("window-chat-1", "chat"),
      mode: "floating",
      focusOwner: "window-chat-1",
      bounds: {
        ...createDescriptor("window-chat-1", "chat").bounds,
        width: 1600,
        minHeight: 520
      }
    });

    expect(store.updateDescriptor("missing-window", { mode: "floating" })).toBeNull();
  });

  it("支持打开/关闭窗口并保持 open 列表去重", () => {
    const store = createWindowRegistryStore();
    const descriptor = createDescriptor("window-files-1");
    store.registerDescriptor(descriptor);

    expect(store.markWindowOpen("missing-window")).toBe(false);
    expect(store.markWindowOpen(descriptor.windowId)).toBe(true);
    expect(store.markWindowOpen(descriptor.windowId)).toBe(true);
    expect(store.getState().openWindowIds).toEqual([descriptor.windowId]);
    expect(store.getState().lastActiveWindowId).toBe(descriptor.windowId);

    expect(store.markWindowClosed(descriptor.windowId)).toBe(true);
    expect(store.markWindowClosed(descriptor.windowId)).toBe(false);
    expect(store.getState().openWindowIds).toEqual([]);
    expect(store.getState().lastActiveWindowId).toBeNull();
  });

  it("支持删除单个窗口与清空全部窗口", () => {
    const store = createWindowRegistryStore();
    store.registerDescriptor(createDescriptor("window-files-1"));
    store.registerDescriptor(createDescriptor("window-git-1", "git"));
    store.markWindowOpen("window-files-1");
    store.markWindowOpen("window-git-1");

    expect(store.removeWindow("window-files-1")).toBe(true);
    expect(store.removeWindow("window-files-1")).toBe(false);
    expect(store.getDescriptor("window-files-1")).toBeNull();
    expect(store.getState().openWindowIds).toEqual(["window-git-1"]);
    expect(store.getState().lastActiveWindowId).toBe("window-git-1");

    store.clear();
    expect(store.getState()).toEqual({
      descriptors: {},
      openWindowIds: [],
      lastActiveWindowId: null
    });
  });

  it("订阅者会在状态变更时收到通知", () => {
    const store = createWindowRegistryStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.registerDescriptor(createDescriptor("window-files-1"));
    store.markWindowOpen("window-files-1");
    store.markWindowClosed("window-files-1");

    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });
});
