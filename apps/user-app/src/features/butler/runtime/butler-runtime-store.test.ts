import { beforeEach, describe, expect, it, vi } from "vitest";

const realtimeMock = vi.hoisted(() => {
  const instances: Array<{
    options: Record<string, unknown>;
    updateCursor: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
  }> = [];

  class MockRealtimeClient {
    public readonly options: Record<string, unknown>;
    public readonly updateCursor = vi.fn();
    public readonly close = vi.fn();
    public readonly start = vi.fn();

    constructor(options: Record<string, unknown>) {
      this.options = options;
      instances.push(this);
    }
  }

  return {
    instances,
    MockRealtimeClient
  };
});

vi.mock("../api/butler-api", () => ({
  getButlerProfile: vi.fn(),
  initButlerProfile: vi.fn(),
  updateButlerProfile: vi.fn(),
  getButlerOverview: vi.fn(),
  listButlerControlEvents: vi.fn(),
  getButlerControlSession: vi.fn(),
  getCurrentButlerControlSession: vi.fn(),
  resetButlerControlSession: vi.fn(),
  startButlerControlSession: vi.fn(),
  sendButlerControlMessage: vi.fn()
}));

vi.mock("../../conversation/api/conversation-api", () => ({
  getProviderCapabilities: vi.fn(),
  getSessionMessages: vi.fn(),
  getSessionPermissionRequests: vi.fn(),
  getSessionRuntime: vi.fn(),
  interruptSession: vi.fn()
}));

vi.mock("../../../network/realtime-client", () => ({
  RealtimeClient: realtimeMock.MockRealtimeClient
}));

import { ButlerRuntimeStore } from "./butler-runtime-store";
import { userPreferenceStore } from "../../../preferences/user-preference-store";
import {
  getButlerProfile,
  initButlerProfile,
  updateButlerProfile,
  getButlerOverview,
  listButlerControlEvents,
  getButlerControlSession,
  getCurrentButlerControlSession,
  resetButlerControlSession,
  startButlerControlSession,
  sendButlerControlMessage
} from "../api/butler-api";
import {
  getProviderCapabilities,
  getSessionMessages,
  getSessionPermissionRequests,
  getSessionRuntime,
  interruptSession
} from "../../conversation/api/conversation-api";

const mockedGetButlerProfile = vi.mocked(getButlerProfile);
const mockedInitButlerProfile = vi.mocked(initButlerProfile);
const mockedUpdateButlerProfile = vi.mocked(updateButlerProfile);
const mockedGetButlerOverview = vi.mocked(getButlerOverview);
const mockedListButlerControlEvents = vi.mocked(listButlerControlEvents);
const mockedGetButlerControlSession = vi.mocked(getButlerControlSession);
const mockedGetCurrentButlerControlSession = vi.mocked(getCurrentButlerControlSession);
const mockedResetButlerControlSession = vi.mocked(resetButlerControlSession);
const mockedStartButlerControlSession = vi.mocked(startButlerControlSession);
const mockedSendButlerControlMessage = vi.mocked(sendButlerControlMessage);
const mockedGetProviderCapabilities = vi.mocked(getProviderCapabilities);
const mockedGetSessionMessages = vi.mocked(getSessionMessages);
const mockedGetSessionPermissionRequests = vi.mocked(getSessionPermissionRequests);
const mockedGetSessionRuntime = vi.mocked(getSessionRuntime);
const mockedInterruptSession = vi.mocked(interruptSession);

function createControlSession(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  const sessionOverrides =
    overrides.session && typeof overrides.session === "object"
      ? (overrides.session as Record<string, unknown>)
      : {};

  return {
    id: "ctrl-control-1",
    providerId: "codex",
    sessionId: "session-control-1",
    purpose: "chat",
    title: "控制会话",
    sourceItemId: null,
    status: "idle",
    lastContextVersion: null,
    lastSummary: null,
    createdAt: "2026-04-05T00:00:00.000Z",
    updatedAt: "2026-04-05T00:00:00.000Z",
    ...overrides,
    session: {
      sessionId: "session-control-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-control-1",
      rawStoreRef: "raw-control-1",
      title: "控制会话",
      messageCount: 1,
      lastMessageAt: "2026-04-05T00:00:00.000Z",
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z",
      syncStatus: "idle",
      syncCursor: null,
      lastSyncAt: null,
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      runningState: "idle",
      activitySource: "runtime",
      lastEventAt: "2026-04-05T00:00:00.000Z",
      completedAt: null,
      lastSeenAt: null,
      activityState: "idle",
      ...sessionOverrides
    }
  };
}

describe("ButlerRuntimeStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    realtimeMock.instances.length = 0;
    userPreferenceStore.resetToLocalFallback();

    mockedGetButlerProfile.mockResolvedValue({
      initialized: true,
      profile: {
        id: "default",
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: "/tmp/butler",
        agentsMode: "inline",
        agentsFilePath: null,
        agentsContent: "测试",
        persona: { tone: "direct", language: "zh-CN", summaryStyle: "brief" },
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [], summaryDebounceSeconds: 300 },
        initializedAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z"
      }
    });
    mockedInitButlerProfile.mockResolvedValue({
      initialized: true,
      profile: {
        id: "default",
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: "/tmp/butler",
        agentsMode: "inline",
        agentsFilePath: null,
        agentsContent: "测试",
        persona: { tone: "direct", language: "zh-CN", summaryStyle: "brief" },
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [], summaryDebounceSeconds: 300 },
        initializedAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z"
      }
    });
    mockedUpdateButlerProfile.mockResolvedValue({
      initialized: true,
      profile: {
        id: "default",
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: "/tmp/butler",
        agentsMode: "inline",
        agentsFilePath: null,
        agentsContent: "测试",
        persona: { tone: "direct", language: "zh-CN", summaryStyle: "brief" },
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [], summaryDebounceSeconds: 300 },
        initializedAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z"
      }
    });
    mockedGetButlerOverview.mockResolvedValue({
      overview: {
        version: "v1",
        generatedAt: "2026-04-05T00:00:00.000Z",
        global: {
          projectCount: 0,
          activeProjectCount: 0,
          blockedProjectCount: 0,
          highRiskProjectCount: 0,
          topRisks: [],
          nextActions: []
        },
        projects: [],
        sessions: [],
        patrols: [],
        verifications: []
      }
    });
    mockedListButlerControlEvents.mockResolvedValue({ items: [] });
    mockedGetButlerControlSession.mockResolvedValue({ controlSession: null });
    mockedGetCurrentButlerControlSession.mockResolvedValue({ controlSession: null });
    mockedResetButlerControlSession.mockResolvedValue({ controlSession: null });
    mockedGetProviderCapabilities.mockResolvedValue({
      provider: "codex",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: false,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      supportsQueueWhileRunning: false,
      supportsRunSteering: false,
      supportsSlashMenu: false,
      supportsReasoningSelector: true,
      modelOptions: [{ id: "provider-default", name: "provider-default", usesProviderDefault: true }],
      defaultReasoningLevel: null,
      limitations: []
    });
    mockedGetSessionMessages.mockResolvedValue({
      messages: [],
      cursor: null,
      nextCursor: null,
      total: 0
    } as never);
    mockedGetSessionPermissionRequests.mockResolvedValue({
      items: []
    } as never);
    mockedGetSessionRuntime.mockResolvedValue({
      sessionId: "session-control-1",
      runningState: "idle",
      hasActiveRun: false,
      canAttach: false,
      canInterrupt: true,
      inRunInputMode: "none",
      provider: "codex",
      providerSessionId: "provider-control-1",
      activityResolutionSource: "authoritative_runtime",
      activityConfidence: "authoritative",
      runId: null,
      detail: null,
      errorCode: null,
      errorDetail: null,
      updatedAt: "2026-04-05T00:00:00.000Z",
      watchdogTriggeredAt: null,
      contextUsage: null
    } as never);
    mockedStartButlerControlSession.mockResolvedValue({
      controlSession: { id: "ctrl-start" }
    } as never);
    mockedSendButlerControlMessage.mockResolvedValue({
      controlSession: { id: "ctrl-send" }
    } as never);
    mockedInterruptSession.mockResolvedValue({
      sessionId: "session-control-1",
      interrupted: true,
      detail: "interrupt requested"
    } as never);
  });

  it("发送消息没有控制会话时调用 start 接口", async () => {
    const store = new ButlerRuntimeStore("workspace-1");
    await store.initialize();

    await store.sendMessage("首次消息");

    expect(mockedStartButlerControlSession).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "首次消息"
      })
    );
    expect(mockedSendButlerControlMessage).not.toHaveBeenCalled();
  });

  it("发送消息已有控制会话时调用 send 接口", async () => {
    const store = new ButlerRuntimeStore("workspace-1");
    await store.initialize();

    (store as unknown as { patch: (state: Record<string, unknown>) => void }).patch({
      controlSession: { id: "ctrl-existing" }
    });

    await store.sendMessage("继续消息");

    expect(mockedSendButlerControlMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "继续消息"
      })
    );
  });

  it("发送消息会继承当前默认会话权限", async () => {
    const store = new ButlerRuntimeStore("workspace-1");
    userPreferenceStore.hydrate({
      ...userPreferenceStore.getState(),
      profile: {
        ...userPreferenceStore.getState().profile,
        defaultPermissionMode: "bypassPermissions"
      }
    });
    await store.initialize();

    await store.sendMessage("首次消息");

    expect(mockedStartButlerControlSession).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "首次消息",
        permissionMode: "bypassPermissions"
      })
    );
  });

  it("已有控制会话时继续发送也会继承当前默认会话权限", async () => {
    const store = new ButlerRuntimeStore("workspace-1");
    userPreferenceStore.hydrate({
      ...userPreferenceStore.getState(),
      profile: {
        ...userPreferenceStore.getState().profile,
        defaultPermissionMode: "bypassPermissions"
      }
    });
    await store.initialize();

    (store as unknown as { patch: (state: Record<string, unknown>) => void }).patch({
      controlSession: { id: "ctrl-existing" }
    });

    await store.sendMessage("继续消息");

    expect(mockedSendButlerControlMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "继续消息",
        permissionMode: "bypassPermissions"
      })
    );
  });

  it("发送消息后首次 reload 仍返回 idle 时，会保留待启动活跃态和可中断状态", async () => {
    const store = new ButlerRuntimeStore("workspace-1");
    const controlSession = createControlSession({
      id: "ctrl-existing"
    });

    mockedSendButlerControlMessage.mockResolvedValueOnce({
      controlSession
    } as never);
    mockedGetButlerControlSession.mockResolvedValueOnce({
      controlSession: createControlSession({
        id: "ctrl-existing",
        updatedAt: "2026-04-05T00:00:05.000Z",
        session: {
          updatedAt: "2026-04-05T00:00:05.000Z",
          lastEventAt: null,
          runningState: "idle",
          activityState: "idle"
        }
      })
    } as never);
    mockedGetSessionMessages.mockResolvedValueOnce({
      messages: [],
      cursor: "cursor-latest",
      nextCursor: null,
      total: 0
    } as never);
    mockedGetSessionRuntime.mockResolvedValueOnce({
      sessionId: "session-control-1",
      runningState: "idle",
      hasActiveRun: false,
      canAttach: false,
      canInterrupt: false,
      inRunInputMode: "none",
      provider: "codex",
      providerSessionId: "provider-control-1",
      activityResolutionSource: "authoritative_runtime",
      activityConfidence: "authoritative",
      runId: null,
      detail: null,
      errorCode: null,
      errorDetail: null,
      updatedAt: "2026-04-05T00:00:05.000Z",
      watchdogTriggeredAt: null,
      contextUsage: null
    } as never);

    await store.initialize();

    (store as unknown as { patch: (state: Record<string, unknown>) => void }).patch({
      controlSession
    });

    await store.sendMessage("继续消息");

    expect(store.getState().controlSession).toEqual(
      expect.objectContaining({
        id: "ctrl-existing",
        status: "running",
        session: expect.objectContaining({
          runningState: "starting",
          activitySource: "inferred",
          activityState: "running"
        })
      })
    );
    expect(store.getState().runtimeHasActiveRun).toBe(true);
    expect(store.getState().runtimeCanInterrupt).toBe(true);
  });

  it("待启动运行收到假阴性的 inactive 活动事件时，不会提前丢掉可停止状态", async () => {
    const store = new ButlerRuntimeStore("workspace-1");
    const controlSession = createControlSession({
      id: "ctrl-existing",
      status: "running",
      session: {
        runningState: "starting",
        activityState: "running",
        activitySource: "inferred"
      }
    });

    mockedSendButlerControlMessage.mockResolvedValueOnce({
      controlSession
    } as never);
    mockedGetButlerControlSession.mockResolvedValueOnce({
      controlSession: createControlSession({
        id: "ctrl-existing",
        status: "idle",
        updatedAt: "2026-04-05T00:00:05.000Z",
        session: {
          updatedAt: "2026-04-05T00:00:05.000Z",
          lastEventAt: "2026-04-05T00:00:05.000Z",
          runningState: "idle",
          activityState: "idle",
          activitySource: "runtime"
        }
      })
    } as never);
    mockedGetSessionMessages.mockResolvedValueOnce({
      messages: [],
      cursor: "cursor-latest",
      nextCursor: null,
      total: 0
    } as never);
    mockedGetSessionRuntime.mockResolvedValueOnce({
      sessionId: "session-control-1",
      runningState: "idle",
      hasActiveRun: false,
      canAttach: false,
      canInterrupt: false,
      inRunInputMode: "none",
      provider: "codex",
      providerSessionId: "provider-control-1",
      activityResolutionSource: "authoritative_runtime",
      activityConfidence: "authoritative",
      runId: null,
      detail: null,
      errorCode: null,
      errorDetail: null,
      updatedAt: "2026-04-05T00:00:05.000Z",
      watchdogTriggeredAt: null,
      contextUsage: null
    } as never);

    await store.initialize();
    (store as unknown as { patch: (state: Record<string, unknown>) => void }).patch({
      controlSession
    });
    await store.sendMessage("继续消息");

    const realtime = realtimeMock.instances[0];
    expect(realtime).toBeDefined();

    (realtime?.options.onActivity as ((payload: Record<string, unknown>) => void))({
      type: "session.activity",
      sessionId: "session-control-1",
      runningState: "idle",
      activityResolutionSource: "authoritative_runtime",
      activityConfidence: "authoritative",
      runId: null,
      detail: null,
      interruptSource: null,
      errorCode: null,
      errorDetail: null,
      hasActiveRun: false,
      canInterrupt: false,
      updatedAt: "2026-04-05T00:00:06.000Z",
      watchdogTriggeredAt: null
    });

    expect(store.getState().controlSession?.status).toBe("running");
    expect(store.getState().controlSession?.session.runningState).toBe("starting");
    expect(store.getState().runtimeHasActiveRun).toBe(true);
    expect(store.getState().runtimeCanInterrupt).toBe(true);
  });

  it("会保留 Butler 会话的 older cursor，并在上翻时继续加载更早消息", async () => {
    const store = new ButlerRuntimeStore("workspace-1");
    const controlSession = {
      id: "ctrl-history",
      providerId: "codex",
      sessionId: "session-control-1",
      purpose: "chat" as const,
      title: "控制会话",
      sourceItemId: null,
      status: "running" as const,
      lastContextVersion: null,
      lastSummary: "最近在跟进",
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z",
      session: {
        sessionId: "session-control-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "provider-control-1",
        rawStoreRef: "raw-control-1",
        title: "控制会话",
        messageCount: 2,
        lastMessageAt: "2026-04-05T00:00:02.000Z",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:02.000Z",
        syncStatus: "idle",
        syncCursor: null,
        lastSyncAt: null,
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "running",
        activitySource: "runtime",
        lastEventAt: "2026-04-05T00:00:02.000Z",
        completedAt: null,
        lastSeenAt: null,
        activityState: "idle"
      }
    };
    mockedGetCurrentButlerControlSession.mockResolvedValueOnce({
      controlSession
    } as never);
    mockedGetSessionMessages
      .mockResolvedValueOnce({
        messages: [
          {
            messageId: "msg-2",
            provider: "codex",
            providerSessionId: "provider-control-1",
            role: "assistant",
            kind: "text",
            content: "较新的消息",
            timestamp: "2026-04-05T00:00:02.000Z",
            sequence: 2,
            rawRef: "raw-2"
          }
        ],
        cursor: "cursor-latest",
        nextCursor: "cursor-older-1",
        total: 2
      } as never)
      .mockResolvedValueOnce({
        messages: [
          {
            messageId: "msg-1",
            provider: "codex",
            providerSessionId: "provider-control-1",
            role: "user",
            kind: "text",
            content: "更早的消息",
            timestamp: "2026-04-05T00:00:01.000Z",
            sequence: 1,
            rawRef: "raw-1"
          }
        ],
        cursor: "cursor-older-1",
        nextCursor: null,
        total: 2
      } as never);

    await store.initialize();

    expect(store.getState().hasOlderMessages).toBe(true);
    expect(store.getState().olderCursor).toBe("cursor-older-1");

    await store.loadOlderMessages();

    expect(mockedGetSessionMessages).toHaveBeenNthCalledWith(
      2,
      "session-control-1",
      "cursor-older-1",
      60,
      "backward"
    );
    expect(store.getState().messages.map((message) => message.content)).toEqual([
      "更早的消息",
      "较新的消息"
    ]);
    expect(store.getState().hasOlderMessages).toBe(false);
    expect(store.getState().olderCursor).toBeNull();
  });

  it("控制会话收到实时助手消息时会立刻更新消息列表", async () => {
    const store = new ButlerRuntimeStore("workspace-1");
    const controlSession = {
      id: "ctrl-start",
      providerId: "codex",
      sessionId: "session-control-1",
      purpose: "chat" as const,
      title: "控制会话",
      sourceItemId: null,
      status: "running" as const,
      lastContextVersion: null,
      lastSummary: "首次消息",
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z",
      session: {
        sessionId: "session-control-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "provider-control-1",
        rawStoreRef: "raw-control-1",
        title: "控制会话",
        messageCount: 1,
        lastMessageAt: "2026-04-05T00:00:01.000Z",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:01.000Z",
        syncStatus: "idle",
        syncCursor: null,
        lastSyncAt: null,
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "running",
        activitySource: "runtime",
        lastEventAt: "2026-04-05T00:00:01.000Z",
        completedAt: null,
        lastSeenAt: null,
        activityState: "idle"
      }
    };
    mockedGetCurrentButlerControlSession.mockResolvedValueOnce({ controlSession: null });
    mockedGetButlerControlSession.mockResolvedValueOnce({
      controlSession
    } as never);
    mockedGetSessionMessages.mockResolvedValueOnce({
      messages: [
        {
          messageId: "msg-user-1",
          provider: "codex",
          providerSessionId: "provider-control-1",
          role: "user",
          kind: "text",
          content: "首次消息",
          timestamp: "2026-04-05T00:00:01.000Z",
          sequence: 1,
          rawRef: "raw-user-1"
        }
      ],
      cursor: "cursor-1",
      nextCursor: null,
      total: 1
    } as never);
    mockedStartButlerControlSession.mockResolvedValueOnce({
      controlSession
    } as never);

    await store.initialize();
    await store.sendMessage("首次消息");

    const realtime = realtimeMock.instances[0];
    expect(realtime).toBeDefined();

    (realtime?.options.onRuntimeMessage as ((payload: Record<string, unknown>) => void))({
      type: "session.runtime_message",
      sessionId: "session-control-1",
      source: "runtime",
      message: {
        messageId: "msg-assistant-1",
        provider: "codex",
        providerSessionId: "provider-control-1",
        role: "assistant",
        kind: "text",
        content: "这是实时回复",
        timestamp: "2026-04-05T00:00:02.000Z",
        sequence: 2,
        rawRef: "raw-assistant-1"
      }
    });

    expect(store.getState().messages.map((message) => message.content)).toEqual([
      "首次消息",
      "这是实时回复"
    ]);
  });

  it("分析会话结束但没有任何消息时，会补一条本地诊断消息", async () => {
    const store = new ButlerRuntimeStore("workspace-1");
    const controlSession = {
      id: "ctrl-analysis-1",
      providerId: "codex",
      sessionId: "session-analysis-1",
      purpose: "todo_analysis" as const,
      title: "分析代办：验证码收尾",
      sourceItemId: "todo-1",
      status: "failed" as const,
      lastContextVersion: null,
      lastSummary:
        "代办分析助手没有返回结构化 JSON；最近 assistant 输出为空；raw 终态：task_complete，last_agent_message=null",
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:01:00.000Z",
      session: {
        sessionId: "session-analysis-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "provider-analysis-1",
        rawStoreRef: "raw-analysis-1",
        title: "分析代办：验证码收尾",
        messageCount: 0,
        lastMessageAt: null,
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:01:00.000Z",
        syncStatus: "idle",
        syncCursor: null,
        lastSyncAt: "2026-04-05T00:01:00.000Z",
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "failed",
        activitySource: "runtime",
        lastEventAt: "2026-04-05T00:01:00.000Z",
        completedAt: "2026-04-05T00:01:00.000Z",
        lastSeenAt: null,
        activityState: "completed"
      }
    };

    mockedGetCurrentButlerControlSession.mockResolvedValue({
      controlSession
    } as never);
    mockedGetSessionRuntime.mockResolvedValue({
      sessionId: "session-analysis-1",
      runningState: "failed",
      hasActiveRun: false,
      canAttach: false,
      canInterrupt: false,
      inRunInputMode: "none",
      provider: "codex",
      providerSessionId: "provider-analysis-1",
      activityResolutionSource: "authoritative_runtime",
      activityConfidence: "authoritative",
      runId: null,
      detail: null,
      errorCode: null,
      errorDetail:
        "代办分析助手没有返回结构化 JSON；最近 assistant 输出为空；raw 终态：task_complete，last_agent_message=null",
      updatedAt: "2026-04-05T00:01:00.000Z",
      watchdogTriggeredAt: null,
      contextUsage: null
    } as never);

    await store.initialize();

    expect(store.getState().messages).toEqual([
      expect.objectContaining({
        role: "system",
        kind: "text",
        content: expect.stringContaining("没有收到可展示的助手消息"),
        rawRef: "butler-diagnostic://ctrl-analysis-1"
      })
    ]);
  });

  it("打开长控制会话时会优先读取最新一页历史，而不是最早一页", async () => {
    const store = new ButlerRuntimeStore("workspace-1");
    const controlSession = {
      id: "ctrl-long-1",
      providerId: "codex",
      sessionId: "session-control-long-1",
      purpose: "chat" as const,
      title: "长控制会话",
      sourceItemId: null,
      status: "running" as const,
      lastContextVersion: null,
      lastSummary: null,
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:10:00.000Z",
      session: {
        sessionId: "session-control-long-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "provider-control-long-1",
        rawStoreRef: "raw-control-long-1",
        title: "长控制会话",
        messageCount: 200,
        lastMessageAt: "2026-04-05T00:10:00.000Z",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:10:00.000Z",
        syncStatus: "idle",
        syncCursor: null,
        lastSyncAt: null,
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "completed",
        activitySource: "runtime",
        lastEventAt: "2026-04-05T00:10:00.000Z",
        completedAt: "2026-04-05T00:10:00.000Z",
        lastSeenAt: null,
        activityState: "completed_unread"
      }
    };

    mockedGetCurrentButlerControlSession.mockResolvedValue({
      controlSession
    } as never);
    mockedGetSessionMessages.mockResolvedValue({
      messages: Array.from({ length: 60 }, (_, index) => ({
        messageId: `msg-${index + 141}`,
        provider: "codex",
        providerSessionId: "provider-control-long-1",
        role: index % 2 === 0 ? "user" : "assistant",
        kind: "text",
        content: `message-${index + 141}`,
        timestamp: `2026-04-05T00:${String(index).padStart(2, "0")}:00.000Z`,
        sequence: index + 141,
        rawRef: `raw-${index + 141}`
      })),
      cursor: "cursor-200",
      nextCursor: "cursor-140",
      total: 200
    } as never);

    await store.initialize();

    expect(mockedGetSessionMessages).toHaveBeenCalledWith(
      "session-control-long-1",
      null,
      60,
      "backward"
    );
    expect(store.getState().messages[0]?.sequence).toBe(141);
    expect(store.getState().messages.at(-1)?.sequence).toBe(200);
    expect(realtimeMock.instances[0]?.options.cursor).toBe("cursor-200");
  });

  it("重复收到 inactive 活动事件时不会反复 reload 控制会话", async () => {
    vi.useFakeTimers();

    try {
      const store = new ButlerRuntimeStore("workspace-1");
      const controlSession = {
        id: "ctrl-start",
        providerId: "codex",
        sessionId: "session-control-1",
        purpose: "chat" as const,
        title: "控制会话",
        sourceItemId: null,
        status: "running" as const,
        lastContextVersion: null,
        lastSummary: "首次消息",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
        session: {
          sessionId: "session-control-1",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "provider-control-1",
          rawStoreRef: "raw-control-1",
          title: "控制会话",
          messageCount: 0,
          lastMessageAt: null,
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:00:00.000Z",
          syncStatus: "idle",
          syncCursor: null,
          lastSyncAt: null,
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          runningState: "running",
          activitySource: "runtime",
          lastEventAt: "2026-04-05T00:00:00.000Z",
          completedAt: null,
          lastSeenAt: null,
          activityState: "running"
        }
      };

      mockedGetCurrentButlerControlSession.mockResolvedValue({
        controlSession
      } as never);

      await store.initialize();

      const realtime = realtimeMock.instances[0];
      expect(realtime).toBeDefined();

      const baselineCalls = mockedGetCurrentButlerControlSession.mock.calls.length;
      const emitActivity = realtime?.options.onActivity as ((payload: Record<string, unknown>) => void);

      emitActivity({
        type: "session.activity",
        sessionId: "session-control-1",
        runningState: "idle",
        activityResolutionSource: "authoritative_runtime",
        activityConfidence: "authoritative",
        runId: null,
        detail: null,
        interruptSource: null,
        errorCode: null,
        errorDetail: null,
        hasActiveRun: false,
        canInterrupt: false,
        updatedAt: "2026-04-05T00:00:01.000Z",
        watchdogTriggeredAt: null
      });
      emitActivity({
        type: "session.activity",
        sessionId: "session-control-1",
        runningState: "idle",
        activityResolutionSource: "authoritative_runtime",
        activityConfidence: "authoritative",
        runId: null,
        detail: null,
        interruptSource: null,
        errorCode: null,
        errorDetail: null,
        hasActiveRun: false,
        canInterrupt: false,
        updatedAt: "2026-04-05T00:00:01.100Z",
        watchdogTriggeredAt: null
      });

      await vi.advanceTimersByTimeAsync(500);

      expect(mockedGetCurrentButlerControlSession.mock.calls.length - baselineCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("同一控制会话的后台同步不会把历史状态重新切回 loading", async () => {
    vi.useFakeTimers();

    try {
      const store = new ButlerRuntimeStore("workspace-1");
      const controlSession = {
        id: "ctrl-start",
        providerId: "codex",
        sessionId: "session-control-1",
        purpose: "chat" as const,
        title: "控制会话",
        sourceItemId: null,
        status: "running" as const,
        lastContextVersion: null,
        lastSummary: "首次消息",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
        session: {
          sessionId: "session-control-1",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "provider-control-1",
          rawStoreRef: "raw-control-1",
          title: "控制会话",
          messageCount: 0,
          lastMessageAt: null,
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:00:00.000Z",
          syncStatus: "idle",
          syncCursor: null,
          lastSyncAt: null,
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          runningState: "running",
          activitySource: "runtime",
          lastEventAt: "2026-04-05T00:00:00.000Z",
          completedAt: null,
          lastSeenAt: null,
          activityState: "running"
        }
      };
      const historyStates: string[] = [];

      mockedGetCurrentButlerControlSession.mockResolvedValue({
        controlSession
      } as never);

      const unsubscribe = store.subscribe(() => {
        historyStates.push(store.getState().historyState);
      });

      await store.initialize();
      historyStates.length = 0;

      const realtime = realtimeMock.instances[0];
      expect(realtime).toBeDefined();

      const emitActivity = realtime?.options.onActivity as ((payload: Record<string, unknown>) => void);
      emitActivity({
        type: "session.activity",
        sessionId: "session-control-1",
        runningState: "idle",
        activityResolutionSource: "authoritative_runtime",
        activityConfidence: "authoritative",
        runId: null,
        detail: null,
        interruptSource: null,
        errorCode: null,
        errorDetail: null,
        hasActiveRun: false,
        canInterrupt: false,
        updatedAt: "2026-04-05T00:00:01.000Z",
        watchdogTriggeredAt: null
      });

      await vi.advanceTimersByTimeAsync(500);
      unsubscribe();

      expect(historyStates).not.toContain("loading");
      expect(store.getState().historyState).toBe("ready");
    } finally {
      vi.useRealTimers();
    }
  });

  it("新建会话时只清空当前状态，不自动发送首条消息", async () => {
    const store = new ButlerRuntimeStore("workspace-1");
    await store.initialize();

    (store as unknown as { patch: (state: Record<string, unknown>) => void }).patch({
      messages: [{ clientRequestId: "old-message" }],
      controlSession: { id: "ctrl-old" },
      historyState: "error",
      runtimeHasActiveRun: true,
      runtimeCanInterrupt: true,
      contextUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }
    });

    await store.startFreshSession();

    expect(mockedResetButlerControlSession).toHaveBeenCalledTimes(1);
    expect(mockedStartButlerControlSession).not.toHaveBeenCalled();
    expect(store.getState().messages).toEqual([]);
    expect(store.getState().controlSession).toBeNull();
    expect(store.getState().historyState).toBe("ready");
    expect(store.getState().runtimeHasActiveRun).toBeNull();
    expect(store.getState().runtimeCanInterrupt).toBeNull();
    expect(store.getState().contextUsage).toBeNull();
  });

  it("中断控制会话时会调用通用会话中断接口并更新本地运行态", async () => {
    const store = new ButlerRuntimeStore("workspace-1");
    await store.initialize();

    (store as unknown as { patch: (state: Record<string, unknown>) => void }).patch({
      controlSession: {
        id: "ctrl-existing",
        session: {
          sessionId: "session-control-1"
        }
      },
      runtimeHasActiveRun: true,
      runtimeCanInterrupt: true
    });

    await store.interrupt();

    expect(mockedInterruptSession).toHaveBeenCalledWith("session-control-1");
    expect(store.getState().runtimeHasActiveRun).toBe(false);
    expect(store.getState().runtimeCanInterrupt).toBe(false);
  });
});
