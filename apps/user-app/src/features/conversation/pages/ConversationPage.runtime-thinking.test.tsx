import { act, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { ConversationPage } from "./ConversationPage";

const mockMessageTimeline = vi.fn((_props?: unknown) => null);
const mockUseWorkbenchShell = vi.fn();
const mockRuntimeStoreStateRef = {
  current: createRuntimeStoreState()
};

vi.mock("../components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

vi.mock("../components/ConnectionBanner", () => ({
  ConnectionBanner: () => null
}));

vi.mock("../components/PermissionRequestList", () => ({
  PermissionRequestList: () => null
}));

vi.mock("../components/QueuedMessageList", () => ({
  QueuedMessageList: () => null
}));

vi.mock("../components/SessionHeader", () => ({
  SessionHeader: () => null
}));

vi.mock("../components/SessionButlerActionButton", () => ({
  SessionButlerActionButton: () => null
}));

vi.mock("../components/ComposerPanel", () => ({
  ComposerPanel: () => null
}));

vi.mock("../components/MessageTimeline", () => ({
  MessageTimeline: (props: unknown) => mockMessageTimeline(props)
}));

vi.mock("../runtime/session-runtime-store", () => ({
  SessionRuntimeStore: class {
    initialize = vi.fn(async () => undefined);
    destroy = vi.fn();
    applyNavigationSession = vi.fn();
    reconnect = vi.fn();
    loadOlderMessages = vi.fn(async () => undefined);
    retryMessage = vi.fn(async () => undefined);
    deleteQueuedMessage = vi.fn(async () => undefined);
    steerQueuedMessage = vi.fn(async () => undefined);
    interrupt = vi.fn(async () => undefined);
    sendMessage = vi.fn(async () => undefined);
    enqueueMessage = vi.fn(async () => undefined);
    replyPermissionRequest = vi.fn(async () => undefined);
  },
  useSessionRuntimeStore: (_store: unknown, selector: (state: ReturnType<typeof createRuntimeStoreState>) => unknown) =>
    selector(mockRuntimeStoreStateRef.current)
}));

describe("ConversationPage runtime thinking placeholder", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mockMessageTimeline.mockClear();
    mockRuntimeStoreStateRef.current = createRuntimeStoreState();
    mockUseWorkbenchShell.mockReset();
    mockUseWorkbenchShell.mockReturnValue(createWorkbenchShellValue());
  });

  it("运行态瞬时掉边界时，不会立刻把 Codex 思考占位闪没", async () => {
    vi.useFakeTimers();
    mockRuntimeStoreStateRef.current = createRuntimeStoreState({
      session: createLiveSession({
        runningState: "running",
        activityState: "running"
      }),
      runtimeHasActiveRun: true,
      messages: [createUserMessage()]
    });

    const view = renderLiveConversationPage();
    const expectedLabel = t("conversation.runtimeThinkingPlaceholder", {
      provider: t("conversation.providerCodex")
    });

    expect(readLatestRuntimeThinkingPlaceholder()).toBe(expectedLabel);

    mockRuntimeStoreStateRef.current = createRuntimeStoreState({
      session: createLiveSession({
        runningState: "idle",
        activityState: "idle"
      }),
      runtimeHasActiveRun: false,
      messages: [createUserMessage()]
    });

    view.rerender(createLiveConversationPageElement());

    expect(readLatestRuntimeThinkingPlaceholder()).toBe(expectedLabel);

    act(() => {
      vi.advanceTimersByTime(319);
    });
    expect(readLatestRuntimeThinkingPlaceholder()).toBe(expectedLabel);

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(readLatestRuntimeThinkingPlaceholder()).toBeNull();
  });

  it("assistant 真正开始输出后，会立刻移除 Codex 思考占位", async () => {
    mockRuntimeStoreStateRef.current = createRuntimeStoreState({
      session: createLiveSession({
        runningState: "running",
        activityState: "running"
      }),
      runtimeHasActiveRun: true,
      messages: [createUserMessage()]
    });

    const view = renderLiveConversationPage();
    const expectedLabel = t("conversation.runtimeThinkingPlaceholder", {
      provider: t("conversation.providerCodex")
    });

    await waitFor(() => {
      expect(readLatestRuntimeThinkingPlaceholder()).toBe(expectedLabel);
    });

    mockRuntimeStoreStateRef.current = createRuntimeStoreState({
      session: createLiveSession({
        runningState: "running",
        activityState: "running"
      }),
      runtimeHasActiveRun: true,
      messages: [createUserMessage(), createAssistantThinkingMessage()]
    });

    view.rerender(createLiveConversationPageElement());

    await waitFor(() => {
      expect(readLatestRuntimeThinkingPlaceholder()).toBeNull();
    });
  });

  it("会把当前会话错误信息传给消息时间线", async () => {
    mockRuntimeStoreStateRef.current = createRuntimeStoreState({
      session: createLiveSession({
        runningState: "failed",
        syncStatus: "error",
        lastErrorCode: "CODEX_HTTP_429",
        lastErrorDetail: "429 Too Many Requests"
      }),
      messages: [createUserMessage()]
    });

    renderLiveConversationPage();

    await waitFor(() => {
      expect(readLatestTimelineProps()?.sessionRunningState).toBe("failed");
    });

    expect(readLatestTimelineProps()?.sessionSyncStatus).toBe("error");
    expect(readLatestTimelineProps()?.sessionLastErrorCode).toBe("CODEX_HTTP_429");
    expect(readLatestTimelineProps()?.sessionLastErrorDetail).toBe("429 Too Many Requests");
  });
});

function renderLiveConversationPage() {
  return render(createLiveConversationPageElement());
}

function createLiveConversationPageElement() {
  return (
    <MemoryRouter initialEntries={["/workspaces/workspace-1/sessions/session-1"]}>
      <Routes>
        <Route
          path="/workspaces/:workspaceId/sessions/:sessionId"
          element={<ConversationPage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

function readLatestRuntimeThinkingPlaceholder(): string | null {
  const props = mockMessageTimeline.mock.calls.at(-1)?.[0] as { runtimeThinkingPlaceholder?: string | null } | undefined;
  return props?.runtimeThinkingPlaceholder ?? null;
}

function readLatestTimelineProps() {
  return (mockMessageTimeline.mock.calls.at(-1)?.[0] ?? null) as {
    runtimeThinkingPlaceholder?: string | null;
    sessionRunningState?: string | null;
    sessionSyncStatus?: string | null;
    sessionLastErrorCode?: string | null;
    sessionLastErrorDetail?: string | null;
  } | null;
}

function createWorkbenchShellValue() {
  return {
    shellMode: "desktop",
    navigationGroups: [
      {
        workspace: {
          id: "workspace-1",
          name: "工作区一",
          path: "/Users/jackson/workspace-1"
        },
        sessions: [createLiveSession()]
      }
    ],
    requestNavigationRefresh: vi.fn(),
    selectWorkspace: vi.fn(),
    setSessionWorkspace: vi.fn(),
    markNavigationSessionSeen: vi.fn(),
    favoriteSessions: [],
    archiveSession: vi.fn(async () => undefined),
    unarchiveSession: vi.fn(async () => undefined),
    startDraftSession: vi.fn(async () => null)
  };
}

function createRuntimeStoreState(
  overrides: Partial<ReturnType<typeof createRuntimeStoreStateBase>> = {}
) {
  return {
    ...createRuntimeStoreStateBase(),
    ...overrides
  };
}

function createRuntimeStoreStateBase() {
  return {
    session: createLiveSession(),
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
      modelOptions: [],
      limitations: []
    },
    runtimeHasActiveRun: false,
    runtimeCanInterrupt: false,
    messages: [] as Array<ReturnType<typeof createUserMessage>>,
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
}

function createLiveSession(overrides: Record<string, unknown> = {}) {
  const timestamp = "2026-04-10T10:00:00.000Z";

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
    messageCount: 1,
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
    activityResolutionSource: "authoritative_runtime",
    activityConfidence: "high",
    runId: null,
    lastEventAt: null,
    completedAt: null,
    lastSeenAt: null,
    watchdogTriggeredAt: null,
    activityState: "idle",
    ...overrides
  };
}

function createUserMessage() {
  return {
    id: "user-1",
    sessionId: "session-1",
    role: "user",
    kind: "text",
    content: "帮我看一下这个闪烁问题",
    toolCall: null,
    attachments: [],
    attachmentPayloads: null,
    origin: null,
    originRef: null,
    timestamp: "2026-04-10T10:00:01.000Z",
    sequence: 1,
    rawRef: "codex://session-1#line=1",
    deliveryState: "sent",
    clientRequestId: null
  };
}

function createAssistantThinkingMessage() {
  return {
    id: "assistant-thinking-1",
    sessionId: "session-1",
    role: "assistant",
    kind: "thinking",
    content: "先定位到底是谁在抖。",
    toolCall: null,
    attachments: [],
    attachmentPayloads: null,
    origin: null,
    originRef: null,
    timestamp: "2026-04-10T10:00:02.000Z",
    sequence: 2,
    rawRef: "codex://session-1#line=2",
    deliveryState: "sent",
    clientRequestId: null
  };
}
