import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceHomePage } from "./WorkspaceHomePage";

const mockUseWorkbenchShell = vi.fn();
const mockShowToast = vi.fn();
const mockListWorkspaceTerminals = vi.fn();
const mockGetGitStatus = vi.fn();

vi.mock("../../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

vi.mock("../../terminal/api/terminal-api", () => ({
  listWorkspaceTerminals: (...args: unknown[]) => mockListWorkspaceTerminals(...args)
}));

vi.mock("../../conversation/api/git-api", () => ({
  getGitStatus: (...args: unknown[]) => mockGetGitStatus(...args)
}));

vi.mock("../../../shared/toast", () => ({
  useToast: () => ({
    showToast: mockShowToast
  })
}));

function createSession(overrides: Record<string, unknown>) {
  return {
    sessionId: "session-default",
    workspaceId: "workspace-1",
    provider: "codex",
    providerSessionId: "provider-session-default",
    rawStoreRef: "raw-default",
    title: "默认会话",
    messageCount: 1,
    lastMessageAt: "2026-03-27T10:00:00.000Z",
    createdAt: "2026-03-27T09:00:00.000Z",
    updatedAt: "2026-03-27T10:00:00.000Z",
    syncStatus: null,
    syncCursor: null,
    lastSyncAt: null,
    lastErrorCode: null,
    lastErrorDetail: null,
    resumedAt: null,
    runningState: "idle",
    activitySource: "none",
    lastEventAt: "2026-03-27T10:00:00.000Z",
    completedAt: null,
    lastSeenAt: null,
    activityState: "idle",
    isArchived: false,
    ...overrides
  };
}

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
          createSession({
            sessionId: "session-1",
            title: "修复首页布局",
            provider: "codex",
            runningState: "running",
            activityState: "running"
          }),
          createSession({
            sessionId: "session-2",
            title: "收藏的上下文",
            provider: "claude-code",
            lastMessageAt: "2026-03-27T08:00:00.000Z",
            updatedAt: "2026-03-27T08:00:00.000Z",
            lastEventAt: "2026-03-27T08:00:00.000Z",
            runningState: "idle",
            activityState: "idle",
            isFavorite: true
          }),
          createSession({
            sessionId: "session-3",
            title: "待查看结果",
            lastMessageAt: "2026-03-27T07:30:00.000Z",
            updatedAt: "2026-03-27T07:30:00.000Z",
            lastEventAt: "2026-03-27T07:30:00.000Z",
            runningState: "completed",
            activityState: "completed_unread",
            completedAt: "2026-03-27T07:30:00.000Z"
          }),
          createSession({
            sessionId: "session-4",
            title: "旧会话",
            lastMessageAt: "2026-03-26T08:00:00.000Z",
            updatedAt: "2026-03-26T08:00:00.000Z",
            lastEventAt: "2026-03-26T08:00:00.000Z",
            isArchived: true
          })
        ]
      },
      {
        workspace: {
          id: "workspace-2",
          name: "项目二",
          path: "/repo/project-two"
        },
        sessions: []
      }
    ],
    currentWorkspaceId: "workspace-1",
    refreshNavigation: vi.fn(),
    selectWorkspace: vi.fn(),
    startDraftSession: vi.fn(),
    subscribeTerminalManagerSnapshot: vi.fn(),
    requestTerminalManagerRefresh: vi.fn(),
    addTerminalManagerSnapshotListener: (listener: (snapshot: {
      workspaceId: string;
      templateStatuses: Array<{ occupied: boolean }>;
      terminals: unknown[];
      templates: unknown[];
    }) => void) => {
      listener({
        workspaceId: "workspace-1",
        terminals: [],
        templates: [],
        templateStatuses: [{ occupied: true }]
      });
      return () => undefined;
    },
    ...overrides
  };
}

describe("WorkspaceHomePage", () => {
  beforeEach(() => {
    mockShowToast.mockReset();
    mockListWorkspaceTerminals.mockReset();
    mockGetGitStatus.mockReset();
    mockUseWorkbenchShell.mockReset();

    mockListWorkspaceTerminals.mockResolvedValue({
      items: [
        { id: "terminal-1", status: "running" },
        { id: "terminal-2", status: "creating" },
        { id: "terminal-3", status: "closed" }
      ]
    });
    mockGetGitStatus.mockResolvedValue({
      snapshot: {
        branch: "feat/mobile-home"
      },
      changes: [{ path: "src/home.tsx" }, { path: "src/app.css" }]
    });
    mockUseWorkbenchShell.mockReturnValue(createWorkbenchShell());
  });

  it("会渲染 iOS 风格的工作区和会话分组列表", async () => {
    renderPage();

    expect(screen.getByRole("button", { name: "切换工作区" })).toBeInTheDocument();
    expect(screen.getByText("/repo/project-one")).toBeInTheDocument();
    expect(screen.getByText("活动会话")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看全部会话" })).toBeInTheDocument();
    expect(screen.getByText("收藏会话")).toBeInTheDocument();
    expect(screen.getByLabelText("当前工作区")).toBeInTheDocument();
    expect(screen.getByText("快捷启动进程")).toBeInTheDocument();
    expect(screen.getByText("等待输入")).toBeInTheDocument();

    const activeTerminalRow = screen.getByText("终端").closest("button");
    const changedFilesRow = screen.getByText("变更").closest("button");
    const processRow = screen.getByText("快捷启动进程").closest("button");
    const waitingInputRow = screen.getByText("等待输入").closest("button");

    expect(activeTerminalRow).not.toBeNull();
    expect(changedFilesRow).not.toBeNull();
    expect(processRow).not.toBeNull();
    expect(waitingInputRow).not.toBeNull();

    await waitFor(() => {
      expect(screen.getByText("feat/mobile-home")).toBeInTheDocument();
      expect(within(activeTerminalRow as HTMLElement).getByText("2")).toBeInTheDocument();
      expect(within(changedFilesRow as HTMLElement).getByText("2")).toBeInTheDocument();
      expect(within(processRow as HTMLElement).getByText("运行中")).toBeInTheDocument();
      expect(within(waitingInputRow as HTMLElement).getByText("1")).toBeInTheDocument();
    });

    expect(screen.getByText((_, element) => element?.textContent === "活动")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === "待看")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === "终端")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === "变更")).toBeInTheDocument();

    expect(screen.getByText("修复首页布局")).toBeInTheDocument();
    expect(screen.getByText("收藏的上下文")).toBeInTheDocument();
    expect(screen.queryByText("整理提交说明")).not.toBeInTheDocument();
    expect(screen.queryByText("待查看结果")).not.toBeInTheDocument();
    expect(screen.queryByText("待查看")).not.toBeInTheDocument();
  });

  it("可以从空会话状态直接继续当前工作", async () => {
    const user = userEvent.setup();
    const startDraftSession = vi.fn();

    mockUseWorkbenchShell.mockReturnValue(
      createWorkbenchShell({
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
        startDraftSession
      })
    );

    renderPage();

    await user.click(screen.getByRole("button", { name: /新建会话/ }));

    expect(startDraftSession).toHaveBeenCalledWith("workspace-1", "codex");
    expect(screen.queryByRole("button", { name: "Codex" })).not.toBeInTheDocument();
  });

  it("可以通过顶部切换器切换工作区", async () => {
    const user = userEvent.setup();
    const selectWorkspace = vi.fn();

    mockUseWorkbenchShell.mockReturnValue(
      createWorkbenchShell({
        selectWorkspace
      })
    );

    renderPage();

    await user.click(screen.getByRole("button", { name: "切换工作区" }));

    const dialog = screen.getByRole("dialog", { name: "工作区" });
    await user.click(within(dialog).getByRole("button", { name: /项目二/ }));

    expect(selectWorkspace).toHaveBeenCalledWith("workspace-2");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "工作区" })).not.toBeInTheDocument();
    });
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
