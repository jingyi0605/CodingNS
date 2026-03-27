import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ToolFilesPage } from "./ToolFilesPage";
import { t } from "../../shared/i18n";

const mockUseWorkbenchShell = vi.fn();

vi.mock("../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

function LocationProbe() {
  const location = useLocation();

  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

describe("ToolFilesPage", () => {
  it("shows empty state when no workspace", () => {
    mockUseWorkbenchShell.mockReturnValue({ currentWorkspaceId: null });

    render(<ToolFilesPage />);

    expect(screen.getByText(t("shell.toolsWorkspaceRequiredBody"))).toBeInTheDocument();
  });

  it("redirects scoped file routes back to the unified tools page", async () => {
    mockUseWorkbenchShell.mockReturnValue({ currentWorkspaceId: "workspace-1" });

    render(
      <MemoryRouter initialEntries={["/workspaces/workspace-1/tools/files"]}>
        <Routes>
          <Route path="/workspaces/:workspaceId/tools/files" element={<ToolFilesPage />} />
          <Route
            path="/workspaces/:workspaceId/tools"
            element={<LocationProbe />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByTestId("location-probe")).toHaveTextContent(
      "/workspaces/workspace-1/tools?tab=files"
    );
  });
});
