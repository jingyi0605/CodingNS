import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("会在详情路由显示显式返回按钮，并按导航栈返回上一页", async () => {
    const user = userEvent.setup();

    renderIosShell({
      initialEntries: ["/", "/sessions/session-1"],
      initialIndex: 1
    });

    expect(screen.getByRole("button", { name: t("common.back") })).toBeInTheDocument();
    expect(screen.getByTestId("ios-location")).toHaveTextContent("/sessions/session-1");

    await user.click(screen.getByRole("button", { name: t("common.back") }));

    await waitFor(() => {
      expect(screen.getByTestId("ios-location")).toHaveTextContent("/");
    });
  });

  it("会把次操作收进 action sheet，并触发信息面板入口", async () => {
    const onOpenAuxiliary = vi.fn();
    const user = userEvent.setup();

    renderIosShell({
      onOpenAuxiliary
    });

    await user.click(screen.getByRole("button", { name: t("shell.iosMoreAction") }));

    const dialog = screen.getByRole("dialog", { name: t("shell.iosMoreAction") });

    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: t("shell.mobileAuxiliaryAction") })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: t("shell.mobileNavigationAction") })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: t("shell.mobileAuxiliaryAction") }));

    expect(onOpenAuxiliary).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: t("shell.iosMoreAction") })).not.toBeInTheDocument();
    });
  });
});

function renderIosShell({
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
            <IosWorkbenchShell
              activeEntry="sessions"
              title="会话"
              subtitle="当前工作区"
              navigationPanel={<div>导航面板</div>}
              auxiliaryPanel={<div>辅助面板</div>}
              onOpenNavigation={() => undefined}
              onOpenSearch={() => undefined}
              onOpenAuxiliary={onOpenAuxiliary ?? (() => undefined)}
              onNavigateWorkspaces={() => undefined}
              onNavigateSessions={() => undefined}
              onNavigateTools={() => undefined}
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
