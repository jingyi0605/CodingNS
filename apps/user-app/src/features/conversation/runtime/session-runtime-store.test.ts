import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore } from "../../auth/store/auth-store";
import { SessionRuntimeStore } from "./session-runtime-store";

const mocked = vi.hoisted(() => {
  const getSessionDetail = vi.fn();
  const getSessionCapabilities = vi.fn();
  const getSessionMessages = vi.fn();
  const markSessionSeen = vi.fn();
  const sendSessionMessage = vi.fn();
  const realtimeInstances: Array<{
    options: {
      sessionId: string;
      cursor: string | null;
      limit: number;
    };
  }> = [];

  class MockRealtimeClient {
    public readonly options: {
      sessionId: string;
      cursor: string | null;
      limit: number;
    };

    constructor(options: {
      sessionId: string;
      cursor: string | null;
      limit: number;
    }) {
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
    mocked.markSessionSeen.mockResolvedValue(undefined);
    mocked.sendSessionMessage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    authStore.clear();
    vi.useRealTimers();
  });

  it("首次进入会话时只加载最新 30 条，并用最新游标建立实时订阅", async () => {
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

  it("向上翻页时继续加载更早消息，但不回退实时订阅游标", async () => {
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
});
