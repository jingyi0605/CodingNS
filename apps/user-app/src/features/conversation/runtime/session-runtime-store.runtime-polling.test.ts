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



describe("SessionRuntimeStore runtime polling", () => {
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

  it("收到终态 runtime status 后会清掉残留的 runtime 工具尾钉", async () => {
    const store = new SessionRuntimeStore("session-1");
    await store.initialize();
    emitRealtimeSubscribed();

    emitRealtimeEnvelope({
      type: "session.backfill",
      sessionId: "session-1",
      cursor: "cursor-after",
      olderCursor: null,
      messages: [
        {
          messageId: "assistant-latest-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          kind: "text",
          content: "后面的正式回复",
          timestamp: "2026-05-08T11:09:58.000Z",
          sequence: 20,
          rawRef: "codex://raw#line=20",
          toolCall: null
        }
      ]
    });

    emitRealtimeRuntimeMessage({
      type: "session.runtime_message",
      sessionId: "session-1",
      source: "runtime",
      message: {
        messageId: "runtime-tool-tail-1",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "tool",
        kind: "tool_result",
        content: "/Users/jackson/Code/CodingNS",
        timestamp: "2026-05-08T11:09:59.000Z",
        sequence: 10,
        rawRef: "codex://raw#line=10",
        toolCall: {
          callId: "call-tail-1",
          name: "command_execution",
          input: "{\"cmd\":\"pwd\"}",
          output: "/Users/jackson/Code/CodingNS",
          error: null,
          status: "completed"
        }
      }
    });

    expect(store.getState().messages.map((message) => message.id)).toEqual([
      "assistant-latest-1",
      "runtime-tool-tail-1"
    ]);

    const client = getRealtimeClient();
    (client.options.onRuntimeStatus as ((event: Record<string, unknown>) => void))({
      type: "session.runtime_status",
      sessionId: "session-1",
      status: "completed",
      detail: "run completed",
      timestamp: "2026-05-08T11:10:05.000Z"
    });

    expect(store.getState().messages.map((message) => message.id)).toEqual([
      "runtime-tool-tail-1",
      "assistant-latest-1"
    ]);

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
