import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceDetailPage } from "./WorkspaceDetailPage";

const mockUseWorkbenchShell = vi.fn();
const mockShowToast = vi.fn();
const mockGetWorkspaceManagementSummary = vi.fn();

vi.mock("../../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

vi.mock("../../conversation/api/conversation-api", async () => {
  const actual = await vi.importActual("../../conversation/api/conversation-api");
  return {
    ...actual,
    getWorkspaceManagementSummary: (...args: unknown[]) =>
      mockGetWorkspaceManagementSummary(...args),
    removeWorkspace: vi.fn()
  };
});

vi.mock("../../../shared/toast", () => ({
  useToast: () => ({
    showToast: mockShowToast
  })
}));

describe("WorkspaceDetailPage", () => {
  beforeEach(() => {
    mockShowToast.mockReset();
    mockGetWorkspaceManagementSummary.mockReset();
    mockGetWorkspaceManagementSummary.mockResolvedValue({
      path: "/repo/project-one",
      git: {
        currentBranch: "main",
        commitCount: 12
      },
      codeComposition: {
        scannedFileCount: 48
      }
    });
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
              title: "会话 Alpha",
              provider: "codex",
              messageCount: 3,
              isArchived: false
            },
            {
              sessionId: "session-2",
              title: "会话 Beta",
              provider: "claude-code",
              messageCount: 1,
              isArchived: true
            }
          ]
        }
      ],
      currentWorkspaceId: "workspace-1",
      favoriteSessionIds: [],
      selectWorkspace: vi.fn(),
      toggleFavoriteSession: vi.fn(async () => undefined),
      archiveSession: vi.fn(async () => undefined),
      unarchiveSession: vi.fn(async () => undefined),
      startDraftSession: vi.fn()
    });
  });

  it("会展示项目摘要和会话列表", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "项目一" })).toBeInTheDocument();
    expect(screen.getByText("/repo/project-one")).toBeInTheDocument();
    expect(screen.getByText("会话 Alpha")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("main")).toBeInTheDocument();
      expect(screen.getByText("48")).toBeInTheDocument();
    });
  });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/workspaces/workspace-1"]}>
      <Routes>
        <Route path="/workspaces/:workspaceId" element={<WorkspaceDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}
