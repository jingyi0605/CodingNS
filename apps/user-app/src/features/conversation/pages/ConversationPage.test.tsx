import { createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { ConversationPage } from "./ConversationPage";

const mockGetProviderCapabilities = vi.fn();
const mockGetSessionMessages = vi.fn();
const mockStartLiveSession = vi.fn();
const mockForkSession = vi.fn();
const mockSendLiveMessage = vi.fn();
const mockUseWorkbenchShell = vi.fn();
const mockRuntimeStoreInitialize = vi.fn();
const mockRuntimeStoreDestroy = vi.fn();
const mockRuntimeStoreApplyNavigationSession = vi.fn();
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
    getProviderCapabilities: (...args: unknown[]) => mockGetProviderCapabilities(...args),
    getSessionMessages: (...args: unknown[]) => mockGetSessionMessages(...args),
    startLiveSession: (...args: unknown[]) => mockStartLiveSession(...args),
    forkSession: (...args: unknown[]) => mockForkSession(...args),
    sendLiveMessage: (...args: unknown[]) => mockSendLiveMessage(...args)
  };
});

vi.mock("../components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

vi.mock("../components/ConnectionBanner", () => ({
  ConnectionBanner: () => null
}));

vi.mock("../components/MessageTimeline", () => ({
  MessageTimeline: ({
    messages,
    onForkMessage
  }: {
    messages?: Array<{
      id: string;
      role: "user" | "assistant" | "tool" | "system";
      kind: "text" | "thinking" | "tool_call" | "tool_result";
      content: string;
    }>;
    onForkMessage?: (message: {
      id: string;
      role: "user" | "assistant" | "tool" | "system";
      kind: "text" | "thinking" | "tool_call" | "tool_result";
      content: string;
    }) => void;
  }) => (
    <div>
      <div data-testid="timeline-messages">{messages?.map((item) => item.content).join("|") ?? ""}</div>
      <button
        type="button"
        data-testid="timeline-fork"
        onClick={() => {
          onForkMessage?.({
            id: messages?.[0]?.id ?? "assistant-message-1",
            role: messages?.[0]?.role ?? "assistant",
            kind: messages?.[0]?.kind ?? "text",
            content: messages?.[0]?.content ?? "从这个历史点继续分叉"
          });
        }}
      >
        fork
      </button>
    </div>
  )
}));

vi.mock("../components/SessionHeader", () => ({
  SessionHeader: ({
    workspaceContext
  }: {
    workspaceContext?: {
      tone?: string;
      displayName?: string;
      parentDisplayName?: string | null;
    } | null;
  }) => (
    <div data-testid="session-header-context">
      {workspaceContext?.tone ?? "none"}|{workspaceContext?.displayName ?? ""}|{workspaceContext?.parentDisplayName ?? ""}
    </div>
  )
}));

vi.mock("../components/ComposerPanel", () => ({
  ComposerPanel: ({
    capabilities,
    forkDraft,
    onSend
  }: {
    capabilities: { modelOptions?: Array<{ id: string }> } | null;
    forkDraft?: {
      content: string;
      targetProvider: string;
      targetModel: string | null;
    } | null;
    onSend?: (content: string, options?: { attachments?: unknown[]; attachmentMeta?: unknown[] }) => Promise<void>;
  }) => (
    <div>
      <div data-testid="composer-model-options">
        {capabilities?.modelOptions?.map((item) => item.id).join(",") ?? ""}
      </div>
      <div data-testid="composer-fork-draft">{forkDraft?.content ?? ""}</div>
      <div data-testid="composer-fork-provider">{forkDraft?.targetProvider ?? ""}</div>
      <div data-testid="composer-fork-model">{forkDraft?.targetModel ?? ""}</div>
      <button
        type="button"
        data-testid="composer-send"
        onClick={() => {
          void onSend?.("测试消息");
        }}
      >
        send
      </button>
    </div>
  )
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
    mockGetProviderCapabilities.mockReset();
    mockGetSessionMessages.mockReset();
    mockStartLiveSession.mockReset();
    mockForkSession.mockReset();
    mockSendLiveMessage.mockReset();
    mockUseWorkbenchShell.mockReset();
    mockRuntimeStoreInitialize.mockReset();
    mockRuntimeStoreDestroy.mockReset();
    mockRuntimeStoreApplyNavigationSession.mockReset();
    mockLiveRuntimeState.session = {
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
    };
    mockLiveRuntimeState.messages = [];
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390
    });
    window.localStorage.clear();
    mockUseWorkbenchShell.mockReturnValue({
      shellMode: "desktop",
      navigationGroups: [],
      requestNavigationRefresh: vi.fn(),
      setSessionWorkspace: vi.fn(),
      upsertNavigationSession: vi.fn(),
      favoriteSessions: []
    });
  });

  it("分支会话默认折叠继承前缀，展开后再显示完整父会话上下文", async () => {
    mockLiveRuntimeState.session = {
      ...mockLiveRuntimeState.session,
      sessionId: "session-child-1",
      parentSessionId: "session-parent-1",
      forkMethod: "native_message_fork",
      forkSourceType: "message",
      forkSourceSessionId: "session-parent-1",
      forkSourceMessageId: "parent-assistant-1",
      inheritedPrefixMessageCount: 2,
      title: "子会话"
    };
    mockLiveRuntimeState.messages = [
      createHistoryViewMessage("child-user-1", "user", "口令是1314", 1),
      createHistoryViewMessage("child-assistant-1", "assistant", "收到，口令是 1314。", 2),
      createHistoryViewMessage("child-user-2", "user", "现在还记得吗", 3),
      createHistoryViewMessage("child-assistant-2", "assistant", "还记得，口令是 1314。", 4)
    ];
    mockUseWorkbenchShell.mockReturnValue({
      shellMode: "desktop",
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "CodingNS",
            path: "/Users/jackson/Code/CodingNS",
            repoRoot: "/Users/jackson/Code/CodingNS"
          },
          sessions: [
            {
              ...mockLiveRuntimeState.session,
              sessionId: "session-parent-1",
              parentSessionId: null,
              forkMethod: null,
              forkSourceType: null,
              forkSourceSessionId: null,
              forkSourceMessageId: null,
              title: "主会话"
            },
            mockLiveRuntimeState.session
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
      startDraftSession: vi.fn()
    });

    render(
      <MemoryRouter initialEntries={["/workspaces/workspace-1/sessions/session-child-1"]}>
        <Routes>
          <Route
            path="/workspaces/:workspaceId/sessions/:sessionId"
            element={<ConversationPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("timeline-messages")).toHaveTextContent("现在还记得吗|还记得，口令是 1314。");
    });

    expect(screen.getByRole("button", { name: "展开完整上文" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "分支树" })).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: t("conversation.inheritedContextExpand")
      })
    );

    expect(screen.getByTestId("timeline-messages")).toHaveTextContent(
      "口令是1314|收到，口令是 1314。|现在还记得吗|还记得，口令是 1314。"
    );
  });

  it("折叠继承前缀时不会误收起子会话自己的首条消息", async () => {
    mockLiveRuntimeState.session = {
      ...mockLiveRuntimeState.session,
      sessionId: "session-child-2",
      parentSessionId: "session-parent-1",
      forkMethod: "native_message_fork",
      forkSourceType: "message",
      forkSourceSessionId: "session-parent-1",
      forkSourceMessageId: "parent-user-1",
      inheritedPrefixMessageCount: 4,
      title: "子会话"
    };
    mockLiveRuntimeState.messages = [
      createHistoryViewMessage("parent-user-1", "user", "父会话第一句", 1),
      createHistoryViewMessage("parent-assistant-1", "assistant", "父会话第一句回复", 2),
      createHistoryViewMessage("child-user-1", "user", "这是子会话自己的第一句", 5)
    ];
    mockUseWorkbenchShell.mockReturnValue({
      shellMode: "desktop",
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "CodingNS",
            path: "/Users/jackson/Code/CodingNS",
            repoRoot: "/Users/jackson/Code/CodingNS"
          },
          sessions: [
            {
              ...mockLiveRuntimeState.session,
              sessionId: "session-parent-1",
              parentSessionId: null,
              forkMethod: null,
              forkSourceType: null,
              forkSourceSessionId: null,
              forkSourceMessageId: null,
              title: "主会话"
            },
            mockLiveRuntimeState.session
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
      startDraftSession: vi.fn()
    });

    render(
      <MemoryRouter initialEntries={["/workspaces/workspace-1/sessions/session-child-2"]}>
        <Routes>
          <Route
            path="/workspaces/:workspaceId/sessions/:sessionId"
            element={<ConversationPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/已默认折叠从/u)).toBeInTheDocument();
      expect(screen.getByTestId("timeline-messages")).toHaveTextContent("这是子会话自己的第一句");
    });

    expect(screen.getByTestId("timeline-messages")).not.toHaveTextContent("父会话第一句");
    expect(screen.getByTestId("timeline-messages")).not.toHaveTextContent("父会话第一句回复");
  });

  it("消息 fork 的折叠区不会把子会话创建前泄漏进来的父会话尾巴显示出来", async () => {
    mockLiveRuntimeState.session = {
      ...mockLiveRuntimeState.session,
      sessionId: "session-child-3",
      parentSessionId: "session-parent-1",
      forkMethod: "native_message_fork",
      forkSourceType: "message",
      forkSourceSessionId: "session-parent-1",
      forkSourceMessageId: "parent-assistant-1",
      inheritedPrefixMessageCount: 2,
      createdAt: "2026-04-11T11:05:00.000Z",
      title: "子会话"
    };
    mockLiveRuntimeState.messages = [
      {
        ...createHistoryViewMessage("parent-user-1", "user", "父会话第一句", 1),
        timestamp: "2026-04-11T11:00:01.000Z"
      },
      {
        ...createHistoryViewMessage("parent-assistant-1", "assistant", "父会话第一句回复", 2),
        timestamp: "2026-04-11T11:00:02.000Z"
      },
      {
        ...createHistoryViewMessage("parent-user-2", "user", "父会话后来又说了一句", 3),
        timestamp: "2026-04-11T11:02:00.000Z"
      },
      {
        ...createHistoryViewMessage("parent-assistant-2", "assistant", "父会话后来又回了一句", 4),
        timestamp: "2026-04-11T11:03:00.000Z"
      },
      {
        ...createHistoryViewMessage("child-user-1", "user", "这是子会话自己的第一句", 5),
        timestamp: "2026-04-11T11:06:00.000Z"
      }
    ];
    mockUseWorkbenchShell.mockReturnValue({
      shellMode: "desktop",
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "CodingNS",
            path: "/Users/jackson/Code/CodingNS",
            repoRoot: "/Users/jackson/Code/CodingNS"
          },
          sessions: [
            {
              ...mockLiveRuntimeState.session,
              sessionId: "session-parent-1",
              parentSessionId: null,
              forkMethod: null,
              forkSourceType: null,
              forkSourceSessionId: null,
              forkSourceMessageId: null,
              title: "主会话"
            },
            mockLiveRuntimeState.session
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
      startDraftSession: vi.fn()
    });

    render(
      <MemoryRouter initialEntries={["/workspaces/workspace-1/sessions/session-child-3"]}>
        <Routes>
          <Route
            path="/workspaces/:workspaceId/sessions/:sessionId"
            element={<ConversationPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("timeline-messages")).toHaveTextContent("这是子会话自己的第一句");
    });

    expect(screen.getByTestId("timeline-messages")).not.toHaveTextContent("父会话后来又说了一句");
    expect(screen.getByTestId("timeline-messages")).not.toHaveTextContent("父会话后来又回了一句");

    fireEvent.click(
      screen.getByRole("button", {
        name: t("conversation.inheritedContextExpand")
      })
    );

    expect(screen.getByTestId("timeline-messages")).toHaveTextContent(
      "父会话第一句|父会话第一句回复|这是子会话自己的第一句"
    );
    expect(screen.getByTestId("timeline-messages")).not.toHaveTextContent("父会话后来又说了一句");
    expect(screen.getByTestId("timeline-messages")).not.toHaveTextContent("父会话后来又回了一句");
  });

  it("子工作树会话会把当前工作区上下文传给会话头部", async () => {
    mockLiveRuntimeState.session = {
      ...mockLiveRuntimeState.session,
      sessionId: "session-worktree-1",
      workspaceId: "workspace-1-child",
      title: "工作树会话"
    };
    mockUseWorkbenchShell.mockReturnValue({
      shellMode: "desktop",
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "CodingNS",
            path: "/Users/jackson/Code/CodingNS",
            repoRoot: "/Users/jackson/Code/CodingNS"
          },
          sessions: [],
          childWorktrees: [
            {
              workspace: {
                id: "workspace-1-child",
                name: "登录分支",
                path: "/Users/jackson/Code/CodingNS/.worktrees/login",
                repoRoot: "/Users/jackson/Code/CodingNS"
              },
              meta: {
                workspaceId: "workspace-1-child",
                rootWorkspaceId: "workspace-1",
                parentWorkspaceId: "workspace-1",
                sourceWorkspaceId: "workspace-1",
                mergeTargetWorkspaceId: "workspace-1",
                branchName: "feat/login-codex",
                baseRef: "main",
                baseCommit: "commit-base",
                headCommit: "commit-head",
                displayName: "feat/login-codex",
                depth: 1,
                lifecycleStatus: "active",
                mergedAt: null,
                removedAt: null,
                createdAt: "2026-04-12T08:00:00.000Z",
                updatedAt: "2026-04-12T08:00:00.000Z"
              },
              sessions: [mockLiveRuntimeState.session],
              children: []
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
      startDraftSession: vi.fn()
    });

    render(
      <MemoryRouter initialEntries={["/workspaces/workspace-1-child/sessions/session-worktree-1"]}>
        <Routes>
          <Route
            path="/workspaces/:workspaceId/sessions/:sessionId"
            element={<ConversationPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("session-header-context")).toHaveTextContent(
        "worktree|feat/login-codex|CodingNS"
      );
    });
  });

  it("解释型子会话会默认折叠选中文本，并保留提问作为第一条真实用户消息", async () => {
    mockLiveRuntimeState.session = {
      ...mockLiveRuntimeState.session,
      sessionId: "session-annotation-1",
      parentSessionId: "session-parent-1",
      sessionKind: "annotation",
      annotationSourceMessageId: "parent-message-1",
      annotationSourceText: "这段原文需要解释。",
      title: "解释子会话"
    };
    mockLiveRuntimeState.messages = [
      createHistoryViewMessage("annotation-user-1", "user", "这段话到底是什么意思？", 1),
      createHistoryViewMessage("annotation-assistant-1", "assistant", "它的意思是要先看上下文。", 2)
    ];
    mockUseWorkbenchShell.mockReturnValue({
      shellMode: "desktop",
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "CodingNS",
            path: "/Users/jackson/Code/CodingNS",
            repoRoot: "/Users/jackson/Code/CodingNS"
          },
          sessions: [
            {
              ...mockLiveRuntimeState.session,
              sessionId: "session-parent-1",
              parentSessionId: null,
              sessionKind: "default",
              annotationSourceMessageId: null,
              annotationSourceText: null,
              title: "父会话"
            },
            mockLiveRuntimeState.session
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
      startDraftSession: vi.fn()
    });

    render(
      <MemoryRouter initialEntries={["/workspaces/workspace-1/sessions/session-annotation-1"]}>
        <Routes>
          <Route
            path="/workspaces/:workspaceId/sessions/:sessionId"
            element={<ConversationPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("已默认折叠来自“父会话”的一段选中文本。")).toBeInTheDocument();
      expect(screen.getByTestId("timeline-messages")).toHaveTextContent(
        "这段话到底是什么意思？|它的意思是要先看上下文。"
      );
    });

    expect(screen.getByRole("button", { name: "分支树" })).toBeInTheDocument();
    expect(screen.getByTestId("timeline-messages")).not.toHaveTextContent("这段原文需要解释。");

    fireEvent.click(screen.getByRole("button", { name: "展开完整上文" }));

    expect(screen.getByTestId("timeline-messages")).toHaveTextContent(
      "这段原文需要解释。|这段话到底是什么意思？|它的意思是要先看上下文。"
    );
  });

  it("草稿会话会按 provider 和 workspace 拉取真实能力，并替换默认模型列表", async () => {
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
      modelOptions: [
        {
          id: "provider-default",
          name: "跟随 CLI 默认模型",
          usesProviderDefault: true
        },
        {
          id: "gpt-5.4",
          name: "gpt-5.4"
        }
      ],
      limitations: []
    });

    render(
      <MemoryRouter
        initialEntries={["/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1"]}
      >
        <Routes>
          <Route
            path="/workspaces/:workspaceId/sessions/:sessionId"
            element={<ConversationPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    // 首屏先用草稿兜底能力，避免界面空白。
    expect(screen.getByTestId("composer-model-options")).toHaveTextContent("provider-default");

    await waitFor(() => {
      expect(mockGetProviderCapabilities).toHaveBeenCalledWith("codex", "workspace-1");
    });

    await waitFor(() => {
      expect(screen.getByTestId("composer-model-options")).toHaveTextContent(
        "provider-default,gpt-5.4"
      );
    });
  });

  it("草稿会话创建成功后会以后端返回的真实 workspaceId 作为跳转目标", async () => {
    mockGetProviderCapabilities.mockResolvedValue({
      provider: "opencode",
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
    mockStartLiveSession.mockResolvedValue({
      sessionId: "session-created-1",
      acceptedAt: "2026-03-30T00:00:00.000Z",
      clientRequestId: "client-request-1",
      provider: "opencode",
      providerSessionId: "provider-session-1",
      message: {
        messageId: "message-1",
        provider: "opencode",
        providerSessionId: "provider-session-1",
        role: "user",
        content: "测试消息",
        timestamp: "2026-03-30T00:00:00.000Z",
        sequence: 1,
        rawRef: "opencode://session/provider-session-1/message/message-1"
      },
      session: {
        sessionId: "session-created-1",
        workspaceId: "workspace-2",
        provider: "opencode",
        providerSessionId: "provider-session-1",
        rawStoreRef: "opencode://session/provider-session-1",
        parentSessionId: null,
        isSubagent: false,
        subagentLabel: null,
        title: "真实会话",
        messageCount: 1,
        lastMessageAt: "2026-03-30T00:00:00.000Z",
        createdAt: "2026-03-30T00:00:00.000Z",
        updatedAt: "2026-03-30T00:00:00.000Z",
        syncStatus: "idle",
        syncCursor: null,
        lastSyncAt: null,
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "running",
        activitySource: "runtime",
        lastEventAt: "2026-03-30T00:00:00.000Z",
        completedAt: null,
        lastSeenAt: null,
        activityState: "running"
      }
    });
    const setSessionWorkspace = vi.fn();
    const upsertNavigationSession = vi.fn();
    const requestNavigationRefresh = vi.fn();

    mockUseWorkbenchShell.mockReturnValue({
      shellMode: "desktop",
      navigationGroups: [],
      requestNavigationRefresh,
      setSessionWorkspace,
      upsertNavigationSession,
      favoriteSessions: []
    });

    render(
      <MemoryRouter initialEntries={["/workspaces/workspace-1/sessions/draft-opencode-1?provider=opencode"]}>
        <Routes>
          <Route
            path="/workspaces/:workspaceId/sessions/:sessionId"
            element={
              <>
                <ConversationPage />
                <RouteProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId("composer-send"));

    await waitFor(() => {
      expect(mockStartLiveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-1",
          provider: "opencode",
          content: "测试消息"
        })
      );
    });

    await waitFor(() => {
      expect(setSessionWorkspace).toHaveBeenCalledWith("session-created-1", "workspace-2");
      expect(upsertNavigationSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-created-1",
          workspaceId: "workspace-2"
        })
      );
      expect(requestNavigationRefresh).toHaveBeenCalled();
      expect(screen.getByTestId("route-probe")).toHaveTextContent(
        "/workspaces/workspace-2/sessions/session-created-1"
      );
    });
  });

  it("历史消息 fork 会先进入引用态，发送时才真正创建子会话并把首条消息发到子会话", async () => {
    mockLiveRuntimeState.messages = [
      createHistoryViewMessage("assistant-message-1", "assistant", "从这个历史点继续分叉", 1)
    ];
    mockForkSession.mockResolvedValue({
      sessionId: "session-child-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-child-1",
      rawStoreRef: "/tmp/session-child-1.jsonl",
      parentSessionId: "session-live-1",
      forkMethod: "native_message_fork",
      forkSourceType: "message",
      forkSourceSessionId: "session-live-1",
      forkSourceMessageId: "assistant-message-1",
      isSubagent: true,
      subagentLabel: null,
      isArchived: false,
      isFavorite: false,
      title: "父会话",
      messageCount: 0,
      lastMessageAt: "2026-04-11T11:05:00.000Z",
      createdAt: "2026-04-11T11:05:00.000Z",
      updatedAt: "2026-04-11T11:05:00.000Z",
      syncStatus: "idle",
      syncCursor: null,
      lastSyncAt: null,
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      runningState: "idle",
      activitySource: "none",
      lastEventAt: "2026-04-11T11:05:00.000Z",
      completedAt: null,
      lastSeenAt: null,
      activityState: "idle"
    });
    mockSendLiveMessage.mockResolvedValue({
      sessionId: "session-child-1",
      acceptedAt: "2026-04-11T11:05:05.000Z",
      clientRequestId: "client-request-1",
      message: {
        messageId: "message-child-1",
        provider: "codex",
        providerSessionId: "provider-child-1",
        role: "user",
        content: "测试消息",
        timestamp: "2026-04-11T11:05:05.000Z",
        sequence: 1,
        rawRef: "codex://session/provider-child-1/message/message-child-1"
      }
    });
    const setSessionWorkspace = vi.fn();
    const upsertNavigationSession = vi.fn();
    const requestNavigationRefresh = vi.fn();
    const selectWorkspace = vi.fn();

    mockUseWorkbenchShell.mockReturnValue({
      shellMode: "desktop",
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "CodingNS",
            path: "/Users/jackson/Code/CodingNS",
            repoRoot: "/Users/jackson/Code/CodingNS"
          },
          sessions: [mockLiveRuntimeState.session]
        }
      ],
      requestNavigationRefresh,
      selectWorkspace,
      setSessionWorkspace,
      upsertNavigationSession,
      markNavigationSessionSeen: vi.fn(),
      favoriteSessions: [],
      archiveSession: vi.fn(),
      unarchiveSession: vi.fn(),
      startDraftSession: vi.fn()
    });

    render(
      <MemoryRouter initialEntries={["/workspaces/workspace-1/sessions/session-live-1"]}>
        <Routes>
          <Route
            path="/workspaces/:workspaceId/sessions/:sessionId"
            element={
              <>
                <ConversationPage />
                <RouteProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId("timeline-fork"));

    expect(mockForkSession).not.toHaveBeenCalled();
    expect(screen.getByTestId("composer-fork-draft")).toHaveTextContent("从这个历史点继续分叉");
    expect(screen.getByTestId("composer-fork-provider")).toHaveTextContent("codex");
    expect(screen.getByTestId("composer-fork-model")).toHaveTextContent("");

    fireEvent.click(screen.getByTestId("composer-send"));

    await waitFor(() => {
      expect(mockForkSession).toHaveBeenCalledWith("session-live-1", {
        sourceType: "message",
        sourceMessageId: "assistant-message-1",
        sourceMessageSnapshot: {
          role: "assistant",
          kind: "text",
          content: "从这个历史点继续分叉"
        },
        strategy: "auto",
        targetProvider: "codex"
      });
    });

    await waitFor(() => {
      expect(mockSendLiveMessage).toHaveBeenCalledWith(
        "session-child-1",
        expect.objectContaining({
          content: "测试消息",
          model: null,
          attachments: []
        })
      );
      expect(upsertNavigationSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-child-1",
          parentSessionId: "session-live-1"
        })
      );
      expect(requestNavigationRefresh).toHaveBeenCalled();
      expect(selectWorkspace).toHaveBeenCalledWith("workspace-1");
      expect(screen.getByTestId("route-probe")).toHaveTextContent(
        "/workspaces/workspace-1/sessions/session-child-1"
      );
    });
  });

  it("运行中消息进入 fork 引用态后，即使原消息刷新，发送时仍使用点击当下的快照", async () => {
    mockLiveRuntimeState.messages = [
      createHistoryViewMessage("assistant-message-1", "assistant", "旧回答 X", 1)
    ];
    mockForkSession.mockResolvedValue({
      sessionId: "session-child-2",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-child-2",
      rawStoreRef: "/tmp/session-child-2.jsonl",
      parentSessionId: "session-live-1",
      forkMethod: "native_message_fork",
      forkSourceType: "message",
      forkSourceSessionId: "session-live-1",
      forkSourceMessageId: "assistant-message-1",
      isSubagent: true,
      subagentLabel: null,
      isArchived: false,
      isFavorite: false,
      title: "父会话",
      messageCount: 0,
      lastMessageAt: "2026-04-11T11:06:00.000Z",
      createdAt: "2026-04-11T11:06:00.000Z",
      updatedAt: "2026-04-11T11:06:00.000Z",
      syncStatus: "idle",
      syncCursor: null,
      lastSyncAt: null,
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      runningState: "idle",
      activitySource: "none",
      lastEventAt: "2026-04-11T11:06:00.000Z",
      completedAt: null,
      lastSeenAt: null,
      activityState: "idle"
    });
    mockSendLiveMessage.mockResolvedValue({
      sessionId: "session-child-2",
      acceptedAt: "2026-04-11T11:06:05.000Z",
      clientRequestId: "client-request-2",
      message: {
        messageId: "message-child-2",
        provider: "codex",
        providerSessionId: "provider-child-2",
        role: "user",
        content: "测试消息",
        timestamp: "2026-04-11T11:06:05.000Z",
        sequence: 1,
        rawRef: "codex://session/provider-child-2/message/message-child-2"
      }
    });
    mockUseWorkbenchShell.mockReturnValue({
      shellMode: "desktop",
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "CodingNS",
            path: "/Users/jackson/Code/CodingNS",
            repoRoot: "/Users/jackson/Code/CodingNS"
          },
          sessions: [mockLiveRuntimeState.session]
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
      startDraftSession: vi.fn()
    });

    const view = render(
      <MemoryRouter initialEntries={["/workspaces/workspace-1/sessions/session-live-1"]}>
        <Routes>
          <Route
            path="/workspaces/:workspaceId/sessions/:sessionId"
            element={<ConversationPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId("timeline-fork"));
    expect(screen.getByTestId("composer-fork-draft")).toHaveTextContent("旧回答 X");

    mockLiveRuntimeState.messages = [
      createHistoryViewMessage("assistant-message-1", "assistant", "新回答 Y", 1)
    ];

    view.rerender(
      <MemoryRouter initialEntries={["/workspaces/workspace-1/sessions/session-live-1"]}>
        <Routes>
          <Route
            path="/workspaces/:workspaceId/sessions/:sessionId"
            element={<ConversationPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId("composer-fork-draft")).toHaveTextContent("旧回答 X");

    fireEvent.click(screen.getByTestId("composer-send"));

    await waitFor(() => {
      expect(mockForkSession).toHaveBeenCalledWith("session-live-1", {
        sourceType: "message",
        sourceMessageId: "assistant-message-1",
        sourceMessageSnapshot: {
          role: "assistant",
          kind: "text",
          content: "旧回答 X"
        },
        strategy: "auto",
        targetProvider: "codex"
      });
    });
  });

  it("移动端点击顶部工作区按钮会弹出切换面板，切换后进入目标工作区全部会话页", async () => {
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
    const selectWorkspace = vi.fn();
    mockUseWorkbenchShell.mockReturnValue({
      shellMode: "mobile",
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "工作区一",
            path: "/Users/jackson/workspace-1"
          },
          sessions: [
            createMobileSession({
              sessionId: "session-1",
              workspaceId: "workspace-1",
              title: "历史会话 Alpha",
              lastMessageAt: "2026-03-28T08:00:00.000Z",
              updatedAt: "2026-03-28T08:00:00.000Z"
            })
          ]
        },
        {
          workspace: {
            id: "workspace-2",
            name: "工作区二",
            path: "/Users/jackson/workspace-2"
          },
          sessions: [
            createMobileSession({
              sessionId: "session-2-newest",
              workspaceId: "workspace-2",
              title: "目标会话最新",
              lastMessageAt: "2026-03-29T09:00:00.000Z",
              updatedAt: "2026-03-29T09:00:00.000Z"
            }),
            createMobileSession({
              sessionId: "session-2-older",
              workspaceId: "workspace-2",
              title: "目标会话较早",
              lastMessageAt: "2026-03-28T09:00:00.000Z",
              updatedAt: "2026-03-28T09:00:00.000Z"
            })
          ]
        }
      ],
      requestNavigationRefresh: vi.fn(),
      setSessionWorkspace: vi.fn(),
      upsertNavigationSession: vi.fn(),
      favoriteSessions: [],
      selectWorkspace
    });
    window.localStorage.setItem("mobile.conversation.preview.mode", "immersive");

    renderDraftConversationPage({ withRouteProbe: true });

    fireEvent.click(screen.getByRole("button", { name: t("shell.workspaceHomeSwitcherLabel") }));

    expect(
      screen.getByRole("dialog", {
        name: t("shell.workspaceHomeSwitcherTitle")
      })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /工作区二/ }));

    await waitFor(() => {
      expect(selectWorkspace).toHaveBeenCalledWith("workspace-2");
      expect(screen.getByTestId("route-probe")).toHaveTextContent("/workspaces/workspace-2/sessions");
    });

    expect(window.localStorage.getItem("mobile.conversation.preview.mode")).toBe("immersive");
  });

  it("移动端右滑超过阈值后，会一次性打开到默认宽度", async () => {
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
    window.localStorage.setItem("mobile.conversation.preview.mode", "immersive");

    const view = renderDraftConversationPage();
    const page = view.container.querySelector(".mobile-conversation-page") as HTMLElement;
    const stage = view.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      touches: [{ clientX: 20, clientY: 120 }]
    });
    fireEvent.touchMove(stage, {
      touches: [{ clientX: 420, clientY: 126 }]
    });
    fireEvent.touchEnd(stage);

    expect(screen.getByText("历史会话 Alpha")).toBeInTheDocument();
    expect(parseFloat(page.style.getPropertyValue("--mobile-conversation-preview-width"))).toBeCloseTo(234, 0);
  });

  it("移动端滑出侧边会话栏时，不会在 touchmove 里调用 preventDefault", async () => {
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
    window.localStorage.setItem("mobile.conversation.preview.mode", "immersive");

    const view = renderDraftConversationPage();
    const page = view.container.querySelector(".mobile-conversation-page") as HTMLElement;
    const stage = view.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      touches: [{ clientX: 20, clientY: 120 }]
    });

    const touchMoveEvent = createEvent.touchMove(stage, {
      touches: [{ clientX: 420, clientY: 126 }]
    });
    const preventDefaultSpy = vi.spyOn(touchMoveEvent, "preventDefault");

    fireEvent(stage, touchMoveEvent);
    fireEvent.touchEnd(stage);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(screen.getByText("历史会话 Alpha")).toBeInTheDocument();
    expect(parseFloat(page.style.getPropertyValue("--mobile-conversation-preview-width"))).toBeCloseTo(234, 0);
  });

  it("移动端快速右滑时，会读取抬手位置来稳定触发打开", async () => {
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
    window.localStorage.setItem("mobile.conversation.preview.mode", "immersive");

    const view = renderDraftConversationPage();
    const page = view.container.querySelector(".mobile-conversation-page") as HTMLElement;
    const stage = view.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      touches: [{ clientX: 24, clientY: 120 }]
    });
    fireEvent.touchMove(stage, {
      touches: [{ clientX: 52, clientY: 123 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 92, clientY: 124 }]
    });

    expect(screen.getByText("历史会话 Alpha")).toBeInTheDocument();
    expect(parseFloat(page.style.getPropertyValue("--mobile-conversation-preview-width"))).toBeCloseTo(234, 0);
  });

  it("移动端从更宽的左侧热区右滑，也能稳定打开快捷会话菜单", async () => {
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
    window.localStorage.setItem("mobile.conversation.preview.mode", "immersive");

    const view = renderDraftConversationPage();
    const page = view.container.querySelector(".mobile-conversation-page") as HTMLElement;
    const stage = view.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      touches: [{ clientX: 64, clientY: 120 }]
    });
    fireEvent.touchMove(stage, {
      touches: [{ clientX: 118, clientY: 124 }]
    });
    fireEvent.touchEnd(stage);

    expect(screen.getByText("历史会话 Alpha")).toBeInTheDocument();
    expect(parseFloat(page.style.getPropertyValue("--mobile-conversation-preview-width"))).toBeCloseTo(234, 0);
  });

  it("移动端小幅右滑不会误触打开快捷会话菜单", async () => {
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
    window.localStorage.setItem("mobile.conversation.preview.mode", "immersive");

    const view = renderDraftConversationPage();
    const page = view.container.querySelector(".mobile-conversation-page") as HTMLElement;
    const stage = view.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      touches: [{ clientX: 18, clientY: 120 }]
    });
    fireEvent.touchMove(stage, {
      touches: [{ clientX: 48, clientY: 124 }]
    });
    fireEvent.touchEnd(stage);

    expect(screen.queryByText("历史会话 Alpha")).not.toBeInTheDocument();
    expect(parseFloat(page.style.getPropertyValue("--mobile-conversation-preview-width"))).toBeCloseTo(0, 0);
  });

  it("快捷会话菜单打开后，额外右滑不会再保留额外宽度档位", async () => {
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

    const view = renderDraftConversationPage();
    const page = view.container.querySelector(".mobile-conversation-page") as HTMLElement;
    const rail = view.container.querySelector(".mobile-conversation-preview-rail") as HTMLElement;

    fireEvent.touchStart(rail, {
      touches: [{ clientX: 40, clientY: 160 }]
    });
    fireEvent.touchMove(rail, {
      touches: [{ clientX: 110, clientY: 164 }]
    });
    fireEvent.touchEnd(rail);

    expect(parseFloat(page.style.getPropertyValue("--mobile-conversation-preview-width"))).toBeCloseTo(234, 0);
  });

  it("快捷会话菜单打开后，一次左滑会直接全部收起", async () => {
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

    const view = renderDraftConversationPage();
    const page = view.container.querySelector(".mobile-conversation-page") as HTMLElement;
    const rail = view.container.querySelector(".mobile-conversation-preview-rail") as HTMLElement;

    fireEvent.touchStart(rail, {
      touches: [{ clientX: 100, clientY: 160 }]
    });
    fireEvent.touchMove(rail, {
      touches: [{ clientX: 20, clientY: 164 }]
    });
    fireEvent.touchEnd(rail);

    expect(screen.queryByText("历史会话 Alpha")).not.toBeInTheDocument();
    expect(parseFloat(page.style.getPropertyValue("--mobile-conversation-preview-width"))).toBeCloseTo(0, 0);
  });

  it("快捷会话菜单打开后，在对话消息区域左滑也能直接收起", async () => {
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

    const view = renderDraftConversationPage();
    const page = view.container.querySelector(".mobile-conversation-page") as HTMLElement;
    const stage = view.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      touches: [{ clientX: 220, clientY: 180 }]
    });
    fireEvent.touchMove(stage, {
      touches: [{ clientX: 150, clientY: 184 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 128, clientY: 184 }]
    });

    expect(screen.queryByText("历史会话 Alpha")).not.toBeInTheDocument();
    expect(parseFloat(page.style.getPropertyValue("--mobile-conversation-preview-width"))).toBeCloseTo(0, 0);
  });

  it("快捷会话菜单打开后，在顶部容器左滑也能直接收起", async () => {
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

    const view = renderDraftConversationPage();
    const pageHeader = view.container.querySelector(".mobile-conversation-page-header") as HTMLElement;

    fireEvent.touchStart(pageHeader, {
      touches: [{ clientX: 180, clientY: 42 }]
    });
    fireEvent.touchMove(pageHeader, {
      touches: [{ clientX: 128, clientY: 46 }]
    });
    fireEvent.touchEnd(pageHeader, {
      changedTouches: [{ clientX: 112, clientY: 46 }]
    });

    expect(screen.queryByText("历史会话 Alpha")).not.toBeInTheDocument();
  });

  it("快捷会话菜单打开后，会话列表区域会被标记为滚动优先", async () => {
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

    const view = renderDraftConversationPage();
    const sessionList = view.container.querySelector(
      ".mobile-conversation-preview-group-workspace .mobile-conversation-preview-list"
    ) as HTMLElement;

    expect(sessionList).toHaveAttribute("data-preview-gesture", "ignore");
  });

  it("快捷会话菜单顶部会显示新建对话按钮，并跳转到当前工作区的新草稿会话", async () => {
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

    renderDraftConversationPage({ withRouteProbe: true });

    fireEvent.click(screen.getByRole("button", { name: t("shell.createSession") }));

    await waitFor(() => {
      expect(screen.getByTestId("route-probe")).toHaveTextContent(
        /^\/workspaces\/workspace-1\/sessions\/draft-.*\?provider=codex&workspaceId=workspace-1$/
      );
    });
  });

  it("没有收藏会话时，会直接隐藏收藏分组", async () => {
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

    renderDraftConversationPage();

    expect(screen.queryByText(t("shell.favoriteSectionTitle"))).not.toBeInTheDocument();
  });

  it("移动端对话页侧边会话列表不会显示父会话已归档的孤儿子会话", async () => {
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

    mockUseWorkbenchShell.mockReturnValue({
      shellMode: "mobile",
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "工作区一",
            path: "/Users/jackson/workspace-1"
          },
          sessions: [
            createMobileSession({
              sessionId: "session-archived-root",
              title: "已归档父会话",
              isArchived: true
            }),
            createMobileSession({
              sessionId: "session-orphan-child",
              title: "孤儿子会话",
              parentSessionId: "session-archived-root",
              isSubagent: true,
              subagentLabel: "worker · orphan"
            }),
            createMobileSession({
              sessionId: "session-visible-root",
              title: "可见主会话"
            })
          ]
        }
      ],
      requestNavigationRefresh: vi.fn(),
      setSessionWorkspace: vi.fn(),
      upsertNavigationSession: vi.fn(),
      favoriteSessions: [],
      selectWorkspace: vi.fn()
    });

    const view = renderDraftConversationPage();
    const workspaceGroup = view.container.querySelector(
      ".mobile-conversation-preview-group-workspace"
    ) as HTMLElement;
    const workspaceCounter = workspaceGroup.querySelector(".workbench-section-counter");

    expect(screen.getByText("可见主会话")).toBeInTheDocument();
    expect(screen.queryByText("孤儿子会话")).not.toBeInTheDocument();
    expect(screen.queryByText("已归档父会话")).not.toBeInTheDocument();
    expect(workspaceCounter).toHaveTextContent("1");
  });

  it("移动端快捷会话菜单会按需展开主会话下的子 agent 会话", async () => {
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

    const timestamp = "2026-03-28T08:00:00.000Z";
    const rootSession = createMobileSession({
      sessionId: "session-root",
      title: "主会话 Alpha",
      lastMessageAt: timestamp,
      updatedAt: timestamp,
      isFavorite: true
    });
    const subagentSession = createMobileSession({
      sessionId: "session-root-sub",
      title: "子代理 Alpha-1",
      parentSessionId: "session-root",
      isSubagent: true,
      subagentLabel: "worker · Alpha",
      lastMessageAt: "2026-03-28T08:30:00.000Z",
      updatedAt: "2026-03-28T08:30:00.000Z",
      isFavorite: true
    });
    const secondarySession = createMobileSession({
      sessionId: "session-secondary",
      title: "主会话 Beta",
      lastMessageAt: "2026-03-28T07:00:00.000Z",
      updatedAt: "2026-03-28T07:00:00.000Z"
    });

    mockUseWorkbenchShell.mockReturnValue({
      shellMode: "mobile",
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "工作区一",
            path: "/Users/jackson/workspace-1"
          },
          sessions: [rootSession, subagentSession, secondarySession]
        }
      ],
      requestNavigationRefresh: vi.fn(),
      setSessionWorkspace: vi.fn(),
      upsertNavigationSession: vi.fn(),
      favoriteSessions: [
        {
          session: rootSession,
          workspace: {
            id: "workspace-1",
            name: "工作区一",
            path: "/Users/jackson/workspace-1"
          }
        },
        {
          session: subagentSession,
          workspace: {
            id: "workspace-1",
            name: "工作区一",
            path: "/Users/jackson/workspace-1"
          }
        }
      ],
      selectWorkspace: vi.fn()
    });

    const user = userEvent.setup();
    renderDraftConversationPage();

    expect(screen.getByText("主会话 Alpha")).toBeInTheDocument();
    expect(screen.getByText("主会话 Beta")).toBeInTheDocument();
    expect(screen.queryByText("子代理 Alpha-1")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: t("shell.subagentExpand") }));

    expect(screen.getByText("子代理 Alpha-1")).toBeInTheDocument();
  });

  it("移动端快捷会话菜单会显示后端统一裁决后的 stale 状态", async () => {
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
    mockUseWorkbenchShell.mockReturnValue(
      createMobileWorkbenchShellValue({
        runningState: "stale",
        activitySource: "runtime",
        activityResolutionSource: "authoritative_runtime",
        activityState: "idle"
      })
    );

    renderDraftConversationPage();

    expect(screen.getByRole("button", { name: t("shell.workspaceHomeSwitcherLabel") })).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: new RegExp(t("conversation.runtimeStale"))
      })
    ).toBeInTheDocument();
  });
});

function renderDraftConversationPage(options?: { withRouteProbe?: boolean }) {
  const withRouteProbe = options?.withRouteProbe ?? false;

  return render(
    <MemoryRouter
      initialEntries={["/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1"]}
    >
      <Routes>
        <Route
          path="/workspaces/:workspaceId/sessions"
          element={withRouteProbe ? <RouteProbe /> : null}
        />
        <Route
          path="/workspaces/:workspaceId/sessions/:sessionId"
          element={
            <>
              <ConversationPage />
              {withRouteProbe ? <RouteProbe /> : null}
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

function createHistoryViewMessage(
  messageId: string,
  role: "user" | "assistant",
  content: string,
  sequence: number
) {
  return {
    id: messageId,
    sessionId: "session-child-1",
    role,
    kind: "text" as const,
    content,
    toolCall: null,
    attachments: [],
    attachmentPayloads: null,
    origin: null,
    originRef: null,
    timestamp: `2026-04-11T11:00:1${sequence}.000Z`,
    sequence,
    rawRef: `codex://child#line=${sequence}`,
    deliveryState: "sent" as const,
    clientRequestId: null
  };
}

function createMobileWorkbenchShellValue(sessionOverrides: Record<string, unknown> = {}) {
  const session = createMobileSession(sessionOverrides);

  return {
    shellMode: "mobile",
    navigationGroups: [
      {
        workspace: {
          id: "workspace-1",
          name: "工作区一",
          path: "/Users/jackson/workspace-1"
        },
        sessions: [session]
      }
    ],
    requestNavigationRefresh: vi.fn(),
    setSessionWorkspace: vi.fn(),
    upsertNavigationSession: vi.fn(),
    favoriteSessions: [],
    selectWorkspace: vi.fn()
  };
}

function createMobileSession(sessionOverrides: Record<string, unknown> = {}) {
  const timestamp = "2026-03-28T08:00:00.000Z";

  return {
    sessionId: "session-1",
    workspaceId: "workspace-1",
    provider: "codex",
    providerSessionId: "provider-session-1",
    rawStoreRef: "codex://session-1",
    parentSessionId: null,
    isSubagent: false,
    subagentLabel: null,
    isArchived: false,
    title: "历史会话 Alpha",
    messageCount: 3,
    lastMessageAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    syncStatus: "idle",
    syncCursor: null,
    lastSyncAt: null,
    lastErrorCode: null,
    lastErrorDetail: null,
    resumedAt: null,
    runningState: "idle",
    activitySource: "none",
    lastEventAt: null,
    completedAt: null,
    lastSeenAt: null,
    activityState: "idle",
    ...sessionOverrides
  };
}

function RouteProbe() {
  const location = useLocation();

  return <div data-testid="route-probe">{location.pathname + location.search}</div>;
}
