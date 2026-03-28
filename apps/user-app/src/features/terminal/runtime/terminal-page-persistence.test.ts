import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  persistActiveTerminalId,
  persistPinnedTerminalIds,
  persistSelectedWorkspaceId,
  persistTerminalCursor,
  persistTerminalViewState,
  persistTerminalZoomScale,
  readPinnedTerminalIds,
  readPersistedActiveTerminalId,
  readPersistedTerminalCursor,
  readPersistedTerminalPageState,
  readPersistedTerminalZoomScale,
  readPersistedTerminalViewState,
  readTerminalRecoveryState
} from "./terminal-page-persistence";

describe("terminal page persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("会记住当前工作区、终端和最后一个输出游标", () => {
    persistSelectedWorkspaceId("workspace-1");
    persistActiveTerminalId("workspace-1", "terminal-1");
    persistPinnedTerminalIds("workspace-1", ["terminal-2", "terminal-1", "terminal-2"]);
    persistTerminalCursor("terminal-1", "cursor-9");
    persistTerminalZoomScale(1.2);

    expect(readPersistedTerminalPageState().selectedWorkspaceId).toBe("workspace-1");
    expect(readPersistedActiveTerminalId("workspace-1")).toBe("terminal-1");
    expect(readPinnedTerminalIds("workspace-1")).toEqual(["terminal-2", "terminal-1"]);
    expect(readPersistedTerminalCursor("terminal-1")).toBe("cursor-9");
    expect(readPersistedTerminalZoomScale()).toBe(1.2);
  });

  it("清空终端或游标时会移除旧记录", () => {
    persistActiveTerminalId("workspace-1", "terminal-1");
    persistTerminalCursor("terminal-1", "cursor-9");

    persistActiveTerminalId("workspace-1", null);
    persistTerminalCursor("terminal-1", null);

    expect(readPersistedActiveTerminalId("workspace-1")).toBeNull();
    expect(readPersistedTerminalCursor("terminal-1")).toBeNull();
  });

  it("会记住终端视图快照，便于刷新后恢复屏幕状态", () => {
    persistTerminalViewState("terminal-1", {
      content: "\u001b[?1049hhello",
      cursor: "cursor-10",
      cols: 120,
      rows: 30,
      viewportY: 18,
      historyBeforeSeq: 8,
      historyHasOlder: true
    });

    expect(readPersistedTerminalViewState("terminal-1")).toEqual({
      content: "\u001b[?1049hhello",
      cursor: "cursor-10",
      cols: 120,
      rows: 30,
      viewportY: 18,
      historyBeforeSeq: 8,
      historyHasOlder: true
    });

    persistTerminalViewState("terminal-1", null);
    expect(readPersistedTerminalViewState("terminal-1")).toBeNull();
  });

  it("旧标签页不会用较老的游标覆盖较新的恢复进度", () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(200);

    persistTerminalCursor("terminal-1", "12");
    persistTerminalCursor("terminal-1", "9");

    expect(readPersistedTerminalCursor("terminal-1")).toBe("12");
  });

  it("旧标签页不会用较老的终端快照覆盖较新的屏幕状态", () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(200);

    persistTerminalViewState("terminal-1", {
      content: "newer",
      cursor: "12",
      cols: 120,
      rows: 30,
      viewportY: 5,
      historyBeforeSeq: 10,
      historyHasOlder: true
    });
    persistTerminalViewState("terminal-1", {
      content: "older",
      cursor: "9",
      cols: 120,
      rows: 30,
      viewportY: 2,
      historyBeforeSeq: 4,
      historyHasOlder: true
    });

    expect(readPersistedTerminalViewState("terminal-1")?.content).toBe("newer");
    expect(readPersistedTerminalViewState("terminal-1")?.cursor).toBe("12");
  });

  it("当独立游标已经比快照更新时，会丢弃旧快照只保留补回游标", () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(200);

    persistTerminalViewState("terminal-1", {
      content: "stale-snapshot",
      cursor: "10",
      cols: 120,
      rows: 30,
      viewportY: 4,
      historyBeforeSeq: 3,
      historyHasOlder: true
    });
    persistTerminalCursor("terminal-1", "14");

    expect(readTerminalRecoveryState("terminal-1")).toEqual({
      resumeCursor: "14",
      viewState: null
    });
  });
});
