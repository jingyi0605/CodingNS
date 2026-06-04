import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../../../config/client-config-store";
import { userPreferenceStore } from "../../../preferences/user-preference-store";
import { authStore } from "../../auth/store/auth-store";
import { clearViewSnapshot, readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { t } from "../../../shared/i18n";
import { ApiError } from "../../../shared/network/api-error";
import { createPendingMessage } from "./session-runtime-machine";
import {
  applyTimelineEventToLayers,
  SessionRuntimeStore,
  type TimelineLayersState
} from "./session-runtime-store";

const SESSION_RUNTIME_SNAPSHOT_KEY = "session-runtime.snapshot.session-1";

const mocked = vi.hoisted(() => {
  const getSessionDetail = vi.fn();
  const getSessionCapabilities = vi.fn();
  const getSessionMessages = vi.fn();
  const getSessionPermissionRequests = vi.fn();
  const getSessionQueue = vi.fn();
  const getSessionRuntime = vi.fn();
  const markSessionSeen = vi.fn();
  const enqueueSessionMessage = vi.fn();
  const deleteSessionQueueItem = vi.fn();
  const steerSessionQueueItem = vi.fn();
  const replySessionPermissionRequest = vi.fn();
  const sendLiveMessage = vi.fn();
  const sendSessionMessage = vi.fn();
  const realtimeInstances: Array<{
    options: Record<string, unknown>;
    requestOlderMessages: ReturnType<typeof vi.fn>;
  }> = [];

  class MockRealtimeClient {
    public readonly options: Record<string, unknown>;

    constructor(options: Record<string, unknown>) {
      this.options = options;
      realtimeInstances.push(this);
    }

    start() {}

    close() {}

    reconnectNow() {}

    updateCursor() {}

    requestOlderMessages = vi.fn(() => true);
  }

  return {
    getSessionDetail,
    getSessionCapabilities,
    getSessionMessages,
    getSessionPermissionRequests,
    getSessionQueue,
    getSessionRuntime,
    markSessionSeen,
    enqueueSessionMessage,
    deleteSessionQueueItem,
    steerSessionQueueItem,
    replySessionPermissionRequest,
    sendLiveMessage,
    sendSessionMessage,
    realtimeInstances,
    MockRealtimeClient
  };
});

vi.mock("../api/conversation-api", () => ({
  getSessionDetail: mocked.getSessionDetail,
  getSessionCapabilities: mocked.getSessionCapabilities,
  getSessionMessages: mocked.getSessionMessages,
  getSessionPermissionRequests: mocked.getSessionPermissionRequests,
  getSessionQueue: mocked.getSessionQueue,
  getSessionRuntime: mocked.getSessionRuntime,
  sendLiveMessage: mocked.sendLiveMessage,
  markSessionSeen: mocked.markSessionSeen,
  sendSessionMessage: mocked.sendSessionMessage,
  enqueueSessionMessage: mocked.enqueueSessionMessage,
  deleteSessionQueueItem: mocked.deleteSessionQueueItem,
  steerSessionQueueItem: mocked.steerSessionQueueItem,
  replySessionPermissionRequest: mocked.replySessionPermissionRequest
}));

vi.mock("../../../network/realtime-client", () => ({
  RealtimeClient: mocked.MockRealtimeClient
}));

function getRealtimeClient() {
  const client = mocked.realtimeInstances[0];

  if (!client) {
    throw new Error("RealtimeClient 未创建");
  }

  return client;
}

function emitRealtimeSubscribed() {
  const client = getRealtimeClient();
  (client.options.onSubscribed as (() => void))();
  return client;
}

function emitRealtimeEnvelope(event: Record<string, unknown>) {
  const client = getRealtimeClient();
  (client.options.onEnvelope as ((payload: Record<string, unknown>) => void))(event);
  return client;
}

function emitRealtimeOlderHistory(event: Record<string, unknown>) {
  const client = getRealtimeClient();
  (client.options.onOlderHistory as ((payload: Record<string, unknown>) => void))(event);
  return client;
}

function emitRealtimeRuntimeMessage(event: Record<string, unknown>) {
  const client = getRealtimeClient();
  (client.options.onRuntimeMessage as ((payload: Record<string, unknown>) => void))(event);
  return client;
}

function emitRealtimeActivity(event: Record<string, unknown>) {
  const client = getRealtimeClient();
  (client.options.onActivity as ((payload: Record<string, unknown>) => void))(event);
  return client;
}

function createTimelineLayersState(): TimelineLayersState {
  return {
    authoritativeMessages: [],
    runtimeOverlayMessages: [],
    activeRuntimeOverlayKeys: [],
    pendingMessages: [],
    replaceSnapshotSeedOnBackfill: false
  };
}

function createHistoryMessage(overrides: {
  messageId: string;
  provider: "codex" | "claude-code" | "opencode";
  providerSessionId: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  timestamp: string;
  sequence: number;
  rawRef: string;
  kind?: "text" | "thinking" | "tool_call" | "tool_result";
  attachments?: Array<{
    id: string;
    kind: "image";
    fileName: string;
    mimeType: string;
    fileSize: number;
  }>;
}) {
  return {
    kind: "text" as const,
    toolCall: null,
    attachments: [],
    ...overrides
  };
}

function createImageAttachment(fileName: string, fileSize: number) {
  return {
    id: `attachment-${fileName}-${fileSize}`,
    kind: "image" as const,
    fileName,
    mimeType: "image/png",
    fileSize
  };
}



describe("SessionRuntimeStore queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.realtimeInstances.length = 0;
    clearViewSnapshot(SESSION_RUNTIME_SNAPSHOT_KEY);
    authStore.hydrate({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin"
      }
    });
    clientConfigStore.hydrate({
      platform: "web",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: false,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    userPreferenceStore.hydrate(createPreferenceState());

    mocked.getSessionDetail.mockResolvedValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "raw-1",
      rawStoreRef: "codex://raw-1",
      title: "浼氳瘽 1",
      messageCount: 60,
      lastMessageAt: "2026-03-24T10:00:00.000Z",
      createdAt: "2026-03-24T09:00:00.000Z",
      updatedAt: "2026-03-24T10:00:00.000Z",
      syncStatus: "idle",
      syncCursor: "cursor-sync",
      lastSyncAt: "2026-03-24T10:00:00.000Z",
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      runningState: "idle",
      activitySource: "none",
      lastEventAt: "2026-03-24T10:00:00.000Z",
      completedAt: null,
      lastSeenAt: null,
      activityState: "idle"
    });
    mocked.getSessionCapabilities.mockResolvedValue({
      provider: "codex",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: false,
      supportsAttachments: false,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      limitations: []
    });
    mocked.getSessionPermissionRequests.mockResolvedValue({
      items: []
    });
    mocked.getSessionMessages.mockResolvedValue({
      messages: [],
      cursor: "cursor-latest",
      nextCursor: null,
      total: 0
    });
    mocked.getSessionRuntime.mockResolvedValue({
      sessionId: "session-1",
      runningState: "idle",
      hasActiveRun: false,
      canAttach: false,
      canInterrupt: false,
      inRunInputMode: "none",
      provider: "codex",
      providerSessionId: "raw-1",
      detail: null,
      interruptSource: null,
      errorCode: null,
      errorDetail: null,
      updatedAt: "2026-03-24T10:00:00.000Z",
      contextUsage: null
    });
    mocked.getSessionQueue.mockResolvedValue({
      items: []
    });
    mocked.markSessionSeen.mockResolvedValue(undefined);
    mocked.enqueueSessionMessage.mockResolvedValue({
      id: "queue-1",
      sessionId: "session-1",
      content: "继续执行",
      clientRequestId: "client-1",
      model: null,
      reasoningLevel: null,
      permissionMode: null,
      status: "queued",
      orderIndex: 1,
      errorDetail: null,
      createdAt: "2026-03-24T10:00:02.000Z",
      updatedAt: "2026-03-24T10:00:02.000Z"
    });
    mocked.deleteSessionQueueItem.mockResolvedValue(undefined);
    mocked.steerSessionQueueItem.mockResolvedValue({
      sessionId: "session-1",
      acceptedAt: "2026-03-24T10:00:03.000Z",
      clientRequestId: "client-queue-1",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      message: {
        messageId: "user-message-queue-1",
        provider: "claude-code",
        providerSessionId: "claude-session-1",
        role: "user",
        kind: "text",
        content: "立即引导",
        timestamp: "2026-03-24T10:00:03.000Z",
        sequence: 62,
        rawRef: "claude://raw#line=62",
        toolCall: null,
        attachments: []
      }
    });
    mocked.sendLiveMessage.mockResolvedValue({
      sessionId: "session-1",
      acceptedAt: "2026-03-24T10:00:02.000Z",
      clientRequestId: "client-1",
      provider: "codex",
      providerSessionId: "raw-1",
      message: {
        messageId: "user-message-1",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "user",
        kind: "text",
        content: "继续执行",
        timestamp: "2026-03-24T10:00:02.000Z",
        sequence: 61,
        rawRef: "codex://raw#line=61",
        toolCall: null,
        attachments: []
      }
    });
    mocked.sendSessionMessage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    clearViewSnapshot(SESSION_RUNTIME_SNAPSHOT_KEY);
    authStore.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("收到终态运行事件后会刷新等待队列", async () => {
    vi.useFakeTimers();
    const store = new SessionRuntimeStore("session-1");
    const queueItems = [
      {
        id: "queue-next",
        sessionId: "session-1",
        content: "下一条",
        clientRequestId: "client-next",
        model: null,
        reasoningLevel: null,
        permissionMode: null,
        status: "queued",
        orderIndex: 1,
        errorDetail: null,
        createdAt: "2026-03-24T10:00:03.000Z",
        updatedAt: "2026-03-24T10:00:03.000Z"
      }
    ];

    mocked.getSessionMessages.mockResolvedValueOnce({
      messages: [],
      cursor: "cursor-latest",
      nextCursor: null,
      total: 0
    });
    mocked.getSessionQueue.mockResolvedValue({
      items: []
    });

    await store.initialize();
    mocked.getSessionQueue.mockResolvedValue({
      items: queueItems
    });

    const client = mocked.realtimeInstances[0];
    expect(client).toBeDefined();

    await (client!.options.onRuntimeStatus as ((event: { status: "completed"; detail: string | null; timestamp: string; sessionId: string; }) => void))({
      sessionId: "session-1",
      status: "completed",
      detail: null,
      timestamp: "2026-03-24T10:00:03.000Z"
    });

    await vi.runAllTimersAsync();

    expect(mocked.getSessionQueue).toHaveBeenCalledTimes(4);
    expect(store.getState().queuedMessages[0]?.id).toBe("queue-next");
    store.destroy();
  });

  it("队列里还有等待项时，收到新消息也会补拉一次队列", async () => {
    vi.useFakeTimers();
    const store = new SessionRuntimeStore("session-1");

    mocked.getSessionMessages.mockResolvedValueOnce({
      messages: [],
      cursor: "cursor-latest",
      nextCursor: null,
      total: 0
    });
    mocked.getSessionQueue
      .mockResolvedValueOnce({
        items: [
          {
            id: "queue-stale",
            sessionId: "session-1",
            content: "再回复789",
            clientRequestId: "client-queue-stale",
            model: null,
            reasoningLevel: null,
            permissionMode: null,
            status: "queued",
            orderIndex: 1,
            errorDetail: null,
            createdAt: "2026-03-24T10:00:03.000Z",
            updatedAt: "2026-03-24T10:00:03.000Z"
          }
        ]
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: "queue-stale",
            sessionId: "session-1",
            content: "再回复789",
            clientRequestId: "client-queue-stale",
            model: null,
            reasoningLevel: null,
            permissionMode: null,
            status: "queued",
            orderIndex: 1,
            errorDetail: null,
            createdAt: "2026-03-24T10:00:03.000Z",
            updatedAt: "2026-03-24T10:00:03.000Z"
          }
        ]
      })
      .mockResolvedValueOnce({
        items: []
      })
      .mockResolvedValue({
        items: []
      });

    await store.initialize();

    const client = mocked.realtimeInstances[0];
    expect(client).toBeDefined();

    (client!.options.onEnvelope as ((event: Record<string, unknown>) => void))({
      type: "session.delta",
      sessionId: "session-1",
      cursor: "cursor-after",
      messages: [
        {
          messageId: "assistant-queue-sent",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          kind: "text",
          content: "789",
          timestamp: "2026-03-24T10:00:10.100Z",
          sequence: 2,
          rawRef: "codex://raw#line=2",
          toolCall: null
        }
      ]
    });

    await vi.runAllTimersAsync();

    expect(mocked.getSessionQueue).toHaveBeenCalledTimes(3);
    expect(store.getState().queuedMessages).toHaveLength(0);
    store.destroy();
  });

  it("enqueueMessage 会写入项目队列并刷新等待列表", async () => {
    const store = new SessionRuntimeStore("session-1");
    mocked.getSessionQueue
      .mockResolvedValueOnce({
        items: [
          {
            id: "queue-1",
            sessionId: "session-1",
            content: "排队继续执行",
            clientRequestId: "client-queue-1",
            model: null,
            reasoningLevel: null,
            permissionMode: null,
            status: "queued",
            orderIndex: 1,
            errorDetail: null,
            createdAt: "2026-03-24T10:00:02.000Z",
            updatedAt: "2026-03-24T10:00:02.000Z"
          }
        ]
      });
    mocked.enqueueSessionMessage.mockResolvedValueOnce({
      id: "queue-1",
      sessionId: "session-1",
      content: "排队继续执行",
      clientRequestId: "client-queue-1",
      model: null,
      reasoningLevel: null,
      permissionMode: null,
      status: "queued",
      orderIndex: 1,
      errorDetail: null,
      createdAt: "2026-03-24T10:00:02.000Z",
      updatedAt: "2026-03-24T10:00:02.000Z"
    });

    await store.enqueueMessage("排队继续执行");

    expect(mocked.enqueueSessionMessage).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        content: "排队继续执行"
      })
    );
    expect(store.getState().messages).toHaveLength(0);
    expect(store.getState().queuedMessages).toHaveLength(1);
    expect(store.getState().queuedMessages[0]?.content).toBe("排队继续执行");
  });

  it("默认完整权限开启后，enqueueMessage 会透传 bypassPermissions", async () => {
    clientConfigStore.hydrate({
      ...clientConfigStore.getState(),
      defaultPermissionMode: "bypassPermissions"
    });
    userPreferenceStore.hydrate(
      createPreferenceState({
        defaultPermissionMode: "bypassPermissions"
      })
    );
    const store = new SessionRuntimeStore("session-1");

    await store.enqueueMessage("排队执行 git add");

    expect(mocked.enqueueSessionMessage).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        content: "排队执行 git add",
        permissionMode: "bypassPermissions"
      })
    );
  });

  it("deleteQueuedMessage 会删除等待项并刷新队列", async () => {
    const store = new SessionRuntimeStore("session-1");
    mocked.getSessionQueue.mockResolvedValueOnce({
      items: []
    });
    mocked.getSessionQueue.mockResolvedValueOnce({
      items: []
    });

    await store.deleteQueuedMessage("queue-1");

    expect(mocked.deleteSessionQueueItem).toHaveBeenCalledWith("session-1", "queue-1");
    expect(mocked.getSessionQueue).toHaveBeenCalledWith("session-1");
  });

  it("steerQueuedMessage 会立刻引导等待项并刷新运行态与队列", async () => {
    const store = new SessionRuntimeStore("session-1");
    mocked.getSessionRuntime.mockResolvedValueOnce({
      sessionId: "session-1",
      runningState: "running",
      hasActiveRun: true,
      canAttach: false,
      canInterrupt: false,
      inRunInputMode: "streaming_guidance",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      detail: null,
      errorCode: null,
      errorDetail: null,
      updatedAt: "2026-03-24T10:00:03.000Z",
      contextUsage: null
    });
    mocked.getSessionQueue.mockResolvedValueOnce({
      items: []
    });

    await store.steerQueuedMessage("queue-1");

    expect(mocked.steerSessionQueueItem).toHaveBeenCalledWith("session-1", "queue-1");
    expect(mocked.getSessionRuntime).toHaveBeenCalledWith("session-1");
    expect(mocked.getSessionQueue).toHaveBeenCalledWith("session-1");
  });
});

function createPreferenceState(
  overrides?: Partial<ReturnType<typeof userPreferenceStore.getState>["profile"]>
) {
  return {
    initialized: true,
    profile: {
      language: overrides?.language ?? "zh-CN",
      theme: overrides?.theme ?? "light",
      autoTheme: overrides?.autoTheme ?? false,
      defaultPermissionMode: overrides?.defaultPermissionMode ?? "default"
    },
    providers: {
      "claude-code": {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      codex: {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      opencode: {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      gemini: {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      kimi: {
        defaultModel: null,
        defaultReasoningLevel: null
      }
    },
    updatedAt: null,
    source: "default" as const
  };
}
