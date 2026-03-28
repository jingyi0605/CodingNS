import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
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

function createWorkbenchShell(overrides?: Record<string, unknown>) {
  return {
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
            items: [
              {
                type: "TypeScript",
                count: 24,
                ratio: 0.5
              },
              {
                type: "Markdown",
                count: 12,
                ratio: 0.25
              },
              {
                type: "JSON",
                count: 12,
                ratio: 0.25
              }
            ],
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
    startDraftSession: vi.fn(),
    ...overrides
  };
}

describe("WorkspaceDetailPage", () => {
  beforeEach(() => {
    mockShowToast.mockReset();
    window.sessionStorage.clear();
    gitSnapshotListeners.clear();
    mockUseWorkbenchShell.mockReturnValue(createWorkbenchShell());
  });

  it("会展示项目摘要和会话列表", async () => {
    renderPage();

    expect(screen.getByRole("button", { name: "切换工作区" })).toHaveTextContent("项目一");
    expect(screen.getAllByText("/repo/project-one")).toHaveLength(2);
    expect(screen.getByText("会话 Alpha")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收藏会话" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "归档会话" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("main")).toBeInTheDocument();
      expect(screen.getAllByText("48").length).toBeGreaterThan(0);
      expect(screen.getByText("TypeScript")).toBeInTheDocument();
      expect(document.querySelector(".workbench-manage-type-chart-ring")).not.toBeNull();
    });

    const compositionHeading = screen.getByRole("heading", { name: "代码类型组成" });
    const recentHeading = screen.getByRole("heading", { name: "最近会话" });
    expect(Boolean(compositionHeading.compareDocumentPosition(recentHeading) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("命中新鲜缓存时不会主动刷新 Git 和工作区摘要", async () => {
    const shell = createWorkbenchShell({
      workspaceManagementStateById: {}
    });
    writeViewSnapshot("git-sidebar.snapshot.workspace-1", {
      status: {
        snapshot: {
          branch: "cached/main"
        },
        changes: []
      }
    });
    writeViewSnapshot("workspace-management.summary.workspace-1", {
      workspaceId: "workspace-1",
      name: "项目一",
      path: "/repo/project-one",
      git: {
        isRepository: true,
        repoRoot: "/repo/project-one",
        currentBranch: "cached/main",
        commitCount: 99,
        remotes: [],
        error: null
      },
      codeComposition: {
        scannedFileCount: 128,
        truncated: false,
        items: [],
        error: null
      }
    });
    mockUseWorkbenchShell.mockReturnValue(shell);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("cached/main")).toBeInTheDocument();
    });

    expect(shell.subscribeGitSnapshot).toHaveBeenCalledWith("workspace-1");
    expect(shell.subscribeWorkspaceManagementSnapshot).toHaveBeenCalledWith("workspace-1");
    expect(shell.requestGitRefresh).not.toHaveBeenCalled();
    expect(shell.requestWorkspaceManagementRefresh).not.toHaveBeenCalled();
  });

  it("新建会话会先弹出工作区和供应商选择", async () => {
    const user = userEvent.setup();
    const startDraftSession = vi.fn();

    mockUseWorkbenchShell.mockReturnValue(createWorkbenchShell({
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
      startDraftSession
    }));

    renderPage();

    await user.click(screen.getByRole("button", { name: "新建会话" }));

    expect(screen.getByRole("button", { name: /选择工作区 项目一/ })).toHaveTextContent("项目一");

    await user.click(screen.getByRole("button", { name: "OpenCode" }));

    expect(startDraftSession).toHaveBeenCalledWith("workspace-1", "opencode");
  });

  it("归档会话默认显示最近 10 条，并支持继续加载", async () => {
    const user = userEvent.setup();
    const archivedSessions = Array.from({ length: 15 }, (_, index) => ({
      sessionId: `archived-${index + 1}`,
      title: `归档会话 ${index + 1}`,
      provider: "codex",
      messageCount: index + 1,
      isArchived: true,
      updatedAt: `2026-03-${String(28 - index).padStart(2, "0")}T10:00:00.000Z`,
      createdAt: `2026-03-${String(28 - index).padStart(2, "0")}T09:00:00.000Z`,
      lastEventAt: `2026-03-${String(28 - index).padStart(2, "0")}T11:00:00.000Z`
    }));

    mockUseWorkbenchShell.mockReturnValue(createWorkbenchShell({
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
            ...archivedSessions
          ]
        }
      ]
    }));

    renderPage();

    expect(screen.getAllByRole("button", { name: "取消归档" })).toHaveLength(10);
    expect(screen.getByRole("button", { name: "查看更多归档会话" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "查看更多归档会话" }));

    expect(screen.getAllByRole("button", { name: "取消归档" })).toHaveLength(15);
    expect(screen.queryByRole("button", { name: "查看更多归档会话" })).not.toBeInTheDocument();
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
