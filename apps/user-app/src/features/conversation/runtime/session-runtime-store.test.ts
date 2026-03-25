import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore } from "../../auth/store/auth-store";
import { clearViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { SessionRuntimeStore } from "./session-runtime-store";

const SESSION_RUNTIME_SNAPSHOT_KEY = "session-runtime.snapshot.session-1";

const mocked = vi.hoisted(() => {
  const getSessionDetail = vi.fn();
  const getSessionCapabilities = vi.fn();
  const getSessionMessages = vi.fn();
  const getSessionRuntime = vi.fn();
  const markSessionSeen = vi.fn();
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
    getSessionRuntime,
    markSessionSeen,
    sendSessionMessage,
    realtimeInstances,
    MockRealtimeClient
  };
});

vi.mock("../api/conversation-api", () => ({
  getSessionDetail: mocked.getSessionDetail,
  getSessionCapabilities: mocked.getSessionCapabilities,
  getSessionMessages: mocked.getSessionMessages,
  getSessionRuntime: mocked.getSessionRuntime,
  markSessionSeen: mocked.markSessionSeen,
  sendSessionMessage: mocked.sendSessionMessage
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
      provider: "codex",
      providerSessionId: "raw-1",
      detail: null,
      updatedAt: "2026-03-24T10:00:00.000Z"
    });
    mocked.markSessionSeen.mockResolvedValue(undefined);
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
        supportsSubagents: false,
        supportsInterrupt: true,
        supportsStructuredToolCalls: true,
        supportsTokenUsage: false,
        supportsAttachments: false,
        supportsPermissionPrompt: true,
        supportsCheckpoint: false,
        limitations: []
      },
      messages: []
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
      provider: "codex",
      providerSessionId: "raw-1",
      detail: null,
      updatedAt: "2026-03-24T10:00:00.000Z"
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

  it("refreshes runtime state after the last envelope to avoid stale running state", async () => {
    vi.useFakeTimers();
    const store = new SessionRuntimeStore("session-1");

    mocked.getSessionRuntime
      .mockResolvedValueOnce({
        sessionId: "session-1",
        runningState: "running",
        hasActiveRun: true,
        canAttach: true,
        canInterrupt: true,
        provider: "codex",
        providerSessionId: "raw-1",
        detail: null,
        updatedAt: "2026-03-24T10:00:00.000Z"
      })
      .mockResolvedValueOnce({
        sessionId: "session-1",
        runningState: "completed",
        hasActiveRun: false,
        canAttach: false,
        canInterrupt: false,
        provider: "codex",
        providerSessionId: "raw-1",
        detail: null,
        updatedAt: "2026-03-24T10:00:03.000Z"
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

    await vi.advanceTimersByTimeAsync(1200);

    expect(mocked.getSessionRuntime).toHaveBeenCalledTimes(2);
    expect(store.getState().session?.runningState).toBe("completed");

    await vi.advanceTimersByTimeAsync(3600);

    expect(mocked.getSessionRuntime).toHaveBeenCalledTimes(2);

    store.destroy();
  });

  it("falls back to polling runtime only while realtime is disconnected", async () => {
    vi.useFakeTimers();
    const store = new SessionRuntimeStore("session-1");

    mocked.getSessionRuntime.mockResolvedValue({
      sessionId: "session-1",
      runningState: "running",
      hasActiveRun: true,
      canAttach: true,
      canInterrupt: true,
      provider: "codex",
      providerSessionId: "raw-1",
      detail: null,
      updatedAt: "2026-03-24T10:00:00.000Z"
    });
    mocked.getSessionMessages.mockResolvedValue({
      messages: [],
      cursor: "cursor-latest",
      nextCursor: null,
      total: 0
    });

    await store.initialize();

    const client = mocked.realtimeInstances[0];
    expect(client).toBeDefined();

    (client!.options.onConnectionChange as ((state: string) => void))("reconnecting");

    await vi.advanceTimersByTimeAsync(1200);
    expect(mocked.getSessionRuntime).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1200);
    expect(mocked.getSessionRuntime).toHaveBeenCalledTimes(3);

    (client!.options.onConnectionChange as ((state: string) => void))("connected");

    await vi.advanceTimersByTimeAsync(1200);
    expect(mocked.getSessionRuntime).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(2400);
    expect(mocked.getSessionRuntime).toHaveBeenCalledTimes(4);

    store.destroy();
  });

  it("marks navigation as seen after markSessionSeen succeeds", async () => {
    vi.useFakeTimers();
    const onSeen = vi.fn();
    const store = new SessionRuntimeStore("session-1", {
      onSeen
    });

    mocked.getSessionMessages.mockResolvedValueOnce({
      messages: [],
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
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    );

    store.destroy();
  });
});
