import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { t } from "../../../shared/i18n";
import { IosWorkbenchShell } from "./IosWorkbenchShell";

const originalInnerWidth = window.innerWidth;

describe("IosWorkbenchShell", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390
    });
    window.history.pushState({}, "", "/ios-shell-test");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: originalInnerWidth
    });
    window.history.replaceState({}, "", "/");
  });

  it("详情路由不再渲染顶部标题栏，但会保留底部一级导航", () => {
    renderIosShell({
      initialEntries: ["/", "/workspaces/workspace-1/sessions/session-1"],
      initialIndex: 1
    });

    expect(document.querySelector(".ios-workbench-nav")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("common.back") })).not.toBeInTheDocument();
    expect(screen.getByTestId("ios-location")).toHaveTextContent(
      "/workspaces/workspace-1/sessions/session-1"
    );
    expect(screen.getByRole("button", { name: t("shell.mobileSessionsEntry") })).toBeInTheDocument();
  });

  it("默认移动页不再提供顶部更多操作入口", () => {
    renderIosShell();

    expect(document.querySelector(".ios-workbench-nav")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.iosMoreAction") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.mobileSearchAction") })).not.toBeInTheDocument();
  });

  it("会话沉浸态会先显示底部导航，3 秒后再自动收起", () => {
    vi.useFakeTimers();

    renderIosShell({
      initialEntries: ["/", "/workspaces/workspace-1/sessions/session-1"],
      initialIndex: 1,
      presentation: "conversation-focus"
    });
    const shell = document.querySelector(".ios-workbench-shell");

    expect(document.querySelector(".ios-workbench-nav")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("common.back") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.showSessionSidebar") })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.mobileWorkspacesEntry") })).toBeInTheDocument();
    expect(shell).toHaveAttribute("data-conversation-tabbar-state", "visible");

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(shell).toHaveAttribute("data-conversation-tabbar-state", "hidden");
    expect(screen.queryByRole("button", { name: t("shell.iosMoreAction") })).not.toBeInTheDocument();
  });

  it("首页模式默认就是无顶部标题栏，只保留内容区和底部导航", () => {
    const view = renderIosShell();

    expect(view.container.querySelector(".ios-workbench-nav")).not.toBeInTheDocument();
    expect(screen.getByText(t("shell.mobileWorkspacesEntry"))).toBeInTheDocument();
    expect(screen.getByTestId("ios-location")).toHaveTextContent("/");
  });

  it("工具主页不再渲染外层标题栏，避免和页面内头部重复", () => {
    renderIosShell({
      activeEntry: "sessions",
      initialEntries: ["/workspaces/workspace-1/tools?tab=files"]
    });

    expect(document.querySelector(".ios-workbench-nav")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.iosMoreAction") })).not.toBeInTheDocument();
  });

  it("进程管理页会提供返回按钮并回到主工具页", () => {
    window.localStorage.setItem("mobile.tools.last-primary-tool", "git");

    renderIosShell({
      activeEntry: "butler",
      initialEntries: [
        "/workspaces/workspace-1/tools?tab=git",
        "/workspaces/workspace-1/tools/processes"
      ],
      initialIndex: 1
    });

    expect(screen.getByRole("heading", { name: t("shell.terminalManagerEntry") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("common.back") }));
    expect(document.querySelector(".ios-workbench-nav")).not.toBeInTheDocument();
    expect(screen.getByTestId("ios-location")).toHaveTextContent("/workspaces/workspace-1/terminals");
  });
});

function renderIosShell({
  initialEntries = ["/"],
  initialIndex,
  presentation,
  activeEntry,
  onNavigateToolGit,
  onNavigateToolProcesses
}: {
  initialEntries?: string[];
  initialIndex?: number;
  presentation?: "default" | "conversation-focus";
  activeEntry?: "workspaces" | "terminals" | "sessions" | "butler" | "settings";
  onNavigateToolGit?: () => void;
  onNavigateToolProcesses?: () => void;
} = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
      <Routes>
        <Route
          path="*"
          element={
            <IosWorkbenchShell
              activeEntry={activeEntry ?? "sessions"}
              presentation={presentation ?? "default"}
              navigationPanel={<div>导航面板</div>}
              auxiliaryPanel={<div>辅助面板</div>}
              onOpenNavigation={() => undefined}
              onOpenSearch={() => undefined}
              onOpenAuxiliary={() => undefined}
              onNavigateWorkspaces={() => undefined}
              onNavigateTerminals={() => undefined}
              onNavigateSessions={() => undefined}
              onNavigateButler={() => undefined}
              onNavigateToolFiles={() => undefined}
              onNavigateToolGit={onNavigateToolGit ?? (() => undefined)}
              onNavigateToolProcesses={onNavigateToolProcesses ?? (() => undefined)}
              onNavigateSettings={() => undefined}
            >
              <LocationProbe />
            </IosWorkbenchShell>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

function LocationProbe() {
  const location = useLocation();

  return (
    <main className="workbench-page">
      <span data-testid="ios-location">{location.pathname}</span>
    </main>
  );
}
