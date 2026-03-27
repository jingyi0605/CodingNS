import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbenchLandingPage } from "./WorkbenchLandingPage";

const mockUseWorkbenchShell = vi.fn();

vi.mock("../../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

describe("WorkbenchLandingPage", () => {
  beforeEach(() => {
    mockUseWorkbenchShell.mockReset();
  });

  it("桌面端展示空白工作台占位页", () => {
    mockUseWorkbenchShell.mockReturnValue({
      shellMode: "desktop"
    });

    renderPage("/landing");

    expect(screen.getByRole("heading", { name: "先选一个会话" })).toBeInTheDocument();
  });

  it("移动端命中桌面落地页时会重定向到工作区首页", () => {
    mockUseWorkbenchShell.mockReturnValue({
      shellMode: "mobile"
    });

    renderPage("/landing");

    expect(screen.getByTestId("current-path").textContent).toBe("/workspaces");
  });
});

function renderPage(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/landing" element={<WorkbenchLandingPage />} />
        <Route path="/workspaces" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

function LocationProbe() {
  const location = useLocation();

  return <div data-testid="current-path">{location.pathname}</div>;
}
