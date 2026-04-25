import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { writeParallelGroupTransitionSignal } from "../parallel-session-display";
import { ParallelConversationGroupView } from "./ParallelConversationGroupView";

const mockGetParallelGroupDetail = vi.fn();
const mockDeleteSession = vi.fn();
const mockListProviderCapabilities = vi.fn();
const mockNavigate = vi.fn();
const mockRequestNavigationRefresh = vi.fn();
const mockSelectWorkspace = vi.fn();
const mockRefreshWorktreeMergePreview = vi.fn();
const mockApplyWorktreeMerge = vi.fn();
const mockRequestWorktreeCleanup = vi.fn();
const mockShowToast = vi.fn();
const mockShowNotification = vi.fn();
let latestComposerPanelProps: {
  isRunning?: boolean;
  canInterrupt?: boolean | null;
  hasActiveRun?: boolean | null;
  initialModel?: string | null;
} | null = null;
let mockPermissionRequests: Array<Record<string, unknown>> = [];
let mockNavigationGroups: Array<{
  workspace: {
    id: string;
    name: string;
    path: string;
    backgroundColor: string | null;
    createdAt: string;
    updatedAt: string;
  };
  sessions: Array<Record<string, unknown>>;
    childWorktrees: Array<Record<string, unknown>>;
  }> = [];

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");

  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

vi.mock("../../../platform/platform-provider", () => ({
  usePlatform: () => ({
    isDesktop: false,
    bridge: {
      supported: false,
      showNotification: mockShowNotification
    },
    ui: {
      osFamily: "macos"
    }
  })
}));

vi.mock("../../../preferences/local-ui-preference-store", () => ({
  useLocalUiPreferenceSelector: (selector: (state: {
    notificationPreferences: { notifyOnPermissionRequest: boolean };
  }) => unknown) =>
    selector({
      notificationPreferences: {
        notifyOnPermissionRequest: true
      }
    })
}));

vi.mock("../../../shared/toast", () => ({
  useToast: () => ({
    showToast: mockShowToast
  })
}));

vi.mock("./WorkbenchLayout", () => ({
  useWorkbenchShell: () => ({
    navigationGroups: mockNavigationGroups,
    requestNavigationRefresh: mockRequestNavigationRefresh,
    selectWorkspace: mockSelectWorkspace,
    upsertNavigationSession: vi.fn(),
    markNavigationSessionSeen: vi.fn(),
    worktreeMergeStateById: {},
    refreshWorktreeMergePreview: mockRefreshWorktreeMergePreview,
    applyWorktreeMerge: mockApplyWorktreeMerge,
    requestWorktreeCleanup: mockRequestWorktreeCleanup
  }),
  WorktreeMergePanel: (props: { meta: { workspaceId: string } }) => (
    <div data-testid="worktree-merge-panel" data-workspace-id={props.meta.workspaceId}>
      工作树合并
    </div>
  )
}));

vi.mock("../api/conversation-api", async () => {
  const actual = await vi.importActual<typeof import("../api/conversation-api")>(
    "../api/conversation-api"
  );

  return {
    ...actual,
    deleteSession: (...args: unknown[]) => mockDeleteSession(...args),
    getParallelGroupDetail: (...args: unknown[]) => mockGetParallelGroupDetail(...args),
    listProviderCapabilities: (...args: unknown[]) => mockListProviderCapabilities(...args),
    promoteSessionIsolatedWorkspace: vi.fn(),
    forkSession: vi.fn(),
    sendLiveMessage: vi.fn()
  };
});

vi.mock("./ComposerPanel", () => ({
  ComposerPanel: (props: {
    isRunning?: boolean;
    canInterrupt?: boolean | null;
    hasActiveRun?: boolean | null;
    initialModel?: string | null;
  }) => {
    latestComposerPanelProps = props;

    return (
      <div
        data-testid="composer-panel"
        data-is-running={String(props.isRunning)}
        data-can-interrupt={String(props.canInterrupt)}
        data-has-active-run={String(props.hasActiveRun)}
      />
    );
  }
}));

vi.mock("./ConnectionBanner", () => ({
  ConnectionBanner: () => null
}));

vi.mock("./MessageTimeline", () => ({
  MessageTimeline: () => <div data-testid="message-timeline" />
}));

vi.mock("./PermissionRequestList", () => ({
  PermissionRequestList: () => null
}));

vi.mock("./QueuedMessageList", () => ({
  QueuedMessageList: () => null
}));

vi.mock("./FileContextPanel", () => ({
  FileContextPanel: (props: { workspaceId: string }) => (
    <div data-testid="parallel-tools-files" data-workspace-id={props.workspaceId}>
      文件面板
    </div>
  )
}));

vi.mock("./GitSidebar", () => ({
  GitSidebar: (props: { workspaceId: string }) => (
    <div data-testid="parallel-tools-git" data-workspace-id={props.workspaceId}>
      Git 面板
    </div>
  )
}));

vi.mock("../../workbench/components/TerminalManagerPanel", () => ({
  TerminalManagerPanel: (props: { currentWorkspaceId: string }) => (
    <div data-testid="parallel-tools-processes" data-workspace-id={props.currentWorkspaceId}>
      进程面板
    </div>
  )
}));

vi.mock("../../terminal/pages/TerminalPage", () => ({
  TerminalPage: (props: { externalWindowWorkspaceId?: string | null }) => (
    <div data-testid="parallel-tools-terminal" data-workspace-id={props.externalWindowWorkspaceId ?? ""}>
      终端面板
    </div>
  )
}));

vi.mock("../runtime/session-runtime-store", () => {
  class MockSessionRuntimeStore {
    state: Record<string, unknown>;

    constructor(_sessionId: string, options: { initialSession: Record<string, unknown> }) {
      this.state = {
        session: options.initialSession,
        capabilities: {
          provider: (options.initialSession.provider as string) ?? "codex"
        },
        runtimeHasActiveRun: false,
        runtimeCanInterrupt: false,
        messages: [],
        permissionRequests: mockPermissionRequests,
        queuedMessages: [],
        contextUsage: {
          modelId: "codex-max"
        },
        historyState: "idle",
        interruptSource: null,
        loadingOlderMessages: false,
        hasOlderMessages: false,
        connectionState: "connected"
      };
    }

    initialize() {
      return Promise.resolve();
    }

    destroy() {}

    applyNavigationSession(session: Record<string, unknown>) {
      this.state.session = session;
    }

    reconnect() {}

    loadOlderMessages() {
      return Promise.resolve();
    }

    retryMessage() {
      return Promise.resolve();
    }

    enqueueMessage() {
      return Promise.resolve();
    }

    sendMessage() {
      return Promise.resolve();
    }

    replyPermissionRequest() {
      return Promise.resolve();
    }

    deleteQueuedMessage() {
      return Promise.resolve();
    }

    steerQueuedMessage() {
      return Promise.resolve();
    }

    interruptRun() {
      return Promise.resolve();
    }
  }

  return {
    SessionRuntimeStore: MockSessionRuntimeStore,
    useSessionRuntimeStore: <T,>(
      store: { state: Record<string, unknown> },
      selector: (state: Record<string, unknown>) => T
    ) => selector(store.state)
  };
});

describe("ParallelConversationGroupView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latestComposerPanelProps = null;
    mockPermissionRequests = [];
    mockDeleteSession.mockResolvedValue(undefined);
    mockListProviderCapabilities.mockResolvedValue({
      codex: {
        provider: "codex",
        canStartSession: true,
        canResumeSession: true,
        canSendMessage: true,
        inRunInputMode: "none",
        supportsSubagents: false,
        supportsInterrupt: true,
        supportsStructuredToolCalls: true,
        supportsTokenUsage: true,
        supportsAttachments: true,
        supportsPermissionPrompt: true,
        supportsCheckpoint: false,
        modelOptions: [{ id: "provider-default", name: "跟随 CLI 默认模型", usesProviderDefault: true }],
        limitations: []
      }
    });
    const detail = createDetail();
    mockNavigationGroups = [
      {
        workspace: {
          id: "workspace-1",
          name: "TEST",
          path: "/Users/jackson/Code/TEST",
          backgroundColor: null,
          createdAt: "2026-04-23T12:00:00.000Z",
          updatedAt: "2026-04-23T12:00:00.000Z"
        },
        sessions: [
          {
            ...detail.members[0].session,
            sessionIsolatedWorkspace: null
          }
        ],
        childWorktrees: []
      }
    ];
    mockGetParallelGroupDetail.mockResolvedValue(detail);
  });

  it("会在 pane 头部显示工具按钮，并且在信息悬浮框里展示色板与移除入口", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ParallelConversationGroupView
          groupId="parallel-group-1"
          currentSessionId="session-1"
        />
      </MemoryRouter>
    );

    const panePrompt = await screen.findByText("原版风格");
    const pane = panePrompt.closest(".parallel-conversation-pane");

    if (!(pane instanceof HTMLElement)) {
      throw new Error("未找到并行 pane");
    }

    const paneScope = within(pane);

    expect(paneScope.queryByText("parallel/original")).not.toBeInTheDocument();

    await user.click(paneScope.getByRole("button", { name: t("shell.parallelPaneToolsAction") }));
    expect(await screen.findByText(t("shell.filesEntry"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.gitEntry"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.parallelPaneProcessesEntry"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.terminalsEntry"))).toBeInTheDocument();
    expect(screen.getByTestId("parallel-tools-files")).toBeInTheDocument();
    expect(screen.getByTestId("parallel-tools-files")).toHaveAttribute("data-workspace-id", "workspace-isolated-1");

    await user.click(screen.getByRole("tab", { name: t("shell.gitEntry") }));
    expect(screen.getByTestId("parallel-tools-git")).toBeInTheDocument();
    expect(screen.getByTestId("parallel-tools-git")).toHaveAttribute("data-workspace-id", "workspace-isolated-1");

    await user.click(screen.getByRole("tab", { name: t("shell.parallelPaneProcessesEntry") }));
    expect(screen.getByTestId("parallel-tools-processes")).toBeInTheDocument();
    expect(screen.getByTestId("parallel-tools-processes")).toHaveAttribute(
      "data-workspace-id",
      "workspace-isolated-1"
    );

    await user.click(screen.getByRole("tab", { name: t("shell.terminalsEntry") }));
    expect(screen.getByTestId("parallel-tools-terminal")).toBeInTheDocument();
    expect(screen.getByTestId("parallel-tools-terminal")).toHaveAttribute(
      "data-workspace-id",
      "workspace-isolated-1"
    );
    const pinButton = screen.getByRole("button", { name: t("shell.parallelPanePinAction") });
    expect(pinButton).toBeInTheDocument();
    expect(pinButton.querySelector("svg")).not.toBeNull();
    const closeButton = screen.getByRole("button", { name: t("common.close") });
    expect(closeButton).toBeInTheDocument();
    expect(closeButton.querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("button", { name: t("shell.parallelPaneResizeAction") })).toBeInTheDocument();

    await user.click(paneScope.getByRole("button", { name: t("shell.parallelPaneInfoAction") }));
    expect(paneScope.queryByRole("button", { name: t("shell.parallelPaneMoreAction") })).not.toBeInTheDocument();
    expect(await screen.findByText(t("shell.parallelPaneInfoTitle"))).toBeInTheDocument();
    expect(screen.getByText("parallel/original")).toBeInTheDocument();
    expect(screen.getByText(t("shell.parallelPaneColorPaletteLabel"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.parallelPaneRemoveAction") })).toBeInTheDocument();
  });

  it("在信息悬浮框点击移除并行会话后，会删除会话并刷新当前视图", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ParallelConversationGroupView
          groupId="parallel-group-1"
          currentSessionId="session-1"
        />
      </MemoryRouter>
    );

    const panePrompt = await screen.findByText("原版风格");
    const pane = panePrompt.closest(".parallel-conversation-pane");

    if (!(pane instanceof HTMLElement)) {
      throw new Error("未找到并行 pane");
    }

    const paneScope = within(pane);

    await user.click(paneScope.getByRole("button", { name: t("shell.parallelPaneInfoAction") }));
    await user.click(await screen.findByRole("button", { name: t("shell.parallelPaneRemoveAction") }));

    expect(mockDeleteSession).toHaveBeenCalledWith("session-1");
    expect(mockRequestNavigationRefresh).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/workspaces/workspace-1/sessions");
    expect(await screen.findByText(t("shell.parallelGroupEmpty"))).toBeInTheDocument();
  });

  it("并行 pane 仍处在 runningState 活跃态时，继续向 Composer 暴露可停止状态", async () => {
    const detail = createDetail();
    detail.members[0].session.runningState = "running";
    detail.members[0].session.activityState = "idle";
    mockNavigationGroups = [
      {
        workspace: {
          id: "workspace-1",
          name: "TEST",
          path: "/Users/jackson/Code/TEST",
          backgroundColor: null,
          createdAt: "2026-04-23T12:00:00.000Z",
          updatedAt: "2026-04-23T12:00:00.000Z"
        },
        sessions: [
          {
            ...detail.members[0].session,
            sessionIsolatedWorkspace: null
          }
        ],
        childWorktrees: []
      }
    ];
    mockGetParallelGroupDetail.mockResolvedValueOnce(detail);

    render(
      <MemoryRouter>
        <ParallelConversationGroupView
          groupId="parallel-group-1"
          currentSessionId="session-1"
        />
      </MemoryRouter>
    );

    await screen.findByText("原版风格");

    expect(screen.getByTestId("composer-panel")).toHaveAttribute("data-is-running", "true");
    expect(screen.getByTestId("composer-panel")).toHaveAttribute("data-has-active-run", "true");
    expect(screen.getByTestId("composer-panel")).toHaveAttribute("data-can-interrupt", "false");
    expect(latestComposerPanelProps?.isRunning).toBe(true);
    expect(latestComposerPanelProps?.hasActiveRun).toBe(true);
  });

  it("会把并行成员创建时选择的模型传给 pane Composer", async () => {
    const detail = createDetail();
    (detail.members[0].member as { model: string | null }).model = "gpt-5.1-codex-mini";
    mockGetParallelGroupDetail.mockResolvedValueOnce(detail);

    render(
      <MemoryRouter>
        <ParallelConversationGroupView
          groupId="parallel-group-1"
          currentSessionId="session-1"
        />
      </MemoryRouter>
    );

    await screen.findByText("原版风格");

    expect(latestComposerPanelProps?.initialModel).toBe("gpt-5.1-codex-mini");
  });

  it("当前 pane 收到新的权限申请时会弹出审批提示", async () => {
    mockPermissionRequests = [
      {
        id: "permission-1",
        status: "pending",
        title: "Bash 执行需要授权"
      }
    ];

    render(
      <MemoryRouter>
        <ParallelConversationGroupView
          groupId="parallel-group-1"
          currentSessionId="session-1"
        />
      </MemoryRouter>
    );

    await screen.findByText("原版风格");

    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "parallel-permission-request-permission-1",
        title: t("conversation.permissionRequestToastTitle"),
        description: "Bash 执行需要授权",
        tone: "warning"
      })
    );
    expect(mockShowNotification).toHaveBeenCalledWith(
      t("conversation.permissionRequestToastTitle"),
      "Bash 执行需要授权"
    );
  });

  it("工具窗口默认贴住当前 pane，外部点击和再次点工具按钮都不会直接关掉", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ParallelConversationGroupView
          groupId="parallel-group-1"
          currentSessionId="session-1"
        />
      </MemoryRouter>
    );

    const panePrompt = await screen.findByText("原版风格");
    const pane = panePrompt.closest(".parallel-conversation-pane");

    if (!(pane instanceof HTMLElement)) {
      throw new Error("未找到并行 pane");
    }

    Object.defineProperty(pane, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 80,
        y: 104,
        left: 80,
        top: 104,
        right: 620,
        bottom: 624,
        width: 540,
        height: 520,
        toJSON: () => undefined
      })
    });

    const paneScope = within(pane);
    const toolsTrigger = paneScope.getByRole("button", { name: t("shell.parallelPaneToolsAction") });

    await user.click(toolsTrigger);
    expect(await screen.findByTestId("parallel-tools-files")).toBeInTheDocument();

    const popover = document.querySelector(".parallel-pane-tools-popover");

    if (!(popover instanceof HTMLElement)) {
      throw new Error("未找到工具窗口");
    }

    expect(popover.style.left).toBe("80px");
    expect(popover.style.top).toBe("104px");
    expect(popover.style.width).toBe("540px");
    expect(popover.style.height).toBe("520px");

    fireEvent.pointerDown(document.body);
    expect(document.querySelector(".parallel-pane-tools-popover")).toBe(popover);

    await user.click(toolsTrigger);
    expect(document.querySelector(".parallel-pane-tools-popover")).toBe(popover);

    await user.click(within(popover).getByRole("button", { name: t("common.close") }));
    expect(document.querySelector(".parallel-pane-tools-popover")).toBeNull();
  });

  it("会在标题栏显示追加按钮，并在点击后打开追加弹窗", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ParallelConversationGroupView
          groupId="parallel-group-1"
          currentSessionId="session-1"
        />
      </MemoryRouter>
    );

    const addButton = await screen.findByRole("button", { name: t("shell.parallelAppendAction") });
    expect(addButton).toBeEnabled();

    await user.click(addButton);

    expect(await screen.findByRole("dialog", { name: t("shell.parallelAppendModalTitle") })).toBeInTheDocument();
    const promptField = screen.getByLabelText(t("shell.parallelAppendSharedPromptLabel"));
    expect(promptField).toHaveValue("复制 B 站首页");
    expect(promptField).toHaveAttribute("readonly");
  });

  it("并行成员已满 4 个时会禁用追加按钮", async () => {
    const fullDetail = createDetail();
    fullDetail.group.requestedCount = 4;
    fullDetail.members = [
      fullDetail.members[0],
      createMember("session-2", 1, "成员二"),
      createMember("session-3", 2, "成员三"),
      createMember("session-4", 3, "成员四")
    ];
    mockNavigationGroups = [
      {
        workspace: {
          id: "workspace-1",
          name: "TEST",
          path: "/Users/jackson/Code/TEST",
          backgroundColor: null,
          createdAt: "2026-04-23T12:00:00.000Z",
          updatedAt: "2026-04-23T12:00:00.000Z"
        },
        sessions: fullDetail.members.map((item) => ({
          ...item.session,
          sessionIsolatedWorkspace: item.sessionIsolatedWorkspace ?? null
        })),
        childWorktrees: []
      }
    ];
    mockGetParallelGroupDetail.mockResolvedValueOnce(fullDetail);

    render(
      <MemoryRouter>
        <ParallelConversationGroupView
          groupId="parallel-group-1"
          currentSessionId="session-1"
        />
      </MemoryRouter>
    );

    expect(await screen.findByRole("button", { name: t("shell.parallelAppendAction") })).toBeDisabled();
  });

  it("收到新建并行会话过渡信号后，会把右栏收起和 pane 展示挂到同一段动画参数上", async () => {
    writeParallelGroupTransitionSignal("parallel-group-1", "create");

    render(
      <MemoryRouter>
        <ParallelConversationGroupView
          groupId="parallel-group-1"
          currentSessionId="session-1"
        />
      </MemoryRouter>
    );

    await screen.findByText("原版风格");

    const page = document.querySelector(".parallel-conversation-page");

    if (!(page instanceof HTMLElement)) {
      throw new Error("未找到并行会话页面");
    }

    expect(page).toHaveAttribute("data-parallel-entering", "true");
    expect(page.style.getPropertyValue("--parallel-pane-min-width")).toBe("344px");
    expect(page.style.getPropertyValue("--parallel-pane-enter-delay")).toBe("520ms");
    expect(page.style.getPropertyValue("--parallel-pane-enter-duration")).toBe("1480ms");
    expect(page.style.getPropertyValue("--parallel-shell-expand-duration")).toBe("720ms");
  });
});

function createDetail() {
  return {
    group: {
      id: "parallel-group-1",
      workspaceId: "workspace-1",
      sourceType: "new",
      sourceSessionId: null,
      sourceMessageId: null,
      sharedPrompt: "复制 B 站首页",
      requestedCount: 2,
      anchorSessionId: "session-1",
      status: "active",
      createdByUserId: "user-1",
      createdAt: "2026-04-23T12:00:00.000Z",
      updatedAt: "2026-04-23T12:00:00.000Z",
      deletedAt: null
    },
    members: [
      {
        member: {
          groupId: "parallel-group-1",
          sessionId: "session-1",
          ordinal: 0,
          role: "anchor",
          memberPrompt: "原版风格",
          provider: "codex",
          model: null,
          createdAt: "2026-04-23T12:00:00.000Z",
          updatedAt: "2026-04-23T12:00:00.000Z",
          deletedAt: null
        },
        session: {
          sessionId: "session-1",
          workspaceId: "workspace-1",
          parentSessionId: null,
          provider: "codex",
          title: "原版风格",
          summary: null,
          createdAt: "2026-04-23T12:00:00.000Z",
          updatedAt: "2026-04-23T12:00:00.000Z",
          lastMessageAt: "2026-04-23T12:00:00.000Z",
          activityState: "idle",
          runningState: "idle",
          unreadCount: 0,
          hasActiveRun: false,
          hasPendingPermissionRequest: false,
          forkDepth: 0,
          forkOriginSessionId: null,
          forkOriginMessageId: null,
          forkDraftSourceSessionId: null,
          forkDraftSourceMessageId: null,
          parallelGroup: {
            groupId: "parallel-group-1",
            role: "anchor",
            ordinal: 0,
            anchorSessionId: "session-1",
            displayParentSessionId: null
          },
          sessionIsolatedWorkspace: {
            id: "isolated-1",
            workspaceId: "workspace-isolated-1",
            sourceWorkspaceId: "workspace-1",
            branchName: "parallel/original",
            lifecycleStatus: "active",
            promotedAt: null,
            createdAt: "2026-04-23T12:00:00.000Z",
            updatedAt: "2026-04-23T12:00:00.000Z"
          }
        },
        sessionIsolatedWorkspace: {
          id: "isolated-1",
          workspaceId: "workspace-isolated-1",
          sourceWorkspaceId: "workspace-1",
          branchName: "parallel/original",
          lifecycleStatus: "active",
          promotedAt: null,
          createdAt: "2026-04-23T12:00:00.000Z",
          updatedAt: "2026-04-23T12:00:00.000Z"
        }
      }
    ]
  };
}

function createMember(sessionId: string, ordinal: number, title: string) {
  return {
    member: {
      groupId: "parallel-group-1",
      sessionId,
      ordinal,
      role: ordinal === 0 ? "anchor" : "member",
      memberPrompt: title,
      provider: "codex",
      model: null,
      createdAt: "2026-04-23T12:00:00.000Z",
      updatedAt: "2026-04-23T12:00:00.000Z",
      deletedAt: null
    },
    session: {
      sessionId,
      workspaceId: "workspace-1",
      parentSessionId: null,
      provider: "codex",
      title,
      summary: null,
      createdAt: "2026-04-23T12:00:00.000Z",
      updatedAt: "2026-04-23T12:00:00.000Z",
      lastMessageAt: "2026-04-23T12:00:00.000Z",
      activityState: "idle",
      runningState: "idle",
      unreadCount: 0,
      hasActiveRun: false,
      hasPendingPermissionRequest: false,
      forkDepth: 0,
      forkOriginSessionId: null,
      forkOriginMessageId: null,
      forkDraftSourceSessionId: null,
      forkDraftSourceMessageId: null,
      parallelGroup: {
        groupId: "parallel-group-1",
        role: ordinal === 0 ? "anchor" : "member",
        ordinal,
        anchorSessionId: "session-1",
        displayParentSessionId: ordinal === 0 ? null : "session-1"
      },
      sessionIsolatedWorkspace: null
    },
    sessionIsolatedWorkspace: null
  };
}
