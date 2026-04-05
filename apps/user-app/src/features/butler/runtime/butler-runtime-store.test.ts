import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/butler-api", () => ({
  getButlerProfile: vi.fn(),
  initButlerProfile: vi.fn(),
  updateButlerProfile: vi.fn(),
  getButlerOverview: vi.fn(),
  listButlerControlEvents: vi.fn(),
  getCurrentButlerControlSession: vi.fn(),
  startButlerControlSession: vi.fn(),
  sendButlerControlMessage: vi.fn()
}));

vi.mock("../../conversation/api/conversation-api", () => ({
  getProviderCapabilities: vi.fn(),
  getSessionMessages: vi.fn(),
  getSessionRuntime: vi.fn()
}));

import { ButlerRuntimeStore } from "./butler-runtime-store";
import {
  getButlerProfile,
  initButlerProfile,
  updateButlerProfile,
  getButlerOverview,
  listButlerControlEvents,
  getCurrentButlerControlSession,
  startButlerControlSession,
  sendButlerControlMessage
} from "../api/butler-api";
import { getProviderCapabilities, getSessionMessages, getSessionRuntime } from "../../conversation/api/conversation-api";

const mockedGetButlerProfile = vi.mocked(getButlerProfile);
const mockedInitButlerProfile = vi.mocked(initButlerProfile);
const mockedUpdateButlerProfile = vi.mocked(updateButlerProfile);
const mockedGetButlerOverview = vi.mocked(getButlerOverview);
const mockedListButlerControlEvents = vi.mocked(listButlerControlEvents);
const mockedGetCurrentButlerControlSession = vi.mocked(getCurrentButlerControlSession);
const mockedStartButlerControlSession = vi.mocked(startButlerControlSession);
const mockedSendButlerControlMessage = vi.mocked(sendButlerControlMessage);
const mockedGetProviderCapabilities = vi.mocked(getProviderCapabilities);
const mockedGetSessionMessages = vi.mocked(getSessionMessages);
const mockedGetSessionRuntime = vi.mocked(getSessionRuntime);

describe("ButlerRuntimeStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();

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
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [] },
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
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [] },
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
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [] },
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
    mockedGetCurrentButlerControlSession.mockResolvedValue({ controlSession: null });
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
  });

  it("provider 切换后会清空消息并重新加载", async () => {
    const store = new ButlerRuntimeStore("workspace-1");
    await store.initialize();

    (store as unknown as { patch: (state: Record<string, unknown>) => void }).patch({
      messages: [{ clientRequestId: "old" }],
      controlSession: { id: "ctrl-old" }
    });

    await store.switchProvider("claude-code");

    expect(mockedUpdateButlerProfile).toHaveBeenCalledWith({ providerId: "claude-code" });
    expect(mockedStartButlerControlSession).toHaveBeenCalledWith({});
    expect(store.getState().messages).toEqual([]);
    expect(store.getState().controlSession).toBeNull();
  });

  it("provider 切换失败时会回滚到旧状态", async () => {
    const store = new ButlerRuntimeStore("workspace-1");
    await store.initialize();

    (store as unknown as { patch: (state: Record<string, unknown>) => void }).patch({
      messages: [{ clientRequestId: "old-message" }],
      controlSession: { id: "ctrl-old" },
      activeProvider: "codex"
    });
    mockedUpdateButlerProfile.mockRejectedValueOnce(new Error("switch failed"));

    await expect(store.switchProvider("claude-code")).rejects.toThrow("switch failed");

    expect(store.getState().activeProvider).toBe("codex");
    expect(store.getState().messages).toEqual([{ clientRequestId: "old-message" }]);
    expect(store.getState().controlSession).toEqual({ id: "ctrl-old" });
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
});
