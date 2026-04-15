import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ToolsHomePage } from "./ToolsHomePage";
import { t } from "../../shared/i18n";

const mockUseWorkbenchShell = vi.fn();

vi.mock("../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

function LocationProbe() {
  const location = useLocation();

  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

describe("ToolsHomePage", () => {
  it("没有工作区时显示空态", () => {
    mockUseWorkbenchShell.mockReturnValue({
      navigationGroups: [],
      currentWorkspaceId: null,
      currentSessionId: null
    });

    render(<ToolsHomePage />);

    expect(screen.getByText(t("shell.emptyNavigationBody"))).toBeInTheDocument();
  });

  it("有当前会话时回到当前工作区的对话页", async () => {
    mockUseWorkbenchShell.mockReturnValue({
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "CodingNS"
          },
          sessions: [
            {
              sessionId: "session-1",
              workspaceId: "workspace-1"
            }
          ]
        }
      ],
      currentWorkspaceId: "workspace-1",
      currentSessionId: "session-1"
    });

    render(
      <MemoryRouter initialEntries={["/workspaces/workspace-1/tools"]}>
        <Routes>
          <Route path="/workspaces/:workspaceId/tools" element={<ToolsHomePage />} />
          <Route path="/workspaces/:workspaceId/sessions/:sessionId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByTestId("location-probe")).toHaveTextContent(
      "/workspaces/workspace-1/sessions/session-1"
    );
  });

  it("没有当前会话时回到当前工作区的会话列表", async () => {
    mockUseWorkbenchShell.mockReturnValue({
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "CodingNS"
          },
          sessions: []
        }
      ],
      currentWorkspaceId: "workspace-1",
      currentSessionId: null
    });

    render(
      <MemoryRouter initialEntries={["/workspaces/workspace-1/tools"]}>
        <Routes>
          <Route path="/workspaces/:workspaceId/tools" element={<ToolsHomePage />} />
          <Route path="/workspaces/:workspaceId/sessions" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByTestId("location-probe")).toHaveTextContent(
      "/workspaces/workspace-1/sessions"
    );
  });
});
