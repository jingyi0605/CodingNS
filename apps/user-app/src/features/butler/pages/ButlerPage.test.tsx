import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";

const setAuxiliaryPanelMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const clipboardWriteTextMock = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");

  return {
    ...actual,
    useNavigate: () => navigateMock
  };
});

vi.mock("../../conversation/components/ComposerPanel", () => ({
  ComposerPanel: ({
    isSubmitting,
    onSend,
    placeholder
  }: {
    isSubmitting?: boolean;
    onSend?: (content: string) => Promise<void>;
    placeholder?: string;
  }) => (
    <div>
      <div data-testid="butler-composer-placeholder">{placeholder}</div>
      <button
        type="button"
        data-testid="butler-composer-send"
        disabled={isSubmitting}
        onClick={() => {
          void onSend?.("测试输入");
        }}
      >
        发送
      </button>
    </div>
  )
}));

vi.mock("../../conversation/components/MessageTimeline", () => ({
  MessageTimeline: ({
    assistantAvatar,
    hasOlderMessages,
    loadingOlderMessages,
    onLoadOlderMessages
  }: {
    assistantAvatar?: unknown;
    hasOlderMessages?: boolean;
    loadingOlderMessages?: boolean;
    onLoadOlderMessages?: () => void;
  }) => (
    <div>
      <div data-testid="butler-message-timeline">{assistantAvatar as never}</div>
      <div data-testid="butler-message-has-older">{String(Boolean(hasOlderMessages))}</div>
      <div data-testid="butler-message-loading-older">{String(Boolean(loadingOlderMessages))}</div>
      <button type="button" data-testid="butler-load-older" onClick={() => onLoadOlderMessages?.()}>
        加载更早消息
      </button>
    </div>
  )
}));

vi.mock("../../conversation/components/FileContextPanel", () => ({
  FileContextPanel: ({
    workspaceId
  }: {
    workspaceId?: string | null;
  }) => <div data-testid="butler-sandbox-file-panel">{workspaceId}</div>
}));

vi.mock("../../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => ({
    navigationGroups: [
      {
        workspace: {
          id: "workspace-1",
          name: "项目一",
          path: "/repo/project-one"
        },
        sessions: [
          {
            id: "session-follow-1",
            projectId: "project-1",
            sessionId: "session-1",
            title: "登录页改造",
            provider: "codex",
            role: "execution",
            ownershipMode: "managed",
            status: "running",
            runningState: "running",
            lastSummary: null,
            lastCheckpointAt: null,
            lastContextTokenCount: null,
            createdAt: "2026-04-05T00:00:00.000Z",
            updatedAt: "2026-04-05T00:00:00.000Z",
            parentSessionId: null,
            forkedFromSessionId: null,
            forkedAt: null,
            branchLabel: null,
            branchOrder: null,
            workspaceId: "workspace-1",
            workspaceName: "项目一",
            workspacePath: "/repo/project-one"
          }
        ]
      }
    ],
    requestNavigationRefresh: vi.fn(),
    setAuxiliaryPanel: setAuxiliaryPanelMock
  })
}));

vi.mock("../../../shared/toast", () => ({
  useToast: vi.fn()
}));

vi.mock("../../conversation/api/conversation-api", () => ({
  getProviderCapabilities: vi.fn(),
  getSessionMessages: vi.fn(),
  getSessionCapabilities: vi.fn(),
  getSessionRuntime: vi.fn()
}));

vi.mock("../api/butler-api", () => ({
  analyzeButlerInboxItem: vi.fn(),
  cancelAssistantAutomation: vi.fn(),
  cancelButlerControlTimer: vi.fn(),
  cancelButlerVerificationRun: vi.fn(),
  createAssistantSandbox: vi.fn(),
  expireAssistantSandbox: vi.fn(),
  getButlerProfile: vi.fn(),
  initButlerProfile: vi.fn(),
  updateButlerProfile: vi.fn(),
  getButlerOverview: vi.fn(),
  cancelButlerFollowUpTask: vi.fn(),
  getButlerFollowUpTask: vi.fn(),
  listAssistantSandboxes: vi.fn(),
  listButlerControlSessions: vi.fn(),
  listButlerControlTimers: vi.fn(),
  listAssistantAutomations: vi.fn(),
  listRecentAssistantAutomationRuns: vi.fn(),
  listButlerPatrolPlans: vi.fn(),
  listButlerFollowUpTasks: vi.fn(),
  listButlerInboxItems: vi.fn(),
  listButlerControlEvents: vi.fn(),
  promoteAssistantSandbox: vi.fn(),
  removeAssistantSandbox: vi.fn(),
  skipAssistantAutomationWait: vi.fn(),
  getCurrentButlerControlSession: vi.fn(),
  resetButlerControlSession: vi.fn(),
  startButlerControlSession: vi.fn(),
  startButlerInboxItemSession: vi.fn(),
  sendButlerControlMessage: vi.fn()
}));

import { useToast } from "../../../shared/toast";
import { ButlerPage } from "./ButlerPage";
import {
  analyzeButlerInboxItem,
  cancelAssistantAutomation,
  cancelButlerControlTimer,
  cancelButlerVerificationRun,
  createAssistantSandbox,
  expireAssistantSandbox,
  getButlerProfile,
  initButlerProfile,
  updateButlerProfile,
  getButlerOverview,
  cancelButlerFollowUpTask,
  getButlerFollowUpTask,
  listAssistantSandboxes,
  listButlerControlSessions,
  listButlerControlTimers,
  listAssistantAutomations,
  listRecentAssistantAutomationRuns,
  listButlerPatrolPlans,
  listButlerFollowUpTasks,
  listButlerInboxItems,
  listButlerControlEvents,
  promoteAssistantSandbox,
  removeAssistantSandbox,
  skipAssistantAutomationWait,
  getCurrentButlerControlSession,
  resetButlerControlSession,
  startButlerControlSession,
  startButlerInboxItemSession
} from "../api/butler-api";
import {
  getProviderCapabilities,
  getSessionMessages,
  getSessionCapabilities,
  getSessionRuntime
} from "../../conversation/api/conversation-api";

const mockedUseToast = vi.mocked(useToast);
const mockedAnalyzeButlerInboxItem = vi.mocked(analyzeButlerInboxItem);
const mockedCancelAssistantAutomation = vi.mocked(cancelAssistantAutomation);
const mockedCancelButlerControlTimer = vi.mocked(cancelButlerControlTimer);
const mockedCancelButlerVerificationRun = vi.mocked(cancelButlerVerificationRun);
const mockedCreateAssistantSandbox = vi.mocked(createAssistantSandbox);
const mockedExpireAssistantSandbox = vi.mocked(expireAssistantSandbox);
const mockedGetButlerProfile = vi.mocked(getButlerProfile);
const mockedInitButlerProfile = vi.mocked(initButlerProfile);
const mockedUpdateButlerProfile = vi.mocked(updateButlerProfile);
const mockedGetButlerOverview = vi.mocked(getButlerOverview);
const mockedCancelButlerFollowUpTask = vi.mocked(cancelButlerFollowUpTask);
const mockedGetButlerFollowUpTask = vi.mocked(getButlerFollowUpTask);
const mockedListAssistantSandboxes = vi.mocked(listAssistantSandboxes);
const mockedListButlerControlSessions = vi.mocked(listButlerControlSessions);
const mockedListButlerControlTimers = vi.mocked(listButlerControlTimers);
const mockedListAssistantAutomations = vi.mocked(listAssistantAutomations);
const mockedListRecentAssistantAutomationRuns = vi.mocked(listRecentAssistantAutomationRuns);
const mockedListButlerPatrolPlans = vi.mocked(listButlerPatrolPlans);
const mockedListButlerFollowUpTasks = vi.mocked(listButlerFollowUpTasks);
const mockedListButlerInboxItems = vi.mocked(listButlerInboxItems);
const mockedListButlerControlEvents = vi.mocked(listButlerControlEvents);
const mockedPromoteAssistantSandbox = vi.mocked(promoteAssistantSandbox);
const mockedRemoveAssistantSandbox = vi.mocked(removeAssistantSandbox);
const mockedSkipAssistantAutomationWait = vi.mocked(skipAssistantAutomationWait);
const mockedGetCurrentButlerControlSession = vi.mocked(getCurrentButlerControlSession);
const mockedResetButlerControlSession = vi.mocked(resetButlerControlSession);
const mockedStartButlerControlSession = vi.mocked(startButlerControlSession);
const mockedStartButlerInboxItemSession = vi.mocked(startButlerInboxItemSession);
const mockedGetProviderCapabilities = vi.mocked(getProviderCapabilities);
const mockedGetSessionMessages = vi.mocked(getSessionMessages);
const mockedGetSessionCapabilities = vi.mocked(getSessionCapabilities);
const mockedGetSessionRuntime = vi.mocked(getSessionRuntime);

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe("ButlerPage", () => {
  const showToastMock = vi.fn();
  const defaultAssistantState = {
    lifecycleStage: "pending" as const,
    analysisSummary: null,
    generatedPrompt: null,
    analysisControlSessionId: null,
    analysisSessionId: null,
    linkedButlerSessionId: null,
    linkedSessionId: null,
    linkedFollowUpTaskId: null,
    lastError: null,
    lastAnalyzedAt: null,
    lastSessionCreatedAt: null,
    lastFollowUpAt: null
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setAuxiliaryPanelMock.mockReset();
    navigateMock.mockReset();
    clipboardWriteTextMock.mockReset();
    clipboardWriteTextMock.mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock
      }
    });
    mockedUseToast.mockReturnValue({
      showToast: showToastMock,
      dismissToast: vi.fn()
    } as never);

    mockedGetButlerProfile.mockResolvedValue({
      initialized: false,
      profile: null
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
        agentsMode: "file",
        agentsFilePath: "/tmp/butler/AGENTS.md",
        agentsContent: "# AGENTS.md\n初始规则",
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
          projectCount: 3,
          activeProjectCount: 2,
          blockedProjectCount: 1,
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
    mockedCancelButlerFollowUpTask.mockResolvedValue({
      task: {} as never
    });
    mockedCancelButlerControlTimer.mockResolvedValue({
      timer: {} as never
    });
    mockedCancelAssistantAutomation.mockResolvedValue({
      payload: {
        automation: {} as never
      }
    });
    mockedSkipAssistantAutomationWait.mockResolvedValue({
      payload: {
        automation: {} as never
      }
    });
    mockedCreateAssistantSandbox.mockResolvedValue({
      payload: {
        sandbox: {} as never
      }
    });
    mockedExpireAssistantSandbox.mockResolvedValue({
      payload: {
        sandbox: {} as never
      }
    });
    mockedCancelButlerVerificationRun.mockResolvedValue({
      run: {
        id: "verification-1",
        projectId: "project-1",
        status: "cancelled"
      } as never
    });
    mockedGetButlerFollowUpTask.mockResolvedValue({
      task: {
        id: "follow-up-1",
        projectId: "project-1",
        projectName: "项目甲",
        workspaceId: "workspace-1",
        butlerSessionId: "butler-session-1",
        sessionId: "session-1",
        sessionTitle: "登录页开发",
        objective: "把验证码功能真正做完",
        completionCriteria: "当验证码流程和回归验证都完成后停止。",
        maxAutoContinueCount: 5,
        status: "waiting_user",
        checkIntervalSeconds: 300,
        lastCheckedAt: "2026-04-07T01:00:00.000Z",
        nextCheckAt: null,
        lastObservedRunningState: "completed",
        lastObservedMessageAt: "2026-04-07T01:00:00.000Z",
        lastObservedMessageCount: 12,
        lastAutomationSummary: "当前需要你确认验证码失败策略。",
        lastAutomationAt: "2026-04-07T01:02:00.000Z",
        autoContinueCount: 1,
        waitingReason: "需要你确认失败策略。",
        rounds: [
          {
            roundNumber: 1,
            kind: "started",
            status: "active",
            summary: "已开始跟进，准备由后台评估助手检查当前进展。默认最多自动推进 5 轮。",
            waitingReason: null,
            continuePrompt: null,
            observedRunningState: "completed",
            autoContinueCount: 0,
            createdAt: "2026-04-07T00:50:00.000Z"
          },
          {
            roundNumber: 2,
            kind: "waiting_user",
            status: "waiting_user",
            summary: "当前需要你确认验证码失败策略。",
            waitingReason: "需要你确认失败策略。",
            continuePrompt: null,
            observedRunningState: "completed",
            autoContinueCount: 1,
            createdAt: "2026-04-07T01:02:00.000Z"
          }
        ],
        createdAt: "2026-04-07T00:50:00.000Z",
        updatedAt: "2026-04-07T01:02:00.000Z",
        completedAt: null
      }
    });
    mockedListButlerPatrolPlans.mockResolvedValue({
      items: []
    });
    mockedListButlerControlSessions.mockResolvedValue({
      items: []
    } as never);
    mockedListAssistantSandboxes.mockResolvedValue({
      payload: {
        items: []
      }
    });
    mockedListButlerControlTimers.mockResolvedValue({
      items: []
    });
    mockedListAssistantAutomations.mockResolvedValue({
      payload: {
        items: []
      }
    });
    mockedListRecentAssistantAutomationRuns.mockResolvedValue({
      payload: {
        items: []
      }
    });
    mockedListButlerFollowUpTasks.mockResolvedValue({
      items: []
    });
    mockedListButlerInboxItems.mockResolvedValue({
      items: []
    });
    mockedListButlerControlEvents.mockResolvedValue({ items: [] });
    mockedPromoteAssistantSandbox.mockResolvedValue({
      payload: {
        sandbox: {} as never
      }
    });
    mockedRemoveAssistantSandbox.mockResolvedValue({
      payload: {
        sandbox: {} as never
      }
    });
    mockedGetCurrentButlerControlSession.mockResolvedValue({ controlSession: null });
    mockedResetButlerControlSession.mockResolvedValue({ controlSession: null } as never);
    mockedAnalyzeButlerInboxItem.mockResolvedValue({
      item: {} as never,
      controlSession: {} as never
    });
    mockedStartButlerControlSession.mockResolvedValue({
      controlSession: {
        id: "ctrl-start",
        providerId: "codex",
        sessionId: "session-control-1",
        status: "running",
        lastContextVersion: null,
        lastSummary: null,
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
        session: {
          sessionId: "session-control-1"
        }
      }
    } as never);
    mockedStartButlerInboxItemSession.mockResolvedValue({
      item: {} as never,
      session: {} as never,
      followUpTask: null
    });
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
      cursor: "cursor-latest",
      nextCursor: null,
      total: 0
    } as never);
    mockedGetSessionCapabilities.mockResolvedValue({
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={["/workspaces/workspace-1/butler"]}>
        <Routes>
          <Route path="/workspaces/:workspaceId/butler" element={<ButlerPage />} />
        </Routes>
      </MemoryRouter>
    );
  }

  function getLatestSidePanel() {
    const latestSidePanel = setAuxiliaryPanelMock.mock.calls.at(-1)?.[0];
    expect(latestSidePanel).toBeTruthy();
    return latestSidePanel;
  }

  it("首次加载时先显示动态加载态，不提前闪初始化表单", async () => {
    const profileDeferred = createDeferred<Awaited<ReturnType<typeof getButlerProfile>>>();
    mockedGetButlerProfile.mockReturnValueOnce(profileDeferred.promise);

    renderPage();

    expect(screen.getByText(t("shell.butlerLoadingTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.butlerLoadingDescription"))).toBeInTheDocument();
    expect(screen.queryByText(t("shell.butlerInitTitle"))).not.toBeInTheDocument();

    await act(async () => {
      profileDeferred.resolve({
        initialized: false,
        profile: null
      });
      await profileDeferred.promise;
    });

    await waitFor(() => {
      expect(screen.getByText(t("shell.butlerInitTitle"))).toBeInTheDocument();
    });
  });

  it("未初始化时展示表单并校验必填字段", async () => {
    renderPage();

    await waitFor(() => {
      expect(mockedGetButlerProfile).toHaveBeenCalled();
    });

    expect(screen.getByText(t("shell.butlerInitTitle"))).toBeInTheDocument();
    expect(screen.getByPlaceholderText(t("shell.butlerDisplayNamePlaceholder"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.butlerAgentsModeLabel"))).toBeInTheDocument();
    expect(screen.queryByText(t("shell.butlerWorkspacePathLabel"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.butlerAgentsFilePathLabel"))).not.toBeInTheDocument();
    expect(screen.queryByText("AGENTS 规则内容")).not.toBeInTheDocument();
    const initProviderSelect = screen.getByRole("combobox", { name: t("shell.butlerProviderLabel") });
    expect(within(initProviderSelect).getByRole("option", { name: "Codex" })).toBeInTheDocument();
    expect(within(initProviderSelect).getByRole("option", { name: "Claude Code" })).toBeInTheDocument();

    const submitButton = screen.getByRole("button", { name: t("shell.butlerInitSubmit") });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(showToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: t("shell.butlerInitNameRequired"),
          tone: "warning"
        })
      );
    });

    fireEvent.change(screen.getByPlaceholderText(t("shell.butlerDisplayNamePlaceholder")), {
      target: {
        value: "阿尔文"
      }
    });
    fireEvent.change(initProviderSelect, {
      target: {
        value: "claude-code"
      }
    });

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockedInitButlerProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: "阿尔文",
          providerId: "claude-code"
        })
      );
    });
  });

  it("初始化后展示聚合概览和控制事件", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
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

    mockedGetButlerOverview.mockResolvedValueOnce({
      overview: {
        version: "v2",
        generatedAt: "2026-04-05T00:00:00.000Z",
        global: {
          projectCount: 5,
          activeProjectCount: 3,
          blockedProjectCount: 2,
          highRiskProjectCount: 1,
          topRisks: ["风险 A"],
          nextActions: ["跟进 B"]
        },
        projects: [],
        sessions: [],
        patrols: [],
        verifications: []
      }
    });

    mockedListButlerControlEvents.mockResolvedValueOnce({
      items: [
        {
          id: "event-1",
          controlSessionId: "ctrl-1",
          kind: "action",
          actionType: "open-project",
          status: "succeeded",
          title: "打开项目：Alpha",
          content: "内容",
          relatedRefs: [],
          createdAt: "2026-04-05T00:00:00.000Z"
        }
      ]
    });

    renderPage();

    await waitFor(() => {
      expect(setAuxiliaryPanelMock).toHaveBeenCalled();
      expect(
        screen.getByText(t("shell.butlerComposerPlaceholder", { displayName: "阿尔文" }))
      ).toBeInTheDocument();
    });

    expect(screen.queryByText("在这里与助手对话，并查看聚合上下文和动作事件。")).not.toBeInTheDocument();
    expect(screen.queryByText("当前助手称呼：阿尔文")).not.toBeInTheDocument();
    expect(screen.queryByText("按需上下文")).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.butlerOverviewTitle"))).not.toBeInTheDocument();
  });

  it("工作台会显示助手头像并支持新建控制会话", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
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

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("shell.butlerNewSessionAction") })).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: t("shell.butlerProviderLabel") })).toBeInTheDocument();
    });

    const providerSelect = screen.getByRole("combobox", { name: t("shell.butlerProviderLabel") });
    expect(within(providerSelect).getByRole("option", { name: "Codex" })).toBeInTheDocument();
    expect(within(providerSelect).getByRole("option", { name: "Claude Code" })).toBeInTheDocument();

    expect(screen.getByTestId("butler-message-timeline")).toHaveTextContent(/\S/);

    fireEvent.click(screen.getByRole("button", { name: t("shell.butlerNewSessionAction") }));

    await waitFor(() => {
      expect(mockedResetButlerControlSession).toHaveBeenCalledTimes(1);
      expect(mockedStartButlerControlSession).not.toHaveBeenCalled();
      expect(showToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: t("shell.butlerNewSessionStarted"),
          tone: "success"
        })
      );
    });
  });

  it("悬浮助手名称时会显示最近的助手分析", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
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
    mockedListButlerFollowUpTasks.mockResolvedValue({
      items: [
        {
          id: "follow-up-1",
          projectId: "project-1",
          projectName: "项目甲",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-1",
          sessionId: "session-1",
          sessionTitle: "登录页开发",
          objective: "完成当前 spec 的必做项",
          status: "waiting_user",
          checkIntervalSeconds: 300,
          lastCheckedAt: null,
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: null,
          lastObservedMessageCount: 10,
          lastAutomationSummary: "当前需要你确认验证码失败策略。",
          lastAutomationAt: null,
          autoContinueCount: 1,
          waitingReason: "需要你确认失败策略。",
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:05:00.000Z",
          completedAt: null
        }
      ]
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "阿尔文" })).toBeInTheDocument();
      const latestSidePanel = getLatestSidePanel() as {
        props: {
          followUpTasks?: unknown[];
        };
      };
      expect(latestSidePanel.props.followUpTasks).toHaveLength(1);
    });

    fireEvent.mouseEnter(screen.getByRole("heading", { name: "阿尔文" }));

    await waitFor(() => {
      expect(screen.getByText(t("conversation.butlerAnalysisTitle"))).toBeInTheDocument();
      expect(screen.getByText(/完成当前 spec 的必做项/)).toBeInTheDocument();
    });
  });

  it("信息页展示全局的会话跟进、会话验证和代办进度记录", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
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
    mockedGetButlerOverview.mockResolvedValueOnce({
      overview: {
        version: "v4",
        generatedAt: "2026-04-05T00:00:00.000Z",
        global: {
          projectCount: 3,
          activeProjectCount: 3,
          blockedProjectCount: 1,
          highRiskProjectCount: 1,
          topRisks: [],
          nextActions: ["补齐验证码流程", "跟进登录异常"]
        },
        projects: [
          {
            id: "project-normal",
            workspaceId: "workspace-1",
            name: "普通项目",
            repoRoot: "/repo/project-normal",
            lifecycleStatus: "active",
            riskLevel: "low",
            activeSessionCount: 1,
            sessionCount: 1,
            memoryCount: 0,
            failedPatrolCount: 0,
            failedVerificationCount: 0,
            latestSessionSummary: "普通摘要",
            latestPatrolSummary: null,
            latestVerificationSummary: null,
            topRisks: [],
            nextActions: [],
            lastActivityAt: "2026-04-05T08:00:00.000Z",
            updatedAt: "2026-04-05T08:00:00.000Z"
          },
          {
            id: "project-risk",
            workspaceId: "workspace-1",
            name: "高风险项目",
            repoRoot: "/repo/project-risk",
            lifecycleStatus: "active",
            riskLevel: "high",
            activeSessionCount: 1,
            sessionCount: 1,
            memoryCount: 0,
            failedPatrolCount: 0,
            failedVerificationCount: 0,
            latestSessionSummary: "高风险摘要",
            latestPatrolSummary: null,
            latestVerificationSummary: null,
            topRisks: ["高风险"],
            nextActions: [],
            lastActivityAt: "2026-04-05T07:00:00.000Z",
            updatedAt: "2026-04-05T07:00:00.000Z"
          },
          {
            id: "project-blocked",
            workspaceId: "workspace-1",
            name: "阻塞项目",
            repoRoot: "/repo/project-blocked",
            lifecycleStatus: "active",
            riskLevel: "medium",
            activeSessionCount: 1,
            sessionCount: 1,
            memoryCount: 0,
            failedPatrolCount: 1,
            failedVerificationCount: 0,
            latestSessionSummary: "阻塞摘要",
            latestPatrolSummary: null,
            latestVerificationSummary: null,
            topRisks: ["有阻塞"],
            nextActions: [],
            lastActivityAt: "2026-04-05T06:00:00.000Z",
            updatedAt: "2026-04-05T06:00:00.000Z"
          }
        ],
        sessions: [
          {
            id: "session-follow-1",
            projectId: "project-normal",
            sessionId: "session-1",
            provider: "codex",
            title: "登录页改造",
            role: "execution",
            ownershipMode: "managed",
            status: "running",
            runningState: "running",
            lastSummary: "验证码流程还在收尾。",
            lastCheckpointAt: null,
            progressState: "working",
            riskFlags: [],
            nextActions: [],
            updatedAt: "2026-04-05T09:00:00.000Z",
            createdAt: "2026-04-05T08:30:00.000Z"
          }
        ],
        patrols: [],
        verifications: [
          {
            id: "verification-1",
            projectId: "project-normal",
            verificationType: "browser",
            status: "running",
            targetRef: "登录验证码",
            summary: "正在从用户视角复测登录流程。",
            startedAt: "2026-04-05T09:10:00.000Z",
            finishedAt: null,
            createdAt: "2026-04-05T09:10:00.000Z"
          },
          {
            id: "verification-2",
            projectId: "project-blocked",
            verificationType: "api",
            status: "passed",
            targetRef: "支付回归",
            summary: "支付回归验证已经完成。",
            startedAt: "2026-04-05T08:10:00.000Z",
            finishedAt: "2026-04-05T08:15:00.000Z",
            createdAt: "2026-04-05T08:10:00.000Z"
          }
        ]
      }
    });
    mockedListButlerInboxItems.mockResolvedValue({
      items: [
        {
          id: "todo-1",
          projectId: "project-normal",
          projectName: "普通项目",
          workspaceId: "workspace-1",
          projectLifecycleStatus: "active",
          itemType: "task",
          title: "补齐验证码流程",
          content: "继续把登录页验证码流程收尾。",
          priority: "medium",
          status: "in_progress",
          assistantState: {
            ...defaultAssistantState,
            lifecycleStage: "follow_up_active",
            analysisSummary: "仓库以 TypeScript 为主，登录流程已经进入收尾阶段。",
            generatedPrompt: "请继续补齐登录验证码流程。",
            linkedButlerSessionId: "butler-session-info-1",
            linkedSessionId: "session-follow-1",
            linkedFollowUpTaskId: "follow-up-info-1"
          },
          createdAt: "2026-04-05T08:40:00.000Z",
          updatedAt: "2026-04-05T09:20:00.000Z",
          closedAt: null
        }
      ]
    });
    mockedListButlerFollowUpTasks.mockResolvedValue({
      items: [
        {
          id: "follow-up-info-1",
          projectId: "project-normal",
          projectName: "普通项目",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-info-1",
          sessionId: "session-1",
          sessionTitle: "登录页改造",
          objective: "继续把登录页收尾",
          completionCriteria: "登录页功能完成且验证通过。",
          maxAutoContinueCount: 5,
          status: "waiting_user",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-05T09:05:00.000Z",
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: "2026-04-05T09:05:00.000Z",
          lastObservedMessageCount: 16,
          lastAutomationSummary: "验证码流程还在收尾。",
          lastAutomationAt: "2026-04-05T09:05:00.000Z",
          autoContinueCount: 1,
          waitingReason: "需要确认验证码失败策略。",
          createdAt: "2026-04-05T08:30:00.000Z",
          updatedAt: "2026-04-05T09:05:00.000Z",
          completedAt: null
        },
        {
          id: "follow-up-info-2",
          projectId: "project-normal",
          projectName: "普通项目",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-info-2",
          sessionId: "session-2",
          sessionTitle: "注册页改造",
          objective: "继续把注册页收尾",
          completionCriteria: "注册页功能完成且验证通过。",
          maxAutoContinueCount: 5,
          status: "active",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-05T08:55:00.000Z",
          nextCheckAt: "2026-04-05T09:10:00.000Z",
          lastObservedRunningState: "running",
          lastObservedMessageAt: "2026-04-05T08:55:00.000Z",
          lastObservedMessageCount: 9,
          lastAutomationSummary: "正在继续观察注册页收尾进度。",
          lastAutomationAt: "2026-04-05T08:55:00.000Z",
          autoContinueCount: 1,
          waitingReason: null,
          createdAt: "2026-04-05T08:20:00.000Z",
          updatedAt: "2026-04-05T08:55:00.000Z",
          completedAt: null
        },
        {
          id: "follow-up-info-3",
          projectId: "project-blocked",
          projectName: "阻塞项目",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-info-3",
          sessionId: "session-3",
          sessionTitle: "支付流程修复",
          objective: "排查支付流程阻塞",
          completionCriteria: "支付流程恢复可用。",
          maxAutoContinueCount: 5,
          status: "failed",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-05T08:45:00.000Z",
          nextCheckAt: null,
          lastObservedRunningState: "failed",
          lastObservedMessageAt: "2026-04-05T08:45:00.000Z",
          lastObservedMessageCount: 11,
          lastAutomationSummary: "支付流程仍然卡在第三方回调。",
          lastAutomationAt: "2026-04-05T08:45:00.000Z",
          autoContinueCount: 2,
          waitingReason: null,
          createdAt: "2026-04-05T08:00:00.000Z",
          updatedAt: "2026-04-05T08:45:00.000Z",
          completedAt: null
        },
        {
          id: "follow-up-info-4",
          projectId: "project-normal",
          projectName: "普通项目",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-info-4",
          sessionId: "session-4",
          sessionTitle: "设置页收尾",
          objective: "补齐设置页边角问题",
          completionCriteria: "设置页问题全部关闭。",
          maxAutoContinueCount: 5,
          status: "completed",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-05T08:35:00.000Z",
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: "2026-04-05T08:35:00.000Z",
          lastObservedMessageCount: 8,
          lastAutomationSummary: "设置页收尾已完成。",
          lastAutomationAt: "2026-04-05T08:35:00.000Z",
          autoContinueCount: 2,
          waitingReason: null,
          createdAt: "2026-04-05T07:50:00.000Z",
          updatedAt: "2026-04-05T08:35:00.000Z",
          completedAt: "2026-04-05T08:35:00.000Z"
        },
        {
          id: "follow-up-info-5",
          projectId: "project-risk",
          projectName: "高风险项目",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-info-5",
          sessionId: "session-5",
          sessionTitle: "监控告警治理",
          objective: "梳理告警噪音",
          completionCriteria: "告警规则恢复稳定。",
          maxAutoContinueCount: 5,
          status: "cancelled",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-05T08:20:00.000Z",
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: "2026-04-05T08:20:00.000Z",
          lastObservedMessageCount: 6,
          lastAutomationSummary: "该跟进已被手动停止。",
          lastAutomationAt: "2026-04-05T08:20:00.000Z",
          autoContinueCount: 1,
          waitingReason: null,
          createdAt: "2026-04-05T07:40:00.000Z",
          updatedAt: "2026-04-05T08:20:00.000Z",
          completedAt: "2026-04-05T08:20:00.000Z"
        },
        {
          id: "follow-up-info-6",
          projectId: "project-risk",
          projectName: "高风险项目",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-info-6",
          sessionId: "session-6",
          sessionTitle: "旧历史任务",
          objective: "这个任务只该出现在历史里",
          completionCriteria: "旧历史任务完成。",
          maxAutoContinueCount: 5,
          status: "completed",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-05T08:10:00.000Z",
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: "2026-04-05T08:10:00.000Z",
          lastObservedMessageCount: 5,
          lastAutomationSummary: "旧历史任务已完成。",
          lastAutomationAt: "2026-04-05T08:10:00.000Z",
          autoContinueCount: 1,
          waitingReason: null,
          createdAt: "2026-04-05T07:20:00.000Z",
          updatedAt: "2026-04-05T08:10:00.000Z",
          completedAt: "2026-04-05T08:10:00.000Z"
        }
      ]
    });
    mockedListButlerControlEvents.mockResolvedValueOnce({
      items: [
        {
          id: "event-follow-up-1",
          controlSessionId: "ctrl-1",
          kind: "action",
          actionType: "resume-session",
          status: "succeeded",
          title: "登录页改造",
          content: "验证码流程还在收尾。",
          relatedRefs: [],
          createdAt: "2026-04-05T09:05:00.000Z"
        }
      ]
    });

    renderPage();

    await waitFor(() => {
      const latestSidePanel = getLatestSidePanel() as {
        props: {
          followUpTasks?: unknown[];
          inboxItems?: unknown[];
        };
      };
      expect(latestSidePanel.props.followUpTasks).toHaveLength(6);
      expect(latestSidePanel.props.inboxItems).toHaveLength(1);
    });

    const latestSidePanel = getLatestSidePanel();
    const renderedPanel = render(latestSidePanel);
    const todoSection = renderedPanel.getByText(t("shell.butlerInfoTodoRecordsTitle")).closest("section");

    expect(todoSection).toBeTruthy();
    const todoScope = within(todoSection!);

    expect(renderedPanel.getByText(t("shell.butlerInfoFollowUpRecordsTitle"))).toBeInTheDocument();
    expect(
      renderedPanel.getAllByRole("button", { name: t("shell.butlerFollowUpHistoryAction") }).length
    ).toBeGreaterThanOrEqual(1);
    expect(renderedPanel.getByText("登录页改造")).toBeInTheDocument();
    expect(renderedPanel.getByText("需要确认验证码失败策略。")).toBeInTheDocument();
    expect(renderedPanel.queryByText("支付流程修复")).not.toBeInTheDocument();
    expect(renderedPanel.queryByText("旧历史任务")).not.toBeInTheDocument();
    expect(renderedPanel.getByText(t("shell.butlerInfoVerificationRecordsTitle"))).toBeInTheDocument();
    expect(renderedPanel.getByText("登录验证码")).toBeInTheDocument();
    expect(renderedPanel.getByText("正在从用户视角复测登录流程。")).toBeInTheDocument();
    expect(renderedPanel.queryByText("支付回归")).not.toBeInTheDocument();
    expect(renderedPanel.getByText(t("shell.butlerInfoTodoRecordsTitle"))).toBeInTheDocument();
    expect(todoScope.getByText("补齐验证码流程")).toBeInTheDocument();
    expect(todoScope.getByText("普通项目")).toBeInTheDocument();
    expect(todoScope.getByText(t("shell.butlerInfoTodoInProgress"))).toBeInTheDocument();
    expect(todoScope.getByText(t("shell.butlerTodoLifecycleFollowUpActive"))).toBeInTheDocument();
    expect(todoScope.getByText("仓库以 TypeScript 为主，登录流程已经进入收尾阶段。")).toBeInTheDocument();
    expect(todoScope.getByRole("button", { name: t("shell.butlerTodoReanalyzeAction") })).toBeInTheDocument();
    expect(todoScope.getByRole("button", { name: t("shell.butlerTodoOpenSessionAction") })).toBeInTheDocument();

    fireEvent.click(renderedPanel.getAllByRole("button", { name: t("shell.butlerFollowUpHistoryAction") })[0]!);

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: t("shell.butlerFollowUpHistoryTitle") })).toBeInTheDocument();
    });

    const historyDialog = screen.getByRole("dialog", { name: t("shell.butlerFollowUpHistoryTitle") });
    expect(within(historyDialog).getByText("支付流程修复")).toBeInTheDocument();
    expect(within(historyDialog).getByText("旧历史任务")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: t("common.close") }).at(-1) as HTMLElement);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: t("shell.butlerFollowUpHistoryTitle") })).toBeNull();
    });

    const verificationSection = renderedPanel.getByText(t("shell.butlerInfoVerificationRecordsTitle")).closest("section");
    expect(verificationSection).toBeTruthy();

    fireEvent.click(within(verificationSection as HTMLElement).getByRole("button", {
      name: t("shell.butlerFollowUpHistoryAction")
    }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: t("shell.butlerVerificationHistoryTitle") })).toBeInTheDocument();
    });

    const verificationHistoryDialog = screen.getByRole("dialog", { name: t("shell.butlerVerificationHistoryTitle") });
    expect(within(verificationHistoryDialog).getByText("支付回归")).toBeInTheDocument();
    expect(within(verificationHistoryDialog).getByText("支付回归验证已经完成。")).toBeInTheDocument();
  });

  it("代办生命周期卡片支持分析仓库并创建会话", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
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

    const pendingTodo = {
      id: "todo-lifecycle-1",
      projectId: "project-normal",
      projectName: "普通项目",
      workspaceId: "workspace-1",
      projectLifecycleStatus: "active" as const,
      itemType: "task" as const,
      title: "补齐验证码流程",
      content: "继续把登录页验证码流程收尾。",
      priority: "medium" as const,
      status: "pending" as const,
      assistantState: {
        ...defaultAssistantState
      },
      createdAt: "2026-04-05T08:40:00.000Z",
      updatedAt: "2026-04-05T08:40:00.000Z",
      closedAt: null
    };
    const analyzedTodo = {
      ...pendingTodo,
      updatedAt: "2026-04-05T08:50:00.000Z",
      assistantState: {
        ...defaultAssistantState,
        lifecycleStage: "analyzed" as const,
        analysisSummary: "仓库以 TypeScript 为主，登录验证码流程还差最后一轮联调。",
        generatedPrompt: "请先检查登录验证码相关页面、接口和错误处理，再继续补齐流程。",
        lastAnalyzedAt: "2026-04-05T08:50:00.000Z"
      }
    };
    const analyzingTodo = {
      ...pendingTodo,
      updatedAt: "2026-04-05T08:45:00.000Z",
      assistantState: {
        ...defaultAssistantState,
        lifecycleStage: "analyzing" as const
      }
    };
    const startedTodo = {
      ...analyzedTodo,
      status: "in_progress" as const,
      updatedAt: "2026-04-05T09:00:00.000Z",
      assistantState: {
        ...analyzedTodo.assistantState,
        lifecycleStage: "follow_up_active" as const,
        linkedButlerSessionId: "butler-session-todo-1",
        linkedSessionId: "session-exec-1",
        linkedFollowUpTaskId: "follow-up-todo-1",
        lastSessionCreatedAt: "2026-04-05T09:00:00.000Z",
        lastFollowUpAt: "2026-04-05T09:00:00.000Z"
      }
    };

    mockedListButlerInboxItems.mockResolvedValue({
      items: [pendingTodo]
    });
    mockedAnalyzeButlerInboxItem.mockResolvedValueOnce({
      item: analyzingTodo,
      controlSession: {
        id: "ctrl-analysis-1",
        providerId: "codex",
        sessionId: "session-analysis-1",
        purpose: "todo_analysis",
        title: "分析代办：补齐验证码流程",
        sourceItemId: "todo-lifecycle-1",
        status: "running",
        lastContextVersion: "ctx-1",
        lastSummary: "分析代办：补齐验证码流程",
        createdAt: "2026-04-05T08:45:00.000Z",
        updatedAt: "2026-04-05T08:45:00.000Z",
        session: {
          sessionId: "session-analysis-1"
        }
      } as never
    });
    mockedStartButlerInboxItemSession.mockResolvedValueOnce({
      item: startedTodo,
      session: {
        id: "managed-session-1",
        projectId: "project-normal",
        sessionId: "session-exec-1",
        provider: "codex",
        title: "补齐验证码流程",
        isArchived: false,
        role: "execution",
        ownershipMode: "managed",
        status: "running",
        runningState: "running",
        lastSummary: "已根据代办创建执行会话。",
        lastCheckpointAt: null,
        createdAt: "2026-04-05T09:00:00.000Z",
        updatedAt: "2026-04-05T09:00:00.000Z"
      },
      followUpTask: {
        id: "follow-up-todo-1",
        projectId: "project-normal",
        projectName: "普通项目",
        workspaceId: "workspace-1",
        butlerSessionId: "butler-session-todo-1",
        sessionId: "session-exec-1",
        sessionTitle: "补齐验证码流程",
        objective: "继续收尾登录验证码流程",
        completionCriteria: "验证码流程完成并验证通过。",
        maxAutoContinueCount: 5,
        status: "active",
        checkIntervalSeconds: 300,
        lastCheckedAt: "2026-04-05T09:00:00.000Z",
        nextCheckAt: null,
        lastObservedRunningState: "running",
        lastObservedMessageAt: "2026-04-05T09:00:00.000Z",
        lastObservedMessageCount: 1,
        lastAutomationSummary: "已创建执行会话并开始跟进。",
        lastAutomationAt: "2026-04-05T09:00:00.000Z",
        autoContinueCount: 0,
        waitingReason: null,
        createdAt: "2026-04-05T09:00:00.000Z",
        updatedAt: "2026-04-05T09:00:00.000Z",
        completedAt: null
      }
    });

    renderPage();

    await waitFor(() => {
      const latestSidePanel = getLatestSidePanel() as {
        props: {
          inboxItems?: unknown[];
        };
      };
      expect(latestSidePanel.props.inboxItems).toHaveLength(1);
    });

    const renderedPanel = render(getLatestSidePanel());

    fireEvent.click(renderedPanel.getByRole("button", { name: t("shell.butlerTodoAnalyzeAction") }));

    await waitFor(() => {
      expect(mockedAnalyzeButlerInboxItem).toHaveBeenCalledWith("todo-lifecycle-1");
    });
    await waitFor(() => {
      const latestSidePanel = getLatestSidePanel() as {
        props: {
          inboxItems: Array<{
            assistantState: {
              lifecycleStage: string;
              generatedPrompt: string | null;
            };
          }>;
        };
      };
      expect(latestSidePanel.props.inboxItems[0]?.assistantState.lifecycleStage).toBe("analyzing");
      expect(latestSidePanel.props.inboxItems[0]?.assistantState.generatedPrompt).toBeNull();
    });

    renderedPanel.rerender(getLatestSidePanel());
    expect(renderedPanel.getByText(t("shell.butlerTodoLifecycleAnalyzing"))).toBeInTheDocument();
    expect(renderedPanel.getByRole("button", { name: t("shell.butlerTodoAnalyzeRunning") })).toBeDisabled();
    expect(renderedPanel.getByRole("button", { name: t("shell.butlerTodoWaitForPromptAction") })).toBeDisabled();
    expect(showToastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: t("shell.butlerTodoAnalyzeQueued"),
        tone: "success"
      })
    );

    mockedListButlerInboxItems.mockResolvedValueOnce({
      items: [analyzedTodo]
    });
    act(() => {
      window.dispatchEvent(new Event("butler:inbox-updated"));
    });

    await waitFor(() => {
      const latestSidePanel = getLatestSidePanel() as {
        props: {
          inboxItems: Array<{
            assistantState: {
              lifecycleStage: string;
              generatedPrompt: string | null;
            };
          }>;
        };
      };
      expect(latestSidePanel.props.inboxItems[0]?.assistantState.lifecycleStage).toBe("analyzed");
      expect(latestSidePanel.props.inboxItems[0]?.assistantState.generatedPrompt).toContain("登录验证码");
    });

    renderedPanel.rerender(getLatestSidePanel());
    expect(renderedPanel.getByText(t("shell.butlerTodoLifecycleAnalyzed"))).toBeInTheDocument();
    expect(renderedPanel.getByRole("button", { name: t("shell.butlerTodoReanalyzeAction") })).toBeInTheDocument();
    expect(renderedPanel.getByRole("button", { name: t("shell.butlerTodoStartSessionAction") })).toBeInTheDocument();

    fireEvent.click(renderedPanel.getByRole("button", { name: t("shell.butlerTodoStartSessionAction") }));

    await waitFor(() => {
      expect(mockedStartButlerInboxItemSession).toHaveBeenCalledWith("todo-lifecycle-1");
    });
    await waitFor(() => {
      const latestSidePanel = getLatestSidePanel() as {
        props: {
          inboxItems: Array<{
            status: string;
            assistantState: {
              lifecycleStage: string;
              linkedSessionId: string | null;
            };
          }>;
          followUpTasks: unknown[];
        };
      };
      expect(latestSidePanel.props.inboxItems[0]?.status).toBe("in_progress");
      expect(latestSidePanel.props.inboxItems[0]?.assistantState.lifecycleStage).toBe("follow_up_active");
      expect(latestSidePanel.props.inboxItems[0]?.assistantState.linkedSessionId).toBe("session-exec-1");
      expect(latestSidePanel.props.followUpTasks).toHaveLength(1);
    });

    renderedPanel.rerender(getLatestSidePanel());
    expect(renderedPanel.getByText(t("shell.butlerInfoTodoInProgress"))).toBeInTheDocument();
    expect(renderedPanel.getByText(t("shell.butlerTodoLifecycleFollowUpActive"))).toBeInTheDocument();
    expect(renderedPanel.getByRole("button", { name: t("shell.butlerTodoOpenSessionAction") })).toBeInTheDocument();
  });

  it("信息标签页顶部可以进入当前控制会话的沙箱管理并查看文件", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
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
    mockedGetCurrentButlerControlSession.mockResolvedValue({
      controlSession: {
        id: "control-1",
        providerId: "codex",
        sessionId: "assistant-session-1",
        purpose: "chat",
        title: "当前助手控制会话",
        sourceItemId: null,
        status: "running",
        lastContextVersion: null,
        lastSummary: "继续处理 Butler 沙箱",
        createdAt: "2026-04-17T09:50:00.000Z",
        updatedAt: "2026-04-17T10:00:00.000Z",
        session: {
          sessionId: "assistant-session-1",
          workspaceId: "workspace-1",
          title: "当前助手控制会话"
        }
      }
    } as never);
    mockedListAssistantSandboxes.mockResolvedValue({
      payload: {
        items: [
          {
            id: "sandbox-1",
            userId: "user-1",
            workspaceId: "workspace-sandbox-1",
            controlSessionId: "control-1",
            title: "现有沙箱",
            description: null,
            sourceKind: "blank",
            sourceRef: "/tmp/butler/sandboxes/existing",
            visibility: "assistant_only",
            status: "active",
            purpose: "验证旧问题",
            expiresAt: null,
            promotedAt: null,
            createdAt: "2026-04-17T10:00:00.000Z",
            updatedAt: "2026-04-17T10:00:00.000Z",
            workspace: {
              id: "workspace-sandbox-1",
              name: "现有沙箱",
              path: "/tmp/butler/sandboxes/existing",
              repoRoot: "/tmp/butler/sandboxes/existing",
              favorite: false,
              sortOrder: 0,
              createdAt: "2026-04-17T10:00:00.000Z",
              updatedAt: "2026-04-17T10:00:00.000Z",
              removedAt: null
            }
          }
        ]
      }
    });
    mockedRemoveAssistantSandbox.mockResolvedValue({
      payload: {
        sandbox: {
          id: "sandbox-1",
          userId: "user-1",
          workspaceId: "workspace-sandbox-1",
          controlSessionId: "control-1",
          title: "现有沙箱",
          description: null,
          sourceKind: "blank",
          sourceRef: "/tmp/butler/sandboxes/existing",
          visibility: "assistant_only",
          status: "deleted",
          purpose: "验证旧问题",
          expiresAt: null,
          promotedAt: null,
          createdAt: "2026-04-17T10:00:00.000Z",
          updatedAt: "2026-04-17T10:20:00.000Z",
          workspace: null
        }
      }
    });

    renderPage();

    await waitFor(() => {
      expect(setAuxiliaryPanelMock).toHaveBeenCalled();
    });

    const renderedPanel = render(getLatestSidePanel());

    fireEvent.click(
      renderedPanel.getByRole("button", { name: t("shell.butlerSandboxManageAction") })
    );

    const dialog = await screen.findByRole("dialog", {
      name: t("shell.butlerSandboxManagerTitle")
    });

    await waitFor(() => {
      expect(mockedListAssistantSandboxes).toHaveBeenCalledWith({
        controlSessionId: "control-1"
      });
    });

    expect(within(dialog).getAllByText("现有沙箱").length).toBeGreaterThan(0);
    expect(within(dialog).getByTestId("butler-sandbox-file-panel")).toHaveTextContent("workspace-sandbox-1");

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: t("shell.butlerSandboxRemoveAction")
      })
    );

    await waitFor(() => {
      expect(mockedRemoveAssistantSandbox).toHaveBeenCalledWith("sandbox-1");
      expect(showToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: t("shell.butlerSandboxRemoveSucceeded"),
          tone: "success"
        })
      );
    });
  });

  it("当前会话没有沙箱时，沙箱管理直接展示空态", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
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

    renderPage();

    await waitFor(() => {
      expect(setAuxiliaryPanelMock).toHaveBeenCalled();
    });

    const renderedPanel = render(getLatestSidePanel());

    fireEvent.click(
      renderedPanel.getByRole("button", { name: t("shell.butlerSandboxManageAction") })
    );

    const dialog = await screen.findByRole("dialog", {
      name: t("shell.butlerSandboxManagerTitle")
    });

    expect(mockedListAssistantSandboxes).not.toHaveBeenCalled();
    expect(within(dialog).getByText(t("shell.butlerSandboxEmpty"))).toBeInTheDocument();
    expect(within(dialog).queryByText(t("shell.butlerSandboxSelectHint"))).not.toBeInTheDocument();
  });

  it("代办提示词支持从预览区和动作区复制", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
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
    mockedListButlerInboxItems.mockResolvedValue({
      items: [
        {
          id: "todo-copy-1",
          projectId: "project-normal",
          projectName: "普通项目",
          workspaceId: "workspace-1",
          projectLifecycleStatus: "active",
          itemType: "task",
          title: "补齐验证码流程",
          content: "继续把登录页验证码流程收尾。",
          priority: "medium",
          status: "pending",
          assistantState: {
            ...defaultAssistantState,
            lifecycleStage: "analyzed",
            analysisSummary: "仓库以 TypeScript 为主，登录验证码流程还差最后一轮联调。",
            generatedPrompt: "请先检查登录验证码相关页面、接口和错误处理，再继续补齐流程。",
            lastAnalyzedAt: "2026-04-05T08:50:00.000Z"
          },
          createdAt: "2026-04-05T08:40:00.000Z",
          updatedAt: "2026-04-05T08:50:00.000Z",
          closedAt: null
        }
      ]
    });

    renderPage();

    await waitFor(() => {
      const latestSidePanel = getLatestSidePanel() as {
        props: {
          inboxItems?: unknown[];
        };
      };
      expect(latestSidePanel.props.inboxItems).toHaveLength(1);
    });

    const renderedPanel = render(getLatestSidePanel());
    const copyButton = renderedPanel.getByRole("button", {
      name: t("shell.butlerTodoCopyPromptAction")
    });

    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith(
        "请先检查登录验证码相关页面、接口和错误处理，再继续补齐流程。"
      );
    });
    expect(showToastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: t("shell.butlerTodoCopyPromptSucceeded"),
        tone: "success"
      })
    );
  });

  it("自动化页只展示自动化任务和最近运行记录", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
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
    mockedGetButlerOverview.mockResolvedValueOnce({
      overview: {
        version: "v5",
        generatedAt: "2026-04-07T01:12:00.000Z",
        global: {
          projectCount: 2,
          activeProjectCount: 2,
          blockedProjectCount: 0,
          highRiskProjectCount: 0,
          topRisks: [],
          nextActions: []
        },
        projects: [
          {
            id: "project-1",
            workspaceId: "workspace-1",
            name: "项目甲",
            repoRoot: "/repo/project-1",
            lifecycleStatus: "active",
            riskLevel: "medium",
            activeSessionCount: 1,
            sessionCount: 1,
            memoryCount: 0,
            failedPatrolCount: 0,
            failedVerificationCount: 0,
            latestSessionSummary: null,
            latestPatrolSummary: null,
            latestVerificationSummary: null,
            topRisks: [],
            nextActions: [],
            lastActivityAt: "2026-04-07T01:00:00.000Z",
            updatedAt: "2026-04-07T01:00:00.000Z"
          },
          {
            id: "project-2",
            workspaceId: "workspace-1",
            name: "项目乙",
            repoRoot: "/repo/project-2",
            lifecycleStatus: "active",
            riskLevel: "low",
            activeSessionCount: 1,
            sessionCount: 1,
            memoryCount: 0,
            failedPatrolCount: 0,
            failedVerificationCount: 0,
            latestSessionSummary: null,
            latestPatrolSummary: null,
            latestVerificationSummary: null,
            topRisks: [],
            nextActions: [],
            lastActivityAt: "2026-04-07T01:00:00.000Z",
            updatedAt: "2026-04-07T01:00:00.000Z"
          }
        ],
        sessions: [],
        patrols: [
          {
            id: "patrol-run-active-1",
            projectId: "project-1",
            planId: "plan-1",
            triggeredBy: "scheduler",
            status: "running",
            riskLevel: "low",
            summary: "本轮巡检还在执行中。",
            suggestions: [],
            startedAt: "2026-04-07T01:05:00.000Z",
            finishedAt: null,
            createdAt: "2026-04-07T01:05:00.000Z"
          },
          {
            id: "patrol-run-1",
            projectId: "project-1",
            planId: "plan-1",
            triggeredBy: "scheduler",
            status: "completed",
            riskLevel: "low",
            summary: "本轮巡检未发现新的高风险问题。",
            suggestions: [],
            startedAt: "2026-04-07T00:40:00.000Z",
            finishedAt: "2026-04-07T00:45:00.000Z",
            createdAt: "2026-04-07T00:40:00.000Z"
          }
        ],
        verifications: []
      }
    });
    mockedListButlerPatrolPlans.mockImplementation(async (projectId: string) => ({
      items:
        projectId === "project-1"
          ? [
              {
                id: "plan-1",
                projectId: "project-1",
                name: "每日项目巡检",
                triggerType: "interval",
                triggerConfig: {},
                executionMode: "readonly",
                patrolScope: {},
                enabled: true,
                lastScheduledAt: "2026-04-07T00:30:00.000Z",
                nextRunAt: "2026-04-07T02:00:00.000Z",
                createdAt: "2026-04-01T00:00:00.000Z",
                updatedAt: "2026-04-07T00:30:00.000Z"
              }
            ]
          : []
    }));
    mockedListButlerFollowUpTasks.mockResolvedValue({
      items: [
        {
          id: "follow-up-1",
          projectId: "project-1",
          projectName: "项目甲",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-1",
          sessionId: "session-1",
          sessionTitle: "登录页开发",
          objective: "把验证码功能真正做完",
          status: "active",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-07T01:00:00.000Z",
          nextCheckAt: "2026-04-07T01:05:00.000Z",
          lastObservedRunningState: "running",
          lastObservedMessageAt: "2026-04-07T01:00:00.000Z",
          lastObservedMessageCount: 12,
          lastAutomationSummary: "会话仍在运行，助手继续观察当前进度。",
          lastAutomationAt: null,
          autoContinueCount: 0,
          waitingReason: null,
          createdAt: "2026-04-07T00:50:00.000Z",
          updatedAt: "2026-04-07T01:00:00.000Z",
          completedAt: null
        },
        {
          id: "follow-up-2",
          projectId: "project-2",
          projectName: "项目乙",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-2",
          sessionId: "session-2",
          sessionTitle: "注册流程收尾",
          objective: "补完注册流程收尾",
          status: "completed",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-07T01:10:00.000Z",
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: "2026-04-07T01:10:00.000Z",
          lastObservedMessageCount: 18,
          lastAutomationSummary: "当前目标已经完成，跟进任务已收尾。",
          lastAutomationAt: "2026-04-07T01:08:00.000Z",
          autoContinueCount: 2,
          waitingReason: null,
          createdAt: "2026-04-07T00:30:00.000Z",
          updatedAt: "2026-04-07T01:10:00.000Z",
          completedAt: "2026-04-07T01:10:00.000Z",
          rounds: [
            {
              roundNumber: 1,
              kind: "completed",
              status: "completed",
              summary: "当前目标已经完成，跟进任务已收尾。",
              waitingReason: null,
              continuePrompt: null,
              observedRunningState: "completed",
              autoContinueCount: 2,
              createdAt: "2026-04-07T01:08:00.000Z"
            }
          ]
        }
      ]
    });
    mockedListAssistantAutomations.mockResolvedValue({
      payload: {
        items: [
          {
            id: "automation-1",
            userId: "user-1",
            controlSessionId: "control-1",
            projectId: "project-1",
            title: "登录页开发",
            triggerType: "condition",
            triggerConfigJson: "{}",
            triggerConfig: {
              type: "condition",
              conditionKind: "session.runtime_idle",
              pollIntervalSeconds: 300,
              expiresAt: null,
              maxChecks: null,
              stateJson: "{}"
            },
            actionType: "send_control_message",
            actionConfigJson: "{}",
            actionConfig: {
              content: "把验证码功能真正做完",
              includeTriggerContext: true,
              targetSessionId: "session-1"
            },
            status: "active",
            nextRunAt: "2026-04-07T01:05:00.000Z",
            lastRunAt: null,
            lastRunSummary: null,
            lastError: null,
            createdAt: "2026-04-07T00:50:00.000Z",
            updatedAt: "2026-04-07T01:00:00.000Z",
            cancelledAt: null,
            controlSession: {
              id: "control-1",
              providerId: "codex",
              sessionId: "assistant-session-1",
              purpose: "chat",
              title: "控制会话一",
              sourceItemId: null,
              status: "running",
              lastContextVersion: null,
              lastSummary: null,
              createdAt: "2026-04-07T00:00:00.000Z",
              updatedAt: "2026-04-07T00:00:00.000Z",
              session: {
                sessionId: "assistant-session-1",
                workspaceId: "workspace-1"
              } as never
            }
          },
          {
            id: "automation-2",
            userId: "user-1",
            controlSessionId: "control-1",
            projectId: "project-1",
            title: "每日项目巡检",
            triggerType: "interval",
            triggerConfigJson: "{}",
            triggerConfig: {
              type: "interval",
              seconds: null,
              minutes: null,
              hours: 1,
              stopAt: null
            },
            actionType: "send_control_message",
            actionConfigJson: "{}",
            actionConfig: {
              content: "执行每日项目巡检",
              includeTriggerContext: false,
              targetSessionId: null
            },
            status: "active",
            nextRunAt: "2026-04-07T02:00:00.000Z",
            lastRunAt: "2026-04-07T00:30:00.000Z",
            lastRunSummary: "本轮巡检还在执行中。",
            lastError: null,
            createdAt: "2026-04-01T00:00:00.000Z",
            updatedAt: "2026-04-07T00:30:00.000Z",
            cancelledAt: null,
            controlSession: {
              id: "control-1",
              providerId: "codex",
              sessionId: "assistant-session-1",
              purpose: "chat",
              title: "控制会话一",
              sourceItemId: null,
              status: "running",
              lastContextVersion: null,
              lastSummary: null,
              createdAt: "2026-04-07T00:00:00.000Z",
              updatedAt: "2026-04-07T00:00:00.000Z",
              session: {
                sessionId: "assistant-session-1",
                workspaceId: "workspace-1"
              } as never
            }
          },
          {
            id: "automation-3",
            userId: "user-1",
            controlSessionId: "control-2",
            projectId: "project-2",
            title: "注册流程收尾",
            triggerType: "condition",
            triggerConfigJson: "{}",
            triggerConfig: {
              type: "condition",
              conditionKind: "session.runtime_idle",
              pollIntervalSeconds: 300,
              expiresAt: null,
              maxChecks: null,
              stateJson: "{}"
            },
            actionType: "send_control_message",
            actionConfigJson: "{}",
            actionConfig: {
              content: "补完注册流程收尾",
              includeTriggerContext: true,
              targetSessionId: "session-2"
            },
            status: "completed",
            nextRunAt: null,
            lastRunAt: "2026-04-07T01:08:00.000Z",
            lastRunSummary: "当前目标已经完成，跟进任务已收尾。",
            lastError: null,
            createdAt: "2026-04-07T00:30:00.000Z",
            updatedAt: "2026-04-07T01:10:00.000Z",
            cancelledAt: null,
            controlSession: {
              id: "control-2",
              providerId: "codex",
              sessionId: "assistant-session-2",
              purpose: "chat",
              title: "控制会话二",
              sourceItemId: null,
              status: "running",
              lastContextVersion: null,
              lastSummary: null,
              createdAt: "2026-04-07T00:00:00.000Z",
              updatedAt: "2026-04-07T00:00:00.000Z",
              session: {
                sessionId: "assistant-session-2",
                workspaceId: "workspace-1"
              } as never
            }
          }
        ]
      }
    });
    mockedListRecentAssistantAutomationRuns.mockResolvedValue({
      payload: {
        items: [
          {
            id: "automation-run-active-1",
            automationId: "automation-2",
            runSeq: 2,
            triggerType: "interval",
            triggerSnapshotJson: "{}",
            triggerSnapshot: {
              type: "interval",
              seconds: null,
              minutes: null,
              hours: 1,
              stopAt: null
            },
            actionType: "send_control_message",
            actionSnapshotJson: "{}",
            actionSnapshot: {
              content: "执行每日项目巡检",
              includeTriggerContext: false,
              targetSessionId: null
            },
            status: "running",
            summary: "本轮巡检还在执行中。",
            error: null,
            scheduledAt: "2026-04-07T01:05:00.000Z",
            startedAt: "2026-04-07T01:05:00.000Z",
            finishedAt: null,
            createdAt: "2026-04-07T01:05:00.000Z"
          },
          {
            id: "automation-run-history-1",
            automationId: "automation-3",
            runSeq: 1,
            triggerType: "condition",
            triggerSnapshotJson: "{}",
            triggerSnapshot: {
              type: "condition",
              conditionKind: "session.runtime_idle",
              pollIntervalSeconds: 300,
              expiresAt: null,
              maxChecks: null,
              stateJson: "{}"
            },
            actionType: "send_control_message",
            actionSnapshotJson: "{}",
            actionSnapshot: {
              content: "补完注册流程收尾",
              includeTriggerContext: true,
              targetSessionId: "session-2"
            },
            status: "succeeded",
            summary: "当前目标已经完成，跟进任务已收尾。",
            error: null,
            scheduledAt: "2026-04-07T01:08:00.000Z",
            startedAt: "2026-04-07T01:08:00.000Z",
            finishedAt: "2026-04-07T01:08:10.000Z",
            createdAt: "2026-04-07T01:08:00.000Z"
          },
          {
            id: "automation-run-history-2",
            automationId: "automation-2",
            runSeq: 1,
            triggerType: "interval",
            triggerSnapshotJson: "{}",
            triggerSnapshot: {
              type: "interval",
              seconds: null,
              minutes: null,
              hours: 1,
              stopAt: null
            },
            actionType: "send_control_message",
            actionSnapshotJson: "{}",
            actionSnapshot: {
              content: "执行每日项目巡检",
              includeTriggerContext: false,
              targetSessionId: null
            },
            status: "succeeded",
            summary: "本轮巡检未发现新的高风险问题。",
            error: null,
            scheduledAt: "2026-04-07T00:40:00.000Z",
            startedAt: "2026-04-07T00:40:00.000Z",
            finishedAt: "2026-04-07T00:45:00.000Z",
            createdAt: "2026-04-07T00:40:00.000Z"
          }
        ]
      }
    });

    renderPage();

    await waitFor(() => {
      const latestSidePanel = getLatestSidePanel() as {
        props: {
          assistantAutomations?: unknown[];
          assistantAutomationRuns?: unknown[];
        };
      };
      expect(latestSidePanel.props.assistantAutomations).toHaveLength(3);
      expect(latestSidePanel.props.assistantAutomationRuns).toHaveLength(3);
    });

    const latestSidePanel = getLatestSidePanel();
    const renderedPanel = render(latestSidePanel);

    fireEvent.click(renderedPanel.getByRole("tab", { name: t("shell.butlerSidebarAutomationTab") }));

    const automationTasksSection = renderedPanel.getByText(t("shell.butlerAutomationTasksTitle")).closest("section") as HTMLElement;
    const automationRunsSection = renderedPanel.getByText(t("shell.butlerAutomationRunsTitle")).closest("section") as HTMLElement;

    expect(within(automationTasksSection).getByText("登录页开发")).toBeInTheDocument();
    expect(within(automationTasksSection).getAllByText(t("shell.butlerAutomationStatusActive")).length).toBeGreaterThan(0);
    expect(within(automationTasksSection).getByText("每日项目巡检")).toBeInTheDocument();
    expect(within(automationTasksSection).getByText("把验证码功能真正做完")).toBeInTheDocument();
    expect(within(automationTasksSection).getByText("本轮巡检还在执行中。")).toBeInTheDocument();
    expect(within(automationTasksSection).getAllByText(t("shell.butlerAutomationTaskTypeFollowUp")).length).toBeGreaterThan(0);
    expect(within(automationTasksSection).getByText(t("shell.butlerAutomationTaskTypeInterval"))).toBeInTheDocument();
    expect(within(automationTasksSection).getAllByText(t("shell.butlerAutomationTaskNextRunLabel")).length).toBeGreaterThan(0);
    expect(within(automationTasksSection).queryByText("注册流程收尾")).not.toBeInTheDocument();
    expect(within(automationRunsSection).queryByText("注册流程收尾")).not.toBeInTheDocument();
    expect(within(automationRunsSection).queryByText("当前目标已经完成，跟进任务已收尾。")).not.toBeInTheDocument();
    expect(within(automationRunsSection).queryByText("本轮巡检未发现新的高风险问题。")).not.toBeInTheDocument();
    expect(within(automationRunsSection).getByText(t("shell.butlerAutomationRunSourcePatrol"))).toBeInTheDocument();
    expect(within(automationRunsSection).getByText("本轮巡检还在执行中。")).toBeInTheDocument();
    expect(within(automationRunsSection).getByText("执行每日项目巡检")).toBeInTheDocument();
    expect(renderedPanel.queryByRole("button", { name: t("shell.butlerAutomationViewRoundsAction") })).not.toBeInTheDocument();

    fireEvent.click(renderedPanel.getAllByRole("button", { name: t("shell.butlerFollowUpHistoryAction") })[0]!);

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: t("shell.butlerAutomationHistoryTitle") })).toBeInTheDocument();
    });

    const automationHistoryDialog = screen.getByRole("dialog", { name: t("shell.butlerAutomationHistoryTitle") });
    expect(within(automationHistoryDialog).getAllByText("注册流程收尾").length).toBeGreaterThan(0);
    expect(within(automationHistoryDialog).getByText("当前目标已经完成，跟进任务已收尾。")).toBeInTheDocument();
    expect(within(automationHistoryDialog).getByText("本轮巡检未发现新的高风险问题。")).toBeInTheDocument();
  });

  it("重复自动化 banner 会调用只跳过本次等待的接口，并保留会话跳转入口", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
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
    mockedGetCurrentButlerControlSession.mockResolvedValue({
      controlSession: {
        id: "control-1",
        providerId: "codex",
        sessionId: "assistant-session-1",
        purpose: "chat",
        title: "控制会话一",
        sourceItemId: null,
        model: "gpt-5.4",
        reasoningLevel: "high",
        permissionMode: "default",
        status: "running",
        lastContextVersion: null,
        lastSummary: null,
        createdAt: "2026-04-07T00:00:00.000Z",
        updatedAt: "2026-04-07T00:00:00.000Z",
        session: {
          sessionId: "assistant-session-1",
          workspaceId: "workspace-1",
          title: "控制会话一"
        }
      }
    } as never);
    mockedListAssistantAutomations.mockResolvedValue({
      payload: {
        items: [
          {
            id: "automation-interval-1",
            userId: "user-1",
            controlSessionId: "control-1",
            projectId: "project-1",
            title: "每小时巡检",
            triggerType: "interval",
            triggerConfigJson: "{}",
            triggerConfig: {
              type: "interval",
              seconds: null,
              minutes: null,
              hours: 1,
              stopAt: null
            },
            actionType: "send_control_message",
            actionConfigJson: "{}",
            actionConfig: {
              content: "执行每小时巡检",
              includeTriggerContext: false,
              targetSessionId: "session-1"
            },
            status: "active",
            nextRunAt: "2026-04-07T02:00:00.000Z",
            lastRunAt: "2026-04-07T00:00:00.000Z",
            lastRunSummary: "上一轮已完成",
            lastError: null,
            createdAt: "2026-04-07T00:00:00.000Z",
            updatedAt: "2026-04-07T00:00:00.000Z",
            cancelledAt: null,
            controlSession: {
              id: "control-1",
              providerId: "codex",
              sessionId: "assistant-session-1",
              purpose: "chat",
              title: "控制会话一",
              sourceItemId: null,
              status: "running",
              lastContextVersion: null,
              lastSummary: null,
              createdAt: "2026-04-07T00:00:00.000Z",
              updatedAt: "2026-04-07T00:00:00.000Z",
              session: {
                sessionId: "assistant-session-1",
                workspaceId: "workspace-1",
                title: "控制会话一"
              } as never
            }
          }
        ]
      }
    });
    mockedSkipAssistantAutomationWait.mockResolvedValueOnce({
      payload: {
        automation: {
          id: "automation-interval-1",
          userId: "user-1",
          controlSessionId: "control-1",
          projectId: "project-1",
          title: "每小时巡检",
          triggerType: "interval",
          triggerConfigJson: "{}",
          triggerConfig: {
            type: "interval",
            seconds: null,
            minutes: null,
            hours: 1,
            stopAt: null
          },
          actionType: "send_control_message",
          actionConfigJson: "{}",
          actionConfig: {
            content: "执行每小时巡检",
            includeTriggerContext: false,
            targetSessionId: "session-1"
          },
          status: "active",
          nextRunAt: "2026-04-07T03:00:00.000Z",
          lastRunAt: "2026-04-07T00:00:00.000Z",
          lastRunSummary: "上一轮已完成",
          lastError: null,
          createdAt: "2026-04-07T00:00:00.000Z",
          updatedAt: "2026-04-07T01:00:00.000Z",
          cancelledAt: null,
          controlSession: {
            id: "control-1",
            providerId: "codex",
            sessionId: "assistant-session-1",
            purpose: "chat",
            title: "控制会话一",
            sourceItemId: null,
            status: "running",
            lastContextVersion: null,
            lastSummary: null,
            createdAt: "2026-04-07T00:00:00.000Z",
            updatedAt: "2026-04-07T01:00:00.000Z",
            session: {
              sessionId: "assistant-session-1",
              workspaceId: "workspace-1",
              title: "控制会话一"
            } as never
          }
        } as never
      }
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("shell.butlerControlTimerCancelAction") })).toBeInTheDocument();
    });

    expect(screen.getByText(t("shell.butlerControlTimerTypeRepeat"))).toBeInTheDocument();

    const sessionButton = screen.getByRole("button", {
      name: `${t("shell.butlerControlTimerSessionLabel")}：登录页改造`
    });
    fireEvent.click(sessionButton);
    expect(navigateMock).toHaveBeenCalledWith("/workspaces/workspace-1/sessions/session-1");

    fireEvent.click(screen.getByRole("button", { name: t("shell.butlerControlTimerCancelAction") }));

    await waitFor(() => {
      expect(mockedSkipAssistantAutomationWait).toHaveBeenCalledWith("automation-interval-1");
    });
    expect(mockedCancelAssistantAutomation).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: t("shell.butlerControlTimerCancelSucceeded"),
        tone: "success"
      })
    );
  });

  it("会话跟进历史和状态卡都可以查看轮次详情", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
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
    mockedListButlerFollowUpTasks.mockResolvedValue({
      items: [
        {
          id: "follow-up-1",
          projectId: "project-1",
          projectName: "项目甲",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-1",
          sessionId: "session-1",
          sessionTitle: "登录页开发",
          objective: "把验证码功能真正做完",
          completionCriteria: "完成验证码开发并确认失败策略。",
          maxAutoContinueCount: 5,
          status: "waiting_user",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-07T01:00:00.000Z",
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: "2026-04-07T01:00:00.000Z",
          lastObservedMessageCount: 12,
          lastAutomationSummary: "当前需要你确认验证码失败策略。",
          lastAutomationAt: "2026-04-07T01:02:00.000Z",
          autoContinueCount: 1,
          waitingReason: "需要你确认失败策略。",
          createdAt: "2026-04-07T00:50:00.000Z",
          updatedAt: "2026-04-07T01:02:00.000Z",
          completedAt: null
        },
        {
          id: "follow-up-2",
          projectId: "project-1",
          projectName: "项目甲",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-2",
          sessionId: "session-2",
          sessionTitle: "注册页收尾",
          objective: "补齐注册页收尾工作",
          completionCriteria: "注册页问题全部关闭。",
          maxAutoContinueCount: 5,
          status: "completed",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-07T00:40:00.000Z",
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: "2026-04-07T00:40:00.000Z",
          lastObservedMessageCount: 8,
          lastAutomationSummary: "注册页收尾已完成。",
          lastAutomationAt: "2026-04-07T00:40:00.000Z",
          autoContinueCount: 2,
          waitingReason: null,
          createdAt: "2026-04-07T00:10:00.000Z",
          updatedAt: "2026-04-07T00:40:00.000Z",
          completedAt: "2026-04-07T00:40:00.000Z"
        }
      ]
    });

    renderPage();

    await waitFor(() => {
      const latestSidePanel = getLatestSidePanel() as {
        props: {
          followUpTasks?: unknown[];
        };
      };
      expect(latestSidePanel.props.followUpTasks).toHaveLength(2);
    });

    const latestSidePanel = getLatestSidePanel();
    const renderedPanel = render(latestSidePanel);

    fireEvent.click(renderedPanel.getByRole("button", { name: t("shell.butlerAutomationViewRoundsAction") }));

    await waitFor(() => {
      expect(mockedGetButlerFollowUpTask).toHaveBeenCalledWith("follow-up-1");
      expect(screen.getByText(t("shell.butlerAutomationRoundDetailsTitle"))).toBeInTheDocument();
      expect(screen.getByText(t("shell.butlerAutomationRoundLabel", { round: 2 }))).toBeInTheDocument();
      expect(screen.getByText(/当前需要你确认验证码失败策略/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole("button", { name: t("common.close") }).at(-1) as HTMLElement);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: t("shell.butlerAutomationRoundDetailsTitle") })).toBeNull();
    });

    const followUpSection = renderedPanel.getByText(t("shell.butlerInfoFollowUpRecordsTitle")).closest("section");
    expect(followUpSection).toBeTruthy();

    fireEvent.click(within(followUpSection as HTMLElement).getByRole("button", {
      name: t("shell.butlerFollowUpHistoryAction")
    }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: t("shell.butlerFollowUpHistoryTitle") })).toBeInTheDocument();
    });

    const historyDialog = screen.getByRole("dialog", { name: t("shell.butlerFollowUpHistoryTitle") });
    expect(within(historyDialog).getByText("注册页收尾")).toBeInTheDocument();
    fireEvent.click(within(historyDialog).getByRole("button", { name: t("shell.butlerAutomationViewRoundsAction") }));

    await waitFor(() => {
      expect(mockedGetButlerFollowUpTask).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("dialog", { name: t("shell.butlerAutomationRoundDetailsTitle") })).toBeInTheDocument();
    });
  });

  it("右侧信息栏只保留信息和自动化，不再展示旧的 Butler 页面残留入口", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
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
    mockedGetButlerOverview.mockResolvedValueOnce({
      overview: {
        version: "v3",
        generatedAt: "2026-04-05T00:00:00.000Z",
        global: {
          projectCount: 1,
          activeProjectCount: 1,
          blockedProjectCount: 0,
          highRiskProjectCount: 0,
          topRisks: [],
          nextActions: []
        },
        projects: [
          {
            id: "project-1",
            workspaceId: "workspace-1",
            name: "项目甲",
            repoRoot: "/repo/project-1",
            lifecycleStatus: "active",
            riskLevel: "medium",
            activeSessionCount: 1,
            sessionCount: 1,
            memoryCount: 1,
            failedPatrolCount: 0,
            failedVerificationCount: 0,
            latestSessionSummary: "最近进展",
            latestPatrolSummary: null,
            latestVerificationSummary: null,
            topRisks: ["接口波动"],
            nextActions: ["补跑验证"],
            lastActivityAt: "2026-04-05T00:00:00.000Z",
            updatedAt: "2026-04-05T00:00:00.000Z"
          }
        ],
        sessions: [],
        patrols: [],
        verifications: []
      }
    });

    renderPage();

    await waitFor(() => {
      expect(setAuxiliaryPanelMock).toHaveBeenCalled();
    });

    const latestSidePanel = setAuxiliaryPanelMock.mock.calls.at(-1)?.[0];
    const renderedPanel = render(latestSidePanel);

    expect(renderedPanel.queryByText("摘要检索")).not.toBeInTheDocument();
    expect(renderedPanel.queryByText("当前项目")).not.toBeInTheDocument();
    expect(renderedPanel.queryByText("助手会帮你做什么")).not.toBeInTheDocument();
    expect(renderedPanel.getByRole("tab", { name: t("shell.butlerSidebarInfoTab") })).toHaveClass("workbench-info-tab");
    expect(renderedPanel.getByRole("tab", { name: t("shell.butlerSidebarAutomationTab") })).toBeInTheDocument();
    expect(renderedPanel.getByRole("tab", { name: t("shell.butlerSidebarSettingsTab") })).toBeInTheDocument();
    expect(renderedPanel.container.querySelector(".butler-side-header")).toBeTruthy();
    expect(renderedPanel.container.querySelector(".butler-side-content")).toBeTruthy();
    expect(renderedPanel.queryByText("技能")).not.toBeInTheDocument();
    expect(renderedPanel.queryByText(t("shell.butlerInfoFollowUpRecordsDescription"))).not.toBeInTheDocument();
    expect(renderedPanel.queryByText(t("shell.butlerInfoVerificationRecordsDescription"))).not.toBeInTheDocument();
    expect(renderedPanel.queryByText(t("shell.butlerInfoTodoRecordsDescription"))).not.toBeInTheDocument();

    fireEvent.click(renderedPanel.getByRole("tab", { name: t("shell.butlerSidebarAutomationTab") }));
    expect(renderedPanel.queryByText(t("shell.butlerAutomationTasksDescription"))).not.toBeInTheDocument();
    expect(renderedPanel.queryByText(t("shell.butlerAutomationRunsDescription"))).not.toBeInTheDocument();

    fireEvent.click(renderedPanel.getByRole("tab", { name: t("shell.butlerSidebarSettingsTab") }));
    expect(renderedPanel.getByText(t("shell.butlerSettingsTitle"))).toBeInTheDocument();
    expect(renderedPanel.getByRole("button", { name: t("shell.butlerSettingsSaveAction") })).toBeInTheDocument();
  });

  it("设置标签可以保存助手配置", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
      initialized: true,
      profile: {
        id: "default",
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: "/tmp/butler",
        agentsMode: "file",
        agentsFilePath: "/tmp/butler/AGENTS.md",
        agentsContent: "# AGENTS.md\n初始规则",
        persona: { tone: "direct", language: "zh-CN", summaryStyle: "brief" },
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [], summaryDebounceSeconds: 300 },
        initializedAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z"
      }
    });

    renderPage();

    await waitFor(() => {
      const latestSidePanel = setAuxiliaryPanelMock.mock.calls.at(-1)?.[0] as
        | { props?: { settingsForm?: { agentsMode?: string } } }
        | undefined;
      expect(latestSidePanel?.props?.settingsForm?.agentsMode).toBe("file");
    });

    const latestSidePanel = setAuxiliaryPanelMock.mock.calls.at(-1)?.[0];
    const renderedPanel = render(latestSidePanel);

    fireEvent.click(renderedPanel.getByRole("tab", { name: t("shell.butlerSidebarSettingsTab") }));
    expect(renderedPanel.getByRole("textbox", { name: t("shell.butlerAgentsFilePathLabel") })).toHaveValue(
      "/tmp/butler/AGENTS.md"
    );
    /* expect(renderedPanel.getByRole("textbox", { name: t("shell.butlerAgentsContentLabel") })).toHaveValue(
      "# AGENTS.md\n初始规则"
        value: "# AGENTS.md\n更新后的规则"
      }
    });
    */
    expect(renderedPanel.getByRole("textbox", { name: t("shell.butlerAgentsContentLabel") })).toHaveValue(
      "# AGENTS.md\n初始规则"
    );
    fireEvent.click(renderedPanel.getByRole("button", { name: t("shell.butlerSettingsSaveAction") }));

    await waitFor(() => {
      /* expect(mockedUpdateButlerProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: "阿尔文",
          agentsMode: "file",
          agentsFilePath: "/tmp/butler/AGENTS.md",
          agentsContent: "# AGENTS.md\n更新后的规则",
          persona: {
            tone: "direct",
            language: "zh-CN",
            summaryStyle: "brief"
          },
          focus: expect.objectContaining({
            riskPreference: "conservative",
            summaryDebounceSeconds: 300
          })
        })
      );
      */
      const payload = mockedUpdateButlerProfile.mock.calls.at(-1)?.[0];
      expect(payload).toEqual(
        expect.objectContaining({
          agentsMode: "file",
          agentsFilePath: "/tmp/butler/AGENTS.md",
          agentsContent: "# AGENTS.md\n初始规则",
          persona: {
            tone: "direct",
            language: "zh-CN",
            summaryStyle: "brief"
          }
        })
      );
      expect(payload?.focus).toEqual(
        expect.objectContaining({
          riskPreference: "conservative",
          summaryDebounceSeconds: 300
        })
      );
      expect(showToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: t("shell.butlerSettingsSaved"),
          tone: "success"
        })
      );
    });
  });

  it("助手实时会话仍会保留时间线的更早消息入口", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
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
    mockedGetCurrentButlerControlSession.mockResolvedValue({
      controlSession: {
        id: "ctrl-1",
        providerId: "codex",
        sessionId: "session-control-1",
        status: "running",
        lastContextVersion: "v1",
        lastSummary: "最近在跟进",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
        session: {
          sessionId: "session-control-1"
        }
      }
    } as never);
    mockedGetSessionMessages
      .mockResolvedValueOnce({
        messages: [
          {
            messageId: "message-latest-1",
            provider: "codex",
            providerSessionId: "provider-control-1",
            role: "assistant",
            kind: "text",
            content: "最新一页",
            timestamp: "2026-04-05T00:00:01.000Z",
            sequence: 10,
            rawRef: "raw-latest-1"
          }
        ],
        cursor: "cursor-latest",
        nextCursor: "cursor-older-1",
        total: 61
      } as never)
      .mockResolvedValueOnce({
        messages: [
          {
            messageId: "message-older-1",
            provider: "codex",
            providerSessionId: "provider-control-1",
            role: "assistant",
            kind: "text",
            content: "更早一页",
            timestamp: "2026-04-05T00:00:00.000Z",
            sequence: 9,
            rawRef: "raw-older-1"
          }
        ],
        cursor: "cursor-older-1",
        nextCursor: null,
        total: 62
      } as never);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("butler-load-older")).toBeInTheDocument();
      expect(mockedGetCurrentButlerControlSession).toHaveBeenCalled();
      expect(screen.getByTestId("butler-message-has-older")).toHaveTextContent("true");
    });

    fireEvent.click(screen.getByTestId("butler-load-older"));

    await waitFor(() => {
      expect(mockedGetSessionMessages).toHaveBeenNthCalledWith(
        2,
        "session-control-1",
        "cursor-older-1",
        60,
        "backward"
      );
      expect(screen.getByTestId("butler-message-has-older")).toHaveTextContent("false");
    });
  });

  it("does not re-register the auxiliary panel when rerendering with the same inputs", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
      initialized: true,
      profile: {
        id: "default",
        displayName: "Butler",
        providerId: "codex",
        workspacePath: "/tmp/butler",
        agentsMode: "inline",
        agentsFilePath: null,
        agentsContent: "test",
        persona: { tone: "direct", language: "zh-CN", summaryStyle: "brief" },
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [], summaryDebounceSeconds: 300 },
        initializedAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z"
      }
    });
    const page = (
      <MemoryRouter initialEntries={["/workspaces/workspace-1/butler"]}>
        <Routes>
          <Route path="/workspaces/:workspaceId/butler" element={<ButlerPage />} />
        </Routes>
      </MemoryRouter>
    );
    const view = render(page);

    await waitFor(() => {
      expect(setAuxiliaryPanelMock).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const initialSetAuxiliaryPanelCallCount = setAuxiliaryPanelMock.mock.calls.length;

    view.rerender(page);

    await act(async () => {
      await Promise.resolve();
    });

    expect(setAuxiliaryPanelMock).toHaveBeenCalledTimes(initialSetAuxiliaryPanelCallCount);
  });
});
