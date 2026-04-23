import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../../../config/client-config-store";
import { userPreferenceStore } from "../../../preferences/user-preference-store";
import { authStore } from "../../auth/store/auth-store";
import { clearViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { t } from "../../../shared/i18n";
import { ApiError } from "../../../shared/network/api-error";
import { SessionRuntimeStore } from "./session-runtime-store";

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

describe("SessionRuntimeStore", () => {
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
    vi.useRealTimers();
  });

  it("loads the latest 30 messages from realtime backfill on initialize", async () => {
    vi.useFakeTimers();
    const store = new SessionRuntimeStore("session-1");

    await store.initialize();

    emitRealtimeSubscribed();
    emitRealtimeEnvelope({
      type: "session.backfill",
      sessionId: "session-1",
      cursor: "cursor-latest",
      olderCursor: "cursor-older",
      messages: Array.from({ length: 30 }, (_, index) => ({
        messageId: `message-${index + 31}`,
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        kind: "text",
        content: `message-${index + 31}`,
        timestamp: `2026-03-24T10:${String(index).padStart(2, "0")}:00.000Z`,
        sequence: index + 31,
        rawRef: `codex://raw#line=${index + 31}`,
        toolCall: null
      }))
    });

    expect(mocked.getSessionMessages).not.toHaveBeenCalled();
    expect(store.getState().messages).toHaveLength(30);
    expect(store.getState().messages[0]?.sequence).toBe(31);
    expect(store.getState().messages.at(-1)?.sequence).toBe(60);
    expect(store.getState().hasOlderMessages).toBe(true);
    expect(store.getState().olderCursor).toBe("cursor-older");
    expect(store.getState().lastCursor).toBe("cursor-latest");
    expect(mocked.realtimeInstances[0]?.options.cursor).toBeNull();
    expect(mocked.realtimeInstances[0]?.options.limit).toBe(40);

    store.destroy();
  });

  it("订阅后未收到 backfill 时，会自动走 HTTP 历史兜底避免首屏停在旧快照", async () => {
    vi.useFakeTimers();
    mocked.getSessionMessages.mockResolvedValueOnce({
      messages: [
        {
          messageId: "message-60",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          kind: "text",
          content: "latest-message",
          timestamp: "2026-03-24T10:59:00.000Z",
          sequence: 60,
          rawRef: "codex://raw#line=60",
          toolCall: null
        }
      ],
      cursor: "cursor-latest",
      nextCursor: "cursor-older",
      total: 60
    });
    const store = new SessionRuntimeStore("session-1");

    await store.initialize();
    emitRealtimeSubscribed();
    await vi.advanceTimersByTimeAsync(500);

    expect(mocked.getSessionMessages).toHaveBeenCalledWith(
      "session-1",
      null,
      40,
      "backward"
    );
    expect(store.getState().historyState).toBe("ready");
    expect(store.getState().messages.at(-1)?.id).toBe("message-60");
    expect(store.getState().lastCursor).toBe("cursor-latest");
    expect(store.getState().olderCursor).toBe("cursor-older");

    store.destroy();
  });

  it("活动会话已有较多缓存消息时，HTTP 历史兜底不会主动把首屏拉短", async () => {
    vi.useFakeTimers();
    writeViewSnapshot(SESSION_RUNTIME_SNAPSHOT_KEY, {
      session: null,
      capabilities: null,
      runtimeHasActiveRun: null,
      runtimeCanInterrupt: null,
      contextUsage: null,
      messages: Array.from({ length: 60 }, (_, index) => ({
        id: `fallback-live-${index + 1}`,
        sessionId: "session-1",
        role: "assistant",
        kind: "text",
        content: `fallback-live-${index + 1}`,
        toolCall: null,
        attachments: [],
        attachmentPayloads: null,
        timestamp: `2026-03-24T10:${String(index).padStart(2, "0")}:00.000Z`,
        sequence: index + 1,
        rawRef: `codex://raw#line=${index + 1}`,
        deliveryState: "sent",
        clientRequestId: null
      })),
      permissionRequests: [],
      queuedMessages: [],
      olderCursor: null,
      hasOlderMessages: false,
      lastCursor: null,
      pagesLoaded: 1
    });
    mocked.getSessionMessages.mockResolvedValueOnce({
      messages: Array.from({ length: 60 }, (_, index) => ({
        messageId: `fallback-live-${index + 1}`,
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        kind: "text",
        content: `fallback-live-${index + 1}`,
        timestamp: `2026-03-24T10:${String(index).padStart(2, "0")}:00.000Z`,
        sequence: index + 1,
        rawRef: `codex://raw#line=${index + 1}`,
        toolCall: null
      })),
      cursor: "cursor-latest",
      nextCursor: "cursor-older",
      total: 60
    });

    const store = new SessionRuntimeStore("session-1");

    expect(store.getState().messages).toHaveLength(60);

    await store.initialize();
    emitRealtimeSubscribed();
    await vi.advanceTimersByTimeAsync(500);

    expect(mocked.getSessionMessages).toHaveBeenCalledWith(
      "session-1",
      null,
      60,
      "backward"
    );
    expect(store.getState().messages).toHaveLength(60);
    expect(store.getState().messages[0]?.sequence).toBe(1);
    expect(store.getState().messages.at(-1)?.sequence).toBe(60);
    expect(store.getState().lastCursor).toBe("cursor-latest");
    expect(store.getState().olderCursor).toBe("cursor-older");

    store.destroy();
  });

  it("导航摘要误报 0 条消息时，会持续保持加载态直到真实历史返回", async () => {
    vi.useFakeTimers();
    mocked.getSessionMessages.mockResolvedValueOnce({
      messages: [
        {
          messageId: "message-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          kind: "text",
          content: "真实历史已经返回",
          timestamp: "2026-03-24T10:01:00.000Z",
          sequence: 1,
          rawRef: "codex://raw#line=1",
          toolCall: null
        }
      ],
      cursor: "cursor-latest",
      nextCursor: null,
      total: 1
    });
    const store = new SessionRuntimeStore("session-1", {
      initialSession: {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "raw-1",
        rawStoreRef: "codex://raw-1",
        title: "会话 1",
        messageCount: 0,
        lastMessageAt: "2026-03-24T10:01:00.000Z",
        createdAt: "2026-03-24T09:00:00.000Z",
        updatedAt: "2026-03-24T10:01:00.000Z",
        syncStatus: "idle",
        syncCursor: "cursor-sync",
        lastSyncAt: "2026-03-24T10:01:00.000Z",
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "idle",
        activitySource: "none",
        lastEventAt: "2026-03-24T10:01:00.000Z",
        completedAt: null,
        lastSeenAt: null,
        activityState: "idle"
      }
    });

    await store.initialize();

    expect(store.getState().historyState).toBe("loading");

    emitRealtimeSubscribed();
    await vi.advanceTimersByTimeAsync(200);

    expect(store.getState().historyState).toBe("loading");
    expect(store.getState().messages).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(200);

    expect(store.getState().historyState).toBe("ready");
    expect(store.getState().messages.at(-1)?.id).toBe("message-1");

    store.destroy();
  });

  it("initialize 时会同步拉取当前会话的发送队列", async () => {
    vi.useFakeTimers();
    const store = new SessionRuntimeStore("session-1");
    const queueItems = [
      {
        id: "queue-1",
        sessionId: "session-1",
        content: "下一条排队消息",
        clientRequestId: "client-queue-1",
        model: null,
        reasoningLevel: null,
        permissionMode: null,
        status: "queued",
        orderIndex: 1,
        errorDetail: null,
        createdAt: "2026-03-24T10:00:00.000Z",
        updatedAt: "2026-03-24T10:00:00.000Z"
      }
    ];

    mocked.getSessionQueue.mockResolvedValue({
      items: queueItems
    });

    await store.initialize();

    expect(mocked.getSessionQueue).toHaveBeenCalledTimes(2);
    expect(mocked.getSessionQueue).toHaveBeenCalledWith("session-1");
    expect(store.getState().queuedMessages).toHaveLength(1);
    store.destroy();
  });

  it("skips detail, capabilities and runtime bootstrap requests when snapshot already has them", async () => {
    vi.useFakeTimers();
    writeViewSnapshot(SESSION_RUNTIME_SNAPSHOT_KEY, {
      session: {
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
      },
      capabilities: {
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
      },
      contextUsage: {
        provider: "codex",
        promptTokens: 64000,
        uncachedInputTokens: 40000,
        cachedInputTokens: 24000,
        contextWindow: 200000,
        usageRatio: 0.32,
        source: "provider-log",
        contextWindowSource: "provider-log",
        modelId: "gpt-5.3-codex",
        capturedAt: "2026-03-24T10:00:00.000Z",
        isEstimated: false
      },
      messages: [],
      queuedMessages: []
    });
    const store = new SessionRuntimeStore("session-1");

    mocked.getSessionMessages.mockResolvedValueOnce({
      messages: [],
      cursor: "cursor-latest",
      nextCursor: null,
      total: 0
    });

    await store.initialize();

    expect(mocked.getSessionDetail).not.toHaveBeenCalled();
    expect(mocked.getSessionCapabilities).not.toHaveBeenCalled();
    expect(mocked.getSessionRuntime).not.toHaveBeenCalled();
    expect(mocked.getSessionMessages).not.toHaveBeenCalled();

    store.destroy();
  });

  it("缓存里残留 running 态时，initialize 会主动刷新 runtime 快照纠正终态", async () => {
    vi.useFakeTimers();
    writeViewSnapshot(SESSION_RUNTIME_SNAPSHOT_KEY, {
      session: {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "raw-1",
        rawStoreRef: "codex://raw-1",
        title: "会话 1",
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
        runningState: "running",
        activitySource: "runtime",
        activityResolutionSource: "authoritative_runtime",
        activityConfidence: "authoritative",
        runId: "runtime:session-1:2026-03-24T09:59:00.000Z",
        lastEventAt: "2026-03-24T10:00:00.000Z",
        completedAt: null,
        lastSeenAt: null,
        activityState: "running",
        watchdogTriggeredAt: null
      },
      capabilities: {
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
      },
      runtimeHasActiveRun: true,
      runtimeCanInterrupt: true,
      contextUsage: {
        provider: "codex",
        promptTokens: 64000,
        uncachedInputTokens: 40000,
        cachedInputTokens: 24000,
        contextWindow: 200000,
        usageRatio: 0.32,
        source: "provider-log",
        contextWindowSource: "provider-log",
        modelId: "gpt-5.3-codex",
        capturedAt: "2026-03-24T10:00:00.000Z",
        isEstimated: false
      },
      messages: [],
      permissionRequests: [],
      queuedMessages: [],
      olderCursor: null,
      hasOlderMessages: false,
      lastCursor: null,
      pagesLoaded: 0,
      interruptSource: null
    });
    mocked.getSessionRuntime.mockResolvedValueOnce({
      sessionId: "session-1",
      runningState: "completed",
      hasActiveRun: false,
      canAttach: false,
      canInterrupt: false,
      inRunInputMode: "none",
      provider: "codex",
      providerSessionId: "raw-1",
      activityResolutionSource: "authoritative_runtime",
      activityConfidence: "strong",
      runId: "runtime:session-1:2026-03-24T09:59:00.000Z",
      detail: "run completed",
      interruptSource: null,
      errorCode: null,
      errorDetail: null,
      updatedAt: "2026-03-24T10:01:00.000Z",
      watchdogTriggeredAt: null,
      contextUsage: {
        provider: "codex",
        promptTokens: 65000,
        uncachedInputTokens: 41000,
        cachedInputTokens: 24000,
        contextWindow: 200000,
        usageRatio: 0.325,
        source: "provider-runtime",
        contextWindowSource: "provider-runtime",
        modelId: "gpt-5.4",
        capturedAt: "2026-03-24T10:01:00.000Z",
        isEstimated: false
      }
    });

    const store = new SessionRuntimeStore("session-1");

    await store.initialize();

    expect(mocked.getSessionRuntime).toHaveBeenCalledTimes(1);
    expect(store.getState().session?.runningState).toBe("completed");
    expect(store.getState().session?.activityState).toBe("completed_unread");
    expect(store.getState().runtimeHasActiveRun).toBe(false);
    expect(store.getState().runtimeCanInterrupt).toBe(false);

    store.destroy();
  });

  it("首屏 backfill 会替换掉旧快照里的过期消息，而不是和旧半截混在一起", async () => {
    vi.useFakeTimers();
    writeViewSnapshot(SESSION_RUNTIME_SNAPSHOT_KEY, {
      session: {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "raw-1",
        rawStoreRef: "codex://raw-1",
        title: "会话 1",
        messageCount: 60,
        lastMessageAt: "2026-03-24T10:29:00.000Z",
        createdAt: "2026-03-24T09:00:00.000Z",
        updatedAt: "2026-03-24T10:29:00.000Z",
        syncStatus: "idle",
        syncCursor: "cursor-sync",
        lastSyncAt: "2026-03-24T10:29:00.000Z",
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "idle",
        activitySource: "none",
        lastEventAt: "2026-03-24T10:29:00.000Z",
        completedAt: null,
        lastSeenAt: null,
        activityState: "idle"
      },
      capabilities: null,
      contextUsage: null,
      messages: Array.from({ length: 30 }, (_, index) => ({
        id: `snapshot-message-${index + 1}`,
        sessionId: "session-1",
        role: "assistant" as const,
        kind: "text" as const,
        content: `snapshot-message-${index + 1}`,
        toolCall: null,
        attachments: [],
        attachmentPayloads: null,
        timestamp: `2026-03-24T09:${String(index).padStart(2, "0")}:00.000Z`,
        sequence: index + 1,
        rawRef: `codex://raw#line=${index + 1}`,
        deliveryState: "sent" as const,
        clientRequestId: null
      })),
      queuedMessages: []
    });

    const store = new SessionRuntimeStore("session-1");
    await store.initialize();

    expect(store.getState().historyState).toBe("loading");

    emitRealtimeEnvelope({
      type: "session.backfill",
      sessionId: "session-1",
      cursor: "cursor-latest",
      olderCursor: "cursor-older",
      messages: Array.from({ length: 30 }, (_, index) => ({
        messageId: `message-${index + 31}`,
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        kind: "text",
        content: `message-${index + 31}`,
        timestamp: `2026-03-24T10:${String(index).padStart(2, "0")}:00.000Z`,
        sequence: index + 31,
        rawRef: `codex://raw#line=${index + 31}`,
        toolCall: null
      }))
    });

    expect(store.getState().messages).toHaveLength(30);
    expect(store.getState().messages[0]?.sequence).toBe(31);
    expect(store.getState().messages.at(-1)?.sequence).toBe(60);

    store.destroy();
  });

  it("首屏 backfill 比本地快照更旧时，不会把最新消息回滚掉", async () => {
    writeViewSnapshot(SESSION_RUNTIME_SNAPSHOT_KEY, {
      session: null,
      capabilities: null,
      runtimeHasActiveRun: null,
      runtimeCanInterrupt: null,
      contextUsage: null,
      messages: Array.from({ length: 12 }, (_, index) => ({
        id: `cached-tail-${index + 1}`,
        sessionId: "session-1",
        role: "assistant" as const,
        kind: "text" as const,
        content: `cached-tail-${index + 1}`,
        toolCall: null,
        attachments: [],
        attachmentPayloads: null,
        timestamp: `2026-03-24T10:${String(index).padStart(2, "0")}:00.000Z`,
        sequence: index + 1,
        rawRef: `codex://raw#line=${index + 1}`,
        deliveryState: "sent" as const,
        clientRequestId: null
      })),
      permissionRequests: [],
      queuedMessages: [],
      olderCursor: null,
      hasOlderMessages: false,
      lastCursor: "cursor-before",
      pagesLoaded: 1
    });

    const store = new SessionRuntimeStore("session-1");
    await store.initialize();
    emitRealtimeSubscribed();
    emitRealtimeEnvelope({
      type: "session.backfill",
      sessionId: "session-1",
      cursor: "cursor-after",
      olderCursor: "cursor-older",
      messages: Array.from({ length: 11 }, (_, index) => ({
        messageId: `cached-tail-${index + 1}`,
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        kind: "text",
        content: `cached-tail-${index + 1}`,
        timestamp: `2026-03-24T10:${String(index).padStart(2, "0")}:00.000Z`,
        sequence: index + 1,
        rawRef: `codex://raw#line=${index + 1}`,
        toolCall: null
      }))
    });

    expect(store.getState().messages).toHaveLength(12);
    expect(store.getState().messages.at(-1)?.id).toBe("cached-tail-12");
    expect(store.getState().messages.at(-1)?.content).toBe("cached-tail-12");
    expect(store.getState().lastCursor).toBe("cursor-after");

    store.destroy();
  });

  it("缓存里只有 provider-default 时，会重新刷新 capabilities", async () => {
    vi.useFakeTimers();
    writeViewSnapshot(SESSION_RUNTIME_SNAPSHOT_KEY, {
      session: {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "opencode",
        providerSessionId: "raw-1",
        rawStoreRef: "opencode://raw-1",
        title: "会话 1",
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
      },
      capabilities: {
        provider: "opencode",
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
        modelOptions: [
          {
            id: "provider-default",
            name: "跟随 OpenCode 默认模型",
            usesProviderDefault: true
          }
        ],
        limitations: []
      },
      contextUsage: {
        provider: "opencode",
        promptTokens: 100,
        uncachedInputTokens: 100,
        cachedInputTokens: 0,
        contextWindow: 200000,
        usageRatio: 0.001,
        source: "provider-runtime",
        contextWindowSource: "provider-runtime",
        modelId: "opencode/gpt-5-nano",
        capturedAt: "2026-03-24T10:00:00.000Z",
        isEstimated: false
      },
      messages: [],
      queuedMessages: []
    });
    mocked.getSessionCapabilities.mockResolvedValueOnce({
      provider: "opencode",
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
      modelOptions: [
        {
          id: "provider-default",
          name: "跟随 OpenCode 默认模型",
          usesProviderDefault: true
        },
        {
          id: "opencode/gpt-5-nano",
          name: "opencode/gpt-5-nano"
        }
      ],
      limitations: []
    });

    const store = new SessionRuntimeStore("session-1");

    mocked.getSessionMessages.mockResolvedValueOnce({
      messages: [],
      cursor: "cursor-latest",
      nextCursor: null,
      total: 0
    });

    await store.initialize();

    expect(mocked.getSessionCapabilities).toHaveBeenCalledTimes(1);
    expect(store.getState().capabilities?.modelOptions).toEqual([
      {
        id: "provider-default",
        name: "跟随 OpenCode 默认模型",
        usesProviderDefault: true
      },
      {
        id: "opencode/gpt-5-nano",
        name: "opencode/gpt-5-nano"
      }
    ]);

    store.destroy();
  });

  it("缓存里已有正式消息时，会忽略重复的 bootstrap synthetic 用户消息", () => {
    writeViewSnapshot(SESSION_RUNTIME_SNAPSHOT_KEY, {
      session: {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "opencode",
        providerSessionId: "thread-1",
        rawStoreRef: "opencode://thread-1",
        title: "会话 1",
        messageCount: 1,
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
      },
      capabilities: null,
      contextUsage: null,
      messages: [
        {
          id: "server-user-1",
          sessionId: "session-1",
          role: "user",
          kind: "text",
          content: "你好",
          toolCall: null,
          attachments: [],
          attachmentPayloads: null,
          timestamp: "2026-03-24T10:00:00.000Z",
          sequence: 1,
          rawRef: "opencode://thread-1#line=1",
          deliveryState: "sent",
          clientRequestId: null
        }
      ],
      queuedMessages: []
    });

    const store = new SessionRuntimeStore("session-1", {
      bootstrapMessages: [
        {
          messageId: "synthetic-bootstrap-1",
          provider: "opencode",
          providerSessionId: "thread-1",
          role: "user",
          kind: "text",
          content: "你好",
          toolCall: null,
          attachments: [],
          timestamp: "2026-03-24T10:00:00.100Z",
          sequence: 1,
          rawRef: "synthetic://opencode/thread-1/bootstrap-1"
        }
      ]
    });

    expect(store.getState().messages).toHaveLength(1);
    expect(store.getState().messages[0]?.id).toBe("server-user-1");

    store.destroy();
  });

  it("loads older messages through realtime without rewinding the realtime cursor", async () => {
    vi.useFakeTimers();
    const store = new SessionRuntimeStore("session-1");

    await store.initialize();
    emitRealtimeSubscribed();
    emitRealtimeEnvelope({
      type: "session.backfill",
      sessionId: "session-1",
      cursor: "cursor-latest",
      olderCursor: "cursor-older-1",
      messages: Array.from({ length: 30 }, (_, index) => ({
        messageId: `message-${index + 31}`,
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        kind: "text",
        content: `message-${index + 31}`,
        timestamp: `2026-03-24T10:${String(index).padStart(2, "0")}:00.000Z`,
        sequence: index + 31,
        rawRef: `codex://raw#line=${index + 31}`,
        toolCall: null
      }))
    });
    await store.loadOlderMessages();

    expect(mocked.realtimeInstances[0]?.requestOlderMessages).toHaveBeenCalledWith(
      "cursor-older-1",
      30
    );
    emitRealtimeOlderHistory({
      type: "session.history_older",
      sessionId: "session-1",
      cursor: null,
      olderCursor: null,
      messages: Array.from({ length: 30 }, (_, index) => ({
        messageId: `message-${index + 1}`,
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        kind: "text",
        content: `message-${index + 1}`,
        timestamp: `2026-03-24T09:${String(index).padStart(2, "0")}:00.000Z`,
        sequence: index + 1,
        rawRef: `codex://raw#line=${index + 1}`,
        toolCall: null
      }))
    });

    expect(store.getState().lastCursor).toBe("cursor-latest");
    expect(store.getState().messages).toHaveLength(60);
    expect(store.getState().olderCursor).toBeNull();

    store.destroy();
  });

  it("会把已懒加载的历史消息和 olderCursor 一起写入快照，切走再回来后仍能恢复到更早位置", async () => {
    writeViewSnapshot(SESSION_RUNTIME_SNAPSHOT_KEY, {
      session: null,
      capabilities: null,
      runtimeHasActiveRun: null,
      runtimeCanInterrupt: null,
      contextUsage: null,
      messages: Array.from({ length: 90 }, (_, index) => ({
        id: `cached-message-${index + 1}`,
        sessionId: "session-1",
        role: "assistant",
        kind: "text",
        content: `cached-message-${index + 1}`,
        toolCall: null,
        attachments: [],
        attachmentPayloads: null,
        timestamp: `2026-03-24T10:${String(index).padStart(2, "0")}:00.000Z`,
        sequence: index + 1,
        rawRef: `codex://raw#line=${index + 1}`,
        deliveryState: "sent",
        clientRequestId: null
      })),
      permissionRequests: [],
      queuedMessages: [],
      olderCursor: "cursor-older-3",
      hasOlderMessages: true,
      lastCursor: "cursor-latest",
      pagesLoaded: 3
    });

    const store = new SessionRuntimeStore("session-1");

    expect(store.getState().messages).toHaveLength(90);
    expect(store.getState().messages[0]?.sequence).toBe(1);
    expect(store.getState().messages.at(-1)?.sequence).toBe(90);
    expect(store.getState().olderCursor).toBe("cursor-older-3");
    expect(store.getState().hasOlderMessages).toBe(true);
    expect(store.getState().lastCursor).toBe("cursor-latest");
    expect(store.getState().pagesLoaded).toBe(3);

    store.destroy();
  });

  it("已有多页懒加载历史时，重新进入会话不会被首个 backfill 截断成最新一页", async () => {
    writeViewSnapshot(SESSION_RUNTIME_SNAPSHOT_KEY, {
      session: null,
      capabilities: null,
      runtimeHasActiveRun: null,
      runtimeCanInterrupt: null,
      contextUsage: null,
      messages: Array.from({ length: 90 }, (_, index) => ({
        id: `cached-expanded-${index + 1}`,
        sessionId: "session-1",
        role: "assistant",
        kind: "text",
        content: `cached-expanded-${index + 1}`,
        toolCall: null,
        attachments: [],
        attachmentPayloads: null,
        timestamp: `2026-03-24T10:${String(index).padStart(2, "0")}:00.000Z`,
        sequence: index + 1,
        rawRef: `codex://raw#line=${index + 1}`,
        deliveryState: "sent",
        clientRequestId: null
      })),
      permissionRequests: [],
      queuedMessages: [],
      olderCursor: "cursor-older-3",
      hasOlderMessages: true,
      lastCursor: "cursor-latest-before",
      pagesLoaded: 3
    });

    const store = new SessionRuntimeStore("session-1");
    await store.initialize();
    emitRealtimeSubscribed();
    emitRealtimeEnvelope({
      type: "session.backfill",
      sessionId: "session-1",
      cursor: "cursor-latest-after",
      olderCursor: "cursor-older-1",
      messages: Array.from({ length: 30 }, (_, index) => ({
        messageId: `cached-expanded-${index + 61}`,
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        kind: "text",
        content: `cached-expanded-${index + 61}`,
        timestamp: `2026-03-24T11:${String(index).padStart(2, "0")}:00.000Z`,
        sequence: index + 61,
        rawRef: `codex://raw#line=${index + 61}`,
        toolCall: null
      }))
    });

    expect(store.getState().messages).toHaveLength(90);
    expect(store.getState().messages[0]?.sequence).toBe(1);
    expect(store.getState().messages.at(-1)?.sequence).toBe(90);
    expect(store.getState().olderCursor).toBe("cursor-older-3");
    expect(store.getState().hasOlderMessages).toBe(true);
    expect(store.getState().pagesLoaded).toBe(3);
    expect(store.getState().lastCursor).toBe("cursor-latest-after");

    store.destroy();
  });

  it("活动会话的缓存消息已超过实时首屏窗口时，不会被首个 backfill 截断变少", async () => {
    writeViewSnapshot(SESSION_RUNTIME_SNAPSHOT_KEY, {
      session: null,
      capabilities: null,
      runtimeHasActiveRun: null,
      runtimeCanInterrupt: null,
      contextUsage: null,
      messages: Array.from({ length: 60 }, (_, index) => ({
        id: `cached-live-${index + 1}`,
        sessionId: "session-1",
        role: "assistant",
        kind: "text",
        content: `cached-live-${index + 1}`,
        toolCall: null,
        attachments: [],
        attachmentPayloads: null,
        timestamp: `2026-03-24T10:${String(index).padStart(2, "0")}:00.000Z`,
        sequence: index + 1,
        rawRef: `codex://raw#line=${index + 1}`,
        deliveryState: "sent",
        clientRequestId: null
      })),
      permissionRequests: [],
      queuedMessages: [],
      olderCursor: null,
      hasOlderMessages: false,
      lastCursor: "cursor-latest-before",
      pagesLoaded: 1
    });

    const store = new SessionRuntimeStore("session-1");
    await store.initialize();
    emitRealtimeSubscribed();
    emitRealtimeEnvelope({
      type: "session.backfill",
      sessionId: "session-1",
      cursor: "cursor-latest-after",
      olderCursor: "cursor-older-1",
      messages: Array.from({ length: 40 }, (_, index) => ({
        messageId: `cached-live-${index + 21}`,
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        kind: "text",
        content: `cached-live-${index + 21}`,
        timestamp: `2026-03-24T11:${String(index).padStart(2, "0")}:00.000Z`,
        sequence: index + 21,
        rawRef: `codex://raw#line=${index + 21}`,
        toolCall: null
      }))
    });

    expect(store.getState().messages).toHaveLength(60);
    expect(store.getState().messages[0]?.sequence).toBe(1);
    expect(store.getState().messages.at(-1)?.sequence).toBe(60);
    expect(store.getState().lastCursor).toBe("cursor-latest-after");

    store.destroy();
  });

  it("does not overwrite a terminal state back to running on later envelopes", async () => {
    vi.useFakeTimers();
    const store = new SessionRuntimeStore("session-1");

    mocked.getSessionRuntime.mockResolvedValueOnce({
      sessionId: "session-1",
      runningState: "running",
      hasActiveRun: true,
      canAttach: true,
      canInterrupt: true,
      inRunInputMode: "none",
      provider: "codex",
      providerSessionId: "raw-1",
      detail: null,
      interruptSource: null,
      updatedAt: "2026-03-24T10:00:00.000Z",
      contextUsage: null
    });
    mocked.getSessionMessages.mockResolvedValueOnce({
      messages: [],
      cursor: "cursor-latest",
      nextCursor: null,
      total: 0
    });

    await store.initialize();
    mocked.getSessionRuntime.mockClear();

    const client = mocked.realtimeInstances[0];
    expect(client).toBeDefined();

    (client!.options.onRuntimeStatus as ((event: Record<string, unknown>) => void))({
      type: "session.runtime_status",
      sessionId: "session-1",
      status: "completed",
      detail: "run completed",
      timestamp: "2026-03-24T10:00:10.000Z"
    });

    (client!.options.onEnvelope as ((event: Record<string, unknown>) => void))({
      type: "session.delta",
      sessionId: "session-1",
      cursor: "cursor-after",
      messages: [
        {
          messageId: "assistant-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          kind: "text",
          content: "done",
          timestamp: "2026-03-24T10:00:10.100Z",
          sequence: 1,
          rawRef: "codex://raw#line=1",
          toolCall: null
        }
      ]
    });

    expect(store.getState().session?.runningState).toBe("completed");

    store.destroy();
  });

  it("收到 session.runtime_message 时会直接合并正文，不等历史轮询", async () => {
    const store = new SessionRuntimeStore("session-1");
    await store.initialize();
    emitRealtimeSubscribed();

    emitRealtimeRuntimeMessage({
      type: "session.runtime_message",
      sessionId: "session-1",
      source: "runtime",
      message: {
        messageId: "assistant-runtime-1",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "assistant",
        kind: "text",
        content: "第一段",
        timestamp: "2026-03-28T10:00:00.000Z",
        sequence: 70,
        rawRef: "opencode://session/thread-1/message/assistant-1/part/text-1",
        toolCall: null
      }
    });

    expect(store.getState().messages.at(-1)?.id).toBe("assistant-runtime-1");
    expect(store.getState().messages.at(-1)?.content).toBe("第一段");
    expect(store.getState().historyState).toBe("ready");

    emitRealtimeRuntimeMessage({
      type: "session.runtime_message",
      sessionId: "session-1",
      source: "runtime",
      message: {
        messageId: "assistant-runtime-1",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "assistant",
        kind: "text",
        content: "第一段\n第二段",
        timestamp: "2026-03-28T10:00:01.000Z",
        sequence: 70,
        rawRef: "opencode://session/thread-1/message/assistant-1/part/text-1",
        toolCall: null
      }
    });

    expect(store.getState().messages).toHaveLength(1);
    expect(store.getState().messages[0]?.content).toBe("第一段\n第二段");

    store.destroy();
  });

  it("Codex 运行时消息和后续 backfill 使用不同 messageId 时，前端只保留一条权威消息", async () => {
    const store = new SessionRuntimeStore("session-1");
    await store.initialize();
    emitRealtimeSubscribed();

    emitRealtimeRuntimeMessage({
      type: "session.runtime_message",
      sessionId: "session-1",
      source: "runtime",
      message: {
        messageId: "assistant-runtime-1",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        kind: "text",
        content: "代码已经改完了，继续补回归。",
        timestamp: "2026-04-13T10:00:00.000Z",
        sequence: 70,
        rawRef: "codex://raw#line=18",
        toolCall: null
      }
    });

    emitRealtimeEnvelope({
      type: "session.backfill",
      sessionId: "session-1",
      cursor: "cursor-after",
      messages: [
        {
          messageId: "assistant-history-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          kind: "text",
          content: "代码已经改完了，继续补回归。",
          timestamp: "2026-04-13T10:00:35.000Z",
          sequence: 72,
          rawRef: "codex://raw#line=32",
          toolCall: null
        }
      ]
    });

    expect(store.getState().messages).toHaveLength(1);
    expect(store.getState().messages[0]).toMatchObject({
      id: "assistant-history-1",
      content: "代码已经改完了，继续补回归。"
    });

    store.destroy();
  });

  it("Claude synthetic user 在 runtime assistant 回流时仍保持正确时间线顺序", async () => {
    mocked.getSessionDetail.mockResolvedValueOnce({
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
      runningState: "idle",
      activitySource: "none",
      lastEventAt: "2026-03-24T10:00:00.000Z",
      completedAt: null,
      lastSeenAt: null,
      activityState: "idle"
    });
    mocked.getSessionCapabilities.mockResolvedValueOnce({
      provider: "claude-code",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "streaming_guidance",
      supportsSubagents: true,
      supportsInterrupt: false,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      limitations: []
    });
    mocked.getSessionRuntime.mockResolvedValueOnce({
      sessionId: "session-1",
      runningState: "idle",
      hasActiveRun: false,
      canAttach: true,
      canInterrupt: false,
      inRunInputMode: "streaming_guidance",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      detail: null,
      errorCode: null,
      errorDetail: null,
      updatedAt: "2026-03-24T10:00:00.000Z",
      contextUsage: null
    });
    mocked.sendLiveMessage.mockResolvedValueOnce({
      sessionId: "session-1",
      acceptedAt: "2026-03-24T10:00:02.000Z",
      clientRequestId: "client-1",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      message: {
        messageId: "synthetic-user-1",
        provider: "claude-code",
        providerSessionId: "claude-session-1",
        role: "user",
        kind: "text",
        content: "仅回复：OK",
        timestamp: "2026-03-24T10:00:02.000Z",
        sequence: 4,
        rawRef: "synthetic://claude-code/claude-session-1/synthetic-user-1",
        toolCall: null,
        attachments: []
      }
    });

    const store = new SessionRuntimeStore("session-1");
    await store.initialize();
    emitRealtimeSubscribed();

    await store.sendMessage("仅回复：OK");

    emitRealtimeRuntimeMessage({
      type: "session.runtime_message",
      sessionId: "session-1",
      source: "runtime",
      message: {
        messageId: "assistant-runtime-2",
        provider: "claude-code",
        providerSessionId: "claude-session-1",
        role: "assistant",
        kind: "text",
        content: "OK",
        timestamp: "2026-03-24T10:00:03.000Z",
        sequence: 5,
        rawRef: "claude-code://message/runtime-assistant-2",
        toolCall: null
      }
    });

    expect(store.getState().messages.map((message) => message.content)).toEqual([
      "仅回复：OK",
      "OK"
    ]);
    expect(store.getState().messages.map((message) => message.role)).toEqual([
      "user",
      "assistant"
    ]);

    store.destroy();
  });

  it("Codex 进入 running 后会显示正在思考占位，并在 assistant 正文到达后移除", async () => {
    const store = new SessionRuntimeStore("session-1");
    await store.initialize();
    emitRealtimeSubscribed();
    emitRealtimeEnvelope({
      type: "session.backfill",
      sessionId: "session-1",
      cursor: "cursor-before",
      olderCursor: null,
      messages: [
        {
          messageId: "user-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "user",
          kind: "text",
          content: "继续",
          timestamp: "2026-03-24T10:00:00.000Z",
          sequence: 1,
          rawRef: "codex://raw#line=0",
          toolCall: null
        }
      ]
    });

    const client = getRealtimeClient();
    (client.options.onRuntimeStatus as ((event: Record<string, unknown>) => void))({
      type: "session.runtime_status",
      sessionId: "session-1",
      status: "running",
      detail: "run started",
      timestamp: "2026-03-24T10:00:00.000Z"
    });

    expect(store.getState().messages.at(-1)).toMatchObject({
      role: "user",
      kind: "text",
      content: "继续"
    });

    emitRealtimeRuntimeMessage({
      type: "session.runtime_message",
      sessionId: "session-1",
      source: "runtime",
      message: {
        messageId: "assistant-runtime-codex-1",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        kind: "text",
        content: "已经开始回答",
        timestamp: "2026-03-24T10:00:02.000Z",
        sequence: 1,
        rawRef: "codex://raw#line=1",
        toolCall: null
      }
    });

    expect(
      store.getState().messages.some((message) =>
        message.content === t("conversation.runtimeThinkingPlaceholder", {
          provider: t("conversation.providerCodex")
        })
      )
    ).toBe(false);
    expect(store.getState().messages.at(-1)?.content).toBe("已经开始回答");

    store.destroy();
  });

  it("does not overwrite a completed state when a late runtime error arrives", async () => {
    vi.useFakeTimers();
    const store = new SessionRuntimeStore("session-1");

    mocked.getSessionRuntime.mockResolvedValueOnce({
      sessionId: "session-1",
      runningState: "running",
      hasActiveRun: true,
      canAttach: true,
      canInterrupt: true,
      inRunInputMode: "streaming_guidance",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      detail: null,
      updatedAt: "2026-03-24T10:00:00.000Z",
      contextUsage: null
    });
    mocked.getSessionMessages.mockResolvedValueOnce({
      messages: [],
      cursor: "cursor-latest",
      nextCursor: null,
      total: 0
    });

    await store.initialize();

    const client = mocked.realtimeInstances[0];
    expect(client).toBeDefined();

    (client!.options.onRuntimeStatus as ((event: Record<string, unknown>) => void))({
      type: "session.runtime_status",
      sessionId: "session-1",
      status: "completed",
      detail: "run completed",
      timestamp: "2026-03-24T10:00:10.000Z"
    });

    (client!.options.onRuntimeError as ((event: Record<string, unknown>) => void))({
      type: "session.runtime_error",
      sessionId: "session-1",
      error_code: "PROVIDER_RUNTIME_ERROR",
      detail: "late provider error",
      timestamp: "2026-03-24T10:00:10.100Z"
    });

    expect(store.getState().session?.runningState).toBe("completed");
    expect(store.getState().errorCode).toBeNull();
    expect(store.getState().errorDetail).toBe("run completed");

    store.destroy();
  });

  it("收到终态 runtime status 后会清掉残留的 running activityState", async () => {
    vi.useFakeTimers();
    const store = new SessionRuntimeStore("session-1");

    mocked.getSessionRuntime.mockResolvedValueOnce({
      sessionId: "session-1",
      runningState: "running",
      hasActiveRun: true,
      canAttach: true,
      canInterrupt: true,
      inRunInputMode: "streaming_guidance",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      detail: null,
      updatedAt: "2026-03-24T10:00:00.000Z",
      contextUsage: null
    });
    mocked.getSessionDetail.mockResolvedValueOnce({
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
      lastEventAt: "2026-03-24T10:00:00.000Z",
      completedAt: null,
      lastSeenAt: null,
      activityState: "running"
    });
    mocked.getSessionMessages.mockResolvedValueOnce({
      messages: [],
      cursor: "cursor-latest",
      nextCursor: null,
      total: 0
    });

    await store.initialize();

    const client = mocked.realtimeInstances[0];
    expect(client).toBeDefined();

    (client!.options.onRuntimeStatus as ((event: Record<string, unknown>) => void))({
      type: "session.runtime_status",
      sessionId: "session-1",
      status: "completed",
      detail: "run completed",
      timestamp: "2026-03-24T10:00:10.000Z"
    });

    expect(store.getState().session?.runningState).toBe("completed");
    expect(store.getState().session?.activityState).toBe("idle");

    store.destroy();
  });

  it("轮询 runtime 时会把持久化错误详情带回前端状态", async () => {
    vi.useFakeTimers();
    const store = new SessionRuntimeStore("session-1");

    mocked.getSessionRuntime.mockResolvedValueOnce({
      sessionId: "session-1",
      runningState: "running",
      hasActiveRun: true,
      canAttach: true,
      canInterrupt: true,
      inRunInputMode: "streaming_guidance",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      detail: null,
      errorCode: null,
      errorDetail: null,
      updatedAt: "2026-03-24T10:00:00.000Z",
      contextUsage: null
    });
    mocked.getSessionMessages.mockResolvedValueOnce({
      messages: [],
      cursor: "cursor-latest",
      nextCursor: null,
      total: 0
    });

    await store.initialize();
    emitRealtimeSubscribed();

    mocked.getSessionRuntime.mockResolvedValueOnce({
      sessionId: "session-1",
      runningState: "failed",
      hasActiveRun: false,
      canAttach: false,
      canInterrupt: false,
      inRunInputMode: "streaming_guidance",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      detail: "npm ERR! missing script: dev",
      errorCode: "CLAUDE_CLI_EXIT_NON_ZERO",
      errorDetail: "npm ERR! missing script: dev",
      updatedAt: "2026-03-24T10:00:10.000Z",
      contextUsage: null
    });

    await (store as any).refreshRuntimeState("poll", "test_fallback_error");

    expect(store.getState().session?.runningState).toBe("failed");
    expect(store.getState().errorCode).toBe("CLAUDE_CLI_EXIT_NON_ZERO");
    expect(store.getState().errorDetail).toBe("npm ERR! missing script: dev");

    store.destroy();
  });

  it("收到 session.backfill 时不会把空闲会话误抬成 running", async () => {
    vi.useFakeTimers();
    const store = new SessionRuntimeStore("session-1");

    mocked.getSessionMessages.mockResolvedValueOnce({
      messages: [],
      cursor: "cursor-latest",
      nextCursor: null,
      total: 0
    });

    await store.initialize();

    const client = mocked.realtimeInstances[0];
    expect(client).toBeDefined();

    (client!.options.onEnvelope as ((event: Record<string, unknown>) => void))({
      type: "session.backfill",
      sessionId: "session-1",
      cursor: "cursor-after",
      messages: [
        {
          messageId: "assistant-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          kind: "text",
          content: "历史消息",
          timestamp: "2026-03-24T10:00:10.000Z",
          sequence: 1,
          rawRef: "codex://raw#line=1",
          toolCall: null
        }
      ]
    });

    expect(store.getState().session?.runningState).toBe("idle");

    store.destroy();
  });

  it("realtime 保持连接时不会因为消息增量而额外轮询 runtime", async () => {
    vi.useFakeTimers();
    const store = new SessionRuntimeStore("session-1");

    mocked.getSessionMessages.mockResolvedValueOnce({
      messages: [],
      cursor: "cursor-latest",
      nextCursor: null,
      total: 0
    });

    await store.initialize();
    mocked.getSessionRuntime.mockClear();

    const client = mocked.realtimeInstances[0];
    expect(client).toBeDefined();

    (client!.options.onEnvelope as ((event: Record<string, unknown>) => void))({
      type: "session.delta",
      sessionId: "session-1",
      cursor: "cursor-after",
      messages: [
        {
          messageId: "assistant-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          kind: "text",
          content: "final answer",
          timestamp: "2026-03-24T10:00:01.000Z",
          sequence: 1,
          rawRef: "codex://raw#line=1",
          toolCall: null
        }
      ]
    });

    expect(store.getState().session?.runningState).toBe("running");

    await vi.advanceTimersByTimeAsync(12_000);

    expect(mocked.getSessionRuntime).not.toHaveBeenCalled();
    expect(store.getState().session?.runningState).toBe("running");

    store.destroy();
  });

  it("falls back to polling runtime only while realtime is disconnected", async () => {
    vi.useFakeTimers();
    const store = new SessionRuntimeStore("session-1", {
      initialSession: {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "raw-1",
        rawStoreRef: "codex://raw-1",
        title: "session-1",
        messageCount: 1,
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
        activitySource: "none",
        lastEventAt: "2026-03-24T10:00:00.000Z",
        completedAt: null,
        lastSeenAt: null,
        activityState: "idle"
      }
    });

    mocked.getSessionRuntime.mockResolvedValue({
      sessionId: "session-1",
      runningState: "running",
      hasActiveRun: true,
      canAttach: true,
      canInterrupt: true,
      inRunInputMode: "none",
      provider: "codex",
      providerSessionId: "raw-1",
      detail: null,
      updatedAt: "2026-03-24T10:00:00.000Z",
      contextUsage: null
    });
    mocked.getSessionMessages.mockResolvedValue({
      messages: [],
      cursor: "cursor-latest",
      nextCursor: null,
      total: 0
    });

    await store.initialize();
    mocked.getSessionRuntime.mockClear();

    const client = mocked.realtimeInstances[0];
    expect(client).toBeDefined();

    (client!.options.onConnectionChange as ((state: string) => void))("reconnecting");

    await vi.advanceTimersByTimeAsync(9_999);
    expect(mocked.getSessionRuntime).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mocked.getSessionRuntime).toHaveBeenCalledTimes(1);

    (client!.options.onConnectionChange as ((state: string) => void))("connected");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocked.getSessionRuntime).toHaveBeenCalledTimes(1);

    store.destroy();
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

  it("marks navigation as seen after markSessionSeen succeeds", async () => {
    vi.useFakeTimers();
    const onSeen = vi.fn();
    const store = new SessionRuntimeStore("session-1", {
      onSeen
    });

    await store.initialize();
    emitRealtimeSubscribed();
    emitRealtimeEnvelope({
      type: "session.backfill",
      sessionId: "session-1",
      cursor: "cursor-latest",
      messages: [
        {
          messageId: "assistant-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          kind: "text",
          content: "hello",
          timestamp: "2026-03-24T10:00:00.000Z",
          sequence: 1,
          rawRef: "codex://raw#line=1",
          toolCall: null
        }
      ]
    });
    await vi.advanceTimersByTimeAsync(600);

    expect(mocked.markSessionSeen).toHaveBeenCalledWith("session-1");
    expect(onSeen).toHaveBeenCalledTimes(1);
    expect(onSeen).toHaveBeenCalledWith(
      "session-1",
      "2026-03-24T10:00:00.000Z"
    );

    store.destroy();
  });

  it("does not repeat mark seen when navigation session pushes an older lastSeenAt", async () => {
    vi.useFakeTimers();
    const store = new SessionRuntimeStore("session-1", {
      initialSession: {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "raw-1",
        rawStoreRef: "codex://raw-1",
        title: "session-1",
        messageCount: 1,
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

    await store.initialize();
    emitRealtimeSubscribed();
    emitRealtimeEnvelope({
      type: "session.backfill",
      sessionId: "session-1",
      cursor: "cursor-latest",
      messages: [
        {
          messageId: "assistant-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          kind: "text",
          content: "hello",
          timestamp: "2026-03-24T10:00:00.000Z",
          sequence: 1,
          rawRef: "codex://raw#line=1",
          toolCall: null
        }
      ]
    });
    await vi.advanceTimersByTimeAsync(600);

    expect(mocked.markSessionSeen).toHaveBeenCalledTimes(1);
    expect(store.getState().session?.lastSeenAt).toBe("2026-03-24T10:00:00.000Z");

    store.applyNavigationSession({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "raw-1",
      rawStoreRef: "codex://raw-1",
      title: "session-1",
      messageCount: 1,
      lastMessageAt: "2026-03-24T10:05:00.000Z",
      createdAt: "2026-03-24T09:00:00.000Z",
      updatedAt: "2026-03-24T10:05:00.000Z",
      syncStatus: "idle",
      syncCursor: "cursor-sync",
      lastSyncAt: "2026-03-24T10:05:00.000Z",
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      runningState: "idle",
      activitySource: "none",
      lastEventAt: "2026-03-24T10:05:00.000Z",
      completedAt: null,
      lastSeenAt: null,
      activityState: "idle"
    });

    expect(store.getState().session?.lastSeenAt).toBe("2026-03-24T10:00:00.000Z");

    const client = mocked.realtimeInstances[0];
    expect(client).toBeDefined();

    (client!.options.onEnvelope as ((event: Record<string, unknown>) => void))({
      type: "session.delta",
      sessionId: "session-1",
      cursor: "cursor-after",
      messages: [
        {
          messageId: "assistant-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          kind: "text",
          content: "hello",
          timestamp: "2026-03-24T10:00:00.000Z",
          sequence: 1,
          rawRef: "codex://raw#line=1",
          toolCall: null
        }
      ]
    });

    await vi.advanceTimersByTimeAsync(600);

    expect(mocked.markSessionSeen).toHaveBeenCalledTimes(1);

    store.destroy();
  });

  it("applyNavigationSession 不会用只有 updatedAt 更新的 idle 摘要冲掉本地 running 态", () => {
    const store = new SessionRuntimeStore("session-1", {
      initialSession: {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "raw-1",
        rawStoreRef: "codex://raw-1",
        title: "session-1",
        messageCount: 1,
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
        lastEventAt: "2026-03-24T10:00:00.000Z",
        completedAt: null,
        lastSeenAt: null,
        activityState: "running"
      }
    });

    store.applyNavigationSession({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "raw-1",
      rawStoreRef: "codex://raw-1",
      title: "session-1",
      messageCount: 1,
      lastMessageAt: "2026-03-24T10:00:00.000Z",
      createdAt: "2026-03-24T09:00:00.000Z",
      updatedAt: "2026-03-24T10:05:00.000Z",
      syncStatus: "idle",
      syncCursor: "cursor-sync",
      lastSyncAt: "2026-03-24T10:05:00.000Z",
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

    expect(store.getState().session?.runningState).toBe("running");
    expect(store.getState().session?.activityState).toBe("running");

    store.destroy();
  });

  it("applyNavigationSession 不会用缺少新终态证据的 running 摘要冲掉本地 completed 态", () => {
    const store = new SessionRuntimeStore("session-1", {
      initialSession: {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "claude-code",
        providerSessionId: "claude-session-1",
        rawStoreRef: "claude://raw-1",
        title: "session-1",
        messageCount: 1,
        lastMessageAt: "2026-03-24T10:00:10.000Z",
        createdAt: "2026-03-24T09:00:00.000Z",
        updatedAt: "2026-03-24T10:00:10.000Z",
        syncStatus: "idle",
        syncCursor: "cursor-sync",
        lastSyncAt: "2026-03-24T10:00:10.000Z",
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "completed",
        activitySource: "runtime",
        lastEventAt: "2026-03-24T10:00:10.000Z",
        completedAt: "2026-03-24T10:00:10.000Z",
        lastSeenAt: null,
        activityState: "completed_unread"
      }
    });

    store.applyNavigationSession({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      rawStoreRef: "claude://raw-1",
      title: "session-1",
      messageCount: 1,
      lastMessageAt: "2026-03-24T10:00:10.000Z",
      createdAt: "2026-03-24T09:00:00.000Z",
      updatedAt: "2026-03-24T10:10:00.000Z",
      syncStatus: "idle",
      syncCursor: "cursor-sync",
      lastSyncAt: "2026-03-24T10:10:00.000Z",
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      runningState: "running",
      activitySource: "runtime",
      lastEventAt: "2026-03-24T10:00:00.000Z",
      completedAt: null,
      lastSeenAt: null,
      activityState: "running"
    });

    expect(store.getState().session?.runningState).toBe("completed");
    expect(store.getState().session?.activityState).toBe("completed_unread");

    store.destroy();
  });

  it("throttles mark seen requests while new assistant messages keep streaming in", async () => {
    vi.useFakeTimers();
    const store = new SessionRuntimeStore("session-1");

    await store.initialize();
    emitRealtimeSubscribed();
    emitRealtimeEnvelope({
      type: "session.backfill",
      sessionId: "session-1",
      cursor: "cursor-latest",
      messages: [
        {
          messageId: "assistant-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          kind: "text",
          content: "hello",
          timestamp: "2026-03-24T10:00:00.000Z",
          sequence: 1,
          rawRef: "codex://raw#line=1",
          toolCall: null
        }
      ]
    });
    await vi.advanceTimersByTimeAsync(600);

    expect(mocked.markSessionSeen).toHaveBeenCalledTimes(1);

    const client = mocked.realtimeInstances[0];
    expect(client).toBeDefined();

    (client!.options.onEnvelope as ((event: Record<string, unknown>) => void))({
      type: "session.delta",
      sessionId: "session-1",
      cursor: "cursor-after",
      messages: [
        {
          messageId: "assistant-2",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          kind: "text",
          content: "world",
          timestamp: "2026-03-24T10:00:02.000Z",
          sequence: 2,
          rawRef: "codex://raw#line=2",
          toolCall: null
        }
      ]
    });

    await vi.advanceTimersByTimeAsync(600);
    expect(mocked.markSessionSeen).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4_400);
    expect(mocked.markSessionSeen).toHaveBeenCalledTimes(2);

    store.destroy();
  });

  it("收到权限申请事件时会把请求写入前端状态", async () => {
    const store = new SessionRuntimeStore("session-1");
    await store.initialize();
    emitRealtimeSubscribed();

    const client = getRealtimeClient();
    (client.options.onPermissionRequest as ((payload: Record<string, unknown>) => void))({
      type: "session.permission_request",
      sessionId: "session-1",
      request: {
        id: "permission-1",
        sessionId: "session-1",
        provider: "claude-code",
        providerSessionId: "claude-session-1",
        requestKey: "toolu-1",
        kind: "command",
        status: "pending",
        title: "Claude 请求执行命令",
        summary: "rm -rf /tmp/build",
        detail: "{\"command\":\"rm -rf /tmp/build\"}",
        reason: null,
        toolName: "Bash",
        command: "rm -rf /tmp/build",
        cwd: "/tmp/workspace",
        paths: [],
        permissionProfile: null,
        questions: [],
        actions: [
          { value: "allow", label: "允许", tone: "primary", description: null },
          { value: "deny", label: "拒绝", tone: "danger", description: null }
        ],
        rawPayload: "{\"tool_name\":\"Bash\"}",
        createdAt: "2026-03-30T10:00:00.000Z",
        updatedAt: "2026-03-30T10:00:00.000Z",
        resolvedAt: null
      }
    });

    expect(store.getState().permissionRequests).toHaveLength(1);
    expect(store.getState().permissionRequests[0]?.title).toBe("Claude 请求执行命令");

    store.destroy();
  });

  it("收到 session.activity 后会按统一裁决更新活动状态", async () => {
    const store = new SessionRuntimeStore("session-1");
    await store.initialize();
    emitRealtimeSubscribed();

    emitRealtimeActivity({
      type: "session.activity",
      sessionId: "session-1",
      runningState: "stale",
      activityResolutionSource: "authoritative_runtime",
      activityConfidence: "strong",
      runId: "runtime:session-1:2026-03-24T10:00:00.000Z",
      detail: "Host 仍持有这轮运行，但长时间没有收到新事件，状态待确认",
      errorCode: null,
      errorDetail: null,
      hasActiveRun: true,
      canInterrupt: true,
      updatedAt: "2026-03-24T10:00:30.000Z",
      watchdogTriggeredAt: "2026-03-24T10:00:30.000Z"
    });

    expect(store.getState().session).toMatchObject({
      runningState: "stale",
      activitySource: "runtime",
      activityResolutionSource: "authoritative_runtime",
      activityConfidence: "strong",
      runId: "runtime:session-1:2026-03-24T10:00:00.000Z",
      watchdogTriggeredAt: "2026-03-24T10:00:30.000Z",
      activityState: "running"
    });
    expect(store.getState().runtimeHasActiveRun).toBe(true);
    expect(store.getState().runtimeCanInterrupt).toBe(true);

    store.destroy();
  });

  it("replyPermissionRequest 会调用接口并回写最新审批状态", async () => {
    const store = new SessionRuntimeStore("session-1");
    await store.initialize();
    emitRealtimeSubscribed();

    const client = getRealtimeClient();
    (client.options.onPermissionRequest as ((payload: Record<string, unknown>) => void))({
      type: "session.permission_request",
      sessionId: "session-1",
      request: {
        id: "permission-2",
        sessionId: "session-1",
        provider: "opencode",
        providerSessionId: "ses-1",
        requestKey: "perm-2",
        kind: "permissions",
        status: "pending",
        title: "OpenCode 请求权限",
        summary: "请求扩大文件或网络权限",
        detail: null,
        reason: null,
        toolName: null,
        command: null,
        cwd: null,
        paths: [],
        permissionProfile: {
          readPaths: [],
          writePaths: ["C:/Code/CodingNS/apps/user-app"],
          networkEnabled: true
        },
        questions: [],
        actions: [
          { value: "once", label: "允许一次", tone: "primary", description: null },
          { value: "always", label: "总是允许", tone: "neutral", description: null },
          { value: "reject", label: "拒绝", tone: "danger", description: null }
        ],
        rawPayload: null,
        createdAt: "2026-03-30T10:00:00.000Z",
        updatedAt: "2026-03-30T10:00:00.000Z",
        resolvedAt: null
      }
    });
    mocked.replySessionPermissionRequest.mockResolvedValueOnce({
      ...store.getState().permissionRequests[0],
      status: "approved",
      resolvedAt: "2026-03-30T10:00:05.000Z",
      updatedAt: "2026-03-30T10:00:05.000Z"
    });

    await store.replyPermissionRequest("permission-2", { action: "once" });

    expect(mocked.replySessionPermissionRequest).toHaveBeenCalledWith("session-1", "permission-2", {
      action: "once"
    });
    expect(store.getState().permissionRequests[0]?.status).toBe("approved");

    store.destroy();
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
