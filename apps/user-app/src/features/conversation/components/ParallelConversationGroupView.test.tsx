import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { ParallelConversationGroupView } from "./ParallelConversationGroupView";

const mockGetParallelGroupDetail = vi.fn();
const mockRequestNavigationRefresh = vi.fn();
const mockSelectWorkspace = vi.fn();
const mockShowToast = vi.fn();
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
  childWorktrees: never[];
}> = [];

vi.mock("../../../platform/platform-provider", () => ({
  usePlatform: () => ({
    isDesktop: false,
    ui: {
      osFamily: "macos"
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
    markNavigationSessionSeen: vi.fn()
  })
}));

vi.mock("../api/conversation-api", async () => {
  const actual = await vi.importActual<typeof import("../api/conversation-api")>(
    "../api/conversation-api"
  );

  return {
    ...actual,
    getParallelGroupDetail: (...args: unknown[]) => mockGetParallelGroupDetail(...args),
    promoteSessionIsolatedWorkspace: vi.fn(),
    forkSession: vi.fn(),
    sendLiveMessage: vi.fn()
  };
});

vi.mock("./ComposerPanel", () => ({
  ComposerPanel: () => <div data-testid="composer-panel" />
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
        permissionRequests: [],
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

  it("会在 pane 头部显示工具按钮，并且能打开工具栏、信息与色板弹层", async () => {
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

    await user.click(paneScope.getByRole("button", { name: t("shell.parallelPaneMoreAction") }));
    expect(await paneScope.findByText(t("shell.parallelPaneColorPaletteLabel"))).toBeInTheDocument();

    await user.click(paneScope.getByRole("button", { name: t("shell.parallelPaneInfoAction") }));
    expect(await paneScope.findByText(t("shell.parallelPaneInfoTitle"))).toBeInTheDocument();
    expect(paneScope.getByText("parallel/original")).toBeInTheDocument();

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
