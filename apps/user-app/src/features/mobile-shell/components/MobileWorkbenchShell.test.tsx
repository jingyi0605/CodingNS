import type { ReactNode } from "react";

import { act, fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformProvider } from "../../../platform/platform-provider";
import { MobileWorkbenchShell } from "./MobileWorkbenchShell";

class MockVisualViewport extends EventTarget {
  height: number;
  offsetTop: number;

  constructor(height: number, offsetTop = 0) {
    super();
    this.height = height;
    this.offsetTop = offsetTop;
  }
}

const originalVisualViewport = window.visualViewport;
const originalInnerWidth = window.innerWidth;
const originalInnerHeight = window.innerHeight;

describe("MobileWorkbenchShell", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 844
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: originalInnerWidth
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: originalInnerHeight
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: originalVisualViewport
    });

    delete document.documentElement.dataset.mobileKeyboardOpen;
    delete document.documentElement.dataset.mobileViewportBound;
    document.documentElement.style.removeProperty("--mobile-shell-viewport-height");
    document.documentElement.style.removeProperty("--mobile-shell-keyboard-inset");

    delete document.body.dataset.mobileKeyboardOpen;
    delete document.body.dataset.mobileViewportBound;
    document.body.style.removeProperty("--mobile-shell-viewport-height");
    document.body.style.removeProperty("--mobile-shell-keyboard-inset");

    window.localStorage.removeItem("mobile.conversation.quick-nav.position");
    window.localStorage.removeItem("mobile.tools.last-primary-tool");

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("H5 移动壳会同步真实视口高度，并在键盘弹起时收起底部导航", async () => {
    const visualViewport = new MockVisualViewport(844);
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport
    });

    const user = userEvent.setup();
    const view = renderMobileShell();
    const shell = view.container.querySelector(".mobile-workbench-shell");
    const tabbar = view.container.querySelector(".mobile-workbench-tabbar");
    const textbox = view.getByRole("textbox", { name: "消息输入框" });

    expect(shell).toHaveAttribute("data-mobile-runtime", "web");
    expect(tabbar).not.toHaveAttribute("hidden");

    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue("--mobile-shell-viewport-height")
      ).toBe("844px");
    });

    await user.click(textbox);

    act(() => {
      visualViewport.height = 520;
      visualViewport.dispatchEvent(new Event("resize"));
    });

    await waitFor(() => {
      expect(shell).toHaveAttribute("data-mobile-keyboard-open", "true");
      expect(tabbar).toHaveAttribute("hidden");
      expect(document.documentElement.dataset.mobileKeyboardOpen).toBe("true");
      expect(document.documentElement.style.getPropertyValue("--mobile-shell-keyboard-inset")).toBe(
        "324px"
      );
    });

    act(() => {
      (textbox as HTMLTextAreaElement).blur();
      visualViewport.height = 844;
      visualViewport.dispatchEvent(new Event("resize"));
    });

    await waitFor(() => {
      expect(shell).toHaveAttribute("data-mobile-keyboard-open", "false");
      expect(tabbar).not.toHaveAttribute("hidden");
      expect(document.documentElement.dataset.mobileKeyboardOpen).toBe("false");
    });
  });

  it("卸载 H5 移动壳后会清理根节点上的视口状态", async () => {
    const visualViewport = new MockVisualViewport(780);
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport
    });

    const view = renderMobileShell();

    await waitFor(() => {
      expect(document.documentElement.dataset.mobileViewportBound).toBe("true");
    });

    view.unmount();

    expect(document.documentElement.dataset.mobileViewportBound).toBeUndefined();
    expect(document.documentElement.dataset.mobileKeyboardOpen).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--mobile-shell-viewport-height")).toBe(
      ""
    );
    expect(document.documentElement.style.getPropertyValue("--mobile-shell-keyboard-inset")).toBe(
      ""
    );
  });

  it("medium 宽度会把会话导航停靠到主内容旁边，而不是继续依赖抽屉", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 820
    });

    const view = renderMobileShell({
      navigationPanel: <div>导航面板</div>,
      auxiliaryPanel: <div>辅助面板</div>
    });

    expect(view.container.querySelector(".mobile-adaptive-pane-panel-navigation")).toBeInTheDocument();
    expect(view.container.querySelector(".mobile-adaptive-pane-panel-auxiliary")).not.toBeInTheDocument();
    expect(view.container.querySelector(".mobile-workbench-shell")).toHaveAttribute(
      "data-pane-layout",
      "medium-navigation"
    );
    expect(view.container.querySelector(".mobile-workbench-header")).not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: "打开工作台菜单" })).not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: "打开工具面板" })).not.toBeInTheDocument();
  });

  it("底部导航会显示工作区、终端、对话、工具、设置五个一级入口", () => {
    const view = renderMobileShell({
      activeEntry: "terminals"
    });

    const tabbarItems = Array.from(view.container.querySelectorAll(".mobile-workbench-tabbar-item"));
    expect(tabbarItems).toHaveLength(5);
    expect(tabbarItems.map((item) => item.textContent?.trim())).toEqual([
      "工作区",
      "对话",
      "终端",
      "工具",
      "设置"
    ]);
  });

  it("会话沉浸态会先显示底部导航，并在 3 秒后自动收起", () => {
    vi.useFakeTimers();

    const view = renderMobileShell({
      presentation: "conversation-focus",
      navigationPanel: <div>导航面板</div>,
      childVariant: "conversation"
    });
    const shell = view.container.querySelector(".mobile-workbench-shell");

    expect(view.container.querySelector(".mobile-workbench-header")).not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: "显示会话列表" })).not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: "更多操作" })).not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: "打开快捷导航" })).not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: "打开搜索" })).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: "工作区" })).toBeInTheDocument();
    expect(shell).toHaveAttribute("data-conversation-tabbar-state", "visible");

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(shell).toHaveAttribute("data-conversation-tabbar-state", "hidden");
  });

  it("聊天记录到底后再次向上滑动会把底部导航拽出来", () => {
    vi.useFakeTimers();
    const view = renderMobileShell({
      presentation: "conversation-focus",
      childVariant: "conversation"
    });
    const shell = view.container.querySelector(".mobile-workbench-shell");
    const messageList = view.container.querySelector(".message-list") as HTMLDivElement | null;

    expect(messageList).not.toBeNull();

    Object.defineProperty(messageList, "scrollHeight", {
      configurable: true,
      value: 1600
    });
    Object.defineProperty(messageList, "clientHeight", {
      configurable: true,
      value: 600
    });
    Object.defineProperty(messageList, "scrollTop", {
      configurable: true,
      writable: true,
      value: 1000
    });

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(shell).toHaveAttribute("data-conversation-tabbar-state", "hidden");

    fireEvent.touchStart(messageList!, {
      touches: [{ clientY: 620 }]
    });
    fireEvent.touchMove(messageList!, {
      touches: [{ clientY: 560 }]
    });
    expect(shell).toHaveAttribute("data-conversation-tabbar-state", "dragging");

    fireEvent.touchEnd(messageList!, {
      changedTouches: [{ clientY: 560 }]
    });

    expect(shell).toHaveAttribute("data-conversation-tabbar-state", "visible");

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(shell).toHaveAttribute("data-conversation-tabbar-state", "hidden");
  });

  it("工具主页不再渲染外层标题栏，避免和页面内头部重复", () => {
    const view = renderMobileShell({
      activeEntry: "tools",
      route: "/workspaces/workspace-1/tools?tab=git"
    });

    expect(view.container.querySelector(".mobile-workbench-header")).not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: "更多操作" })).not.toBeInTheDocument();
  });

  it("进程管理页会显示返回按钮，并返回最近的主工具页", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("mobile.tools.last-primary-tool", "git");

    const view = renderMobileShell({
      activeEntry: "tools",
      initialEntries: [
        "/workspaces/workspace-1/tools?tab=git",
        "/workspaces/workspace-1/tools/processes"
      ],
      initialIndex: 1
    });

    expect(view.getByRole("heading", { name: "进程管理" })).toBeInTheDocument();

    await user.click(view.getByRole("button", { name: "返回" }));

    await waitFor(() => {
      expect(view.container.querySelector(".mobile-workbench-header")).not.toBeInTheDocument();
      expect(view.getByTestId("mobile-location")).toHaveTextContent("/workspaces/workspace-1/tools");
    });
  });
});

function renderMobileShell(options?: {
  activeEntry?: "workspaces" | "terminals" | "sessions" | "tools" | "settings";
  navigationPanel?: ReactNode;
  auxiliaryPanel?: ReactNode;
  presentation?: "default" | "conversation-focus";
  childVariant?: "workbench" | "conversation";
  route?: string;
  initialEntries?: string[];
  initialIndex?: number;
  onNavigateToolFiles?: () => void;
  onNavigateToolGit?: () => void;
  onNavigateToolProcesses?: () => void;
}) {
  return render(
    <MemoryRouter
      initialEntries={
        options?.initialEntries ?? [options?.route ?? "/workspaces/workspace-1/sessions"]
      }
      initialIndex={options?.initialIndex}
    >
      <PlatformProvider>
        <MobileWorkbenchShell
          activeEntry={options?.activeEntry ?? "sessions"}
          presentation={options?.presentation ?? "default"}
          navigationPanel={options?.navigationPanel}
          auxiliaryPanel={options?.auxiliaryPanel}
          onOpenNavigation={() => undefined}
          onOpenSearch={() => undefined}
          onOpenAuxiliary={() => undefined}
          onNavigateWorkspaces={() => undefined}
          onNavigateTerminals={() => undefined}
          onNavigateSessions={() => undefined}
          onNavigateTools={() => undefined}
          onNavigateToolFiles={options?.onNavigateToolFiles ?? (() => undefined)}
          onNavigateToolGit={options?.onNavigateToolGit ?? (() => undefined)}
          onNavigateToolProcesses={options?.onNavigateToolProcesses ?? (() => undefined)}
          onNavigateSettings={() => undefined}
        >
          {options?.childVariant === "conversation" ? <ConversationShellFixture /> : <WorkbenchShellFixture />}
        </MobileWorkbenchShell>
      </PlatformProvider>
    </MemoryRouter>
  );
}

function WorkbenchShellFixture() {
  return (
    <main className="workbench-page">
      <textarea aria-label="消息输入框" />
      <LocationProbe />
    </main>
  );
}

function ConversationShellFixture() {
  return (
    <main className="workbench-page conversation-page-shell mobile-page-fixed-root mobile-conversation-page">
      <section className="message-timeline">
        <div className="message-list">
          <article className="message-item">
            <div className="message-content-wrapper">
              <p>测试消息</p>
            </div>
          </article>
        </div>
      </section>
      <section className="composer-panel">
        <textarea aria-label="消息输入框" />
      </section>
      <LocationProbe />
    </main>
  );
}

function LocationProbe() {
  const location = useLocation();

  return <span data-testid="mobile-location">{location.pathname}</span>;
}
