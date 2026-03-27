import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceDetailPage } from "./WorkspaceDetailPage";

const mockUseWorkbenchShell = vi.fn();
const mockShowToast = vi.fn();
const gitSnapshotListeners = new Set<
  (snapshot: {
    workspaceId: string;
    status: {
      snapshot: {
        branch: string | null;
      };
      changes: unknown[];
    };
  }) => void
>();

vi.mock("../../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

vi.mock("../../conversation/api/conversation-api", async () => {
  const actual = await vi.importActual("../../conversation/api/conversation-api");
  return {
    ...actual,
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
    gitSnapshotListeners.clear();
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
      workspaceManagementStateById: {
        "workspace-1": {
          detail: {
            workspaceId: "workspace-1",
            name: "项目一",
            path: "/repo/project-one",
            git: {
              isRepository: true,
              repoRoot: "/repo/project-one",
              currentBranch: "main",
              commitCount: 12,
              remotes: [],
              error: null
            },
            codeComposition: {
              scannedFileCount: 48,
              truncated: false,
              items: [],
              error: null
            }
          },
          loading: false,
          error: null
        }
      },
      selectWorkspace: vi.fn(),
      subscribeGitSnapshot: vi.fn(),
      subscribeWorkspaceManagementSnapshot: vi.fn(),
      requestGitRefresh: vi.fn((workspaceId: string) => {
        queueMicrotask(() => {
          gitSnapshotListeners.forEach((listener) => {
            listener({
              workspaceId,
              status: {
                snapshot: {
                  branch: "main"
                },
                changes: []
              }
            });
          });
        });
      }),
      requestWorkspaceManagementRefresh: vi.fn(),
      addGitSnapshotListener: (listener: (snapshot: {
        workspaceId: string;
        status: {
          snapshot: {
            branch: string | null;
          };
          changes: unknown[];
        };
      }) => void) => {
        gitSnapshotListeners.add(listener);
        return () => {
          gitSnapshotListeners.delete(listener);
        };
      },
      toggleFavoriteSession: vi.fn(async () => undefined),
      archiveSession: vi.fn(async () => undefined),
      unarchiveSession: vi.fn(async () => undefined),
      startDraftSession: vi.fn()
    });
  });

  it("会展示项目摘要和会话列表", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "项目一" })).toBeInTheDocument();
    expect(screen.getAllByText("/repo/project-one")).toHaveLength(2);
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
