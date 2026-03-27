import type { ReactNode } from "react";

import { act, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    expect(view.queryByRole("button", { name: "打开工作台菜单" })).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: "打开工具面板" })).toBeInTheDocument();
  });

  it("底部导航会显示工作区、终端、会话、工具、设置五个一级入口", () => {
    const view = renderMobileShell({
      activeEntry: "terminals"
    });

    const tabbarItems = Array.from(view.container.querySelectorAll(".mobile-workbench-tabbar-item"));
    expect(tabbarItems).toHaveLength(5);
    expect(tabbarItems.map((item) => item.textContent?.trim())).toEqual([
      "工作区",
      "会话",
      "终端",
      "工具",
      "设置"
    ]);
  });
});

function renderMobileShell(options?: {
  activeEntry?: "workspaces" | "terminals" | "sessions" | "tools" | "settings";
  navigationPanel?: ReactNode;
  auxiliaryPanel?: ReactNode;
}) {
  return render(
    <PlatformProvider>
      <MobileWorkbenchShell
        activeEntry={options?.activeEntry ?? "sessions"}
        title="会话"
        subtitle="当前工作区"
        navigationPanel={options?.navigationPanel}
        auxiliaryPanel={options?.auxiliaryPanel}
        onOpenNavigation={() => undefined}
        onOpenSearch={() => undefined}
        onOpenAuxiliary={() => undefined}
        onNavigateWorkspaces={() => undefined}
        onNavigateTerminals={() => undefined}
        onNavigateSessions={() => undefined}
        onNavigateTools={() => undefined}
        onNavigateSettings={() => undefined}
      >
        <main className="workbench-page">
          <textarea aria-label="消息输入框" />
        </main>
      </MobileWorkbenchShell>
    </PlatformProvider>
  );
}
