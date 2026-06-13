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
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("单入口 reducer 在 older history 合并时不会回卷尾部消息", () => {
    const seeded = applyTimelineEventToLayers(createTimelineLayersState(), "session-1", {
      type: "history.merge",
      source: "realtime_backfill",
      replaceSnapshotSeed: false,
      messages: [
        createHistoryMessage({
          messageId: "assistant-tail-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          content: "最新回复",
          timestamp: "2026-05-05T14:34:04.730Z",
          sequence: 120,
          rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=220"
        }),
        createHistoryMessage({
          messageId: "user-tail-2",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "user",
          content: "下一轮用户消息",
          timestamp: "2026-05-05T14:40:06.019Z",
          sequence: 121,
          rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=225"
        })
      ]
    });

    const older = applyTimelineEventToLayers(seeded.timeline, "session-1", {
      type: "history.merge",
      source: "older_history_realtime",
      replaceSnapshotSeed: false,
      messages: [
        createHistoryMessage({
          messageId: "assistant-old-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          content: "更早的回复",
          timestamp: "2026-05-05T14:30:00.000Z",
          sequence: 118,
          rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=210"
        })
      ]
    });

    expect(older.validationIssues).toEqual([]);
    expect(older.messages.at(-1)?.id).toBe("user-tail-2");
    expect(older.timeline.authoritativeMessages.at(-1)?.id).toBe("user-tail-2");
  });

  it("单入口 reducer 在 runtime 消息到达时不会改写权威层锚点", () => {
    const seeded = applyTimelineEventToLayers(createTimelineLayersState(), "session-1", {
      type: "history.merge",
      source: "realtime_backfill",
      replaceSnapshotSeed: false,
      messages: [
        createHistoryMessage({
          messageId: "assistant-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          content: "最终正文",
          timestamp: "2026-05-05T14:34:04.730Z",
          sequence: 120,
          rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=220"
        })
      ]
    });

    const runtime = applyTimelineEventToLayers(seeded.timeline, "session-1", {
      type: "runtime.message",
      source: "session.runtime_message",
      message: {
        ...seeded.timeline.authoritativeMessages[0],
        sequence: 104,
        timestamp: "2026-05-05T14:34:03.000Z",
        rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=999"
      }
    });

    expect(runtime.validationIssues).toEqual([]);
    expect(runtime.timeline.authoritativeMessages[0]?.sequence).toBe(120);
    expect(runtime.timeline.authoritativeMessages[0]?.rawRef).toBe(
      "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=220"
    );
  });

  it("单入口 reducer 会把活跃的 runtime assistant 流式消息强制钉在时间线尾部", () => {
    const seeded = applyTimelineEventToLayers(createTimelineLayersState(), "session-1", {
      type: "history.merge",
      source: "realtime_backfill",
      replaceSnapshotSeed: false,
      messages: [
        createHistoryMessage({
          messageId: "assistant-prev-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          content: "上一轮回复",
          timestamp: "2026-05-05T14:34:04.730Z",
          sequence: 120,
          rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=220"
        }),
        createHistoryMessage({
          messageId: "user-latest-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "user",
          content: "继续回答",
          timestamp: "2026-05-05T14:40:06.019Z",
          sequence: 121,
          rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=225"
        })
      ]
    });

    const runtime = applyTimelineEventToLayers(seeded.timeline, "session-1", {
      type: "runtime.message",
      source: "session.runtime_message",
      message: {
        ...seeded.timeline.authoritativeMessages[0],
        id: "assistant-stream-1",
        content: "这是当前正在流式输出的回复",
        timestamp: "2026-05-05T14:40:05.000Z",
        sequence: 104,
        rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=224"
      }
    });

    expect(runtime.validationIssues).toEqual([]);
    expect(runtime.timeline.runtimeOverlayMessages).toHaveLength(1);
    expect(runtime.messages.map((item) => item.id)).toEqual([
      "assistant-prev-1",
      "user-latest-1",
      "assistant-stream-1"
    ]);
    expect(runtime.messages.at(-1)?.content).toBe("这是当前正在流式输出的回复");
  });

  it("单入口 reducer 也会把活跃的 runtime 工具调用记录钉在时间线尾部", () => {
    const seeded = applyTimelineEventToLayers(createTimelineLayersState(), "session-1", {
      type: "history.merge",
      source: "realtime_backfill",
      replaceSnapshotSeed: false,
      messages: [
        createHistoryMessage({
          messageId: "assistant-prev-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          content: "上一轮回复",
          timestamp: "2026-05-05T14:34:04.730Z",
          sequence: 120,
          rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=220"
        }),
        createHistoryMessage({
          messageId: "user-latest-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "user",
          content: "继续回答",
          timestamp: "2026-05-05T14:40:06.019Z",
          sequence: 121,
          rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=225"
        })
      ]
    });

    const runtime = applyTimelineEventToLayers(seeded.timeline, "session-1", {
      type: "runtime.message",
      source: "session.runtime_message",
      message: {
        id: "tool-runtime-1",
        sessionId: "session-1",
        role: "tool",
        kind: "tool_call",
        content: "{\"command\":\"pwd\"}",
        toolCall: {
          callId: "tool-runtime-1",
          name: "shell",
          input: "{\"command\":\"pwd\"}",
          output: null,
          error: null,
          status: "running"
        },
        attachments: [],
        attachmentPayloads: null,
        origin: null,
        originRef: null,
        timestamp: "2026-05-05T14:40:05.000Z",
        sequence: 104,
        rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=224",
        deliveryState: "sent",
        clientRequestId: null
      }
    });

    expect(runtime.validationIssues).toEqual([]);
    expect(runtime.timeline.runtimeOverlayMessages).toHaveLength(1);
    expect(runtime.messages.map((item) => item.id)).toEqual([
      "assistant-prev-1",
      "user-latest-1",
      "tool-runtime-1"
    ]);
    expect(runtime.messages.at(-1)?.role).toBe("tool");
    expect(runtime.messages.at(-1)?.kind).toBe("tool_call");
  });

  it("权威历史追上后会清掉已吸收的 runtime assistant overlay，避免旧流式消息继续参与排序", () => {
    const seeded = applyTimelineEventToLayers(createTimelineLayersState(), "session-1", {
      type: "history.merge",
      source: "realtime_backfill",
      replaceSnapshotSeed: false,
      messages: [
        createHistoryMessage({
          messageId: "assistant-prev-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          content: "上一轮回复",
          timestamp: "2026-05-05T14:34:04.730Z",
          sequence: 120,
          rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=220"
        }),
        createHistoryMessage({
          messageId: "user-latest-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "user",
          content: "继续回答",
          timestamp: "2026-05-05T14:40:06.019Z",
          sequence: 121,
          rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=225"
        })
      ]
    });

    const runtime = applyTimelineEventToLayers(seeded.timeline, "session-1", {
      type: "runtime.message",
      source: "session.runtime_message",
      message: {
        ...seeded.timeline.authoritativeMessages[0],
        id: "assistant-stream-1",
        content: "这是当前正在流式输出的回复",
        timestamp: "2026-05-05T14:40:05.000Z",
        sequence: 104,
        rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=224"
      }
    });

    const authoritativeCatchUp = applyTimelineEventToLayers(runtime.timeline, "session-1", {
      type: "history.merge",
      source: "realtime_delta",
      replaceSnapshotSeed: false,
      messages: [
        createHistoryMessage({
          messageId: "assistant-stream-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          content: "这是当前正在流式输出的回复",
          timestamp: "2026-05-05T14:40:07.000Z",
          sequence: 122,
          rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=226"
        })
      ]
    });

    expect(authoritativeCatchUp.validationIssues).toEqual([]);
    expect(authoritativeCatchUp.timeline.runtimeOverlayMessages).toHaveLength(0);
    expect(authoritativeCatchUp.messages.map((item) => item.id)).toEqual([
      "assistant-prev-1",
      "user-latest-1",
      "assistant-stream-1"
    ]);
    expect(authoritativeCatchUp.messages.at(-1)?.rawRef).toBe(
      "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=226"
    );
  });

  it("单入口 reducer 在 pending resolve 后只保留权威消息", () => {
    const pending = createPendingMessage("session-1", "继续", "client-1", [], [], 61);
    const inserted = applyTimelineEventToLayers(createTimelineLayersState(), "session-1", {
      type: "pending.insert",
      source: "send_pending",
      pending
    });

    const resolved = applyTimelineEventToLayers(inserted.timeline, "session-1", {
      type: "pending.resolve",
      source: "pending_resolved",
      clientRequestId: "client-1",
      message: createHistoryMessage({
        messageId: "user-message-1",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "user",
        content: "继续",
        timestamp: "2026-03-24T10:00:02.000Z",
        sequence: 61,
        rawRef: "codex://raw#line=61"
      })
    });

    expect(resolved.validationIssues).toEqual([]);
    expect(resolved.timeline.pendingMessages).toHaveLength(0);
    expect(resolved.messages).toHaveLength(1);
    expect(resolved.messages[0]).toMatchObject({
      id: "user-message-1",
      deliveryState: "sent",
      clientRequestId: "client-1"
    });
  });

  it("单入口 reducer 不会把上一轮遗留的未吸收 runtime 工具消息继续钉在新用户消息底部", () => {
    const seeded = applyTimelineEventToLayers(createTimelineLayersState(), "session-1", {
      type: "history.merge",
      source: "realtime_backfill",
      replaceSnapshotSeed: false,
      messages: [
        createHistoryMessage({
          messageId: "assistant-prev-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          content: "上一轮回复",
          timestamp: "2026-05-05T14:34:04.730Z",
          sequence: 120,
          rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=220"
        }),
        {
          ...createHistoryMessage({
            messageId: "history-tool-call-1",
            provider: "codex",
            providerSessionId: "raw-1",
            role: "tool",
            kind: "tool_call",
            content: "{\"cmd\":\"pwd\"}",
            timestamp: "2026-05-05T14:34:05.000Z",
            sequence: 121,
            rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=240"
          }),
          toolCall: {
            callId: "call-shell-old-1",
            name: "command_execution",
            input: "{\"cmd\":\"pwd\"}",
            output: null,
            error: null,
            status: "running"
          }
        }
      ]
    });

    const runtime = applyTimelineEventToLayers(seeded.timeline, "session-1", {
      type: "runtime.message",
      source: "session.runtime_message",
      message: {
        id: "history-tool-call-1",
        sessionId: "session-1",
        role: "tool",
        kind: "tool_result",
        content: "/Users/jackson/Code/CodingNS",
        toolCall: {
          callId: "call-shell-old-1",
          name: "command_execution",
          input: "{\"cmd\":\"pwd\"}",
          output: "/Users/jackson/Code/CodingNS",
          error: null,
          status: "completed"
        },
        attachments: [],
        attachmentPayloads: null,
        origin: null,
        originRef: null,
        timestamp: "2026-05-05T14:34:05.050Z",
        sequence: 121,
        rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=42",
        deliveryState: "sent",
        clientRequestId: null
      }
    });

    expect(runtime.messages.at(-1)?.id).toBe("history-tool-call-1");

    const nextUserPending = createPendingMessage(
      "session-1",
      "这是下一轮新问题",
      "client-next-user-1",
      [],
      [],
      130
    );
    const withNextUser = applyTimelineEventToLayers(runtime.timeline, "session-1", {
      type: "pending.insert",
      source: "send_pending",
      pending: nextUserPending
    });

    expect(withNextUser.validationIssues).toEqual([]);
    expect(withNextUser.messages.at(-1)?.id).toBe(nextUserPending.id);
    expect(withNextUser.messages.map((item) => item.id)).toEqual([
      "assistant-prev-1",
      "history-tool-call-1",
      nextUserPending.id
    ]);
  });

  it("单入口 reducer 在 history.merge 引入新的用户消息后，会清空旧 runtime 尾钉", () => {
    const seeded = applyTimelineEventToLayers(createTimelineLayersState(), "session-1", {
      type: "history.merge",
      source: "realtime_backfill",
      replaceSnapshotSeed: false,
      messages: [
        createHistoryMessage({
          messageId: "assistant-prev-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          content: "上一轮回复",
          timestamp: "2026-05-05T14:34:04.730Z",
          sequence: 120,
          rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=220"
        }),
        {
          ...createHistoryMessage({
            messageId: "history-tool-call-2",
            provider: "codex",
            providerSessionId: "raw-1",
            role: "tool",
            kind: "tool_call",
            content: "{\"cmd\":\"ls\"}",
            timestamp: "2026-05-05T14:34:05.000Z",
            sequence: 121,
            rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=241"
          }),
          toolCall: {
            callId: "call-shell-old-2",
            name: "command_execution",
            input: "{\"cmd\":\"ls\"}",
            output: null,
            error: null,
            status: "running"
          }
        }
      ]
    });

    const runtime = applyTimelineEventToLayers(seeded.timeline, "session-1", {
      type: "runtime.message",
      source: "session.runtime_message",
      message: {
        id: "history-tool-call-2",
        sessionId: "session-1",
        role: "tool",
        kind: "tool_result",
        content: "README.md",
        toolCall: {
          callId: "call-shell-old-2",
          name: "command_execution",
          input: "{\"cmd\":\"ls\"}",
          output: "README.md",
          error: null,
          status: "completed"
        },
        attachments: [],
        attachmentPayloads: null,
        origin: null,
        originRef: null,
        timestamp: "2026-05-05T14:34:05.050Z",
        sequence: 121,
        rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=44",
        deliveryState: "sent",
        clientRequestId: null
      }
    });

    expect(runtime.messages.at(-1)?.id).toBe("history-tool-call-2");

    const mergedNewUser = applyTimelineEventToLayers(runtime.timeline, "session-1", {
      type: "history.merge",
      source: "realtime_backfill",
      replaceSnapshotSeed: false,
      messages: [
        createHistoryMessage({
          messageId: "user-next-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "user",
          content: "这是后续新问题",
          timestamp: "2026-05-05T14:40:06.019Z",
          sequence: 130,
          rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=260"
        })
      ]
    });

    expect(mergedNewUser.validationIssues).toEqual([]);
    expect(mergedNewUser.messages.at(-1)?.id).toBe("user-next-1");
    expect(mergedNewUser.messages.map((item) => item.id)).toEqual([
      "assistant-prev-1",
      "history-tool-call-2",
      "user-next-1"
    ]);
  });

  it("旧 tool runtime replay 不会在已有更新 assistant 后重新贴到底部", () => {
    const seeded = applyTimelineEventToLayers(createTimelineLayersState(), "session-1", {
      type: "history.merge",
      source: "realtime_backfill",
      replaceSnapshotSeed: false,
      messages: [
        createHistoryMessage({
          messageId: "assistant-prev-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          content: "上一轮回复",
          timestamp: "2026-05-08T02:39:10.000Z",
          sequence: 31,
          rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=31"
        }),
        {
          ...createHistoryMessage({
            messageId: "tool-legacy-1",
            provider: "codex",
            providerSessionId: "raw-1",
            role: "tool",
            kind: "tool_call",
            content: "{\"cmd\":\"pwd\"}",
            timestamp: "2026-05-08T02:39:12.780Z",
            sequence: 34,
            rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=82"
          }),
          toolCall: {
            callId: "call-shell-legacy-1",
            name: "command_execution",
            input: "{\"cmd\":\"pwd\"}",
            output: null,
            error: null,
            status: "running"
          }
        },
        createHistoryMessage({
          messageId: "assistant-latest-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          content: "这是当前最新的回复",
          timestamp: "2026-05-08T02:39:40.000Z",
          sequence: 50,
          rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=120"
        })
      ]
    });

    const runtime = applyTimelineEventToLayers(seeded.timeline, "session-1", {
      type: "runtime.message",
      source: "session.runtime_message",
      message: {
        id: "tool-legacy-1",
        sessionId: "session-1",
        role: "tool",
        kind: "tool_result",
        content: "/Users/jackson/Code/CodingNS",
        toolCall: {
          callId: "call-shell-legacy-1",
          name: "command_execution",
          input: "{\"cmd\":\"pwd\"}",
          output: "/Users/jackson/Code/CodingNS",
          error: null,
          status: "completed"
        },
        attachments: [],
        attachmentPayloads: null,
        origin: null,
        originRef: null,
        timestamp: "2026-05-08T02:39:34.236Z",
        sequence: 42,
        rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=42",
        deliveryState: "sent",
        clientRequestId: null
      }
    });

    expect(runtime.validationIssues).toEqual([]);
    expect(runtime.timeline.runtimeOverlayMessages).toHaveLength(0);
    expect(runtime.timeline.activeRuntimeOverlayKeys).toEqual([]);
    expect(runtime.messages.at(-1)?.id).toBe("assistant-latest-1");
    expect(runtime.messages.map((item) => item.id)).toEqual([
      "assistant-prev-1",
      "tool-legacy-1",
      "assistant-latest-1"
    ]);
  });

  it("已激活的旧 runtime tail 在更晚 authoritative 消息到达后会自动退场", () => {
    const runtimeFirst = applyTimelineEventToLayers(createTimelineLayersState(), "session-1", {
      type: "runtime.message",
      source: "session.runtime_message",
      message: {
        id: "tool-runtime-1",
        sessionId: "session-1",
        role: "tool",
        kind: "tool_result",
        content: "/Users/jackson/Code/CodingNS",
        toolCall: {
          callId: "call-shell-1",
          name: "command_execution",
          input: "{\"cmd\":\"pwd\"}",
          output: "/Users/jackson/Code/CodingNS",
          error: null,
          status: "completed"
        },
        attachments: [],
        attachmentPayloads: null,
        origin: null,
        originRef: null,
        timestamp: "2026-05-08T02:39:34.236Z",
        sequence: 42,
        rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=42",
        deliveryState: "sent",
        clientRequestId: null
      }
    });

    expect(runtimeFirst.timeline.activeRuntimeOverlayKeys).toHaveLength(1);
    expect(runtimeFirst.messages.at(-1)?.id).toBe("tool-runtime-1");

    const historyMerged = applyTimelineEventToLayers(runtimeFirst.timeline, "session-1", {
      type: "history.merge",
      source: "realtime_delta",
      replaceSnapshotSeed: false,
      messages: [
        {
          ...createHistoryMessage({
            messageId: "tool-authoritative-1",
            provider: "codex",
            providerSessionId: "raw-1",
            role: "tool",
            kind: "tool_call",
            content: "{\"cmd\":\"pwd\"}",
            timestamp: "2026-05-08T02:39:34.197Z",
            sequence: 41,
            rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=41"
          }),
          toolCall: {
            callId: "call-shell-1",
            name: "command_execution",
            input: "{\"cmd\":\"pwd\"}",
            output: null,
            error: null,
            status: "running"
          }
        },
        createHistoryMessage({
          messageId: "assistant-latest-2",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          content: "这是更新后的最新回复",
          timestamp: "2026-05-08T02:39:40.000Z",
          sequence: 50,
          rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=120"
        })
      ]
    });

    expect(historyMerged.validationIssues).toEqual([]);
    expect(historyMerged.timeline.activeRuntimeOverlayKeys).toEqual([]);
    expect(historyMerged.messages.at(-1)?.id).toBe("assistant-latest-2");
    expect(historyMerged.messages.map((item) => item.id)).toEqual([
      "tool-authoritative-1",
      "assistant-latest-2"
    ]);
  });

  it("assistant 流式消息即使 rawRef 更旧，只要时间更新也会继续贴底", () => {
    const seeded = applyTimelineEventToLayers(createTimelineLayersState(), "session-1", {
      type: "history.merge",
      source: "realtime_backfill",
      replaceSnapshotSeed: false,
      messages: [
        createHistoryMessage({
          messageId: "user-latest-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "user",
          content: "请继续",
          timestamp: "2026-05-08T02:39:40.000Z",
          sequence: 90,
          rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=90"
        })
      ]
    });

    const runtime = applyTimelineEventToLayers(seeded.timeline, "session-1", {
      type: "runtime.message",
      source: "session.runtime_message",
      message: {
        id: "assistant-runtime-1",
        sessionId: "session-1",
        role: "assistant",
        kind: "text",
        content: "这是正在流式输出的最新文本",
        toolCall: null,
        attachments: [],
        attachmentPayloads: null,
        origin: null,
        originRef: null,
        timestamp: "2026-05-08T02:39:41.000Z",
        sequence: 42,
        rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=42",
        deliveryState: "sent",
        clientRequestId: null
      }
    });

    expect(runtime.validationIssues).toEqual([]);
    expect(runtime.timeline.runtimeOverlayMessages).toHaveLength(1);
    expect(runtime.timeline.activeRuntimeOverlayKeys).toHaveLength(1);
    expect(runtime.messages.at(-1)?.id).toBe("assistant-runtime-1");
    expect(runtime.messages.map((item) => item.id)).toEqual([
      "user-latest-1",
      "assistant-runtime-1"
    ]);
  });

  it("Codex runtime assistant 从 synthetic rawRef 切到真实 transcript 后不会把最终回复渲染两遍", () => {
    const runtimeFirst = applyTimelineEventToLayers(createTimelineLayersState(), "session-1", {
      type: "runtime.message",
      source: "session.runtime_message",
      message: {
        id: "assistant-runtime-synthetic-1",
        sessionId: "session-1",
        role: "assistant",
        kind: "text",
        content: "这是最终回复",
        toolCall: null,
        attachments: [],
        attachmentPayloads: null,
        origin: null,
        originRef: null,
        timestamp: "2026-05-08T02:39:41.000Z",
        sequence: 52,
        rawRef: "codex:///tmp/codingns-runtime/codex-session-1.jsonl#line=52",
        deliveryState: "sent",
        clientRequestId: null
      }
    });

    expect(runtimeFirst.timeline.runtimeOverlayMessages).toHaveLength(1);
    expect(runtimeFirst.messages.map((item) => item.id)).toEqual([
      "assistant-runtime-synthetic-1"
    ]);

    const historyMerged = applyTimelineEventToLayers(runtimeFirst.timeline, "session-1", {
      type: "history.merge",
      source: "realtime_delta",
      replaceSnapshotSeed: false,
      messages: [
        createHistoryMessage({
          messageId: "assistant-history-real-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          content: "这是最终回复",
          timestamp: "2026-05-08T02:39:42.000Z",
          sequence: 53,
          rawRef: "codex:///Users/jackson/.codex/sessions/demo.jsonl#line=120"
        })
      ]
    });

    expect(historyMerged.validationIssues).toEqual([]);
    expect(historyMerged.timeline.activeRuntimeOverlayKeys).toEqual([]);
    expect(historyMerged.messages.map((item) => item.id)).toEqual([
      "assistant-history-real-1"
    ]);
  });

  it("单入口 reducer 会抑制带图片用户消息的 runtime echo 重复", () => {
    const imageAttachment = createImageAttachment("screen.png", 2048);
    const pending = createPendingMessage(
      "session-1",
      "请看这张图",
      "client-image-1",
      [imageAttachment],
      [],
      61
    );
    const inserted = applyTimelineEventToLayers(createTimelineLayersState(), "session-1", {
      type: "pending.insert",
      source: "send_pending",
      pending
    });
    const resolved = applyTimelineEventToLayers(inserted.timeline, "session-1", {
      type: "pending.resolve",
      source: "pending_resolved",
      clientRequestId: "client-image-1",
      message: createHistoryMessage({
        messageId: "user-image-1",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "user",
        content: "请看这张图",
        timestamp: "2026-03-24T10:00:02.000Z",
        sequence: 61,
        rawRef: "codex://raw#line=61",
        attachments: [imageAttachment]
      })
    });

    const runtimeEcho = applyTimelineEventToLayers(resolved.timeline, "session-1", {
      type: "runtime.message",
      source: "session.runtime_message",
      message: {
        ...resolved.messages[0],
        id: "runtime-user-image-echo",
        rawRef: "codex://raw#line=999",
        clientRequestId: null
      }
    });

    expect(runtimeEcho.validationIssues).toEqual([]);
    expect(runtimeEcho.timeline.runtimeOverlayMessages).toHaveLength(0);
    expect(runtimeEcho.messages).toHaveLength(1);
    expect(runtimeEcho.messages[0]).toMatchObject({
      id: "user-image-1",
      content: "请看这张图"
    });
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

    expect(mocked.getSessionMessages).toHaveBeenCalledWith(
      "session-1",
      "cursor-older",
      80,
      "backward"
    );
    expect(store.getState().messages).toHaveLength(30);
    expect(store.getState().messages[0]?.sequence).toBe(31);
    expect(store.getState().messages.at(-1)?.sequence).toBe(60);
    expect(store.getState().hasOlderMessages).toBe(true);
    expect(store.getState().olderCursor).toBe("cursor-older");
    expect(store.getState().lastCursor).toBe("cursor-latest");
    expect(mocked.realtimeInstances[0]?.options.cursor).toBeNull();
    expect(mocked.realtimeInstances[0]?.options.limit).toBe(60);

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

    expect(mocked.getSessionMessages).toHaveBeenNthCalledWith(
      1,
      "session-1",
      null,
      60,
      "backward"
    );
    expect(mocked.getSessionMessages).toHaveBeenNthCalledWith(
      2,
      "session-1",
      "cursor-older",
      80,
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

  it("快照里被错误拖到底部的旧 assistant 消息会在 backfill 后恢复正确顺序", async () => {
    writeViewSnapshot(SESSION_RUNTIME_SNAPSHOT_KEY, {
      session: null,
      capabilities: null,
      runtimeHasActiveRun: null,
      runtimeCanInterrupt: null,
      contextUsage: null,
      messages: [
        {
          id: "assistant-1",
          sessionId: "session-1",
          role: "assistant" as const,
          kind: "text" as const,
          content: "第一轮回复\n补全后的正文",
          toolCall: null,
          attachments: [],
          attachmentPayloads: null,
          timestamp: "2026-03-24T10:09:00.000Z",
          sequence: 9,
          rawRef: "claude://raw#line=2",
          deliveryState: "sent" as const,
          clientRequestId: null
        },
        {
          id: "user-2",
          sessionId: "session-1",
          role: "user" as const,
          kind: "text" as const,
          content: "继续",
          toolCall: null,
          attachments: [],
          attachmentPayloads: null,
          timestamp: "2026-03-24T10:03:00.000Z",
          sequence: 3,
          rawRef: "claude://raw#line=3",
          deliveryState: "sent" as const,
          clientRequestId: null
        },
        {
          id: "assistant-2",
          sessionId: "session-1",
          role: "assistant" as const,
          kind: "text" as const,
          content: "第二轮回复",
          toolCall: null,
          attachments: [],
          attachmentPayloads: null,
          timestamp: "2026-03-24T10:04:00.000Z",
          sequence: 4,
          rawRef: "claude://raw#line=4",
          deliveryState: "sent" as const,
          clientRequestId: null
        }
      ],
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
      olderCursor: null,
      messages: [
        {
          messageId: "assistant-1",
          provider: "claude-code",
          providerSessionId: "claude-session-1",
          role: "assistant",
          kind: "text",
          content: "第一轮回复\n补全后的正文",
          timestamp: "2026-03-24T10:02:00.000Z",
          sequence: 2,
          rawRef: "claude://raw#line=2",
          toolCall: null,
          attachments: []
        },
        {
          messageId: "user-2",
          provider: "claude-code",
          providerSessionId: "claude-session-1",
          role: "user",
          kind: "text",
          content: "继续",
          timestamp: "2026-03-24T10:03:00.000Z",
          sequence: 3,
          rawRef: "claude://raw#line=3",
          toolCall: null,
          attachments: []
        },
        {
          messageId: "assistant-2",
          provider: "claude-code",
          providerSessionId: "claude-session-1",
          role: "assistant",
          kind: "text",
          content: "第二轮回复",
          timestamp: "2026-03-24T10:04:00.000Z",
          sequence: 4,
          rawRef: "claude://raw#line=4",
          toolCall: null,
          attachments: []
        }
      ]
    });

    expect(store.getState().messages.map((message) => message.id)).toEqual([
      "assistant-1",
      "user-2",
      "assistant-2"
    ]);
    expect(store.getState().messages[0]).toMatchObject({
      id: "assistant-1",
      timestamp: "2026-03-24T10:02:00.000Z",
      sequence: 2
    });

    store.destroy();
  });

  it("快照里同一条 thinking 因 runtime rawRef 漂移而沉底时，会在 backfill 后归位", async () => {
    writeViewSnapshot(SESSION_RUNTIME_SNAPSHOT_KEY, {
      session: null,
      capabilities: null,
      runtimeHasActiveRun: null,
      runtimeCanInterrupt: null,
      contextUsage: null,
      messages: [
        {
          id: "assistant-old-1",
          sessionId: "session-1",
          role: "assistant" as const,
          kind: "text" as const,
          content: "上一轮回复",
          toolCall: null,
          attachments: [],
          attachmentPayloads: null,
          timestamp: "2026-03-24T10:02:00.000Z",
          sequence: 2,
          rawRef: "codex://thread-1#line=2",
          deliveryState: "sent" as const,
          clientRequestId: null
        },
        {
          id: "user-latest-1",
          sessionId: "session-1",
          role: "user" as const,
          kind: "text" as const,
          content: "忽略聊天记录，再次查看你是什么模型？",
          toolCall: null,
          attachments: [],
          attachmentPayloads: null,
          timestamp: "2026-03-24T10:03:00.000Z",
          sequence: 3,
          rawRef: "codex://thread-1#line=3",
          deliveryState: "sent" as const,
          clientRequestId: null
        },
        {
          id: "assistant-latest-1",
          sessionId: "session-1",
          role: "assistant" as const,
          kind: "text" as const,
          content: "我的实际模型是 deepseek-v4-flash。",
          toolCall: null,
          attachments: [],
          attachmentPayloads: null,
          timestamp: "2026-03-24T10:05:00.000Z",
          sequence: 5,
          rawRef: "codex://thread-1#line=5",
          deliveryState: "sent" as const,
          clientRequestId: null
        },
        {
          id: "thinking-latest-1",
          sessionId: "session-1",
          role: "assistant" as const,
          kind: "thinking" as const,
          content: "The user is asking me to ignore chat history and again state what model I am.",
          toolCall: null,
          attachments: [],
          attachmentPayloads: null,
          timestamp: "2026-03-24T10:09:00.000Z",
          sequence: 9,
          rawRef: "codex://thread-1#line=9",
          deliveryState: "sent" as const,
          clientRequestId: null
        }
      ],
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
      olderCursor: null,
      messages: [
        {
          messageId: "assistant-old-1",
          provider: "codex",
          providerSessionId: "thread-1",
          role: "assistant",
          kind: "text",
          content: "上一轮回复",
          timestamp: "2026-03-24T10:02:00.000Z",
          sequence: 2,
          rawRef: "codex://thread-1#line=2",
          toolCall: null,
          attachments: []
        },
        {
          messageId: "user-latest-1",
          provider: "codex",
          providerSessionId: "thread-1",
          role: "user",
          kind: "text",
          content: "忽略聊天记录，再次查看你是什么模型？",
          timestamp: "2026-03-24T10:03:00.000Z",
          sequence: 3,
          rawRef: "codex://thread-1#line=3",
          toolCall: null,
          attachments: []
        },
        {
          messageId: "thinking-latest-1",
          provider: "codex",
          providerSessionId: "thread-1",
          role: "assistant",
          kind: "thinking",
          content: "The user is asking me to ignore chat history and again state what model I am.",
          timestamp: "2026-03-24T10:04:00.000Z",
          sequence: 4,
          rawRef: "codex://thread-1#line=4",
          toolCall: null,
          attachments: []
        },
        {
          messageId: "assistant-latest-1",
          provider: "codex",
          providerSessionId: "thread-1",
          role: "assistant",
          kind: "text",
          content: "我的实际模型是 deepseek-v4-flash。",
          timestamp: "2026-03-24T10:05:00.000Z",
          sequence: 5,
          rawRef: "codex://thread-1#line=5",
          toolCall: null,
          attachments: []
        }
      ]
    });

    expect(store.getState().messages.map((message) => message.id)).toEqual([
      "assistant-old-1",
      "user-latest-1",
      "thinking-latest-1",
      "assistant-latest-1"
    ]);
    expect(store.getState().messages[2]).toMatchObject({
      id: "thinking-latest-1",
      timestamp: "2026-03-24T10:04:00.000Z",
      sequence: 4,
      rawRef: "codex://thread-1#line=4"
    });

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

  it("opencode 缓存里已有旧模型列表时，initialize 仍会强制刷新 capabilities", async () => {
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
          },
          {
            id: "opencode/minimax-m2.5-free",
            name: "opencode/minimax-m2.5-free"
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
        modelId: "opencode/minimax-m2.5-free",
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
          id: "openai/gpt-5",
          name: "openai/gpt-5"
        },
        {
          id: "deepseek/deepseek-chat",
          name: "deepseek/deepseek-chat"
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
        id: "openai/gpt-5",
        name: "openai/gpt-5"
      },
      {
        id: "deepseek/deepseek-chat",
        name: "deepseek/deepseek-chat"
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
    mocked.getSessionMessages.mockRejectedValueOnce(new Error("prefetch-failed"));
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

    expect(mocked.getSessionMessages).toHaveBeenCalledWith(
      "session-1",
      "cursor-older-1",
      80,
      "backward"
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

  it("failed 后收到新一轮 runtime_status: running 时，会恢复到运行态", async () => {
    const store = new SessionRuntimeStore("session-1");

    mocked.getSessionRuntime.mockResolvedValueOnce({
      sessionId: "session-1",
      runningState: "failed",
      hasActiveRun: false,
      canAttach: true,
      canInterrupt: false,
      inRunInputMode: "none",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      detail: "上一轮失败",
      errorCode: "CLAUDE_RESULT_ERROR_DURING_EXECUTION",
      errorDetail: "上一轮失败",
      updatedAt: "2026-06-13T07:00:00.000Z",
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
    expect(store.getState().session?.runningState).toBe("failed");

    (client!.options.onRuntimeStatus as ((event: Record<string, unknown>) => void))({
      type: "session.runtime_status",
      sessionId: "session-1",
      status: "running",
      detail: "new run started",
      timestamp: "2026-06-13T07:00:10.000Z"
    });

    expect(store.getState().session?.runningState).toBe("running");
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

  it("runtime 覆盖层不会被写进快照，重新进入时只用权威历史重建时间线", async () => {
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
        content: "先显示 runtime 正文",
        timestamp: "2026-04-13T10:00:00.000Z",
        sequence: 70,
        rawRef: "codex://raw#line=18",
        toolCall: null
      }
    });

    const snapshotAfterRuntime = readViewSnapshot<{
      messages: Array<{ id: string }>;
    }>(SESSION_RUNTIME_SNAPSHOT_KEY, Number.POSITIVE_INFINITY);

    expect(store.getState().messages.map((message) => message.id)).toEqual(["assistant-runtime-1"]);
    expect(snapshotAfterRuntime?.messages ?? []).toEqual([]);

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
          content: "先显示 runtime 正文",
          timestamp: "2026-04-13T10:00:35.000Z",
          sequence: 72,
          rawRef: "codex://raw#line=32",
          toolCall: null
        }
      ]
    });

    const snapshotAfterBackfill = readViewSnapshot<{
      messages: Array<{ id: string }>;
    }>(SESSION_RUNTIME_SNAPSHOT_KEY, Number.POSITIVE_INFINITY);

    expect(snapshotAfterBackfill?.messages.map((message) => message.id)).toEqual([
      "assistant-history-1"
    ]);

    store.destroy();
  });

  it("不同 messageId 但文案相同的 Codex runtime 回复不会在 overlay 内被错误合并", async () => {
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
        content: "好的，我来处理。",
        timestamp: "2026-05-06T10:00:00.000Z",
        sequence: 101,
        rawRef: "codex://raw#line=101",
        toolCall: null
      }
    });

    emitRealtimeRuntimeMessage({
      type: "session.runtime_message",
      sessionId: "session-1",
      source: "runtime",
      message: {
        messageId: "assistant-runtime-2",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        kind: "text",
        content: "好的，我来处理。",
        timestamp: "2026-05-06T10:00:01.000Z",
        sequence: 102,
        rawRef: "codex://raw#line=102",
        toolCall: null
      }
    });

    expect(store.getState().messages.map((message) => message.id)).toEqual([
      "assistant-runtime-1",
      "assistant-runtime-2"
    ]);

    store.destroy();
  });

  it("Codex assistant 流式消息在 runtime 过程中即使切换 messageId，也只保留一条最新正文", async () => {
    const store = new SessionRuntimeStore("session-1");
    await store.initialize();
    emitRealtimeSubscribed();

    emitRealtimeRuntimeMessage({
      type: "session.runtime_message",
      sessionId: "session-1",
      source: "runtime",
      message: {
        messageId: "assistant-runtime-stream-1",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        kind: "text",
        content: "第一段",
        timestamp: "2026-05-06T10:00:00.000Z",
        sequence: 101,
        rawRef: "codex://raw#line=101",
        toolCall: null
      }
    });

    emitRealtimeRuntimeMessage({
      type: "session.runtime_message",
      sessionId: "session-1",
      source: "runtime",
      message: {
        messageId: "assistant-runtime-stream-2",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "assistant",
        kind: "text",
        content: "第一段\n第二段",
        timestamp: "2026-05-06T10:00:01.000Z",
        sequence: 101,
        rawRef: "codex://raw#line=102",
        toolCall: null
      }
    });

    expect(store.getState().messages).toHaveLength(1);
    expect(store.getState().messages[0]).toMatchObject({
      id: "assistant-runtime-stream-1",
      rawRef: "codex://raw#line=101",
      content: "第一段\n第二段"
    });

    store.destroy();
  });

  it("OpenCode runtime tool_call 后续收到 backfill tool_result 时，不会保留一条沉底的旧工具消息", async () => {
    const store = new SessionRuntimeStore("session-1");
    await store.initialize();
    emitRealtimeSubscribed();

    emitRealtimeRuntimeMessage({
      type: "session.runtime_message",
      sessionId: "session-1",
      source: "runtime",
      message: {
        messageId: "runtime-tool-call-1",
        provider: "opencode",
        providerSessionId: "thread-1",
        role: "tool",
        kind: "tool_call",
        content: "{\"path\":\"/tmp/workspace/story.md\",\"content\":\"hello\"}",
        timestamp: "2026-03-28T10:09:00.000Z",
        sequence: 99,
        rawRef: "opencode://session/thread-1/message/msg-runtime/part/prt-tool-1?part=3001",
        toolCall: {
          callId: "call-write-1",
          name: "write",
          input: "{\"path\":\"/tmp/workspace/story.md\",\"content\":\"hello\"}",
          output: null,
          error: null,
          status: "running"
        }
      }
    });

    emitRealtimeEnvelope({
      type: "session.backfill",
      sessionId: "session-1",
      cursor: "cursor-after",
      olderCursor: null,
      messages: [
        {
          messageId: "assistant-1",
          provider: "opencode",
          providerSessionId: "thread-1",
          role: "assistant",
          kind: "text",
          content: "上一条回复",
          timestamp: "2026-03-28T10:00:00.000Z",
          sequence: 10,
          rawRef: "opencode://session/thread-1/message/assistant-1/part/text-1",
          toolCall: null
        },
        {
          messageId: "history-tool-result-1",
          provider: "opencode",
          providerSessionId: "thread-1",
          role: "tool",
          kind: "tool_result",
          content: "[tool result]",
          timestamp: "2026-03-28T10:00:01.000Z",
          sequence: 11,
          rawRef: "opencode://session/thread-1/message/msg-runtime/part/prt-tool-1",
          toolCall: {
            callId: "call-write-1",
            name: "write",
            input: "{\"path\":\"/tmp/workspace/story.md\",\"content\":\"hello\"}",
            output: "[tool result]",
            error: null,
            status: "completed"
          }
        }
      ]
    });

    expect(store.getState().messages.map((message) => message.id)).toEqual([
      "assistant-1",
      "history-tool-result-1"
    ]);
    expect(store.getState().messages[1]).toMatchObject({
      id: "history-tool-result-1",
      kind: "tool_result",
      sequence: 11,
      timestamp: "2026-03-28T10:00:01.000Z"
    });
    expect(store.getState().messages[1]?.toolCall).toMatchObject({
      callId: "call-write-1",
      status: "completed"
    });

    store.destroy();
  });

  it("Codex runtime tool_call 后续收到 backfill tool_result 时，不会保留一条沉底的旧工具消息", async () => {
    const store = new SessionRuntimeStore("session-1");
    await store.initialize();
    emitRealtimeSubscribed();

    emitRealtimeRuntimeMessage({
      type: "session.runtime_message",
      sessionId: "session-1",
      source: "runtime",
      message: {
        messageId: "runtime-tool-call-codex-1",
        provider: "codex",
        providerSessionId: "raw-1",
        role: "tool",
        kind: "tool_call",
        content: "{\"cmd\":\"pwd\"}",
        timestamp: "2026-04-15T10:09:00.000Z",
        sequence: 99,
        rawRef: "codex://raw#line=40",
        toolCall: {
          callId: "call-shell-1",
          name: "command_execution",
          input: "{\"cmd\":\"pwd\"}",
          output: null,
          error: null,
          status: "running"
        }
      }
    });

    emitRealtimeEnvelope({
      type: "session.backfill",
      sessionId: "session-1",
      cursor: "cursor-after",
      olderCursor: null,
      messages: [
        {
          messageId: "assistant-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "assistant",
          kind: "text",
          content: "上一条回复",
          timestamp: "2026-04-15T10:00:00.000Z",
          sequence: 10,
          rawRef: "codex://raw#line=10",
          toolCall: null
        },
        {
          messageId: "history-tool-result-codex-1",
          provider: "codex",
          providerSessionId: "raw-1",
          role: "tool",
          kind: "tool_result",
          content: "[tool result]",
          timestamp: "2026-04-15T10:00:01.000Z",
          sequence: 11,
          rawRef: "codex://raw#line=11",
          toolCall: {
            callId: "call-shell-1",
            name: "command_execution",
            input: "{\"cmd\":\"pwd\"}",
            output: "[tool result]",
            error: null,
            status: "completed"
          }
        }
      ]
    });

    expect(store.getState().messages.map((message) => message.id)).toEqual([
      "assistant-1",
      "history-tool-result-codex-1"
    ]);
    expect(store.getState().messages[1]).toMatchObject({
      id: "history-tool-result-codex-1",
      kind: "tool_result",
      sequence: 11,
      timestamp: "2026-04-15T10:00:01.000Z"
    });
    expect(store.getState().messages[1]?.toolCall).toMatchObject({
      callId: "call-shell-1",
      status: "completed"
    });

    store.destroy();
  });

  it("Codex 运行时消息和后续 backfill 文案相同但锚点不同时，会收敛成一条权威消息", async () => {
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

  it("Codex runtime 和 backfill 同一 rawRef 但不同 messageId 时，会通过兼容桥收敛成一条权威消息", async () => {
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
          timestamp: "2026-04-13T10:00:01.000Z",
          sequence: 71,
          rawRef: "codex://raw#line=18",
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
