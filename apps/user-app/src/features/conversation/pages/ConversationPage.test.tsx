import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { ConversationPage } from "./ConversationPage";

const mockGetProviderCapabilities = vi.fn();
const mockUseWorkbenchShell = vi.fn();
const mockRuntimeStoreInitialize = vi.fn();
const mockRuntimeStoreDestroy = vi.fn();
const mockRuntimeStoreApplyNavigationSession = vi.fn();
const mockQueuedMessageList = vi.fn((_props: unknown) => null);
const mockLiveRuntimeState: any = {
  session: {
    sessionId: "session-live-1",
    workspaceId: "workspace-1",
    provider: "codex",
    providerSessionId: "provider-session-live-1",
    rawStoreRef: "/tmp/session-live-1.jsonl",
    parentSessionId: null,
    forkMethod: null,
    forkSourceType: null,
    forkSourceSessionId: null,
    forkSourceMessageId: null,
    isSubagent: false,
    subagentLabel: null,
    isArchived: false,
    isFavorite: false,
    title: "父会话",
    messageCount: 3,
    lastMessageAt: "2026-04-11T11:00:00.000Z",
    createdAt: "2026-04-11T10:00:00.000Z",
    updatedAt: "2026-04-11T11:00:00.000Z",
    syncStatus: "idle",
    syncCursor: null,
    lastSyncAt: null,
    lastErrorCode: null,
    lastErrorDetail: null,
    resumedAt: null,
    runningState: "idle",
    activitySource: "none",
    lastEventAt: "2026-04-11T11:00:00.000Z",
    completedAt: null,
    lastSeenAt: null,
    activityState: "idle"
  },
  capabilities: null,
  runtimeHasActiveRun: false,
  runtimeCanInterrupt: false,
  messages: [],
  permissionRequests: [],
  queuedMessages: [],
  contextUsage: null,
  historyState: "ready",
  errorCode: null,
  errorDetail: null,
  interruptSource: null,
  loadingOlderMessages: false,
  hasOlderMessages: false,
  connectionState: "connected"
};

vi.mock("../api/conversation-api", async () => {
  const actual = await vi.importActual<typeof import("../api/conversation-api")>(
    "../api/conversation-api"
  );

  return {
    ...actual,
    getProviderCapabilities: (...args: unknown[]) => mockGetProviderCapabilities(...args)
  };
});

vi.mock("../components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

vi.mock("../components/ConnectionBanner", () => ({
  ConnectionBanner: () => null
}));

vi.mock("../components/MessageTimeline", () => ({
  MessageTimeline: () => <div data-testid="timeline">timeline</div>
}));

vi.mock("../components/ComposerPanel", () => ({
  ComposerPanel: () => <div data-testid="composer">composer</div>
}));

vi.mock("../components/SessionHeader", () => ({
  SessionHeader: () => <div data-testid="session-header">header</div>
}));

vi.mock("../components/SessionButlerActionButton", () => ({
  SessionButlerActionButton: () => null
}));

vi.mock("../components/ConversationSelectionActions", () => ({
  ConversationSelectionActions: () => null
}));

vi.mock("../components/PermissionRequestList", () => ({
  PermissionRequestList: () => null
}));

vi.mock("../components/QueuedMessageList", () => ({
  QueuedMessageList: (props: unknown) => mockQueuedMessageList(props)
}));

vi.mock("../components/MobileConversationSessionActions", () => ({
  MobileConversationSessionActions: () => null
}));

vi.mock("../components/SessionBranchTreePanel", () => ({
  SessionBranchTreePanel: () => null,
  buildSessionBranchTreeModel: () => [],
  hasSessionBranchRelations: () => false
}));

vi.mock("../components/FileContextPanel", () => ({
  FileContextPanel: ({
    sessionId,
    workspaceId
  }: {
    sessionId: string;
    workspaceId: string;
  }) => (
    <div data-testid="file-context-panel">
      files:{workspaceId}:{sessionId}
    </div>
  )
}));

vi.mock("../components/GitSidebar", () => ({
  GitSidebar: ({
    workspaceId
  }: {
    workspaceId: string;
  }) => <div data-testid="git-sidebar">git:{workspaceId}</div>
}));

vi.mock("../../workbench/components/TerminalManagerPanel", () => ({
  TerminalManagerPanel: ({
    currentWorkspaceId
  }: {
    currentWorkspaceId: string;
  }) => <div data-testid="process-panel">processes:{currentWorkspaceId}</div>
}));

vi.mock("../runtime/session-runtime-store", () => ({
  SessionRuntimeStore: class {
    initialize = mockRuntimeStoreInitialize;
    destroy = mockRuntimeStoreDestroy;
    applyNavigationSession = mockRuntimeStoreApplyNavigationSession;
    reconnect = vi.fn();
    loadOlderMessages = vi.fn();
    retryMessage = vi.fn();
    replyPermissionRequest = vi.fn();
    enqueueMessage = vi.fn();
    interrupt = vi.fn();
    deleteQueuedMessage = vi.fn();
    steerQueuedMessage = vi.fn();
    sendMessage = vi.fn();
  },
  useSessionRuntimeStore: (_store: unknown, selector: (state: typeof mockLiveRuntimeState) => unknown) =>
    selector(mockLiveRuntimeState)
}));

describe("ConversationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueuedMessageList.mockClear();
    mockLiveRuntimeState.session = {
      ...mockLiveRuntimeState.session,
      provider: "codex",
      runningState: "idle",
      activityState: "idle"
    };
    mockLiveRuntimeState.capabilities = null;
    mockLiveRuntimeState.runtimeHasActiveRun = false;
    mockLiveRuntimeState.queuedMessages = [];
    window.localStorage.clear();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390
    });

    mockGetProviderCapabilities.mockResolvedValue({
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
    });

    mockUseWorkbenchShell.mockReturnValue(createMobileWorkbenchShellValue());
  });

  it("Codex 运行态由 runtime 快照维持时，发送队列仍会显示引导入口", async () => {
    mockLiveRuntimeState.session = {
      ...mockLiveRuntimeState.session,
      provider: "codex",
      runningState: "idle",
      activityState: "idle"
    };
    mockLiveRuntimeState.capabilities = {
      provider: "codex",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "streaming_guidance",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      modelOptions: [{ id: "provider-default", name: "跟随 CLI 默认模型", usesProviderDefault: true }],
      limitations: []
    };
    mockLiveRuntimeState.runtimeHasActiveRun = true;
    mockLiveRuntimeState.queuedMessages = [
      {
        id: "queue-1",
        sessionId: "session-live-1",
        content: "把这条继续发给当前 Codex 会话",
        status: "queued",
        orderIndex: 1,
        errorDetail: null,
        createdAt: "2026-04-18T08:00:00.000Z",
        updatedAt: "2026-04-18T08:00:00.000Z"
      }
    ];

    renderLiveConversationPage();

    await waitFor(() => {
      const lastCall = mockQueuedMessageList.mock.calls[mockQueuedMessageList.mock.calls.length - 1];
      const props = lastCall?.[0] as { canSteer?: boolean } | undefined;
      expect(props?.canSteer).toBe(true);
    });
  });

  it("移动端在草稿对话页左滑会打开文件页", async () => {
    window.localStorage.setItem("mobile.conversation.preview.mode", "immersive");
    const view = renderDraftConversationPage({ withRouteProbe: true });
    const stage = view.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      changedTouches: [{ clientX: 320, clientY: 180 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 180, clientY: 186 }]
    });

    expect(await screen.findByTestId("file-context-panel")).toHaveTextContent(
      "files:workspace-1:draft-codex-1"
    );
    expect(screen.getByTestId("route-probe")).toHaveTextContent(
      "/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1&toolPanel=files"
    );
  });

  it("移动端在草稿对话页右滑会打开会话列表", async () => {
    const view = renderDraftConversationPage();
    const stage = view.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      touches: [{ clientX: 24, clientY: 180 }]
    });
    fireEvent.touchMove(stage, {
      touches: [{ clientX: 140, clientY: 184 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 140, clientY: 184 }]
    });

    expect(await screen.findByText("历史会话 Alpha")).toBeInTheDocument();
    expect(view.container.querySelector(".mobile-conversation-preview-rail")).toBeInTheDocument();
  });

  it("移动端会话列表会显示收藏会话和归档入口，没有收藏时会自动隐藏收藏分组", async () => {
    mockUseWorkbenchShell.mockReturnValue(
      createMobileWorkbenchShellValue({
        favoriteSessions: [
          {
            workspace: {
              id: "workspace-1",
              name: "工作区一",
              path: "/Users/jackson/workspace-1"
            },
            session: {
              sessionId: "session-1",
              workspaceId: "workspace-1",
              provider: "codex",
              providerSessionId: "provider-session-1",
              rawStoreRef: "store://session-1",
              parentSessionId: null,
              forkMethod: null,
              forkSourceType: null,
              forkSourceSessionId: null,
              forkSourceMessageId: null,
              isSubagent: false,
              subagentLabel: null,
              isArchived: false,
              isFavorite: true,
              title: "历史会话 Alpha",
              messageCount: 4,
              lastMessageAt: "2026-03-28T08:00:00.000Z",
              createdAt: "2026-03-28T07:50:00.000Z",
              updatedAt: "2026-03-28T08:00:00.000Z",
              syncStatus: "idle",
              syncCursor: null,
              lastSyncAt: null,
              lastErrorCode: null,
              lastErrorDetail: null,
              resumedAt: null,
              runningState: "idle",
              activitySource: "none",
              lastEventAt: "2026-03-28T08:00:00.000Z",
              completedAt: null,
              lastSeenAt: null,
              activityState: "idle"
            }
          }
        ],
        navigationGroups: [
          {
            workspace: {
              id: "workspace-1",
              name: "工作区一",
              path: "/Users/jackson/workspace-1"
            },
            sessions: [
              {
                sessionId: "session-1",
                workspaceId: "workspace-1",
                provider: "codex",
                providerSessionId: "provider-session-1",
                rawStoreRef: "store://session-1",
                parentSessionId: null,
                forkMethod: null,
                forkSourceType: null,
                forkSourceSessionId: null,
                forkSourceMessageId: null,
                isSubagent: false,
                subagentLabel: null,
                isArchived: false,
                isFavorite: true,
                title: "历史会话 Alpha",
                messageCount: 4,
                lastMessageAt: "2026-03-28T08:00:00.000Z",
                createdAt: "2026-03-28T07:50:00.000Z",
                updatedAt: "2026-03-28T08:00:00.000Z",
                syncStatus: "idle",
                syncCursor: null,
                lastSyncAt: null,
                lastErrorCode: null,
                lastErrorDetail: null,
                resumedAt: null,
                runningState: "idle",
                activitySource: "none",
                lastEventAt: "2026-03-28T08:00:00.000Z",
                completedAt: null,
                lastSeenAt: null,
                activityState: "idle"
              },
              {
                sessionId: "archived-1",
                workspaceId: "workspace-1",
                provider: "codex",
                providerSessionId: "provider-session-archived-1",
                rawStoreRef: "store://archived-1",
                parentSessionId: null,
                forkMethod: null,
                forkSourceType: null,
                forkSourceSessionId: null,
                forkSourceMessageId: null,
                isSubagent: false,
                subagentLabel: null,
                isArchived: true,
                isFavorite: false,
                title: "归档会话一",
                messageCount: 2,
                lastMessageAt: "2026-03-27T08:00:00.000Z",
                createdAt: "2026-03-27T07:50:00.000Z",
                updatedAt: "2026-03-27T08:00:00.000Z",
                syncStatus: "idle",
                syncCursor: null,
                lastSyncAt: null,
                lastErrorCode: null,
                lastErrorDetail: null,
                resumedAt: null,
                runningState: "idle",
                activitySource: "none",
                lastEventAt: "2026-03-27T08:00:00.000Z",
                completedAt: null,
                lastSeenAt: null,
                activityState: "idle"
              }
            ]
          }
        ]
      })
    );

    const view = renderLiveConversationPage();
    const stage = view.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      touches: [{ clientX: 24, clientY: 180 }]
    });
    fireEvent.touchMove(stage, {
      touches: [{ clientX: 140, clientY: 184 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 140, clientY: 184 }]
    });

    expect(await screen.findByText(t("shell.favoriteSectionTitle"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.archiveCurrentSessionAction") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.archiveFolderLabel") })).toBeInTheDocument();

    view.unmount();
    mockUseWorkbenchShell.mockReturnValue(createMobileWorkbenchShellValue());

    const rerendered = renderDraftConversationPage();
    const nextStage = rerendered.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(nextStage, {
      touches: [{ clientX: 24, clientY: 180 }]
    });
    fireEvent.touchMove(nextStage, {
      touches: [{ clientX: 140, clientY: 184 }]
    });
    fireEvent.touchEnd(nextStage, {
      changedTouches: [{ clientX: 140, clientY: 184 }]
    });

    expect(await screen.findByText("历史会话 Alpha")).toBeInTheDocument();
    expect(screen.queryByText(t("shell.favoriteSectionTitle"))).not.toBeInTheDocument();
  });

  it("旧文件入口带来的 toolPanel 参数会自动打开对应面板", async () => {
    renderDraftConversationPage({
      initialEntry:
        "/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1&toolPanel=git"
    });

    expect(await screen.findByTestId("git-sidebar")).toHaveTextContent("git:workspace-1");
  });

  it("工具页里右滑会回到对话页", async () => {
    const view = renderDraftConversationPage({
      initialEntry:
        "/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1&toolPanel=files",
      withRouteProbe: true
    });
    const panelButton = await screen.findByRole("button", {
      name: t("shell.mobileConversationToolCloseAction")
    });
    const panel = panelButton.closest(".mobile-conversation-tool-panel") as HTMLElement;

    fireEvent.touchStart(panel, {
      changedTouches: [{ clientX: 84, clientY: 160 }]
    });
    fireEvent.touchEnd(panel, {
      changedTouches: [{ clientX: 180, clientY: 164 }]
    });

    await waitFor(() => {
      expect(screen.queryByTestId("file-context-panel")).not.toBeInTheDocument();
      expect(screen.getByTestId("route-probe")).toHaveTextContent(
        "/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1"
      );
    });

    expect(view.container.querySelector(".mobile-conversation-tool-panel")).toBeNull();
  });

  it("工具页标签切换会同步更新查询参数", async () => {
    renderDraftConversationPage({
      initialEntry:
        "/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1&toolPanel=files",
      withRouteProbe: true
    });

    fireEvent.click(await screen.findByRole("tab", { name: t("shell.gitEntry") }));

    await waitFor(() => {
      expect(screen.getByTestId("git-sidebar")).toBeInTheDocument();
      expect(screen.getByTestId("route-probe")).toHaveTextContent(
        "/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1&toolPanel=git"
      );
    });
  });

  it("工具页支持左滑切换到 Git 和进程，并在 files 上右滑返回对话页", async () => {
    const view = renderDraftConversationPage({
      initialEntry:
        "/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1&toolPanel=files",
      withRouteProbe: true
    });
    const panel = await screen.findByRole("button", {
      name: t("shell.mobileConversationToolCloseAction")
    });
    const panelRoot = panel.closest(".mobile-conversation-tool-panel") as HTMLElement;

    expect(screen.queryByTestId("composer")).not.toBeInTheDocument();

    fireEvent.touchStart(panelRoot, {
      changedTouches: [{ clientX: 240, clientY: 180 }]
    });
    fireEvent.touchEnd(panelRoot, {
      changedTouches: [{ clientX: 110, clientY: 186 }]
    });

    await waitFor(() => {
      expect(screen.getByTestId("git-sidebar")).toBeInTheDocument();
      expect(screen.getByTestId("route-probe")).toHaveTextContent("toolPanel=git");
    });

    fireEvent.touchStart(panelRoot, {
      changedTouches: [{ clientX: 240, clientY: 180 }]
    });
    fireEvent.touchEnd(panelRoot, {
      changedTouches: [{ clientX: 104, clientY: 188 }]
    });

    await waitFor(() => {
      expect(screen.getByTestId("process-panel")).toHaveTextContent("processes:workspace-1");
      expect(screen.getByTestId("route-probe")).toHaveTextContent("toolPanel=processes");
    });

    fireEvent.touchStart(panelRoot, {
      changedTouches: [{ clientX: 88, clientY: 176 }]
    });
    fireEvent.touchEnd(panelRoot, {
      changedTouches: [{ clientX: 184, clientY: 182 }]
    });

    await waitFor(() => {
      expect(screen.getByTestId("git-sidebar")).toBeInTheDocument();
      expect(screen.getByTestId("route-probe")).toHaveTextContent("toolPanel=git");
    });

    fireEvent.touchStart(panelRoot, {
      changedTouches: [{ clientX: 88, clientY: 176 }]
    });
    fireEvent.touchEnd(panelRoot, {
      changedTouches: [{ clientX: 184, clientY: 182 }]
    });

    await waitFor(() => {
      expect(screen.getByTestId("file-context-panel")).toBeInTheDocument();
      expect(screen.getByTestId("route-probe")).toHaveTextContent("toolPanel=files");
    });

    fireEvent.touchStart(panelRoot, {
      changedTouches: [{ clientX: 88, clientY: 176 }]
    });
    fireEvent.touchEnd(panelRoot, {
      changedTouches: [{ clientX: 184, clientY: 182 }]
    });

    await waitFor(() => {
      expect(view.container.querySelector(".mobile-conversation-tool-panel")).toBeNull();
      expect(screen.getByTestId("composer")).toBeInTheDocument();
      expect(screen.getByTestId("route-probe")).toHaveTextContent(
        "/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1"
      );
    });
  });

  it("会话列表展开时左滑主舞台只会收起列表，不会切到工具页", async () => {
    const view = renderDraftConversationPage();
    const stage = view.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      touches: [{ clientX: 300, clientY: 180 }],
      changedTouches: [{ clientX: 300, clientY: 180 }]
    });
    fireEvent.touchMove(stage, {
      touches: [{ clientX: 168, clientY: 186 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 168, clientY: 186 }]
    });

    await waitFor(() => {
      expect(view.container.querySelector(".mobile-conversation-preview-rail")).toBeNull();
      expect(view.container.querySelector(".mobile-conversation-tool-panel")).toBeNull();
    });

    fireEvent.touchStart(stage, {
      changedTouches: [{ clientX: 320, clientY: 180 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 180, clientY: 186 }]
    });

    await waitFor(() => {
      expect(screen.getByTestId("file-context-panel")).toBeInTheDocument();
    });
  });

  it("工具页在标签按钮上也支持左右滑动切换标签", async () => {
    window.localStorage.setItem("mobile.conversation.preview.mode", "immersive");
    renderDraftConversationPage({
      initialEntry:
        "/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1&toolPanel=files",
      withRouteProbe: true
    });

    const filesTab = await screen.findByRole("tab", { name: t("shell.filesEntry") });

    fireEvent.touchStart(filesTab, {
      changedTouches: [{ clientX: 240, clientY: 180 }]
    });
    fireEvent.touchEnd(filesTab, {
      changedTouches: [{ clientX: 112, clientY: 186 }]
    });

    await waitFor(() => {
      expect(screen.getByTestId("git-sidebar")).toBeInTheDocument();
      expect(screen.getByTestId("route-probe")).toHaveTextContent("toolPanel=git");
    });
  });

  it("移动端点击顶部工作区切换后，仍会进入目标工作区会话列表", async () => {
    const selectWorkspace = vi.fn();
    mockUseWorkbenchShell.mockReturnValue(
      createMobileWorkbenchShellValue({
        selectWorkspace,
        navigationGroups: [
          {
            workspace: {
              id: "workspace-1",
              name: "工作区一",
              path: "/Users/jackson/workspace-1"
            },
            sessions: []
          },
          {
            workspace: {
              id: "workspace-2",
              name: "工作区二",
              path: "/Users/jackson/workspace-2"
            },
            sessions: []
          }
        ]
      })
    );

    renderDraftConversationPage({ withRouteProbe: true });

    fireEvent.click(screen.getByRole("button", { name: t("shell.workspaceHomeSwitcherLabel") }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: /工作区二/
      })
    );

    await waitFor(() => {
      expect(selectWorkspace).toHaveBeenCalledWith("workspace-2");
      expect(screen.getByTestId("route-probe")).toHaveTextContent("/workspaces/workspace-2/sessions");
    });
  });
});

function renderDraftConversationPage(options?: {
  initialEntry?: string;
  withRouteProbe?: boolean;
}) {
  const initialEntry =
    options?.initialEntry
    ?? "/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1";
  const withRouteProbe = options?.withRouteProbe ?? false;

  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/workspaces/:workspaceId/sessions/:sessionId"
          element={
            <>
              <ConversationPage />
              {withRouteProbe ? <RouteProbe /> : null}
            </>
          }
        />
        <Route
          path="/workspaces/:workspaceId/sessions"
          element={withRouteProbe ? <RouteProbe /> : null}
        />
      </Routes>
    </MemoryRouter>
  );
}

function renderLiveConversationPage(options?: {
  initialEntry?: string;
  withRouteProbe?: boolean;
}) {
  const initialEntry =
    options?.initialEntry
    ?? "/workspaces/workspace-1/sessions/session-live-1";
  const withRouteProbe = options?.withRouteProbe ?? false;

  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/workspaces/:workspaceId/sessions/:sessionId"
          element={
            <>
              <ConversationPage />
              {withRouteProbe ? <RouteProbe /> : null}
            </>
          }
        />
        <Route
          path="/workspaces/:workspaceId/sessions"
          element={withRouteProbe ? <RouteProbe /> : null}
        />
      </Routes>
    </MemoryRouter>
  );
}

function createMobileWorkbenchShellValue(overrides: Record<string, unknown> = {}) {
  return {
    shellMode: "mobile",
    navigationGroups: [
      {
        workspace: {
          id: "workspace-1",
          name: "工作区一",
          path: "/Users/jackson/workspace-1"
        },
        sessions: [
          {
            sessionId: "session-1",
            workspaceId: "workspace-1",
            provider: "codex",
            providerSessionId: "provider-session-1",
            rawStoreRef: "store://session-1",
            parentSessionId: null,
            forkMethod: null,
            forkSourceType: null,
            forkSourceSessionId: null,
            forkSourceMessageId: null,
            isSubagent: false,
            subagentLabel: null,
            isArchived: false,
            isFavorite: false,
            title: "历史会话 Alpha",
            messageCount: 4,
            lastMessageAt: "2026-03-28T08:00:00.000Z",
            createdAt: "2026-03-28T07:50:00.000Z",
            updatedAt: "2026-03-28T08:00:00.000Z",
            syncStatus: "idle",
            syncCursor: null,
            lastSyncAt: null,
            lastErrorCode: null,
            lastErrorDetail: null,
            resumedAt: null,
            runningState: "idle",
            activitySource: "none",
            lastEventAt: "2026-03-28T08:00:00.000Z",
            completedAt: null,
            lastSeenAt: null,
            activityState: "idle"
          }
        ]
      }
    ],
    requestNavigationRefresh: vi.fn(),
    selectWorkspace: vi.fn(),
    setSessionWorkspace: vi.fn(),
    upsertNavigationSession: vi.fn(),
    markNavigationSessionSeen: vi.fn(),
    favoriteSessions: [],
    archiveSession: vi.fn(),
    unarchiveSession: vi.fn(),
    startDraftSession: vi.fn(),
    ...overrides
  };
}

function RouteProbe() {
  const location = useLocation();
  return <div data-testid="route-probe">{location.pathname + location.search}</div>;
}
