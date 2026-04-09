import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { WorkspaceHomePage } from "./WorkspaceHomePage";

const mockUseWorkbenchShell = vi.fn();
const mockShowToast = vi.fn();
const mockGetButlerOverview = vi.fn();
const mockGetButlerProfile = vi.fn();
const mockListButlerFollowUpTasks = vi.fn();
const mockListButlerInboxItems = vi.fn();
const gitSnapshotListeners = new Set<
  (snapshot: {
    workspaceId: string;
    status: {
      snapshot: {
        branch: string | null;
      };
      changes: Array<{ path: string }>;
    };
  }) => void
>();
const terminalManagerSnapshotListeners = new Set<
  (snapshot: {
    workspaceId: string;
    terminals: Array<{ id: string; status: string }>;
    templates: unknown[];
    templateStatuses: Array<{ occupied: boolean }>;
  }) => void
>();

vi.mock("../../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

vi.mock("../../../shared/toast", () => ({
  useToast: () => ({
    showToast: mockShowToast
  })
}));

vi.mock("../../butler/api/butler-api", () => ({
  getButlerOverview: (...args: unknown[]) => mockGetButlerOverview(...args),
  getButlerProfile: (...args: unknown[]) => mockGetButlerProfile(...args),
  listButlerFollowUpTasks: (...args: unknown[]) => mockListButlerFollowUpTasks(...args),
  listButlerInboxItems: (...args: unknown[]) => mockListButlerInboxItems(...args)
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
  const emitGitSnapshot = (workspaceId: string) => {
    gitSnapshotListeners.forEach((listener) => {
      listener({
        workspaceId,
        status: {
          snapshot: {
            branch: workspaceId === "workspace-1" ? "feat/mobile-home" : "main"
          },
          changes: [{ path: "src/home.tsx" }, { path: "src/app.css" }]
        }
      });
    });
  };
  const emitTerminalManagerSnapshot = (workspaceId: string) => {
    terminalManagerSnapshotListeners.forEach((listener) => {
      listener({
        workspaceId,
        terminals:
          workspaceId === "workspace-1"
            ? [
                { id: "terminal-1", status: "running" },
                { id: "terminal-2", status: "creating" },
                { id: "terminal-3", status: "closed" }
              ]
            : [],
        templates: [],
        templateStatuses: [{ occupied: true }]
      });
    });
  };

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
    unreadNotificationCount: 3,
    openNotificationPanel: vi.fn(),
    refreshNavigation: vi.fn(),
    selectWorkspace: vi.fn(),
    startDraftSession: vi.fn(),
    subscribeGitSnapshot: vi.fn(),
    requestGitRefresh: vi.fn((workspaceId: string) => {
      queueMicrotask(() => {
        emitGitSnapshot(workspaceId);
      });
    }),
    addGitSnapshotListener: (listener: (snapshot: {
      workspaceId: string;
      status: {
        snapshot: {
          branch: string | null;
        };
        changes: Array<{ path: string }>;
      };
    }) => void) => {
      gitSnapshotListeners.add(listener);
      return () => undefined;
    },
    subscribeTerminalManagerSnapshot: vi.fn(),
    requestTerminalManagerRefresh: vi.fn((workspaceId: string) => {
      queueMicrotask(() => {
        emitTerminalManagerSnapshot(workspaceId);
      });
    }),
    addTerminalManagerSnapshotListener: (listener: (snapshot: {
      workspaceId: string;
      templateStatuses: Array<{ occupied: boolean }>;
      terminals: Array<{ id: string; status: string }>;
      templates: unknown[];
    }) => void) => {
      terminalManagerSnapshotListeners.add(listener);
      return () => {
        terminalManagerSnapshotListeners.delete(listener);
      };
    },
    ...overrides
  };
}

describe("WorkspaceHomePage", () => {
  beforeEach(() => {
    mockShowToast.mockReset();
    mockUseWorkbenchShell.mockReset();
    mockGetButlerOverview.mockReset();
    mockGetButlerProfile.mockReset();
    mockListButlerFollowUpTasks.mockReset();
    mockListButlerInboxItems.mockReset();
    window.sessionStorage.clear();
    gitSnapshotListeners.clear();
    terminalManagerSnapshotListeners.clear();
    mockGetButlerProfile.mockResolvedValue({
      initialized: true,
      profile: {
        id: "default",
        displayName: "代码助手",
        providerId: "codex"
      }
    });
    mockGetButlerOverview.mockResolvedValue({
      overview: {
        version: "overview-1",
        generatedAt: "2026-03-27T10:00:00.000Z",
        global: {
          projectCount: 2,
          activeProjectCount: 1,
          blockedProjectCount: 0,
          highRiskProjectCount: 0,
          topRisks: [],
          nextActions: []
        },
        projects: [
          {
            id: "project-1",
            workspaceId: "workspace-1",
            name: "项目一",
            repoRoot: "/repo/project-one",
            lifecycleStatus: "active",
            riskLevel: "low",
            activeSessionCount: 1,
            sessionCount: 1,
            memoryCount: 0,
            failedPatrolCount: 0,
            failedVerificationCount: 0,
            latestSessionSummary: null,
            latestPatrolSummary: null,
            latestVerificationSummary: null,
            topRisks: [],
            nextActions: [],
            lastActivityAt: "2026-03-27T10:00:00.000Z",
            updatedAt: "2026-03-27T10:00:00.000Z"
          },
          {
            id: "project-2",
            workspaceId: "workspace-2",
            name: "项目二",
            repoRoot: "/repo/project-two",
            lifecycleStatus: "active",
            riskLevel: "low",
            activeSessionCount: 0,
            sessionCount: 0,
            memoryCount: 0,
            failedPatrolCount: 0,
            failedVerificationCount: 0,
            latestSessionSummary: null,
            latestPatrolSummary: null,
            latestVerificationSummary: null,
            topRisks: [],
            nextActions: [],
            lastActivityAt: "2026-03-27T10:00:00.000Z",
            updatedAt: "2026-03-27T10:00:00.000Z"
          }
        ],
        sessions: [],
        patrols: [],
        verifications: [
          {
            id: "verification-1",
            projectId: "project-1",
            verificationType: "test",
            status: "queued",
            targetRef: null,
            summary: null,
            startedAt: null,
            finishedAt: null,
            createdAt: "2026-03-27T10:00:00.000Z"
          },
          {
            id: "verification-2",
            projectId: "project-1",
            verificationType: "health",
            status: "running",
            targetRef: null,
            summary: null,
            startedAt: "2026-03-27T10:01:00.000Z",
            finishedAt: null,
            createdAt: "2026-03-27T10:01:00.000Z"
          },
          {
            id: "verification-3",
            projectId: "project-1",
            verificationType: "browser",
            status: "passed",
            targetRef: null,
            summary: null,
            startedAt: "2026-03-27T09:30:00.000Z",
            finishedAt: "2026-03-27T09:35:00.000Z",
            createdAt: "2026-03-27T09:30:00.000Z"
          },
          {
            id: "verification-4",
            projectId: "project-2",
            verificationType: "test",
            status: "running",
            targetRef: null,
            summary: null,
            startedAt: "2026-03-27T10:02:00.000Z",
            finishedAt: null,
            createdAt: "2026-03-27T10:02:00.000Z"
          }
        ]
      }
    });
    mockListButlerFollowUpTasks.mockResolvedValue({
      items: [
        {
          id: "follow-up-1",
          workspaceId: "workspace-1",
          status: "active"
        },
        {
          id: "follow-up-2",
          workspaceId: "workspace-1",
          status: "waiting_user"
        },
        {
          id: "follow-up-3",
          workspaceId: "workspace-1",
          status: "completed"
        },
        {
          id: "follow-up-4",
          workspaceId: "workspace-2",
          status: "active"
        }
      ]
    });
    mockListButlerInboxItems.mockResolvedValue({
      items: [
        {
          id: "inbox-1",
          status: "pending"
        },
        {
          id: "inbox-2",
          status: "closed"
        }
      ]
    });
    mockUseWorkbenchShell.mockReturnValue(createWorkbenchShell());
  });

  it("会渲染 iOS 风格的工作区和会话分组列表", async () => {
    renderPage();

    expect(screen.getByRole("button", { name: "切换工作区" })).toBeInTheDocument();
    expect(screen.getByText("/repo/project-one")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "项目详情" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建会话" })).toBeInTheDocument();
    expect(screen.getByText("活动会话")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看全部会话" })).toBeInTheDocument();
    expect(screen.getByText("收藏会话")).toBeInTheDocument();
    expect(screen.getByLabelText("当前工作区")).toBeInTheDocument();
    expect(screen.getByText("快捷启动进程")).toBeInTheDocument();
    expect(screen.getByText("等待输入")).toBeInTheDocument();
    expect(screen.getByText("代码助手")).toBeInTheDocument();
    expect(screen.getByText("收件箱")).toBeInTheDocument();

    const activeTerminalRow = screen.getByText("终端").closest("button");
    const changedFilesRow = screen.getByText("变更").closest("button");
    const processRow = screen.getByText("快捷启动进程").closest("button");
    const waitingInputRow = screen.getByText("等待输入").closest("button");
    const butlerRow = screen.getByText("代码助手").closest("button");
    const inboxRow = screen.getByText("收件箱").closest("button");

    expect(activeTerminalRow).not.toBeNull();
    expect(changedFilesRow).not.toBeNull();
    expect(processRow).not.toBeNull();
    expect(waitingInputRow).not.toBeNull();
    expect(butlerRow).not.toBeNull();
    expect(inboxRow).not.toBeNull();

    await waitFor(() => {
      expect(within(activeTerminalRow as HTMLElement).getByText("2")).toBeInTheDocument();
      expect(within(changedFilesRow as HTMLElement).getByText("2")).toBeInTheDocument();
      expect(within(processRow as HTMLElement).getByText("运行中")).toBeInTheDocument();
      expect(within(waitingInputRow as HTMLElement).getByText("1")).toBeInTheDocument();
      expect(within(butlerRow as HTMLElement).getByText("3")).toBeInTheDocument();
      expect(within(inboxRow as HTMLElement).getByText("1")).toBeInTheDocument();
    });

    expect(screen.getByText((_, element) => element?.textContent === "活动")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === "通知")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === "终端")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === "变更")).toBeInTheDocument();

    expect(screen.getByText("修复首页布局")).toBeInTheDocument();
    expect(screen.getByText("收藏的上下文")).toBeInTheDocument();
    expect(screen.queryByText("整理提交说明")).not.toBeInTheDocument();
    expect(screen.queryByText("待查看结果")).not.toBeInTheDocument();
    expect(screen.queryByText("待查看")).not.toBeInTheDocument();
  });

  it("命中新鲜缓存时不会主动刷新 Git 和终端面板", async () => {
    const shell = createWorkbenchShell();
    writeViewSnapshot("git-sidebar.snapshot.workspace-1", {
      status: {
        snapshot: {
          branch: "feat/cached"
        },
        changes: [{ path: "src/cached.ts" }]
      }
    });
    writeViewSnapshot("terminal-manager.snapshot.workspace-1", {
      terminals: [{ id: "terminal-1", status: "running" }],
      templates: [],
      templateStatuses: [{ occupied: false }]
    });
    mockUseWorkbenchShell.mockReturnValue(shell);

    renderPage();

    expect(shell.subscribeGitSnapshot).toHaveBeenCalledWith("workspace-1");
    expect(shell.subscribeTerminalManagerSnapshot).toHaveBeenCalledWith("workspace-1");
    expect(shell.requestGitRefresh).not.toHaveBeenCalled();
    expect(shell.requestTerminalManagerRefresh).not.toHaveBeenCalled();
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

    await user.click(screen.getAllByRole("button", { name: /新建会话/ })[0]);
    expect(screen.getByRole("button", { name: /选择工作区 项目一/ })).toHaveTextContent("项目一");
    await user.click(screen.getByRole("button", { name: "Claude Code" }));

    expect(startDraftSession).toHaveBeenCalledWith("workspace-1", "claude-code");
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

  it("会把添加项目和 Clone 项目放进工作区切换弹层", async () => {
    const user = userEvent.setup();

    renderPage();

    await user.click(screen.getByRole("button", { name: "切换工作区" }));

    const dialog = screen.getByRole("dialog", { name: "工作区" });

    expect(within(dialog).getByRole("button", { name: "添加项目" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Clone项目" })).toBeInTheDocument();
  });

  it("移动端添加项目会复用服务器目录导入模态框", async () => {
    const user = userEvent.setup();

    renderPage();

    await user.click(screen.getByRole("button", { name: "切换工作区" }));
    await user.click(screen.getByRole("button", { name: "添加项目" }));

    expect(await screen.findByRole("dialog", { name: "选择服务器目录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建文件夹" })).toBeInTheDocument();
    expect(screen.queryByText("项目路径")).not.toBeInTheDocument();
  });

  it("移动端 Clone 项目会复用桌面端同款 Clone 模态框", async () => {
    const user = userEvent.setup();

    renderPage();

    await user.click(screen.getByRole("button", { name: "切换工作区" }));
    await user.click(screen.getByRole("button", { name: "Clone项目" }));

    expect(await screen.findByRole("dialog", { name: "Clone项目" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择目录" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "认证方式" })).toBeInTheDocument();
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
