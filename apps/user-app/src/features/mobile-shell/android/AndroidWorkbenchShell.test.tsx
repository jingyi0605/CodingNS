import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { t } from "../../../shared/i18n";
import { AndroidWorkbenchShell } from "./AndroidWorkbenchShell";

const originalInnerWidth = window.innerWidth;

describe("AndroidWorkbenchShell", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390
    });
    window.history.pushState({}, "", "/android-shell-test");
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

  it("hides the top bar on conversation routes", () => {
    renderAndroidShell({
      initialEntries: ["/", "/workspaces/workspace-1/sessions/session-1"],
      initialIndex: 1
    });

    expect(document.querySelector(".android-workbench-topbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("common.back") })).not.toBeInTheDocument();
    expect(screen.getByTestId("android-location")).toHaveTextContent(
      "/workspaces/workspace-1/sessions/session-1"
    );
    expect(screen.getByRole("button", { name: t("shell.mobileSessionsEntry") })).toBeInTheDocument();
  });

  it("auto hides the bottom nav after three seconds in conversation focus mode", () => {
    vi.useFakeTimers();

    renderAndroidShell({
      initialEntries: ["/", "/workspaces/workspace-1/sessions/session-1"],
      initialIndex: 1,
      presentation: "conversation-focus",
      childVariant: "conversation"
    });
    const shell = document.querySelector(".android-workbench-shell");

    expect(document.querySelector(".android-workbench-topbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("common.back") })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.mobileWorkspacesEntry") })).toBeInTheDocument();
    expect(shell).toHaveAttribute("data-conversation-tabbar-state", "visible");

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(shell).toHaveAttribute("data-conversation-tabbar-state", "hidden");
  });

  it("supports swiping down on the composer to hide the bottom nav", () => {
    vi.useFakeTimers();

    renderAndroidShell({
      initialEntries: ["/", "/workspaces/workspace-1/sessions/session-1"],
      initialIndex: 1,
      presentation: "conversation-focus",
      childVariant: "conversation"
    });
    const shell = document.querySelector(".android-workbench-shell");
    const composerPanel = document.querySelector(".composer-panel") as HTMLElement | null;

    expect(shell).toHaveAttribute("data-conversation-tabbar-state", "visible");
    expect(composerPanel).not.toBeNull();

    fireEvent.touchStart(composerPanel!, {
      touches: [{ clientY: 560, identifier: 1 }]
    });
    fireEvent.touchMove(composerPanel!, {
      touches: [{ clientY: 628, identifier: 1 }]
    });

    expect(shell).toHaveAttribute("data-conversation-tabbar-state", "dragging");

    fireEvent.touchEnd(composerPanel!, {
      changedTouches: [{ clientY: 628, identifier: 1 }]
    });

    expect(shell).toHaveAttribute("data-conversation-tabbar-state", "hidden");
  });

  it("supports hiding the bottom nav by swiping inside the conversation list", () => {
    vi.useFakeTimers();

    renderAndroidShell({
      initialEntries: ["/", "/workspaces/workspace-1/sessions/session-1"],
      initialIndex: 1,
      presentation: "conversation-focus",
      childVariant: "conversation"
    });
    const shell = document.querySelector(".android-workbench-shell");
    const messageList = document.querySelector(".message-list") as HTMLElement | null;

    expect(shell).toHaveAttribute("data-conversation-tabbar-state", "visible");
    expect(messageList).not.toBeNull();

    fireEvent.touchStart(messageList!, {
      touches: [{ clientX: 120, clientY: 620, identifier: 1 }]
    });
    fireEvent.touchMove(messageList!, {
      touches: [{ clientX: 126, clientY: 560, identifier: 1 }]
    });

    expect(shell).toHaveAttribute("data-conversation-tabbar-state", "hidden");
  });

  it("shows a back button on the processes tool page and returns to tools home", () => {
    window.localStorage.setItem("mobile.tools.last-primary-tool", "git");

    renderAndroidShell({
      activeEntry: "butler",
      initialEntries: [
        "/workspaces/workspace-1/tools?tab=git",
        "/workspaces/workspace-1/tools/processes"
      ],
      initialIndex: 1
    });

    expect(screen.getByRole("heading", { name: t("shell.terminalManagerEntry") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("common.back") }));
    expect(document.querySelector(".android-workbench-topbar")).not.toBeInTheDocument();
    expect(screen.getByTestId("android-location")).toHaveTextContent("/workspaces/workspace-1/terminals");
  });
});

function renderAndroidShell({
  initialEntries = ["/"],
  initialIndex,
  presentation,
  activeEntry,
  childVariant,
  onNavigateToolGit,
  onNavigateToolProcesses
}: {
  initialEntries?: string[];
  initialIndex?: number;
  presentation?: "default" | "conversation-focus";
  activeEntry?: "workspaces" | "terminals" | "sessions" | "butler" | "settings";
  childVariant?: "workbench" | "conversation";
  onNavigateToolGit?: () => void;
  onNavigateToolProcesses?: () => void;
} = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
      <Routes>
        <Route
          path="*"
          element={
            <AndroidWorkbenchShell
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
              {childVariant === "conversation" ? <ConversationShellFixture /> : <LocationProbe />}
            </AndroidWorkbenchShell>
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
      <span data-testid="android-location">{location.pathname}</span>
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
