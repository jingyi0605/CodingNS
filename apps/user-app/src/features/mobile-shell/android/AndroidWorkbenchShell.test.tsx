import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    vi.restoreAllMocks();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: originalInnerWidth
    });
    window.history.replaceState({}, "", "/");
  });

  it("会在详情路由提供显式返回按钮，并沿当前 back stack 返回", async () => {
    const user = userEvent.setup();

    renderAndroidShell({
      initialEntries: ["/", "/sessions/session-1"],
      initialIndex: 1
    });

    expect(screen.getByRole("button", { name: t("common.back") })).toBeInTheDocument();
    expect(screen.getByTestId("android-location")).toHaveTextContent("/sessions/session-1");

    await user.click(screen.getByRole("button", { name: t("common.back") }));

    await waitFor(() => {
      expect(screen.getByTestId("android-location")).toHaveTextContent("/");
    });
  });

  it("会把次操作放进 bottom sheet，并触发工具面板入口", async () => {
    const onOpenAuxiliary = vi.fn();
    const user = userEvent.setup();

    renderAndroidShell({
      onOpenAuxiliary
    });

    await user.click(screen.getByRole("button", { name: t("shell.androidMoreAction") }));

    const dialog = screen.getByRole("dialog", { name: t("shell.androidMoreAction") });

    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: t("shell.mobileAuxiliaryAction") })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: t("shell.mobileNavigationAction") })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: t("shell.mobileAuxiliaryAction") }));

    expect(onOpenAuxiliary).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: t("shell.androidMoreAction") })).not.toBeInTheDocument();
    });
  });
});

function renderAndroidShell({
  initialEntries = ["/"],
  initialIndex,
  onOpenAuxiliary
}: {
  initialEntries?: string[];
  initialIndex?: number;
  onOpenAuxiliary?: () => void;
}) {
  return render(
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
      <Routes>
        <Route
          path="*"
          element={
            <AndroidWorkbenchShell
              activeEntry="sessions"
              title="会话"
              subtitle="当前工作区"
              navigationPanel={<div>导航面板</div>}
              auxiliaryPanel={<div>辅助面板</div>}
              onOpenNavigation={() => undefined}
              onOpenSearch={() => undefined}
              onOpenAuxiliary={onOpenAuxiliary ?? (() => undefined)}
              onNavigateWorkspaces={() => undefined}
              onNavigateTerminals={() => undefined}
              onNavigateSessions={() => undefined}
              onNavigateTools={() => undefined}
              onNavigateSettings={() => undefined}
            >
              <LocationProbe />
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
