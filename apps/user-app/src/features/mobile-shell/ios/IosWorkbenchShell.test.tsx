import { fireEvent, render, screen } from "@testing-library/react";
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
      initialEntries: ["/", "/sessions/session-1"],
      initialIndex: 1
    });

    expect(document.querySelector(".ios-workbench-nav")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("common.back") })).not.toBeInTheDocument();
    expect(screen.getByTestId("ios-location")).toHaveTextContent("/sessions/session-1");
    expect(screen.getByRole("button", { name: t("shell.mobileSessionsEntry") })).toBeInTheDocument();
  });

  it("默认移动页不再提供顶部更多操作入口", () => {
    renderIosShell();

    expect(document.querySelector(".ios-workbench-nav")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.iosMoreAction") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.mobileSearchAction") })).not.toBeInTheDocument();
  });

  it("会话沉浸态会隐藏底部导航，只保留快捷导航浮层", () => {
    const onNavigateToolGit = vi.fn();

    renderIosShell({
      initialEntries: ["/", "/sessions/session-1"],
      initialIndex: 1,
      presentation: "conversation-focus",
      onNavigateToolGit
    });

    expect(document.querySelector(".ios-workbench-nav")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("common.back") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.showSessionSidebar") })).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.mobileWorkspacesEntry"))).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.mobileQuickNavigationAction") })).toBeInTheDocument();

    const quickNavTrigger = screen.getByRole("button", { name: t("shell.mobileQuickNavigationAction") });
    fireEvent.keyDown(quickNavTrigger, {
      key: "Enter"
    });

    expect(screen.getByRole("button", { name: t("shell.gitEntry") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("shell.gitEntry") }));

    expect(onNavigateToolGit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: t("shell.iosMoreAction") })).not.toBeInTheDocument();
  });

  it("首页模式默认就是无顶部标题栏，只保留内容区和底部导航", () => {
    const view = renderIosShell();

    expect(view.container.querySelector(".ios-workbench-nav")).not.toBeInTheDocument();
    expect(screen.getByText(t("shell.mobileWorkspacesEntry"))).toBeInTheDocument();
    expect(screen.getByTestId("ios-location")).toHaveTextContent("/");
  });

  it("工具主页会显示主工具标题，并把更多按钮直连进程管理", () => {
    const onNavigateToolProcesses = vi.fn();

    renderIosShell({
      activeEntry: "tools",
      initialEntries: ["/tools?tab=files"],
      onNavigateToolProcesses
    });

    expect(screen.getByRole("heading", { name: t("shell.filesEntry") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.mobileSearchAction") })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("shell.iosMoreAction") }));
    expect(onNavigateToolProcesses).toHaveBeenCalledTimes(1);
  });

  it("进程管理页会提供返回按钮并回到主工具页", () => {
    window.localStorage.setItem("mobile.tools.last-primary-tool", "git");

    renderIosShell({
      activeEntry: "tools",
      initialEntries: ["/tools?tab=git", "/tools/processes"],
      initialIndex: 1
    });

    expect(screen.getByRole("heading", { name: t("shell.terminalManagerEntry") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("common.back") }));
    expect(screen.getByRole("heading", { name: t("shell.gitEntry") })).toBeInTheDocument();
    expect(screen.getByTestId("ios-location")).toHaveTextContent("/tools");
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
  activeEntry?: "workspaces" | "terminals" | "sessions" | "tools" | "settings";
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
              onNavigateTools={() => undefined}
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
