import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ToolGitPage } from "./ToolGitPage";
import { t } from "../../shared/i18n";

const mockUseWorkbenchShell = vi.fn();

vi.mock("../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

function LocationProbe() {
  const location = useLocation();

  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

describe("ToolGitPage", () => {
  it("shows empty state when no workspace", () => {
    mockUseWorkbenchShell.mockReturnValue({ currentWorkspaceId: null });

    render(<ToolGitPage />);

    expect(screen.getByText(t("shell.toolsWorkspaceRequiredBody"))).toBeInTheDocument();
  });

  it("redirects scoped git routes back to the current conversation with the git panel intent", async () => {
    mockUseWorkbenchShell.mockReturnValue({
      currentWorkspaceId: "workspace-1",
      currentSessionId: "session-1",
      navigationGroups: [
        {
          workspace: { id: "workspace-1", name: "项目一" },
          sessions: [
            {
              sessionId: "session-1",
              workspaceId: "workspace-1"
            }
          ]
        }
      ]
    });

    render(
      <MemoryRouter initialEntries={["/workspaces/workspace-1/tools/git"]}>
        <Routes>
          <Route path="/workspaces/:workspaceId/tools/git" element={<ToolGitPage />} />
          <Route
            path="/workspaces/:workspaceId/sessions/:sessionId"
            element={<LocationProbe />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByTestId("location-probe")).toHaveTextContent(
      "/workspaces/workspace-1/sessions/session-1?toolPanel=git"
    );
  });
});
