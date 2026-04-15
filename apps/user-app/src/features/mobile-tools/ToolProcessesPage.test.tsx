import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ToolProcessesPage } from "./ToolProcessesPage";
import { t } from "../../shared/i18n";
import {
  buildWorkspaceSessionIndexPath,
  buildWorkspaceSessionPath
} from "../workbench/utils/workbench-navigation";

const mockUseWorkbenchShell = vi.fn();

vi.mock("../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

describe("ToolProcessesPage", () => {
  it("shows empty state before a workspace is selected", () => {
    mockUseWorkbenchShell.mockReturnValue({ currentWorkspaceId: null });

    render(<ToolProcessesPage />);

    expect(screen.getByText(t("shell.toolsWorkspaceRequiredBody"))).toBeInTheDocument();
  });

  it("会把旧进程入口重定向回当前对话页的进程标签", () => {
    mockUseWorkbenchShell.mockReturnValue({
      currentWorkspaceId: "workspace-1",
      currentSessionId: "session-1",
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "工作区一",
            path: "/tmp/workspace-1"
          },
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
      <MemoryRouter initialEntries={["/tools/processes"]}>
        <Routes>
          <Route path="/tools/processes" element={<ToolProcessesPage />} />
          <Route path="*" element={<RouteProbe />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId("route-probe")).toHaveTextContent(
      `${buildWorkspaceSessionPath("workspace-1", "session-1")}?toolPanel=processes`
    );
  });

  it("没有当前会话时会重定向到工作区会话列表并带进程标签", () => {
    mockUseWorkbenchShell.mockReturnValue({
      currentWorkspaceId: "workspace-1",
      currentSessionId: null,
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "工作区一",
            path: "/tmp/workspace-1"
          },
          sessions: []
        }
      ]
    });

    render(
      <MemoryRouter initialEntries={["/tools/processes"]}>
        <Routes>
          <Route path="/tools/processes" element={<ToolProcessesPage />} />
          <Route path="*" element={<RouteProbe />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId("route-probe")).toHaveTextContent(
      `${buildWorkspaceSessionIndexPath("workspace-1")}?toolPanel=processes`
    );
  });
});

function RouteProbe() {
  const location = useLocation();
  return <div data-testid="route-probe">{location.pathname + location.search}</div>;
}
