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



describe("SessionRuntimeStore send message", () => {
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

  it("运行中的 Claude 会话继续发送时仍然走 sendLiveMessage", async () => {
    const store = new SessionRuntimeStore("session-1", {
      initialSession: {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "claude-code",
        providerSessionId: "claude-session-1",
        rawStoreRef: "claude://raw-1",
        title: "Claude 会话",
        messageCount: 3,
        lastMessageAt: "2026-03-24T10:00:00.000Z",
        createdAt: "2026-03-24T09:00:00.000Z",
        updatedAt: "2026-03-24T10:00:00.000Z",
        syncStatus: "idle",
        syncCursor: "cursor-sync",
        lastSyncAt: "2026-03-24T10:00:00.000Z",
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "running",
        activitySource: "runtime",
        lastEventAt: "2026-03-24T10:00:01.000Z",
        completedAt: null,
        lastSeenAt: null,
        activityState: "running"
      }
    });

    mocked.sendLiveMessage.mockResolvedValueOnce({
      sessionId: "session-1",
      acceptedAt: "2026-03-24T10:00:03.000Z",
      clientRequestId: expect.any(String),
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      message: {
        messageId: "user-message-guidance",
        provider: "claude-code",
        providerSessionId: "claude-session-1",
        role: "user",
        kind: "text",
        content: "继续按这个方向补充",
        timestamp: "2026-03-24T10:00:03.000Z",
        sequence: 4,
        rawRef: "claude://raw#line=4",
        toolCall: null,
        attachments: []
      }
    });

    await store.sendMessage("继续按这个方向补充");

    expect(mocked.sendLiveMessage).toHaveBeenCalledTimes(1);
    expect(mocked.sendLiveMessage).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        content: "继续按这个方向补充",
        permissionMode: null
      })
    );
    expect(store.getState().session?.runningState).toBe("running");
    expect(store.getState().runtimeCanInterrupt).toBe(true);
  });

  it("Claude 会话上一轮已中断后，再次发送也会立刻恢复可中断状态", async () => {
    const store = new SessionRuntimeStore("session-1", {
      initialSession: {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "claude-code",
        providerSessionId: "claude-session-1",
        rawStoreRef: "claude://raw-1",
        title: "Claude 会话",
        messageCount: 3,
        lastMessageAt: "2026-03-24T10:00:00.000Z",
        createdAt: "2026-03-24T09:00:00.000Z",
        updatedAt: "2026-03-24T10:00:00.000Z",
        syncStatus: "idle",
        syncCursor: "cursor-sync",
        lastSyncAt: "2026-03-24T10:00:00.000Z",
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "interrupted",
        activitySource: "runtime",
        lastEventAt: "2026-03-24T10:00:01.000Z",
        completedAt: "2026-03-24T10:00:01.000Z",
        lastSeenAt: null,
        activityState: "idle"
      }
    });

    mocked.sendLiveMessage.mockResolvedValueOnce({
      sessionId: "session-1",
      acceptedAt: "2026-03-24T10:00:03.000Z",
      clientRequestId: expect.any(String),
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      message: {
        messageId: "user-message-guidance-2",
        provider: "claude-code",
        providerSessionId: "claude-session-1",
        role: "user",
        kind: "text",
        content: "重新开始这一轮",
        timestamp: "2026-03-24T10:00:03.000Z",
        sequence: 5,
        rawRef: "claude://raw#line=5",
        toolCall: null,
        attachments: []
      }
    });

    (store as any).patch({
      runtimeHasActiveRun: false,
      runtimeCanInterrupt: false
    });

    await store.sendMessage("重新开始这一轮");

    expect(store.getState().session?.runningState).toBe("running");
    expect(store.getState().runtimeHasActiveRun).toBe(true);
    expect(store.getState().runtimeCanInterrupt).toBe(true);
  });

  it("历史尚未加载完成时，新增用户消息也会按已知 messageCount 预占正确序号", async () => {
    let resolveSend: ((value: {
      sessionId: string;
      acceptedAt: string;
      clientRequestId: string;
      provider: "claude-code";
      providerSessionId: string;
      message: {
        messageId: string;
        provider: "claude-code";
        providerSessionId: string;
        role: "user";
        kind: "text";
        content: string;
        timestamp: string;
        sequence: number;
        rawRef: string;
        toolCall: null;
        attachments: [];
      };
    }) => void) | null = null;
    mocked.sendLiveMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        })
    );

    const store = new SessionRuntimeStore("session-1", {
      initialSession: {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "claude-code",
        providerSessionId: "claude-session-1",
        rawStoreRef: "claude://raw-1",
        title: "Claude 会话",
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
      }
    });

    const sendPromise = store.sendMessage("历史还没回完时先发送");
    expect(store.getState().messages).toMatchObject([
      {
        role: "user",
        content: "历史还没回完时先发送",
        sequence: 61,
        deliveryState: "sending"
      }
    ]);

    resolveSend?.({
      sessionId: "session-1",
      acceptedAt: "2026-03-24T10:00:03.000Z",
      clientRequestId: "client-pending-sequence",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      message: {
        messageId: "user-message-pending-sequence",
        provider: "claude-code",
        providerSessionId: "claude-session-1",
        role: "user",
        kind: "text",
        content: "历史还没回完时先发送",
        timestamp: "2026-03-24T10:00:03.000Z",
        sequence: 61,
        rawRef: "claude://raw#line=61",
        toolCall: null,
        attachments: []
      }
    });

    await sendPromise;
    expect(store.getState().messages).toMatchObject([
      {
        role: "user",
        content: "历史还没回完时先发送",
        sequence: 61,
        deliveryState: "sent"
      }
    ]);
  });

  it("本地刚发起的新运行即便拿到 running 但不可中断的快照，也会先保住可停止状态", async () => {
    const store = new SessionRuntimeStore("session-1", {
      initialSession: {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "codex-session-1",
        rawStoreRef: "codex://raw-1",
        title: "Codex 会话",
        messageCount: 3,
        lastMessageAt: "2026-03-24T10:00:00.000Z",
        createdAt: "2026-03-24T09:00:00.000Z",
        updatedAt: "2026-03-24T10:00:00.000Z",
        syncStatus: "idle",
        syncCursor: "cursor-sync",
        lastSyncAt: "2026-03-24T10:00:00.000Z",
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "running",
        activitySource: "runtime",
        lastEventAt: "2026-03-24T10:00:01.000Z",
        completedAt: null,
        lastSeenAt: null,
        activityState: "running"
      }
    });

    (store as any).patch({
      runtimeHasActiveRun: true,
      runtimeCanInterrupt: true
    });
    mocked.getSessionRuntime.mockResolvedValueOnce({
      sessionId: "session-1",
      runningState: "running",
      hasActiveRun: false,
      canAttach: false,
      canInterrupt: false,
      inRunInputMode: "none",
      provider: "codex",
      providerSessionId: "codex-session-1",
      detail: null,
      errorCode: null,
      errorDetail: null,
      updatedAt: "2026-03-24T10:00:03.000Z",
      contextUsage: null
    });

    await (store as any).refreshRuntimeSnapshot("local_send_guard");

    expect(store.getState().session?.runningState).toBe("running");
    expect(store.getState().runtimeHasActiveRun).toBe(true);
    expect(store.getState().runtimeCanInterrupt).toBe(true);
  });

  it("默认完整权限开启后，sendLiveMessage 会透传 bypassPermissions", async () => {
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

    await store.sendMessage("直接执行 git add");

    expect(mocked.sendLiveMessage).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        content: "直接执行 git add",
        permissionMode: "bypassPermissions"
      })
    );
  });

  it("实时发送降级到旧 messages 路径时也会透传 permissionMode", async () => {
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

    mocked.sendLiveMessage.mockRejectedValueOnce(
      new ApiError(404, {
        detail: "live route not found",
        error_code: "NOT_FOUND"
      })
    );
    mocked.sendSessionMessage.mockResolvedValueOnce({
      sessionId: "session-1",
      acceptedAt: "2026-03-24T10:00:02.000Z",
      clientRequestId: expect.any(String),
      message: {
        messageId: "user-message-fallback-1",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "user",
        kind: "text",
        content: "旧链路继续发",
        timestamp: "2026-03-24T10:00:02.000Z",
        sequence: 61,
        rawRef: "codex://raw#line=61",
        toolCall: null,
        attachments: []
      }
    });

    await store.sendMessage("旧链路继续发");

    expect(mocked.sendSessionMessage).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        content: "旧链路继续发",
        permissionMode: "bypassPermissions"
      })
    );
  });

  it("消息体超限时会保留明确错误原因和上限说明", async () => {
    const store = new SessionRuntimeStore("session-1");

    mocked.sendLiveMessage.mockRejectedValueOnce(
      new ApiError(413, {
        detail: "请求体超过大小限制，当前上限为 64 MiB（67,108,864 字节）。请压缩图片、减少附件，或拆分后再发送。",
        error_code: "REQUEST_BODY_TOO_LARGE",
        field: "body",
        data: {
          bodyLimitBytes: 67108864
        }
      })
    );

    await expect(store.sendMessage("带图消息")).rejects.toMatchObject({
      status: 413,
      errorCode: "REQUEST_BODY_TOO_LARGE"
    });
    expect(store.getState().errorCode).toBe("REQUEST_BODY_TOO_LARGE");
    expect(store.getState().errorDetail).toContain("64 MiB");
    expect(store.getState().errorDetail).toContain("67,108,864");
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
