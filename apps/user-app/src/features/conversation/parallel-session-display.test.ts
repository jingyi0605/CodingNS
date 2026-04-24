import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createParallelPaneStyle,
  consumeParallelGroupTransitionSignal,
  readParallelPaneColorOverride,
  resolveSessionIsolatedWorkspaceBranchName,
  shouldUseParallelConversationLayout,
  resolveSessionNavigationWorkspaceId,
  resolveSessionDisplayParentSessionId,
  writeParallelGroupTransitionSignal,
  writeParallelPaneColorOverride
} from "./parallel-session-display";

describe("parallel-session-display", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("展示树父节点优先使用 displayParentSessionId", () => {
    expect(
      resolveSessionDisplayParentSessionId({
        displayParentSessionId: "parallel-anchor",
        parentSessionId: "real-parent"
      })
    ).toBe("parallel-anchor");

    expect(
      resolveSessionDisplayParentSessionId({
        displayParentSessionId: "   ",
        parentSessionId: "real-parent"
      })
    ).toBe("real-parent");
  });

  it("只会消费一次有效的并行动画信号", () => {
    writeParallelGroupTransitionSignal("group-1");

    expect(consumeParallelGroupTransitionSignal("group-1")).toBe(true);
    expect(consumeParallelGroupTransitionSignal("group-1")).toBe(false);
  });

  it("过期的动画信号不会生效", () => {
    writeParallelGroupTransitionSignal("group-1");
    vi.advanceTimersByTime(2_401);

    expect(consumeParallelGroupTransitionSignal("group-1")).toBe(false);
  });

  it("sessionStorage 超配额时仍然可以正常消费并行动画信号", () => {
    const originalSessionStorage = window.sessionStorage;

    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(() => {
          throw new DOMException("Setting the value exceeded the quota.", "QuotaExceededError");
        }),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(() => null),
        length: 0
      } satisfies Storage
    });

    expect(() => writeParallelGroupTransitionSignal("group-1")).not.toThrow();
    expect(consumeParallelGroupTransitionSignal("group-1")).toBe(true);

    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: originalSessionStorage
    });
  });

  it("同一组并行 pane 默认会分配不同颜色", () => {
    const paneOneStyle = createParallelPaneStyle({
      groupId: "group-1",
      sessionId: "session-1",
      ordinal: 0
    });
    const paneTwoStyle = createParallelPaneStyle({
      groupId: "group-1",
      sessionId: "session-2",
      ordinal: 1
    });
    const paneThreeStyle = createParallelPaneStyle({
      groupId: "group-1",
      sessionId: "session-3",
      ordinal: 2
    });

    expect(paneOneStyle["--parallel-group-accent"]).not.toBe(paneTwoStyle["--parallel-group-accent"]);
    expect(paneTwoStyle["--parallel-group-accent"]).not.toBe(paneThreeStyle["--parallel-group-accent"]);
  });

  it("会记住每个 pane 的自定义色板", () => {
    expect(readParallelPaneColorOverride("session-1")).toBeNull();

    writeParallelPaneColorOverride("session-1", "#EC4899");
    expect(readParallelPaneColorOverride("session-1")).toBe("#EC4899");

    writeParallelPaneColorOverride("session-1", null);
    expect(readParallelPaneColorOverride("session-1")).toBeNull();
  });

  it("临时隔离工作区会优先使用源工作区作为导航入口", () => {
    expect(
      resolveSessionNavigationWorkspaceId(
        { workspaceId: "workspace-isolated" },
        {
          sourceWorkspaceId: "workspace-source",
          lifecycleStatus: "active"
        }
      )
    ).toBe("workspace-source");

    expect(
      resolveSessionNavigationWorkspaceId(
        { workspaceId: "workspace-promoted" },
        {
          sourceWorkspaceId: "workspace-source",
          lifecycleStatus: "promoted"
        }
      )
    ).toBe("workspace-promoted");
  });

  it("只在需要时返回隔离工作区分支名", () => {
    expect(
      resolveSessionIsolatedWorkspaceBranchName({
        branchName: " parallel/member "
      })
    ).toBe("parallel/member");

    expect(resolveSessionIsolatedWorkspaceBranchName(null)).toBeNull();
  });

  it("只有未升级成子工作区的并行会话才进入并行 pane 布局", () => {
    expect(
      shouldUseParallelConversationLayout({
        parallelGroup: {
          groupId: "parallel-group-1"
        },
        sessionIsolatedWorkspace: null
      } as Parameters<typeof shouldUseParallelConversationLayout>[0])
    ).toBe(true);

    expect(
      shouldUseParallelConversationLayout({
        parallelGroup: {
          groupId: "parallel-group-1"
        },
        sessionIsolatedWorkspace: {
          lifecycleStatus: "promoted"
        }
      } as Parameters<typeof shouldUseParallelConversationLayout>[0])
    ).toBe(false);

    expect(
      shouldUseParallelConversationLayout({
        parallelGroup: null,
        sessionIsolatedWorkspace: null
      } as Parameters<typeof shouldUseParallelConversationLayout>[0])
    ).toBe(false);
  });
});
