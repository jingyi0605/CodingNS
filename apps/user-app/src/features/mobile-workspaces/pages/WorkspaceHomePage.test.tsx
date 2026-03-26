import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceHomePage } from "./WorkspaceHomePage";

const mockUseWorkbenchShell = vi.fn();
const mockShowToast = vi.fn();

vi.mock("../../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

vi.mock("../../../shared/toast", () => ({
  useToast: () => ({
    showToast: mockShowToast
  })
}));

describe("WorkspaceHomePage", () => {
  beforeEach(() => {
    mockShowToast.mockReset();
    mockUseWorkbenchShell.mockReturnValue({
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "项目一",
            path: "/repo/project-one"
          },
          sessions: [
            {
              sessionId: "session-1",
              isArchived: false
            },
            {
              sessionId: "session-2",
              isArchived: true
            }
          ]
        }
      ],
      currentWorkspaceId: "workspace-1",
      refreshNavigation: vi.fn(),
      selectWorkspace: vi.fn(),
      startDraftSession: vi.fn()
    });
  });

  it("会渲染工作区卡片和会话计数", () => {
    renderPage();

    expect(screen.getByText("项目一")).toBeInTheDocument();
    expect(screen.getByText("/repo/project-one")).toBeInTheDocument();
    expect(screen.getByText("会话 1")).toBeInTheDocument();
    expect(screen.getByText("归档会话 1")).toBeInTheDocument();
  });

  it("可以从首页直接为当前工作区发起新会话", async () => {
    const user = userEvent.setup();
    const startDraftSession = vi.fn();

    mockUseWorkbenchShell.mockReturnValue({
      ...mockUseWorkbenchShell(),
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "项目一",
            path: "/repo/project-one"
          },
          sessions: []
        }
      ],
      currentWorkspaceId: "workspace-1",
      refreshNavigation: vi.fn(),
      selectWorkspace: vi.fn(),
      startDraftSession
    });

    renderPage();

    await user.click(screen.getByRole("button", { name: "当前项目 项目一 新建会话" }));
    await user.click(screen.getByRole("button", { name: "Codex" }));

    expect(startDraftSession).toHaveBeenCalledWith("workspace-1", "codex");
  });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<WorkspaceHomePage />} />
      </Routes>
    </MemoryRouter>
  );
}
