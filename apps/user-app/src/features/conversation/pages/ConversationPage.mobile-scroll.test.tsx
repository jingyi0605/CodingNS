import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationPage } from "./ConversationPage";

const mockGetProviderCapabilities = vi.fn();
const mockUseWorkbenchShell = vi.fn();
const mockRuntimeStoreInitialize = vi.fn();
const mockRuntimeStoreDestroy = vi.fn();
const mockRuntimeStoreApplyNavigationSession = vi.fn();

const runtimeStateRef: {
  current: ReturnType<typeof createRuntimeState>;
} = {
  current: createRuntimeState("session-live-1", [
    createAssistantMessage("session-live-1", "第一条历史消息", "message-live-1"),
    createAssistantMessage("session-live-1", "第二条历史消息", "message-live-2", 2)
  ])
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

vi.mock("../components/ComposerPanel", () => ({
  ComposerPanel: () => null
}));

vi.mock("../components/SessionHeader", () => ({
  SessionHeader: () => null
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
  QueuedMessageList: () => null
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
  FileContextPanel: () => null
}));

vi.mock("../components/GitSidebar", () => ({
  GitSidebar: () => null
}));

vi.mock("../../workbench/components/TerminalManagerPanel", () => ({
  TerminalManagerPanel: () => null
}));

vi.mock("../../mobile-shell/components/MobileWorkspaceSwitcherHeader", () => ({
  MobileWorkspaceSwitcherHeader: ({
    heading,
    trailing
  }: {
    heading?: string;
    trailing?: React.ReactNode;
  }) => (
    <div>
      <h1>{heading}</h1>
      {trailing}
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
  useSessionRuntimeStore: (
    _store: unknown,
    selector: (state: ReturnType<typeof createRuntimeState>) => unknown
  ) => selector(runtimeStateRef.current)
}));

describe("ConversationPage mobile scroll integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390
    });

    runtimeStateRef.current = createRuntimeState("session-live-1", [
      createAssistantMessage("session-live-1", "第一条历史消息", "message-live-1"),
      createAssistantMessage("session-live-1", "第二条历史消息", "message-live-2", 2)
    ]);

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

  it("移动壳层切换会话后，恢复的时间线不会再被 3.5 秒强行锁定", async () => {
    const restoreMessageListMetrics = installMessageListMetrics();
    seedConversationScrollState("session-live-1", 420);
    const view = render(createPageElement());

    try {
      await waitFor(() => {
        expect(view.container.querySelector(".message-list")).not.toBeNull();
      });

      const messageList = view.container.querySelector(".message-list") as HTMLDivElement;

      await waitFor(() => {
        expect(messageList.scrollTop).toBe(420);
      });

      vi.useFakeTimers();

      fireEvent.scroll(messageList, {
        target: {
          scrollTop: 560
        }
      });
      act(() => {
        vi.advanceTimersByTime(4000);
      });

      expect(messageList.scrollTop).toBe(560);
    } finally {
      vi.useRealTimers();
      restoreMessageListMetrics();
    }
  });
});

function createPageElement() {
  return (
    <MemoryRouter initialEntries={["/workspaces/workspace-1/sessions/session-live-1"]}>
      <Routes>
        <Route
          path="/workspaces/:workspaceId/sessions/:sessionId"
          element={<ConversationPage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

function seedConversationScrollState(sessionId: string, scrollTop: number) {
  window.localStorage.setItem(
    "codingns.user-app.conversation-scroll",
    JSON.stringify({
      schemaVersion: 1,
      bySessionId: {
        [sessionId]: {
          scrollTop,
          stickToBottom: false,
          lastMessageSignature: null,
          updatedAt: Date.now()
        }
      }
    })
  );
}

function installMessageListMetrics() {
  const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  const scrollTopDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTop");
  const scrollTopByElement = new WeakMap<HTMLElement, number>();

  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      if (this.classList?.contains("message-list")) {
        return 2000;
      }

      return scrollHeightDescriptor?.get?.call(this) ?? 0;
    }
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      if (this.classList?.contains("message-list")) {
        return 600;
      }

      return clientHeightDescriptor?.get?.call(this) ?? 0;
    }
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get() {
      if (this.classList?.contains("message-list")) {
        return scrollTopByElement.get(this) ?? 0;
      }

      return scrollTopDescriptor?.get?.call(this) ?? 0;
    },
    set(value: number) {
      if (this.classList?.contains("message-list")) {
        scrollTopByElement.set(this, Number.isFinite(value) ? value : 0);
        return;
      }

      scrollTopDescriptor?.set?.call(this, value);
    }
  });

  return () => {
    restorePropertyDescriptor(HTMLElement.prototype, "scrollHeight", scrollHeightDescriptor);
    restorePropertyDescriptor(HTMLElement.prototype, "clientHeight", clientHeightDescriptor);
    restorePropertyDescriptor(HTMLElement.prototype, "scrollTop", scrollTopDescriptor);
  };
}

function restorePropertyDescriptor(
  target: typeof HTMLElement.prototype,
  key: "scrollHeight" | "clientHeight" | "scrollTop",
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
    return;
  }

  delete target[key];
}

function createRuntimeState(sessionId: string, messages: Array<ReturnType<typeof createAssistantMessage>>) {
  return {
    session: createSessionSummary(sessionId),
    capabilities: {
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
    },
    runtimeHasActiveRun: false,
    runtimeCanInterrupt: false,
    messages,
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
}

function createSessionSummary(sessionId: string) {
  const timestamp = "2026-04-18T08:00:00.000Z";

  return {
    sessionId,
    workspaceId: "workspace-1",
    provider: "codex",
    providerSessionId: `provider-${sessionId}`,
    rawStoreRef: `store://${sessionId}`,
    parentSessionId: null,
    forkMethod: null,
    forkSourceType: null,
    forkSourceSessionId: null,
    forkSourceMessageId: null,
    isSubagent: false,
    subagentLabel: null,
    isArchived: false,
    isFavorite: false,
    title: sessionId === "session-live-1" ? "历史会话 Alpha" : "历史会话 Beta",
    messageCount: 2,
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
    lastEventAt: timestamp,
    completedAt: null,
    lastSeenAt: null,
    activityState: "idle"
  };
}

function createAssistantMessage(
  sessionId: string,
  content: string,
  id: string,
  sequence = 1
) {
  return {
    id,
    sessionId,
    role: "assistant" as const,
    kind: "text" as const,
    content,
    toolCall: null,
    attachments: [],
    attachmentPayloads: null,
    origin: null,
    originRef: null,
    timestamp: `2026-04-18T08:00:0${sequence}.000Z`,
    sequence,
    rawRef: `codex://raw#line=${id}`,
    deliveryState: "sent" as const,
    clientRequestId: null
  };
}

function createMobileWorkbenchShellValue() {
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
          createSessionSummary("session-live-1"),
          createSessionSummary("session-live-2")
        ]
      }
    ],
    currentWorkspaceId: "workspace-1",
    revealWorkspaceFile: vi.fn(() => false),
    requestNavigationRefresh: vi.fn(),
    selectWorkspace: vi.fn(),
    setSessionWorkspace: vi.fn(),
    upsertNavigationSession: vi.fn(),
    markNavigationSessionSeen: vi.fn(),
    favoriteSessions: [],
    archiveSession: vi.fn(),
    unarchiveSession: vi.fn(),
    startDraftSession: vi.fn()
  };
}
