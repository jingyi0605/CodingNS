import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../../../config/client-config-store";
import { authStore } from "../../auth/store/auth-store";
import { clearViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { SessionRuntimeStore } from "./session-runtime-store";

const SESSION_RUNTIME_SNAPSHOT_KEY = "session-runtime.snapshot.session-1";

const mocked = vi.hoisted(() => {
  const getSessionDetail = vi.fn();
  const getSessionCapabilities = vi.fn();
  const getSessionMessages = vi.fn();
  const getSessionQueue = vi.fn();
  const getSessionRuntime = vi.fn();
  const markSessionSeen = vi.fn();
  const enqueueSessionMessage = vi.fn();
  const deleteSessionQueueItem = vi.fn();
  const sendLiveMessage = vi.fn();
  const sendSessionMessage = vi.fn();
  const realtimeInstances: Array<{
    options: Record<string, unknown>;
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
  }

  return {
    getSessionDetail,
    getSessionCapabilities,
    getSessionMessages,
    getSessionQueue,
    getSessionRuntime,
    markSessionSeen,
    enqueueSessionMessage,
    deleteSessionQueueItem,
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
  getSessionQueue: mocked.getSessionQueue,
  getSessionRuntime: mocked.getSessionRuntime,
  sendLiveMessage: mocked.sendLiveMessage,
  markSessionSeen: mocked.markSessionSeen,
  sendSessionMessage: mocked.sendSessionMessage,
  enqueueSessionMessage: mocked.enqueueSessionMessage,
  deleteSessionQueueItem: mocked.deleteSessionQueueItem
}));

vi.mock("../../../network/realtime-client", () => ({
  RealtimeClient: mocked.MockRealtimeClient
}));

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

  it("loads the latest 30 messages on initialize", async () => {
    vi.useFakeTimers();
    const store = new SessionRuntimeStore("session-1");

    mocked.getSessionMessages.mockResolvedValueOnce({
      messages: Array.from({ length: 30 }, (_, index) => ({
        messageId: `message-${index + 31}`,
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        kind: "text",
        content: `message-${index + 31}`,
        timestamp: `2026-03-24T10:${String(index).padStart(2, "0")}:00.000Z`,
        sequence: index + 31,
        rawRef: `codex://raw#line=${index + 31}`
      })),
      cursor: "cursor-latest",
      nextCursor: "cursor-older",
      total: 60
    });

    await store.initialize();

    expect(mocked.getSessionMessages).toHaveBeenCalledWith("session-1", null, 30, "backward");
    expect(store.getState().messages).toHaveLength(30);
    expect(store.getState().messages[0]?.sequence).toBe(31);
    expect(store.getState().messages.at(-1)?.sequence).toBe(60);
    expect(store.getState().hasOlderMessages).toBe(true);
    expect(store.getState().olderCursor).toBe("cursor-older");
    expect(store.getState().lastCursor).toBe("cursor-latest");
    expect(mocked.realtimeInstances[0]?.options.cursor).toBe("cursor-latest");
    expect(mocked.realtimeInstances[0]?.options.limit).toBe(40);

    store.destroy();
  });

  it("initialize 时会同步拉取当前会话的发送队列", async () => {
    vi.useFakeTimers();
    const store = new SessionRuntimeStore("session-1");

    mocked.getSessionMessages.mockResolvedValueOnce({
      messages: [],
      cursor: "cursor-latest",
      nextCursor: null,
      total: 0
    });
    mocked.getSessionQueue.mockResolvedValueOnce({
      items: [
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
      ]
    });

    await store.initialize();

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
    expect(mocked.getSessionMessages).toHaveBeenCalledTimes(1);

    store.destroy();
  });

  it("loads older messages without rewinding the realtime cursor", async () => {
    vi.useFakeTimers();
    const store = new SessionRuntimeStore("session-1");

    mocked.getSessionMessages
      .mockResolvedValueOnce({
        messages: Array.from({ length: 30 }, (_, index) => ({
          messageId: `message-${index + 31}`,
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          kind: "text",
          content: `message-${index + 31}`,
          timestamp: `2026-03-24T10:${String(index).padStart(2, "0")}:00.000Z`,
          sequence: index + 31,
          rawRef: `codex://raw#line=${index + 31}`
        })),
        cursor: "cursor-latest",
        nextCursor: "cursor-older",
        total: 60
      })
      .mockResolvedValueOnce({
        messages: Array.from({ length: 30 }, (_, index) => ({
          messageId: `message-${index + 1}`,
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          kind: "text",
          content: `message-${index + 1}`,
          timestamp: `2026-03-24T09:${String(index).padStart(2, "0")}:00.000Z`,
          sequence: index + 1,
          rawRef: `codex://raw#line=${index + 1}`
        })),
        cursor: "cursor-older",
        nextCursor: null,
        total: 60
      });

    await store.initialize();
    await store.loadOlderMessages();

    expect(mocked.getSessionMessages).toHaveBeenNthCalledWith(
      2,
      "session-1",
      "cursor-older",
      30,
      "backward"
    );
    expect(store.getState().messages).toHaveLength(60);
    expect(store.getState().messages[0]?.sequence).toBe(1);
    expect(store.getState().messages.at(-1)?.sequence).toBe(60);
    expect(store.getState().hasOlderMessages).toBe(false);
    expect(store.getState().olderCursor).toBeNull();
    expect(store.getState().lastCursor).toBe("cursor-latest");

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
  });

  it("默认完整权限开启后，sendLiveMessage 会透传 bypassPermissions", async () => {
    clientConfigStore.hydrate({
      ...clientConfigStore.getState(),
      defaultPermissionMode: "bypassPermissions"
    });
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

  it("收到终态运行事件后会刷新等待队列", async () => {
    vi.useFakeTimers();
    const store = new SessionRuntimeStore("session-1");

    mocked.getSessionMessages.mockResolvedValueOnce({
      messages: [],
      cursor: "cursor-latest",
      nextCursor: null,
      total: 0
    });
    mocked.getSessionQueue
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        items: [
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
        ]
      });

    await store.initialize();

    const client = mocked.realtimeInstances[0];
    expect(client).toBeDefined();

    await (client!.options.onRuntimeStatus as ((event: { status: "completed"; detail: string | null; timestamp: string; sessionId: string; }) => void))({
      sessionId: "session-1",
      status: "completed",
      detail: null,
      timestamp: "2026-03-24T10:00:03.000Z"
    });

    await vi.runAllTimersAsync();

    expect(mocked.getSessionQueue).toHaveBeenCalledTimes(2);
    expect(store.getState().queuedMessages[0]?.id).toBe("queue-next");
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

  it("marks navigation as seen after markSessionSeen succeeds", async () => {
    vi.useFakeTimers();
    const onSeen = vi.fn();
    const store = new SessionRuntimeStore("session-1", {
      onSeen
    });

    mocked.getSessionMessages.mockResolvedValueOnce({
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
          rawRef: "codex://raw#line=1"
        }
      ],
      cursor: "cursor-latest",
      nextCursor: null,
      total: 0
    });

    await store.initialize();
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

    mocked.getSessionMessages.mockResolvedValueOnce({
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
          rawRef: "codex://raw#line=1"
        }
      ],
      cursor: "cursor-latest",
      nextCursor: null,
      total: 0
    });

    await store.initialize();
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

  it("throttles mark seen requests while new assistant messages keep streaming in", async () => {
    vi.useFakeTimers();
    const store = new SessionRuntimeStore("session-1");

    mocked.getSessionMessages.mockResolvedValueOnce({
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
          rawRef: "codex://raw#line=1"
        }
      ],
      cursor: "cursor-latest",
      nextCursor: null,
      total: 0
    });

    await store.initialize();
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
});
